"""Streaming 3-finger pinch / expand detector (Python reference).

Mirrors static/detector.js exactly; tests/test_detector.py checks they agree.
Feed it touch events in time order:  d.down(id, t, x, y) / d.move(...) / d.up(...)
Each call returns a list of events:
  {"type": "engage", "kind": "pinch"|"expand", "center": (x, y)}
  {"type": "progress", "kind": ..., "p": 0..1, "center": (x, y)}
  {"type": "commit", "kind": ...}               -> recognized
  {"type": "cancel", "kind": ..., "reason": str} -> engaged but not recognized
  {"type": "reject", "reason": str}              -> not a 3-finger pinch/expand
"""
from __future__ import annotations

import json
import math
from pathlib import Path

CONFIG_PATH = Path(__file__).resolve().parent / "detector.json"


def load_config(path: str | Path = CONFIG_PATH) -> dict:
    return json.loads(Path(path).read_text())["thresholds"]


def _centroid(ps):
    n = len(ps)
    return (sum(p[0] for p in ps) / n, sum(p[1] for p in ps) / n)


def _spread(ps):
    c = _centroid(ps)
    return sum(math.hypot(p[0] - c[0], p[1] - c[1]) for p in ps) / len(ps)


def features(start, cur):
    """ratio (spread now / spread at start), mean radial direction (-1 in .. +1 out), mean rotation (deg)."""
    s0, s1 = _spread(start), _spread(cur)
    c0, c1 = _centroid(start), _centroid(cur)
    radial, rot = [], []
    for a, b in zip(start, cur):
        rx, ry = a[0] - c0[0], a[1] - c0[1]
        dx, dy = b[0] - a[0], b[1] - a[1]
        rn, dn = math.hypot(rx, ry), math.hypot(dx, dy)
        radial.append((rx * dx + ry * dy) / (rn * dn) if rn > 0 and dn > 0 else 0.0)
        a0 = math.atan2(a[1] - c0[1], a[0] - c0[0])
        a1 = math.atan2(b[1] - c1[1], b[0] - c1[0])
        da = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
        rot.append(math.degrees(da))
    return {
        "ratio": s1 / s0 if s0 > 0 else 1.0,
        "radial": sum(radial) / len(radial),
        "rotation": sum(rot) / len(rot),
        "center": c1,
        "start_center": c0,
        "start_spread": s0,
    }


class Detector:
    def __init__(self, cfg: dict | None = None, state: str = "full"):
        self.cfg = cfg or load_config()
        self.state = state          # "full" (blue showing) or "crumpled"
        self.s = None               # current touch session

    # -- session helpers --
    def _new(self, t):
        self.s = {"t0": t, "fingers": {}, "order": [], "base": None, "status": "waiting",
                  "engaged": None, "reason": None, "center": None, "last": None}

    def _reject(self, reason, out):
        s = self.s
        if s["status"] == "rejected":
            return
        if s["engaged"]:
            out.append({"type": "cancel", "kind": s["engaged"], "reason": reason})
        else:
            out.append({"type": "reject", "reason": reason})
        s["status"] = "rejected"
        s["reason"] = reason

    def _cur(self):
        return [self.s["fingers"][i]["cur"] for i in self.s["order"]]

    # -- events --
    def down(self, pid, t, x, y):
        out = []
        if self.s is None:
            self._new(t)
        s, c = self.s, self.cfg
        s["fingers"][pid] = {"cur": (x, y), "up": False}
        s["order"].append(pid)
        if s["status"] == "rejected":
            return out
        n = len(s["order"])
        if n > 3:
            self._reject("more than 3 fingers", out)
        elif n == 3:
            if t - s["t0"] > c["max_touchdown_spread_ms"]:
                self._reject("fingers didn't land together", out)
            elif any(f["up"] for f in s["fingers"].values()):
                self._reject("a finger lifted before all 3 were down", out)
            else:
                s["base"] = self._cur()
                s["status"] = "tracking"
        return out

    def move(self, pid, t, x, y):
        out = []
        s = self.s
        if s is None or pid not in s["fingers"]:
            return out
        s["fingers"][pid]["cur"] = (x, y)
        if s["status"] != "tracking":
            return out
        c = self.cfg
        f = features(s["base"], self._cur())
        s["last"] = f
        if abs(f["rotation"]) > c["max_rotation_deg"]:
            self._reject("rotation, not a pinch", out)
            return out
        if not s["engaged"]:
            if (self.state == "full" and f["ratio"] < c["engage_pinch_ratio"]
                    and f["radial"] < c["engage_radial"] * -1 and f["start_spread"] >= c["min_pinch_start_spread_px"]):
                s["engaged"] = "pinch"
            elif (self.state == "crumpled" and f["ratio"] > c["engage_expand_ratio"]
                    and f["radial"] > c["engage_radial"]):
                s["engaged"] = "expand"
                s["center"] = f["start_center"]   # uncrumple from where the expansion starts
            if s["engaged"]:
                out.append({"type": "engage", "kind": s["engaged"],
                            "center": f["center"] if s["engaged"] == "pinch" else s["center"]})
        if s["engaged"] == "pinch":
            p = (1 - f["ratio"]) / (1 - c["pinch_target_ratio"])
            out.append({"type": "progress", "kind": "pinch", "p": max(0.0, min(1.0, p)), "center": f["center"]})
        elif s["engaged"] == "expand":
            p = (f["ratio"] - 1) / (c["expand_target_ratio"] - 1)
            out.append({"type": "progress", "kind": "expand", "p": max(0.0, min(1.0, p)), "center": s["center"]})
        return out

    def up(self, pid, t, x, y):
        out = self.move(pid, t, x, y)
        s = self.s
        if s is None or pid not in s["fingers"]:
            return out
        s["fingers"][pid]["up"] = True
        if s["status"] == "waiting" and len(s["order"]) < 3:
            pass  # still might be a stray finger; resolved when all are up
        if all(f["up"] for f in s["fingers"].values()):
            out += self._finish()
        return out

    def _finish(self):
        out = []
        s, c = self.s, self.cfg
        self.s = None
        if s["status"] == "rejected":
            return out
        if len(s["order"]) < 3:
            out.append({"type": "reject", "reason": f"{len(s['order'])} finger(s) only"})
            return out
        f = s["last"] or {"ratio": 1, "radial": 0}
        kind = s["engaged"]
        if kind == "pinch":
            if f["ratio"] <= c["commit_pinch_max_ratio"] and f["radial"] <= c["commit_radial"] * -1:
                self.state = "crumpled"
                out.append({"type": "commit", "kind": "pinch"})
            else:
                out.append({"type": "cancel", "kind": "pinch", "reason": "pinch too small"})
        elif kind == "expand":
            if f["ratio"] >= c["commit_expand_min_ratio"] and f["radial"] >= c["commit_radial"]:
                self.state = "full"
                out.append({"type": "commit", "kind": "expand"})
            else:
                out.append({"type": "cancel", "kind": "expand", "reason": "expansion too small"})
        else:
            if self.state == "full" and f["ratio"] >= c["commit_expand_min_ratio"]:
                reason = "expansion (nothing to uncrumple)"
            elif self.state == "crumpled" and f["ratio"] <= c["commit_pinch_max_ratio"]:
                reason = "pinch (already crumpled)"
            else:
                reason = "not a pinch or expansion"
            out.append({"type": "reject", "reason": reason})
        return out


def run_events(events, cfg=None, state="full"):
    """Replay a gesture_lib.events() stream; return (final_state, list_of_detector_events)."""
    d = Detector(cfg, state)
    log = []
    for e in events:
        fn = {"down": d.down, "move": d.move, "up": d.up}[e["type"]]
        log += fn(e["finger"], e["t"], e["x"], e["y"])
    return d.state, log
