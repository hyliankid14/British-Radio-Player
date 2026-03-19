#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"
PROJECT_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/../.." && pwd))"

DEFAULT_PROJECT="british-radio-player"
DEFAULT_BUCKET="podcast-index"
DEFAULT_REGION="europe-west2"
DEFAULT_MODE="cloud-run"
DEFAULT_WRITE_LOCAL_PROPERTIES="true"
DEFAULT_FUNCTION_NAME="podcast-search"
DEFAULT_JOB_NAME="bbc-index-builder"
DEFAULT_SCHEDULER_JOB_NAME="bbc-index-builder-schedule"
DEFAULT_BUILDER_SA="bbc-index-builder"
DEFAULT_SCHEDULER_SA="bbc-scheduler"
DEFAULT_SCHEDULE="0 2 * * *"

PROJECT_ID="$DEFAULT_PROJECT"
BUCKET="$DEFAULT_BUCKET"
REGION="$DEFAULT_REGION"
MODE="$DEFAULT_MODE"
WRITE_LOCAL_PROPERTIES="$DEFAULT_WRITE_LOCAL_PROPERTIES"
FUNCTION_NAME="$DEFAULT_FUNCTION_NAME"
JOB_NAME="$DEFAULT_JOB_NAME"
SCHEDULER_JOB_NAME="$DEFAULT_SCHEDULER_JOB_NAME"
BUILDER_SA="$DEFAULT_BUILDER_SA"
SCHEDULER_SA="$DEFAULT_SCHEDULER_SA"
SCHEDULE="$DEFAULT_SCHEDULE"

usage() {
    cat <<'EOF'
Set up Google Cloud podcast index hosting and search APIs for British Radio Player.

Usage:
    ./scripts/setup-google-cloud-index.sh [options]

Options:
  --project ID                 GCP project ID (default: british-radio-player)
  --bucket NAME               GCS bucket name (default: podcast-index)
  --region REGION             GCP region (default: europe-west2)
  --mode MODE                 One of: cloud-run, github-actions, both
                              default: cloud-run
  --function-name NAME        Cloud Function name (default: podcast-search)
  --job-name NAME             Cloud Run Job name (default: bbc-index-builder)
  --scheduler-job-name NAME   Cloud Scheduler job name
                              (default: bbc-index-builder-schedule)
  --builder-sa NAME           Index builder service account short name
                              (default: bbc-index-builder)
  --scheduler-sa NAME         Scheduler invoker service account short name
                              (default: bbc-scheduler)
  --schedule CRON             Scheduler cron in UTC (default: "0 2 * * *")
  --write-local-properties    Write URLs to local.properties (default)
  --no-write-local-properties Do not modify local.properties
  --help                      Show this help text

Examples:
  ./scripts/setup-google-cloud-index.sh \
    --project my-project \
    --bucket my-unique-bucket

  ./scripts/setup-google-cloud-index.sh \
    --mode both \
    --no-write-local-properties
EOF
}

require_cmd() {
    local cmd="$1"
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "ERROR: required command not found: $cmd"
        exit 1
    fi
}

ensure_gcloud_auth() {
    local active_account
    active_account="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' | head -n1 || true)"
    if [ -z "$active_account" ]; then
        echo "ERROR: no active gcloud account. Run: gcloud auth login"
        exit 1
    fi

    if ! gcloud auth application-default print-access-token >/dev/null 2>&1; then
        echo "ERROR: application default credentials are not configured."
        echo "Run: gcloud auth application-default login"
        exit 1
    fi
}

ensure_python_gcs_dependency() {
    if ! python3 -c 'import google.cloud.storage' >/dev/null 2>&1; then
        echo "Installing missing Python dependency: google-cloud-storage"
        python3 -m pip install --user --quiet 'google-cloud-storage>=2.0.0'
    fi
}

project_number() {
    gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)'
}

ensure_api_enabled() {
    local api="$1"
    gcloud services enable "$api" --project "$PROJECT_ID" >/dev/null
}

ensure_service_account() {
    local short_name="$1"
    local display_name="$2"
    local email="${short_name}@${PROJECT_ID}.iam.gserviceaccount.com"

    if ! gcloud iam service-accounts describe "$email" --project "$PROJECT_ID" >/dev/null 2>&1; then
        gcloud iam service-accounts create "$short_name" \
            --display-name "$display_name" \
            --project "$PROJECT_ID" >/dev/null
    fi

    echo "$email"
}

ensure_bucket() {
    local bucket_uri="gs://${BUCKET}"
    if ! gcloud storage buckets describe "$bucket_uri" --project "$PROJECT_ID" >/dev/null 2>&1; then
        gcloud storage buckets create "$bucket_uri" \
            --location "$REGION" \
            --uniform-bucket-level-access \
            --project "$PROJECT_ID"
    else
        echo "Bucket already exists: $bucket_uri"
    fi

    gcloud storage buckets add-iam-policy-binding "$bucket_uri" \
        --member="allUsers" \
        --role="roles/storage.objectViewer" \
        --project "$PROJECT_ID" >/dev/null
}

ensure_builder_permissions() {
    local builder_email="$1"

    gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
        --member="serviceAccount:${builder_email}" \
        --role="roles/storage.objectAdmin" \
        --project "$PROJECT_ID" >/dev/null
}

ensure_scheduler_permissions() {
    local scheduler_email="$1"
    local proj_num
    local scheduler_service_agent

    proj_num="$(project_number)"
    scheduler_service_agent="service-${proj_num}@gcp-sa-cloudscheduler.iam.gserviceaccount.com"

    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:${scheduler_email}" \
        --role="roles/run.invoker" \
        --quiet >/dev/null

    gcloud iam service-accounts add-iam-policy-binding "$scheduler_email" \
        --member="serviceAccount:${scheduler_service_agent}" \
        --role="roles/iam.serviceAccountUser" \
        --project "$PROJECT_ID" >/dev/null
}

build_and_upload_index_once() {
    echo "Building initial index and uploading to gs://${BUCKET} ..."
    (
        cd "$PROJECT_ROOT"
        python3 api/build_index.py --output /tmp/podcast-index.json.gz --bucket "$BUCKET"
    )
}

deploy_cloud_function() {
    (
        cd "$PROJECT_ROOT"
        gcloud functions deploy "$FUNCTION_NAME" \
            --gen2 \
            --runtime python312 \
            --region "$REGION" \
            --source api/cloud_function \
            --entry-point search \
            --trigger-http \
            --allow-unauthenticated \
            --memory 512Mi \
            --timeout 60s \
            --set-env-vars "GCS_BUCKET=${BUCKET}" \
            --project "$PROJECT_ID"
    )
}

cloud_function_url() {
    gcloud functions describe "$FUNCTION_NAME" \
        --gen2 \
        --region "$REGION" \
        --project "$PROJECT_ID" \
        --format='value(serviceConfig.uri)'
}

configure_cloud_run_scheduler() {
    local builder_email="$1"
    local scheduler_email="$2"
    local proj_num

    proj_num="$(project_number)"

    (
        cd "$PROJECT_ROOT"
        gcloud builds submit \
            --tag "gcr.io/${PROJECT_ID}/${JOB_NAME}" \
            --config api/cloud_run/cloudbuild.yaml \
            api/ \
            --project "$PROJECT_ID"
    )

    if gcloud run jobs describe "$JOB_NAME" --region "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
        gcloud run jobs update "$JOB_NAME" \
            --image "gcr.io/${PROJECT_ID}/${JOB_NAME}" \
            --region "$REGION" \
            --task-timeout 3600s \
            --service-account "$builder_email" \
            --set-env-vars "GCS_BUCKET=${BUCKET}" \
            --project "$PROJECT_ID" >/dev/null
    else
        gcloud run jobs create "$JOB_NAME" \
            --image "gcr.io/${PROJECT_ID}/${JOB_NAME}" \
            --region "$REGION" \
            --task-timeout 3600s \
            --service-account "$builder_email" \
            --set-env-vars "GCS_BUCKET=${BUCKET}" \
            --project "$PROJECT_ID" >/dev/null
    fi

    gcloud run jobs execute "$JOB_NAME" --region "$REGION" --wait --project "$PROJECT_ID"

    local scheduler_uri="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${proj_num}/jobs/${JOB_NAME}:run"
    if gcloud scheduler jobs describe "$SCHEDULER_JOB_NAME" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
        gcloud scheduler jobs update http "$SCHEDULER_JOB_NAME" \
            --schedule "$SCHEDULE" \
            --uri "$scheduler_uri" \
            --message-body '{}' \
            --oauth-service-account-email "$scheduler_email" \
            --location "$REGION" \
            --time-zone "UTC" \
            --project "$PROJECT_ID" >/dev/null
    else
        gcloud scheduler jobs create http "$SCHEDULER_JOB_NAME" \
            --schedule "$SCHEDULE" \
            --uri "$scheduler_uri" \
            --message-body '{}' \
            --oauth-service-account-email "$scheduler_email" \
            --location "$REGION" \
            --time-zone "UTC" \
            --project "$PROJECT_ID" >/dev/null
    fi
}

print_github_actions_next_steps() {
    local builder_email="$1"

    cat <<EOF
GitHub Actions mode selected.

Required repository secrets:
  GCS_BUCKET=$BUCKET
  GCP_SA_KEY=<service-account-json>

Create a key for the builder service account and add it as GCP_SA_KEY:
  gcloud iam service-accounts keys create /tmp/${BUILDER_SA}-key.json \\
    --iam-account=${builder_email} \\
    --project ${PROJECT_ID}

Then copy the file contents into your GitHub secret.
EOF
}

write_local_properties_values() {
    local function_url="$1"
    local local_props_path="${PROJECT_ROOT}/local.properties"
    local tmp_file

    tmp_file="$(mktemp)"

    if [ -f "$local_props_path" ]; then
        grep -Ev '^(GCS_INDEX_URL|GCS_META_URL|CLOUD_FUNCTION_URL)=' "$local_props_path" > "$tmp_file" || true
    fi

    {
        echo "GCS_INDEX_URL=https://storage.googleapis.com/${BUCKET}/podcast-index.json.gz"
        echo "GCS_META_URL=https://storage.googleapis.com/${BUCKET}/podcast-index-meta.json"
        echo "CLOUD_FUNCTION_URL=${function_url}"
    } >> "$tmp_file"

    mv "$tmp_file" "$local_props_path"
    echo "Updated local.properties with Google Cloud URLs."
}

while [ $# -gt 0 ]; do
    case "$1" in
        --project)
            PROJECT_ID="$2"
            shift 2
            ;;
        --bucket)
            BUCKET="$2"
            shift 2
            ;;
        --region)
            REGION="$2"
            shift 2
            ;;
        --mode)
            MODE="$2"
            shift 2
            ;;
        --function-name)
            FUNCTION_NAME="$2"
            shift 2
            ;;
        --job-name)
            JOB_NAME="$2"
            shift 2
            ;;
        --scheduler-job-name)
            SCHEDULER_JOB_NAME="$2"
            shift 2
            ;;
        --builder-sa)
            BUILDER_SA="$2"
            shift 2
            ;;
        --scheduler-sa)
            SCHEDULER_SA="$2"
            shift 2
            ;;
        --schedule)
            SCHEDULE="$2"
            shift 2
            ;;
        --write-local-properties)
            WRITE_LOCAL_PROPERTIES="true"
            shift
            ;;
        --no-write-local-properties)
            WRITE_LOCAL_PROPERTIES="false"
            shift
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

if [ "$MODE" != "cloud-run" ] && [ "$MODE" != "github-actions" ] && [ "$MODE" != "both" ]; then
    echo "ERROR: --mode must be one of: cloud-run, github-actions, both"
    exit 1
fi

require_cmd gcloud
require_cmd python3
require_cmd grep

echo "Using project: ${PROJECT_ID}"
echo "Using bucket:  ${BUCKET}"
echo "Using region:  ${REGION}"
echo "Using mode:    ${MODE}"

ensure_gcloud_auth
ensure_python_gcs_dependency

# Select the target project.
gcloud config set project "$PROJECT_ID" >/dev/null

echo "Enabling required Google Cloud APIs..."
ensure_api_enabled "storage.googleapis.com"
ensure_api_enabled "cloudfunctions.googleapis.com"
ensure_api_enabled "run.googleapis.com"
ensure_api_enabled "cloudscheduler.googleapis.com"
ensure_api_enabled "cloudbuild.googleapis.com"
ensure_api_enabled "artifactregistry.googleapis.com"
ensure_api_enabled "iam.googleapis.com"

echo "Ensuring GCS bucket exists and is publicly readable..."
ensure_bucket

echo "Ensuring service accounts and IAM bindings..."
BUILDER_EMAIL="$(ensure_service_account "$BUILDER_SA" "BBC Index Builder")"
SCHEDULER_EMAIL="$(ensure_service_account "$SCHEDULER_SA" "BBC Index Scheduler")"
ensure_builder_permissions "$BUILDER_EMAIL"
ensure_scheduler_permissions "$SCHEDULER_EMAIL"

build_and_upload_index_once

echo "Deploying Cloud Function ${FUNCTION_NAME}..."
deploy_cloud_function
FUNCTION_URL="$(cloud_function_url)"

if [ "$MODE" = "cloud-run" ] || [ "$MODE" = "both" ]; then
    echo "Configuring Cloud Run Job + Cloud Scheduler..."
    configure_cloud_run_scheduler "$BUILDER_EMAIL" "$SCHEDULER_EMAIL"
fi

if [ "$MODE" = "github-actions" ] || [ "$MODE" = "both" ]; then
    print_github_actions_next_steps "$BUILDER_EMAIL"
fi

if [ "$WRITE_LOCAL_PROPERTIES" = "true" ]; then
    write_local_properties_values "$FUNCTION_URL"
fi

cat <<EOF

Migration complete.

Static index URLs:
  https://storage.googleapis.com/${BUCKET}/podcast-index.json.gz
  https://storage.googleapis.com/${BUCKET}/podcast-index-meta.json

Cloud Function URL:
  ${FUNCTION_URL}

Quick checks:
  curl "${FUNCTION_URL}/index/status"
  curl "${FUNCTION_URL}/search/podcasts?q=Today"
  curl "${FUNCTION_URL}/search/episodes?q=parliament&limit=5"
    curl -X POST "${FUNCTION_URL}/summarize" -H "Content-Type: application/json" -d '{"text":"Sample podcast text"}'
EOF
