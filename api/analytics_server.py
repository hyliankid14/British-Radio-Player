#!/usr/bin/env python3
"""
Simple F-Droid compliant analytics server for BBC Radio Player.

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
from datetime import datetime, timedelta
import sqlite3
import sys
import csv
import io
import logging
import re
import unicodedata
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

# Database paths
DB_PATH = Path(__file__).parent / 'analytics.db'
PODCAST_INDEX_DB_PATH = Path(__file__).parent / 'podcast_index.db'


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
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')

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
                    app_version
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                event_type,
                data.get('station_id'),
                data.get('station_name'),
                data.get('podcast_id'),
                data.get('episode_id'),
                data.get('podcast_title'),
                data.get('episode_title'),
                data['date'],
                data.get('app_version', '1.0.0-web')
            ))
            conn.commit()
            conn.close()

            print(
                f"[{datetime.now().isoformat()}] WEB_PLAYER "
                f"event={event_type} podcast={data.get('podcast_id')} episode={data.get('episode_id')} date={data['date']}"
            )
            
            return jsonify({'status': 'ok'}), 201
        
        # App source - maintain original strict validation
        station_id = data.get('station_id')
        station_name = data.get('station_name')
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
                app_version
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (event_type, station_id, station_name, podcast_id, episode_id, podcast_title, episode_title, date, app_version))
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

        # Most popular stations
        c.execute(f'''
            SELECT
                station_id AS id,
                COALESCE(NULLIF(MAX(station_name), ''), station_id) AS name,
                COUNT(*) as plays
            FROM events
            WHERE event_type = 'station_play'
            {date_filter}
            AND station_id IS NOT NULL
            GROUP BY station_id
            ORDER BY plays DESC
            LIMIT 20
        ''', params)
        popular_stations = [dict(row) for row in c.fetchall()]

        # Most popular podcasts (app + web player)
        c.execute(f'''
            SELECT
                podcast_id AS id,
                COALESCE(NULLIF(MAX(podcast_title), ''), podcast_id) AS name,
                COUNT(*) as plays
            FROM events
            WHERE (event_type IN ('episode_play', 'web_player_podcast_view', 'web_player_episode_view', 'web_player_audio_play'))
            {date_filter}
            AND podcast_id IS NOT NULL
            GROUP BY podcast_id
            ORDER BY plays DESC
            LIMIT 20
        ''', params)
        popular_podcasts = [dict(row) for row in c.fetchall()]

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
            AND episode_id IS NOT NULL
            GROUP BY episode_id, podcast_id
            ORDER BY plays DESC
            LIMIT 20
        ''', params)
        popular_episodes = [dict(row) for row in c.fetchall()]
        
        # Total events count by event type (all time)
        c.execute('''
            SELECT event_type, COUNT(*) as total
            FROM events
            GROUP BY event_type
        ''')
        event_totals = {row['event_type']: row['total'] for row in c.fetchall()}
        
        conn.close()
        
        return jsonify({
            'popular_stations': popular_stations,
            'popular_podcasts': popular_podcasts,
            'popular_episodes': popular_episodes,
            'event_totals': event_totals,
            'range_days': days_value if days_value is not None else 'all',
            'generated_at': datetime.now().isoformat()
        })
        
    except Exception as e:
        print(f"Error getting stats: {e}", file=sys.stderr)
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/export.csv', methods=['GET'])
def export_csv():
    """
    Export raw events as CSV for archival.
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
            date_filter = " WHERE date >= ?"
            params.append(since_date)

        c.execute(f'''
            SELECT
                event_type,
                station_id,
                station_name,
                podcast_id,
                podcast_title,
                episode_id,
                episode_title,
                date,
                app_version
            FROM events
            {date_filter}
            ORDER BY id DESC
        ''', params)

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
            'app_version'
        ])
        for row in c.fetchall():
            raw_date = row['date'] or ''
            date_part = raw_date
            time_part = ''
            if 'T' in raw_date:
                date_part, time_part = raw_date.split('T', 1)
                time_part = time_part.rstrip('Z')
            writer.writerow([
                row['event_type'],
                row['station_id'],
                row['station_name'],
                row['podcast_id'],
                row['podcast_title'],
                row['episode_id'],
                row['episode_title'],
                date_part,
                time_part,
                row['app_version']
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
        return jsonify({
            'podcast_count': podcast_count,
            'episode_count': episode_count,
            'last_updated': last_updated
        }), 200
    except Exception as e:
        print(f"Error getting index status: {e}", file=sys.stderr)
        return jsonify({'error': 'Internal server error'}), 500


@app.route('/index/podcasts', methods=['POST'])
def index_podcasts():
    """
    Receive a batch of podcast records from the app and store them in the
    server-side FTS index.

    Expected JSON body:
        [
            {"id": "p00tgwjb", "title": "Desert Island Discs", "description": "..."},
            ...
        ]
    """
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
    server-side FTS index.

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


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    return jsonify({'status': 'ok', 'timestamp': datetime.now().isoformat()}), 200


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
            podcast_count = idx_c.fetchone()['n']
            idx_c.execute('SELECT COUNT(*) AS n FROM episode_meta')
            episode_count = idx_c.fetchone()['n']
            idx_c.execute("SELECT value FROM index_meta WHERE key = 'last_updated'")
            row = idx_c.fetchone()
            last_updated = row['value'] if row else 'never'
            idx_conn.close()
        except Exception:
            podcast_count = 0
            episode_count = 0
            last_updated = 'unavailable'
        
        html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>BBC Radio Player Analytics Dashboard</title>
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
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <div>
                        <h1>BBC Radio Player Analytics</h1>
                        <p class="muted">Privacy-respecting, anonymous popularity analytics.</p>
                    </div>
                    <div class="badge">Total events: {total_events}</div>
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
                        <h3>Top 20 Podcasts</h3>
                        <div class="table-wrapper">
                            <table id="podcastsTable">
                                <thead><tr><th>Podcast</th><th>Plays</th></tr></thead>
                                <tbody></tbody>
                            </table>
                        </div>
                        <p class="muted" style="margin-top: 8px; font-size: 13px;">Showing top 20. Download the CSV for the full list.</p>
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
                        Last updated: <code>{last_updated}</code>
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
                    Source Code: <a href="https://github.com/hyliankid14/BBC-Radio-Player">github.com/hyliankid14/BBC-Radio-Player</a>
                </div>
            </div>

            <script>
                function formatRange(days) {{
                    if (days === 'all') return 'Showing all time';
                    if (days === '1') return 'Showing last 24 hours';
                    return 'Showing last ' + days + ' days';
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

                function setExportLink(days) {{
                    const link = document.getElementById('exportCsv');
                    if (!link) return;
                    link.href = '/export.csv?days=' + encodeURIComponent(days);
                }}

                async function loadStats(days) {{
                    const res = await fetch('/stats?days=' + encodeURIComponent(days));
                    const data = await res.json();
                    document.getElementById('rangeLabel').textContent = formatRange(String(days));
                    setExportLink(days);
                    renderTable('stationsTable', data.popular_stations || [], ['name', 'plays']);
                    renderTable('podcastsTable', data.popular_podcasts || [], ['name', 'plays']);
                    renderTable('episodesTable', data.popular_episodes || [], ['name', 'podcast_name', 'plays']);
                }}

                const buttons = document.querySelectorAll('#filters button');
                buttons.forEach(btn => {{
                    btn.addEventListener('click', () => {{
                        buttons.forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        loadStats(btn.dataset.days);
                    }});
                }});

                loadStats('30');
            </script>
        </body>
        </html>
        """
        return html, 200, {'Content-Type': 'text/html; charset=utf-8'}
    except Exception as e:
        print(f"Error rendering dashboard: {e}", file=sys.stderr)
        return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    # Initialize databases on startup
    init_db()
    init_podcast_index_db()
    
    print("""
    ╔═══════════════════════════════════════════════════════════════╗
    ║     BBC Radio Player Analytics Server v1.0                   ║
    ║                                                               ║
    ║     Starting on http://localhost:5000                        ║
    ║                                                               ║
    ║     Privacy-Respecting ✓                                     ║
    ║     No IP Logging ✓                                          ║
    ║     No PII Storage ✓                                         ║
    ║     F-Droid Compliant ✓                                      ║
    ║                                                               ║
    ╚═══════════════════════════════════════════════════════════════╝
    """)
    
    # Run the app
    # For production, use: gunicorn -w 4 -b 0.0.0.0:5000 analytics_server:app
    app.run(host='0.0.0.0', port=5000, debug=False)
