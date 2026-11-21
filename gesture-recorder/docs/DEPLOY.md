# Deploying to rx3productions.com/gestures

The app is a plain Flask server that already lives under the `/gestures` path (`BASE_PATH`).
It only needs to run on the server behind Cloudflare and have `/gestures` routed to it.

## 1. Run it on the server

**Docker (recommended)**

```bash
git clone https://github.com/Grant10101/Claudeskills.git /opt/Claudeskills
cd /opt/Claudeskills/gesture-recorder
docker compose up -d --build          # listens on 127.0.0.1:8000
curl http://127.0.0.1:8000/gestures/api/health
```

Gesture files are written to `/opt/Claudeskills/gesture-recorder/gestures/` (mounted into the container).

**Without Docker**

```bash
cd /opt/Claudeskills/gesture-recorder
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
sudo cp deploy/gesture-recorder.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now gesture-recorder
```

## 2. Route /gestures to it

Pick whichever matches how the site is already served:

- **Cloudflare Tunnel (cloudflared)** — add the rule from `deploy/cloudflared-config.yml` to the tunnel's
  ingress list, *above* the rule for the main site, then `sudo systemctl restart cloudflared`.
- **nginx on the server** — add `deploy/nginx-location.conf` inside the site's `server {}` block and reload nginx.
- **Cloudflare dashboard** (Zero Trust → Networks → Tunnels → Public hostname) — add hostname
  `rx3productions.com`, path `gestures`, service `http://localhost:8000`.

Open https://rx3productions.com/gestures/ on your phone. "Add to Home Screen" makes it full-screen.

## 3. Optional

- **Lock saving**: set `GESTURE_WRITE_TOKEN` (docker-compose.yml). Viewing stays open; saving asks for the key once.
- **Keep GitHub in sync**: `deploy/sync_gestures_to_github.sh` commits and pushes new gesture files (run from cron).

## Environment variables

| Var | Default | Meaning |
|---|---|---|
| `BASE_PATH` | `/gestures` | URL prefix |
| `GESTURE_DIR` | `./gestures` | where `<id>.json` files go |
| `GESTURE_WRITE_TOKEN` | *(empty)* | require `X-Gesture-Token` for save/rename/delete |
| `PORT` | `8000` | listen port |
