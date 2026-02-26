#!/usr/bin/env python3
"""
Simple F-Droid compliant analytics server for BBC Radio Player.

Self-hosted server for collecting anonymous, aggregated analytics data.
It does NOT store IP addresses or any PII.

Installation:
    pip install flask

Usage:
    python3 analytics_server.py

The server will start on http://localhost:5000

Configure in the app by setting:
    private const val ANALYTICS_ENDPOINT = "https://yourdomain.com/event"
"""

from flask import Flask, request, jsonify, Response
from datetime import datetime, timedelta
import sqlite3
import sys
import csv
import io
from pathlib import Path

app = Flask(__name__)

# Enable CORS for web player
@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    return response

# Database path
DB_PATH = Path(__file__).parent / 'analytics.db'


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

        # Most popular podcasts
        c.execute(f'''
            SELECT
                podcast_id AS id,
                COALESCE(NULLIF(MAX(podcast_title), ''), podcast_id) AS name,
                COUNT(*) as plays
            FROM events
            WHERE event_type = 'episode_play'
            {date_filter}
            AND podcast_id IS NOT NULL
            GROUP BY podcast_id
            ORDER BY plays DESC
            LIMIT 20
        ''', params)
        popular_podcasts = [dict(row) for row in c.fetchall()]

        # Most popular episodes
        c.execute(f'''
            SELECT
                episode_id AS id,
                COALESCE(NULLIF(MAX(episode_title), ''), episode_id) AS name,
                podcast_id,
                COALESCE(NULLIF(MAX(podcast_title), ''), podcast_id) AS podcast_name,
                COUNT(*) as plays
            FROM events
            WHERE event_type = 'episode_play'
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
                        <h3>Top Stations</h3>
                        <div class="table-wrapper">
                            <table id="stationsTable">
                                <thead><tr><th>Station</th><th>Plays</th></tr></thead>
                                <tbody></tbody>
                            </table>
                        </div>
                    </div>
                    <div class="panel">
                        <h3>Top Podcasts</h3>
                        <div class="table-wrapper">
                            <table id="podcastsTable">
                                <thead><tr><th>Podcast</th><th>Plays</th></tr></thead>
                                <tbody></tbody>
                            </table>
                        </div>
                    </div>
                    <div class="panel">
                        <h3>Top Episodes</h3>
                        <div class="table-wrapper">
                            <table id="episodesTable">
                                <thead><tr><th>Episode</th><th>Podcast</th><th>Plays</th></tr></thead>
                                <tbody></tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <div class="panel">
                    <h3>API Endpoints</h3>
                    <p><code>POST /event</code> - Accept analytics events from the app</p>
                    <p><code>GET /stats</code> - Get aggregated statistics (use <code>?days=7</code> or <code>?days=all</code>)</p>
                    <p><code>GET /health</code> - Health check</p>
                    <p><code>GET /export.csv</code> - Download CSV archive (use <code>?days=30</code> or <code>?days=all</code>)</p>
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
        return f"Error: {e}", 500


if __name__ == '__main__':
    # Initialize database on startup
    init_db()
    
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
