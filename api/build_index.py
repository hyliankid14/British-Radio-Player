#!/usr/bin/env python3
"""
Builds a static podcast index JSON from the BBC OPML feed and the individual
podcast RSS feeds.

Output can be written to a local file (default) and/or uploaded to a
Google Cloud Storage bucket (pass ``--bucket BUCKET_NAME``).  When a bucket
is provided the files are uploaded as public objects so the Android app and
the search Cloud Function can read them without authentication:

  podcast-index.json.gz   — gzip-compressed full index (~46 MB)
  podcast-index-meta.json — tiny freshness-check companion (~100 bytes)

Running locally:
    python3 api/build_index.py                          # write to docs/
    python3 api/build_index.py --bucket my-gcs-bucket  # write to docs/ AND upload

Running as a Cloud Run Job (no local file needed):
    python3 api/build_index.py --output /tmp/podcast-index.json.gz \
                               --bucket my-gcs-bucket

The file is gzip-compressed.  The GitHub-Pages path (committing to docs/) is
still supported as a fallback but is no longer the recommended deployment
target — use GCS instead.

Usage:
    python3 api/build_index.py [--output docs/podcast-index.json.gz]
                               [--bucket GCS_BUCKET_NAME]
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
    "British-Radio-Player-IndexBuilder/1.0 "
    "(github.com/hyliankid14/British-Radio-Player)"
)
MAX_EPISODES_PER_PODCAST = sys.maxsize  # Index all available episodes per podcast
REQUEST_TIMEOUT = 20                    # seconds per HTTP request
DEFAULT_WORKERS = 16                    # parallel RSS fetch threads
NEW_PODCASTS_MAX_COUNT = 50
NEW_PODCASTS_POLICY_START_EPOCH_MS = 1_742_774_400_000  # 2026-03-24T00:00:00Z
NEW_PODCASTS_SNAPSHOT_OBJECT = "new-podcasts.json"
NEW_PODCASTS_STATE_OBJECT = "new-podcasts-state.json"

# Baseline seed list (ordered newest -> oldest within the initial curated set).
# New podcasts discovered in the live index are assigned a fresher epoch and float above this set.
BASELINE_NEW_PODCAST_IDS = [
    "p0n5p4w5",  # Secrets of the Salt Path
    "w13xtwk9",  # Inheritance: Samsung
    "p0n3r2yp",  # Don't Say A Word
    "m002sh1p",  # Natalie McNally Murder: YouTuber on Trial
    "m002rkhb",  # Made in China
    "m002rkh9",  # MF DOOM: Long Island to Leeds
    "m002rkh7",  # Judged: A Mother's Love
    "m002rkh8",  # It's So Loud In Here!
    "m002r4y1",  # Life Without
    "m002qwn7",  # The Interface
    "m002jty0",  # How Did We Get Here?
    "m002q5dk",  # The History Bureau
    "p0mksq4x",  # SEND in the Spotlight
    "p0mhhr0q",  # Improbable
    "p0mh9lt6",  # Game's Gone: The Steve Bracknall Podcast
    "p0mf920m",  # Matt Chorley's Urgent Questions
    "p0mcyd0k",  # Complex with Kimberley Wilson
    "p0mdcpkb",  # Ready to Talk with Emma Barnett
    "m002lsmt",  # The Ireland Rugby Social Podcast
    "m002lg00",  # Matched With A Predator
    "p0m75t46",  # Borderland – UK or United Ireland?
    "m002h2gt",  # Scam Secrets
    "p016tmg0",  # The Arts Hour
    "p0llhcln",  # Making of a Fugitive
    "p0ljk1vg",  # Situationships with Sophie and Christine
    "p0lgrwds",  # Havana Helmet Club
    "p0lbnm09",  # You About?
    "m002c000",  # The State of Us
    "p0l3x7rp",  # Strange But True Crime
    "p0l3td5c",  # The Couch to 5K Podcast
    "m0029hx3",  # This Week in History
    "p02pc9x6",  # Comedy of the Week
    "m00298p7",  # What's Up Docs?
    "p0kvsxcv",  # Fool's Gold
    "p0kqbtlv",  # Melting Pot
    "p0kqbfv4",  # Heart & Stone
    "p0kqbqw2",  # Criminally Queer: The Bolton 7
    "w13xtw18",  # The Mangione Trial
    "p0kqh5hj",  # DNA Trail
    "p0kq9275",  # Daddy, What's A Podcast?
    "m0027wx2",  # Romanov: Czar of Hearts
    "m000c9mb",  # Fake Heiress
    "p0klkdww",  # Stalked
    "p0kmb39j",  # Golden Boy: Louis Rees-Zammit
    "p0kktwvl",  # Unmasked: Extreme Far Right
    "m00272c7",  # In Dark Corners
]


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
    seen_ids: set = set()
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

        # Episode ID from guid (extract BBC PID if present).
        # Handles both URL-style GUIDs (https://…/p0abc123) and
        # URN-style GUIDs (urn:bbc:podcast:p0abc123) by matching the last
        # slash- or colon-delimited alphanumeric segment.
        guid_elem = item.find("guid")
        ep_id = ""
        if guid_elem is not None and guid_elem.text:
            m = re.search(r'[/:]([a-z0-9]+)$', guid_elem.text.strip())
            ep_id = m.group(1) if m else guid_elem.text.strip()

        if not ep_id or not ep_title:
            continue

        # Skip duplicate episodes (same ID appearing more than once in the feed).
        if ep_id in seen_ids:
            continue
        seen_ids.add(ep_id)

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


# ── GCS upload ───────────────────────────────────────────────────────────────

def upload_to_gcs(
    bucket_name: str,
    local_index_path: Path,
    local_meta_path: Path,
    local_new_podcasts_path: Path,
    local_new_podcasts_state_path: Path,
) -> None:
    """
    Upload both output files to a Google Cloud Storage bucket.

    Requires the ``google-cloud-storage`` package and Application Default
    Credentials (ADC).  On Cloud Run / Cloud Functions ADC is provided
    automatically via the service account attached to the job/function.
    When running locally, authenticate first with:
        gcloud auth application-default login

    The large gzip index keeps a longer public cache TTL, but the tiny
    metadata file should be revalidated on each request so status displays do
    not lag behind successful uploads.

    Public access should be granted at the bucket level (recommended with
    uniform bucket-level access enabled). We intentionally avoid per-object ACL
    calls like ``blob.make_public()`` because they fail when UBLA is enabled.
    """
    try:
        from google.cloud import storage as gcs  # type: ignore[import-untyped]
    except ImportError:
        print(
            "ERROR: google-cloud-storage is not installed.\n"
            "  pip install google-cloud-storage",
            file=sys.stderr,
        )
        sys.exit(1)

    client = gcs.Client()
    bucket = client.bucket(bucket_name)

    index_cache_control = "public, max-age=21600"
    meta_cache_control = "no-cache, max-age=0"

    index_blob = bucket.blob("podcast-index.json.gz")
    index_blob.cache_control = index_cache_control
    # Store as an opaque gzip blob. Avoid Content-Encoding metadata because
    # GCS may transparently decompress on download, which breaks consumers
    # expecting raw gzip bytes (the Cloud Function explicitly decompresses).
    index_blob.content_type = "application/octet-stream"
    index_blob.content_encoding = ""  # Explicitly prevent Content-Encoding: gzip
    index_blob.upload_from_filename(str(local_index_path))
    print(f"Uploaded {local_index_path.name} → gs://{bucket_name}/podcast-index.json.gz")
    print(f"  Public URL: https://storage.googleapis.com/{bucket_name}/podcast-index.json.gz")

    meta_blob = bucket.blob("podcast-index-meta.json")
    meta_blob.cache_control = meta_cache_control
    meta_blob.content_type = "application/json"
    meta_blob.upload_from_filename(str(local_meta_path))
    print(f"Uploaded {local_meta_path.name} → gs://{bucket_name}/podcast-index-meta.json")
    print(f"  Public URL: https://storage.googleapis.com/{bucket_name}/podcast-index-meta.json")

    new_podcasts_blob = bucket.blob(NEW_PODCASTS_SNAPSHOT_OBJECT)
    new_podcasts_blob.cache_control = index_cache_control
    new_podcasts_blob.content_type = "application/json"
    new_podcasts_blob.upload_from_filename(str(local_new_podcasts_path))
    print(f"Uploaded {local_new_podcasts_path.name} → gs://{bucket_name}/{NEW_PODCASTS_SNAPSHOT_OBJECT}")
    print(f"  Public URL: https://storage.googleapis.com/{bucket_name}/{NEW_PODCASTS_SNAPSHOT_OBJECT}")

    state_blob = bucket.blob(NEW_PODCASTS_STATE_OBJECT)
    state_blob.cache_control = "no-cache, max-age=0"
    state_blob.content_type = "application/json"
    state_blob.upload_from_filename(str(local_new_podcasts_state_path))
    print(f"Uploaded {local_new_podcasts_state_path.name} → gs://{bucket_name}/{NEW_PODCASTS_STATE_OBJECT}")


def _seed_baseline_epochs(now_ms: int) -> dict[str, int]:
    # Keep baseline ordering stable and below genuinely new discoveries.
    # Secrets of the Salt Path sits at the anchor timestamp.
    del now_ms
    return {
        pid: NEW_PODCASTS_POLICY_START_EPOCH_MS - idx
        for idx, pid in enumerate(BASELINE_NEW_PODCAST_IDS)
    }


def _load_previous_new_podcast_state(bucket_name: str) -> dict:
    if not bucket_name:
        return {}
    try:
        from google.cloud import storage as gcs  # type: ignore[import-untyped]
    except ImportError:
        return {}

    try:
        client = gcs.Client()
        blob = client.bucket(bucket_name).blob(NEW_PODCASTS_STATE_OBJECT)
        if not blob.exists():
            return {}
        return json.loads(blob.download_as_text(encoding="utf-8"))
    except Exception as exc:
        print(f"WARN: failed to load previous new podcast state from GCS: {exc}", file=sys.stderr)
        return {}


def _build_new_podcast_snapshot(
    generated_at: str,
    podcasts_out: list[dict],
    previous_state: dict,
) -> tuple[dict, dict]:
    now_ms = int(time.time() * 1000)
    current_ids = {p["id"] for p in podcasts_out if p.get("id")}
    title_by_id = {p["id"]: p.get("title", "") for p in podcasts_out if p.get("id")}

    prev_known_ids = {
        i for i in previous_state.get("knownIds", []) if isinstance(i, str) and i
    }
    baseline_seed = _seed_baseline_epochs(now_ms)

    had_previous_state = bool(prev_known_ids)
    known_ids = prev_known_ids if had_previous_state else set(BASELINE_NEW_PODCAST_IDS)
    first_seen = {
        k: int(v)
        for k, v in (previous_state.get("firstSeenEpochs") or {}).items()
        if isinstance(k, str) and k and isinstance(v, (int, float)) and int(v) > 0
    }

    # Only mark newly discovered IDs after we have an established prior-known set.
    # On initial bootstrap, keep the curated baseline only; otherwise almost the
    # entire catalogue would be tagged as "new" at the same timestamp.
    if had_previous_state:
        for pid in current_ids - known_ids:
            first_seen.setdefault(pid, now_ms)

    for pid, epoch in baseline_seed.items():
        if pid in current_ids:
            first_seen.setdefault(pid, epoch)

    first_seen = {pid: epoch for pid, epoch in first_seen.items() if pid in current_ids and epoch > 0}

    top_entries = sorted(first_seen.items(), key=lambda kv: (-kv[1], kv[0]))[:NEW_PODCASTS_MAX_COUNT]
    snapshot = {
        "generated_at": generated_at,
        "count": len(top_entries),
        "new_podcasts": [
            {
                "id": pid,
                "title": title_by_id.get(pid, ""),
                "first_seen_epoch_ms": epoch,
            }
            for pid, epoch in top_entries
        ],
    }

    state = {
        "schemaVersion": 1,
        "generatedAt": generated_at,
        "knownIds": sorted(current_ids),
        "firstSeenEpochs": first_seen,
    }

    return snapshot, state


# ── Main ──────────────────────────────────────────────────────────────────────

def build_index(
    output_path="docs/podcast-index.json.gz",
    max_episodes=MAX_EPISODES_PER_PODCAST,
    workers=DEFAULT_WORKERS,
    gcs_bucket: str = "",
):
    """Fetch BBC OPML, then all RSS feeds concurrently, write the JSON index,
    and optionally upload the result to Google Cloud Storage."""
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

    # Write a tiny companion metadata file so the app can do a lightweight
    # freshness check (< 100 bytes) before committing to a full index download.
    meta = {
        "generated_at": index["generated_at"],
        "podcast_count": index["podcast_count"],
        "episode_count": index["episode_count"],
    }
    meta_path = out.with_name("podcast-index-meta.json")
    with open(str(meta_path), "w", encoding="utf-8") as f:
        json.dump(meta, f, separators=(",", ":"))

    previous_new_state = _load_previous_new_podcast_state(gcs_bucket)
    new_snapshot, new_state = _build_new_podcast_snapshot(
        generated_at=index["generated_at"],
        podcasts_out=podcasts_out,
        previous_state=previous_new_state,
    )
    new_snapshot_path = out.with_name(NEW_PODCASTS_SNAPSHOT_OBJECT)
    with open(str(new_snapshot_path), "w", encoding="utf-8") as f:
        json.dump(new_snapshot, f, separators=(",", ":"))

    new_state_path = out.with_name(NEW_PODCASTS_STATE_OBJECT)
    with open(str(new_state_path), "w", encoding="utf-8") as f:
        json.dump(new_state, f, separators=(",", ":"))

    size_kb = out.stat().st_size / 1024
    print(
        f"\nWrote {len(podcasts_out)} podcasts, {len(episodes_out)} episodes "
        f"→ {out} ({size_kb:.0f} KB, gzip-compressed)"
    )
    print(f"Wrote metadata → {meta_path}")
    print(f"Wrote New Podcasts snapshot → {new_snapshot_path}")
    print(f"Wrote New Podcasts state → {new_state_path}")
    if failed:
        print(f"{failed} podcasts failed (see warnings above)")

    # Optionally upload to Google Cloud Storage.
    if gcs_bucket:
        print(f"\nUploading to GCS bucket '{gcs_bucket}' ...")
        upload_to_gcs(gcs_bucket, out, meta_path, new_snapshot_path, new_state_path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Build BBC podcast index and optionally upload to Google Cloud Storage"
    )
    parser.add_argument(
        "--output",
        default="docs/podcast-index.json.gz",
        help="Output gzip-compressed JSON path (default: docs/podcast-index.json.gz)",
    )
    parser.add_argument(
        "--bucket",
        default="",
        help=(
            "Google Cloud Storage bucket name to upload the index and metadata to. "
            "When set the objects are made public so the Android app can download them. "
            "Requires google-cloud-storage and Application Default Credentials."
        ),
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
    build_index(args.output, args.max_episodes, args.workers, args.bucket)
