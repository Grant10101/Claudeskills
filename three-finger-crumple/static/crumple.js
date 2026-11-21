/* Crumpled-paper renderer for the full-screen blue sheet.
 * crumple(p, center): p = 0 flat full screen, p = 1 crushed to a point (area 0) at center.
 */
(function () {
  "use strict";
  function rng(seed) { return function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

  function Paper(canvas) {
    this.c = canvas; this.ctx = canvas.getContext("2d");
    this.resize();
  }
  Paper.prototype.resize = function () {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = window.innerWidth, H = window.innerHeight;
    this.W = W; this.H = H; this.dpr = dpr;
    this.c.width = Math.round(W * dpr); this.c.height = Math.round(H * dpr);
    var cols = 26, rows = Math.max(8, Math.round(cols * H / W));
    this.cols = cols; this.rows = rows;
    var r = rng(20261121), i, j;
    // random creases: lines with a fold height on each side (V-shaped ridges)
    var creases = [];
    for (i = 0; i < 26; i++) {
      var a = r() * Math.PI;
      creases.push({ x: r() * W, y: r() * H, nx: Math.cos(a), ny: Math.sin(a), amp: (r() * 2 - 1), w: 20 + r() * 70 });
    }
    var D = Math.max(W, H);
    // smooth (spatially coherent) displacement field: neighbouring points move together, like folds
    var waves = [];
    for (i = 0; i < 7; i++) {
      var ang = r() * Math.PI * 2, lam = D * (0.25 + r() * 0.6);
      waves.push({ kx: Math.cos(ang) * 2 * Math.PI / lam, ky: Math.sin(ang) * 2 * Math.PI / lam,
                   ph: r() * 6.283, ax: (r() * 2 - 1), ay: (r() * 2 - 1) });
    }
    this.v = [];
    for (j = 0; j <= rows; j++) for (i = 0; i <= cols; i++) {
      var x = W * i / cols, y = H * j / rows, h = 0, dx = 0, dy = 0;
      creases.forEach(function (cr) {
        var d = (x - cr.x) * cr.nx + (y - cr.y) * cr.ny;
        var fall = Math.max(0, 1 - Math.abs(d) / (cr.w * 4));
        h += cr.amp * fall;                                         // V-shaped ridge along each crease
        var tuck = (d > 0 ? 1 : -1) * Math.min(Math.abs(d), cr.w) * Math.abs(cr.amp) * 0.55;
        dx -= cr.nx * tuck; dy -= cr.ny * tuck;                     // paper on both sides folds in toward the crease
      });
      waves.forEach(function (w) {
        var sv = Math.sin(w.kx * x + w.ky * y + w.ph);
        dx += w.ax * sv * D * 0.035; dy += w.ay * sv * D * 0.035;
      });
      this.v.push({ x: x, y: y, h: h * 0.7, dx: dx, dy: dy, k: 1 });
    }
    this.tris = [];
    for (j = 0; j < rows; j++) for (i = 0; i < cols; i++) {
      var a0 = j * (cols + 1) + i, b0 = a0 + 1, c0 = a0 + cols + 1, d0 = c0 + 1;
      if ((i + j) % 2) { this.tris.push([a0, b0, d0], [a0, d0, c0]); }
      else { this.tris.push([a0, b0, c0], [b0, d0, c0]); }
    }
    this.pos = this.v.map(function () { return [0, 0, 0]; });
  };

  // map a point of the W x H rectangle (relative to its middle) onto a disc, so the crushed sheet balls up round
  function toDisc(x, y, W, H, R) {
    var u = x / (W / 2), w = y / (H / 2);
    return [u * Math.sqrt(Math.max(0, 1 - w * w / 2)) * R, w * Math.sqrt(Math.max(0, 1 - u * u / 2)) * R];
  }

  Paper.prototype.draw = function (p, center) {
    var ctx = this.ctx, W = this.W, H = this.H;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (p <= 0.0005) { ctx.fillStyle = "#1e63e9"; ctx.fillRect(0, 0, W, H); this.area = W * H; return; }
    if (p >= 0.9995) { this.area = 0; return; }
    var cx = center[0], cy = center[1];
    var s = Math.pow(1 - p, 0.75);                 // overall shrink -> 0 at p = 1
    var ball = Math.min(1, p * 1.6);               // how round the sheet has become
    var R = Math.min(W, H) * 0.5;
    var wr = Math.sin(Math.min(1, p * 1.3) * Math.PI / 2); // wrinkle strength
    var twist = p * 0.5;
    var cs = Math.cos(twist), sn = Math.sin(twist);
    var self = this;
    this.v.forEach(function (v, n) {
      var rx = v.x - W / 2, ry = v.y - H / 2;      // rest position relative to sheet middle
      var d = toDisc(rx, ry, W, H, R);
      var qx = rx + (d[0] - rx) * ball, qy = ry + (d[1] - ry) * ball;
      qx = qx * v.k + v.dx * wr; qy = qy * v.k + v.dy * wr;
      qx += v.h * 18 * wr; qy -= v.h * 12 * wr;
      // sheet's own middle slides to the pinch center as it collapses
      var mx = W / 2 + (cx - W / 2) * Math.min(1, p * 1.4), my = H / 2 + (cy - H / 2) * Math.min(1, p * 1.4);
      var fx = (cs * qx - sn * qy) * s, fy = (sn * qx + cs * qy) * s;
      // at p ~ 0 keep exact rest position so the blue starts truly flat
      var e = Math.min(1, p * 8);
      self.pos[n][0] = (mx + fx) * e + v.x * (1 - e);
      self.pos[n][1] = (my + fy) * e + v.y * (1 - e);
      self.pos[n][2] = v.h * wr * 140;
    });
    var P = this.pos, list = [], area = 0;
    this.tris.forEach(function (t) {
      var a = P[t[0]], b = P[t[1]], c = P[t[2]];
      var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      var nl = Math.hypot(nx, ny, nz) || 1;
      area += Math.abs(nz) / 2;
      var lam = Math.abs((-0.45 * nx - 0.55 * ny + 0.7 * nz) / nl);
      var back = nz < 0;                            // folded-over face shows the paler back
      list.push({ t: t, z: (a[2] + b[2] + c[2]) / 3, l: lam, back: back });
    });
    this.area = area;
    list.sort(function (m, n) { return m.z - n.z; });
    ctx.lineJoin = "round"; ctx.lineWidth = 0.6;
    list.forEach(function (it) {
      var a = P[it.t[0]], b = P[it.t[1]], c = P[it.t[2]];
      var l = 0.3 + 0.85 * it.l;
      var col = it.back ? [70, 130, 245] : [30, 99, 233];
      var fill = "rgb(" + Math.min(255, col[0] * l | 0) + "," + Math.min(255, col[1] * l | 0) + "," + Math.min(255, col[2] * l | 0) + ")";
      ctx.fillStyle = fill; ctx.strokeStyle = fill;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.closePath();
      ctx.fill(); ctx.stroke();
    });
  };
  window.CrumplePaper = Paper;
})();
