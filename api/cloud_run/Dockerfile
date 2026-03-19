# Dockerfile for the British Radio Player podcast-index builder.
# Run as a Cloud Run Job triggered by Cloud Scheduler to replace the GitHub
# Actions workflow.  The job fetches the BBC OPML and RSS feeds, builds the
# gzip-compressed podcast index, and uploads it to Google Cloud Storage.
#
# Build & push (run from the repository root so build_index.py is in context):
#   docker build -t gcr.io/YOUR_PROJECT/bbc-index-builder -f api/cloud_run/Dockerfile api/
#   docker push gcr.io/YOUR_PROJECT/bbc-index-builder
#
# Or let Cloud Build do it:
#   gcloud builds submit \
#       --tag gcr.io/YOUR_PROJECT/bbc-index-builder \
#       --config api/cloud_run/cloudbuild.yaml .
#
# Create the Cloud Run Job (one-time):
#   gcloud run jobs create bbc-index-builder \
#       --image gcr.io/YOUR_PROJECT/bbc-index-builder \
#       --region europe-west2 \
#       --task-timeout 3600s \
#       --set-env-vars GCS_BUCKET=YOUR_BUCKET_NAME
#
# Schedule it (Cloud Scheduler — daily at 02:00 UTC):
#   gcloud scheduler jobs create http bbc-index-builder-schedule \
#       --schedule "0 2 * * *" \
#       --uri "https://europe-west2-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/YOUR_PROJECT/jobs/bbc-index-builder:run" \
#       --message-body "{}" \
#       --oauth-service-account-email YOUR_SA@YOUR_PROJECT.iam.gserviceaccount.com \
#       --location europe-west2
#
# See api/GOOGLE_CLOUD_SETUP.md for full setup instructions.

FROM python:3.12-slim

WORKDIR /app

# Install google-cloud-storage for GCS upload support
RUN pip install --no-cache-dir google-cloud-storage>=2.0.0

# Build context is the api/ directory (see docker build -f flag above)
COPY build_index.py .

# GCS_BUCKET must be injected at runtime (Cloud Run Job environment variable)
ENV GCS_BUCKET=""

# Write the index to /tmp (ephemeral Cloud Run disk) then upload to GCS.
# Use shell form so $GCS_BUCKET is expanded from the runtime environment.
ENTRYPOINT ["/bin/sh", "-c"]
CMD ["python3 build_index.py --output /tmp/podcast-index.json.gz --bucket \"$GCS_BUCKET\""]
