#!/usr/bin/env python3
"""
Health check script for BBC Radio Player Raspberry Pi.

Runs via systemd timer and sends email alerts to shaivure@gmail.com
when system metrics exceed configured thresholds or services go down.

Environment variables (all optional with sensible defaults):
    ALERT_EMAIL         — Recipient email (default: shaivure@gmail.com)
    SMTP_HOST           — SMTP server host (default: smtp.gmail.com)
    SMTP_PORT           — SMTP server port (default: 587)
    SMTP_USER           — SMTP authentication username
    SMTP_PASSWORD       — SMTP authentication password (use app password for Gmail)
    ALERT_COOLDOWN_SEC  — Minimum seconds between alerts (default: 3600 = 1 hour)

Thresholds:
    TEMP_WARN_C         — Temperature warning threshold (default: 70)
    TEMP_CRIT_C         — Temperature critical threshold (default: 80)
    DISK_WARN_PERCENT   — Disk usage warning percentage (default: 85)
    DISK_CRIT_PERCENT   — Disk usage critical percentage (default: 95)
    MEM_WARN_PERCENT    — Memory usage warning percentage (default: 90)

Usage:
    python3 health_check.py

Exit codes:
    0 — All checks passed
    1 — Issues detected and alert sent
    2 — Issues detected but alert failed to send
"""

import os
import sys
import time
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import smtplib

# ── Configuration ─────────────────────────────────────────────────────────────

STATE_FILE = Path.home() / '.bbc-radio-health-state.json'

ALERT_EMAIL = os.environ.get('ALERT_EMAIL', 'shaivure@gmail.com')
SMTP_HOST = os.environ.get('SMTP_HOST', 'smtp.gmail.com')
SMTP_PORT = int(os.environ.get('SMTP_PORT', '587'))
SMTP_USER = os.environ.get('SMTP_USER', '')
SMTP_PASSWORD = os.environ.get('SMTP_PASSWORD', '')
ALERT_COOLDOWN_SEC = int(os.environ.get('ALERT_COOLDOWN_SEC', '3600'))

TEMP_WARN_C = float(os.environ.get('TEMP_WARN_C', '70'))
TEMP_CRIT_C = float(os.environ.get('TEMP_CRIT_C', '80'))
DISK_WARN_PERCENT = float(os.environ.get('DISK_WARN_PERCENT', '85'))
DISK_CRIT_PERCENT = float(os.environ.get('DISK_CRIT_PERCENT', '95'))
MEM_WARN_PERCENT = float(os.environ.get('MEM_WARN_PERCENT', '90'))

SERVICES_TO_CHECK = [
    'bbc-radio-search.service',
    'bbc-radio-index-builder.timer',
    'bbc-radio-popular-export.timer',
]

# ── Helpers ───────────────────────────────────────────────────────────────────

def get_cpu_temperature():
    try:
        with open('/sys/class/thermal/thermal_zone0/temp') as f:
            return int(f.read().strip()) / 1000.0
    except Exception:
        try:
            result = subprocess.run(
                ['vcgencmd', 'measure_temp'],
                capture_output=True, text=True, timeout=2
            )
            if result.returncode == 0:
                return float(result.stdout.strip().split('=')[1].replace("'C", ''))
        except Exception:
            pass
    return None


def get_disk_usage():
    try:
        st = os.statvfs('/')
        total = st.f_frsize * st.f_blocks
        used = total - (st.f_frsize * st.f_bfree)
        return round((used / total) * 100.0, 1) if total > 0 else 0.0
    except Exception:
        return None


def get_memory_usage():
    try:
        mem = {}
        with open('/proc/meminfo') as f:
            for line in f:
                parts = line.split()
                mem[parts[0].rstrip(':')] = int(parts[1])
        total = mem.get('MemTotal', 1)
        avail = mem.get('MemAvailable', mem.get('MemFree', 0))
        return round(((total - avail) / total) * 100.0, 1)
    except Exception:
        return None


def get_uptime():
    try:
        with open('/proc/uptime') as f:
            seconds = float(f.readline().split()[0])
        days = int(seconds // 86400)
        hours = int((seconds % 86400) // 3600)
        mins = int((seconds % 3600) // 60)
        parts = []
        if days: parts.append(f'{days}d')
        if hours: parts.append(f'{hours}h')
        parts.append(f'{mins}m')
        return ' '.join(parts)
    except Exception:
        return 'unknown'


def check_service(name):
    try:
        result = subprocess.run(
            ['systemctl', 'is-active', name],
            capture_output=True, text=True, timeout=5
        )
        return result.stdout.strip()
    except Exception:
        return 'unknown'


def load_state():
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except Exception:
        return {'last_alert_sent': 0, 'last_issues': []}


def save_state(state):
    try:
        with open(STATE_FILE, 'w') as f:
            json.dump(state, f)
    except Exception:
        pass


def can_send_alert():
    state = load_state()
    now = time.time()
    return (now - state.get('last_alert_sent', 0)) >= ALERT_COOLDOWN_SEC


def record_alert_sent():
    state = load_state()
    state['last_alert_sent'] = time.time()
    save_state(state)


def send_email(subject, body):
    if not SMTP_USER or not SMTP_PASSWORD:
        print("SMTP credentials not configured. Set SMTP_USER and SMTP_PASSWORD env vars.")
        return False

    msg = MIMEMultipart('alternative')
    msg['From'] = SMTP_USER
    msg['To'] = ALERT_EMAIL
    msg['Subject'] = subject

    msg.attach(MIMEText(body, 'plain'))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(msg)
        print(f"Alert email sent to {ALERT_EMAIL}")
        return True
    except Exception as e:
        print(f"Failed to send alert email: {e}", file=sys.stderr)
        return False


def format_alert_email(issues, metrics):
    hostname = 'raspberrypi'
    try:
        with open('/etc/hostname') as f:
            hostname = f.read().strip()
    except Exception:
        pass

    now = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
    lines = [
        f'BBC Radio Player — Health Alert',
        f'{"=" * 40}',
        f'Host: {hostname}',
        f'Time: {now}',
        f'Uptime: {metrics.get("uptime", "unknown")}',
        f'',
        f'Issues Detected:',
        f'{"-" * 40}',
    ]

    severity_order = {'critical': 0, 'warning': 1}
    sorted_issues = sorted(issues, key=lambda i: severity_order.get(i.get('severity', 'warning'), 2))

    for issue in sorted_issues:
        severity = issue.get('severity', 'warning').upper()
        lines.append(f'  [{severity}] {issue["message"]}')

    lines.extend([
        '',
        f'Current Metrics:',
        f'{"-" * 40}',
    ])

    temp = metrics.get('temperature_c')
    if temp is not None:
        lines.append(f'  Temperature:  {temp}°C')
    disk = metrics.get('disk_percent')
    if disk is not None:
        lines.append(f'  Disk usage:   {disk}%')
    mem = metrics.get('memory_percent')
    if mem is not None:
        lines.append(f'  Memory usage: {mem}%')

    services = metrics.get('services', {})
    if services:
        lines.append(f'  Services:')
        for name, status in services.items():
            lines.append(f'    {name}: {status}')

    lines.extend([
        '',
        'This is an automated alert from the BBC Radio Player health check.',
        'Configure thresholds via environment variables or suppress alerts',
        'by setting the ALERT_EMAIL variable to an empty string.',
        '',
        'To investigate: SSH into the Pi and run:',
        '  systemctl --type=service --state=failed',
        '  vcgencmd measure_temp',
        '  df -h /',
    ])

    return '\n'.join(lines)


# ── Main ──────────────────────────────────────────────────────────────────────

def run_checks():
    issues = []
    metrics = {}

    metrics['uptime'] = get_uptime()

    temp = get_cpu_temperature()
    metrics['temperature_c'] = temp
    if temp is not None:
        if temp >= TEMP_CRIT_C:
            issues.append({
                'severity': 'critical',
                'message': f'CPU temperature is {temp}°C (critical threshold: {TEMP_CRIT_C}°C)'
            })
        elif temp >= TEMP_WARN_C:
            issues.append({
                'severity': 'warning',
                'message': f'CPU temperature is {temp}°C (warning threshold: {TEMP_WARN_C}°C)'
            })

    disk = get_disk_usage()
    metrics['disk_percent'] = disk
    if disk is not None:
        if disk >= DISK_CRIT_PERCENT:
            issues.append({
                'severity': 'critical',
                'message': f'Disk usage is {disk}% (critical threshold: {DISK_CRIT_PERCENT}%)'
            })
        elif disk >= DISK_WARN_PERCENT:
            issues.append({
                'severity': 'warning',
                'message': f'Disk usage is {disk}% (warning threshold: {DISK_WARN_PERCENT}%)'
            })

    mem = get_memory_usage()
    metrics['memory_percent'] = mem
    if mem is not None:
        if mem >= MEM_WARN_PERCENT:
            issues.append({
                'severity': 'warning',
                'message': f'Memory usage is {mem}% (warning threshold: {MEM_WARN_PERCENT}%)'
            })

    service_statuses = {}
    for svc in SERVICES_TO_CHECK:
        status = check_service(svc)
        service_statuses[svc] = status
        if status != 'active':
            severity = 'critical'
            if 'timer' in svc:
                severity = 'warning'
            issues.append({
                'severity': severity,
                'message': f'Service {svc} is {status}'
            })
    metrics['services'] = service_statuses

    return issues, metrics


def main():
    print(f'[{datetime.now(timezone.utc).isoformat()}] Running health check...')

    issues, metrics = run_checks()

    if not issues:
        print('All checks passed.')
        sys.exit(0)

    has_critical = any(i.get('severity') == 'critical' for i in issues)
    print(f'{len(issues)} issue(s) detected ({sum(1 for i in issues if i["severity"] == "critical")} critical):')
    for issue in issues:
        print(f'  [{issue["severity"].upper()}] {issue["message"]}')

    if can_send_alert():
        subject = f'[BBC Radio] {"CRITICAL" if has_critical else "WARNING"} — Pi Health Alert'
        body = format_alert_email(issues, metrics)

        if send_email(subject, body):
            record_alert_sent()
            print('Alert sent successfully.')
            sys.exit(1)
        else:
            print('Alert email failed to send.', file=sys.stderr)
            sys.exit(2)
    else:
        print('Alert suppressed (within cooldown period).')
        sys.exit(1)


if __name__ == '__main__':
    main()
