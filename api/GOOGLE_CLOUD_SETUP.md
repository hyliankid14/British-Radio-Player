# Google Cloud Setup Guide

This guide explains how to migrate the BBC Radio Player podcast index from
GitHub Pages (with GitHub Actions building and committing the index) to
Google Cloud Storage + Cloud Functions.

The new architecture has three parts:

| Component | What it does | Cost |
|-----------|-------------|------|
| **Cloud Storage bucket** | Stores the built `podcast-index.json.gz` and `podcast-index-meta.json` | ~$0/month (well within the free tier for this file size) |
| **Cloud Function `podcast-search`** | Serves live search queries to the Android app — no need to download the full index to the device | Free tier: 2 M requests/month |
| **Daily build** (Cloud Scheduler + Cloud Run **or** GitHub Actions) | Rebuilds the index each night and uploads it to GCS | Free tier: Cloud Scheduler (3 jobs), Cloud Run (first 240,000 vCPU-seconds) |

---

## Prerequisites

```bash
# Install the Google Cloud CLI
# https://cloud.google.com/sdk/docs/install

# Log in and set your project
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

Enable the required APIs:
```bash
gcloud services enable \
  storage.googleapis.com \
  cloudfunctions.googleapis.com \
  run.googleapis.com \
  cloudscheduler.googleapis.com \
  cloudbuild.googleapis.com
```

### Fast path (recommended)

Use the repository setup script to run the full migration with sensible
defaults:

```bash
./scripts/setup-google-cloud-index.sh \
  --project bbc-radio-player \
  --bucket YOUR_GLOBALLY_UNIQUE_BUCKET \
  --region europe-west2 \
  --mode cloud-run \
  --write-local-properties
```

What this script does:
- Enables required APIs
- Creates/configures the GCS bucket and public-read policy
- Builds and uploads the first index (`podcast-index.json.gz` + metadata)
- Deploys the `podcast-search` Cloud Function
- Creates/updates Cloud Run Job + Cloud Scheduler (Option B)
- Writes `GCS_INDEX_URL`, `GCS_META_URL`, and `CLOUD_FUNCTION_URL` to
  `local.properties`

You can skip to **Step 3** after this completes.

---

## Step 1 — Create a GCS bucket

```bash
BUCKET=bbc-radio-index          # choose a globally-unique name
REGION=europe-west2             # or your preferred region

gcloud storage buckets create gs://$BUCKET \
  --location=$REGION \
  --uniform-bucket-level-access

# Make objects publicly readable by default so the Android app can
# download the index without any authentication.
gcloud storage buckets add-iam-policy-binding gs://$BUCKET \
  --member=allUsers \
  --role=roles/storage.objectViewer
```

After the first build the index will be publicly accessible at:
```
https://storage.googleapis.com/$BUCKET/podcast-index.json.gz
https://storage.googleapis.com/$BUCKET/podcast-index-meta.json
```

---

## Step 2 — Deploy the Cloud Function

The Cloud Function (`api/cloud_function/main.py`) loads the index from GCS on
cold start and serves search queries without requiring a full index download
to the Android device.

```bash
cd /path/to/BBC-Radio-Player

gcloud functions deploy podcast-search \
  --gen2 \
  --runtime python312 \
  --region $REGION \
  --source api/cloud_function \
  --entry-point search \
  --trigger-http \
  --allow-unauthenticated \
  --memory 512Mi \
  --timeout 60s \
  --set-env-vars GCS_BUCKET=$BUCKET
```

Note the **trigger URL** printed at the end (e.g.
`https://europe-west2-YOUR_PROJECT.cloudfunctions.net/podcast-search`).
You will use this as `CLOUD_FUNCTION_URL` when building the Android app.

Test the deployment:
```bash
FUNCTION_URL=https://europe-west2-YOUR_PROJECT.cloudfunctions.net/podcast-search

curl "$FUNCTION_URL/index/status"
curl "$FUNCTION_URL/search/podcasts?q=Today"
curl "$FUNCTION_URL/search/episodes?q=parliament&limit=5"
```

---

## Step 3 — Build the Android app with GCS URLs

Add these lines to your `local.properties` file (never commit this file):

```properties
GCS_INDEX_URL=https://storage.googleapis.com/YOUR_BUCKET/podcast-index.json.gz
GCS_META_URL=https://storage.googleapis.com/YOUR_BUCKET/podcast-index-meta.json
CLOUD_FUNCTION_URL=https://REGION-YOUR_PROJECT.cloudfunctions.net/podcast-search
```

Then rebuild the app:
```bash
./gradlew assembleDebug
```

The app will now:
- Download the index from GCS instead of GitHub Pages
- Use the Cloud Function for live search queries when the local index is
  not yet populated (or the user hasn't triggered a reindex)

---

## Step 4 — Schedule the nightly index build

Choose **Option A** (simpler, reuses GitHub Actions infrastructure) or
**Option B** (fully on Google Cloud, no GitHub Actions needed).

### Option A — GitHub Actions (recommended if you already use it)

1. Add two repository secrets:
   - `GCS_BUCKET` — your bucket name
    - `GCP_SA_KEY` — raw service-account key JSON (see below)

2. Create a service account with `Storage Object Admin` on the bucket:
   ```bash
  PROJECT=YOUR_PROJECT_ID
   SA=bbc-index-builder
   gcloud iam service-accounts create $SA \
     --display-name "BBC Index Builder"

   gcloud storage buckets add-iam-policy-binding gs://$BUCKET \
     --member="serviceAccount:$SA@$PROJECT.iam.gserviceaccount.com" \
     --role=roles/storage.objectAdmin

  # Generate key JSON for the GitHub secret
   gcloud iam service-accounts keys create /tmp/sa-key.json \
     --iam-account=$SA@$PROJECT.iam.gserviceaccount.com
   cat /tmp/sa-key.json   # paste full JSON into GCP_SA_KEY secret
   ```

3. The workflow (`.github/workflows/build-podcast-index.yml`) will now
  build the index nightly and upload it directly to GCS.  It also mirrors
  the latest files into `docs/` (GitHub Pages) as a temporary compatibility
  path for legacy app versions.

### Option B — Cloud Scheduler + Cloud Run Job (fully on Google Cloud)

#### 4a. Build and push the Docker image

```bash
# Build context is the api/ directory so Dockerfile can COPY build_index.py
docker build \
  -t gcr.io/$PROJECT/bbc-index-builder \
  -f api/cloud_run/Dockerfile \
  api/

docker push gcr.io/$PROJECT/bbc-index-builder

# Or use Cloud Build (no local Docker needed):
gcloud builds submit \
  --tag gcr.io/$PROJECT/bbc-index-builder \
  --config api/cloud_run/cloudbuild.yaml \
  api/
```

#### 4b. Create the Cloud Run Job

```bash
gcloud run jobs create bbc-index-builder \
  --image gcr.io/$PROJECT/bbc-index-builder \
  --region $REGION \
  --task-timeout 3600s \
  --set-env-vars GCS_BUCKET=$BUCKET
```

Test it runs successfully:
```bash
gcloud run jobs execute bbc-index-builder --region $REGION --wait
```

#### 4c. Schedule with Cloud Scheduler

```bash
# Create a service account for Cloud Scheduler to invoke the job
SA=bbc-scheduler
gcloud iam service-accounts create $SA \
  --display-name "BBC Index Scheduler"

gcloud projects add-iam-policy-binding $PROJECT \
  --member="serviceAccount:$SA@$PROJECT.iam.gserviceaccount.com" \
  --role=roles/run.invoker

# Schedule daily at 02:00 UTC
gcloud scheduler jobs create http bbc-index-builder-schedule \
  --schedule "0 2 * * *" \
  --uri "https://$REGION-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/$PROJECT/jobs/bbc-index-builder:run" \
  --message-body "{}" \
  --oauth-service-account-email $SA@$PROJECT.iam.gserviceaccount.com \
  --location $REGION \
  --time-zone "UTC"
```

Once this is working you can disable the GitHub Actions workflow by removing
the `schedule:` trigger or by disabling it in the Actions tab.

---

## Estimated monthly cost

| Resource | Usage | Cost |
|----------|-------|------|
| GCS storage (46 MB) | < 0.05 GB | $0.00 (free tier: 5 GB) |
| GCS egress (index downloads) | Depends on users | First 1 GB/month free |
| Cloud Function invocations | < 2 M/month | $0.00 (free tier) |
| Cloud Scheduler | 1 job | $0.00 (free tier: 3 jobs) |
| Cloud Run Job (build, 5 min/day) | ~150 min/month | $0.00 (free tier: 240,000 vCPU-seconds) |

**Total: ~$0/month for a personal or small-team deployment.**

---

## Troubleshooting

**Cloud Function returns 503 "Index unavailable":**
- Check `GCS_BUCKET` is set correctly in the function's environment variables.
- Run the build job manually: `gcloud run jobs execute bbc-index-builder --region $REGION --wait`
- Verify the objects exist: `gcloud storage ls gs://$BUCKET`

**Android app still downloads from GitHub Pages:**
- Confirm `GCS_INDEX_URL` and `GCS_META_URL` are set in `local.properties` and rebuild.
- The app falls back to GitHub Pages when these values are blank.

**Build job fails with permission error:**
- Check the service account has `roles/storage.objectAdmin` on the bucket.
