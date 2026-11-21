"""Gesture Recorder — Flask web app.

Serves the phone UI and a small JSON API. Every gesture is saved as its own
file: <GESTURE_DIR>/<id>.json (default ./gestures).

Environment:
  BASE_PATH            URL prefix the app lives under (default "/gestures")
  GESTURE_DIR          where gesture files are written (default ./gestures)
  GESTURE_WRITE_TOKEN  optional; if set, saving/renaming/deleting needs it
                       (sent as the X-Gesture-Token header)
  PORT                 port for `python app.py` (default 8000)
"""
from __future__ import annotations

import hmac
import os
from pathlib import Path

from flask import Blueprint, Flask, Response, abort, jsonify, redirect, request, send_from_directory

from gesture_lib import GestureError, GestureStore, to_svg

HERE = Path(__file__).resolve().parent
STATIC = HERE / "static"


def create_app(base_path: str | None = None, gesture_dir: str | None = None,
               write_token: str | None = None) -> Flask:
    base = (base_path if base_path is not None else os.environ.get("BASE_PATH", "/gestures")).rstrip("/")
    store = GestureStore(gesture_dir or os.environ.get("GESTURE_DIR", HERE / "gestures"))
    token = write_token if write_token is not None else os.environ.get("GESTURE_WRITE_TOKEN", "")

    app = Flask(__name__, static_folder=None)
    app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024
    app.config["STORE"] = store
    bp = Blueprint("gestures", __name__, url_prefix=base or None)

    def require_token():
        if token and not hmac.compare_digest(request.headers.get("X-Gesture-Token", ""), token):
            abort(401, "write token required")

    @bp.get("/")
    def index():
        html = (STATIC / "index.html").read_text(encoding="utf-8")
        api = f"{base}/api"
        html = html.replace('<meta name="gesture-api" content="">',
                            f'<meta name="gesture-api" content="{api}">')
        if token:
            html = html.replace('<meta name="gesture-token-required" content="0">',
                                '<meta name="gesture-token-required" content="1">')
        resp = Response(html, mimetype="text/html")
        resp.headers["Cache-Control"] = "no-cache"
        return resp

    @bp.get("/static/<path:fname>")
    def static_files(fname):
        resp = send_from_directory(STATIC, fname)
        resp.headers["Cache-Control"] = "no-cache"
        return resp

    @bp.get("/api/health")
    def health():
        return {"ok": True, "count": len(store.list())}

    @bp.get("/api/gestures")
    def list_gestures():
        return jsonify(store.list())

    @bp.get("/api/gestures/<gid>")
    def get_gesture(gid):
        try:
            g = store.get(gid)
        except GestureError:
            abort(404)
        if g is None:
            abort(404)
        return jsonify(g)

    @bp.get("/api/gestures/<gid>.svg")
    def gesture_svg(gid):
        try:
            g = store.get(gid)
        except GestureError:
            abort(404)
        if g is None:
            abort(404)
        return Response(to_svg(g), mimetype="image/svg+xml")

    @bp.get("/api/gestures/<gid>/download")
    def download(gid):
        try:
            p = store.path(gid)
        except GestureError:
            abort(404)
        if not p.exists():
            abort(404)
        return send_from_directory(store.dir, p.name, as_attachment=True)

    @bp.post("/api/gestures")
    def create():
        require_token()
        data = request.get_json(silent=True)
        try:
            g = store.save(data)
        except GestureError as e:
            return jsonify(error=str(e)), 400
        return jsonify(g), 201

    @bp.patch("/api/gestures/<gid>")
    def rename(gid):
        require_token()
        data = request.get_json(silent=True) or {}
        try:
            g = store.rename(gid, str(data.get("name", "")))
        except GestureError:
            abort(404)
        if g is None:
            abort(404)
        return jsonify(g)

    @bp.delete("/api/gestures/<gid>")
    def delete(gid):
        require_token()
        try:
            ok = store.delete(gid)
        except GestureError:
            abort(404)
        if not ok:
            abort(404)
        return jsonify(deleted=gid)

    app.register_blueprint(bp)

    if base:
        @app.get(base)
        def no_slash():
            return redirect(base + "/", code=301)

        @app.get("/")
        def root():
            return redirect(base + "/", code=302)

    @app.errorhandler(401)
    @app.errorhandler(404)
    @app.errorhandler(413)
    def err(e):
        return jsonify(error=e.description if hasattr(e, "description") else str(e)), e.code

    return app


app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    try:
        from waitress import serve
        print(f"Gesture Recorder on http://0.0.0.0:{port}{os.environ.get('BASE_PATH', '/gestures')}/")
        serve(app, host="0.0.0.0", port=port)
    except ImportError:
        app.run(host="0.0.0.0", port=port)
