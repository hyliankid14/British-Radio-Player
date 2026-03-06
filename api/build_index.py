#!/usr/bin/env python3
"""
Builds a static podcast index JSON from the BBC OPML feed and the individual
podcast RSS feeds.  Intended to be run by a nightly GitHub Actions workflow;
the output is committed to docs/podcast-index.json.gz and served from GitHub
Pages so the Android app can download it without hitting the home server on
every search.  The file is gzip-compressed to stay well below GitHub's 100 MB
file size limit.

Usage:
    python3 api/build_index.py [--output docs/podcast-index.json.gz]
                               [--max-episodes N]
                               [--workers 16]
"""

import sys
import json
import gzip
import time
import re
import argparse
from datetime import datetime, timezone
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError
from xml.etree import ElementTree as ET
from pathlib import Path
from email.utils import parsedate_to_datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

BBC_OPML_URL = "https://www.bbc.co.uk/radio/opml/bbc_podcast_opml.xml"
USER_AGENT = (
    "BBC-Radio-Player-IndexBuilder/1.0 "
    "(github.com/hyliankid14/BBC-Radio-Player)"
)
MAX_EPISODES_PER_PODCAST = sys.maxsize  # Index all available episodes per podcast
REQUEST_TIMEOUT = 20                    # seconds per HTTP request
DEFAULT_WORKERS = 16                    # parallel RSS fetch threads


# ── HTTP helpers ──────────────────────────────────────────────────────────────

def fetch_bytes(url, max_retries=2):
    """Fetch *url* and return the response body as bytes.  Retries twice."""
    safe_url = url.replace("http://", "https://")
    req = Request(safe_url, headers={"User-Agent": USER_AGENT})
    last_err = None
    for attempt in range(max_retries + 1):
        try:
            with urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
                return resp.read()
        except (URLError, HTTPError) as exc:
            last_err = exc
            if attempt < max_retries:
                time.sleep(2 ** attempt)
    raise last_err


# ── OPML parsing ──────────────────────────────────────────────────────────────

def parse_opml(content):
    """
    Return a list of ``(podcast_id, title, rss_url)`` tuples parsed from the
    BBC OPML feed.  Deduplicates by podcast_id.
    """
    root = ET.fromstring(content)
    podcasts = []
    seen = set()
    for outline in root.iter("outline"):
        rss_url = (outline.get("xmlUrl") or outline.get("url") or "").strip()
        title = (outline.get("text") or outline.get("title") or "").strip()
        if not rss_url or not title:
            continue
        # Extract BBC PID from the canonical RSS URL pattern
        # e.g. https://podcasts.files.bbci.co.uk/p00tgwjb.rss → p00tgwjb
        m = re.search(r'/([a-z0-9]+)\.rss$', rss_url)
        pid = m.group(1) if m else rss_url
        if pid in seen:
            continue
        seen.add(pid)
        podcasts.append((pid, title, rss_url))
    return podcasts


# ── RSS parsing ───────────────────────────────────────────────────────────────

def parse_pub_epoch(date_str):
    """Convert an RFC-2822 pubDate string to epoch milliseconds (0 on error)."""
    if not date_str:
        return 0
    try:
        return int(parsedate_to_datetime(date_str).timestamp() * 1000)
    except Exception:
        return 0


def parse_rss(content, podcast_title, max_episodes):
    """
    Parse an RSS feed and return:
        podcast_description (str),
        episodes (list of dicts)

    Each episode dict has keys: id, title, description, pubDate, pubEpoch.
    """
    try:
        root = ET.fromstring(content)
    except ET.ParseError:
        return "", []

    channel = root.find("channel")
    if channel is None:
        return "", []

    ns = {"itunes": "http://www.itunes.com/dtds/podcast-1.0.dtd"}

    # Podcast description from RSS channel
    ch_desc_elem = channel.find("description")
    podcast_desc = (ch_desc_elem.text or "").strip() if ch_desc_elem is not None else ""

    episodes = []
    for item in channel.findall("item"):
        if len(episodes) >= max_episodes:
            break

        title_elem = item.find("title")
        ep_title = (title_elem.text or "").strip() if title_elem is not None else ""

        # Prefer iTunes summary, then plain description
        summary_elem = item.find("itunes:summary", ns)
        desc_elem = item.find("description")
        description = ""
        if summary_elem is not None and summary_elem.text:
            description = summary_elem.text.strip()
        elif desc_elem is not None and desc_elem.text:
            description = desc_elem.text.strip()

        # Episode ID from guid (extract BBC PID if present)
        guid_elem = item.find("guid")
        ep_id = ""
        if guid_elem is not None and guid_elem.text:
            m = re.search(r'/([a-z0-9]+)$', guid_elem.text.strip())
            ep_id = m.group(1) if m else guid_elem.text.strip()

        if not ep_id or not ep_title:
            continue

        pub_date_elem = item.find("pubDate")
        pub_date = (pub_date_elem.text or "").strip() if pub_date_elem is not None else ""

        # Enrich episode description with podcast title to aid cross-field
        # searches (e.g. searching "Desert Island" surfaces episodes).
        if podcast_title and podcast_title not in description:
            description = (description + " " + podcast_title).strip()

        episodes.append({
            "id": ep_id,
            "title": ep_title,
            "description": description,
            "pubDate": pub_date,
            "pubEpoch": parse_pub_epoch(pub_date),
        })

    return podcast_desc, episodes


# ── Per-podcast fetch ─────────────────────────────────────────────────────────

def fetch_podcast(pid, title, rss_url, max_episodes):
    """Fetch one podcast's RSS feed and return (pid, title, desc, episodes, err)."""
    try:
        content = fetch_bytes(rss_url)
        desc, eps = parse_rss(content, title, max_episodes)
        return pid, title, desc, eps, None
    except Exception as exc:
        return pid, title, "", [], str(exc)


# ── Main ──────────────────────────────────────────────────────────────────────

def build_index(
    output_path="docs/podcast-index.json.gz",
    max_episodes=MAX_EPISODES_PER_PODCAST,
    workers=DEFAULT_WORKERS,
):
    """Fetch BBC OPML, then all RSS feeds concurrently, and write the JSON index."""
    print(f"Fetching OPML from {BBC_OPML_URL} ...")
    raw_podcasts = parse_opml(fetch_bytes(BBC_OPML_URL))
    print(f"Found {len(raw_podcasts)} podcasts in OPML\n")

    podcasts_out = []
    episodes_out = []
    failed = 0

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(fetch_podcast, pid, title, rss_url, max_episodes): (pid, title)
            for pid, title, rss_url in raw_podcasts
        }
        done = 0
        for fut in as_completed(futures):
            done += 1
            pid, title, desc, eps, err = fut.result()
            if err:
                print(
                    f"  WARN [{done:3d}/{len(raw_podcasts)}] {title}: {err}",
                    file=sys.stderr,
                )
                failed += 1
            else:
                print(f"  OK   [{done:3d}/{len(raw_podcasts)}] {title}: {len(eps)} episodes")

            podcasts_out.append({"id": pid, "title": title, "description": desc})
            for ep in eps:
                episodes_out.append({"podcastId": pid, **ep})

    # Sort all episodes newest-first so the app can paginate from the top.
    episodes_out.sort(key=lambda e: e.get("pubEpoch", 0), reverse=True)

    index = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "podcast_count": len(podcasts_out),
        "episode_count": len(episodes_out),
        "podcasts": podcasts_out,
        "episodes": episodes_out,
    }

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    json_bytes = json.dumps(index, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with gzip.open(str(out), "wb", compresslevel=9) as f:
        f.write(json_bytes)

    size_kb = out.stat().st_size / 1024
    print(
        f"\nWrote {len(podcasts_out)} podcasts, {len(episodes_out)} episodes "
        f"→ {out} ({size_kb:.0f} KB, gzip-compressed)"
    )
    if failed:
        print(f"{failed} podcasts failed (see warnings above)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Build BBC podcast index for GitHub Pages"
    )
    parser.add_argument(
        "--output",
        default="docs/podcast-index.json.gz",
        help="Output gzip-compressed JSON path (default: docs/podcast-index.json.gz)",
    )
    parser.add_argument(
        "--max-episodes",
        type=int,
        default=MAX_EPISODES_PER_PODCAST,
        help="Max episodes per podcast (default: all available)",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=DEFAULT_WORKERS,
        help=f"Parallel fetch threads (default: {DEFAULT_WORKERS})",
    )
    args = parser.parse_args()
    build_index(args.output, args.max_episodes, args.workers)
