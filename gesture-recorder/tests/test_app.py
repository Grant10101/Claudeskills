import json
import math
import subprocess
import shutil
from pathlib import Path

import pytest

import gesture_lib as gl
from app import create_app

ROOT = Path(__file__).resolve().parents[1]


def make(strokes, gid="g-20261121-060000-abcd", w=390, h=844, name=""):
    return {"id": gid, "name": name, "screen": {"width_px": w, "height_px": h},
            "strokes": [{"finger": i, "points": p} for i, p in enumerate(strokes)]}


def line(x0, y0, x1, y1, t0=0, dur=300, n=20):
    return [[t0 + dur * i / (n - 1), x0 + (x1 - x0) * i / (n - 1), y0 + (y1 - y0) * i / (n - 1), 0.5] for i in range(n)]


def circle(cx, cy, r, cw=True, n=40, dur=800, aspect=844 / 390):
    s = 1 if cw else -1
    return [[dur * i / (n - 1), cx + r * math.cos(s * 2 * math.pi * i / (n - 1)),
             cy + r / aspect * math.sin(s * 2 * math.pi * i / (n - 1)), 0.5] for i in range(n)]


CASES = {
    "tap": make([line(.5, .5, .5, .5, dur=90, n=3)]),
    "long-press": make([line(.5, .5, .501, .5, dur=800, n=10)]),
    "swipe-up": make([line(.5, .8, .5, .2)]),
    "swipe-left": make([line(.8, .5, .2, .5)]),
    "swipe-down-right": make([line(.2, .2, .7, .45)]),
    "circle-clockwise": make([circle(.5, .5, .3, cw=True)]),
    "circle-counterclockwise": make([circle(.5, .5, .3, cw=False)]),
    "pinch-in": make([line(.2, .3, .45, .45), line(.8, .7, .55, .55)]),
    "pinch-out": make([line(.45, .45, .2, .3), line(.55, .55, .8, .7)]),
    "2-finger swipe-up": make([line(.4, .8, .4, .3), line(.6, .8, .6, .3)]),
    "double-tap": make([line(.5, .5, .5, .5, dur=80, n=3), line(.5, .5, .5, .5, t0=200, dur=80, n=3)]),
    "2-finger tap": make([line(.4, .5, .4, .5, dur=80, n=3), line(.6, .5, .6, .5, dur=80, n=3)]),
}


@pytest.mark.parametrize("label", list(CASES))
def test_summarize_labels(label):
    g = gl.validate(CASES[label])
    assert g["summary"]["label"] == label


def test_rotate():
    a = [[i * 20, .5 + .2 * math.cos(math.pi * i / 30), .5 + .2 * 390 / 844 * math.sin(math.pi * i / 30), .5] for i in range(16)]
    b = [[i * 20, .5 - .2 * math.cos(math.pi * i / 30), .5 - .2 * 390 / 844 * math.sin(math.pi * i / 30), .5] for i in range(16)]
    g = gl.validate(make([a, b]))
    assert g["summary"]["label"] == "2-finger rotate-clockwise"


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_js_python_parity():
    """static/core.js summarize() must agree with gesture_lib.summarize()."""
    cleaned = {k: gl.validate(v) for k, v in CASES.items()}
    script = ("const C=require(process.argv[1]);const d=JSON.parse(require('fs').readFileSync(0,'utf8'));"
              "const o={};for(const k in d)o[k]=C.summarize(d[k]);process.stdout.write(JSON.stringify(o));")
    out = subprocess.run(["node", "-e", script, str(ROOT / "static" / "core.js")],
                         input=json.dumps(cleaned), capture_output=True, text=True, check=True)
    js = json.loads(out.stdout)
    for k, g in cleaned.items():
        assert js[k] == g["summary"], k


def test_validation_rejects_bad():
    with pytest.raises(gl.GestureError):
        gl.validate({"id": "../etc/passwd", "screen": {"width_px": 1, "height_px": 1}, "strokes": []})
    with pytest.raises(gl.GestureError):
        gl.validate(make([[[10, .1, .1], [5, .2, .2]]]))  # time goes backwards


def test_reuse_helpers():
    g = gl.validate(CASES["swipe-up"])
    px = gl.to_pixels(g, 1000, 2000)
    assert px[0]["points"][0][1] == pytest.approx(500)
    ev = gl.events(g)
    assert ev[0]["type"] == "down" and ev[-1]["type"] == "up"
    assert gl.similarity(g, gl.validate(CASES["swipe-up"])) == pytest.approx(1.0)
    assert gl.similarity(gl.validate(CASES["circle-clockwise"]), g) < 0.8
    assert gl.to_svg(g).startswith("<svg")


@pytest.fixture
def client(tmp_path):
    app = create_app(base_path="/gestures", gesture_dir=str(tmp_path))
    app.config["TESTING"] = True
    return app.test_client(), tmp_path


def test_api_roundtrip(client):
    c, d = client
    assert c.get("/gestures").status_code == 301
    html = c.get("/gestures/").get_data(as_text=True)
    assert 'content="/gestures/api"' in html
    assert c.get("/gestures/static/core.js").status_code == 200

    g = CASES["swipe-up"]
    r = c.post("/gestures/api/gestures", json=g)
    assert r.status_code == 201
    gid = g["id"]
    assert (d / f"{gid}.json").exists()
    idx = json.loads((d / "index.json").read_text())
    assert idx["gestures"][0]["id"] == gid

    assert c.get("/gestures/api/gestures").get_json()[0]["label"] == "swipe-up"
    assert c.get(f"/gestures/api/gestures/{gid}").get_json()["summary"]["label"] == "swipe-up"
    assert c.get(f"/gestures/api/gestures/{gid}.svg").mimetype == "image/svg+xml"
    assert c.patch(f"/gestures/api/gestures/{gid}", json={"name": "Up!"}).get_json()["name"] == "Up!"
    assert json.loads((d / f"{gid}.json").read_text())["name"] == "Up!"
    assert c.delete(f"/gestures/api/gestures/{gid}").status_code == 200
    assert not (d / f"{gid}.json").exists()
    assert c.get(f"/gestures/api/gestures/{gid}").status_code == 404
    assert c.post("/gestures/api/gestures", json={"bad": 1}).status_code == 400


def test_write_token(tmp_path):
    app = create_app(base_path="/gestures", gesture_dir=str(tmp_path), write_token="s3cret")
    c = app.test_client()
    assert c.post("/gestures/api/gestures", json=CASES["tap"]).status_code == 401
    r = c.post("/gestures/api/gestures", json=CASES["tap"], headers={"X-Gesture-Token": "s3cret"})
    assert r.status_code == 201
    assert c.get("/gestures/api/gestures").status_code == 200  # reads stay open
