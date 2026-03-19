# Google Cloud Podcast Index — Platforms, Technologies & How It Works

This document explains the Google Cloud services used to host, build and serve
the BBC Radio Player podcast index, and walks through the end-to-end flow in
practical terms.

---

## Platforms and Technologies

| Service | Role |
|---|---|
| **Google Cloud Storage (GCS)** | Stores the two static index files so the app and Cloud Function can read them |
| **Cloud Run Job** | Runs the index-builder Python script as a short-lived Docker container |
| **Container Registry (gcr.io)** | Stores the Docker image built by Cloud Build |
| **Cloud Build** | Builds and pushes the index-builder Docker image |
| **Cloud Scheduler** | Fires a daily HTTP trigger to re-run the Cloud Run Job |
| **Cloud Functions (Gen 2)** | Hosts the search API the Android app queries instead of downloading the full index |
| **IAM Service Accounts** | Fine-grained least-privilege identities for the builder and scheduler |

### Why these services?

* **GCS** is used for the two public static files because it is cheap, globally
  available, and integrates directly with Cloud Run and Cloud Functions via
  Application Default Credentials (ADC) without any extra auth code.
* **Cloud Run Job** is used instead of a long-running server because the build
  task only needs to run once a day and completes in a few minutes.  Jobs are
  billed only while running.
* **Cloud Functions** handles search so the app never needs to download the
  full ~46 MB index file.  The function keeps the index in memory for 6 hours
  (matching the Android app's cache TTL) so consecutive requests are cheap.
* **Cloud Scheduler** + **Cloud Build** + **Container Registry** are the
  standard Google-native way to automate a recurring containerised task without
  any external CI system.

---

## Step-by-Step Breakdown

The system operates in two separate flows: the **daily index rebuild** and the
**per-request search**.

---

### Daily Index Rebuild

```
Cloud Scheduler
    │  daily at 02:00 UTC — HTTP POST → Cloud Run Job execution API
    ▼
Cloud Run Job  (bbc-index-builder)
    │  spins up the Docker container built from api/cloud_run/Dockerfile
    │
    │  build_index.py
    │    1. Fetches BBC OPML feed
    │       GET https://www.bbc.co.uk/radio/opml/bbc_podcast_opml.xml
    │       → list of (podcast_id, title, rss_url) tuples
    │
    │    2. Fetches all RSS feeds in parallel (16 threads, 20 s timeout each)
    │       → parses episode titles, descriptions, publication dates
    │
    │    3. Sorts all episodes newest-first
    │
    │    4. Writes two files to /tmp (ephemeral container disk)
    │       • podcast-index.json.gz    (~46 MB, gzip level 9)
    │       • podcast-index-meta.json  (~100 bytes — counts + timestamp)
    │
    │    5. Uploads both files to the public GCS bucket
    │       gs://YOUR_BUCKET/podcast-index.json.gz
    │       gs://YOUR_BUCKET/podcast-index-meta.json
    │
    └──► GCS bucket  (publicly readable, uniform bucket-level access)
```

**Step 1 — Cloud Scheduler fires**

Cloud Scheduler sends an authenticated HTTP POST to the Cloud Run Jobs
execution API once a day (default: `0 2 * * *` UTC).  The
`bbc-scheduler` service account supplies the OAuth token; its only
permission is `roles/run.invoker` on the project.

**Step 2 — Cloud Run Job starts the container**

Cloud Run pulls the pre-built image from `gcr.io/YOUR_PROJECT/bbc-index-builder`
and runs it as a one-off task.  The `GCS_BUCKET` environment variable is
injected at runtime so the same image can be used with different buckets.
The builder service account (`bbc-index-builder`) has `roles/storage.objectAdmin`
on the bucket, which is enough to create and overwrite the two index objects.

**Step 3 — `build_index.py` fetches the BBC OPML**

The script requests the BBC's public OPML file, which lists every BBC podcast
as an RSS URL.  It deduplicates by BBC PID (the alphanumeric identifier at the
end of each RSS URL, e.g. `p00tgwjb`).

**Step 4 — RSS feeds are fetched in parallel**

Up to 16 threads fetch individual podcast RSS feeds concurrently.  Each thread
retries up to twice on network errors with exponential back-off.  For each
episode the script extracts: `id`, `title`, `description` (from iTunes summary
or `<description>`), and `pubDate`.  The podcast title is appended to the
episode description so that searching by series name surfaces its episodes.

**Step 5 — Index files are written and uploaded**

The complete index is serialised as a single JSON object, gzip-compressed at
level 9, and written to `/tmp/podcast-index.json.gz`.  A tiny companion file
`podcast-index-meta.json` (containing only the count fields and `generated_at`)
is also written.

Both files are uploaded to GCS.  Key upload details:
* The index blob uses `Content-Type: application/octet-stream` and explicitly
  clears `Content-Encoding` so GCS does not transparently decompress it
  (which would break the Cloud Function's own decompression step).
* Cache-Control headers differ: the large index gets a 6-hour public TTL;
  the metadata file uses `no-cache` so status displays are always fresh.

**Step 6 — (One-time) Cloud Build builds the Docker image**

Before the scheduler can run, the image must exist in the registry.  The
setup script calls:

```bash
gcloud builds submit \
    --tag gcr.io/YOUR_PROJECT/bbc-index-builder \
    --config api/cloud_run/cloudbuild.yaml \
    api/
```

Cloud Build reads `api/cloud_run/Dockerfile` (from the `api/` build context),
installs `google-cloud-storage`, copies `build_index.py`, and pushes the
resulting image to Container Registry.  This step only needs to be repeated
when `build_index.py` or its dependencies change.

---

### Per-Request Search (Cloud Function)

```
Android app
    │
    │  1. Lightweight freshness check (< 100 bytes)
    │     GET https://storage.googleapis.com/BUCKET/podcast-index-meta.json
    │
    │  2. Search query (avoids downloading 46 MB index on-device)
    │     GET FUNCTION_URL/search/podcasts?q=Today
    │     GET FUNCTION_URL/search/episodes?q=parliament&limit=5
    │     GET FUNCTION_URL/index/status
    │     POST FUNCTION_URL/summarize  {"text":"..."}
    │
    ▼
Cloud Function  (podcast-search, Gen 2, Python 3.12, 512 MB, 60 s timeout)
    │
    │  On first request (or after 6-hour TTL):
    │    Downloads podcast-index.json.gz from GCS
    │    Decompresses and parses the JSON
    │    Builds lowercase searchable blobs for all podcasts and episodes
    │    Stores everything in module-level lists (warm-instance cache)
    │
    │  On each search request:
    │    Tokenises query, splits OR clauses, supports quoted phrases
    │    Scans pre-built searchable blobs (no database needed)
    │    Returns JSON array of matching objects (with CORS headers)
    │
    └──► Android app receives only matching results
```

**Step 1 — Android app checks freshness**

Before showing search results the app fetches the tiny `podcast-index-meta.json`
to see when the index was last built.  This costs almost nothing compared with
the full index download.

**Step 2 — Search request reaches Cloud Function**

The app sends a search query to the Cloud Function URL.  The function is
deployed with `--allow-unauthenticated` so no API key is needed from the app.

**Step 3 — Index is loaded (once per warm instance)**

On the first request, or when the 6-hour cache TTL expires, the function:

1. Downloads `podcast-index.json.gz` from GCS using the function's
   attached service account (ADC — no credentials in code).
2. Checks the first two bytes for the gzip magic (`\x1f\x8b`); if present
   it decompresses; otherwise it treats the payload as raw JSON.
3. Parses the JSON and builds lowercase concatenated strings for every
   podcast and episode to make query scanning fast.

Subsequent requests on the same warm instance reuse the in-memory cache
and pay no GCS download cost.

**Step 4 — Query is executed**

The query string is normalised (lower-cased, diacritics stripped, punctuation
removed) and split into tokens.  The function supports:

* **AND matching** — all tokens must appear (default).
* **OR clauses** — `barbershop OR "close harmony"` splits into two clauses.
* **Quoted phrases** — `"Desert Island"` is treated as a single token.

Each podcast or episode is matched against the pre-built lowercase blob.  Only
matching items are returned, up to the requested `limit`.

**Step 5 — Response is returned**

Results are JSON-serialised with permissive CORS headers
(`Access-Control-Allow-Origin: *`) and a 5-minute CDN cache hint so repeated
identical queries are served from edge cache without invoking the function.

The `/summarize` endpoint performs extractive summarisation (no external ML
API): it scores sentences by word frequency and position, then assembles the
highest-scoring sentences up to a 50-word budget.

---

## Quick Setup

Use the automated setup script to provision all of the above in one step:

```bash
./scripts/setup-google-cloud-index.sh \
  --project YOUR_GCP_PROJECT_ID \
  --bucket YOUR_GLOBALLY_UNIQUE_BUCKET \
  --region europe-west2 \
  --mode cloud-run \
  --write-local-properties
```

The script enables the required APIs, creates the GCS bucket, creates the two
service accounts with the minimum necessary IAM roles, builds the initial
index, deploys the Cloud Function, creates the Cloud Run Job, and creates the
Cloud Scheduler job.

To also configure GitHub Actions as a fallback builder:

```bash
./scripts/setup-google-cloud-index.sh \
  --project YOUR_GCP_PROJECT_ID \
  --bucket YOUR_GLOBALLY_UNIQUE_BUCKET \
  --mode both
```

---

## Verifying the Deployment

```bash
# Check index freshness metadata
curl "https://storage.googleapis.com/YOUR_BUCKET/podcast-index-meta.json"

# Check function status
curl "FUNCTION_URL/index/status"

# Test podcast search
curl "FUNCTION_URL/search/podcasts?q=Today"

# Test episode search
curl "FUNCTION_URL/search/episodes?q=parliament&limit=5"

# Test summarise endpoint
curl -X POST "FUNCTION_URL/summarize" \
  -H "Content-Type: application/json" \
  -d '{"text":"Sample podcast description text here."}'
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Cloud Function returns `Index unavailable` | `GCS_BUCKET` env var not set or wrong bucket name | Redeploy with `--set-env-vars GCS_BUCKET=YOUR_BUCKET` |
| Index download fails with `TransparentDecompressionError` | `Content-Encoding: gzip` was set on the blob | Re-upload via `build_index.py`; the script explicitly clears `Content-Encoding` |
| Scheduler job never fires | Service agent lacks `iam.serviceAccountUser` on the scheduler SA | Re-run `ensure_scheduler_permissions` in the setup script |
| Cloud Run Job fails to push to GCS | Builder SA lacks `roles/storage.objectAdmin` | Re-run `ensure_builder_permissions` in the setup script |
| `gcloud auth application-default login` required | Local ADC not configured | Run `gcloud auth application-default login` before running `build_index.py` locally |
