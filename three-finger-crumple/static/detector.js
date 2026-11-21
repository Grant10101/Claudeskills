/* Streaming 3-finger pinch / expand detector — mirrors detector.py (tests check they agree). */
(function () {
  "use strict";
  function centroid(ps) {
    var x = 0, y = 0; ps.forEach(function (p) { x += p[0]; y += p[1]; });
    return [x / ps.length, y / ps.length];
  }
  function spread(ps) {
    var c = centroid(ps), s = 0;
    ps.forEach(function (p) { s += Math.hypot(p[0] - c[0], p[1] - c[1]); });
    return s / ps.length;
  }
  function pymod(a, n) { return ((a % n) + n) % n; }
  function features(start, cur) {
    var s0 = spread(start), s1 = spread(cur), c0 = centroid(start), c1 = centroid(cur);
    var rad = 0, rot = 0;
    for (var i = 0; i < start.length; i++) {
      var a = start[i], b = cur[i];
      var rx = a[0] - c0[0], ry = a[1] - c0[1], dx = b[0] - a[0], dy = b[1] - a[1];
      var rn = Math.hypot(rx, ry), dn = Math.hypot(dx, dy);
      rad += (rn > 0 && dn > 0) ? (rx * dx + ry * dy) / (rn * dn) : 0;
      var a0 = Math.atan2(a[1] - c0[1], a[0] - c0[0]), a1 = Math.atan2(b[1] - c1[1], b[0] - c1[0]);
      rot += pymod(a1 - a0 + Math.PI, 2 * Math.PI) - Math.PI;
    }
    return { ratio: s0 > 0 ? s1 / s0 : 1, radial: rad / start.length, rotation: rot / start.length * 180 / Math.PI,
             center: c1, start_center: c0, start_spread: s0 };
  }

  function Detector(cfg, state) {
    this.cfg = cfg; this.state = state || "full"; this.s = null;
  }
  Detector.prototype._new = function (t) {
    this.s = { t0: t, fingers: {}, order: [], base: null, status: "waiting", engaged: null, center: null, last: null };
  };
  Detector.prototype._reject = function (reason, out) {
    var s = this.s; if (s.status === "rejected") return;
    if (s.engaged) out.push({ type: "cancel", kind: s.engaged, reason: reason });
    else out.push({ type: "reject", reason: reason });
    s.status = "rejected";
  };
  Detector.prototype._cur = function () {
    var s = this.s; return s.order.map(function (id) { return s.fingers[id].cur; });
  };
  Detector.prototype.down = function (id, t, x, y) {
    var out = [];
    if (!this.s) this._new(t);
    var s = this.s, c = this.cfg;
    s.fingers[id] = { cur: [x, y], up: false }; s.order.push(id);
    if (s.status === "rejected") return out;
    var n = s.order.length;
    if (n > 3) this._reject("more than 3 fingers", out);
    else if (n === 3) {
      var anyUp = s.order.some(function (k) { return s.fingers[k].up; });
      if (t - s.t0 > c.max_touchdown_spread_ms) this._reject("fingers didn't land together", out);
      else if (anyUp) this._reject("a finger lifted before all 3 were down", out);
      else { s.base = this._cur(); s.status = "tracking"; }
    }
    return out;
  };
  Detector.prototype.move = function (id, t, x, y) {
    var out = [], s = this.s;
    if (!s || !s.fingers[id]) return out;
    s.fingers[id].cur = [x, y];
    if (s.status !== "tracking") return out;
    var c = this.cfg, f = features(s.base, this._cur());
    s.last = f;
    if (Math.abs(f.rotation) > c.max_rotation_deg) { this._reject("rotation, not a pinch", out); return out; }
    if (!s.engaged) {
      if (this.state === "full" && f.ratio < c.engage_pinch_ratio && f.radial < -c.engage_radial &&
          f.start_spread >= c.min_pinch_start_spread_px) {
        s.engaged = "pinch";
      } else if (this.state === "crumpled" && f.ratio > c.engage_expand_ratio && f.radial > c.engage_radial) {
        s.engaged = "expand"; s.center = f.start_center;
      }
      if (s.engaged) out.push({ type: "engage", kind: s.engaged, center: s.engaged === "pinch" ? f.center : s.center });
    }
    var p;
    if (s.engaged === "pinch") {
      p = (1 - f.ratio) / (1 - c.pinch_target_ratio);
      out.push({ type: "progress", kind: "pinch", p: Math.max(0, Math.min(1, p)), center: f.center });
    } else if (s.engaged === "expand") {
      p = (f.ratio - 1) / (c.expand_target_ratio - 1);
      out.push({ type: "progress", kind: "expand", p: Math.max(0, Math.min(1, p)), center: s.center });
    }
    return out;
  };
  Detector.prototype.up = function (id, t, x, y) {
    var out = this.move(id, t, x, y), s = this.s;
    if (!s || !s.fingers[id]) return out;
    s.fingers[id].up = true;
    var allUp = s.order.every(function (k) { return s.fingers[k].up; });
    if (allUp) out = out.concat(this._finish());
    return out;
  };
  Detector.prototype.cancelAll = function () { this.s = null; };
  Detector.prototype._finish = function () {
    var out = [], s = this.s, c = this.cfg;
    this.s = null;
    if (s.status === "rejected") return out;
    if (s.order.length < 3) { out.push({ type: "reject", reason: s.order.length + " finger(s) only" }); return out; }
    var f = s.last || { ratio: 1, radial: 0 };
    if (s.engaged === "pinch") {
      if (f.ratio <= c.commit_pinch_max_ratio && f.radial <= -c.commit_radial) {
        this.state = "crumpled"; out.push({ type: "commit", kind: "pinch" });
      } else out.push({ type: "cancel", kind: "pinch", reason: "pinch too small" });
    } else if (s.engaged === "expand") {
      if (f.ratio >= c.commit_expand_min_ratio && f.radial >= c.commit_radial) {
        this.state = "full"; out.push({ type: "commit", kind: "expand" });
      } else out.push({ type: "cancel", kind: "expand", reason: "expansion too small" });
    } else {
      var reason = (this.state === "full" && f.ratio >= c.commit_expand_min_ratio) ? "expansion (nothing to uncrumple)" :
                   (this.state === "crumpled" && f.ratio <= c.commit_pinch_max_ratio) ? "pinch (already crumpled)" : "not a pinch or expansion";
      out.push({ type: "reject", reason: reason });
    }
    return out;
  };
  window.ThreeFingerDetector = Detector;
})();
