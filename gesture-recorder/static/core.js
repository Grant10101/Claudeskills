/* Gesture Recorder — shared core (browser + Node).
 * - FORMAT constant and gesture builder helpers
 * - summarize(): human/AI-readable description of a gesture
 *   (kept in sync with summarize() in gesture_lib.py; tests/test_core_parity.py checks it)
 * - GesturePlayer: canvas playback with finger dots + vanishing trails
 */
(function (root) {
  "use strict";

  var FORMAT = "gesture-recorder/v1";
  var FINGER_COLORS = ["#ff8a1f", "#22d3ee", "#a3e635", "#f472b6", "#facc15",
                       "#60a5fa", "#fb7185", "#34d399", "#c084fc", "#f8fafc"];

  // ---------- geometry helpers ----------
  function round(v, n) { var p = Math.pow(10, n); return Math.round(v * p) / p; }

  var DIRS = ["right", "down-right", "down", "down-left", "left", "up-left", "up", "up-right"];
  function direction(dx, dy) {
    // screen coords: +y is down
    var a = Math.atan2(dy, dx);              // -pi..pi, 0 = right
    var idx = Math.round(a / (Math.PI / 4));  // -4..4
    return DIRS[(idx + 8) % 8];
  }

  function strokeStats(stroke, w, h) {
    var pts = stroke.points;
    var first = pts[0], last = pts[pts.length - 1];
    var pathLen = 0, area = 0;
    for (var i = 1; i < pts.length; i++) {
      var ax = pts[i - 1][1] * w, ay = pts[i - 1][2] * h;
      var bx = pts[i][1] * w, by = pts[i][2] * h;
      pathLen += Math.hypot(bx - ax, by - ay);
      area += ax * by - bx * ay; // shoelace (screen coords)
    }
    var dx = (last[1] - first[1]) * w, dy = (last[2] - first[2]) * h;
    var dist = Math.hypot(dx, dy);
    var dur = last[0] - first[0];
    var minDim = Math.min(w, h);
    var kind;
    if (pathLen < Math.max(14, 0.035 * minDim)) {
      kind = dur >= 500 ? "long-press" : (dur < 300 ? "tap" : "press");
    } else if (dist / pathLen > 0.8) {
      kind = "swipe-" + direction(dx, dy);
    } else if (dist < 0.25 * pathLen && pathLen > 0.25 * minDim) {
      // positive shoelace area in screen coords (y down) = clockwise on screen
      kind = (area > 0 ? "circle-clockwise" : "circle-counterclockwise");
    } else {
      kind = "curve";
    }
    return {
      finger: stroke.finger,
      kind: kind,
      t_start: first[0],
      t_end: last[0],
      duration_ms: dur,
      start: [round(first[1], 3), round(first[2], 3)],
      end: [round(last[1], 3), round(last[2], 3)],
      net_px: [Math.round(dx), Math.round(dy)],
      path_length_px: Math.round(pathLen),
      straightness: pathLen > 0 ? round(dist / pathLen, 2) : 1
    };
  }

  function overlaps(a, b) { return a.t_start <= b.t_end && b.t_start <= a.t_end; }

  function pointAt(stroke, t) {
    var pts = stroke.points, best = pts[0];
    for (var i = 0; i < pts.length; i++) { if (pts[i][0] <= t) best = pts[i]; else break; }
    return best;
  }

  function summarize(g) {
    var w = g.screen.width_px, h = g.screen.height_px;
    var strokes = g.strokes.filter(function (s) { return s.points && s.points.length; });
    var stats = strokes.map(function (s) { return strokeStats(s, w, h); });
    var maxSim = 0;
    stats.forEach(function (s) {
      var c = stats.filter(function (o) { return overlaps(s, o); }).length;
      if (c > maxSim) maxSim = c;
    });
    var label;
    if (stats.length === 0) {
      label = "empty";
    } else if (stats.length === 1) {
      label = stats[0].kind;
    } else {
      var allOverlap = stats.every(function (s) { return stats.every(function (o) { return overlaps(s, o); }); });
      var kinds = stats.map(function (s) { return s.kind; });
      var same = kinds.every(function (k) { return k === kinds[0]; });
      var stationary = function (k) { return /^(tap|press|long-press)$/.test(k); };
      if (allOverlap && stats.length === 2 && !kinds.every(stationary)) {
        // two simultaneous moving fingers: pinch / spread / rotate
        var a = strokes[0], b = strokes[1];
        var t0 = Math.max(stats[0].t_start, stats[1].t_start), t1 = Math.min(stats[0].t_end, stats[1].t_end);
        var pa0 = pointAt(a, t0), pb0 = pointAt(b, t0), pa1 = pointAt(a, t1), pb1 = pointAt(b, t1);
        var d0 = Math.hypot((pa0[1] - pb0[1]) * w, (pa0[2] - pb0[2]) * h);
        var d1 = Math.hypot((pa1[1] - pb1[1]) * w, (pa1[2] - pb1[2]) * h);
        var ang0 = Math.atan2((pb0[2] - pa0[2]) * h, (pb0[1] - pa0[1]) * w);
        var ang1 = Math.atan2((pb1[2] - pa1[2]) * h, (pb1[1] - pa1[1]) * w);
        var dAng = (ang1 - ang0) * 180 / Math.PI;
        while (dAng > 180) dAng -= 360;
        while (dAng < -180) dAng += 360;
        var ratio = d0 > 0 ? d1 / d0 : 1;
        if (Math.abs(dAng) > 30) label = "2-finger rotate-" + (dAng > 0 ? "clockwise" : "counterclockwise");
        else if (ratio < 0.7) label = "pinch-in";
        else if (ratio > 1.4) label = "pinch-out";
        else if (same) label = "2-finger " + kinds[0];
        else label = "2-finger " + kinds.join(" + ");
      } else if (allOverlap && same) {
        label = stats.length + "-finger " + kinds[0];
      } else if (!allOverlap && same && /^(tap|press)$/.test(kinds[0])) {
        var n = stats.length;
        label = (n === 2 ? "double" : n === 3 ? "triple" : n + "x") + "-" + kinds[0];
      } else {
        label = "sequence: " + kinds.join(", ");
      }
    }
    var dur = 0;
    stats.forEach(function (s) { if (s.t_end > dur) dur = s.t_end; });
    return {
      label: label,
      stroke_count: stats.length,
      max_simultaneous_fingers: maxSim,
      duration_ms: dur,
      strokes: stats
    };
  }

  function makeId(date) {
    var d = date || new Date();
    function p(n) { return (n < 10 ? "0" : "") + n; }
    var rand = Math.floor(Math.random() * 0xffff).toString(16);
    while (rand.length < 4) rand = "0" + rand;
    return "g-" + d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + "-" +
      p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + "-" + rand;
  }

  // ---------- playback renderer ----------
  var TRAIL_MS = 420;

  function GesturePlayer(canvas, gesture, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.opts = Object.assign({ loop: true, pauseMs: 700, frame: true, trailMs: TRAIL_MS }, opts || {});
    this.setGesture(gesture);
    this._raf = null;
    this._start = 0;
  }
  GesturePlayer.prototype.setGesture = function (g) {
    this.g = g;
    this.duration = 0;
    if (g) g.strokes.forEach(function (s) {
      if (s.points.length) this.duration = Math.max(this.duration, s.points[s.points.length - 1][0]);
    }, this);
  };
  GesturePlayer.prototype.layout = function () {
    var c = this.canvas, dpr = (root.devicePixelRatio || 1);
    var cw = c.clientWidth, ch = c.clientHeight;
    if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) {
      c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr);
    }
    var sw = this.g ? this.g.screen.width_px : 9, sh = this.g ? this.g.screen.height_px : 16;
    if (this.opts.fullscreen) return { x: 0, y: 0, w: cw, h: ch, dpr: dpr, cw: cw, ch: ch };
    var pad = 10, s = Math.min((cw - pad * 2) / sw, (ch - pad * 2) / sh);
    var w = sw * s, h = sh * s;
    return { x: (cw - w) / 2, y: (ch - h) / 2, w: w, h: h, dpr: dpr, cw: cw, ch: ch };
  };
  GesturePlayer.prototype.drawAt = function (t) {
    var ctx = this.ctx, L = this.layout(), g = this.g, trail = this.opts.trailMs;
    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    ctx.clearRect(0, 0, L.cw, L.ch);
    if (this.opts.frame) {
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      roundRect(ctx, L.x, L.y, L.w, L.h, 14); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    }
    if (!g) return;
    var scale = Math.min(L.w, L.h);
    g.strokes.forEach(function (s) {
      var pts = s.points; if (!pts.length) return;
      var color = FINGER_COLORS[s.finger % FINGER_COLORS.length];
      var tStart = pts[0][0], tEnd = pts[pts.length - 1][0];
      if (t < tStart || t > tEnd + trail) return;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      // vanishing trail: segments within [t - trail, t], fading + tapering with age
      var prev = null;
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        if (p[0] > t) break;
        if (prev && p[0] >= t - trail) {
          var age = (t - p[0]) / trail;           // 0 = newest, 1 = oldest
          var a = Math.max(0, 1 - age);
          ctx.strokeStyle = hexA(color, a * 0.9);
          ctx.lineWidth = Math.max(1, scale * 0.028 * (0.25 + 0.75 * a));
          ctx.beginPath();
          ctx.moveTo(L.x + prev[1] * L.w, L.y + prev[2] * L.h);
          ctx.lineTo(L.x + p[1] * L.w, L.y + p[2] * L.h);
          ctx.stroke();
        }
        prev = p;
      }
      // finger dot
      var cur = pointAt(s, t);
      var lifted = t > tEnd;
      var fade = lifted ? Math.max(0, 1 - (t - tEnd) / 250) : 1;
      if (fade <= 0) return;
      var r = scale * 0.045 * (lifted ? 1 + (1 - fade) * 0.6 : 1);
      var cx = L.x + cur[1] * L.w, cy = L.y + cur[2] * L.h;
      ctx.save();
      ctx.shadowColor = color; ctx.shadowBlur = 14 * fade;
      ctx.fillStyle = hexA(color, 0.85 * fade);
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255,255,255," + (0.9 * fade) + ")"; ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    });
  };
  GesturePlayer.prototype.play = function () {
    var self = this;
    this.stop();
    this._start = performance.now();
    function tick(now) {
      var total = self.duration + self.opts.trailMs + self.opts.pauseMs;
      var t = now - self._start;
      if (t > total) {
        if (!self.opts.loop) { self.drawAt(self.duration + self.opts.trailMs); self._raf = null; return; }
        self._start = now; t = 0;
      }
      self.drawAt(t);
      self._raf = requestAnimationFrame(tick);
    }
    this._raf = requestAnimationFrame(tick);
  };
  GesturePlayer.prototype.stop = function () {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function hexA(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + a.toFixed(3) + ")";
  }

  var api = { FORMAT: FORMAT, FINGER_COLORS: FINGER_COLORS, summarize: summarize, makeId: makeId,
              direction: direction, GesturePlayer: GesturePlayer };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GestureCore = api;
})(typeof window !== "undefined" ? window : globalThis);
