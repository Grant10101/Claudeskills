/* Gesture Recorder — UI, capture and storage. */
(function () {
  "use strict";
  var GC = window.GestureCore;
  var $ = function (id) { return document.getElementById(id); };
  function meta(name) { var m = document.querySelector('meta[name="' + name + '"]'); return m ? m.content : ""; }

  // ======================= diamond plate texture =======================
  (function makePlate() {
    var T = 60, L = 13.2, W = 3.9; // tile size, lug half-length, half-width
    function rot(x, y, a) { var c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; }
    function lugPath(cx, cy, a, ox, oy) {
      // lens-shaped lug: two cubic curves between the tips
      var p = [[-L, 0], [-L * 0.45, -W * 1.25], [L * 0.45, -W * 1.25], [L, 0], [L * 0.45, W * 1.25], [-L * 0.45, W * 1.25]]
        .map(function (q) { var r = rot(q[0], q[1], a); return [(cx + r[0] + ox).toFixed(2), (cy + r[1] + oy).toFixed(2)]; });
      return "M" + p[0] + " C" + p[1] + " " + p[2] + " " + p[3] + " C" + p[4] + " " + p[5] + " " + p[0] + "Z";
    }
    var lugs = [[15, 15, Math.PI / 4], [45, 45, Math.PI / 4], [45, 15, -Math.PI / 4], [15, 45, -Math.PI / 4]];
    var defs = "", body = "";
    lugs.forEach(function (l, i) {
      var cx = l[0], cy = l[1], a = l[2];
      // light from the top-left, in tile space (same for every lug)
      defs += '<linearGradient id="g' + i + '" gradientUnits="userSpaceOnUse" x1="' + (cx - 6) + '" y1="' + (cy - 6) + '" x2="' + (cx + 6) + '" y2="' + (cy + 6) + '">' +
        '<stop offset="0" stop-color="#f4f6f8"/><stop offset=".42" stop-color="#b8bdc3"/><stop offset=".7" stop-color="#868c93"/><stop offset="1" stop-color="#5a5f65"/></linearGradient>';
      body += '<path d="' + lugPath(cx, cy, a, 1.5, 2.0) + '" fill="#111" opacity=".55"/>';          // cast shadow
      body += '<path d="' + lugPath(cx, cy, a, 0.6, 0.8) + '" fill="#2a2d31" opacity=".6"/>';        // bottom edge
      body += '<path d="' + lugPath(cx, cy, a, -0.7, -0.8) + '" fill="#fff" opacity=".55"/>';        // top edge glint
      body += '<path d="' + lugPath(cx, cy, a, 0, 0) + '" fill="url(#g' + i + ')"/>';                 // lug face
    });
    var lugSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + T + '" height="' + T + '" viewBox="0 0 ' + T + ' ' + T + '"><defs>' + defs + '</defs>' + body + '</svg>';
    var brushSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><filter id="n" x="0" y="0">' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.004 0.42" numOctaves="2" seed="7" stitchTiles="stitch"/>' +
      '<feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .55 -.18"/></filter>' +
      '<rect width="320" height="320" filter="url(#n)"/></svg>';
    var s = document.documentElement.style;
    s.setProperty("--plate-lugs", 'url("data:image/svg+xml,' + encodeURIComponent(lugSvg) + '")');
    s.setProperty("--plate-brush", 'url("data:image/svg+xml,' + encodeURIComponent(brushSvg) + '")');
    s.setProperty("--lug-size", (Math.min(innerWidth, innerHeight) < 500 ? 54 : 64) + "px");
  })();

  // ======================= storage =======================
  function ApiStore(base) {
    var tokenNeeded = meta("gesture-token-required") === "1";
    function token() { try { return localStorage.getItem("gesture-token") || ""; } catch (e) { return ""; } }
    function req(method, path, body) {
      var h = { "Content-Type": "application/json" };
      if (token()) h["X-Gesture-Token"] = token();
      return fetch(base + path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            if (!r.ok) { var e = new Error(j.error || ("HTTP " + r.status)); e.status = r.status; throw e; }
            return j;
          });
        });
    }
    return {
      kind: "server", tokenNeeded: tokenNeeded,
      note: "Saved on the server as one file per gesture.",
      setToken: function (t) { try { localStorage.setItem("gesture-token", t); } catch (e) {} },
      list: function () { return req("GET", "/gestures"); },
      get: function (id) { return req("GET", "/gestures/" + id); },
      save: function (g) { return req("POST", "/gestures", g); },
      rename: function (id, name) { return req("PATCH", "/gestures/" + id, { name: name }); },
      remove: function (id) { return req("DELETE", "/gestures/" + id); }
    };
  }

  function entryOf(g) {
    return { id: g.id, name: g.name, created_at: g.created_at, label: g.summary.label,
             duration_ms: g.duration_ms, finger_count: g.finger_count, stroke_count: g.strokes.length };
  }
  function finalize(g) {
    g.summary = GC.summarize(g);
    g.duration_ms = g.summary.duration_ms;
    g.finger_count = g.summary.max_simultaneous_fingers;
    return g;
  }

  // Claude artifact database: one document per gesture at gestures/<id>
  function DbStore(db) {
    var col = db.collection("gestures");
    return {
      kind: "cloud", tokenNeeded: false,
      note: "Saved to this page's cloud database, one record per gesture.",
      list: function () {
        return col.orderBy("created_at", "desc").get().then(function (snap) {
          return snap.docs.map(function (d) { var x = d.data(); var e = Object.assign({}, x); delete e.json; return e; });
        });
      },
      get: function (id) {
        return col.doc(id).get().then(function (d) { if (!d.exists) throw new Error("not found"); return JSON.parse(d.data().json); });
      },
      save: function (g) {
        var doc = entryOf(g); doc.json = JSON.stringify(g); doc.format = GC.FORMAT;
        return col.doc(g.id).set(doc).then(function () { return g; });
      },
      rename: function (id, name) {
        return this.get(id).then(function (g) {
          g.name = name;
          return col.doc(id).update({ name: name, json: JSON.stringify(g) }).then(function () { return g; });
        });
      },
      remove: function (id) { return col.doc(id).delete(); }
    };
  }

  // last resort: this browser only
  function LocalStore() {
    var P = "gesture:";
    function all() {
      var out = [];
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k.indexOf(P) === 0) out.push(JSON.parse(localStorage.getItem(k)));
        }
      } catch (e) {}
      return out.sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
    }
    return {
      kind: "local", tokenNeeded: false,
      note: "Saved in this browser only (no server connected).",
      list: function () { return Promise.resolve(all().map(entryOf)); },
      get: function (id) { try { return Promise.resolve(JSON.parse(localStorage.getItem(P + id))); } catch (e) { return Promise.reject(e); } },
      save: function (g) { try { localStorage.setItem(P + g.id, JSON.stringify(g)); } catch (e) { return Promise.reject(e); } return Promise.resolve(g); },
      rename: function (id, name) { return this.get(id).then(function (g) { g.name = name; localStorage.setItem(P + id, JSON.stringify(g)); return g; }); },
      remove: function (id) { try { localStorage.removeItem(P + id); } catch (e) {} return Promise.resolve(); }
    };
  }

  var storeReady = (function () {
    var api = meta("gesture-api");
    if (api) return Promise.resolve(ApiStore(api));
    if (typeof claude !== "undefined" && claude && typeof claude.use === "function") {
      return Promise.race([
        claude.use("db"),
        new Promise(function (r) { setTimeout(function () { r(null); }, 10000); })
      ]).then(function (db) { return db ? DbStore(db) : LocalStore(); }, function () { return LocalStore(); });
    }
    return Promise.resolve(LocalStore());
  })();

  // ======================= UI helpers =======================
  var toastTimer;
  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 2200);
  }
  function setStatus(s) { $("status").textContent = s; }
  function fmtDate(iso) {
    try { var d = new Date(iso); return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }
    catch (e) { return iso; }
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // ======================= capture =======================
  var state = "idle", rec = null, liveRaf = null;
  var liveCanvas = $("liveCanvas");
  var livePlayer = new GC.GesturePlayer(liveCanvas, null, { fullscreen: true, frame: false, loop: false });
  var MAX_MS = 20000, END_IDLE_MS = 900, MIN_DT = 8;

  function preventTouch(e) { if (state === "armed" || state === "capturing") e.preventDefault(); }
  document.addEventListener("touchmove", preventTouch, { passive: false });
  document.addEventListener("gesturestart", function (e) { e.preventDefault(); });
  document.addEventListener("contextmenu", function (e) { if (state !== "idle") e.preventDefault(); });

  function arm() {
    state = "armed";
    rec = { t0: null, strokes: [], active: new Map(), endTimer: null, maxTimer: null };
    $("capture").hidden = false; $("capture").classList.remove("active");
    $("captureHint").innerHTML = '<span class="dot"></span>Recording — draw your gesture anywhere';
    setStatus("Recording…");
    livePlayer.setGesture(null);
    livePlayer.drawAt(0);
  }
  function disarm() {
    state = "idle"; $("capture").hidden = true; setStatus("Tap to record");
    if (rec) { clearTimeout(rec.endTimer); clearTimeout(rec.maxTimer); }
    cancelAnimationFrame(liveRaf); liveRaf = null; rec = null;
  }
  function freeFinger() {
    var used = {}; rec.active.forEach(function (s) { used[s.finger] = 1; });
    var f = 0; while (used[f]) f++; return f;
  }
  function pt(e) {
    var t = Math.max(0, Math.round(e.timeStamp - rec.t0));
    var p = typeof e.pressure === "number" ? e.pressure : 0.5;
    return [t, +(e.clientX / innerWidth).toFixed(4), +(e.clientY / innerHeight).toFixed(4), +p.toFixed(2)];
  }
  function currentGesture() {
    return { screen: { width_px: innerWidth, height_px: innerHeight }, strokes: rec.strokes };
  }
  function liveLoop() {
    if (!rec || rec.t0 == null) return;
    livePlayer.setGesture(currentGesture());
    livePlayer.drawAt(performance.now() - rec.t0);
    liveRaf = requestAnimationFrame(liveLoop);
  }

  var cap = $("capture");
  cap.addEventListener("pointerdown", function (e) {
    if (e.target.id === "cancelRec") return;
    if (state !== "armed" && state !== "capturing") return;
    e.preventDefault();
    if (rec.t0 == null) {
      rec.t0 = e.timeStamp; state = "capturing"; cap.classList.add("active");
      rec.maxTimer = setTimeout(finish, MAX_MS);
      liveRaf = requestAnimationFrame(liveLoop);
    }
    clearTimeout(rec.endTimer);
    var s = { finger: freeFinger(), pointer_type: e.pointerType || "touch", points: [pt(e)] };
    rec.active.set(e.pointerId, s); rec.strokes.push(s);
    try { cap.setPointerCapture(e.pointerId); } catch (err) {}
  });
  cap.addEventListener("pointermove", function (e) {
    if (state !== "capturing") return;
    var s = rec.active.get(e.pointerId); if (!s) return;
    var evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [e];
    if (!evs.length) evs = [e];
    evs.forEach(function (ev) {
      var p = pt(ev), last = s.points[s.points.length - 1];
      if (p[0] - last[0] < MIN_DT && Math.abs(p[1] - last[1]) + Math.abs(p[2] - last[2]) < 0.004) return;
      if (p[0] < last[0]) p[0] = last[0];
      s.points.push(p);
    });
  });
  function lift(e) {
    if (state !== "capturing") return;
    var s = rec.active.get(e.pointerId); if (!s) return;
    var p = pt(e), last = s.points[s.points.length - 1];
    if (p[0] < last[0]) p[0] = last[0];
    if (p[0] !== last[0] || p[1] !== last[1] || p[2] !== last[2]) s.points.push(p);
    rec.active.delete(e.pointerId);
    if (rec.active.size === 0) rec.endTimer = setTimeout(finish, END_IDLE_MS);
  }
  cap.addEventListener("pointerup", lift);
  cap.addEventListener("pointercancel", lift);
  $("cancelRec").addEventListener("click", function (e) { e.stopPropagation(); disarm(); toast("Recording cancelled"); });

  function finish() {
    if (!rec || state !== "capturing") return;
    clearTimeout(rec.endTimer); clearTimeout(rec.maxTimer);
    cancelAnimationFrame(liveRaf); liveRaf = null;
    var strokes = rec.strokes.filter(function (s) { return s.points.length; });
    var g = {
      format: GC.FORMAT,
      id: GC.makeId(),
      name: "",
      created_at: new Date().toISOString(),
      screen: { width_px: innerWidth, height_px: innerHeight, dpr: window.devicePixelRatio || 1,
                orientation: innerHeight >= innerWidth ? "portrait" : "landscape" },
      device: { user_agent: navigator.userAgent, max_touch_points: String(navigator.maxTouchPoints || 0) },
      strokes: strokes.map(function (s, i) { return { stroke: i, finger: s.finger, pointer_type: s.pointer_type, points: s.points }; })
    };
    finalize(g);
    rec = null; state = "review";
    $("capture").hidden = true;
    openSaveBox(g);
  }

  // ======================= save box =======================
  var pending = null;
  var previewPlayer = new GC.GesturePlayer($("previewCanvas"), null, { loop: true });
  function openSaveBox(g) {
    pending = g;
    $("saveBox").hidden = false;
    $("saveError").hidden = true;
    $("nameInput").value = "";
    $("previewLabel").textContent = g.summary.label + " · " + (g.duration_ms / 1000).toFixed(2) + "s · " +
      g.finger_count + (g.finger_count === 1 ? " finger" : " fingers");
    storeReady.then(function (st) { $("tokenInput").hidden = !st.tokenNeeded; });
    previewPlayer.setGesture(g);
    requestAnimationFrame(function () { previewPlayer.play(); });
    setStatus("Name or delete");
  }
  function closeSaveBox() {
    previewPlayer.stop(); $("saveBox").hidden = true; pending = null; state = "idle"; setStatus("Tap to record");
  }
  $("deleteNew").addEventListener("click", function () { closeSaveBox(); toast("Gesture deleted"); });
  $("nameInput").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); $("saveNew").click(); } });
  $("saveNew").addEventListener("click", function () {
    if (!pending) return;
    var btn = $("saveNew"); btn.disabled = true;
    storeReady.then(function (st) {
      if (st.tokenNeeded && $("tokenInput").value) st.setToken($("tokenInput").value.trim());
      return st.list().catch(function () { return []; }).then(function (items) {
        pending.name = $("nameInput").value.trim() || ("Gesture " + (items.length + 1));
        return st.save(pending);
      });
    }).then(function (saved) {
      toast("Saved “" + saved.name + "”");
      closeSaveBox(); refreshList();
    }, function (err) {
      var el = $("saveError"); el.hidden = false;
      el.textContent = err.status === 401 ? "Access key needed — enter it above and try again." : ("Couldn't save: " + err.message);
      if (err.status === 401) $("tokenInput").hidden = false;
    }).then(function () { btn.disabled = false; });
  });

  // ======================= menu / list =======================
  function drawThumb(canvas, g) {
    var dpr = window.devicePixelRatio || 1, w = canvas.clientWidth || 52, h = canvas.clientHeight || 78;
    canvas.width = w * dpr; canvas.height = h * dpr;
    var ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var sw = g.screen.width_px, sh = g.screen.height_px, s = Math.min((w - 6) / sw, (h - 6) / sh);
    var bw = sw * s, bh = sh * s, ox = (w - bw) / 2, oy = (h - bh) / 2;
    ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = 2.2;
    g.strokes.forEach(function (st) {
      var c = GC.FINGER_COLORS[st.finger % GC.FINGER_COLORS.length];
      ctx.strokeStyle = c; ctx.beginPath();
      st.points.forEach(function (p, i) { var x = ox + p[1] * bw, y = oy + p[2] * bh; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
      var p0 = st.points[0]; ctx.fillStyle = c; ctx.beginPath(); ctx.arc(ox + p0[1] * bw, oy + p0[2] * bh, 2.8, 0, 7); ctx.fill();
    });
  }

  var cache = {};
  function refreshList() {
    return storeReady.then(function (st) {
      $("storeNote").textContent = st.note;
      return st.list().then(function (items) {
        var ul = $("gestureList"); ul.innerHTML = "";
        $("emptyList").hidden = items.length > 0;
        var badge = $("countBadge"); badge.hidden = !items.length; badge.textContent = items.length;
        items.forEach(function (it) {
          var li = document.createElement("li");
          li.innerHTML = '<canvas></canvas><div class="info"><div class="nm">' + esc(it.name || it.id) + '</div>' +
            '<div class="lb">' + esc(it.label || "") + '</div><div class="dt">' + esc(fmtDate(it.created_at)) + " · " +
            ((it.duration_ms || 0) / 1000).toFixed(1) + "s</div></div>";
          li.addEventListener("click", function () { openViewer(it.id); });
          ul.appendChild(li);
          var cv = li.querySelector("canvas");
          (cache[it.id] ? Promise.resolve(cache[it.id]) : st.get(it.id)).then(function (g) { cache[it.id] = g; drawThumb(cv, g); }, function () {});
        });
      });
    }).catch(function (e) { $("storeNote").textContent = "Couldn't load gestures: " + e.message; });
  }

  function openDrawer() {
    $("drawer").classList.add("open"); $("drawer").setAttribute("aria-hidden", "false");
    $("menuBtn").setAttribute("aria-expanded", "true"); $("scrim").hidden = false; refreshList();
  }
  function closeDrawer() {
    $("drawer").classList.remove("open"); $("drawer").setAttribute("aria-hidden", "true");
    $("menuBtn").setAttribute("aria-expanded", "false"); $("scrim").hidden = true;
  }
  $("menuBtn").addEventListener("click", function () { if (state === "idle") openDrawer(); });
  $("closeDrawer").addEventListener("click", closeDrawer);
  $("scrim").addEventListener("click", closeDrawer);

  // ======================= viewer =======================
  var viewPlayer = new GC.GesturePlayer($("viewCanvas"), null, { loop: true });
  var viewing = null;
  function openViewer(id) {
    storeReady.then(function (st) { return cache[id] ? cache[id] : st.get(id); }).then(function (g) {
      cache[id] = g; viewing = g;
      $("viewName").value = g.name || "";
      $("viewLabel").textContent = g.summary.label;
      $("viewMeta").innerHTML = (g.duration_ms / 1000).toFixed(2) + "s · " + g.finger_count +
        (g.finger_count === 1 ? " finger" : " fingers") + " · " + g.strokes.length + (g.strokes.length === 1 ? " stroke" : " strokes") +
        "<br>ID <code>" + esc(g.id) + "</code>";
      $("viewer").hidden = false;
      viewPlayer.setGesture(g);
      requestAnimationFrame(function () { viewPlayer.play(); });
    }, function (e) { toast("Couldn't open: " + e.message); });
  }
  function closeViewer() { viewPlayer.stop(); $("viewer").hidden = true; viewing = null; }
  $("viewClose").addEventListener("click", closeViewer);
  $("viewName").addEventListener("change", function () {
    if (!viewing) return;
    var g = viewing, name = $("viewName").value.trim();
    if (name === g.name) return;
    storeReady.then(function (st) { return st.rename(g.id, name); }).then(function (ng) {
      cache[g.id] = ng; g.name = ng.name; toast("Renamed"); refreshList();
    }, function (e) { toast("Rename failed: " + e.message); });
  });
  $("viewName").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); e.target.blur(); } });
  var confirmTimer = null;
  $("viewDelete").addEventListener("click", function () {
    var btn = $("viewDelete");
    if (!btn.dataset.confirm) {   // two-tap confirm (no browser dialogs)
      btn.dataset.confirm = "1"; btn.textContent = "Tap to confirm";
      confirmTimer = setTimeout(function () { delete btn.dataset.confirm; btn.textContent = "Delete"; }, 3000);
      return;
    }
    clearTimeout(confirmTimer); delete btn.dataset.confirm; btn.textContent = "Delete";
    var g = viewing; if (!g) return;
    storeReady.then(function (st) { return st.remove(g.id); }).then(function () {
      delete cache[g.id]; closeViewer(); toast("Deleted"); refreshList();
    }, function (e) { toast("Delete failed: " + e.message); });
  });

  // ======================= record button =======================
  $("recBtn").addEventListener("click", function () {
    if (state === "idle") arm();
  });

  window.addEventListener("resize", function () {
    document.documentElement.style.setProperty("--lug-size", (Math.min(innerWidth, innerHeight) < 500 ? 54 : 64) + "px");
  });

  refreshList();
  // exposed for automated tests
  window.__gestureApp = { finishNow: finish, state: function () { return state; } };
})();
