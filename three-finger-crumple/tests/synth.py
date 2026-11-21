"""Synthetic gesture generators (gesture-recorder/v1 format) for detector tests."""
import math
import random

W, H = 402, 758


def _g(strokes, name):
    return {"id": "g-20990101-000000-0000", "name": name, "screen": {"width_px": W, "height_px": H},
            "strokes": [{"finger": i, "points": p} for i, p in enumerate(strokes)]}


def radial(rng, n, r0, r1, rot_deg=0.0, center=None, dur=None, offsets=True, translate=(0, 0), jit=0.15):
    cx, cy = center or (rng.uniform(110, W - 110), rng.uniform(150, H - 150))
    dur = dur or rng.uniform(120, 600)
    base = rng.uniform(0, 2 * math.pi)
    strokes = []
    for i in range(n):
        a = base + i * 2 * math.pi / n + rng.uniform(-0.45, 0.45)
        rf0 = r0 * rng.uniform(1 - jit, 1 + jit)
        rf1 = r1 * rng.uniform(1 - jit, 1 + jit)
        t0 = rng.uniform(0, 50) if offsets else 0
        t1 = dur + (rng.uniform(-40, 40) if offsets else 0)
        k = max(6, int((t1 - t0) / 8))
        pts = []
        for j in range(k + 1):
            u = j / k
            e = u * u * (3 - 2 * u)
            ang = a + math.radians(rot_deg) * e
            r = rf0 + (rf1 - rf0) * e
            x = cx + translate[0] * e + r * math.cos(ang) + rng.gauss(0, 1.2)
            y = cy + translate[1] * e + r * math.sin(ang) + rng.gauss(0, 1.2)
            pts.append([t0 + (t1 - t0) * u, x / W, y / H, 0])
        strokes.append(pts)
    return strokes


def pinch3(rng):
    r0 = rng.uniform(70, 200)
    return _g(radial(rng, 3, r0, r0 * rng.uniform(0.05, 0.5), rot_deg=rng.uniform(-25, 25)), "synthetic 3 pinch")


def expand3(rng):
    r0 = rng.uniform(25, 90)
    return _g(radial(rng, 3, r0, r0 * rng.uniform(1.6, 4.0), rot_deg=rng.uniform(-25, 25)), "synthetic 3 expand")


NEGATIVES = {
    "2-finger pinch": lambda rng: _g(radial(rng, 2, 150, 30), "neg"),
    "2-finger expand": lambda rng: _g(radial(rng, 2, 40, 150), "neg"),
    "4-finger pinch": lambda rng: _g(radial(rng, 4, 150, 30), "neg"),
    "4-finger expand": lambda rng: _g(radial(rng, 4, 40, 150), "neg"),
    "5-finger pinch": lambda rng: _g(radial(rng, 5, 160, 30), "neg"),
    "1-finger swipe": lambda rng: _g(radial(rng, 1, 0, 0, translate=(0, -300)), "neg"),
    "3-finger swipe": lambda rng: _g(radial(rng, 3, 70, 70, translate=(rng.choice([-1, 1]) * 150, -250)), "neg"),
    "3-finger rotate": lambda rng: _g(radial(rng, 3, 110, 110, rot_deg=rng.choice([-1, 1]) * 120), "neg"),
    "3-finger slight expand (20%)": lambda rng: _g(radial(rng, 3, 60, 72, jit=0.05), "neg"),
    "3-finger tap": lambda rng: _g(radial(rng, 3, 60, 60, dur=80), "neg"),
    "3-finger slight pinch (17%)": lambda rng: _g(radial(rng, 3, 150, 125, jit=0.05), "neg"),
}


def staggered_three(rng):
    """Three single taps landing far apart in time — not a 3-finger gesture."""
    strokes = []
    for i in range(3):
        x, y = rng.uniform(.2, .8), rng.uniform(.2, .8)
        t = i * 450
        strokes.append([[t, x, y, 0], [t + 60, x, y, 0]])
    return _g(strokes, "neg")


NEGATIVES["3 separate taps"] = staggered_three
