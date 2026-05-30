#!/bin/bash
# Automated Pi setup script for BBC Radio Player self-hosted deployment.
#
# Usage:
#   sudo bash install.sh [--user shaivure] [--base-dir /home/shaivure/bbc-radio]
#
# This script:
#   1. Installs system packages (python3, pip, nginx, sqlite3)
#   2. Creates virtual environment + installs Python dependencies
#   3. Sets up directory structure (data/, logs/, backups/)
#   4. Generates self-signed SSL certificates
#   5. Deploys Nginx configuration
#   6. Installs and enables systemd services + timers
#   7. Verifies all services are running
#
# Prerequisites:
#   - Raspberry Pi 5 (or compatible) with Raspberry Pi OS Bookworm 64-bit
#   - Tailscale installed and connected (for external access)
#   - This script should be run from the repo root on the Pi

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────

BBC_USER="${BBC_USER:-shaivure}"
BBC_GROUP="${BBC_GROUP:-shaivure}"
BBC_BASE_DIR="${BBC_BASE_DIR:-/home/${BBC_USER}/bbc-radio}"
BBC_DATA_DIR="${BBC_BASE_DIR}/data"
BBC_LOGS_DIR="${BBC_BASE_DIR}/logs"
BBC_BACKUPS_DIR="${BBC_BASE_DIR}/backups"
BBC_API_DIR="${BBC_BASE_DIR}/api"
BBC_SCRIPTS_DIR="${BBC_BASE_DIR}/scripts"
BBC_VENV_DIR="${BBC_BASE_DIR}/venv"

DEPLOY_DIR="$(dirname "$0")"
REPO_ROOT="$(cd "$DEPLOY_DIR/.." && pwd)"

# ── Colored output ────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ── Step 1: Install system packages ───────────────────────────────────────────

info "Step 1: Installing system packages..."
apt-get update
apt-get install -y python3 python3-pip python3-venv nginx sqlite3 openssl

# ── Step 2: Create directory structure ─────────────────────────────────────────

info "Step 2: Creating directory structure..."
mkdir -p "$BBC_DATA_DIR" "$BBC_LOGS_DIR" "$BBC_BACKUPS_DIR" "$BBC_API_DIR" "$BBC_SCRIPTS_DIR"

# Copy application files from repo
cp "$REPO_ROOT/api/analytics_server.py" "$BBC_API_DIR/"
cp "$REPO_ROOT/api/build_index.py" "$BBC_API_DIR/"
cp "$REPO_ROOT/api/search_server.py" "$BBC_API_DIR/"
cp -r "$REPO_ROOT/api/cloud_function" "$BBC_API_DIR/"

# Copy database files if they exist
if [ -f "$REPO_ROOT/api/analytics.db" ]; then
    cp "$REPO_ROOT/api/analytics.db" "$BBC_API_DIR/"
fi
if [ -f "$REPO_ROOT/api/podcast_index.db" ]; then
    cp "$REPO_ROOT/api/podcast_index.db" "$BBC_API_DIR/"
fi

# Copy scripts
cp "$REPO_ROOT/scripts/export_popular_podcasts.py" "$BBC_SCRIPTS_DIR/"
cp "$REPO_ROOT/scripts/health_check.py" "$BBC_SCRIPTS_DIR/"
chmod +x "$BBC_SCRIPTS_DIR/health_check.py"

# Set ownership
chown -R "${BBC_USER}:${BBC_GROUP}" "$BBC_BASE_DIR"

# ── Step 3: Create virtual environment ─────────────────────────────────────────

info "Step 3: Creating Python virtual environment..."
if [ -d "$BBC_VENV_DIR" ]; then
    warn "Virtual environment already exists, recreating..."
    rm -rf "$BBC_VENV_DIR"
fi

python3 -m venv "$BBC_VENV_DIR"
source "$BBC_VENV_DIR/bin/activate"
pip install --upgrade pip
pip install flask gunicorn

# Check if google-cloud-storage should be installed (optional, for GCS fallback)
pip install google-cloud-storage || warn "google-cloud-storage installation failed (optional, for GCS fallback)"

# Set ownership
chown -R "${BBC_USER}:${BBC_GROUP}" "$BBC_VENV_DIR"

# ── Step 4: Generate self-signed SSL certificates ──────────────────────────────

info "Step 4: Generating self-signed SSL certificates..."
if [ ! -f /etc/ssl/certs/bbc-radio.pem ]; then
    openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
        -keyout /etc/ssl/private/bbc-radio.key \
        -out /etc/ssl/certs/bbc-radio.pem \
        -subj "/C=GB/ST=England/L=London/O=BBC Radio Player/CN=bbc-radio.local"
    info "SSL certificates generated (valid for 10 years)"
else
    warn "SSL certificates already exist, skipping"
fi

# ── Step 5: Deploy Nginx configuration ─────────────────────────────────────────

info "Step 5: Deploying Nginx configuration..."
cp "$DEPLOY_DIR/bbc-radio-nginx.conf" /etc/nginx/sites-available/bbc-radio

# Enable the site (remove default if it exists)
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/bbc-radio /etc/nginx/sites-enabled/bbc-radio

# Test and reload Nginx
nginx -t
systemctl reload nginx
systemctl enable nginx

# ── Step 6: Install systemd services ──────────────────────────────────────────

info "Step 6: Installing systemd services and timers..."

# Update service files with correct paths if base dir differs from default
if [ "$BBC_BASE_DIR" != "/home/shaivure/bbc-radio" ]; then
    info "Updating service files for custom base directory: $BBC_BASE_DIR"
    for svc in "$DEPLOY_DIR"/bbc-radio-*.service "$DEPLOY_DIR"/bbc-radio-*.timer; do
        sed -i "s|/home/shaivure/bbc-radio|${BBC_BASE_DIR}|g" "$svc"
        sed -i "s|User=shaivure|User=${BBC_USER}|g" "$svc"
    done
fi

# Install services
cp "$DEPLOY_DIR"/bbc-radio-*.service /etc/systemd/system/
cp "$DEPLOY_DIR"/bbc-radio-*.timer /etc/systemd/system/

# Reload systemd daemon
systemctl daemon-reload

# Enable and start services
systemctl enable bbc-radio-index-builder.timer
systemctl enable bbc-radio-search.service
systemctl enable bbc-radio-popular-export.timer
systemctl enable bbc-radio-health-check.timer

# Start long-running services immediately
systemctl start bbc-radio-search.service
# Note: index-builder, popular-export, and health-check are timer-based, they'll run on schedule

# ── Step 6b: Configure health check email alerts ─────────────────────────────

info "Step 6b: Setting up health check email alert credentials..."

ENV_FILE="$BBC_BASE_DIR/.env"

if [ -f "$ENV_FILE" ]; then
    warn "Environment file already exists at $ENV_FILE, skipping SMTP setup"
else
    # Create environment file with SMTP defaults for Gmail
    cat > "$ENV_FILE" << 'ENVEOF'
# Health check email alert configuration
# To receive alerts, set your SMTP credentials below.
# For Gmail: generate an App Password at https://myaccount.google.com/apppasswords

SMTP_USER=
SMTP_PASSWORD=
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587
# ALERT_EMAIL=shaivure@gmail.com
# ALERT_COOLDOWN_SEC=3600
ENVEOF
    chown "${BBC_USER}:${BBC_GROUP}" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    warn "Edit $ENV_FILE with your SMTP credentials to enable email alerts"
fi

# Update the systemd service to load the environment file
if grep -q 'EnvironmentFile' /etc/systemd/system/bbc-radio-health-check.service 2>/dev/null; then
    info "EnvironmentFile already configured in health check service"
else
    sed -i '/^\[Service\]/a EnvironmentFile='"$ENV_FILE" /etc/systemd/system/bbc-radio-health-check.service
    systemctl daemon-reload
    info "EnvironmentFile added to health check service"
fi

# ── Step 7: Verify services ────────────────────────────────────────────────────

info "Step 7: Verifying services..."
sleep 2

echo ""
info "=== Service Status ==="
systemctl status bbc-radio-search.service --no-pager || true
echo ""
systemctl list-timers bbc-radio-index-builder.timer bbc-radio-popular-export.timer bbc-radio-health-check.timer --no-pager || true
echo ""

# Test local endpoints
info "=== Endpoint Tests ==="
if command -v curl &> /dev/null; then
    SEARCH_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5001/health 2>/dev/null || echo "000")
    if [ "$SEARCH_HEALTH" = "200" ]; then
        info "Search server: OK (port 5001)"
    else
        warn "Search server: NOT RESPONDING (HTTP $SEARCH_HEALTH)"
        warn "Check logs: journalctl -u bbc-radio-search.service -n 50"
    fi
else
    warn "curl not installed, skipping endpoint tests"
fi

# ── Step 8: Post-installation notes ────────────────────────────────────────────

echo ""
info "=========================================="
info "  BBC Radio Player Setup Complete"
info "=========================================="
echo ""
info "Directories:"
info "  Base:      $BBC_BASE_DIR"
info "  Data:      $BBC_DATA_DIR"
info "  Logs:      $BBC_LOGS_DIR"
info "  Backups:   $BBC_BACKUPS_DIR"
echo ""
info "Services:"
info "  Search server:     systemctl status bbc-radio-search.service"
info "  Index builder:     systemctl list-timers bbc-radio-index-builder.timer"
info "  Popular export:    systemctl list-timers bbc-radio-popular-export.timer"
info "  Health check:      systemctl list-timers bbc-radio-health-check.timer"
echo ""
info "Logs:"
info "  Search:            tail -f $BBC_LOGS_DIR/search-server.log"
info "  Index builder:     tail -f $BBC_LOGS_DIR/index-builder.log"
info "  Health check:      tail -f $BBC_LOGS_DIR/health-check.log"
echo ""
info "Next steps:"
info "  1. Run index builder manually: systemctl start bbc-radio-index-builder.service"
info "  2. Verify index files in: $BBC_DATA_DIR"
info "  3. Test search: curl http://127.0.0.1:5001/search/podcasts?q=test"
info "  4. Update app endpoints to point to Tailscale URL"
info "  5. Set GCS fallback env vars during migration period:"
info "     export GCS_META_URL='https://storage.googleapis.com/YOUR_BUCKET/podcast-index-meta.json'"
info "     export GCS_STATS_URL='https://storage.googleapis.com/YOUR_BUCKET/popular-podcasts.json'"
info "  6. Configure email alerts:"
info "     Edit $ENV_FILE with SMTP_USER and SMTP_PASSWORD (Gmail App Password)"
info "     Test: systemctl start bbc-radio-health-check.service"
echo ""
