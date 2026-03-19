#!/usr/bin/env python3
"""
British Radio Player — Podcast Search Cloud Function
=================================================
HTTP Cloud Function that loads the pre-built podcast index from Google Cloud
Storage and serves lightweight search queries to the Android app.  This
replaces the need to download the full ~46 MB index file to the phone — the
app sends a search term and receives only the matching results.

Endpoints
---------
GET /index/status
    Returns podcast_count, episode_count and generated_at from the cached
    index.  Used by the Android app for a cheap freshness check.

GET /search/podcasts?q=QUERY[&limit=50]
    Full-text search over podcast titles and descriptions.  Returns a JSON
    array of { podcastId, title, description } objects.

GET /search/episodes?q=QUERY[&limit=100][&offset=0]
    Full-text search over episode titles and descriptions.  Returns a JSON
    array of { episodeId, podcastId, title, description, pubDate } objects.

POST /summarize
    Returns a short summary for episode/podcast share text using extractive
    summarization. Request body: { "text": "..." }.

Environment variables
---------------------
GCS_BUCKET   (required) — name of the GCS bucket that holds the index files.
INDEX_OBJECT (optional) — GCS object name for the gzip index
             (default: podcast-index.json.gz).

Deployment
----------
See api/GOOGLE_CLOUD_SETUP.md for full instructions.  Quick start:

    gcloud functions deploy podcast-search \\
        --gen2 \\
        --runtime python312 \\
        --region europe-west2 \\
        --source api/cloud_function \\
        --entry-point search \\
        --trigger-http \\
        --allow-unauthenticated \\
        --memory 512Mi \\
        --timeout 60s \\
        --set-env-vars GCS_BUCKET=YOUR_BUCKET_NAME
"""

import gzip
import json
import logging
import os
import re
import time
from typing import Any

import functions_framework  # type: ignore[import-untyped]
from flask import Request, jsonify, make_response
from google.cloud import storage as gcs  # type: ignore[import-untyped]

logger = logging.getLogger(__name__)

# ── Index cache (module-level so it persists across warm invocations) ─────────

_podcasts: list[dict] = []
_episodes: list[dict] = []
_podcast_search: list[str] = []
_episode_search: list[str] = []
_meta: dict = {}
_loaded_at: float = 0.0
INDEX_CACHE_TTL_S = 6 * 3600  # 6 hours — matches Android app TTL

_summary_cache: dict[str, tuple[str, float]] = {}
SUMMARY_CACHE_TTL_S = 3600  # 1 hour
SUMMARY_CACHE_MAX = 100

GCS_BUCKET = os.environ.get("GCS_BUCKET", "")
INDEX_OBJECT = os.environ.get("INDEX_OBJECT", "podcast-index.json.gz")


def _load_index(force: bool = False) -> None:
    """Download the gzip index from GCS and populate the in-memory cache.

    The index is kept in module-level lists so that warm Cloud Function
    instances reuse it without paying the GCS download cost on every request.
    A 6-hour TTL ensures the nightly rebuild is picked up within the same
    window used by the Android app.
    """
    global _podcasts, _episodes, _podcast_search, _episode_search, _meta, _loaded_at

    now = time.monotonic()
    if not force and _loaded_at > 0 and (now - _loaded_at) < INDEX_CACHE_TTL_S:
        return

    if not GCS_BUCKET:
        raise RuntimeError(
            "GCS_BUCKET environment variable is not set. "
            "Set it to the name of your GCS bucket."
        )

    logger.info("Loading podcast index from gs://%s/%s …", GCS_BUCKET, INDEX_OBJECT)
    t0 = time.monotonic()

    client = gcs.Client()
    bucket = client.bucket(GCS_BUCKET)
    blob = bucket.blob(INDEX_OBJECT)
    
    try:
        payload = blob.download_as_bytes()
    except Exception as exc:
        logger.error(
            "Failed to download blob from GCS. bucket=%s object=%s error=%s",
            GCS_BUCKET, INDEX_OBJECT, exc
        )
        raise
    
    logger.debug(
        "Downloaded %d bytes. First 2 bytes (hex): %s. Checking for gzip magic bytes...",
        len(payload),
        payload[:2].hex() if payload else "empty"
    )
    
    # Support both historical gzip objects and plain JSON uploads.
    # Some storage/proxy paths may return already-decoded bytes.
    # IMPORTANT: Content-Encoding must NOT be set to 'gzip' on the GCS blob,
    # as that causes transparent decompression, breaking gzip.decompress().
    if payload[:2] == b"\x1f\x8b":
        logger.info("Payload is gzip-compressed. Decompressing...")
        try:
            raw = gzip.decompress(payload)
        except Exception as exc:
            logger.error(
                "Failed to decompress gzip payload. This usually means "
                "Content-Encoding: gzip was set on the GCS object (which causes "
                "transparent decompression). Check blob metadata. error=%s", exc
            )
            raise
    else:
        logger.info("Payload is not gzip-compressed. Using as raw bytes.")
        raw = payload
    
    try:
        index = json.loads(raw)
    except Exception as exc:
        logger.error(
            "Failed to parse index JSON. payload_size=%d first_100_bytes=%s error=%s",
            len(raw), raw[:100], exc
        )
        raise

    _podcasts = index.get("podcasts", [])
    _episodes = index.get("episodes", [])
    # Precompute lightweight lowercase searchable blobs once per index refresh
    # so queries avoid expensive per-item Unicode normalization work.
    _podcast_search = [
        f"{p.get('title', '')} {p.get('description', '')}".lower()
        for p in _podcasts
    ]
    _episode_search = [
        f"{ep.get('title', '')} {ep.get('description', '')}".lower()
        for ep in _episodes
    ]
    _meta = {
        "generated_at": index.get("generated_at", ""),
        "podcast_count": index.get("podcast_count", len(_podcasts)),
        "episode_count": index.get("episode_count", len(_episodes)),
    }
    _loaded_at = time.monotonic()

    elapsed = time.monotonic() - t0
    logger.info(
        "Loaded %d podcasts, %d episodes in %.1f s",
        len(_podcasts),
        len(_episodes),
        elapsed,
    )


# ── Search helpers ─────────────────────────────────────────────────────────────

_NORMALISE_RE = re.compile(r"[^\w\s]", re.UNICODE)
_SPACE_RE = re.compile(r"\s+")


def _normalise(text: str) -> str:
    """Lower-case and strip punctuation/extra whitespace for fuzzy matching."""
    import unicodedata
    nfd = unicodedata.normalize("NFD", text)
    no_diacritics = "".join(c for c in nfd if unicodedata.category(c) != "Mn")
    return _SPACE_RE.sub(" ", _NORMALISE_RE.sub(" ", no_diacritics.lower())).strip()


def _matches(text: str, tokens: list[str]) -> bool:
    """Return True if *all* query tokens appear in *text* (case-insensitive)."""
    t = _normalise(text)
    return all(tok in t for tok in tokens)


def _tokenise(query: str) -> list[str]:
    """Split a query into lowercase tokens, filtering empty strings."""
    return [t for t in _normalise(query).split() if t]

def _split_or_clauses(query: str) -> list[str]:
    """Split query by OR operators (case-insensitive), preserving quoted text."""
    parts: list[str] = []
    buf: list[str] = []
    in_quote = False
    i = 0
    q = query.strip()

    while i < len(q):
        ch = q[i]
        if ch == '"':
            in_quote = not in_quote
            buf.append(ch)
            i += 1
            continue

        if not in_quote:
            # Detect standalone OR token with word boundaries.
            if i + 2 <= len(q) and q[i:i + 2].lower() == "or":
                prev_ok = i == 0 or q[i - 1].isspace()
                next_ok = i + 2 == len(q) or q[i + 2].isspace()
                if prev_ok and next_ok:
                    part = "".join(buf).strip()
                    if part:
                        parts.append(part)
                    buf = []
                    i += 2
                    continue

        buf.append(ch)
        i += 1

    tail = "".join(buf).strip()
    if tail:
        parts.append(tail)

    return parts if parts else [q]

def _compile_query(query: str) -> list[list[str]]:
    """
    Compile query to OR clauses where each clause is a list of AND terms.

    Example:
      barbershop OR "close harmony" or acapella
      -> [["barbershop"], ["close harmony"], ["acapella"]]
    """
    clauses: list[list[str]] = []
    for raw_clause in _split_or_clauses(query):
        terms: list[str] = []
        for m in re.finditer(r'"([^"]+)"|(\S+)', raw_clause):
            raw = m.group(1) or m.group(2) or ""
            term = _normalise(raw)
            if term:
                terms.append(term)
        if terms:
            clauses.append(terms)
    return clauses

def _matches_query(searchable: str, clauses: list[list[str]]) -> bool:
    """Return True when searchable text matches any OR clause."""
    if not clauses:
        return False
    return any(all(term in searchable for term in clause) for clause in clauses)


def _summary_cache_get(key: str) -> str | None:
    hit = _summary_cache.get(key)
    if not hit:
        return None
    value, ts = hit
    if (time.monotonic() - ts) < SUMMARY_CACHE_TTL_S:
        return value
    _summary_cache.pop(key, None)
    return None


def _summary_cache_put(key: str, value: str) -> None:
    _summary_cache[key] = (value, time.monotonic())
    if len(_summary_cache) > SUMMARY_CACHE_MAX:
        oldest = min(_summary_cache.items(), key=lambda kv: kv[1][1])[0]
        _summary_cache.pop(oldest, None)


def _limit_to_words(text: str, max_words: int) -> str:
    words = [w for w in text.strip().split() if w]
    if len(words) <= max_words:
        return " ".join(words)
    return " ".join(words[:max_words]) + "..."


def _compress_single_sentence(sentence: str, max_words: int = 35) -> str:
    """Compress a long single sentence by selecting informative clauses.

    Many podcast descriptions are one very long sentence, where naive word
    limits look like truncation. This clause-based scorer keeps salient parts
    (typically proper nouns, numbers and content words) for a concise summary.
    """
    text = sentence.strip()
    if not text:
        return ""

    parts = [p.strip(" ,;:-") for p in re.split(r"[,;:]+", text) if p.strip(" ,;:-")]
    if len(parts) <= 1:
        return _limit_to_words(text, max_words)

    stop_words = {
        "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
        "of", "with", "by", "from", "as", "is", "was", "are", "be", "been", "being",
        "have", "has", "had", "do", "does", "did", "will", "would", "should", "could",
        "may", "might", "must", "can", "this", "that", "these", "those", "it", "we",
        "they", "about", "into", "through", "during", "before", "after", "then", "once",
    }

    def score(part: str, index: int) -> float:
        words = re.findall(r"\b\w+\b", part)
        if not words:
            return 0.0
        lowered = [w.lower() for w in words]
        content_words = [w for w in lowered if len(w) > 3 and w not in stop_words]
        caps = len(re.findall(r"\b[A-Z][a-z]{2,}\b", part))
        nums = len(re.findall(r"\b\d+[\d,.]*\b", part))
        length_penalty = 1.0 if len(words) <= 16 else 0.65
        position_bonus = 1.25 if index == 0 else 1.0
        return (len(content_words) + (caps * 0.8) + (nums * 0.6)) * length_penalty * position_bonus

    ranked = sorted(
        [(idx, part, score(part, idx), len(re.findall(r"\b\w+\b", part))) for idx, part in enumerate(parts)],
        key=lambda row: row[2],
        reverse=True,
    )

    selected: list[tuple[int, str, float, int]] = []
    total = 0
    for row in ranked:
        if total + row[3] <= max_words:
            selected.append(row)
            total += row[3]

    if not selected:
        return _limit_to_words(parts[0], max_words)

    selected.sort(key=lambda row: row[0])
    summary = ", ".join(r[1] for r in selected).strip()
    if not summary:
        return _limit_to_words(text, max_words)
    return summary if summary.endswith(('.', '!', '?')) else summary + "."


def _summarize_extractively(text: str) -> str:
    clean_text = text[:2000].strip()
    if not clean_text:
        return ""

    sentences = [
        s.strip()
        for s in re.split(r"(?<=[.!?])\s+(?=[A-Z])|(?<=[.!?])$", clean_text)
        if s.strip() and len(s.strip()) > 10
    ]

    if not sentences or (len(sentences) == 1 and sentences[0] == clean_text):
        sentences = [
            s.strip()
            for s in re.split(r"[.!?]+", clean_text)
            if s.strip() and len(s.strip()) > 10
        ]

    if not sentences:
        return _limit_to_words(clean_text, 50)

    if len(sentences) == 1:
        return _compress_single_sentence(sentences[0], 35)

    stop_words = {
        "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
        "of", "with", "by", "from", "as", "is", "was", "are", "be", "been", "being",
        "have", "has", "had", "do", "does", "did", "will", "would", "should", "could",
        "may", "might", "must", "can", "this", "that", "these", "those", "i", "you",
        "he", "she", "it", "we", "they", "what", "which", "who", "when", "where",
        "why", "how", "about", "into", "through", "during", "before", "after", "above",
        "below", "between", "under", "again", "further", "then", "once",
    }

    words = re.findall(r"\b\w+\b", clean_text.lower())
    word_freq: dict[str, int] = {}
    for w in words:
        if len(w) > 3 and w not in stop_words:
            word_freq[w] = word_freq.get(w, 0) + 1

    scored: list[tuple[str, float, int, int]] = []
    for index, sentence in enumerate(sentences):
        sentence_words = re.findall(r"\b\w+\b", sentence.lower())
        word_count = len(sentence_words)
        important = [w for w in sentence_words if len(w) > 3 and w not in stop_words]

        freq_score = sum(word_freq.get(w, 0) for w in important)

        if word_count <= 15:
            length_score = 2.0
        elif word_count <= 20:
            length_score = 1.2
        else:
            length_score = 0.5

        position_bonus = 1.5 if index == 0 else 1.2 if index == 1 else 1.0
        denom = max(len(important), 1)
        score = (freq_score / denom) * length_score * position_bonus
        scored.append((sentence.strip(), score, index, word_count))

    scored.sort(key=lambda row: row[1], reverse=True)

    selected: list[tuple[str, float, int, int]] = []
    total_words = 0
    max_words = 50
    for candidate in scored:
        if total_words + candidate[3] <= max_words:
            selected.append(candidate)
            total_words += candidate[3]

    if not selected:
        best = scored[0][0]
        return _compress_single_sentence(best, 35)

    selected.sort(key=lambda row: row[2])
    sentence_texts = [re.sub(r"[.!?]+$", "", s[0]) for s in selected]
    combined = ". ".join(sentence_texts).strip()
    if not combined:
        return _limit_to_words(clean_text, 50)

    last_word = combined.split()[-1] if combined.split() else ""
    has_email_or_url = "@" in last_word or "://" in last_word or "www." in last_word
    return combined if has_email_or_url else (combined + ".")


# ── CORS helper ────────────────────────────────────────────────────────────────

def _cors_response(data: Any, status: int = 200):
    """Wrap *data* in a JSON response with permissive CORS headers."""
    resp = make_response(jsonify(data), status)
    resp.headers["Access-Control-Allow-Origin"] = "*"
    if status >= 400:
        # Do not cache transient backend errors.
        resp.headers["Cache-Control"] = "no-store"
    else:
        resp.headers["Cache-Control"] = "public, max-age=300"  # 5-min CDN cache
    return resp


# ── Entry point ────────────────────────────────────────────────────────────────

@functions_framework.http
def search(request: Request):
    """HTTP entry point for all podcast search requests."""

    # Handle CORS pre-flight
    if request.method == "OPTIONS":
        resp = make_response("", 204)
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
        return resp

    path = request.path.rstrip("/")

    if path == "/summarize":
        if request.method != "POST":
            return _cors_response({"error": "Method not allowed"}, 405)
        return _handle_summarize(request)

    if request.method != "GET":
        return _cors_response({"error": "Method not allowed"}, 405)

    # Route on path
    try:
        _load_index()
    except Exception as exc:
        logger.exception("Failed to load index")
        return _cors_response({"error": f"Index unavailable: {exc}"}, 503)

    if path == "/index/status":
        return _cors_response(_meta)

    if path == "/search/podcasts":
        return _handle_search_podcasts(request)

    if path == "/search/episodes":
        return _handle_search_episodes(request)

    return _cors_response({"error": "Not found"}, 404)


def _handle_summarize(request: Request):
    try:
        body = request.get_json(silent=True) or {}
    except Exception:
        body = {}

    text = body.get("text")
    if not isinstance(text, str):
        return _cors_response({"error": "Invalid text provided"}, 400)

    text = text.strip()
    if not text:
        return _cors_response({"error": "Text cannot be empty"}, 400)

    key = str(hash(text))
    cached = _summary_cache_get(key)
    if cached is not None:
        return _cors_response({"summary": cached, "cached": True})

    try:
        summary = _summarize_extractively(text)
        _summary_cache_put(key, summary)
        return _cors_response({"summary": summary, "cached": False})
    except Exception as exc:
        logger.exception("Summarization failed")
        return _cors_response({"error": str(exc) or "Failed to summarize"}, 500)


def _handle_search_podcasts(request: Request):
    query = (request.args.get("q") or "").strip()
    if not query:
        return _cors_response([])

    try:
        limit = min(int(request.args.get("limit", 50)), 200)
    except ValueError:
        limit = 50

    clauses = _compile_query(query)
    if not clauses:
        return _cors_response([])

    results = []
    for i, p in enumerate(_podcasts):
        searchable = _podcast_search[i] if i < len(_podcast_search) else ""
        if _matches_query(searchable, clauses):
            results.append(
                {
                    "podcastId": p.get("id", ""),
                    "title": p.get("title", ""),
                    "description": p.get("description", ""),
                }
            )
        if len(results) >= limit:
            break

    return _cors_response(results)


def _handle_search_episodes(request: Request):
    query = (request.args.get("q") or "").strip()
    if not query:
        return _cors_response([])

    try:
        limit = min(int(request.args.get("limit", 100)), 500)
    except ValueError:
        limit = 100

    try:
        offset = max(int(request.args.get("offset", 0)), 0)
    except ValueError:
        offset = 0

    clauses = _compile_query(query)
    if not clauses:
        return _cors_response([])

    # Stream matches and stop as soon as the requested page is complete.
    # This avoids building a huge intermediate list for common queries.
    needed = offset + limit
    seen = 0
    page = []

    for i, ep in enumerate(_episodes):
        searchable = _episode_search[i] if i < len(_episode_search) else ""
        if not _matches_query(searchable, clauses):
            continue

        if seen >= offset and len(page) < limit:
            page.append(
                {
                    "episodeId": ep.get("id", ""),
                    "podcastId": ep.get("podcastId", ""),
                    "title": ep.get("title", ""),
                    "description": ep.get("description", ""),
                    "pubDate": ep.get("pubDate", ""),
                }
            )

        seen += 1
        if seen >= needed:
            break

    return _cors_response(page)
