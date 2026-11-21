"""gesture_lib — load, validate, describe, compare and render recorded gestures.

Every gesture is one standalone JSON file (see docs/GESTURE_FORMAT.md).
This module has no dependencies outside the standard library, so it can be
copied into any other project and used on its own:

    from gesture_lib import load_gesture, to_pixels, resample, similarity
    g = load_gesture("gestures/g-20261121-062412-ab12.json")
    pts = to_pixels(g, 390, 844)        # replay at another screen size
"""
from __future__ import annotations

import json
import math
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

FORMAT = "gesture-recorder/v1"
ID_RE = re.compile(r"^g-\d{8}-\d{6}-[0-9a-f]{4}$")
MAX_STROKES = 40
MAX_POINTS = 20000
MAX_NAME = 80
FINGER_COLORS = ["#ff8a1f", "#22d3ee", "#a3e635", "#f472b6", "#facc15",
                 "#60a5fa", "#fb7185", "#34d399", "#c084fc", "#f8fafc"]


class GestureError(ValueError):
    """Raised when a gesture document is malformed."""


# --------------------------------------------------------------------------
# rounding that matches JavaScript's Math.round (half up, not banker's)
def _jsround(v: float) -> int:
    return int(math.floor(v + 0.5))


def _round(v: float, n: int) -> float:
    p = 10 ** n
    return math.floor(v * p + 0.5) / p


_DIRS = ["right", "down-right", "down", "down-left", "left", "up-left", "up", "up-right"]


def direction(dx: float, dy: float) -> str:
    """8-way compass direction in screen coordinates (+y is down)."""
    idx = _jsround(math.atan2(dy, dx) / (math.pi / 4))
    return _DIRS[(idx + 8) % 8]


# --------------------------------------------------------------------------
# validation
def validate(g: Any) -> dict:
    """Check structure and return a cleaned copy (unknown top-level keys dropped)."""
    if not isinstance(g, dict):
        raise GestureError("gesture must be a JSON object")
    gid = g.get("id")
    if not isinstance(gid, str) or not ID_RE.match(gid):
        raise GestureError("id must look like g-YYYYMMDD-HHMMSS-xxxx")
    name = g.get("name") or ""
    if not isinstance(name, str):
        raise GestureError("name must be a string")
    name = name.strip()[:MAX_NAME]
    scr = g.get("screen")
    if not isinstance(scr, dict):
        raise GestureError("screen is required")
    try:
        w = float(scr["width_px"]); h = float(scr["height_px"])
    except (KeyError, TypeError, ValueError):
        raise GestureError("screen.width_px and screen.height_px are required numbers")
    if not (1 <= w <= 20000 and 1 <= h <= 20000):
        raise GestureError("screen size out of range")
    strokes = g.get("strokes")
    if not isinstance(strokes, list) or not strokes:
        raise GestureError("strokes must be a non-empty list")
    if len(strokes) > MAX_STROKES:
        raise GestureError(f"at most {MAX_STROKES} strokes")
    clean_strokes = []
    total = 0
    for i, s in enumerate(strokes):
        if not isinstance(s, dict) or not isinstance(s.get("points"), list) or not s["points"]:
            raise GestureError(f"stroke {i} needs a non-empty points list")
        pts = []
        last_t = -1.0
        for p in s["points"]:
            if not isinstance(p, (list, tuple)) or len(p) < 3:
                raise GestureError(f"stroke {i}: each point is [t_ms, x, y, pressure?]")
            try:
                t, x, y = float(p[0]), float(p[1]), float(p[2])
                pr = float(p[3]) if len(p) > 3 and p[3] is not None else 0.5
            except (TypeError, ValueError):
                raise GestureError(f"stroke {i}: point values must be numbers")
            if not all(math.isfinite(v) for v in (t, x, y, pr)):
                raise GestureError(f"stroke {i}: non-finite value")
            if t < last_t:
                raise GestureError(f"stroke {i}: timestamps must not go backwards")
            last_t = t
            pts.append([_jsround(t), _round(x, 4), _round(y, 4), _round(pr, 2)])
        total += len(pts)
        try:
            finger = max(0, min(int(s.get("finger", i)), 99))
        except (TypeError, ValueError):
            finger = i
        clean_strokes.append({
            "stroke": i,
            "finger": finger,
            "pointer_type": str(s.get("pointer_type", "touch"))[:10],
            "points": pts,
        })
    if total > MAX_POINTS:
        raise GestureError(f"at most {MAX_POINTS} points in total")
    out = {
        "format": FORMAT,
        "id": gid,
        "name": name,
        "created_at": str(g.get("created_at") or datetime.now(timezone.utc).isoformat()),
        "screen": {
            "width_px": _jsround(w), "height_px": _jsround(h),
            "dpr": _round(float(scr.get("dpr", 1) or 1), 2),
            "orientation": str(scr.get("orientation", "portrait" if h >= w else "landscape"))[:20],
        },
        "coordinates": "x,y normalized 0..1 of screen width/height (origin top-left); t = ms since first touch",
        "device": {k: str(v)[:200] for k, v in (g.get("device") or {}).items()} if isinstance(g.get("device"), dict) else {},
        "strokes": clean_strokes,
    }
    out["summary"] = summarize(out)
    out["duration_ms"] = out["summary"]["duration_ms"]
    out["finger_count"] = out["summary"]["max_simultaneous_fingers"]
    return out


# --------------------------------------------------------------------------
# description (mirrors summarize() in static/core.js)
def _stroke_stats(s: dict, w: float, h: float) -> dict:
    pts = s["points"]
    first, last = pts[0], pts[-1]
    path_len = 0.0
    area = 0.0
    for a, b in zip(pts, pts[1:]):
        ax, ay, bx, by = a[1] * w, a[2] * h, b[1] * w, b[2] * h
        path_len += math.hypot(bx - ax, by - ay)
        area += ax * by - bx * ay
    dx, dy = (last[1] - first[1]) * w, (last[2] - first[2]) * h
    dist = math.hypot(dx, dy)
    dur = last[0] - first[0]
    min_dim = min(w, h)
    if path_len < max(14, 0.035 * min_dim):
        kind = "long-press" if dur >= 500 else ("tap" if dur < 300 else "press")
    elif dist / path_len > 0.8:
        kind = "swipe-" + direction(dx, dy)
    elif dist < 0.25 * path_len and path_len > 0.25 * min_dim:
        kind = "circle-clockwise" if area > 0 else "circle-counterclockwise"
    else:
        kind = "curve"
    return {
        "finger": s["finger"],
        "kind": kind,
        "t_start": first[0],
        "t_end": last[0],
        "duration_ms": dur,
        "start": [_round(first[1], 3), _round(first[2], 3)],
        "end": [_round(last[1], 3), _round(last[2], 3)],
        "net_px": [_jsround(dx), _jsround(dy)],
        "path_length_px": _jsround(path_len),
        "straightness": _round(dist / path_len, 2) if path_len > 0 else 1,
    }


def _overlaps(a: dict, b: dict) -> bool:
    return a["t_start"] <= b["t_end"] and b["t_start"] <= a["t_end"]


def point_at(stroke: dict, t: float) -> list:
    """Latest recorded point of a stroke at time t (ms)."""
    best = stroke["points"][0]
    for p in stroke["points"]:
        if p[0] <= t:
            best = p
        else:
            break
    return best


_STATIONARY = {"tap", "press", "long-press"}


def summarize(g: dict) -> dict:
    """Plain-language label plus per-stroke stats (kind, direction, length...)."""
    w, h = g["screen"]["width_px"], g["screen"]["height_px"]
    strokes = [s for s in g["strokes"] if s.get("points")]
    stats = [_stroke_stats(s, w, h) for s in strokes]
    max_sim = max((sum(1 for o in stats if _overlaps(s, o)) for s in stats), default=0)
    if not stats:
        label = "empty"
    elif len(stats) == 1:
        label = stats[0]["kind"]
    else:
        all_overlap = all(_overlaps(s, o) for s in stats for o in stats)
        kinds = [s["kind"] for s in stats]
        same = all(k == kinds[0] for k in kinds)
        if all_overlap and len(stats) == 2 and not all(k in _STATIONARY for k in kinds):
            a, b = strokes
            t0 = max(stats[0]["t_start"], stats[1]["t_start"])
            t1 = min(stats[0]["t_end"], stats[1]["t_end"])
            pa0, pb0, pa1, pb1 = point_at(a, t0), point_at(b, t0), point_at(a, t1), point_at(b, t1)
            d0 = math.hypot((pa0[1] - pb0[1]) * w, (pa0[2] - pb0[2]) * h)
            d1 = math.hypot((pa1[1] - pb1[1]) * w, (pa1[2] - pb1[2]) * h)
            ang0 = math.atan2((pb0[2] - pa0[2]) * h, (pb0[1] - pa0[1]) * w)
            ang1 = math.atan2((pb1[2] - pa1[2]) * h, (pb1[1] - pa1[1]) * w)
            d_ang = (ang1 - ang0) * 180 / math.pi
            while d_ang > 180:
                d_ang -= 360
            while d_ang < -180:
                d_ang += 360
            ratio = d1 / d0 if d0 > 0 else 1
            if abs(d_ang) > 30:
                label = "2-finger rotate-" + ("clockwise" if d_ang > 0 else "counterclockwise")
            elif ratio < 0.7:
                label = "pinch-in"
            elif ratio > 1.4:
                label = "pinch-out"
            elif same:
                label = "2-finger " + kinds[0]
            else:
                label = "2-finger " + " + ".join(kinds)
        elif all_overlap and same:
            label = f"{len(stats)}-finger {kinds[0]}"
        elif not all_overlap and same and kinds[0] in ("tap", "press"):
            n = len(stats)
            label = {2: "double", 3: "triple"}.get(n, f"{n}x") + "-" + kinds[0]
        else:
            label = "sequence: " + ", ".join(kinds)
    return {
        "label": label,
        "stroke_count": len(stats),
        "max_simultaneous_fingers": max_sim,
        "duration_ms": max((s["t_end"] for s in stats), default=0),
        "strokes": stats,
    }


# --------------------------------------------------------------------------
# reuse helpers
def load_gesture(path: str | os.PathLike) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def to_pixels(g: dict, width: float | None = None, height: float | None = None) -> list[dict]:
    """Strokes as pixel coordinates for a target screen (defaults to the recording screen).

    Returns [{"finger": n, "points": [(t_ms, x_px, y_px), ...]}, ...]
    """
    w = width or g["screen"]["width_px"]
    h = height or g["screen"]["height_px"]
    return [{"finger": s["finger"], "points": [(p[0], p[1] * w, p[2] * h) for p in s["points"]]}
            for s in g["strokes"]]


def events(g: dict, width: float | None = None, height: float | None = None) -> list[dict]:
    """Flatten into a time-ordered touch event stream: down / move / up per finger.

    Handy for replaying through automation tools (adb, Appium, Playwright, etc).
    """
    out = []
    for s in to_pixels(g, width, height):
        pts = s["points"]
        for i, (t, x, y) in enumerate(pts):
            typ = "down" if i == 0 else "move"
            out.append({"t": t, "type": typ, "finger": s["finger"], "x": round(x, 1), "y": round(y, 1)})
        t, x, y = pts[-1]
        out.append({"t": t, "type": "up", "finger": s["finger"], "x": round(x, 1), "y": round(y, 1)})
    order = {"down": 0, "move": 1, "up": 2}
    out.sort(key=lambda e: (e["t"], order[e["type"]]))
    return out


def resample(points: Iterable, n: int = 64) -> list[tuple[float, float]]:
    """Resample a stroke's (x, y) path to n evenly spaced points."""
    pts = [(float(p[1]), float(p[2])) if len(p) > 2 else (float(p[0]), float(p[1])) for p in points]
    if len(pts) == 1:
        return pts * n
    total = sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))
    if total == 0:
        return [pts[0]] * n
    step = total / (n - 1)
    out = [pts[0]]
    acc = 0.0
    i = 1
    prev = pts[0]
    while i < len(pts) and len(out) < n:
        cur = pts[i]
        d = math.dist(prev, cur)
        if acc + d >= step and d > 0:
            r = (step - acc) / d
            q = (prev[0] + r * (cur[0] - prev[0]), prev[1] + r * (cur[1] - prev[1]))
            out.append(q)
            prev = q
            acc = 0.0
        else:
            acc += d
            prev = cur
            i += 1
    while len(out) < n:
        out.append(pts[-1])
    return out


def _normalize_path(pts: list[tuple[float, float]]) -> list[tuple[float, float]]:
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    span = max(max(abs(p[0] - cx) for p in pts), max(abs(p[1] - cy) for p in pts)) or 1.0
    return [((p[0] - cx) / span, (p[1] - cy) / span) for p in pts]


def similarity(a: dict, b: dict, n: int = 64) -> float:
    """Shape similarity 0..1 between two gestures (position/size invariant, per finger order).

    Uses screen-pixel aspect so a circle on a tall phone stays a circle.
    """
    if len(a["strokes"]) != len(b["strokes"]):
        return 0.0
    scores = []
    for sa, sb in zip(sorted(a["strokes"], key=lambda s: s["points"][0][0]),
                      sorted(b["strokes"], key=lambda s: s["points"][0][0])):
        pa = _normalize_path(resample([(0, p[1] * a["screen"]["width_px"], p[2] * a["screen"]["height_px"]) for p in sa["points"]], n))
        pb = _normalize_path(resample([(0, p[1] * b["screen"]["width_px"], p[2] * b["screen"]["height_px"]) for p in sb["points"]], n))
        d = sum(math.dist(p, q) for p, q in zip(pa, pb)) / n
        scores.append(max(0.0, 1 - d / 1.0))
    return round(sum(scores) / len(scores), 3)


def to_svg(g: dict, width: int = 300) -> str:
    """Static SVG picture of the gesture (finger paths, start dot, end arrow)."""
    w, h = g["screen"]["width_px"], g["screen"]["height_px"]
    W = width
    H = round(width * h / w)
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">',
             f'<rect width="{W}" height="{H}" rx="14" fill="#1b1d20"/>']
    for s in g["strokes"]:
        c = FINGER_COLORS[s["finger"] % len(FINGER_COLORS)]
        pts = " ".join(f"{p[1] * W:.1f},{p[2] * H:.1f}" for p in s["points"])
        x0, y0 = s["points"][0][1] * W, s["points"][0][2] * H
        x1, y1 = s["points"][-1][1] * W, s["points"][-1][2] * H
        parts.append(f'<polyline points="{pts}" fill="none" stroke="{c}" stroke-width="5" '
                     f'stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>')
        parts.append(f'<circle cx="{x0:.1f}" cy="{y0:.1f}" r="8" fill="{c}" stroke="#fff" stroke-width="2"/>')
        parts.append(f'<circle cx="{x1:.1f}" cy="{y1:.1f}" r="4" fill="#fff"/>')
    label = (g.get("name") or g["id"]).replace("&", "&amp;").replace("<", "&lt;")
    parts.append(f'<text x="10" y="{H - 10}" fill="#9aa0a6" font-family="sans-serif" font-size="12">{label}</text>')
    parts.append("</svg>")
    return "".join(parts)


# --------------------------------------------------------------------------
# file store: one JSON file per gesture + a regenerated index.json catalog
class GestureStore:
    def __init__(self, directory: str | os.PathLike):
        self.dir = Path(directory)
        self.dir.mkdir(parents=True, exist_ok=True)

    def path(self, gid: str) -> Path:
        if not ID_RE.match(gid or ""):
            raise GestureError("bad gesture id")
        return self.dir / f"{gid}.json"

    def _atomic_write(self, path: Path, data: dict) -> None:
        fd, tmp = tempfile.mkstemp(dir=self.dir, suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=1, ensure_ascii=False)
            f.write("\n")
        os.replace(tmp, path)

    def all(self) -> list[dict]:
        out = []
        for p in sorted(self.dir.glob("g-*.json")):
            try:
                out.append(load_gesture(p))
            except (OSError, json.JSONDecodeError):
                continue
        out.sort(key=lambda g: g.get("created_at", ""), reverse=True)
        return out

    @staticmethod
    def entry(g: dict) -> dict:
        return {
            "id": g["id"], "name": g.get("name", ""), "created_at": g.get("created_at"),
            "label": g.get("summary", {}).get("label"),
            "duration_ms": g.get("duration_ms"), "finger_count": g.get("finger_count"),
            "stroke_count": len(g.get("strokes", [])),
            "file": f"{g['id']}.json",
        }

    def list(self) -> list[dict]:
        return [self.entry(g) for g in self.all()]

    def get(self, gid: str) -> dict | None:
        p = self.path(gid)
        return load_gesture(p) if p.exists() else None

    def save(self, g: dict) -> dict:
        clean = validate(g)
        self._atomic_write(self.path(clean["id"]), clean)
        self.reindex()
        return clean

    def rename(self, gid: str, name: str) -> dict | None:
        g = self.get(gid)
        if g is None:
            return None
        g["name"] = (name or "").strip()[:MAX_NAME]
        self._atomic_write(self.path(gid), g)
        self.reindex()
        return g

    def delete(self, gid: str) -> bool:
        p = self.path(gid)
        if not p.exists():
            return False
        p.unlink()
        self.reindex()
        return True

    def reindex(self) -> None:
        self._atomic_write(self.dir / "index.json", {
            "format": FORMAT,
            "note": "Catalog only; each gesture lives in its own <id>.json file next to this one.",
            "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "gestures": self.list(),
        })
