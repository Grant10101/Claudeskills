# 3-Finger Crumple (gesture test ground)

Full-screen blue sheet controlled by 3-finger gestures, built from recordings made with the
[Gesture Recorder](../gesture-recorder).

- **3-finger pinch** → the blue crumples up like paper in sync with the fingers, collapsing to area 0
  at the pinch's center when the pinch ends (finger lift).
- **3-finger expansion** (while crumpled) → the blue uncrumples from where the expansion starts back to full screen.
- Anything else is ignored: 1, 2, 4 or 5 fingers, 3-finger swipes, rotations, taps, small pinches.
  The bottom label says what was recognized or why a gesture was ignored.

Live test page: Claude artifact **"3-Finger Crumple Test"** (slug `dce5f816-fbf7-4884-9f9c-a20351bbb7d5`).

## How the recordings were compiled into a detector

`train_detector.py` replays every recording in `gestures/` (3 pinches, 3 expansions), measures how
the three fingers' spread, direction and twist change, and writes the thresholds to `detector.json`
(and `static/detector-config.js` for the page):

| Measured from recordings | Final ratio of finger spread | Inward/outward | Twist |
|---|---|---|---|
| Pinches | 0.13 – 0.34 | −0.93 to −0.98 | ≤ 14° |
| Expansions | 2.70 – 3.37 | +0.48 to +0.79 | ≤ 27° |

Recognition rules (with wide margins so *any* 3-finger pinch/expansion counts):

- exactly 3 fingers, landing within 300 ms of each other; a 4th finger cancels
- pinch: spread shrinks to ≤ 0.68× and fingers move inward; expansion: spread grows to ≥ 1.4× and fingers move outward
- average twist over 67° = rotation, not a pinch
- the blue follows the fingers live; it reaches area 0 at the typical final pinch (0.21×) and snaps the rest at finger lift

Re-record or add more gestures, copy them into `gestures/`, then run `python train_detector.py`.

## Files

```
gestures/            the 6 recordings (one JSON file each) + index.json
train_detector.py    compiles recordings -> detector.json + static/detector-config.js
detector.py          streaming detector (Python reference)
static/detector.js   same detector for the browser
static/crumple.js    crumpled-paper renderer (canvas mesh with folds + shading)
static/index.html    the test page
gesture_lib.py       copied from gesture-recorder
tests/               recordings, 400 random 3-finger pinches/expansions, 600 non-matching gestures, JS/Python parity
```

## Run

```bash
python -m http.server -d static 8000      # open http://<computer-ip>:8000 on the phone
pytest -q                                 # 513 tests
```
