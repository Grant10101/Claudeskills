# Gesture repository

One file per gesture: `g-YYYYMMDD-HHMMSS-xxxx.json`. Each file stands alone — copy just the one you need.

- `index.json` — auto-generated catalog (id, name, label, duration, fingers, file name). Don't edit by hand.
- Format: see `../docs/GESTURE_FORMAT.md`.
- Inspect from the repo root: `python gestures_cli.py list` / `show <name>` / `svg <name>`.
