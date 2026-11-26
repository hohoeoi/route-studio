// ---------------------------------------------------------------- 5. route map: tab 4's hand-drawn Japan outline as the background,
// then a line that travels from the departure point to the arrival point (dots and names at both ends).
// Same coastline steps as tab 4 (Douglas-Peucker -> Chaikin -> 2 px resample -> fixed-seed boil), so the two clips match.
(function (RS) {
  if (!RS.mapIntro) return;
  const $ = id => document.getElementById(id);
  // ---- helpers shared in spirit with tab 4 (copied so this file stands alone)
  function rng(seed) {                       // mulberry32
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function gauss(r) { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }
  const hyp = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  function dp(pts, tol) {
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const st = [[0, pts.length - 1]];
    while (st.length) {
      const [a, b] = st.pop(); if (b <= a + 1) continue;
      const p = pts[a], q = pts[b], dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1e-9;
      let bi = -1, bd = -1;
      for (let i = a + 1; i < b; i++) { const d = Math.abs(dx * (pts[i][1] - p[1]) - dy * (pts[i][0] - p[0])) / L; if (d > bd) { bd = d; bi = i; } }
      if (bd > tol) { keep[bi] = 1; st.push([a, bi], [bi, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }
  function chaikin(pts, n) {                 // closed ring
    for (let k = 0; k < n; k++) {
      const out = [];
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length];
        out.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]], [0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]);
      }
      pts = out;
    }
    return pts;
  }
  function area(p) { let s = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; s += p[i][0] * q[1] - q[0] * p[i][1]; } return Math.abs(s) / 2; }
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
  function wobble(p, amp, seed, closed) {    // smooth random offset along the line (hand-drawn boil)
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
    const out = p.map((q, i) => [q[0] + off[i][0] * amp / sd, q[1] + off[i][1] * amp / sd]);
    if (closed) out[n - 1] = out[0].slice();
    return out;
  }
  function withLen(p) { const c = [0]; for (let i = 1; i < p.length; i++) c.push(c[i - 1] + hyp(p[i], p[i - 1])); return {p, c, len: c[c.length - 1]}; }
  function chaikinOpen(pts, n) {             // open line: ends stay put
    for (let k = 0; k < n; k++) {
      const out = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i], q = pts[i + 1];
        out.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]], [0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]);
      }
      out.push(pts[pts.length - 1]); pts = out;
    }
    return pts;
  }
  function fontCss(px, text = "") {
    const size = Math.round(px * 0.82), lang = /[぀-ヿ]/.test(text) ? "jp" : "kr";
    return RS.fonts ? RS.fonts.css(size, lang, "Bold") : `700 ${size}px "Nanum Myeongjo", "Noto Sans JP", "Malgun Gothic", sans-serif`;
  }
  const ease = t => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
  function stroke(ctx, L, upto) {
    if (upto <= 0 || L.p.length < 2) return;
    ctx.beginPath(); ctx.moveTo(L.p[0][0], L.p[0][1]);
    for (let i = 1; i < L.p.length; i++) {
      if (L.c[i] >= upto) { const f = (upto - L.c[i - 1]) / ((L.c[i] - L.c[i - 1]) || 1); ctx.lineTo(L.p[i - 1][0] + f * (L.p[i][0] - L.p[i - 1][0]), L.p[i - 1][1] + f * (L.p[i][1] - L.p[i - 1][1])); break; }
      ctx.lineTo(L.p[i][0], L.p[i][1]);
    }
    ctx.stroke();
  }
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
  function zipStore(files) {                 // [{name, data:Uint8Array}] -> Blob, no compression (PNG is compressed already)
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
  function toI420(rgba, W, H, out) {         // BT.709 video range (same as the route export)
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
  const {textStrokes, drawable} = RS.mapIntro;
  const DEF = {
    from: {name: "OSAKA", lat: 34.7025, lon: 135.4959, idx: null}, to: {name: "KUSHIMOTO", lat: 33.4753, lon: 135.7811, idx: null},
    shape: "curve-r", zoom: "auto", zmode: "after", place: "cm", move: 3, hold: 1.5, res: "1920x1080", size: 1, style: "auto",
    boil: true, dot: "#ffffff", line: "#ffffff", dash: false, head: true, stops: true, smooth: 0,
  };
  const load = () => {
    try {
      const raw = JSON.parse(localStorage.getItem("rs.route") || "{}"), o = Object.assign({}, DEF, raw);
      o.from = Object.assign({}, DEF.from, raw.from || {}); o.to = Object.assign({}, DEF.to, raw.to || {});
      return o;
    } catch (e) { return JSON.parse(JSON.stringify(DEF)); }
  };
  const save = o => { try { localStorage.setItem("rs.route", JSON.stringify(o)); } catch (e) { /* private window */ } };
  let opt = load();

  // ------------------------------------------------------------ route geometry ([lat, lon] lists)
  const proj = () => (RS.app && RS.app.C && RS.app.C()) || null;
  // "project": follow tab 1's route between the two chosen stops (real track shape where the segment has one)
  function projectChain(o) {
    const C = proj(), st = (C && C.stations) || [], sg = (C && C.segments) || [];
    if (st.length < 2) return null;
    let a = Number.isInteger(o.from.idx) ? o.from.idx : 0, b = Number.isInteger(o.to.idx) ? o.to.idx : st.length - 1;
    a = Math.max(0, Math.min(st.length - 1, a)); b = Math.max(0, Math.min(st.length - 1, b));
    if (a === b) return null;
    const dir = a < b ? 1 : -1, pts = [[+st[a].lat, +st[a].lon]], mids = [], breaks = [];
    for (let i = a; i !== b; i += dir) {
      const p = st[i], q = st[i + dir];
      const g = sg.find(x => x.from === p.id && x.to === q.id) || sg.find(x => x.from === q.id && x.to === p.id);
      let path = g && Array.isArray(g.path) && g.path.length >= 2 ? g.path.map(v => [+v[0], +v[1]]) : [];
      if (g && g.from === q.id) path.reverse();
      pts.push(...path, [+q.lat, +q.lon]);
      if (i + dir !== b) { mids.push([+q.lat, +q.lon]); breaks.push(pts.length - 1); }
    }
    return {pts, mids, breaks};
  }
  function routeLatLon(o) {
    if (o.shape === "project") { const c = projectChain(o); if (c) return c; }
    return {pts: [[o.from.lat, o.from.lon], [o.to.lat, o.to.lon]], mids: []};
  }

  // ------------------------------------------------------------ scene
  function smoothFor(s) {
    return (q, closed) => {
      if (closed) {
        let j = 0, bd = 0; q.forEach((p, i) => { const d = hyp(p, q[0]); if (d > bd) { bd = d; j = i; } });
        const a = dp(q.slice(0, j + 1), 1.6 * s), b = dp(q.slice(j).concat([q[0]]), 1.6 * s);
        q = a.slice(0, -1).concat(b.slice(0, -1));
        if (q.length < 4) return null;
        q = chaikin(q, 2);
        return resample(q.concat([q[0]]), 2 * s);
      }
      q = dp(q, 1.6 * s);
      if (q.length < 2 || hyp(q[0], q[q.length - 1]) + q.length < 3) return null;
      return resample(chaikinOpen(q, 2), 2 * s);
    };
  }
  function measure(text, cap, gap, hand) {
    if (hand) return textStrokes(text, 0, 0, cap, gap).width;
    const c = new OffscreenCanvas(8, 8).getContext("2d"); c.font = fontCss(cap, text); return c.measureText(text).width;
  }
  // detail: OpenStreetMap coastline chains ([lon, lat] lists) for close-up views, or null
  function build(land, o, W, H, detail = null) {
    const s = H / 1080, k = 63 * s, kx = k * Math.cos(38 * Math.PI / 180);
    const X = lo => W / 2 + 40 * s + (lo - 137.6) * kx, Y = la => 42 * s + (45.55 - la) * k;
    const smooth = smoothFor(s);
    const rings = [];
    for (const sh of land) {
      const [w, so, e, n] = sh.bbox;
      if (e < 129 || w > 146.5 || n < 30.5 || so > 46) continue;
      for (const f of sh.flat) {
        let cx = 0, cy = 0; const m = f.length / 2;
        for (let i = 0; i < f.length; i += 2) { cx += f[i]; cy += f[i + 1]; }
        cx /= m; cy /= m;
        if (!(cx > 129.4 && cx < 145.7 && cy > 30.95 && cy < 45.6)) continue;
        const q = []; for (let i = 0; i < f.length; i += 2) q.push([X(f[i]), Y(f[i + 1])]);
        const a = area(q); if (a < 60 * s * s / 144) continue;
        if (hyp(q[0], q[q.length - 1]) < 1e-6) q.pop();
        rings.push({q, a});
      }
    }
    const bySize = (a, b) => b.length - a.length;
    const coast = rings.filter(r => r.a >= 60 * s * s).map(r => smooth(r.q, true)).filter(Boolean).sort(bySize);

    // the route in whole-map coordinates
    const R = routeLatLon(o);
    let line = R.pts.map(([la, lo]) => [X(lo), Y(la)]);
    const P0 = line[0], P1 = line[line.length - 1], dist = hyp(P0, P1);
    if (o.shape === "curve-r" || o.shape === "curve-l") {
      const sg = o.shape === "curve-r" ? 1 : -1, nx = -(P1[1] - P0[1]) / (dist || 1), ny = (P1[0] - P0[0]) / (dist || 1);
      const C = [(P0[0] + P1[0]) / 2 + sg * nx * dist * 0.22, (P0[1] + P1[1]) / 2 + sg * ny * dist * 0.22];
      line = []; for (let i = 0; i <= 64; i++) { const t = i / 64, u = 1 - t; line.push([u * u * P0[0] + 2 * u * t * C[0] + t * t * P1[0], u * u * P0[1] + 2 * u * t * C[1] + t * t * P1[1]]); }
    }
    const mids = R.mids.map(([la, lo]) => [X(lo), Y(la)]);
    const bb = pts => { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return [x0, x1, y0, y1]; };

    // where things sit: same 3x3 grid as tab 4
    const pl = /^[lcr][tmb]$/.test(o.place) ? o.place : "cm", hx = pl[0], vy = pl[1], mg = 30 * s;
    const fitTo = (x0, x1, y0, y1, h = hx, v = vy) => {
      const aw = h === "c" ? W : W / 2, ah = v === "m" ? H : H / 2;
      const f = Math.min(1, (aw - 2 * mg) / (x1 - x0), (ah - 2 * mg) / (y1 - y0)), gw = f * (x1 - x0), gh = f * (y1 - y0);
      const gx = h === "l" ? mg : h === "r" ? W - mg - gw : (W - gw) / 2;
      const gy = v === "t" ? mg : v === "b" ? H - mg - gh : (H - gh) / 2;
      return {f, ox: gx - f * x0, oy: gy - f * y0};
    };
    const japan = bb([].concat(...coast, line));
    const full = fitTo(...japan, "c", "m").f;
    const [rx0, rx1, ry0, ry1] = bb(line), rw = Math.max(rx1 - rx0, 0.02 * s), rh = Math.max(ry1 - ry0, 0.02 * s);
    let z;
    if (o.zoom === "auto") {
      const room = pl === "cm" ? 0.5 : 0.3;
      z = Math.min(room * W / rw, room * H / rh) / full;
      z = z < 1.4 ? 1 : Math.min(z, ZMAX);
    } else z = Math.max(1, Math.min(ZMAX, Math.round(+o.zoom) || 1));

    const cap = 64 * s * o.size, gap = 11 * s * o.size;
    const hand = t => o.style !== "font" && drawable(t);
    const labels = [o.from.name, o.to.name].map(t => String(t || "").trim()).map(t => ({text: t, hand: hand(t), tw: t ? measure(t, cap, gap, hand(t)) : 0, th: cap}));

    const sc = {W, H, s, z, cap, coast: [], final: [], route: [], labels};
    let fin = [], T = p => p;
    if (z === 1) {
      sc.fit = null;                           // set after the labels are placed (the box includes them)
    } else {
      const fit = fitTo(...japan), zs = full * z, c = [(rx0 + rx1) / 2, (ry0 + ry1) / 2];
      const pF = [fit.ox + fit.f * c[0], fit.oy + fit.f * c[1]];
      const A = [{l: 0.3, c: 0.5, r: 0.7}[hx] * W, {t: 0.36, m: 0.5, b: 0.64}[vy] * H];
      T = p => [A[0] + (p[0] - c[0]) * zs, A[1] + (p[1] - c[1]) * zs];
      const pad = 40 * s, inside = p => p[0] > -pad && p[0] < W + pad && p[1] > -pad && p[1] < H + pad;
      const clipRun = (q, closedRing) => {
        if (q.every(inside)) { const cc = smooth(closedRing ? q : q, closedRing); if (cc) fin.push(cc); return; }
        let run = [];
        const flush = () => { if (run.length > 1) { const cc = smooth(run, false); if (cc) fin.push(cc); } run = []; };
        for (const p of closedRing ? q.concat([q[0]]) : q) { if (inside(p)) run.push(p); else flush(); }
        flush();
      };
      if (detail) for (const ch of detail) {      // close-up: OpenStreetMap coastline instead of the 1:10M outline
        const q = ch.map(([lo, la]) => T([X(lo), Y(la)])), cl = ch.length > 3 && ch[0][0] === ch[ch.length - 1][0] && ch[0][1] === ch[ch.length - 1][1];
        clipRun(cl ? q.slice(0, -1) : q, cl);
      }
      for (const r of detail ? [] : rings) {
        if (o.zmode !== "start" && r.a < 60 * s * s) continue;       // zoom animation: same islands before and after
        if (r.a * zs * zs / (full * full) < 60 * s * s * 0.6) continue;
        const q = r.q.map(T);
        if (q.every(inside)) { const cc = smooth(q, true); if (cc) fin.push(cc); continue; }
        let run = [];
        const flush = () => { if (run.length > 1) { const cc = smooth(run, false); if (cc) fin.push(cc); } run = []; };
        for (const p of q.concat([q[0]])) { if (inside(p)) run.push(p); else flush(); }
        flush();
      }
      fin.sort(bySize);
      sc.fit = {f: 1, ox: 0, oy: 0}; sc.zoom = {fit, pF, A, c, zs, kEnd: zs / fit.f};
      sc.zd = 1.2 + 0.7 * Math.max(0, Math.log10(zs / fit.f) - 1);   // deeper zooms take a little longer
      sc.detail = !!detail;
      // the area on screen in lat/lon, for fetching a detailed coastline when the outline is too coarse
      if (z > DETAIL_Z) {
        const inv = q => { const pm = [c[0] + (q[0] - A[0]) / zs, c[1] + (q[1] - A[1]) / zs]; return [45.55 - (pm[1] - 42 * s) / k, 137.6 + (pm[0] - W / 2 - 40 * s) / kx]; };
        const [la0, lo0] = inv([-0.25 * W, 1.25 * H]), [la1, lo1] = inv([1.25 * W, -0.25 * H]);
        sc.view = [la0, lo0, la1, lo1].map(v => +v.toFixed(4));          // south, west, north, east
      }
    }
    // route in drawing space, smoothed a little and resampled so it can be drawn on by length
    let rl = line.map(T);
    // "선 다듬기": drop the small wiggles of a real track (bigger simplify step), then round the corners off
    // each stop-to-stop piece separately, so the line still passes through every stop
    const sm = +o.smooth || 0, cuts = o.shape === "project" && R.breaks ? R.breaks : [], pieces = [];
    let from = 0; for (const k of cuts.concat([rl.length - 1])) { pieces.push(rl.slice(from, k + 1)); from = k; }
    rl = pieces.map(q => q.length > 2 ? chaikinOpen(dp(q, [0.8, 12, 32][sm] * s), sm ? 5 : 2) : q)
      .reduce((acc, q, i) => i ? acc.concat(q.slice(1)) : q, []);
    rl = resample(rl, 2 * s);
    const A0 = rl[0], A1 = rl[rl.length - 1];
    const plain = withLen(rl);
    sc.mids = opt.stops ? mids.map(T).map(m => { let bi = 0, bd = Infinity; rl.forEach((p, i) => { const d = hyp(p, m); if (d < bd) { bd = d; bi = i; } }); return {p: m, at: plain.c[bi] / (plain.len || 1)}; }) : [];
    sc.ends = [A0, A1];

    // names next to the dots, clear of the coast, the route and each other
    const coastPts = [].concat(...(z === 1 ? coast : fin)), taken = [];
    const frame = z === 1 ? null : [0, W, 0, H];
    const r = 9 * s;
    const DIRS = [["r", 1, 0], ["l", -1, 0], ["u", 0, -1], ["d", 0, 1], ["ur", 1, -1], ["ul", -1, -1], ["dr", 1, 1], ["dl", -1, 1]];
    const spot = (P, L) => {
      const {tw, th} = L; let best = Infinity, out = null;
      DIRS.forEach(([, dx, dy], di) => {
        for (const g of [14, 34, 70, 120]) {
          const G = g * s; let tx, ty;
          if (dy === 0) { tx = dx > 0 ? P[0] + r + G : P[0] - r - G - tw; ty = P[1] - th / 2; }
          else if (dx === 0) { tx = P[0] - tw / 2; ty = dy < 0 ? P[1] - r - G - th : P[1] + r + G; }
          else { tx = dx > 0 ? P[0] + r + G * 0.6 : P[0] - r - G * 0.6 - tw; ty = dy < 0 ? P[1] - r - G * 0.6 - th : P[1] + r + G * 0.6; }
          const m = 10 * s, inBox = (x, y) => x > tx - m && x < tx + tw + m && y > ty - m && y < ty + th + m;
          let hc = 0, hr = 0;
          for (const [x, y] of coastPts) if (inBox(x, y)) hc++;
          for (const [x, y] of rl) if (inBox(x, y)) hr++;
          for (const e of sc.ends) if (inBox(e[0], e[1])) hr += 20;
          let ov = 0; for (const b of taken) if (tx < b[2] + m && tx + tw > b[0] - m && ty < b[3] + m && ty + th > b[1] - m) ov++;
          let off = 0; if (frame) off = Math.max(0, -tx) + Math.max(0, tx + tw - W) + Math.max(0, -ty) + Math.max(0, ty + th - H);
          const cost = ov * 1e7 + hr * 4000 + hc * 1000 + off * 60 / s + g * 0.6 + di * 12;
          if (cost < best) { best = cost; out = {tx, ty}; }
        }
      });
      taken.push([out.tx, out.ty, out.tx + tw, out.ty + th]);
      return out;
    };
    labels.forEach((L, i) => { if (!L.text) return; Object.assign(L, spot(sc.ends[i], L)); });
    if (z === 1) {
      const extra = [A0, A1].flatMap(p => [[p[0] - 12 * s, p[1] - 12 * s], [p[0] + 12 * s, p[1] + 12 * s]]);
      for (const L of labels) if (L.text) extra.push([L.tx, L.ty], [L.tx + L.tw, L.ty + L.th]);
      sc.fit = fitTo(...bb([].concat(...coast, rl, extra)));
    }

    const closed = q => hyp(q[0], q[q.length - 1]) < 1e-6;
    for (let v = 0; v < 3; v++) {
      sc.coast.push(coast.map((q, i) => withLen(wobble(q, 0.9 * s, 1000 * v + i + 1, true))));
      sc.final.push(fin.map((q, i) => withLen(wobble(q, 0.9 * s, 5000 + 1000 * v + i, closed(q)))));
      const rw2 = wobble(rl, 0.7 * s, 9000 + 1000 * v, false); rw2[0] = A0.slice(); rw2[rw2.length - 1] = A1.slice();
      sc.route.push(withLen(rw2));
      labels.forEach((L, i) => {
        L.strokes = L.strokes || [];
        if (L.text && L.hand) L.strokes.push(textStrokes(L.text, L.tx, L.ty, cap, gap, 3 + i).strokes.map((q, j) => withLen(wobble(resample(q, 1.5 * s), 0.4 * s, 77 + 1000 * v + 50 * i + j, false))));
      });
    }
    return sc;
  }

  // ------------------------------------------------------------ timing
  const ZS = 2.5, ZMAX = 1000, DETAIL_Z = 12;
  const zEnd = sc => ZS + (sc.zd || 1.2);
  function times(sc, o) {
    const anim = sc.z > 1 && o.zmode !== "start";
    const t0 = anim ? zEnd(sc) + 0.15 : 2.0, tl = t0 + 0.7, te = tl + Math.max(0.5, +o.move || 3);
    return {anim, t0, tl, te, dur: te + 1.3 + Math.max(0, +o.hold || 0)};
  }

  // ------------------------------------------------------------ one frame
  function pointAt(L, d) {
    if (d <= 0) return L.p[0]; if (d >= L.len) return L.p[L.p.length - 1];
    let lo = 0, hi = L.c.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L.c[m] < d) lo = m; else hi = m; }
    const f = (d - L.c[lo]) / ((L.c[hi] - L.c[lo]) || 1);
    return [L.p[lo][0] + f * (L.p[hi][0] - L.p[lo][0]), L.p[lo][1] + f * (L.p[hi][1] - L.p[lo][1])];
  }
  const col = (c, d) => /^#[0-9a-f]{6}$/i.test(c) ? c : d;
  const pop = (t, t0) => { const d = (t - t0) / 0.4; return d <= 0 ? 0 : d < 0.7 ? Math.min(1, d) * 1.25 : 1 + 0.25 * Math.max(0, 1 - (d - 0.7) / 0.3); };
  function draw(ctx, sc, t, frameNo, bg) {
    const {s} = sc, v = opt.boil ? Math.floor(frameNo / 3) % 3 : 0, tm = times(sc, opt);
    ctx.save();
    ctx.fillStyle = bg || "#000"; if (bg === null) ctx.clearRect(0, 0, sc.W, sc.H); else ctx.fillRect(0, 0, sc.W, sc.H);
    ctx.strokeStyle = ctx.fillStyle = "#fff"; ctx.lineCap = ctx.lineJoin = "round";
    const p = ease(t / 2.2);
    let lw = 1;
    // 1. coastline (same as tab 4)
    if (sc.z === 1) {
      ctx.translate(sc.fit.ox, sc.fit.oy); ctx.scale(sc.fit.f, sc.fit.f);
      lw = Math.pow(sc.fit.f, -0.6);
      ctx.lineWidth = 4.2 * s * lw;
      for (const L of sc.coast[v]) stroke(ctx, L, p * L.len);
    } else if (tm.anim && t < zEnd(sc)) {
      // scale grows geometrically (a 500x zoom would otherwise rush past everything in the first frames)
      const {fit, pF, A, kEnd, zs, c} = sc.zoom, e = ease((t - ZS) / (zEnd(sc) - ZS)), kz = Math.pow(kEnd, e), u = kEnd > 1 ? (kz - 1) / (kEnd - 1) : e;
      const P = [pF[0] + (A[0] - pF[0]) * u, pF[1] + (A[1] - pF[1]) * u];
      ctx.translate(P[0], P[1]); ctx.scale(kz, kz); ctx.translate(-pF[0], -pF[1]);
      ctx.translate(fit.ox, fit.oy); ctx.scale(fit.f, fit.f);
      const fade = sc.detail ? Math.min(1, Math.max(0, (e - 0.6) / 0.4)) : 0;
      ctx.globalAlpha = 1 - fade;
      ctx.lineWidth = 4.2 * s * (Math.pow(fit.f, 0.4) * (1 - e) + e) / (fit.f * kz);
      for (const L of sc.coast[v]) stroke(ctx, L, p * L.len);
      if (fade > 0) {                        // the detailed coastline (final-view coordinates) fades in near the end
        ctx.globalAlpha = fade;
        ctx.translate(c[0], c[1]); ctx.scale(1 / zs, 1 / zs); ctx.translate(-A[0], -A[1]);
        ctx.lineWidth = 4.2 * s * zs / (fit.f * kz);
        for (const L of sc.final[v]) stroke(ctx, L, L.len);
      }
      ctx.restore(); return;                 // nothing else shows until the zoom has settled
    } else {
      ctx.lineWidth = 4.2 * s;
      for (const L of sc.final[v]) stroke(ctx, L, (tm.anim ? 1 : p) * L.len);
    }
    const dotCol = col(opt.dot, "#ffffff"), lineCol = col(opt.line, "#ffffff");
    // 2. the route draws on from departure to arrival
    const R = sc.route[v], u = ease((t - tm.tl) / (tm.te - tm.tl)), upto = u * R.len;
    if (upto > 0) {
      ctx.strokeStyle = lineCol; ctx.lineWidth = 6.5 * s * lw;
      if (opt.dash) ctx.setLineDash([14 * s * lw, 11 * s * lw]);
      stroke(ctx, R, upto); ctx.setLineDash([]);
    }
    // stops along the way light up as the line passes them
    ctx.fillStyle = dotCol;
    for (const m of sc.mids) {
      if (u < m.at || u <= 0) continue;
      const k = Math.min(1, (u - m.at) * R.len / (24 * s));
      ctx.beginPath(); ctx.arc(m.p[0], m.p[1], 5 * s * k, 0, 2 * Math.PI); ctx.fill();
    }
    // 3. departure and arrival dots
    for (const [P, t0] of [[sc.ends[0], tm.t0], [sc.ends[1], tm.te]]) {
      const k = pop(t, t0); if (!k) continue;
      ctx.beginPath(); ctx.arc(P[0], P[1], 8 * s * k, 0, 2 * Math.PI); ctx.fill();
    }
    // moving head while the line travels
    if (opt.head && u > 0 && u < 1) {
      const h = pointAt(R, upto);
      ctx.fillStyle = lineCol; ctx.beginPath(); ctx.arc(h[0], h[1], 7 * s * lw, 0, 2 * Math.PI); ctx.fill();
    }
    // 4. names written next to the dots
    ctx.strokeStyle = ctx.fillStyle = "#fff";
    sc.labels.forEach((L, i) => {
      if (!L.text) return;
      const w = Math.min(1, (t - (i ? tm.te + 0.25 : tm.t0 + 0.25)) / 1.0); if (w <= 0) return;
      if (L.hand) {
        ctx.lineWidth = lw * 4.4 * s * Math.max(0.7, Math.min(1.4, sc.cap / (64 * s)));
        const S = L.strokes[v], tot = S.reduce((a, b) => a + b.len, 0); let budget = w * tot;
        for (const l of S) { if (budget <= 0) break; stroke(ctx, l, budget); budget -= l.len; }
      } else {
        ctx.save();
        ctx.font = fontCss(sc.cap, L.text); ctx.textBaseline = "top";
        const m = ctx.measureText(L.text).width;
        ctx.beginPath(); ctx.rect(L.tx - 10 * s, L.ty - 20 * s, (m + 20 * s) * ease(w), sc.cap + 40 * s); ctx.clip();
        ctx.fillText(L.text, L.tx, L.ty + sc.cap * 0.05);
        ctx.restore();
      }
    });
    ctx.restore();
  }

  // ------------------------------------------------------------ UI
  const FPS = 30;
  let land = null, scene = null, sceneKey = "", playing = false, t0 = 0, cur = 0, busy = false, cancel = false;
  const status = (m, k = "") => { const el = $("rmStatus"); el.textContent = m; el.dataset.kind = k; };
  const dims = () => opt.res.split("x").map(Number);
  const dur = () => scene ? times(scene, opt).dur : 8;

  async function ensureScene() {
    const [W, H] = dims(), fc = RS.fonts ? JSON.stringify(RS.fonts.conf()) : "";
    const chain = opt.shape === "project" ? JSON.stringify(routeLatLon(opt)) : "";
    const key = JSON.stringify([opt.from, opt.to, opt.shape, opt.zoom, opt.zmode, opt.place, opt.size, opt.style, opt.stops, opt.smooth, fc, chain, W, H]);
    if (scene && key === sceneKey) return scene;
    if (!land) { land = await RS.neLayer("land", m => status(m)); status(""); }
    for (const t of [opt.from.name, opt.to.name]) {
      if (!t || (opt.style !== "font" && drawable(t))) continue;
      if (RS.fonts) await RS.fonts.ensure(t);
      if (document.fonts) await document.fonts.load(fontCss(64 * H / 1080 * opt.size, t), t).catch(() => []);
    }
    let sc = build(land, opt, W, H);
    if (sc.view) {                           // close-up: the 1:10M outline is too coarse, use OpenStreetMap's coastline
      const chains = await coastDetail(sc.view);
      if (chains) { sc = build(land, opt, W, H, chains); status("상세 해안선: OpenStreetMap 데이터입니다. 영상 설명란에 '© OpenStreetMap contributors' 를 적어 주세요.", "ok"); }
    }
    scene = sc; sceneKey = key;
    return scene;
  }
  // coastline ways around the view from Overpass, merged into chains; kept in this browser per area
  const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
  async function coastDetail(v) {
    const ck = "osmcoast:" + v.map(x => x.toFixed(3)).join(",");
    const hit = RS.cacheGet ? await RS.cacheGet(ck) : null;
    if (hit) return hit;
    const q = `[out:json][timeout:60];way["natural"="coastline"](${v.join(",")});out geom;`;
    let last = null;
    for (const url of OVERPASS) {
      try {
        status("상세 해안선을 OpenStreetMap에서 받는 중…");
        const r = await fetch(url, {method: "POST", body: new URLSearchParams({data: q})});
        if (!r.ok) throw new Error("HTTP " + r.status);
        const data = await r.json();
        const ways = (data.elements || []).filter(e => e.type === "way" && e.geometry).map(e => e.geometry.map(g => [g.lon, g.lat]));
        const chains = RS.mergeChains ? RS.mergeChains(ways) : ways;
        if (RS.cacheSet) await RS.cacheSet(ck, chains);
        return chains;
      } catch (e) { last = e; }
    }
    status(`상세 해안선을 받지 못해 일본 전체 윤곽선으로 그립니다 (${last && last.message}). 많이 확대하면 해안선이 거칠게 보일 수 있습니다.`, "warn");
    return null;
  }
  async function preview(t) {
    let sc; try { sc = await ensureScene(); } catch (e) { status(e.message, "error"); return; }
    const c = $("rmCanvas"), box = c.parentElement.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(Math.min(box.width, 1200) * dpr), h = Math.round(w * sc.H / sc.W);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const D = dur(); t = Math.min(t, D);
    const ctx = c.getContext("2d"); ctx.setTransform(w / sc.W, 0, 0, h / sc.H, 0, 0);
    draw(ctx, sc, t, Math.round(t * FPS), "#263a2c");
    $("rmScrub").max = D; $("rmScrub").value = t; $("rmClock").textContent = `${t.toFixed(1)} / ${D.toFixed(1)}초` + (sc.z > 1 ? ` · 확대 ${sc.z.toFixed(1)}배` : "");
    cur = t;
  }
  function play() {
    if (playing) { playing = false; $("rmPlay").textContent = "▶ 재생"; return; }
    playing = true; $("rmPlay").textContent = "❚❚ 정지";
    if (cur >= dur() - 0.05) cur = 0;
    t0 = performance.now() - cur * 1000;
    const step = async () => {
      if (!playing) return;
      const t = (performance.now() - t0) / 1000;
      if (t >= dur()) { await preview(dur()); playing = false; $("rmPlay").textContent = "▶ 재생"; return; }
      await preview(t); requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  const safe = s => String(s || "").replace(/[\\/:*?"<>|\s]+/g, "_") || "x";
  const base = () => `route_${safe(opt.from.name)}_${safe(opt.to.name)}`;
  const yieldUI = () => new Promise(r => setTimeout(r, 0));

  async function exportMp4() {
    if (busy) { cancel = true; return; }
    if (typeof VideoEncoder === "undefined") { status("이 브라우저는 MP4 인코딩(WebCodecs)을 지원하지 않습니다. 최신 Chrome·Edge 에서 열어 주세요.", "error"); return; }
    const name = base() + ".mp4";
    const handle = await askSave(name, "MP4 영상", "video/mp4", ".mp4"); if (handle === "cancel") return;
    const sc = await ensureScene(), {W, H} = sc, n = Math.round(dur() * FPS);
    const mbps = Math.ceil(W / 16) * Math.ceil(H / 16) * FPS;
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
      draw(ctx, sc, f / FPS, f, "#000");
      toI420(ctx.getImageData(0, 0, W, H).data, W, H, yuv);
      const fr = new VideoFrame(yuv, {format: "I420", codedWidth: W, codedHeight: H, timestamp: Math.round(f * 1e6 / FPS), duration: Math.round(1e6 / FPS),
        colorSpace: {primaries: "bt709", transfer: "bt709", matrix: "bt709", fullRange: false}});
      enc.encode(fr, useQ ? {keyFrame: f % 60 === 0, avc: {quantizer: 18}} : {keyFrame: f % 60 === 0}); fr.close();
      while (enc.encodeQueueSize > 6) await new Promise(r => enc.addEventListener("dequeue", r, {once: true}));
      if (failed) throw failed;
    }, n, async () => {
      await enc.flush(); if (failed) throw failed;
      const blob = mux.finish(), saved = await writeFile(handle, blob, name);
      status(`저장했습니다: ${saved} (${(blob.size / 1048576).toFixed(1)} MB)\n프리미어: 영상 위 트랙에 올리고 효과 컨트롤 → 불투명도 → 혼합 모드를 '스크린'으로 바꾸면 검은 배경이 사라집니다.`, "ok");
    }, () => { try { enc.close(); } catch (e) { /* closed */ } });
  }
  async function exportPng() {
    if (busy) { cancel = true; return; }
    const name = base() + "_png.zip";
    const handle = await askSave(name, "PNG 시퀀스 (ZIP)", "application/zip", ".zip"); if (handle === "cancel") return;
    const sc = await ensureScene(), {W, H} = sc, n = Math.round(dur() * FPS);
    const cv = new OffscreenCanvas(W, H), ctx = cv.getContext("2d"), files = [], b = base().toLowerCase();
    await run(async f => {
      draw(ctx, sc, f / FPS, f, null);
      files.push({name: `${b}_${String(f).padStart(4, "0")}.png`, data: new Uint8Array(await (await cv.convertToBlob({type: "image/png"})).arrayBuffer())});
    }, n, async () => {
      const blob = zipStore(files), saved = await writeFile(handle, blob, name);
      status(`저장했습니다: ${saved} (${(blob.size / 1048576).toFixed(1)} MB, PNG ${n}장)\n프리미어: 압축을 풀고 가져오기에서 첫 번째 PNG를 고른 뒤 '이미지 시퀀스'에 체크하면 투명 배경 클립 하나로 들어옵니다.`, "ok");
    });
  }
  async function run(perFrame, n, done, cleanup) {
    busy = true; cancel = false; playing = false;
    const btns = [$("rmMp4"), $("rmPng")], labels = btns.map(b => b.textContent);
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

  function stationLists() {
    const C = proj(), st = (C && C.stations) || [];
    for (const [id, end] of [["rmFromSt", "from"], ["rmToSt", "to"]]) {
      $(id).innerHTML = `<option value="">— 1번 탭 정차 지점에서 고르기 —</option>` +
        st.map((s, i) => `<option value="${i}"${opt[end].idx === i ? " selected" : ""}>${i + 1}. ${String(s.ko || s.en || s.id).replace(/</g, "&lt;")}</option>`).join("");
    }
  }
  function fill() {
    for (const [p, end] of [["rmFrom", "from"], ["rmTo", "to"]]) {
      $(p + "Name").value = opt[end].name; $(p + "Lat").value = opt[end].lat; $(p + "Lon").value = opt[end].lon;
    }
    $("rmShape").value = opt.shape; $("rmZoom").value = String(opt.zoom); $("rmZmode").value = opt.zmode; $("rmZmode").disabled = String(opt.zoom) === "1";
    $("rmPlace").value = opt.place; $("rmMove").value = opt.move; $("rmHold").value = opt.hold; $("rmRes").value = opt.res;
    $("rmSize").value = opt.size; $("rmSizeVal").textContent = (+opt.size).toFixed(1) + "×"; $("rmStyle").value = opt.style;
    $("rmLine").value = opt.line; $("rmDot").value = opt.dot; $("rmDash").checked = opt.dash; $("rmHead").checked = opt.head;
    $("rmStops").checked = opt.stops; $("rmBoil").checked = opt.boil; $("rmSmooth").value = String(opt.smooth || 0);
  }
  function changed() { save(opt); if (!playing) preview(Math.min(cur || 99, 99)); }

  function mount() {
    const tabs = document.querySelector(".tabs"); if (!tabs || $("t5")) return;
    const b = document.createElement("button");
    b.setAttribute("role", "tab"); b.dataset.tab = "t5"; b.setAttribute("aria-selected", "false"); b.textContent = "5. 경로 지도";
    tabs.appendChild(b);
    const tab = document.createElement("div"); tab.className = "tab"; tab.id = "t5"; tab.hidden = true;
    const end = (p, title) => `
        <div class="g3">
          <label class="f">${title} 이름 (영문은 손글씨, 한글·일본어는 글꼴)<input type="text" id="${p}Name"></label>
          <label class="f">위도<input type="number" id="${p}Lat" step="0.0001"></label>
          <label class="f">경도<input type="number" id="${p}Lon" step="0.0001"></label>
        </div>
        <div class="bar">
          <select id="${p}St" style="width:240px"></select>
          <input type="text" id="${p}Q" placeholder="장소 이름으로 좌표 찾기 (예: 串本駅)" style="width:220px">
          <button id="${p}Find" class="small">찾기</button>
        </div>`;
    tab.innerHTML = `
      <section>
        <h2>경로 지도 영상 <small>지명 소개의 일본 지도 윤곽선 → 출발 점 → 이동하는 선 → 도착 점</small></h2>
        ${end("rmFrom", "출발")}
        <div style="height:10px"></div>
        ${end("rmTo", "도착")}
        <div class="g4" style="margin-top:12px">
          <label class="f">선 모양<select id="rmShape"><option value="curve-r">곡선 (오른쪽으로 휨)</option><option value="curve-l">곡선 (왼쪽으로 휨)</option><option value="straight">직선</option><option value="project">1번 탭 경로 따라가기</option></select></label>
          <label class="f">이동 시간(초)<input type="number" id="rmMove" min="0.5" max="30" step="0.5"></label>
          <label class="f">끝난 뒤 멈춤(초)<input type="number" id="rmHold" min="0" max="20" step="0.5"></label>
          <label class="f">해상도<select id="rmRes"><option value="1280x720">1280×720 (HD)</option><option value="1920x1080">1920×1080 (FHD)</option><option value="2560x1440">2560×1440</option><option value="3840x2160">3840×2160 (4K)</option></select></label>
        </div>
        <div class="bar">
          <label class="f" style="width:170px">선 다듬기<select id="rmSmooth"><option value="0">원래 모양</option><option value="1">부드럽게</option><option value="2">아주 부드럽게</option></select></label>
          <label class="f" style="width:170px">확대<select id="rmZoom"><option value="auto">자동 (경로에 맞춤)</option><option value="1">없음 (일본 전체)</option><option value="2">2배</option><option value="3">3배</option><option value="4">4배</option><option value="5">5배</option><option value="6">6배</option><option value="7">7배</option><option value="8">8배</option><option value="9">9배</option><option value="10">10배</option><option value="20">20배</option><option value="50">50배</option><option value="100">100배</option><option value="200">200배</option><option value="500">500배</option><option value="1000">1000배</option></select></label>
          <label class="f" style="width:170px">확대 방식<select id="rmZmode"><option value="after">지도 그린 뒤 확대</option><option value="start">처음부터 확대</option></select></label>
          <label class="f" style="width:180px">화면 배치<select id="rmPlace"><option value="lt">좌상단</option><option value="ct">중상단</option><option value="rt">우상단</option><option value="lm">좌중단</option><option value="cm">중중단 (가운데)</option><option value="rm">우중단</option><option value="lb">좌하단</option><option value="cb">중하단</option><option value="rb">우하단</option></select></label>
          <label class="f" style="width:160px">글자 크기 <span class="mono" id="rmSizeVal"></span><input type="range" id="rmSize" min="0.6" max="1.6" step="0.1"></label>
          <label class="f" style="width:170px">글자 방식<select id="rmStyle"><option value="auto">자동 (영문 손글씨)</option><option value="font">항상 글꼴로</option></select></label>
          <label class="f" style="width:70px">선 색<input type="color" id="rmLine" style="height:var(--h);padding:2px;width:100%"></label>
          <label class="f" style="width:70px">점 색<input type="color" id="rmDot" style="height:var(--h);padding:2px;width:100%"></label>
        </div>
        <div class="bar">
          <label class="check"><input type="checkbox" id="rmDash"> 점선으로</label>
          <label class="check"><input type="checkbox" id="rmHead"> 선 끝에 움직이는 점</label>
          <label class="check"><input type="checkbox" id="rmStops"> 중간 정차 지점 표시 (1번 탭 경로일 때)</label>
          <label class="check"><input type="checkbox" id="rmBoil"> 선 떨림 (손그림 느낌)</label>
        </div>
        <p class="hint">배경 지도는 '4. 지명 소개'와 같은 Natural Earth 윤곽선입니다. '1번 탭 경로 따라가기'는 1번 탭에서 만든 경로를 쓰며, 출발·도착을 정차 지점 목록에서 고르면 그 사이 구간만 그립니다 (Google 경로로 만든 구간은 실제 선로·도로 모양).</p>
      </section>
      <section>
        <canvas id="rmCanvas" style="width:100%;display:block;border-radius:6px;background:#263a2c"></canvas>
        <div class="ctl"><button id="rmPlay">▶ 재생</button><input type="range" id="rmScrub" class="grow" min="0" max="8" step="0.01" value="0"><span class="mono" id="rmClock"></span></div>
        <div class="bar">
          <span class="grow"></span>
          <button id="rmPng">PNG 시퀀스 (투명 배경)</button>
          <button id="rmMp4" class="primary">MP4 저장 (검은 배경)</button>
        </div>
        <p class="hint">MP4: 프리미어에서 혼합 모드를 '스크린'으로 바꾸면 검은 배경이 사라집니다. 선 색을 흰색이 아닌 색으로 바꾸면 스크린 모드에서 배경 영상과 섞여 밝게 보일 수 있으니, 색을 그대로 살리려면 PNG 시퀀스를 쓰세요.</p>
        <div id="rmStatus" style="white-space:pre-wrap;margin-top:10px;font-size:12.5px"></div>
      </section>`;
    ($("t4") || $("t3")).after(tab);
    fill();
    for (const [p, e] of [["rmFrom", "from"], ["rmTo", "to"]]) {
      $(p + "Name").addEventListener("input", ev => { opt[e].name = ev.target.value; changed(); });
      const num = (id, k, lo, hi) => $(id).addEventListener("change", ev => { const v = parseFloat(ev.target.value); if (isFinite(v)) { opt[e][k] = Math.max(lo, Math.min(hi, v)); opt[e].idx = null; stationLists(); changed(); } });
      num(p + "Lat", "lat", 20, 50); num(p + "Lon", "lon", 120, 155);
      $(p + "St").onchange = ev => {
        const i = ev.target.value === "" ? null : +ev.target.value, s = i === null ? null : proj().stations[i];
        opt[e].idx = i;
        if (s) Object.assign(opt[e], {lat: +s.lat, lon: +s.lon, name: String(s.en || s.ko || "").toUpperCase()});
        fill(); changed();
      };
      $(p + "Find").onclick = async () => {
        const q = $(p + "Q").value.trim(); if (!q) return;
        try {
          status("좌표 찾는 중…"); const [la, lo] = await RS.nominatim(q);
          Object.assign(opt[e], {lat: +la.toFixed(5), lon: +lo.toFixed(5), idx: null}); stationLists(); fill(); changed();
          status(`찾았습니다: ${q} → ${la.toFixed(4)}, ${lo.toFixed(4)}`, "ok");
        } catch (err) { status(err.message, "error"); }
      };
    }
    const numTop = (id, k, lo, hi) => $(id).addEventListener("change", e => { const v = parseFloat(e.target.value); if (isFinite(v)) { opt[k] = Math.max(lo, Math.min(hi, v)); changed(); } });
    numTop("rmMove", "move", 0.5, 30); numTop("rmHold", "hold", 0, 20);
    $("rmShape").onchange = e => {
      opt.shape = e.target.value; changed();
      if (opt.shape === "project") { const C = proj(); if (!C || C.stations.length < 2) status("1번 탭에 경로가 아직 없습니다. 지금은 직선으로 그립니다.", "warn"); else status(""); }
    };
    $("rmZoom").onchange = e => { opt.zoom = e.target.value === "auto" ? "auto" : +e.target.value; fill(); changed(); };
    $("rmZmode").onchange = e => { opt.zmode = e.target.value; changed(); };
    $("rmSmooth").onchange = e => { opt.smooth = +e.target.value; changed(); };
    $("rmPlace").onchange = e => { opt.place = e.target.value; changed(); };
    $("rmRes").onchange = e => { opt.res = e.target.value; changed(); };
    $("rmSize").oninput = e => { opt.size = +e.target.value; $("rmSizeVal").textContent = opt.size.toFixed(1) + "×"; changed(); };
    $("rmStyle").onchange = e => { opt.style = e.target.value; changed(); };
    $("rmLine").oninput = e => { opt.line = e.target.value; changed(); };
    $("rmDot").oninput = e => { opt.dot = e.target.value; changed(); };
    $("rmDash").onchange = e => { opt.dash = e.target.checked; changed(); };
    $("rmHead").onchange = e => { opt.head = e.target.checked; changed(); };
    $("rmStops").onchange = e => { opt.stops = e.target.checked; changed(); };
    $("rmBoil").onchange = e => { opt.boil = e.target.checked; changed(); };
    $("rmPlay").onclick = play;
    $("rmScrub").oninput = e => { playing = false; $("rmPlay").textContent = "▶ 재생"; preview(+e.target.value); };
    $("rmMp4").onclick = exportMp4; $("rmPng").onclick = exportPng;
    b.addEventListener("click", () => { stationLists(); setTimeout(() => preview(cur || 99), 0); });
    window.addEventListener("resize", () => { if (!tab.hidden) preview(cur); });
  }
  RS.mapRoute = {build, draw, times};
  mount();
})(RS);
