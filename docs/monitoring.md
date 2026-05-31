# Monitoring Setup

External uptime monitoring for the BBC Radio Player Raspberry Pi via UptimeRobot.

## Service URLs

| Service | URL | Port |
|---------|-----|------|
| Nginx Reverse Proxy | `https://raspberrypi.tailc23afa.ts.net:8443` | 8443 |
| Search Server | `http://raspberrypi.tailc23afa.ts.net:5001` | 5001 |
| Analytics Server | `http://raspberrypi.tailc23afa.ts.net:5002` | 5002 |

## UptimeRobot Monitors

Account: shaivure@gmail.com (free tier)

| # | Monitor Name | Type | URL | Interval | Purpose |
|---|---|---|---|---|---|
| 1 | BBC Radio Pi - Nginx (HTTPS) | HTTPS | `https://raspberrypi.tailc23afa.ts.net:8443` | 5 min | Full stack check (reverse proxy + SSL) |
| 2 | BBC Radio Pi - Search Server | HTTP | `http://raspberrypi.tailc23afa.ts.net:5001/health` | 5 min | Search service health endpoint |
| 3 | BBC Radio Pi - Analytics Server | HTTP | `http://raspberrypi.tailc23afa.ts.net:5002/stats` | 5 min | Analytics service responding |
| 4 | BBC Radio Pi - Ping | Ping | `raspberrypi.tailc23afa.ts.net` | 5 min | Network-level reachability |

### Monitor Settings

- **Alert contact:** shaivure@gmail.com
- **Alert sensitivity:** 1 consecutive failure (fastest alert)
- **Timeout:** 30 seconds
- **Email notifications:** Enabled for both "Down" and "Up" events

## Verifying Monitors

1. Log in to https://uptimerobot.com/dashboard
2. Confirm all monitors show a green "Up" status
3. Check "Response Time" charts to verify healthy response times

## Testing Alerts

### Test a service going down

```bash
# SSH into the Pi and stop the search server
ssh raspberrypi
sudo systemctl stop bbc-radio-search.service

# Wait 5-10 minutes for UptimeRobot to detect the failure
# Check shaivure@gmail.com inbox for the downtime alert
```

### Test a service coming back up

```bash
# Restart the service
sudo systemctl start bbc-radio-search.service

# Wait for UptimeRobot to detect recovery
# Check for the "back up" notification email
```

## Pausing Monitoring (Maintenance)

When performing maintenance on the Pi:

1. Log in to UptimeRobot dashboard
2. Click the pause icon (⏸) next to each monitor
3. Perform maintenance
4. Click the play icon (▶) to resume monitoring

Alternatively, use the UptimeRobot API to pause/resume all monitors:

```bash
# Pause all monitors
curl -X POST https://api.uptimerobot.com/v2/pauseMonitor \
  -d "api_key=YOUR_API_KEY&monitorID=MONITOR_ID"

# Resume all monitors
curl -X POST https://api.uptimerobot.com/v2/resumeMonitor \
  -d "api_key=YOUR_API_KEY&monitorID=MONITOR_ID"
```

## Troubleshooting

### SSL Certificate Warning

Port 8443 uses a self-signed SSL certificate. UptimeRobot may report an SSL warning instead of a full "Down" status. If this causes noisy alerts:

- Option A: Disable "SSL Certificate Validation" for the HTTPS monitor in UptimeRobot settings
- Option B: Rely on the HTTP monitors (ports 5001, 5002) as your primary indicators

### No Alerts Received

1. Check UptimeRobot dashboard → My Settings → Alert Contacts
2. Verify shaivure@gmail.com is listed and active
3. Check Gmail spam/junk folder
4. Verify monitors are not paused

### False Positives

If you receive alerts but services are running:
- Check if Tailscale had a brief reconnect
- Check Pi network connectivity logs: `journalctl -u tailscaled`
- Consider increasing alert sensitivity to "2 consecutive failures"
