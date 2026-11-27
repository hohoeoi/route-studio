// ---------------------------------------------------------------- 6. shapes: circles, boxes and lines drawn on screen,
// clean or hand-drawn, solid or dashed, any colour and width, with an optional boil (hand-drawn jitter).
// Exported as an animated draw-on clip (MP4 on black / PNG sequence with transparency) or one transparent PNG.
(function (RS) {
  const $ = id => document.getElementById(id);
  // ---- helpers (same family as tabs 4 and 5)
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function gauss(r) { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }
  const hyp = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  function resample(p, step) {
    const d = [0]; for (let i = 1; i < p.length; i++) d.push(d[i - 1] + hyp(p[i], p[i - 1]));
    const tot = d[d.length - 1], n = Math.max(2, Math.floor(tot / step)), out = [];
    let j = 0;
    for (let i = 0; i < n; i++) {
      const t = tot * i / (n - 1);
      while (j < d.length - 2 && d[j + 1] < t) j++;
      const f = (t - d[j]) / ((d[j + 1] - d[j]) || 1);
      out.push([p[j][0] + f * (p[j + 1][0] - p[j][0]), p[j][1] + f * (p[j + 1][1] - p[j][1])]);
    }
    return out;
  }
  function wobble(p, amp, seed) {              // smooth random offset along the line
    if (!amp) return p;
    const r = rng(seed), n = p.length, k = 9, raw = [];
    for (let i = 0; i < n + 2 * k; i++) raw.push([gauss(r), gauss(r)]);
    const ker = []; let ks = 0;
    for (let i = 0; i <= 2 * k; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (2 * k)); ker.push(w); ks += w; }
    const off = []; let ss = 0;
    for (let i = 0; i < n; i++) {
      let x = 0, y = 0;
      for (let j = 0; j <= 2 * k; j++) { x += raw[i + j][0] * ker[j]; y += raw[i + j][1] * ker[j]; }
      off.push([x / ks, y / ks]); ss += x * x / ks / ks + y * y / ks / ks;
    }
    const sd = Math.sqrt(ss / (2 * n)) || 1;
    return p.map((q, i) => [q[0] + off[i][0] * amp / sd, q[1] + off[i][1] * amp / sd]);
  }
  function withLen(p) { const c = [0]; for (let i = 1; i < p.length; i++) c.push(c[i - 1] + hyp(p[i], p[i - 1])); return {p, c, len: c[c.length - 1]}; }
  function stroke(ctx, L, upto) {
    if (upto <= 0 || L.p.length < 2) return;
    ctx.beginPath(); ctx.moveTo(L.p[0][0], L.p[0][1]);
    for (let i = 1; i < L.p.length; i++) {
      if (L.c[i] >= upto) { const f = (upto - L.c[i - 1]) / ((L.c[i] - L.c[i - 1]) || 1); ctx.lineTo(L.p[i - 1][0] + f * (L.p[i][0] - L.p[i - 1][0]), L.p[i - 1][1] + f * (L.p[i][1] - L.p[i - 1][1])); break; }
      ctx.lineTo(L.p[i][0], L.p[i][1]);
    }
    ctx.stroke();
  }
  const ease = t => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
  async function askSave(name, desc, mime, ext) {
    if (!window.showSaveFilePicker) return null;
    try { return await window.showSaveFilePicker({suggestedName: name, types: [{description: desc, accept: {[mime]: [ext]}}]}); }
    catch (e) { return e.name === "AbortError" ? "cancel" : null; }
  }
  async function writeFile(handle, blob, name) {
    if (handle && handle !== "cancel") { const w = await handle.createWritable(); await w.write(blob); await w.close(); return handle.name || name; }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    return name;
  }
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zipStore(files) {
    const parts = [], central = []; let off = 0;
    for (const f of files) {
      const nm = new TextEncoder().encode(f.name), crc = crc32(f.data), h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, crc, true);
      h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true); h.setUint16(26, nm.length, true);
      parts.push(h, nm, f.data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true);
      c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
      central.push(c, nm);
      off += 30 + nm.length + f.data.length;
    }
    const csize = central.reduce((a, b) => a + b.byteLength, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, csize, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...central, e], {type: "application/zip"});
  }
  function toI420(rgba, W, H, out) {
    const ySize = W * H; let U = ySize, V = ySize + (ySize >> 2);
    for (let y = 0; y < H; y += 2) {
      let i0 = y * W * 4, i1 = i0 + W * 4, o0 = y * W, o1 = o0 + W;
      for (let x = 0; x < W; x += 2, i0 += 8, i1 += 8, o0 += 2, o1 += 2) {
        const r0 = rgba[i0], g0 = rgba[i0 + 1], b0 = rgba[i0 + 2], r1 = rgba[i0 + 4], g1 = rgba[i0 + 5], b1 = rgba[i0 + 6];
        const r2 = rgba[i1], g2 = rgba[i1 + 1], b2 = rgba[i1 + 2], r3 = rgba[i1 + 4], g3 = rgba[i1 + 5], b3 = rgba[i1 + 6];
        out[o0] = (47 * r0 + 157 * g0 + 16 * b0 + 4224) >> 8; out[o0 + 1] = (47 * r1 + 157 * g1 + 16 * b1 + 4224) >> 8;
        out[o1] = (47 * r2 + 157 * g2 + 16 * b2 + 4224) >> 8; out[o1 + 1] = (47 * r3 + 157 * g3 + 16 * b3 + 4224) >> 8;
        const r = r0 + r1 + r2 + r3, g = g0 + g1 + g2 + g3, b = b0 + b1 + b2 + b3;
        out[U++] = (-26 * r - 86 * g + 112 * b + 132096) >> 10;
        out[V++] = (112 * r - 102 * g - 10 * b + 132096) >> 10;
      }
    }
  }

  // ------------------------------------------------------------ state
  // shape: {type: circle|rect|line, x0, y0, x1, y1 (0..1 of the frame), dash, color, width (px at 1080p), hand, boil, seed}
  const STYLE = {dash: false, color: "#ffffff", width: 8, hand: true, boil: true};
  const DEF = {res: "1920x1080", draw: 1.5, hold: 2, order: "seq", style: STYLE, shapes: []};
  const load = () => {
    try { const o = Object.assign({}, DEF, JSON.parse(localStorage.getItem("rs.shapes") || "{}")); o.style = Object.assign({}, STYLE, o.style); o.shapes = Array.isArray(o.shapes) ? o.shapes : []; return o; }
    catch (e) { return JSON.parse(JSON.stringify(DEF)); }
  };
  let opt = load();
  const save = () => { try { localStorage.setItem("rs.shapes", JSON.stringify(opt)); } catch (e) { /* private window */ } };
  let tool = "rect", sel = -1;

  // ------------------------------------------------------------ geometry (pixels at W x H)
  // one shape -> list of strokes (point lists); hand-drawn adds overshoot, uneven radius and slight bowing
  function strokesOf(sh, W, H) {
    const s = H / 1080, r = rng(sh.seed || 1), x0 = sh.x0 * W, y0 = sh.y0 * H, x1 = sh.x1 * W, y1 = sh.y1 * H;
    const jit = v => (r() - 0.5) * 2 * v;
    if (sh.type === "line") {
      const a = [x0, y0], b = [x1, y1], L = hyp(a, b) || 1, n = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
      if (!sh.hand) return [[a, b]];
      const bow = jit(0.025 * L), e = Math.min(6 * s, 0.02 * L), out = [];
      for (let i = 0; i <= 24; i++) { const t = i / 24, k = Math.sin(Math.PI * t) * bow; out.push([a[0] + (b[0] - a[0]) * t + n[0] * k, a[1] + (b[1] - a[1]) * t + n[1] * k]); }
      out[0] = [out[0][0] + jit(e), out[0][1] + jit(e)];
      return [out];
    }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
    if (sh.type === "circle") {
      const pts = [];
      if (!sh.hand) { for (let i = 0; i <= 120; i++) { const t = -Math.PI / 2 + 2 * Math.PI * i / 120; pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); } return [pts]; }
      // hand: starts at a random angle, goes round about 1.1 times, the radius drifts a little so the ends do not meet exactly
      const a0 = -Math.PI * (0.55 + r() * 0.35), sweep = 2 * Math.PI * (1.06 + r() * 0.06), rot = jit(0.08);
      const f1 = 0.035 + r() * 0.03, ph = r() * 6.28, drift = 0.94 + r() * 0.04;
      for (let i = 0; i <= 160; i++) {
        const u = i / 160, t = a0 + sweep * u, k = (1 + f1 * Math.sin(2 * t + ph)) * (1 + (drift - 1) * u);
        const ex = rx * k * Math.cos(t), ey = ry * k * Math.sin(t);
        pts.push([cx + ex * Math.cos(rot) - ey * Math.sin(rot), cy + ex * Math.sin(rot) + ey * Math.cos(rot)]);
      }
      return [pts];
    }
    // rect
    const c = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    if (!sh.hand) return [c.concat([c[0]])];
    const side = Math.max(rx, ry) * 2 || 1, e = Math.min(12 * s, 0.05 * side), cj = Math.min(5 * s, 0.015 * side);
    const C = c.map(p => [p[0] + jit(cj), p[1] + jit(cj)]), out = [];
    for (let k = 0; k < 4; k++) {
      const a = C[k], b = C[(k + 1) % 4], L = hyp(a, b) || 1, d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n = [-d[1], d[0]];
      const s0 = k === 0 ? 0 : e * (0.3 + r() * 0.7), s1 = e * (0.3 + r() * 0.9), bow = jit(0.015 * L), q = [];
      for (let i = 0; i <= 20; i++) {
        const t = i / 20, along = -s0 + (L + s0 + s1) * t, kk = Math.sin(Math.PI * t) * bow;
        q.push([a[0] + d[0] * along + n[0] * kk, a[1] + d[1] * along + n[1] * kk]);
      }
      out.push(q);
    }
    return out;
  }
  // 3 boil variants per shape (one when the jitter is off)
  function build(W, H) {
    const s = H / 1080;
    return opt.shapes.map((sh, i) => {
      // the jitter is applied on points about 10 px apart so it reads as a slow tremble, not a zigzag
      const base = strokesOf(sh, W, H), lw = sh.width * s, amp = sh.boil ? 0.6 * s + lw * 0.07 : 0;
      const vars = [];
      for (let v = 0; v < (sh.boil ? 3 : 1); v++)
        vars.push(base.map((q, j) => withLen(resample(wobble(resample(q, 10 * s), amp, (sh.seed || 1) * 31 + v * 1000 + j * 7), 2 * s))));
      return {sh, lw, vars, len: vars[0].reduce((a, b) => a + b.len, 0)};
    });
  }

  // ------------------------------------------------------------ one frame
  const START = 0.3;
  const dur = () => START + Math.max(0, +opt.draw) + Math.max(0.1, +opt.hold);
  function draw(ctx, scene, t, frameNo, bg, W, H, ui) {
    ctx.save();
    if (bg === null) ctx.clearRect(0, 0, W, H); else { ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); }
    ctx.lineCap = ctx.lineJoin = "round";
    const n = scene.length, D = Math.max(0, +opt.draw);
    scene.forEach((S, i) => {
      let p;
      if (!D) p = t >= START ? 1 : 0;
      else if (opt.order === "all") p = ease((t - START) / D);
      else p = ease((t - START - D * i / n) / (D / n));
      if (p <= 0) return;
      const L = S.vars[S.sh.boil ? Math.floor(frameNo / 3) % S.vars.length : 0];
      ctx.strokeStyle = /^#[0-9a-f]{6}$/i.test(S.sh.color) ? S.sh.color : "#ffffff";
      ctx.lineWidth = S.lw;
      ctx.setLineDash(S.sh.dash ? [S.lw * 2.4, S.lw * 2.2] : []);
      let budget = p * S.len;
      for (const q of L) { if (budget <= 0) break; stroke(ctx, q, budget); budget -= q.len; }
    });
    ctx.setLineDash([]);
    if (ui && sel >= 0 && opt.shapes[sel]) {            // selection box: preview only
      const sh = opt.shapes[sel], s = H / 1080, pad = (sh.width / 2 + 10) * s;
      const x0 = Math.min(sh.x0, sh.x1) * W - pad, y0 = Math.min(sh.y0, sh.y1) * H - pad, x1 = Math.max(sh.x0, sh.x1) * W + pad, y1 = Math.max(sh.y0, sh.y1) * H + pad;
      ctx.strokeStyle = "#e4664d"; ctx.lineWidth = 2 * s; ctx.setLineDash([8 * s, 6 * s]); ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); ctx.setLineDash([]);
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ UI
  const FPS = 30;
  let scene = null, sceneKey = "", playing = false, t0 = 0, cur = 99, busy = false, cancel = false;
  const status = (m, k = "") => { const el = $("shStatus"); el.textContent = m; el.dataset.kind = k; };
  const dims = () => opt.res.split("x").map(Number);
  function ensure(W, H) {
    const key = JSON.stringify([opt.shapes, W, H]);
    if (!scene || key !== sceneKey) { scene = build(W, H); sceneKey = key; }
    return scene;
  }
  function preview(t = cur) {
    const [W, H] = dims(), c = $("shCanvas"), box = c.parentElement.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(Math.min(box.width, 1200) * dpr), h = Math.round(w * H / W);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const sc = w / W, ctx = c.getContext("2d"), D = dur(); t = Math.min(t, D);
    ctx.setTransform(sc, 0, 0, sc, 0, 0);
    draw(ctx, ensure(W, H), t, Math.round(t * FPS), "#263a2c", W, H, !playing);
    $("shScrub").max = D; $("shScrub").value = t; $("shClock").textContent = `${t.toFixed(1)} / ${D.toFixed(1)}초 · 도형 ${opt.shapes.length}개`;
    cur = t;
  }
  function play() {
    if (playing) { playing = false; $("shPlay").textContent = "▶ 재생"; preview(); return; }
    playing = true; $("shPlay").textContent = "❚❚ 정지";
    if (cur >= dur() - 0.05) cur = 0;
    t0 = performance.now() - cur * 1000;
    const step = () => {
      if (!playing) return;
      const t = (performance.now() - t0) / 1000;
      if (t >= dur()) { playing = false; $("shPlay").textContent = "▶ 재생"; preview(dur()); return; }
      preview(t); requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function changed() { save(); if (!playing) preview(); fillSel(); }

  // style controls edit the selected shape, or the style for the next shape when nothing is selected
  function styleTarget() { return sel >= 0 && opt.shapes[sel] ? opt.shapes[sel] : opt.style; }
  function fillSel() {
    const t = styleTarget();
    $("shDash").value = t.dash ? "dash" : "solid"; $("shColor").value = t.color; $("shWidth").value = t.width; $("shWidthVal").textContent = t.width + "px";
    $("shHand").checked = !!t.hand; $("shBoil").checked = !!t.boil;
    const names = {circle: "원", rect: "네모", line: "선"};
    $("shSelInfo").textContent = sel >= 0 && opt.shapes[sel] ? `선택한 도형: ${names[opt.shapes[sel].type]} ${sel + 1} (아래 설정이 이 도형에 바로 적용됩니다)` : "선택한 도형 없음: 아래 설정은 새로 그릴 도형에 적용됩니다";
    $("shDel").disabled = !(sel >= 0 && opt.shapes[sel]);
    for (const k of ["circle", "rect", "line", "select"]) $("shT_" + k).setAttribute("aria-pressed", tool === k);
  }
  function setStyle(k, v) { styleTarget()[k] = v; if (sel >= 0) opt.style[k] = v; changed(); }

  // canvas: drag to draw with the chosen tool; with 선택, tap a shape to select it and drag to move it
  function hit(p) {
    const [W, H] = dims(), tol = 18 / Math.min(W, H) * 1080 / 1080 * 0.02 + 0.015;
    for (let i = opt.shapes.length - 1; i >= 0; i--) {
      const s = opt.shapes[i];
      if (s.type === "line") {
        const a = [s.x0, s.y0], b = [s.x1, s.y1], ab = [b[0] - a[0], b[1] - a[1]], L2 = ab[0] ** 2 + ab[1] ** 2 || 1e-9;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / L2));
        if (hyp(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]) < tol) return i;
      } else if (p[0] > Math.min(s.x0, s.x1) - tol && p[0] < Math.max(s.x0, s.x1) + tol && p[1] > Math.min(s.y0, s.y1) - tol && p[1] < Math.max(s.y0, s.y1) + tol) return i;
    }
    return -1;
  }
  function mountCanvas() {
    const c = $("shCanvas");
    const pt = e => { const r = c.getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))]; };
    let drag = null;
    c.addEventListener("pointerdown", e => {
      if (busy) return;
      playing = false; $("shPlay").textContent = "▶ 재생"; cur = 99;
      const p = pt(e); c.setPointerCapture(e.pointerId);
      if (tool === "select") {
        sel = hit(p);
        if (sel >= 0) { const s = opt.shapes[sel]; drag = {move: true, p, o: [s.x0, s.y0, s.x1, s.y1]}; }
        changed(); return;
      }
      const sh = Object.assign({type: tool, x0: p[0], y0: p[1], x1: p[0], y1: p[1], seed: 1 + Math.floor(Math.random() * 1e6)}, opt.style);
      opt.shapes.push(sh); sel = opt.shapes.length - 1; drag = {draw: true};
      changed();
    });
    c.addEventListener("pointermove", e => {
      if (!drag) return;
      const p = pt(e), s = opt.shapes[sel]; if (!s) return;
      if (drag.draw) {
        s.x1 = p[0]; s.y1 = p[1];
        if (e.shiftKey && s.type !== "line") {           // Shift: perfect circle / square
          const [W, H] = dims(), d = Math.max(Math.abs(s.x1 - s.x0) * W, Math.abs(s.y1 - s.y0) * H);
          s.x1 = s.x0 + Math.sign(s.x1 - s.x0 || 1) * d / W; s.y1 = s.y0 + Math.sign(s.y1 - s.y0 || 1) * d / H;
        }
      } else if (drag.move) { const dx = p[0] - drag.p[0], dy = p[1] - drag.p[1]; [s.x0, s.y0, s.x1, s.y1] = [drag.o[0] + dx, drag.o[1] + dy, drag.o[2] + dx, drag.o[3] + dy]; }
      save(); preview();
    });
    const end = () => {
      if (drag && drag.draw) { const s = opt.shapes[sel]; if (s && Math.hypot(s.x1 - s.x0, s.y1 - s.y0) < 0.01) { opt.shapes.splice(sel, 1); sel = -1; } }
      drag = null; changed();
    };
    c.addEventListener("pointerup", end); c.addEventListener("pointercancel", end);
  }

  // ------------------------------------------------------------ export
  const yieldUI = () => new Promise(r => setTimeout(r, 0));
  async function run(perFrame, n, done, cleanup) {
    busy = true; cancel = false; playing = false;
    const btns = [$("shMp4"), $("shSeq"), $("shPng")], labels = btns.map(b => b.textContent);
    btns.forEach(b => (b.textContent = "취소"));
    try {
      for (let f = 0; f < n; f++) {
        if (cancel) throw new Error("취소했습니다.");
        await perFrame(f);
        if (f % 5 === 0) { status(`만드는 중 ${f + 1}/${n}`); await yieldUI(); }
      }
      await done();
    } catch (e) { status(e.message || String(e), e.message === "취소했습니다." ? "" : "error"); }
    finally { if (cleanup) cleanup(); busy = false; btns.forEach((b, i) => (b.textContent = labels[i])); }
  }
  const noShapes = () => { if (opt.shapes.length) return false; status("먼저 미리보기 화면에 도형을 그려 주세요.", "warn"); return true; };
  async function exportMp4() {
    if (busy) { cancel = true; return; }
    if (noShapes()) return;
    if (typeof VideoEncoder === "undefined") { status("이 브라우저는 MP4 인코딩(WebCodecs)을 지원하지 않습니다. 최신 Chrome·Edge 에서 열어 주세요.", "error"); return; }
    const name = "shapes.mp4", handle = await askSave(name, "MP4 영상", "video/mp4", ".mp4"); if (handle === "cancel") return;
    const [W, H] = dims(), sc = ensure(W, H), n = Math.round(dur() * FPS), mbps = Math.ceil(W / 16) * Math.ceil(H / 16) * FPS;
    let cfg = {codec: mbps > 522240 ? "avc1.640033" : mbps > 245760 ? "avc1.64002a" : "avc1.640028", width: W, height: H, framerate: FPS, bitrateMode: "quantizer", avc: {format: "avc"}}, useQ = true;
    if (!(await VideoEncoder.isConfigSupported(cfg)).supported) {
      useQ = false; cfg = Object.assign({}, cfg, {bitrateMode: "constant", bitrate: Math.round(W * H * FPS * 0.33)});
      if (!(await VideoEncoder.isConfigSupported(cfg)).supported) { status(`이 브라우저에서 ${W}x${H} H.264 인코딩을 지원하지 않습니다.`, "error"); return; }
    }
    const cv = new OffscreenCanvas(W, H), ctx = cv.getContext("2d", {alpha: false, willReadFrequently: true});
    const yuv = new Uint8Array(W * H * 3 / 2), mux = new RS.Mp4Writer(W, H, FPS);
    let failed = null;
    const enc = new VideoEncoder({output: (c, m) => mux.add(c, m), error: e => { failed = e; }});
    enc.configure(cfg);
    await run(async f => {
      draw(ctx, sc, f / FPS, f, "#000", W, H, false);
      toI420(ctx.getImageData(0, 0, W, H).data, W, H, yuv);
      const fr = new VideoFrame(yuv, {format: "I420", codedWidth: W, codedHeight: H, timestamp: Math.round(f * 1e6 / FPS), duration: Math.round(1e6 / FPS),
        colorSpace: {primaries: "bt709", transfer: "bt709", matrix: "bt709", fullRange: false}});
      enc.encode(fr, useQ ? {keyFrame: f % 60 === 0, avc: {quantizer: 18}} : {keyFrame: f % 60 === 0}); fr.close();
      while (enc.encodeQueueSize > 6) await new Promise(r => enc.addEventListener("dequeue", r, {once: true}));
      if (failed) throw failed;
    }, n, async () => {
      await enc.flush(); if (failed) throw failed;
      const blob = mux.finish(), saved = await writeFile(handle, blob, name);
      status(`저장했습니다: ${saved} (${(blob.size / 1048576).toFixed(1)} MB)\n프리미어: 영상 위 트랙에 올리고 효과 컨트롤 → 불투명도 → 혼합 모드를 '스크린'으로 바꾸면 검은 배경이 사라집니다 (흰색이 아닌 선은 배경과 섞여 밝아질 수 있으니 색을 살리려면 PNG를 쓰세요).`, "ok");
    }, () => { try { enc.close(); } catch (e) { /* closed */ } });
  }
  async function exportSeq() {
    if (busy) { cancel = true; return; }
    if (noShapes()) return;
    const name = "shapes_png.zip", handle = await askSave(name, "PNG 시퀀스 (ZIP)", "application/zip", ".zip"); if (handle === "cancel") return;
    const [W, H] = dims(), sc = ensure(W, H), n = Math.round(dur() * FPS), cv = new OffscreenCanvas(W, H), ctx = cv.getContext("2d"), files = [];
    await run(async f => {
      draw(ctx, sc, f / FPS, f, null, W, H, false);
      files.push({name: `shapes_${String(f).padStart(4, "0")}.png`, data: new Uint8Array(await (await cv.convertToBlob({type: "image/png"})).arrayBuffer())});
    }, n, async () => {
      const blob = zipStore(files), saved = await writeFile(handle, blob, name);
      status(`저장했습니다: ${saved} (${(blob.size / 1048576).toFixed(1)} MB, PNG ${n}장)\n프리미어: 압축을 풀고 가져오기에서 첫 번째 PNG를 고른 뒤 '이미지 시퀀스'에 체크하면 투명 배경 클립 하나로 들어옵니다.`, "ok");
    });
  }
  async function exportPng() {
    if (busy) return;
    if (noShapes()) return;
    const name = "shapes.png", handle = await askSave(name, "PNG 이미지", "image/png", ".png"); if (handle === "cancel") return;
    const [W, H] = dims(), sc = ensure(W, H), cv = new OffscreenCanvas(W, H), ctx = cv.getContext("2d");
    draw(ctx, sc, dur(), 0, null, W, H, false);
    const blob = await cv.convertToBlob({type: "image/png"}), saved = await writeFile(handle, blob, name);
    status(`저장했습니다: ${saved} (투명 배경 PNG 한 장, 다 그려진 모습)\n프리미어에서 바로 불러와 쓸 수 있습니다. 떨림은 움직임이라 PNG 한 장에는 들어가지 않습니다.`, "ok");
  }

  function mount() {
    const tabs = document.querySelector(".tabs"); if (!tabs || $("t6")) return;
    const b = document.createElement("button");
    b.setAttribute("role", "tab"); b.dataset.tab = "t6"; b.setAttribute("aria-selected", "false"); b.textContent = "6. 도형";
    tabs.appendChild(b);
    const tab = document.createElement("div"); tab.className = "tab"; tab.id = "t6"; tab.hidden = true;
    tab.innerHTML = `
      <section>
        <h2>도형 그리기 <small>원 · 네모 · 선 — 손그림 느낌, 점선, 색, 굵기, 떨림</small></h2>
        <div class="bar" style="margin-top:0">
          <span class="mono">그리기 도구</span>
          <button id="shT_circle" aria-pressed="false">◯ 원</button>
          <button id="shT_rect" aria-pressed="false">▢ 네모</button>
          <button id="shT_line" aria-pressed="false">╱ 선</button>
          <button id="shT_select" aria-pressed="false">선택·이동</button>
          <span class="grow"></span>
          <button id="shDel" class="small">선택한 도형 삭제</button>
          <button id="shClear" class="small">모두 지우기</button>
        </div>
        <p class="hint">도구를 고른 뒤 아래 미리보기 화면에서 끌어서 그립니다. Shift 키를 누른 채 그리면 정원·정사각형이 됩니다. '선택·이동'으로 도형을 눌러 고르고 끌어서 옮길 수 있습니다.</p>
        <p class="hint" id="shSelInfo" style="color:var(--ink)"></p>
        <div class="g4">
          <label class="f">선 종류<select id="shDash"><option value="solid">실선</option><option value="dash">점선</option></select></label>
          <label class="f">선 색<input type="color" id="shColor" style="height:var(--h);padding:2px;width:100%"></label>
          <label class="f">선 굵기 <span class="mono" id="shWidthVal"></span><input type="range" id="shWidth" min="2" max="40" step="1"></label>
          <div class="checks" style="margin-top:0;align-content:end">
            <label class="check"><input type="checkbox" id="shHand"> 손으로 그린 듯한 선</label>
            <label class="check"><input type="checkbox" id="shBoil"> 떨림 (손그림 움직임)</label>
          </div>
        </div>
        <div class="g4" style="margin-top:12px">
          <label class="f">그리는 시간(초, 0 = 바로 표시)<input type="number" id="shDraw" min="0" max="20" step="0.5"></label>
          <label class="f">끝난 뒤 멈춤(초)<input type="number" id="shHold" min="0.1" max="60" step="0.5"></label>
          <label class="f">그리는 순서<select id="shOrder"><option value="seq">하나씩 차례대로</option><option value="all">모두 동시에</option></select></label>
          <label class="f">해상도<select id="shRes"><option value="1280x720">1280×720 (HD)</option><option value="1920x1080">1920×1080 (FHD)</option><option value="2560x1440">2560×1440</option><option value="3840x2160">3840×2160 (4K)</option></select></label>
        </div>
      </section>
      <section>
        <canvas id="shCanvas" style="width:100%;display:block;border-radius:6px;background:#263a2c;touch-action:none;cursor:crosshair"></canvas>
        <div class="ctl"><button id="shPlay">▶ 재생</button><input type="range" id="shScrub" class="grow" min="0" max="4" step="0.01" value="0"><span class="mono" id="shClock"></span></div>
        <div class="bar">
          <span class="grow"></span>
          <button id="shPng">PNG 한 장 (투명)</button>
          <button id="shSeq">PNG 시퀀스 (투명 배경)</button>
          <button id="shMp4" class="primary">MP4 저장 (검은 배경)</button>
        </div>
        <p class="hint">미리보기의 주황 점선 상자는 선택 표시이고 영상에는 나오지 않습니다. 그리는 장면까지 쓰려면 PNG 시퀀스나 MP4를, 다 그려진 그림만 필요하면 PNG 한 장을 쓰세요.</p>
        <div id="shStatus" style="white-space:pre-wrap;margin-top:10px;font-size:12.5px"></div>
      </section>`;
    ($("t5") || $("t4") || $("t3")).after(tab);
    for (const k of ["circle", "rect", "line", "select"]) $("shT_" + k).onclick = () => { tool = k; if (k !== "select") sel = -1; $("shCanvas").style.cursor = k === "select" ? "move" : "crosshair"; changed(); };
    $("shDel").onclick = () => { if (sel >= 0) { opt.shapes.splice(sel, 1); sel = -1; changed(); } };
    $("shClear").onclick = () => { if (!opt.shapes.length) return; if (!confirm("그린 도형을 모두 지울까요?")) return; opt.shapes = []; sel = -1; changed(); };
    $("shDash").onchange = e => setStyle("dash", e.target.value === "dash");
    $("shColor").oninput = e => setStyle("color", e.target.value);
    $("shWidth").oninput = e => setStyle("width", +e.target.value);
    $("shHand").onchange = e => setStyle("hand", e.target.checked);
    $("shBoil").onchange = e => setStyle("boil", e.target.checked);
    $("shDraw").value = opt.draw; $("shHold").value = opt.hold; $("shOrder").value = opt.order; $("shRes").value = opt.res;
    $("shDraw").onchange = e => { const v = parseFloat(e.target.value); if (isFinite(v)) { opt.draw = Math.max(0, Math.min(20, v)); changed(); } };
    $("shHold").onchange = e => { const v = parseFloat(e.target.value); if (isFinite(v)) { opt.hold = Math.max(0.1, Math.min(60, v)); changed(); } };
    $("shOrder").onchange = e => { opt.order = e.target.value; changed(); };
    $("shRes").onchange = e => { opt.res = e.target.value; changed(); };
    $("shPlay").onclick = play;
    $("shScrub").oninput = e => { playing = false; $("shPlay").textContent = "▶ 재생"; preview(+e.target.value); };
    $("shMp4").onclick = exportMp4; $("shSeq").onclick = exportSeq; $("shPng").onclick = exportPng;
    document.addEventListener("keydown", e => {
      if (tab.hidden || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if ((e.key === "Delete" || e.key === "Backspace") && sel >= 0) { opt.shapes.splice(sel, 1); sel = -1; changed(); e.preventDefault(); }
    });
    mountCanvas();
    b.addEventListener("click", () => setTimeout(() => { fillSel(); preview(); }, 0));
    window.addEventListener("resize", () => { if (!tab.hidden) preview(); });
    fillSel();
  }
  RS.shapes = {build, draw, strokesOf};
  mount();
})(RS);
