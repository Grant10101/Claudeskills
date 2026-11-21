# Gesture Recorder

Part of the [Claudeskills](../README.md) repo. Used through the `gesture-recorder` Claude skill.

Record touchscreen gestures on your phone and keep them as a repository of standalone,
machine-readable files that can be replayed or reused elsewhere.

- Diamond-plate (tread plate) steel UI with a red **REC** button.
- Tap **REC**, draw a gesture anywhere (multi-finger works). Recording ends ~1 s after the last finger lifts.
- A box shows a looping replay of the gesture with **Name** and **Delete**.
- Top-right menu lists every saved gesture; tap one for playback — finger dots with vanishing trails. Rename or delete there.
- Python (Flask) backend. **Every gesture is its own JSON file** in `gestures/`.

## Where the gestures are

| Version | Location |
|---|---|
| Repo | `gesture-recorder/gestures/<id>.json` in [Grant10101/Claudeskills](https://github.com/Grant10101/Claudeskills) (`/opt/Claudeskills/gesture-recorder/gestures/` if deployed), catalog in `gestures/index.json` |
| Server API | `https://rx3productions.com/gestures/api/gestures` (list) · `/api/gestures/<id>` (JSON) · `/api/gestures/<id>.svg` (picture) · `/api/gestures/<id>/download` (file) |
| Hosted Claude version | Claude artifact **“Gesture Recorder”** (slug `2fcc2df7-6952-46de-8874-a19f30e52725`), database collection `gestures`, one record per gesture at `gestures/<id>` (full file in the record's `json` field). Pull into this repo with `python gestures_cli.py import export.json`. |

Format reference: [docs/GESTURE_FORMAT.md](docs/GESTURE_FORMAT.md).

## Run locally

```bash
pip install -r requirements.txt
python app.py                      # http://localhost:8000/gestures/
```

Open it from a phone on the same network at `http://<computer-ip>:8000/gestures/`.

## Deploy

See [docs/DEPLOY.md](docs/DEPLOY.md) — Docker or systemd on the server, then route `rx3productions.com/gestures`
through the existing Cloudflare tunnel / nginx.

## Reuse a gesture

```python
from gesture_lib import load_gesture, to_pixels, events, similarity
g = load_gesture("gestures/g-20261121-063301-d244.json")
g["summary"]["label"]            # e.g. "pinch-out"
to_pixels(g, 1080, 2400)         # strokes scaled to another screen
events(g)                        # down/move/up stream for automation replays
```

```bash
python gestures_cli.py list
python gestures_cli.py show "Spread test"
python gestures_cli.py svg "Spread test" spread.svg
```

## API

| Method | Path (under `/gestures`) | |
|---|---|---|
| GET | `/api/gestures` | list (no point data) |
| GET | `/api/gestures/<id>` | full gesture |
| GET | `/api/gestures/<id>.svg` | picture |
| GET | `/api/gestures/<id>/download` | raw file |
| POST | `/api/gestures` | save (body = gesture JSON) |
| PATCH | `/api/gestures/<id>` | rename `{"name": "..."}` |
| DELETE | `/api/gestures/<id>` | delete |

Writes need `X-Gesture-Token` only if `GESTURE_WRITE_TOKEN` is set.

## Layout

```
app.py              Flask app (serves UI + API)
gesture_lib.py      format, validation, descriptions, store, reuse helpers (stdlib only)
gestures_cli.py     command-line tools
static/             index.html, style.css, core.js (shared logic + player), app.js (UI/capture)
gestures/           one JSON file per gesture + index.json
deploy/             cloudflared, nginx, systemd, GitHub-sync script
docs/               format + deploy docs
tests/              pytest (API, labels, JS/Python parity)
```

## Tests

```bash
pip install pytest && pytest -q
```
