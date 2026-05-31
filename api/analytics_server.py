#!/usr/bin/env python3
"""
Simple privacy-first analytics server for British Radio Player.

Self-hosted server for collecting anonymous, aggregated analytics data.
It does NOT store IP addresses or any PII.

Also hosts a server-side podcast/episode FTS index so the Android app can
search without building a large local index on the device.

Installation:
    pip install flask

Usage:
    python3 analytics_server.py

The server will start on http://localhost:5000

Configure in the app by setting:
    private const val ANALYTICS_ENDPOINT = "https://yourdomain.com/event"
    (RemoteIndexClient derives its base URL from the same host)
"""

from flask import Flask, request, jsonify, Response
from datetime import datetime, timedelta, timezone
import sqlite3
import sys
import csv
import io
import logging
import re
import unicodedata
import json
import os
import subprocess
import time
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError
from pathlib import Path

app = Flask(__name__)

# Suppress Flask access logging for privacy (don't log IP addresses)
log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)  # Only show errors, not access logs

# Enable CORS for web player
@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    return response


# ── Admin endpoint protection ──────────────────────────────────────────────
# Admin endpoints are protected by HTTP Basic Auth at the nginx reverse proxy
# level (auth_basic). The Python backend trusts requests that reach it, as
# nginx has already validated credentials.

ADMIN_TOKEN = os.environ.get('BBC_RADIO_ADMIN_TOKEN', '').strip()


def require_admin_token():
    """No-op — nginx handles HTTP Basic Auth before requests reach here."""
    return True, None

# Database paths
DB_PATH = Path(__file__).parent / 'analytics.db'
PODCAST_INDEX_DB_PATH = Path(__file__).parent / 'podcast_index.db'
DEFAULT_GCS_BUCKET = 'bbc-radio-player-index-20260317-bc149e38'

# Anonymous rating endpoint safeguards.
RATING_MIN_VALUE = 1.0
RATING_MAX_VALUE = 5.0
RATING_MAX_IDS_PER_QUERY = 250
RATING_SUBMIT_MIN_INTERVAL_SECONDS = 2.0
RATING_ID_RE = re.compile(r'^[a-zA-Z0-9_-]{3,128}$')
_last_rating_submit_at = {}


def _resolve_cloud_meta_url():
    """Resolve cloud metadata URL from env vars, defaulting to local Nginx-served file."""
    explicit_meta_url = os.environ.get('GCS_META_URL', '').strip()
    if explicit_meta_url:
        return explicit_meta_url

    # Default to local Nginx-served file for self-hosted deployments
    base_url = os.environ.get('BBC_RADIO_BASE_URL', 'http://127.0.0.1:8443')
    return f'{base_url}/data/podcast-index-meta.json'


def _resolve_cloud_stats_url():
    """Resolve popular podcasts snapshot URL from env vars, defaulting to local Nginx-served file."""
    explicit_stats_url = os.environ.get('GCS_STATS_URL', '').strip()
    if explicit_stats_url:
        return explicit_stats_url

    # Default to local Nginx-served file for self-hosted deployments
    base_url = os.environ.get('BBC_RADIO_BASE_URL', 'http://127.0.0.1:8443')
    return f'{base_url}/data/popular-podcasts.json'

def _get_cpu_usage():
    """Read CPU usage from /proc/stat (delta over 1 second sample)."""
    try:
        def read_cpu():
            with open('/proc/stat') as f:
                line = f.readline()
            parts = list(map(int, line.split()[1:]))
            return parts

        t1 = read_cpu()
        time.sleep(1)
        t2 = read_cpu()

        delta = [b - a for a, b in zip(t1, t2)]
        total = sum(delta)
        idle = delta[3] if len(delta) > 3 else 0
        return round((1.0 - idle / total) * 100.0, 1) if total > 0 else 0.0
    except Exception:
        return None


def _get_memory_usage():
    """Read from /proc/meminfo: total, available, used, percentage."""
    try:
        mem = {}
        with open('/proc/meminfo') as f:
            for line in f:
                parts = line.split()
                key = parts[0].rstrip(':')
                val = int(parts[1])  # kB
                mem[key] = val

        total_kb = mem.get('MemTotal', 0)
        avail_kb = mem.get('MemAvailable', mem.get('MemFree', 0))
        used_kb = total_kb - avail_kb
        pct = round((used_kb / total_kb) * 100.0, 1) if total_kb > 0 else 0.0

        return {
            'total_mb': round(total_kb / 1024.0),
            'used_mb': round(used_kb / 1024.0),
            'available_mb': round(avail_kb / 1024.0),
            'percent': pct
        }
    except Exception:
        return None


def _get_disk_usage():
    """Use os.statvfs on root filesystem: total, used, available, percentage."""
    try:
        st = os.statvfs('/')
        total_bytes = st.f_frsize * st.f_blocks
        free_bytes = st.f_frsize * st.f_bfree
        avail_bytes = st.f_frsize * st.f_bavail
        used_bytes = total_bytes - free_bytes
        pct = round((used_bytes / total_bytes) * 100.0, 1) if total_bytes > 0 else 0.0

        return {
            'total_gb': round(total_bytes / (1024**3), 1),
            'used_gb': round(used_bytes / (1024**3), 1),
            'available_gb': round(avail_bytes / (1024**3), 1),
            'percent': pct
        }
    except Exception:
        return None


def _get_uptime():
    """Read from /proc/uptime: return human-readable string."""
    try:
        with open('/proc/uptime') as f:
            seconds = float(f.readline().split()[0])
        days = int(seconds // 86400)
        hours = int((seconds % 86400) // 3600)
        minutes = int((seconds % 3600) // 60)
        parts = []
        if days:
            parts.append(f'{days}d')
        if hours:
            parts.append(f'{hours}h')
        parts.append(f'{minutes}m')
        return ' '.join(parts)
    except Exception:
        return None


def _get_cpu_temperature():
    """Read from /sys/class/thermal/thermal_zone0/temp (Raspberry Pi specific)."""
    try:
        with open('/sys/class/thermal/thermal_zone0/temp') as f:
            raw = f.read().strip()
            temp_c = int(raw) / 1000.0
            return round(temp_c, 1)
    except Exception:
        try:
            result = subprocess.run(['vcgencmd', 'measure_temp'], capture_output=True, text=True, timeout=2)
            if result.returncode == 0:
                temp_str = result.stdout.strip().split('=')[1].replace('\'C', '')
                return round(float(temp_str), 1)
        except Exception:
            pass
        return None


def _check_service_active(service_name):
    """Check if a systemd service is active."""
    try:
        result = subprocess.run(
            ['systemctl', 'is-active', service_name],
            capture_output=True, text=True, timeout=5
        )
        return result.stdout.strip()
    except Exception:
        return 'unknown'


def _get_timer_next_run(timer_name):
    """Get the next trigger time for a systemd timer."""
    try:
        result = subprocess.run(
            ['systemctl', 'show', timer_name, '--property=NextElapseUSecRealtime', '--value'],
            capture_output=True, text=True, timeout=5
        )
        val = result.stdout.strip()
        if val and val != 'n/a':
            return val
    except Exception:
        pass
    return None


def _get_service_status():
    """Check systemd service states for BBC Radio Pi services."""
    try:
        search_svc = 'bbc-radio-search.service'
        index_timer = 'bbc-radio-index-builder.timer'
        export_timer = 'bbc-radio-popular-export.timer'

        search_status = _check_service_active(search_svc)
        index_status = _check_service_active(index_timer)
        export_status = _check_service_active(export_timer)

        payload = {
            'analytics_server': {'status': 'active', 'port': 5002},
            'search_server': {'status': search_status, 'port': 5001},
            'index_builder_timer': {'status': index_status, 'next_run': _get_timer_next_run(index_timer)},
            'popular_export_timer': {'status': export_status, 'next_run': _get_timer_next_run(export_timer)}
        }
        return payload
    except Exception:
        return {
            'analytics_server': {'status': 'active', 'port': 5002},
            'search_server': {'status': 'unavailable'},
            'index_builder_timer': {'status': 'unavailable'},
            'popular_export_timer': {'status': 'unavailable'}
        }


# Canonical station names match the app's current naming convention.
# Legacy names such as "BBC Radio 4" are normalised to "Radio 4".
STATION_NAMES_BY_ID = {
    'radio1': 'Radio 1',
    '1xtra': 'Radio 1Xtra',
    'radio1dance': 'Radio 1 Dance',
    'radio1anthems': 'Radio 1 Anthems',
    'radio2': 'Radio 2',
    'radio3': 'Radio 3',
    'radio3unwind': 'Radio 3 Unwind',
    'radio4': 'Radio 4',
    'radio4extra': 'Radio 4 Extra',
    'radio5live': 'Radio 5 Live',
    'radio5livesportsextra': 'Radio 5 Sports Extra',
    'radio5livesportsextra2': 'Radio 5 Sports Extra 2',
    'radio5livesportsextra3': 'Radio 5 Sports Extra 3',
    'radio6': 'Radio 6 Music',
    'worldservice': 'World Service',
    'asiannetwork': 'Asian Network',
    'radiocymru': 'Radio Cymru',
    'radiocymru2': 'Radio Cymru 2',
    'radiofoyle': 'Radio Foyle',
    'radiogaidheal': 'Radio nan Gaidheal',
    'radioorkney': 'Radio Orkney',
    'radioscotland': 'Radio Scotland',
    'radioscotlandextra': 'Radio Scotland Extra',
    'radioshetland': 'Radio Shetland',
    'radioulster': 'Radio Ulster',
    'radiowales': 'Radio Wales',
    'radiowalesextra': 'Radio Wales Extra',
    'radioberkshire': 'Radio Berkshire',
    'radiobristol': 'Radio Bristol',
    'radiocambridge': 'Radio Cambridgeshire',
    'radiocornwall': 'Radio Cornwall',
    'radiocoventrywarwickshire': 'Radio Coventry & Warwickshire',
    'radiocumbria': 'Radio Cumbria',
    'radioderby': 'Radio Derby',
    'radiodevon': 'Radio Devon',
    'radioessex': 'Radio Essex',
    'radioherefordworcester': 'Radio Hereford & Worcester',
    'radiogloucestershire': 'Radio Gloucestershire',
    'radioguernsey': 'Radio Guernsey',
    'radiohumberside': 'Radio Humberside',
    'radiojersey': 'Radio Jersey',
    'radiokent': 'Radio Kent',
    'radiolancashire': 'Radio Lancashire',
    'radioleeds': 'Radio Leeds',
    'radioleicester': 'Radio Leicester',
    'radiolincolnshire': 'Radio Lincolnshire',
    'radiolon': 'Radio London',
    'radiomanchester': 'Radio Manchester',
    'radiomerseyside': 'Radio Merseyside',
    'radionewcastle': 'Radio Newcastle',
    'radionorfolk': 'Radio Norfolk',
    'radionorthampton': 'Radio Northampton',
    'radionottingham': 'Radio Nottingham',
    'radiooxford': 'Radio Oxford',
    'radiosheffield': 'Radio Sheffield',
    'radioshropshire': 'Radio Shropshire',
    'radiosolent': 'Radio Solent',
    'radiosolentwestdorset': 'Radio Solent West Dorset',
    'radiosomerset': 'Radio Somerset',
    'radiostoke': 'Radio Stoke',
    'radiosuffolk': 'Radio Suffolk',
    'radiosurrey': 'Radio Surrey',
    'radiosussex': 'Radio Sussex',
    'radiotees': 'Radio Tees',
    'radiothreecounties': 'Three Counties Radio',
    'radiowestmidlands': 'Radio West Midlands',
    'radiowiltshire': 'Radio Wiltshire',
    'radioyork': 'Radio York',
}


def _normalise_station_fields(station_id, station_name):
    """
    Normalise station fields to match the app naming convention.

    - Canonicalise known station IDs to their app title.
    - Strip legacy leading "BBC " prefixes from free-form station names.
    """
    cleaned_station_id = station_id.strip() if isinstance(station_id, str) else station_id
    cleaned_station_name = station_name.strip() if isinstance(station_name, str) else station_name

    canonical_name = STATION_NAMES_BY_ID.get(cleaned_station_id)
    if canonical_name:
        return cleaned_station_id, canonical_name

    if isinstance(cleaned_station_name, str) and cleaned_station_name:
        cleaned_station_name = re.sub(r'^bbc\s+', '', cleaned_station_name, flags=re.IGNORECASE)
        cleaned_station_name = re.sub(r'\s+', ' ', cleaned_station_name).strip()

    return cleaned_station_id, cleaned_station_name


def _backfill_station_names(conn):
    """Backfill existing rows to canonical station names where possible."""
    c = conn.cursor()
    for station_id, canonical_name in STATION_NAMES_BY_ID.items():
        c.execute(
            '''
            UPDATE events
            SET station_name = ?
            WHERE station_id = ?
              AND (station_name IS NULL OR TRIM(station_name) != ?)
            ''',
            (canonical_name, station_id, canonical_name)
        )

    c.execute(
        '''
        UPDATE events
        SET station_name = TRIM(SUBSTR(station_name, 5))
        WHERE station_name IS NOT NULL
          AND LOWER(station_name) LIKE 'bbc %'
        '''
    )


def _normalise_station_result_row(row_dict):
    """Normalise station name in a stats/export result row for display."""
    station_id = row_dict.get('id') if 'id' in row_dict else row_dict.get('station_id')
    station_name_key = 'name' if 'name' in row_dict else 'station_name'
    station_name = row_dict.get(station_name_key)
    _, normalised_name = _normalise_station_fields(station_id, station_name)
    if normalised_name:
        row_dict[station_name_key] = normalised_name
    return row_dict


def _read_cloud_index_meta():
    """
    Fetch lightweight index metadata from Google Cloud Storage.

    Returns:
        dict with podcast_count, episode_count, generated_at on success,
        or None when unavailable.
    """
    try:
        req = Request(
            _resolve_cloud_meta_url(),
            headers={'User-Agent': 'British-Radio-Player-Analytics/1.0'}
        )
        with urlopen(req, timeout=5) as resp:
            if resp.status != 200:
                return None
            payload = json.loads(resp.read().decode('utf-8'))
            return {
                'podcast_count': int(payload.get('podcast_count', 0) or 0),
                'episode_count': int(payload.get('episode_count', 0) or 0),
                'generated_at': payload.get('generated_at')
            }
    except (URLError, HTTPError, ValueError, OSError):
        return None


def _read_cloud_popular_snapshot_meta():
    """
    Fetch lightweight metadata from popular-podcasts snapshot used by the app.

    Returns:
        dict with generated_at and snapshot_count on success,
        or None when unavailable.
    """
    try:
        req = Request(
            _resolve_cloud_stats_url(),
            headers={'User-Agent': 'British-Radio-Player-Analytics/1.0'}
        )
        with urlopen(req, timeout=5) as resp:
            if resp.status != 200:
                return None
            payload = json.loads(resp.read().decode('utf-8'))
            snapshot = payload.get('popular_podcasts') or []
            return {
                'generated_at': payload.get('generated_at'),
                'snapshot_count': len(snapshot)
            }
    except (URLError, HTTPError, ValueError, OSError):
        return None


def _format_human_timestamp(value):
    """Format ISO-like timestamps into a human-readable UTC string."""
    if not value:
        return value

    marker_values = {'never', 'unavailable', 'unknown'}
    if isinstance(value, str) and value.strip().lower() in marker_values:
        return value

    try:
        text = str(value).strip()
        # Support trailing Z and timestamps without explicit timezone.
        dt = datetime.fromisoformat(text.replace('Z', '+00:00'))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        dt_utc = dt.astimezone(timezone.utc)
        return dt_utc.strftime('%d %b %Y, %H:%M UTC')
    except Exception:
        return value


def _extract_event_datetime_parts(date_value, timestamp_value):
    """Extract normalised UTC date/time parts for exports and sorting."""
    candidates = [timestamp_value, date_value]

    for raw in candidates:
        text = (str(raw or '')).strip()
        if not text:
            continue

        # Canonical pattern: YYYY-MM-DD[T or space]HH:MM:SS
        match = re.search(r'(\d{4}-\d{2}-\d{2})[T\s]+(\d{2}:\d{2}:\d{2})', text)
        if match:
            date_part = match.group(1)
            time_part = match.group(2)
            try:
                dt = datetime.strptime(f'{date_part} {time_part}', '%Y-%m-%d %H:%M:%S')
                return date_part, time_part, dt
            except ValueError:
                pass

        # Fallback pattern: HH:MM:SS[Z] YYYY-MM-DD
        match = re.search(r'(\d{2}:\d{2}:\d{2})Z?\s+(\d{4}-\d{2}-\d{2})', text)
        if match:
            date_part = match.group(2)
            time_part = match.group(1)
            try:
                dt = datetime.strptime(f'{date_part} {time_part}', '%Y-%m-%d %H:%M:%S')
                return date_part, time_part, dt
            except ValueError:
                pass

        # Date-only fallback.
        match = re.search(r'(\d{4}-\d{2}-\d{2})', text)
        if match:
            date_part = match.group(1)
            try:
                dt = datetime.strptime(date_part, '%Y-%m-%d')
                return date_part, '00:00:00', dt
            except ValueError:
                pass

    return '', '', None


def _is_truthy_query_flag(value):
    """Return True when a query parameter represents an enabled flag."""
    return str(value or '').strip().lower() in {'1', 'true', 'yes', 'on'}


def _is_valid_rating_identifier(value):
    """Validate anonymous identifiers used by ratings endpoints."""
    if not isinstance(value, str):
        return False
    candidate = value.strip()
    if not candidate:
        return False
    return bool(RATING_ID_RE.match(candidate))


def _is_rate_limited(install_id, podcast_id):
    """Simple in-memory throttle per install/podcast pair."""
    key = f"{install_id}:{podcast_id}"
    now = time.monotonic()
    previous = _last_rating_submit_at.get(key)
    if previous is not None and (now - previous) < RATING_SUBMIT_MIN_INTERVAL_SECONDS:
        return True

    _last_rating_submit_at[key] = now

    # Prevent unbounded growth for long-running processes.
    if len(_last_rating_submit_at) > 10000:
        cutoff = now - (RATING_SUBMIT_MIN_INTERVAL_SECONDS * 10)
        stale_keys = [k for k, v in _last_rating_submit_at.items() if v < cutoff]
        for stale_key in stale_keys:
            _last_rating_submit_at.pop(stale_key, None)

    return False


def _resolve_index_display_status(server_counts):
    """
    Resolve effective index status for UI/API display.

    Prefer local server FTS counts. If local FTS is empty/uninitialised,
    fall back to Google Cloud metadata (the app's primary index source).
    """
    local_has_data = (
        server_counts['podcast_count'] > 0 or
        server_counts['episode_count'] > 0 or
        bool(server_counts['last_updated'])
    )
    if local_has_data:
        return {
            'podcast_count': server_counts['podcast_count'],
            'episode_count': server_counts['episode_count'],
            'last_updated': server_counts['last_updated'],
            'source': 'server_fts'
        }

    upstream = _read_cloud_index_meta()
    if upstream:
        return {
            'podcast_count': upstream['podcast_count'],
            'episode_count': upstream['episode_count'],
            'last_updated': upstream['generated_at'],
            'source': 'gcp_meta'
        }

    return {
        'podcast_count': server_counts['podcast_count'],
        'episode_count': server_counts['episode_count'],
        'last_updated': server_counts['last_updated'],
        'source': 'server_fts_empty'
    }


def init_podcast_index_db():
    """Initialize the podcast index database with FTS4 tables."""
    conn = sqlite3.connect(PODCAST_INDEX_DB_PATH)
    c = conn.cursor()
    c.execute(
        'CREATE VIRTUAL TABLE IF NOT EXISTS podcast_fts '
        'USING fts4(podcastId TEXT, title TEXT, description TEXT)'
    )
    c.execute(
        'CREATE VIRTUAL TABLE IF NOT EXISTS episode_fts '
        'USING fts4(episodeId TEXT, podcastId TEXT, title TEXT, description TEXT)'
    )
    c.execute(
        'CREATE TABLE IF NOT EXISTS episode_meta ('
        'episodeId TEXT PRIMARY KEY, podcastId TEXT, '
        'pubDate TEXT, pubEpoch INTEGER DEFAULT 0)'
    )
    c.execute(
        'CREATE TABLE IF NOT EXISTS index_meta ('
        'key TEXT PRIMARY KEY, value TEXT)'
    )
    conn.commit()
    conn.close()


def get_podcast_index_db():
    """Get podcast index database connection."""
    conn = sqlite3.connect(PODCAST_INDEX_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _normalize_query(query):
    """
    Normalize a free-text query into an FTS4 MATCH expression.
    Advanced queries (containing AND/OR/NEAR/quotes/-) are passed through as-is.
    Simple single-word queries get a prefix wildcard.
    Multi-word queries are converted to a prefix-AND expression.
    """
    q = query.strip()
    if not q:
        return ''

    # Detect advanced FTS syntax and pass through unchanged
    advanced_markers = ('"', '(', ')', ' AND ', ' OR ', ' NEAR', ' -')
    upper = q.upper()
    if any(m in q for m in ('"', '(', ')')) or \
       ' AND ' in upper or ' OR ' in upper or ' NEAR' in upper or \
       q.startswith('-') or ' -' in q or '*' in q or ':' in q:
        return q

    # Normalise: strip diacritics, remove non-alphanumeric (except spaces), collapse whitespace
    nfkd = unicodedata.normalize('NFD', q)
    stripped = ''.join(c for c in nfkd if unicodedata.category(c) != 'Mn')
    cleaned = re.sub(r'[^\w\s]', ' ', stripped, flags=re.UNICODE)
    collapsed = re.sub(r'\s+', ' ', cleaned).strip().lower()

    tokens = [t for t in collapsed.split(' ') if t]
    if not tokens:
        return ''
    if len(tokens) == 1:
        return f'{tokens[0]}*'

    phrase = '"' + ' '.join(tokens) + '"'
    near = ' NEAR/10 '.join(tokens)
    token_and = ' AND '.join(f'{t}*' for t in tokens)
    return f'({near}) OR ({phrase}) OR ({token_and})'


def init_db():
    """Initialize the database."""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # Create events table
    c.execute('''
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            station_id TEXT,
            station_name TEXT,
            podcast_id TEXT,
            episode_id TEXT,
            podcast_title TEXT,
            episode_title TEXT,
            date TEXT NOT NULL,
            app_version TEXT,
            platform TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS podcast_ratings (
            podcast_id TEXT NOT NULL,
            install_id TEXT NOT NULL,
            rating REAL NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            app_version TEXT,
            platform TEXT,
            PRIMARY KEY (podcast_id, install_id)
        )
    ''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_podcast_ratings_podcast_id ON podcast_ratings (podcast_id)')

    # Backward-compatible migrations for existing databases
    existing_columns = {row[1] for row in c.execute("PRAGMA table_info(events)").fetchall()}
    if "station_id" not in existing_columns:
        c.execute("ALTER TABLE events ADD COLUMN station_id TEXT")
    if "station_name" not in existing_columns:
        c.execute("ALTER TABLE events ADD COLUMN station_name TEXT")
    if "podcast_id" not in existing_columns:
        c.execute("ALTER TABLE events ADD COLUMN podcast_id TEXT")
    if "episode_id" not in existing_columns:
        c.execute("ALTER TABLE events ADD COLUMN episode_id TEXT")
    if "podcast_title" not in existing_columns:
        c.execute("ALTER TABLE events ADD COLUMN podcast_title TEXT")
    if "episode_title" not in existing_columns:
        c.execute("ALTER TABLE events ADD COLUMN episode_title TEXT")
    if "platform" not in existing_columns:
        c.execute("ALTER TABLE events ADD COLUMN platform TEXT")
        # Back-fill existing rows: web versions get 'web', everything else gets 'android'
        c.execute("UPDATE events SET platform = 'web' WHERE platform IS NULL AND app_version LIKE '%-web'")
        c.execute("UPDATE events SET platform = 'android' WHERE platform IS NULL")

    _backfill_station_names(conn)

    conn.commit()
    conn.close()


def get_db():
    """Get database connection."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# Initialise both databases when the module is loaded (covers gunicorn production deployments
# as well as direct `python3 analytics_server.py` invocations).
init_db()
init_podcast_index_db()

@app.route('/event', methods=['POST'])
def log_event():
    """
    Accept analytics events from the app or web player.
    
    Expected JSON format:
    {
        "event": "station_play",  // or web_player_episode_view, web_player_audio_play, etc.
        "station_id": "radio1",  // or "podcast_id" or "episode_id" (use human-visible ID)
        "date": "2026-02-25",
        "app_version": "0.12.0",
        "source": "app",  // or "web_player"
    }
    """
    # Don't log IP addresses - privacy first!
    # Flask is handling this by not accessing request.remote_addr or client IP
    
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No JSON data'}), 400
        
        # Validate required fields
        if 'event' not in data or 'date' not in data:
            return jsonify({'error': 'Missing required fields'}), 400
        
        event_type = data['event']
        source = data.get('source', 'app')
        station_id, station_name = _normalise_station_fields(
            data.get('station_id'),
            data.get('station_name')
        )
        
        # For web player events, be more flexible with validation
        if source == 'web_player':
            # Web player events don't require strict validation
            conn = get_db()
            c = conn.cursor()
            c.execute('''
                INSERT INTO events (
                    event_type,
                    station_id,
                    station_name,
                    podcast_id,
                    episode_id,
                    podcast_title,
                    episode_title,
                    date,
                    app_version,
                    platform
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                event_type,
                station_id,
                station_name,
                data.get('podcast_id'),
                data.get('episode_id'),
                data.get('podcast_title'),
                data.get('episode_title'),
                data['date'],
                data.get('app_version', '1.0.0-web'),
                data.get('platform', 'web')
            ))
            conn.commit()
            conn.close()

            print(
                f"[{datetime.now().isoformat()}] WEB_PLAYER "
                f"event={event_type} podcast={data.get('podcast_id')} episode={data.get('episode_id')} date={data['date']}"
            )
            
            return jsonify({'status': 'ok'}), 201
        
        # App source - maintain original strict validation
        podcast_id = data.get('podcast_id')
        episode_id = data.get('episode_id')
        podcast_title = data.get('podcast_title')
        episode_title = data.get('episode_title')
        date = data['date']
        app_version = data.get('app_version')

        # Validate event payload shape
        if event_type == 'station_play' and not station_id:
            return jsonify({'error': 'station_id required for station_play'}), 400
        if event_type == 'episode_play' and (not podcast_id or not episode_id):
            return jsonify({'error': 'podcast_id and episode_id required for episode_play'}), 400
        
        # Store in database (aggregate only - no timestamps or IPs)
        conn = get_db()
        c = conn.cursor()
        c.execute('''
            INSERT INTO events (
                event_type,
                station_id,
                station_name,
                podcast_id,
                episode_id,
                podcast_title,
                episode_title,
                date,
                app_version,
                platform
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (event_type, station_id, station_name, podcast_id, episode_id, podcast_title, episode_title, date, app_version, data.get('platform', 'android')))
        conn.commit()
        conn.close()

        print(
            f"[{datetime.now().isoformat()}] APP "
            f"event={event_type} station={station_id} podcast={podcast_id} episode={episode_id} date={date}"
        )
        
        return jsonify({'status': 'ok'}), 201
        
    except Exception as e:
        print(f"Error processing event: {e}", file=sys.stderr)
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/stats', methods=['GET'])
def get_stats():
    """
    Return aggregated statistics (public endpoint).
    
    Returns popularity rankings for stations, podcasts, and episodes.
    Optional query param: days (e.g., 1, 7, 30, 90, 365, or "all").
    """
    try:
        conn = get_db()
        c = conn.cursor()

        days_param = request.args.get('days', '30').strip().lower()
        days_value = None
        if days_param != 'all':
            try:
                days_value = max(1, int(days_param))
            except ValueError:
                days_value = 30

        date_filter = ""
        params = []
        if days_value is not None:
            since_date = (datetime.now() - timedelta(days=days_value)).strftime('%Y-%m-%d')
            date_filter = " AND date >= ?"
            params.append(since_date)

        exclude_debug_versions = _is_truthy_query_flag(request.args.get('exclude_debug', '0'))
        debug_filter = ""
        if exclude_debug_versions:
            debug_filter = " AND (app_version IS NULL OR LOWER(app_version) NOT LIKE '%debug%')"

        # Most popular stations
        c.execute(f'''
            SELECT
                station_id AS id,
                COALESCE(NULLIF(MAX(station_name), ''), station_id) AS name,
                COUNT(*) as plays
            FROM events
            WHERE event_type = 'station_play'
            {date_filter}
            {debug_filter}
            AND station_id IS NOT NULL
            GROUP BY station_id
            ORDER BY plays DESC
            LIMIT 20
        ''', params)
        popular_stations = [
            _normalise_station_result_row(dict(row))
            for row in c.fetchall()
        ]

        # Most popular podcasts (app + web player)
        # Fetch a larger pool (200) so that after merging same-named podcasts that were
        # tracked under multiple podcast_ids we still have enough entries to fill 20 slots.
        c.execute(f'''
            SELECT
                podcast_id AS id,
                COALESCE(NULLIF(MAX(podcast_title), ''), podcast_id) AS name,
                COUNT(*) as plays
            FROM events
            WHERE (event_type IN ('episode_play', 'web_player_podcast_view', 'web_player_episode_view', 'web_player_audio_play'))
            {date_filter}
            {debug_filter}
            AND podcast_id IS NOT NULL
            GROUP BY podcast_id
            ORDER BY plays DESC
            LIMIT 200
        ''', params)
        raw_podcast_rows = [dict(row) for row in c.fetchall()]

        # Merge duplicate podcast entries that share the same display name but were
        # stored under different podcast_ids (e.g. after a BBC re-index).  The id of
        # the entry with the most plays is kept as the canonical id so that the Android
        # app can still match it by id as well as by title.
        merged: dict = {}  # merge_key -> {'id', 'name', 'plays', 'top_plays'}
        for row in raw_podcast_rows:
            norm = row['name'].strip().lower() if row['name'] else ''
            # Fall back to the podcast_id as the merge key for untitled entries so
            # they are not incorrectly grouped together.
            merge_key = norm if norm else row['id']
            if merge_key not in merged:
                merged[merge_key] = {'id': row['id'], 'name': row['name'],
                                     'plays': row['plays'], 'top_plays': row['plays']}
            else:
                merged[merge_key]['plays'] += row['plays']
                # Promote the id/name of whichever sub-entry had the most plays.
                if row['plays'] > merged[merge_key]['top_plays']:
                    merged[merge_key]['top_plays'] = row['plays']
                    merged[merge_key]['id'] = row['id']
                    merged[merge_key]['name'] = row['name']

        popular_podcasts = sorted(
            ({'id': v['id'], 'name': v['name'], 'plays': v['plays']}
             for v in merged.values()),
            key=lambda x: -x['plays']
        )[:30]

        # Most popular episodes (app + web player)
        c.execute(f'''
            SELECT
                episode_id AS id,
                COALESCE(NULLIF(MAX(episode_title), ''), episode_id) AS name,
                podcast_id,
                COALESCE(NULLIF(MAX(podcast_title), ''), podcast_id) AS podcast_name,
                COUNT(*) as plays
            FROM events
            WHERE (event_type IN ('episode_play', 'web_player_episode_view', 'web_player_audio_play'))
            {date_filter}
            {debug_filter}
            AND episode_id IS NOT NULL
            GROUP BY episode_id, podcast_id
            ORDER BY plays DESC
            LIMIT 20
        ''', params)
        popular_episodes = [dict(row) for row in c.fetchall()]
        
        # Total events count by event type (all time)
        total_events_query = '''
            SELECT event_type, COUNT(*) as total
            FROM events
        '''
        if exclude_debug_versions:
            total_events_query += " WHERE (app_version IS NULL OR LOWER(app_version) NOT LIKE '%debug%')"
        total_events_query += ' GROUP BY event_type'
        c.execute(total_events_query)
        event_totals = {row['event_type']: row['total'] for row in c.fetchall()}
        
        conn.close()
        
        return jsonify({
            'popular_stations': popular_stations,
            'popular_podcasts': popular_podcasts,
            'popular_episodes': popular_episodes,
            'event_totals': event_totals,
            'range_days': days_value if days_value is not None else 'all',
            'exclude_debug_versions': exclude_debug_versions,
            'generated_at': datetime.now().isoformat()
        })
        
    except Exception as e:
        print(f"Error getting stats: {e}", file=sys.stderr)
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/rating', methods=['POST'])
def submit_podcast_rating():
    """Submit or update an anonymous podcast rating for one install."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No JSON data'}), 400

        podcast_id = str(data.get('podcast_id', '')).strip()
        install_id = str(data.get('install_id', '')).strip()
        rating_raw = data.get('rating')

        if not _is_valid_rating_identifier(podcast_id):
            return jsonify({'error': 'Invalid podcast_id'}), 400
        if not _is_valid_rating_identifier(install_id):
            return jsonify({'error': 'Invalid install_id'}), 400

        try:
            rating_value = float(rating_raw)
        except (TypeError, ValueError):
            return jsonify({'error': 'rating must be a number between 1 and 5'}), 400

        if rating_value < RATING_MIN_VALUE or rating_value > RATING_MAX_VALUE:
            return jsonify({'error': 'rating must be between 1 and 5'}), 400

        # Keep stored values in half-step granularity.
        rating_value = round(rating_value * 2.0) / 2.0

        if _is_rate_limited(install_id, podcast_id):
            return jsonify({'error': 'Too many rating requests; please wait a moment'}), 429

        conn = get_db()
        c = conn.cursor()
        c.execute(
            '''
            INSERT INTO podcast_ratings (podcast_id, install_id, rating, app_version, platform)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(podcast_id, install_id)
            DO UPDATE SET
                rating = excluded.rating,
                updated_at = CURRENT_TIMESTAMP,
                app_version = excluded.app_version,
                platform = excluded.platform
            ''',
            (
                podcast_id,
                install_id,
                rating_value,
                data.get('app_version'),
                data.get('platform', 'android')
            )
        )

        c.execute(
            '''
            SELECT ROUND(AVG(rating), 2) AS average_rating, COUNT(*) AS rating_count
            FROM podcast_ratings
            WHERE podcast_id = ?
            ''',
            (podcast_id,)
        )
        row = c.fetchone()
        conn.commit()
        conn.close()

        average_rating = float(row['average_rating']) if row and row['average_rating'] is not None else 0.0
        rating_count = int(row['rating_count']) if row and row['rating_count'] is not None else 0

        return jsonify({
            'status': 'ok',
            'podcast_id': podcast_id,
            'average_rating': average_rating,
            'rating_count': rating_count,
            'my_rating': rating_value,
            'generated_at': datetime.now().isoformat()
        }), 201
    except Exception as e:
        print(f"Error submitting rating: {e}", file=sys.stderr)
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/ratings', methods=['GET'])
def get_podcast_ratings():
    """Return aggregate ratings for one or more podcast IDs."""
    try:
        ids_param = request.args.get('podcast_ids', '')
        requested_ids = [item.strip() for item in ids_param.split(',') if item and item.strip()]
        valid_ids = []
        for podcast_id in requested_ids[:RATING_MAX_IDS_PER_QUERY]:
            if _is_valid_rating_identifier(podcast_id):
                valid_ids.append(podcast_id)

        if not valid_ids:
            return jsonify({'ratings': {}, 'generated_at': datetime.now().isoformat()}), 200

        install_id = request.args.get('install_id', '').strip()
        include_my_rating = _is_valid_rating_identifier(install_id)

        conn = get_db()
        c = conn.cursor()

        placeholders = ','.join(['?'] * len(valid_ids))
        c.execute(
            f'''
            SELECT podcast_id, ROUND(AVG(rating), 2) AS average_rating, COUNT(*) AS rating_count
            FROM podcast_ratings
            WHERE podcast_id IN ({placeholders})
            GROUP BY podcast_id
            ''',
            valid_ids
        )
        aggregate_rows = c.fetchall()

        my_ratings = {}
        if include_my_rating:
            c.execute(
                f'''
                SELECT podcast_id, rating
                FROM podcast_ratings
                WHERE install_id = ? AND podcast_id IN ({placeholders})
                ''',
                [install_id] + valid_ids
            )
            my_ratings = {row['podcast_id']: float(row['rating']) for row in c.fetchall()}

        conn.close()

        ratings_payload = {}
        for row in aggregate_rows:
            podcast_id = row['podcast_id']
            rating_entry = {
                'average_rating': float(row['average_rating']) if row['average_rating'] is not None else 0.0,
                'rating_count': int(row['rating_count']) if row['rating_count'] is not None else 0,
            }
            if podcast_id in my_ratings:
                rating_entry['my_rating'] = my_ratings[podcast_id]
            ratings_payload[podcast_id] = rating_entry

        return jsonify({
            'ratings': ratings_payload,
            'generated_at': datetime.now().isoformat()
        }), 200
    except Exception as e:
        print(f"Error getting podcast ratings: {e}", file=sys.stderr)
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/export.csv', methods=['GET'])
def export_csv():
    """
    Export raw events as CSV for archival.
    Protected by admin token — raw data should not be publicly accessible.
    Optional query param: days (e.g., 1, 7, 30, 90, 365, or "all").
    """
    authorized, error_resp = require_admin_token()
    if not authorized:
        resp, status_code = error_resp
        return resp, status_code

    try:
        conn = get_db()
        c = conn.cursor()

        days_param = request.args.get('days', '30').strip().lower()
        days_value = None
        if days_param != 'all':
            try:
                days_value = max(1, int(days_param))
            except ValueError:
                days_value = 30

        where_clauses = []
        params = []
        if days_value is not None:
            since_date = (datetime.now() - timedelta(days=days_value)).strftime('%Y-%m-%d')
            where_clauses.append('date >= ?')
            params.append(since_date)

        exclude_debug_versions = _is_truthy_query_flag(request.args.get('exclude_debug', '0'))
        if exclude_debug_versions:
            where_clauses.append("(app_version IS NULL OR LOWER(app_version) NOT LIKE '%debug%')")

        where_filter = ''
        if where_clauses:
            where_filter = ' WHERE ' + ' AND '.join(where_clauses)

        c.execute(f'''
            SELECT
                id,
                event_type,
                station_id,
                station_name,
                podcast_id,
                podcast_title,
                episode_id,
                episode_title,
                date,
                timestamp,
                app_version,
                platform
            FROM events
            {where_filter}
            ORDER BY id DESC
        ''', params)

        fetched_rows = c.fetchall()

        # Sort by parsed event datetime so newest events are always first.
        def _row_sort_key(row):
            _, _, dt = _extract_event_datetime_parts(row['date'], row['timestamp'])
            has_dt = 1 if dt else 0
            return (has_dt, dt or datetime.min, row['id'])

        fetched_rows = sorted(fetched_rows, key=_row_sort_key, reverse=True)

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            'event_type',
            'station_id',
            'station_name',
            'podcast_id',
            'podcast_title',
            'episode_id',
            'episode_title',
            'date_utc',
            'time_utc',
            'app_version',
            'platform'
        ])
        for row in fetched_rows:
            row_dict = _normalise_station_result_row(dict(row))
            date_part, time_part, dt = _extract_event_datetime_parts(row['date'], row['timestamp'])

            writer.writerow([
                row_dict['event_type'],
                row_dict['station_id'],
                row_dict['station_name'],
                row_dict['podcast_id'],
                row_dict['podcast_title'],
                row_dict['episode_id'],
                row_dict['episode_title'],
                date_part,
                time_part,
                row_dict['app_version'],
                row_dict['platform']
            ])

        conn.close()
        csv_data = output.getvalue()
        output.close()

        return Response(
            csv_data,
            mimetype='text/csv',
            headers={
                'Content-Disposition': 'attachment; filename=analytics_export.csv'
            }
        )
    except Exception as e:
        print(f"Error exporting CSV: {e}", file=sys.stderr)
        return jsonify({'error': 'Internal server error'}), 500


# ── Podcast Index Endpoints ────────────────────────────────────────────────────

@app.route('/index/status', methods=['GET'])
def index_status():
    """
    Return the current state of the server-side podcast index.

    Response:
        {
            "podcast_count": <int>,
            "episode_count": <int>,
            "last_updated": "<ISO 8601 string or null>"
        }
    """
    try:
        conn = get_podcast_index_db()
        c = conn.cursor()
        c.execute('SELECT COUNT(*) AS n FROM podcast_fts')
        podcast_count = c.fetchone()['n']
        c.execute('SELECT COUNT(*) AS n FROM episode_meta')
        episode_count = c.fetchone()['n']
        c.execute("SELECT value FROM index_meta WHERE key = 'last_updated'")
        row = c.fetchone()
        last_updated = row['value'] if row else None
        conn.close()

        server_counts = {
            'podcast_count': podcast_count,
            'episode_count': episode_count,
            'last_updated': last_updated
        }
        effective = _resolve_index_display_status(server_counts)

        return jsonify({
            'podcast_count': effective['podcast_count'],
            'episode_count': effective['episode_count'],
            'last_updated': effective['last_updated'],
            'source': effective['source'],
            'server_index': server_counts
        }), 200
    except Exception as e:
        print(f"Error getting index status: {e}", file=sys.stderr)
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/index/podcasts', methods=['POST'])
def index_podcasts():
    """
    Receive a batch of podcast records from the app and store them in the
    server-side FTS index. Protected by admin token.

    Expected JSON body:
        [
            {"id": "p00tgwjb", "title": "Desert Island Discs", "description": "..."},
            ...
        ]
    """
    authorized, error_resp = require_admin_token()
    if not authorized:
        resp, status_code = error_resp
        return resp, status_code

    try:
        data = request.get_json()
        if not isinstance(data, list):
            return jsonify({'error': 'Expected a JSON array of podcast objects'}), 400

        conn = get_podcast_index_db()
        c = conn.cursor()
        inserted = 0
        for item in data:
            pid = item.get('id', '').strip()
            title = item.get('title', '')
            description = item.get('description', '')
            if not pid:
                continue
            # Delete-then-insert is the standard FTS4 upsert pattern
            c.execute('DELETE FROM podcast_fts WHERE podcastId = ?', (pid,))
            c.execute(
                'INSERT INTO podcast_fts(podcastId, title, description) VALUES (?, ?, ?)',
                (pid, title, description)
            )
            inserted += 1

        _touch_index_meta(c)
        conn.commit()
        conn.close()
        print(f"[{datetime.now().isoformat()}] INDEX podcasts inserted/updated={inserted}")
        return jsonify({'status': 'ok', 'inserted': inserted}), 200
    except Exception as e:
        print(f"Error indexing podcasts: {e}", file=sys.stderr)
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/index/episodes', methods=['POST'])
def index_episodes():
    """
    Receive a batch of episode records from the app and store them in the
    server-side FTS index. Protected by admin token.

    Expected JSON body:
        {
            "podcastId": "p00tgwjb",
            "episodes": [
                {
                    "id": "p0abc123",
                    "title": "Episode title",
                    "description": "...",
                    "pubDate": "Mon, 01 Jan 2024 00:00:00 +0000",
                    "pubEpoch": 1704067200000
                },
                ...
            ]
            }
    """
    authorized, error_resp = require_admin_token()
    if not authorized:
        resp, status_code = error_resp
        return resp, status_code

    try:
        data = request.get_json()
        if not isinstance(data, dict):
            return jsonify({'error': 'Expected a JSON object with podcastId and episodes'}), 400

        podcast_id = data.get('podcastId', '').strip()
        episodes = data.get('episodes', [])
        if not podcast_id:
            return jsonify({'error': 'podcastId is required'}), 400
        if not isinstance(episodes, list):
            return jsonify({'error': 'episodes must be a list'}), 400

        conn = get_podcast_index_db()
        c = conn.cursor()

        # Fetch already-indexed episode IDs for this podcast to avoid duplicates
        c.execute('SELECT episodeId FROM episode_fts WHERE podcastId = ?', (podcast_id,))
        existing_ids = {row['episodeId'] for row in c.fetchall()}

        inserted = 0
        for ep in episodes:
            eid = ep.get('id', '').strip()
            if not eid or eid in existing_ids:
                continue
            title = ep.get('title', '')
            description = ep.get('description', '')
            pub_date = ep.get('pubDate', '')
            pub_epoch = ep.get('pubEpoch', 0)
            c.execute(
                'INSERT INTO episode_fts(episodeId, podcastId, title, description) VALUES (?, ?, ?, ?)',
                (eid, podcast_id, title, description)
            )
            c.execute(
                'INSERT OR REPLACE INTO episode_meta(episodeId, podcastId, pubDate, pubEpoch) '
                'VALUES (?, ?, ?, ?)',
                (eid, podcast_id, pub_date, pub_epoch)
            )
            inserted += 1

        _touch_index_meta(c)
        conn.commit()
        conn.close()
        return jsonify({'status': 'ok', 'inserted': inserted}), 200
    except Exception as e:
        print(f"Error indexing episodes: {e}", file=sys.stderr)
        return jsonify({'error': 'Internal server error'}), 500


def _touch_index_meta(cursor):
    """Update the last_updated timestamp in index_meta."""
    cursor.execute(
        'INSERT OR REPLACE INTO index_meta(key, value) VALUES (?, ?)',
        ('last_updated', datetime.utcnow().isoformat() + 'Z')
    )


@app.route('/search/podcasts', methods=['GET'])
def search_podcasts():
    """
    Search the server-side podcast FTS index.

    Query parameters:
        q     - search query (required)
        limit - max results to return (default 50, max 200)

    Response:
        [{"podcastId": "...", "title": "...", "description": "..."}, ...]
    """
    q = request.args.get('q', '').strip()
    if not q:
        return jsonify([]), 200

    try:
        limit = min(int(request.args.get('limit', 50)), 200)
    except (ValueError, TypeError):
        limit = 50

    fts_query = _normalize_query(q)
    if not fts_query:
        return jsonify([]), 200

    try:
        conn = get_podcast_index_db()
        c = conn.cursor()
        results = []
        try:
            c.execute(
                'SELECT podcastId, title, description FROM podcast_fts '
                'WHERE podcast_fts MATCH ? LIMIT ?',
                (fts_query, limit)
            )
            results = [dict(row) for row in c.fetchall()]
        except Exception as fts_err:
            # FTS query failed (e.g. syntax error) — try individual tokens with LIKE as fallback
            print(f"FTS podcast search failed (query='{fts_query}'): {fts_err}", file=sys.stderr)
            tokens = [t for t in q.lower().split() if t]
            if tokens:
                like_pat = '%' + tokens[0] + '%'
                c.execute(
                    'SELECT podcastId, title, description FROM podcast_fts '
                    'WHERE LOWER(title) LIKE ? OR LOWER(description) LIKE ? LIMIT ?',
                    (like_pat, like_pat, limit)
                )
                results = [dict(row) for row in c.fetchall()]
        conn.close()
        return jsonify(results), 200
    except Exception as e:
        print(f"Error searching podcasts: {e}", file=sys.stderr)
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/search/episodes', methods=['GET'])
def search_episodes():
    """
    Search the server-side episode FTS index.

    Query parameters:
        q      - search query (required)
        limit  - max results to return (default 100, max 500)
        offset - pagination offset (default 0)

    Response:
        [{"episodeId": "...", "podcastId": "...", "title": "...",
          "description": "...", "pubDate": "..."}, ...]
    """
    q = request.args.get('q', '').strip()
    if not q:
        return jsonify([]), 200

    try:
        limit = min(int(request.args.get('limit', 100)), 500)
    except (ValueError, TypeError):
        limit = 100

    try:
        offset = max(0, int(request.args.get('offset', 0)))
    except (ValueError, TypeError):
        offset = 0

    fts_query = _normalize_query(q)
    if not fts_query:
        return jsonify([]), 200

    try:
        conn = get_podcast_index_db()
        c = conn.cursor()

        # Collect all matching episode IDs (lean scan)
        id_to_podcast = {}
        try:
            c.execute(
                'SELECT episodeId, podcastId FROM episode_fts WHERE episode_fts MATCH ?',
                (fts_query,)
            )
            for row in c.fetchall():
                eid = row['episodeId']
                if eid not in id_to_podcast:
                    id_to_podcast[eid] = row['podcastId']
        except Exception as fts_err:
            print(f"FTS episode search failed (query='{fts_query}'): {fts_err}", file=sys.stderr)
            # Fallback: LIKE on title for single-token queries only
            tokens = [t for t in q.lower().split() if t]
            if len(tokens) == 1:
                like_pat = '%' + tokens[0] + '%'
                c.execute(
                    'SELECT episodeId, podcastId FROM episode_fts '
                    'WHERE LOWER(title) LIKE ? LIMIT 500',
                    (like_pat,)
                )
                for row in c.fetchall():
                    eid = row['episodeId']
                    if eid not in id_to_podcast:
                        id_to_podcast[eid] = row['podcastId']

        if not id_to_podcast:
            conn.close()
            return jsonify([]), 200

        # Sort by pubEpoch DESC, paginate
        all_ids = list(id_to_podcast.keys())
        placeholders = ','.join('?' * len(all_ids))
        c.execute(
            f'SELECT episodeId, pubEpoch, pubDate FROM episode_meta '
            f'WHERE episodeId IN ({placeholders})',
            all_ids
        )
        pub_data = {row['episodeId']: (row['pubEpoch'] or 0, row['pubDate'] or '')
                    for row in c.fetchall()}

        sorted_ids = sorted(all_ids, key=lambda eid: pub_data.get(eid, (0, ''))[0], reverse=True)
        page_ids = sorted_ids[offset: offset + limit]

        if not page_ids:
            conn.close()
            return jsonify([]), 200

        # Fetch title + description only for this page
        ph2 = ','.join('?' * len(page_ids))
        c.execute(
            f'SELECT episodeId, title, description FROM episode_fts WHERE episodeId IN ({ph2})',
            page_ids
        )
        meta = {row['episodeId']: (row['title'] or '', row['description'] or '')
                for row in c.fetchall()}

        conn.close()
        results = []
        for eid in page_ids:
            title, desc = meta.get(eid, ('', ''))
            _, pub_date = pub_data.get(eid, (0, ''))
            results.append({
                'episodeId': eid,
                'podcastId': id_to_podcast[eid],
                'title': title,
                'description': desc,
                'pubDate': pub_date
            })
        return jsonify(results), 200
    except Exception as e:
        print(f"Error searching episodes: {e}", file=sys.stderr)
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/health/api', methods=['GET'])
def health_api():
    """JSON health API with Pi system metrics."""
    try:
        return jsonify({
            'status': 'ok',
            'timestamp': datetime.now().isoformat(),
            'uptime': _get_uptime(),
            'cpu_percent': _get_cpu_usage(),
            'memory': _get_memory_usage(),
            'disk': _get_disk_usage(),
            'temperature_c': _get_cpu_temperature(),
            'services': _get_service_status()
        }), 200
    except Exception as e:
        return jsonify({'status': 'error', 'error': str(e)}), 500


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint - returns JSON for API clients, HTML dashboard for browsers."""
    accept = request.headers.get('Accept', '')
    if 'text/html' in accept and 'application/json' not in accept:
        return _render_health_dashboard()
    return jsonify({'status': 'ok', 'timestamp': datetime.now().isoformat()}), 200


def _render_health_dashboard():
    """Render mobile-friendly Pi health dashboard HTML."""
    try:
        html = """
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <meta name="apple-mobile-web-app-capable" content="yes">
            <meta name="mobile-web-app-capable" content="yes">
            <title>Pi Health — British Radio Player</title>
            <style>
                * { box-sizing: border-box; }
                html, body { margin: 0; padding: 0; }
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f6f7f9; color: #1f2328; min-height: 100vh; }
                .container { max-width: 500px; margin: 0 auto; padding: 16px; }
                h1 { margin: 0 0 4px 0; font-size: 22px; }
                .subtitle { color: #6b7280; font-size: 13px; margin: 0 0 16px 0; }
                .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
                .status-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 6px; }
                .status-dot.green { background: #22c55e; box-shadow: 0 0 6px rgba(34,197,94,0.5); }
                .status-dot.yellow { background: #eab308; box-shadow: 0 0 6px rgba(234,179,8,0.5); }
                .status-dot.red { background: #ef4444; box-shadow: 0 0 6px rgba(239,68,68,0.5); }
                .status-dot.gray { background: #9ca3af; }
                .panel { background: #ffffff; border: 1px solid #e6e8eb; border-radius: 12px; padding: 14px; box-shadow: 0 2px 8px rgba(31,35,40,0.06); margin-bottom: 12px; }
                .panel h3 { margin: 0 0 10px 0; font-size: 14px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.04em; }
                .stat-row { display: flex; align-items: center; justify-content: space-between; padding: 6px 0; }
                .stat-row + .stat-row { border-top: 1px solid #f0f1f3; }
                .stat-label { font-size: 14px; color: #444; }
                .stat-value { font-size: 14px; font-weight: 600; color: #1f2328; }
                .progress-bar { height: 6px; background: #e5e7eb; border-radius: 3px; overflow: hidden; margin-top: 6px; }
                .progress-bar .fill { height: 100%; border-radius: 3px; transition: width 0.5s ease; }
                .progress-bar .fill.green { background: #22c55e; }
                .progress-bar .fill.yellow { background: #eab308; }
                .progress-bar .fill.red { background: #ef4444; }
                .service-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; }
                .service-row + .service-row { border-top: 1px solid #f0f1f3; }
                .service-name { font-size: 14px; color: #1f2328; }
                .service-status { font-size: 12px; display: flex; align-items: center; }
                .service-meta { font-size: 11px; color: #9ca3af; margin-top: 2px; }
                .last-updated { text-align: center; color: #9ca3af; font-size: 11px; margin-top: 12px; }
                .back-link { text-align: center; margin-top: 8px; }
                .back-link a { color: #0066cc; text-decoration: none; font-size: 13px; }
                .temp-warn { color: #eab308; }
                .temp-danger { color: #ef4444; }

                @media (prefers-color-scheme: dark) {
                    body { background: #1a1a1a; color: #e0e0e0; }
                    h1 { color: #f0f0f0; }
                    .subtitle { color: #a0a0a0; }
                    .panel { background: #252525; border-color: #3a3a3a; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
                    .panel h3 { color: #a0a0a0; }
                    .stat-label { color: #d0d0d0; }
                    .stat-value { color: #e0e0e0; }
                    .progress-bar { background: #3a3a3a; }
                    .service-name { color: #e0e0e0; }
                    .service-meta { color: #6b6b6b; }
                    .back-link a { color: #64b5f6; }
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <div>
                        <h1>Pi Health</h1>
                        <p class="subtitle">British Radio Player — Raspberry Pi</p>
                    </div>
                    <div id="overallStatus">
                        <span class="status-dot gray"></span><span style="font-size:13px;color:#6b7280;">Loading…</span>
                    </div>
                </div>

                <div class="panel">
                    <h3>System</h3>
                    <div class="stat-row">
                        <span class="stat-label">Uptime</span>
                        <span class="stat-value" id="uptime">—</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Temperature</span>
                        <span class="stat-value" id="temp">—</span>
                    </div>
                </div>

                <div class="panel">
                    <h3>CPU</h3>
                    <div class="stat-row">
                        <span class="stat-label">Usage</span>
                        <span class="stat-value" id="cpuValue">—</span>
                    </div>
                    <div class="progress-bar"><div class="fill green" id="cpuBar" style="width:0%"></div></div>
                </div>

                <div class="panel">
                    <h3>Memory</h3>
                    <div class="stat-row">
                        <span class="stat-label">Used</span>
                        <span class="stat-value" id="memValue">—</span>
                    </div>
                    <div class="progress-bar"><div class="fill green" id="memBar" style="width:0%"></div></div>
                </div>

                <div class="panel">
                    <h3>Disk</h3>
                    <div class="stat-row">
                        <span class="stat-label">Used</span>
                        <span class="stat-value" id="diskValue">—</span>
                    </div>
                    <div class="progress-bar"><div class="fill green" id="diskBar" style="width:0%"></div></div>
                </div>

                <div class="panel">
                    <h3>Services</h3>
                    <div id="servicesList"></div>
                </div>

                <p class="last-updated" id="lastUpdated"></p>

                <div class="back-link">
                    <a href="/">Back to Analytics Dashboard</a>
                </div>
            </div>

            <script>
                const REFRESH_INTERVAL = 30000;

                function colorForPercent(pct) {
                    if (pct >= 90) return 'red';
                    if (pct >= 75) return 'yellow';
                    return 'green';
                }

                function colorForTemp(tempC) {
                    if (tempC === null || tempC === undefined) return '';
                    if (tempC >= 80) return 'temp-danger';
                    if (tempC >= 60) return 'temp-warn';
                    return '';
                }

                function formatServiceName(key) {
                    const names = {
                        analytics_server: 'Analytics Server',
                        search_server: 'Search Server',
                        index_builder_timer: 'Index Builder',
                        popular_export_timer: 'Popular Export'
                    };
                    return names[key] || key;
                }

                function renderService(key, info) {
                    const isActive = info.status === 'active';
                    const dotClass = isActive ? 'green' : (info.status === 'unavailable' || info.status === 'unknown' ? 'gray' : 'red');
                    const statusText = isActive ? 'Running' : (info.status || 'Unknown');
                    let meta = '';
                    if (info.port) meta += 'Port ' + info.port;
                    if (info.next_run && info.next_run !== 'n/a') {
                        const next = new Date(info.next_run);
                        if (!isNaN(next)) meta += (meta ? ' · ' : '') + 'Next: ' + next.toLocaleTimeString();
                    }
                    return '<div class="service-row">' +
                        '<span class="service-name">' + formatServiceName(key) + '</span>' +
                        '<span class="service-status">' +
                            '<span class="status-dot ' + dotClass + '"></span>' +
                            statusText +
                        '</span>' +
                        '</div>' +
                        (meta ? '<div class="service-meta" style="margin-top:-4px;padding-left:16px;">' + meta + '</div>' : '');
                }

                function render(data) {
                    const statusDot = document.getElementById('overallStatus');
                    const servicesOk = data.services && Object.values(data.services).every(s => s.status === 'active');
                    statusDot.innerHTML = '<span class="status-dot ' + (servicesOk ? 'green' : 'red') + '"></span><span style="font-size:13px;color:#6b7280;">' + (servicesOk ? 'All OK' : 'Issue Detected') + '</span>';

                    document.getElementById('uptime').textContent = data.uptime || '—';

                    const temp = data.temperature_c;
                    const tempEl = document.getElementById('temp');
                    if (temp !== null && temp !== undefined) {
                        tempEl.innerHTML = '<span class="' + colorForTemp(temp) + '">' + temp + '°C</span>';
                    } else {
                        tempEl.textContent = '—';
                    }

                    const cpu = data.cpu_percent;
                    if (cpu !== null && cpu !== undefined) {
                        document.getElementById('cpuValue').textContent = cpu + '%';
                        const cpuBar = document.getElementById('cpuBar');
                        cpuBar.style.width = cpu + '%';
                        cpuBar.className = 'fill ' + colorForPercent(cpu);
                    }

                    const mem = data.memory;
                    if (mem && mem.percent !== null) {
                        document.getElementById('memValue').textContent = mem.used_mb + ' / ' + mem.total_mb + ' MB (' + mem.percent + '%)';
                        const memBar = document.getElementById('memBar');
                        memBar.style.width = mem.percent + '%';
                        memBar.className = 'fill ' + colorForPercent(mem.percent);
                    }

                    const disk = data.disk;
                    if (disk && disk.percent !== null) {
                        document.getElementById('diskValue').textContent = disk.used_gb + ' / ' + disk.total_gb + ' GB (' + disk.percent + '%)';
                        const diskBar = document.getElementById('diskBar');
                        diskBar.style.width = disk.percent + '%';
                        diskBar.className = 'fill ' + colorForPercent(disk.percent);
                    }

                    const services = data.services || {};
                    const listEl = document.getElementById('servicesList');
                    listEl.innerHTML = Object.entries(services).map(([k, v]) => renderService(k, v)).join('');

                    const now = new Date();
                    document.getElementById('lastUpdated').textContent = 'Updated ' + now.toLocaleTimeString();
                }

                async function fetchHealth() {
                    try {
                        const res = await fetch('/health/api');
                        const data = await res.json();
                        render(data);
                    } catch (err) {
                        console.error('Failed to fetch health data:', err);
                        document.getElementById('lastUpdated').textContent = 'Update failed';
                    }
                }

                fetchHealth();
                setInterval(fetchHealth, REFRESH_INTERVAL);
            </script>
        </body>
        </html>
        """
        return html, 200, {'Content-Type': 'text/html; charset=utf-8'}
    except Exception as e:
        print(f"Error rendering health dashboard: {e}", file=sys.stderr)
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/', methods=['GET'])
def index():
    """
    Simple status page.
    """
    try:
        conn = get_db()
        c = conn.cursor()
        c.execute('SELECT COUNT(*) as count FROM events')
        total_events = c.fetchone()['count']
        conn.close()

        # Podcast index stats
        try:
            idx_conn = get_podcast_index_db()
            idx_c = idx_conn.cursor()
            idx_c.execute('SELECT COUNT(*) AS n FROM podcast_fts')
            local_podcast_count = idx_c.fetchone()['n']
            idx_c.execute('SELECT COUNT(*) AS n FROM episode_meta')
            local_episode_count = idx_c.fetchone()['n']
            idx_c.execute("SELECT value FROM index_meta WHERE key = 'last_updated'")
            row = idx_c.fetchone()
            local_last_updated = row['value'] if row else None
            idx_conn.close()

            server_counts = {
                'podcast_count': local_podcast_count,
                'episode_count': local_episode_count,
                'last_updated': local_last_updated
            }
            effective = _resolve_index_display_status(server_counts)

            podcast_count = effective['podcast_count']
            episode_count = effective['episode_count']
            last_updated = effective['last_updated'] or 'never'
            last_updated = _format_human_timestamp(last_updated)
            index_source = effective['source']
        except Exception:
            podcast_count = 0
            episode_count = 0
            last_updated = 'unavailable'
            index_source = 'unavailable'

        # App-facing top podcasts snapshot freshness (GCS popular-podcasts.json)
        try:
            top20_snapshot = _read_cloud_popular_snapshot_meta()
            if top20_snapshot:
                app_top20_last_refreshed = top20_snapshot['generated_at'] or 'unknown'
                app_top20_last_refreshed = _format_human_timestamp(app_top20_last_refreshed)
                app_top20_snapshot_count = top20_snapshot['snapshot_count']
                app_top20_source = 'gcp_popular_snapshot'
            else:
                app_top20_last_refreshed = 'unavailable'
                app_top20_snapshot_count = 0
                app_top20_source = 'unavailable'
        except Exception:
            app_top20_last_refreshed = 'unavailable'
            app_top20_snapshot_count = 0
            app_top20_source = 'unavailable'
        
        html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>British Radio Player</title>
            <style>
                * {{ box-sizing: border-box; }}
                html, body {{ margin: 0; padding: 0; }}
                body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f6f7f9; color: #1f2328; }}
                .container {{ max-width: 1100px; margin: 0 auto; padding: 16px; }}
                h1 {{ color: #333; margin: 0 0 8px 0; font-size: 24px; }}
                h3 {{ margin: 0 0 12px 0; font-size: 16px; }}
                p {{ color: #666; line-height: 1.6; margin: 0; }}
                code {{ background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }}
                a {{ color: #0066cc; text-decoration: none; }}
                a:hover {{ text-decoration: underline; }}
                .header {{ display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }}
                .header > div:first-child {{ flex: 1; min-width: 0; }}
                .badge {{ background: #e7f3ff; color: #004a99; padding: 6px 10px; border-radius: 999px; font-size: 11px; white-space: nowrap; }}
                .panel {{ background: #ffffff; border: 1px solid #e6e8eb; border-radius: 12px; padding: 16px; box-shadow: 0 2px 8px rgba(31,35,40,0.06); margin-bottom: 16px; }}
                .panels {{ display: grid; grid-template-columns: 1fr; gap: 16px; margin: 16px 0 24px; }}
                .filters {{ display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }}
                .filters button {{ border: 1px solid #cfd4d9; background: #fff; border-radius: 10px; padding: 8px 12px; cursor: pointer; font-size: 13px; }}
                .filters button.active {{ border-color: #1f6feb; background: #e7f0ff; color: #0b4db7; font-weight: 600; }}
                .toggle-row {{ display: flex; align-items: center; gap: 8px; margin-top: 12px; }}
                .toggle-row input {{ width: 16px; height: 16px; }}
                .toggle-row label {{ font-size: 13px; color: #444; cursor: pointer; }}
                .table-wrapper {{ overflow-x: auto; margin-top: 8px; }}
                table {{ width: 100%; border-collapse: collapse; }}
                th, td {{ text-align: left; padding: 8px 10px; border-bottom: 1px solid #eef1f4; }}
                th {{ font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: #6b7280; }}
                .muted {{ color: #6b7280; font-size: 12px; }}
                .footer {{ margin-top: 24px; color: #6b7280; font-size: 12px; }}
                
                /* Tablet and desktop */
                @media (min-width: 640px) {{
                    .container {{ padding: 24px; }}
                    h1 {{ font-size: 28px; }}
                    .filters button {{ padding: 10px 14px; font-size: 14px; }}
                }}
                
                @media (min-width: 768px) {{
                    .container {{ padding: 32px; }}
                    .panels {{ grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }}
                }}
                
                /* Dark mode support */
                @media (prefers-color-scheme: dark) {{
                    body {{ background: #1a1a1a; color: #e0e0e0; }}
                    h1 {{ color: #f0f0f0; }}
                    p {{ color: #b0b0b0; }}
                    code {{ background: #2a2a2a; color: #e0e0e0; }}
                    a {{ color: #64b5f6; }}
                    a:hover {{ text-decoration: underline; }}
                    .badge {{ background: #1a3a52; color: #64b5f6; }}
                    .panel {{ background: #252525; border-color: #3a3a3a; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }}
                    .filters button {{ border-color: #404040; background: #2a2a2a; color: #e0e0e0; }}
                    .filters button.active {{ border-color: #64b5f6; background: #1a3a52; color: #64b5f6; }}
                    .toggle-row label {{ color: #d0d0d0; }}
                    th {{ color: #a0a0a0; }}
                    td {{ border-bottom-color: #333; }}
                    .muted {{ color: #a0a0a0; }}
                }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <div>
                        <h1>British Radio Player</h1>
                        <p class="muted">Privacy-respecting, anonymous popularity analytics.</p>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                        <div class="badge">Total events: {total_events}</div>
                        <a href="/health" style="display:inline-block;background:#22c55e;color:#fff;padding:6px 12px;border-radius:999px;font-size:11px;font-weight:600;text-decoration:none;">Pi Health</a>
                    </div>
                </div>

                <div class="panel">
                    <div class="filters" id="filters">
                        <button data-days="1">Last 24h</button>
                        <button data-days="7">7 days</button>
                        <button data-days="30" class="active">30 days</button>
                        <button data-days="90">90 days</button>
                        <button data-days="365">1 year</button>
                        <button data-days="all">All time</button>
                    </div>
                    <div class="muted" id="rangeLabel">Showing last 30 days</div>
                    <div class="toggle-row">
                        <input type="checkbox" id="excludeDebugToggle" />
                        <label for="excludeDebugToggle">Exclude debug app versions from analytics</label>
                    </div>
                    <div style="margin-top: 10px;">
                        <a id="exportCsv" href="/export.csv?days=30">Download CSV for this range</a>
                    </div>
                </div>

                <div class="panels">
                    <div class="panel">
                        <h3>Top 20 Stations</h3>
                        <div class="table-wrapper">
                            <table id="stationsTable">
                                <thead><tr><th>Station</th><th>Plays</th></tr></thead>
                                <tbody></tbody>
                            </table>
                        </div>
                        <p class="muted" style="margin-top: 8px; font-size: 13px;">Showing top 20. Download the CSV for the full list.</p>
                    </div>
                    <div class="panel">
                        <h3>Top 30 Podcasts</h3>
                        <div class="table-wrapper">
                            <table id="podcastsTable">
                                <thead><tr><th>Podcast</th><th>Plays</th></tr></thead>
                                <tbody></tbody>
                            </table>
                        </div>
                        <p class="muted" style="margin-top: 8px; font-size: 13px;">Showing top 30. Download the CSV for the full list.</p>
                    </div>
                    <div class="panel">
                        <h3>Top 20 Episodes</h3>
                        <div class="table-wrapper">
                            <table id="episodesTable">
                                <thead><tr><th>Episode</th><th>Podcast</th><th>Plays</th></tr></thead>
                                <tbody></tbody>
                            </table>
                        </div>
                        <p class="muted" style="margin-top: 8px; font-size: 13px;">Showing top 20. Download the CSV for the full list.</p>
                    </div>
                </div>

                <div class="panel">
                    <h3>Podcast Search Index</h3>
                    <p class="muted">Server-side FTS index used by the app for searches (no local index needed on device).</p>
                    <div style="margin-top: 10px;">
                        <strong>{podcast_count}</strong> podcasts &nbsp;·&nbsp;
                        <strong>{episode_count}</strong> episodes &nbsp;·&nbsp;
                        Last updated: <code>{last_updated}</code> &nbsp;·&nbsp;
                        Source: <code>{index_source}</code>
                    </div>
                </div>

                <div class="panel">
                    <h3>App Top 30 Podcasts Refresh</h3>
                    <p class="muted">Refresh time of the cloud snapshot the app uses for fast "Most popular" rankings.</p>
                    <div style="margin-top: 10px;">
                        Last refreshed: <code>{app_top20_last_refreshed}</code> &nbsp;·&nbsp;
                        Snapshot items: <strong>{app_top20_snapshot_count}</strong> &nbsp;·&nbsp;
                        Source: <code>{app_top20_source}</code>
                    </div>
                </div>

                <div class="panel">
                    <h3>API Endpoints</h3>
                    <p><code>POST /event</code> - Accept analytics events from the app</p>
                    <p><code>GET /stats</code> - Get aggregated statistics (use <code>?days=7</code> or <code>?days=all</code>)</p>
                    <p><code>GET /health</code> - Health check</p>
                    <p><code>GET /export.csv</code> - Download CSV archive (use <code>?days=30</code> or <code>?days=all</code>)</p>
                    <p style="margin-top: 8px;"><strong>Podcast Index:</strong></p>
                    <p><code>GET /index/status</code> - Podcast index statistics</p>
                    <p><code>POST /index/podcasts</code> - Submit podcast records to the index</p>
                    <p><code>POST /index/episodes</code> - Submit episode records to the index</p>
                    <p><code>GET /search/podcasts?q=...</code> - Search podcasts</p>
                    <p><code>GET /search/episodes?q=...</code> - Search episodes</p>
                </div>

                <div class="footer">
                    Data is anonymous and aggregated. No IPs or identifiers are stored.<br />
                    Source Code: <a href="https://github.com/hyliankid14/British-Radio-Player">github.com/hyliankid14/British-Radio-Player</a>
                </div>
            </div>

            <script>
                const DEBUG_TOGGLE_STORAGE_KEY = 'analytics.excludeDebugVersions';

                function formatRange(days) {{
                    if (days === 'all') return 'Showing all time';
                    if (days === '1') return 'Showing last 24 hours';
                    return 'Showing last ' + days + ' days';
                }}

                function getExcludeDebugToggle() {{
                    return document.getElementById('excludeDebugToggle');
                }}

                function getExcludeDebugState() {{
                    const toggle = getExcludeDebugToggle();
                    return Boolean(toggle && toggle.checked);
                }}

                function setExcludeDebugState(value) {{
                    const toggle = getExcludeDebugToggle();
                    if (!toggle) return;
                    toggle.checked = Boolean(value);
                }}

                function getStoredExcludeDebugState() {{
                    try {{
                        return localStorage.getItem(DEBUG_TOGGLE_STORAGE_KEY) === '1';
                    }} catch (_) {{
                        return false;
                    }}
                }}

                function storeExcludeDebugState(value) {{
                    try {{
                        localStorage.setItem(DEBUG_TOGGLE_STORAGE_KEY, value ? '1' : '0');
                    }} catch (_) {{
                        // Ignore storage failures (e.g. private browsing restrictions).
                    }}
                }}

                function activeDaysSelection() {{
                    const active = document.querySelector('#filters button.active');
                    return active ? active.dataset.days : '30';
                }}

                function renderTable(tableId, rows, columns) {{
                    const tbody = document.querySelector('#' + tableId + ' tbody');
                    tbody.innerHTML = '';
                    if (!rows.length) {{
                        const tr = document.createElement('tr');
                        const td = document.createElement('td');
                        td.colSpan = columns.length;
                        td.className = 'muted';
                        td.textContent = 'No data for this range.';
                        tr.appendChild(td);
                        tbody.appendChild(tr);
                        return;
                    }}
                    rows.forEach(row => {{
                        const tr = document.createElement('tr');
                        columns.forEach(col => {{
                            const td = document.createElement('td');
                            td.textContent = row[col] ?? '';
                            tr.appendChild(td);
                        }});
                        tbody.appendChild(tr);
                    }});
                }}

                function setExportLink(days, excludeDebug) {{
                    const link = document.getElementById('exportCsv');
                    if (!link) return;
                    const params = new URLSearchParams({{ days: String(days) }});
                    if (excludeDebug) {{
                        params.set('exclude_debug', '1');
                    }}
                    link.href = '/export.csv?' + params.toString();
                }}

                async function loadStats(days, excludeDebug) {{
                    const params = new URLSearchParams({{ days: String(days) }});
                    if (excludeDebug) {{
                        params.set('exclude_debug', '1');
                    }}
                    const res = await fetch('/stats?' + params.toString());
                    const data = await res.json();
                    document.getElementById('rangeLabel').textContent = formatRange(String(days));
                    setExportLink(days, excludeDebug);
                    renderTable('stationsTable', data.popular_stations || [], ['name', 'plays']);
                    renderTable('podcastsTable', data.popular_podcasts || [], ['name', 'plays']);
                    renderTable('episodesTable', data.popular_episodes || [], ['name', 'podcast_name', 'plays']);
                }}

                const buttons = document.querySelectorAll('#filters button');
                buttons.forEach(btn => {{
                    btn.addEventListener('click', () => {{
                        buttons.forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        loadStats(btn.dataset.days, getExcludeDebugState());
                    }});
                }});

                const excludeDebugToggle = getExcludeDebugToggle();
                setExcludeDebugState(getStoredExcludeDebugState());
                if (excludeDebugToggle) {{
                    excludeDebugToggle.addEventListener('change', () => {{
                        const enabled = getExcludeDebugState();
                        storeExcludeDebugState(enabled);
                        loadStats(activeDaysSelection(), enabled);
                    }});
                }}

                loadStats('30', getExcludeDebugState());
            </script>
        </body>
        </html>
        """
        return html, 200, {'Content-Type': 'text/html; charset=utf-8'}
    except Exception as e:
        print(f"Error rendering dashboard: {e}", file=sys.stderr)
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/admin/events', methods=['DELETE'])
def admin_delete_events():
    """
    Delete analytics events matching the supplied filter criteria.

    Requires the X-Admin-Secret header to match the ADMIN_SECRET environment
    variable configured on the server.  Returns 503 if ADMIN_SECRET is unset.

    JSON body (all optional, combined with AND):
        {
            "podcast_title_contains": "The Naked Week",
            "platform": "wear",
            "event_type": "episode_play"
        }

    Returns:
        {"status": "ok", "deleted": <int>}
    """
    admin_secret = os.environ.get('ADMIN_SECRET', '').strip()
    if not admin_secret:
        return jsonify({'error': 'Admin access is not configured on this server'}), 503

    if request.headers.get('X-Admin-Secret', '') != admin_secret:
        return jsonify({'error': 'Forbidden'}), 403

    try:
        data = request.get_json() or {}
        conditions = []
        params = []

        podcast_title_contains = data.get('podcast_title_contains', '').strip()
        if podcast_title_contains:
            conditions.append('podcast_title LIKE ?')
            params.append(f'%{podcast_title_contains}%')

        platform = data.get('platform', '').strip()
        if platform:
            conditions.append('platform = ?')
            params.append(platform)

        event_type = data.get('event_type', '').strip()
        if event_type:
            conditions.append('event_type = ?')
            params.append(event_type)

        if not conditions:
            return jsonify({'error': 'At least one filter criterion is required'}), 400

        where_clause = ' AND '.join(conditions)
        conn = get_db()
        c = conn.cursor()
        c.execute(f'DELETE FROM events WHERE {where_clause}', params)
        deleted = c.rowcount
        conn.commit()
        conn.close()

        print(f"[{datetime.now().isoformat()}] ADMIN_DELETE deleted={deleted} filter={data}")
        return jsonify({'status': 'ok', 'deleted': deleted}), 200
    except Exception as e:
        print(f"Error in admin_delete_events: {e}", file=sys.stderr)
        return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    # Initialize databases on startup
    init_db()
    init_podcast_index_db()
    
    print("""
    ╔═══════════════════════════════════════════════════════════════╗
    ║     British Radio Player Analytics Server v1.0                ║
    ║                                                               ║
    ║     Starting on http://localhost:5000                        ║
    ║                                                               ║
    ║     Privacy-Respecting ✓                                     ║
    ║     No IP Logging ✓                                          ║
    ║     No PII Storage ✓                                         ║
    ║     Privacy-first by design ✓                                ║
    ║                                                               ║
    ╚═══════════════════════════════════════════════════════════════╝
    """)
    
    # Run the app
    # For production, use: gunicorn -w 4 -b 0.0.0.0:5000 analytics_server:app
    app.run(host='0.0.0.0', port=5000, debug=False)
