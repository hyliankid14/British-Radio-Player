#!/usr/bin/env python3
"""
Export popular podcasts from analytics server to local data directory.

This replaces the GitHub Actions workflow (.github/workflows/export-popular-podcasts.yml)
which previously fetched stats from the analytics server and uploaded to GCS.
Now it fetches stats from the local analytics server and writes to the local data directory.

Usage:
    python3 export_popular_podcasts.py

Environment variables:
    BBC_RADIO_DATA_DIR — Path to directory for output file
                         (default: /home/shaivure/bbc-radio/data)
    ANALYTICS_URL      — URL of the analytics server /stats endpoint
                         (default: http://127.0.0.1:5000/stats?days=30)
"""
import json
import os
import urllib.request
from datetime import datetime, timezone

DATA_DIR = os.environ.get('BBC_RADIO_DATA_DIR', '/home/shaivure/bbc-radio/data')
ANALYTICS_URL = os.environ.get('ANALYTICS_URL', 'http://127.0.0.1:5000/stats?days=30')


def main():
    print(f"Fetching popular podcasts from {ANALYTICS_URL}")

    req = urllib.request.Request(
        ANALYTICS_URL,
        headers={'User-Agent': 'British-Radio-Player-Exporter/1.0'}
    )

    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode('utf-8'))

    popular = data.get('popular_podcasts', [])

    snapshot = {
        'popular_podcasts': popular,
        'generated_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    }

    os.makedirs(DATA_DIR, exist_ok=True)
    output = os.path.join(DATA_DIR, 'popular-podcasts.json')
    with open(output, 'w') as f:
        json.dump(snapshot, f)

    print(f"Snapshot contains {len(popular)} popular podcasts")
    print(f"Written to {output}")


if __name__ == '__main__':
    main()
