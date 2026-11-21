# Gesture file format — `gesture-recorder/v1`

Each gesture is **one standalone JSON file** named `<id>.json`. Nothing else is needed to use it:
copy the single file into another project and load it with `gesture_lib.load_gesture()` (or plain `json.load`).

```jsonc
{
  "format": "gesture-recorder/v1",
  "id": "g-20261121-063301-d244",          // g-YYYYMMDD-HHMMSS-xxxx (UTC), never changes
  "name": "Spread test",                    // editable label
  "created_at": "2026-11-21T06:33:01.512Z",
  "screen": { "width_px": 390, "height_px": 844, "dpr": 3, "orientation": "portrait" },
  "coordinates": "x,y normalized 0..1 of screen width/height (origin top-left); t = ms since first touch",
  "device": { "user_agent": "...", "max_touch_points": "5" },
  "strokes": [
    {
      "stroke": 0,                          // order the finger touched down
      "finger": 0,                          // finger slot (0 = first finger down; reused after lift)
      "pointer_type": "touch",
      "points": [[0, 0.4615, 0.4739, 0.5], [17, 0.4513, 0.4668, 0.5]]
      //          t_ms  x       y       pressure (0..1; 0.5 when the device doesn't report it)
    }
  ],
  "summary": {                              // computed on save; for quick understanding
    "label": "pinch-out",
    "stroke_count": 2,
    "max_simultaneous_fingers": 2,
    "duration_ms": 1570,
    "strokes": [
      { "finger": 0, "kind": "swipe-up-left", "t_start": 0, "t_end": 1570, "duration_ms": 1570,
        "start": [0.462, 0.474], "end": [0.205, 0.296], "net_px": [-100, -150],
        "path_length_px": 180, "straightness": 1.0 }
    ]
  },
  "duration_ms": 1570,
  "finger_count": 2
}
```

## Reading it

- **Position** of a point in pixels on the recording screen: `x * screen.width_px`, `y * screen.height_px`.
  To replay on another screen, multiply by that screen's size instead (`gesture_lib.to_pixels(g, W, H)`).
- **Timing**: `t` is milliseconds since the first finger touched. Strokes overlap in time when several fingers are down.
- A finger **lifts** at the last point of its stroke.

## Labels (`summary.label`)

| Label | Meaning |
|---|---|
| `tap`, `press`, `long-press` | finger barely moved; <300 ms / 300–500 ms / ≥500 ms |
| `swipe-<dir>` | mostly straight; dir is one of up, down, left, right, up-left, up-right, down-left, down-right |
| `circle-clockwise` / `circle-counterclockwise` | path returns near its start |
| `curve` | anything else with one finger |
| `pinch-in` / `pinch-out` | two fingers at once, distance shrinks / grows |
| `2-finger rotate-clockwise` / `-counterclockwise` | two fingers twist more than 30° |
| `N-finger <kind>` | N fingers at once doing the same thing |
| `double-tap`, `triple-tap`, `Nx-tap` | taps one after another |
| `sequence: a, b, ...` | separate strokes one after another |

The same logic exists in `static/core.js` (browser) and `gesture_lib.py` (Python); a test checks they agree.

## Helpers in `gesture_lib.py`

| Function | Use |
|---|---|
| `load_gesture(path)` | read a file |
| `validate(dict)` | clean + recompute summary |
| `to_pixels(g, W, H)` | strokes as pixel coords for any screen |
| `events(g, W, H)` | time-ordered `down` / `move` / `up` events (for adb, Appium, Playwright replays) |
| `resample(points, n)` | n evenly spaced points along a stroke |
| `similarity(a, b)` | 0..1 shape match (size/position independent) |
| `to_svg(g)` | static picture |
