"""Command-line tools for the gesture repository.

  python gestures_cli.py list                     # table of all gestures
  python gestures_cli.py show <id|name>           # summary + per-stroke description
  python gestures_cli.py svg <id|name> [out.svg]  # static picture
  python gestures_cli.py events <id|name> [W H]   # touch-event stream (optionally rescaled)
  python gestures_cli.py compare <a> <b>          # shape similarity 0..1
  python gestures_cli.py import <export.json>     # import gestures (a list, or {"gestures": [...]})
  python gestures_cli.py reindex                  # rebuild gestures/index.json

Set GESTURE_DIR to point at a different folder (default ./gestures).
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import gesture_lib as gl

STORE = gl.GestureStore(os.environ.get("GESTURE_DIR", Path(__file__).resolve().parent / "gestures"))


def find(ref: str) -> dict:
    if gl.ID_RE.match(ref):
        g = STORE.get(ref)
        if g:
            return g
    matches = [g for g in STORE.all() if g.get("name", "").lower() == ref.lower()]
    if not matches:
        sys.exit(f"no gesture matching {ref!r}")
    return matches[0]


def main(argv: list[str]) -> None:
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return
    cmd, args = argv[0], argv[1:]
    if cmd == "list":
        for e in STORE.list():
            print(f"{e['id']}  {e['name'][:28]:28}  {e['label'] or '':30}  {e['duration_ms']}ms  {e['finger_count']}f")
    elif cmd == "show":
        g = find(args[0])
        s = g["summary"]
        print(f"{g['name']} ({g['id']}) — {s['label']}, {s['duration_ms']} ms, "
              f"{s['max_simultaneous_fingers']} finger(s) at once, screen {g['screen']['width_px']}x{g['screen']['height_px']}")
        for st in s["strokes"]:
            print(f"  finger {st['finger']}: {st['kind']} from {st['start']} to {st['end']} "
                  f"({st['t_start']}–{st['t_end']} ms, {st['path_length_px']} px path)")
        print(f"  file: {STORE.path(g['id'])}")
    elif cmd == "svg":
        g = find(args[0])
        out = Path(args[1]) if len(args) > 1 else Path(f"{g['id']}.svg")
        out.write_text(gl.to_svg(g), encoding="utf-8")
        print(out)
    elif cmd == "events":
        g = find(args[0])
        w = float(args[1]) if len(args) > 2 else None
        h = float(args[2]) if len(args) > 2 else None
        print(json.dumps(gl.events(g, w, h), indent=1))
    elif cmd == "compare":
        print(gl.similarity(find(args[0]), find(args[1])))
    elif cmd == "import":
        data = json.loads(Path(args[0]).read_text(encoding="utf-8"))
        items = data.get("gestures", data) if isinstance(data, dict) else data
        n = 0
        for item in items:
            g = json.loads(item["json"]) if isinstance(item, dict) and "json" in item else item
            STORE.save(g)
            n += 1
        print(f"imported {n} gesture(s) into {STORE.dir}")
    elif cmd == "reindex":
        STORE.reindex()
        print(STORE.dir / "index.json")
    else:
        sys.exit(f"unknown command {cmd!r}; try --help")


if __name__ == "__main__":
    main(sys.argv[1:])
