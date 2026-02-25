#!/usr/bin/env python3
import os
import re
import sqlite3

def parse_station_mapping(station_repo_path):
    with open(station_repo_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Matches station("radio1", "BBC Radio 1", "bbc_radio_one", ...)
    # group(1)=id, group(2)=title, group(3)=serviceId
    pattern = re.compile(r'station\(\s*"([^\"]+)"\s*,\s*"([^\"]+)"\s*,\s*"([^\"]+)"')
    mapping = {}
    service_map = {}
    for match in pattern.finditer(content):
        sid = match.group(1)
        title = match.group(2)
        svc = match.group(3)
        mapping[sid] = title
        service_map[svc] = (sid, title)
    return mapping, service_map


def main():
    workspace_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    station_repo_path = os.path.join(
        workspace_root,
        "app",
        "src",
        "main",
        "java",
        "com",
        "hyliankid14",
        "bbcradioplayer",
        "StationRepository.kt",
    )
    db_path = os.path.join(os.path.dirname(__file__), "analytics.db")

    if not os.path.exists(station_repo_path):
        raise SystemExit("StationRepository.kt not found")
    if not os.path.exists(db_path):
        raise SystemExit("analytics.db not found")

    mapping, service_map = parse_station_mapping(station_repo_path)
    if not mapping:
        raise SystemExit("No stations found in StationRepository.kt")

    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(events)")
        columns = {row[1] for row in cursor.fetchall()}
        if "station_name" not in columns:
            cursor.execute("ALTER TABLE events ADD COLUMN station_name TEXT")

        updated = 0
        # first, fill station_name for correct IDs
        for station_id, station_name in mapping.items():
            cursor.execute(
                """
                UPDATE events
                SET station_name = ?
                WHERE event_type = 'station_play'
                AND station_id = ?
                AND (station_name IS NULL OR station_name = '')
                """,
                (station_name, station_id),
            )
            updated += cursor.rowcount

        # now fix records where station_id equals a known serviceId
        for svc, (correct_id, title) in service_map.items():
            # update station_id and station_name simultaneously
            cursor.execute(
                """
                UPDATE events
                SET station_id = ?, station_name = ?
                WHERE event_type = 'station_play'
                AND station_id = ?
                """,
                (correct_id, title, svc),
            )
            updated += cursor.rowcount

        # some very old rows used a slightly malformed id ('bbc_radio_1' instead of
        # the canonical 'bbc_radio_one'), so handle that explicitly for radio1
        cursor.execute(
            """
            UPDATE events
            SET station_id = 'radio1', station_name = 'BBC Radio 1'
            WHERE event_type = 'station_play'
            AND station_id = 'bbc_radio_1'
            """
        )
        updated += cursor.rowcount

        conn.commit()
        print(f"Backfilled {updated} station_play rows (including serviceId fixes)")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
