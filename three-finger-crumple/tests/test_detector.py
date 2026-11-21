import json
import random
import shutil
import subprocess
from pathlib import Path

import pytest

import gesture_lib as gl
from detector import load_config, run_events
from tests import synth

ROOT = Path(__file__).resolve().parents[1]
CFG = load_config()
RECORDINGS = sorted((ROOT / "gestures").glob("g-*.json"))


def kind_of(name):
    return "pinch" if "pinch" in name.lower() else "expand"


def committed(log):
    return [e["kind"] for e in log if e["type"] == "commit"]


@pytest.mark.parametrize("path", RECORDINGS, ids=lambda p: p.stem)
def test_recordings_recognized(path):
    g = gl.load_gesture(path)
    kind = kind_of(g["name"])
    start = "full" if kind == "pinch" else "crumpled"
    end, log = run_events(gl.events(g), CFG, start)
    assert committed(log) == [kind], log[-3:]
    assert end == ("crumpled" if kind == "pinch" else "full")
    prog = [e["p"] for e in log if e["type"] == "progress"]
    assert prog and prog[-1] > 0.6        # animation tracked the fingers most of the way


@pytest.mark.parametrize("path", RECORDINGS, ids=lambda p: p.stem)
def test_recordings_ignored_in_wrong_state(path):
    g = gl.load_gesture(path)
    kind = kind_of(g["name"])
    start = "crumpled" if kind == "pinch" else "full"
    end, log = run_events(gl.events(g), CFG, start)
    assert committed(log) == [] and end == start


@pytest.mark.parametrize("seed", range(200))
def test_any_three_finger_pinch_and_expand(seed):
    rng = random.Random(seed)
    g = synth.pinch3(rng)
    assert committed(run_events(gl.events(g), CFG, "full")[1]) == ["pinch"]
    g = synth.expand3(rng)
    assert committed(run_events(gl.events(g), CFG, "crumpled")[1]) == ["expand"]


@pytest.mark.parametrize("name", list(synth.NEGATIVES))
@pytest.mark.parametrize("seed", range(25))
def test_other_gestures_rejected(name, seed):
    rng = random.Random(seed * 31 + 7)
    g = synth.NEGATIVES[name](rng)
    for state in ("full", "crumpled"):
        end, log = run_events(gl.events(g), CFG, state)
        assert committed(log) == [] and end == state, (name, state, log[-2:])


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_js_matches_python():
    cases = []
    for p in RECORDINGS:
        g = gl.load_gesture(p)
        for st in ("full", "crumpled"):
            cases.append({"events": gl.events(g), "state": st})
    rng = random.Random(99)
    for _ in range(40):
        cases.append({"events": gl.events(synth.pinch3(rng)), "state": "full"})
        cases.append({"events": gl.events(synth.expand3(rng)), "state": "crumpled"})
    for name, fn in synth.NEGATIVES.items():
        cases.append({"events": gl.events(fn(rng)), "state": "full"})
    script = r"""
const fs=require('fs'); global.window={};
eval(fs.readFileSync(process.argv[1],'utf8'));
const D=window.ThreeFingerDetector; const cfg=JSON.parse(fs.readFileSync(process.argv[2],'utf8')).thresholds;
const cases=JSON.parse(fs.readFileSync(0,'utf8')); const out=[];
for(const c of cases){const d=new D(cfg,c.state);const log=[];
 for(const e of c.events){log.push(...d[e.type](e.finger,e.t,e.x,e.y));}
 out.push({state:d.state,commits:log.filter(e=>e.type==='commit').map(e=>e.kind),
           types:log.map(e=>e.type), p:log.filter(e=>e.type==='progress').map(e=>Math.round(e.p*1000))});}
process.stdout.write(JSON.stringify(out));
"""
    r = subprocess.run(["node", "-e", script, str(ROOT / "static" / "detector.js"), str(ROOT / "detector.json")],
                       input=json.dumps(cases), capture_output=True, text=True, check=True)
    js = json.loads(r.stdout)
    for c, j in zip(cases, js):
        st, log = run_events(c["events"], CFG, c["state"])
        assert j["state"] == st
        assert j["commits"] == committed(log)
        assert j["types"] == [e["type"] for e in log]
        assert j["p"] == [round(e["p"] * 1000) for e in log if e["type"] == "progress"]
