// ---------------------------------------------------------------- 4. place intro: hand-drawn Japan outline + marker + label
// The same steps every time: coastline simplified (Douglas-Peucker) and rounded (Chaikin), resampled every 2 px,
// a fixed-seed "boil" wobble switching at 10 fps, and the label written stroke by stroke in drawn capitals.
(function (RS) {
  const $ = id => document.getElementById(id);
  const DEF = {text: "SHIONOMISAKI", lat: 33.4366, lon: 135.7622, side: "auto", len: 70, shift: 0, dur: 6, res: "1920x1080", size: 1, place: "cm", boil: true, dot: "#ffffff", style: "auto", zoom: 1, zmode: "after"};
  const load = () => {
    try {
      const raw = JSON.parse(localStorage.getItem("rs.intro") || "{}");
      if (!("len" in raw)) delete raw.side;        // saved before automatic label placement existed -> start on "auto"
      return Object.assign({}, DEF, raw);
    } catch (e) { return Object.assign({}, DEF); }
  };
  const save = o => { try { localStorage.setItem("rs.intro", JSON.stringify(o)); } catch (e) { /* private window */ } };
  let opt = load();
  // older saved choices (5 spots) -> 3x3 grid
  opt.place = {center: "cm", left: "lm", right: "rm", top: "ct", bottom: "cb"}[opt.place] || opt.place;

  // ------------------------------------------------------------ maths
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

  // ------------------------------------------------------------ drawn capitals (box 1 wide x 2.2 tall, y down)
  function cr(pts, n = 10) {                 // Catmull-Rom through points
    const P = [pts[0], ...pts, pts[pts.length - 1]], out = [];
    for (let i = 1; i < P.length - 2; i++) {
      const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
      for (let s = 0; s < n; s++) {
        const t = s / n, t2 = t * t, t3 = t2 * t;
        out.push([0, 1].map(k => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
      }
    }
    out.push(pts[pts.length - 1]); return out;
  }
  function oval(w = 1) {
    const out = [];
    for (let i = 39; i >= 0; i--) { const a = -0.25 + (2 * Math.PI - 0.05 + 0.25) * i / 39; out.push([w / 2 + w / 2 * Math.sin(a), 1.1 - 1.1 * Math.cos(a)]); }
    return out;
  }
  const P_BOWL = [[0, 0], [0.55, 0], [0.9, 0.3], [0.9, 0.85], [0.55, 1.15], [0, 1.15]];
  const G = {
    A: [1.0, [[[0, 2.2], [0.5, 0], [1, 2.2]], [[0.22, 1.4], [0.78, 1.4]]]],
    B: [0.92, [[[0, 0], [0, 2.2]], cr([[0, 0], [0.55, 0], [0.85, 0.25], [0.85, 0.75], [0.55, 1.05], [0, 1.05]]), cr([[0, 1.05], [0.6, 1.05], [0.92, 1.35], [0.92, 1.85], [0.6, 2.2], [0, 2.2]])]],
    C: [0.95, [cr([[0.95, 0.35], [0.7, 0.03], [0.4, 0.02], [0.1, 0.4], [0, 1.1], [0.1, 1.8], [0.45, 2.2], [0.75, 2.15], [0.95, 1.85]])]],
    D: [0.95, [[[0, 0], [0, 2.2]], cr([[0, 0], [0.45, 0.05], [0.85, 0.5], [0.95, 1.1], [0.85, 1.7], [0.45, 2.15], [0, 2.2]])]],
    E: [0.9, [[[0.9, 0], [0, 0], [0, 2.2], [0.9, 2.2]], [[0, 1.08], [0.75, 1.08]]]],
    F: [0.9, [[[0.9, 0], [0, 0], [0, 2.2]], [[0, 1.08], [0.75, 1.08]]]],
    G: [1.0, [cr([[0.95, 0.35], [0.7, 0.03], [0.4, 0.02], [0.1, 0.4], [0, 1.1], [0.1, 1.8], [0.45, 2.2], [0.8, 2.05], [0.97, 1.65], [0.97, 1.25]]), [[0.97, 1.25], [0.55, 1.25]]]],
    H: [0.95, [[[0, 0], [0, 2.2]], [[0.95, 0], [0.95, 2.2]], [[0, 1.08], [0.95, 1.08]]]],
    I: [0.12, [[[0.06, 0], [0.06, 2.2]]]],
    J: [0.8, [cr([[0.8, 0], [0.8, 1.6], [0.65, 2.1], [0.35, 2.2], [0.08, 2.0], [0, 1.7]])]],
    K: [0.95, [[[0, 0], [0, 2.2]], [[0.95, 0], [0, 1.3]], [[0.3, 1.0], [0.95, 2.2]]]],
    L: [0.85, [[[0, 0], [0, 2.2], [0.85, 2.2]]]],
    M: [1.15, [[[0, 2.2], [0.06, 0], [0.575, 1.45], [1.09, 0], [1.15, 2.2]]]],
    N: [0.95, [[[0, 2.2], [0, 0], [0.95, 2.2], [0.95, 0]]]],
    O: [1.0, [oval()]],
    P: [0.9, [[[0, 2.2], [0, 0]], cr(P_BOWL)]],
    Q: [1.05, [oval(), [[0.6, 1.6], [1.05, 2.3]]]],
    R: [0.95, [[[0, 2.2], [0, 0]], cr(P_BOWL), [[0.4, 1.15], [0.95, 2.2]]]],
    S: [0.95, [cr([[0.92, 0.32], [0.7, 0.04], [0.42, 0], [0.12, 0.18], [0.07, 0.58], [0.35, 0.95], [0.72, 1.22], [0.93, 1.62], [0.82, 2.05], [0.48, 2.2], [0.15, 2.1], [0.02, 1.85]])]],
    T: [1.0, [[[0, 0], [1, 0]], [[0.5, 0], [0.5, 2.2]]]],
    U: [0.95, [cr([[0, 0], [0, 1.55], [0.15, 2.05], [0.48, 2.2], [0.8, 2.05], [0.95, 1.55], [0.95, 0]])]],
    V: [1.0, [[[0, 0], [0.5, 2.2], [1, 0]]]],
    W: [1.3, [[[0, 0], [0.3, 2.2], [0.65, 0.6], [1.0, 2.2], [1.3, 0]]]],
    X: [1.0, [[[0, 0], [1, 2.2]], [[1, 0], [0, 2.2]]]],
    Y: [1.0, [[[0, 0], [0.5, 1.05]], [[1, 0], [0.5, 1.05], [0.5, 2.2]]]],
    Z: [0.95, [[[0, 0], [0.95, 0], [0, 2.2], [0.95, 2.2]]]],
    0: [0.85, [oval(0.85)]],
    1: [0.5, [[[0.1, 0.4], [0.4, 0], [0.4, 2.2]]]],
    2: [0.95, [cr([[0.05, 0.45], [0.3, 0.05], [0.65, 0.05], [0.9, 0.45], [0.8, 0.95], [0, 2.2]]), [[0, 2.2], [0.95, 2.2]]]],
    3: [0.9, [cr([[0.05, 0.3], [0.4, 0], [0.8, 0.15], [0.85, 0.6], [0.4, 1.05]]), cr([[0.4, 1.05], [0.85, 1.35], [0.9, 1.85], [0.5, 2.2], [0.05, 1.95]])]],
    4: [1.0, [[[0.7, 2.2], [0.7, 0], [0, 1.5], [1, 1.5]]]],
    5: [0.92, [[[0.9, 0], [0.15, 0], [0.08, 1.0]], cr([[0.08, 1.0], [0.5, 0.85], [0.9, 1.2], [0.92, 1.75], [0.55, 2.2], [0.05, 2.0]])]],
    6: [0.92, [cr([[0.85, 0.15], [0.5, 0], [0.15, 0.4], [0.02, 1.2], [0.1, 1.9], [0.5, 2.2], [0.9, 1.9], [0.92, 1.4], [0.55, 1.05], [0.1, 1.3]])]],
    7: [0.95, [[[0, 0], [0.95, 0], [0.35, 2.2]]]],
    8: [0.92, [cr([[0.5, 1.05], [0.12, 0.75], [0.15, 0.2], [0.5, 0], [0.85, 0.2], [0.88, 0.75], [0.5, 1.05], [0.08, 1.5], [0.12, 2.0], [0.5, 2.2], [0.88, 2.0], [0.92, 1.5], [0.5, 1.05]])]],
    9: [0.92, [cr([[0.9, 0.9], [0.55, 1.15], [0.1, 0.9], [0.1, 0.3], [0.5, 0], [0.9, 0.3], [0.92, 1.0], [0.8, 1.8], [0.45, 2.2], [0.1, 2.05]])]],
    "-": [0.6, [[[0.05, 1.2], [0.55, 1.2]]]],
    ".": [0.12, [[[0.05, 2.12], [0.07, 2.2]]]],
    "'": [0.12, [[[0.07, 0], [0.05, 0.5]]]],
  };
  const drawable = s => [...s.toUpperCase()].every(c => c === " " || G[c]);
  function textStrokes(s, x0, y0, cap, gap, seed = 3) {
    const r = rng(seed), u = cap / 2.2, out = []; let x = x0;
    const uni = (a, b) => a + (b - a) * r();
    for (const ch of s.toUpperCase()) {
      if (ch === " ") { x += 0.6 * u; continue; }
      const [adv, strokes] = G[ch];
      const tilt = uni(-0.03, 0.03), dy = uni(-0.03, 0.03) * cap;
      for (const st of strokes) out.push(st.map(([a, b]) => { a += uni(-0.025, 0.025); b += uni(-0.02, 0.02); return [x + (a + tilt * (b - 1.1)) * u, y0 + dy + b * u]; }));
      x += adv * u + gap;
    }
    return {strokes: out, width: x - gap - x0};
  }

  // ------------------------------------------------------------ scene (built once per settings)
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
  function build(land, o, W, H) {
    const s = H / 1080, k = 63 * s, kx = k * Math.cos(38 * Math.PI / 180);
    const X = lo => W / 2 + 40 * s + (lo - 137.6) * kx, Y = la => 42 * s + (45.55 - la) * k;
    const z = [2, 3, 4, 5].includes(+o.zoom) ? +o.zoom : 1;
    const rings = [];                          // Japan's coastline projected to the whole-map view, not yet simplified
    for (const sh of land) {
      const [w, so, e, n] = sh.bbox;
      if (e < 129 || w > 146.5 || n < 30.5 || so > 46) continue;
      for (const f of sh.flat) {
        let cx = 0, cy = 0; const m = f.length / 2;
        for (let i = 0; i < f.length; i += 2) { cx += f[i]; cy += f[i + 1]; }
        cx /= m; cy /= m;
        if (!(cx > 129.4 && cx < 145.7 && cy > 30.95 && cy < 45.6)) continue;
        const q = []; for (let i = 0; i < f.length; i += 2) q.push([X(f[i]), Y(f[i + 1])]);
        if (area(q) < 60 * s * s / (z * z)) continue;      // small islands only show up when zoomed in
        if (hyp(q[0], q[q.length - 1]) < 1e-6) q.pop();
        rings.push(q);
      }
    }
    // simplify (Douglas-Peucker), round (Chaikin) and resample every 2 px; rings are split at their far point first
    const smooth = (q, closed) => {
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
    const bySize = (a, b) => b.length - a.length;
    const coast = rings.filter(q => area(q) >= 60 * s * s).map(q => smooth(q, true)).filter(Boolean).sort(bySize);
    const pt = [X(o.lon), Y(o.lat)];
    const cap = 92 * s * o.size, gap = 16 * s * o.size;
    const hand = o.style !== "font" && drawable(o.text);
    let tw, th = cap;
    if (hand) tw = textStrokes(o.text, 0, 0, cap, gap).width;
    else { const c = new OffscreenCanvas(8, 8).getContext("2d"); c.font = fontCss(cap, o.text); tw = c.measureText(o.text).width; }
    // label at the end of a dashed leader: below / above / right / left of the dot P.
    // shift moves the label along the side (-1..1); "auto" tries many spots and keeps the one clear of the coast
    const lay = (P, side, len, shift) => {
      const d = {below: [0, 1], above: [0, -1], right: [1, 0], left: [-1, 0]}[side];
      const a = [P[0] + d[0] * 16 * s, P[1] + d[1] * 16 * s], b = [a[0] + d[0] * len, a[1] + d[1] * len];
      let tx, ty;
      if (d[0] === 0) { tx = b[0] - (0.12 - shift) * tw; ty = d[1] > 0 ? b[1] + 14 * s : b[1] - 14 * s - th; }
      else { ty = P[1] - th / 2 + shift * th; tx = d[0] > 0 ? b[0] + 14 * s : b[0] - 14 * s - tw; }
      return {a, b, tx, ty};
    };
    const choose = (P, pts) => {
      const hits = L => {                     // coast points under the label (with a margin) or on the leader
        const m = 12 * s; let n = 0;
        const [ax, ay] = L.a, [bx, by] = L.b, lx0 = Math.min(ax, bx) - 6 * s, lx1 = Math.max(ax, bx) + 6 * s, ly0 = Math.min(ay, by) - 6 * s, ly1 = Math.max(ay, by) + 6 * s;
        for (const [x, y] of pts) {
          if (x > L.tx - m && x < L.tx + tw + m && y > L.ty - m && y < L.ty + th + m) n++;
          else if (x > lx0 && x < lx1 && y > ly0 && y < ly1) n++;
        }
        return n;
      };
      if (o.side !== "auto") return lay(P, o.side, (o.len || 70) * s, o.shift || 0);
      let best = Infinity, L = null;
      ["below", "above", "right", "left"].forEach((side, si) => {
        for (const len of [70, 110, 160, 220, 300]) for (const sh of side === "below" || side === "above" ? [0, -0.38, 0.12, -0.76, 0.3] : [0, -0.6, 0.6]) {
          const c = lay(P, side, len * s, sh);
          const out = Math.max(0, -c.tx) + Math.max(0, c.tx + tw - W) + Math.max(0, -c.ty) + Math.max(0, c.ty + th - H);
          const cost = hits(c) * 1000 + out * (z > 1 ? 60 : 2) / s + len * 0.5 + si * 15 + Math.abs(sh) * 30;   // zoomed: nothing shrinks to make room
          if (cost < best) { best = cost; L = c; }
        }
      });
      return L;
    };
    // where the whole drawing sits: 3x3 grid (l/c/r + t/m/b); edge spots use half the frame and hug that edge,
    // the drawing shrinks only when it does not fit there. "cm" = whole frame, centred (the original layout)
    const pl = /^[lcr][tmb]$/.test(o.place) ? o.place : "cm", hx = pl[0], vy = pl[1], mg = 30 * s;
    const fitTo = (x0, x1, y0, y1) => {
      const aw = hx === "c" ? W : W / 2, ah = vy === "m" ? H : H / 2;
      const f = Math.min(1, (aw - 2 * mg) / (x1 - x0), (ah - 2 * mg) / (y1 - y0)), gw = f * (x1 - x0), gh = f * (y1 - y0);
      const gx = hx === "l" ? mg : hx === "r" ? W - mg - gw : (W - gw) / 2;
      const gy = vy === "t" ? mg : vy === "b" ? H - mg - gh : (H - gh) / 2;
      return {f, ox: gx - f * x0, oy: gy - f * y0};
    };
    const box = extra => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const q of coast.concat([extra])) for (const [x, y] of q) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      return [x0, x1, y0, y1];
    };
    const sc = {W, H, s, z, hand, cap, text: o.text, dur: o.dur, coast: [], final: [], label: []};
    let L, fin = [];
    if (z === 1) {
      L = choose(pt, [].concat(...coast));
      sc.pt = pt;
      sc.fit = fitTo(...box([[L.tx, L.ty], [L.tx + tw, L.ty + th], [pt[0] - 10 * s, pt[1] - 10 * s], [pt[0] + 10 * s, pt[1] + 10 * s]]));
    } else {
      // zoom: the whole map as it is placed without zoom, then enlarged z times around the dot,
      // with the dot moved to its spot in the 3x3 grid. The coast is rebuilt at the zoomed size so detail stays sharp.
      const fit = fitTo(...box([[pt[0] - 10 * s, pt[1] - 10 * s], [pt[0] + 10 * s, pt[1] + 10 * s]]));
      const pF = [fit.ox + fit.f * pt[0], fit.oy + fit.f * pt[1]];
      const A = [{l: 0.3, c: 0.5, r: 0.7}[hx] * W, {t: 0.36, m: 0.5, b: 0.64}[vy] * H];
      const T = p => [A[0] + (fit.ox + fit.f * p[0] - pF[0]) * z, A[1] + (fit.oy + fit.f * p[1] - pF[1]) * z];
      const pad = 40 * s, inside = p => p[0] > -pad && p[0] < W + pad && p[1] > -pad && p[1] < H + pad;
      for (const r of rings) {
        if (o.zmode !== "start" && area(r) < 60 * s * s) continue;   // zoom animation: same islands before and after
        const q = r.map(T);
        if (area(q) < 60 * s * s) continue;
        if (q.every(inside)) { const c = smooth(q, true); if (c) fin.push(c); continue; }
        let run = [];
        const flush = () => { if (run.length > 1) { const c = smooth(run, false); if (c) fin.push(c); } run = []; };
        for (const p of q.concat([q[0]])) { if (inside(p)) run.push(p); else flush(); }
        flush();
      }
      fin.sort(bySize);
      L = choose(A, [].concat(...fin));
      sc.pt = A; sc.fit = {f: 1, ox: 0, oy: 0}; sc.zoom = {fit, pF, A};
    }
    sc.lead = [L.a, L.b]; sc.tx = L.tx; sc.ty = L.ty;
    // three boil variants of every line, prepared up front
    const closed = q => hyp(q[0], q[q.length - 1]) < 1e-6;
    for (let v = 0; v < 3; v++) {
      sc.coast.push(coast.map((q, i) => withLen(wobble(q, 0.9 * s, 1000 * v + i + 1, true))));
      sc.final.push(fin.map((q, i) => withLen(wobble(q, 0.9 * s, 5000 + 1000 * v + i, closed(q)))));
      if (hand) sc.label.push(textStrokes(o.text, L.tx, L.ty, cap, gap).strokes.map((q, i) => withLen(wobble(resample(q, 1.5 * s), 0.4 * s, 77 + 1000 * v + i, false))));
    }
    return sc;
  }
  // label set in type: the Korean / Japanese font and title weight chosen in tab 3 (글꼴)
  function fontCss(px, text = "") {
    const size = Math.round(px * 0.82), lang = /[぀-ヿ]/.test(text) ? "jp" : "kr";
    return RS.fonts ? RS.fonts.css(size, lang, "Bold") : `700 ${size}px "Nanum Myeongjo", "Noto Sans JP", "Malgun Gothic", sans-serif`;
  }

  // ------------------------------------------------------------ one frame
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
  function draw(ctx, sc, t, frameNo, bg) {
    const {s} = sc, v = opt.boil ? Math.floor(frameNo / 3) % 3 : 0;   // no boil: one fixed line for every frame
    // zoom "after": the whole map draws, the dot pops, then the view closes in on it (2.5 - 3.7 s); the leader
    // and the label follow once the zoom has settled
    const anim = sc.z > 1 && opt.zmode !== "start", ZS = 2.5, ZE = 3.7, lag = anim ? ZE - 2.25 : 0;
    ctx.save();
    ctx.fillStyle = bg || "#000"; if (bg === null) ctx.clearRect(0, 0, sc.W, sc.H); else ctx.fillRect(0, 0, sc.W, sc.H);
    ctx.strokeStyle = ctx.fillStyle = "#fff"; ctx.lineCap = ctx.lineJoin = "round";
    const p = ease(t / 2.2);
    let lw = 1, dotAt = sc.pt;
    // 1. coastline draws on (0 - 2.2 s)
    if (sc.z === 1) {
      ctx.translate(sc.fit.ox, sc.fit.oy); ctx.scale(sc.fit.f, sc.fit.f);
      lw = Math.pow(sc.fit.f, -0.6);          // a shrunk drawing keeps most of its line weight
      ctx.lineWidth = 4.2 * s * lw;
      for (const L of sc.coast[v]) stroke(ctx, L, p * L.len);
    } else if (anim && t < ZE) {
      const {fit, pF, A} = sc.zoom, e = ease((t - ZS) / (ZE - ZS)), kz = 1 + (sc.z - 1) * e;
      const P = [pF[0] + (A[0] - pF[0]) * e, pF[1] + (A[1] - pF[1]) * e];
      ctx.save();
      ctx.translate(P[0], P[1]); ctx.scale(kz, kz); ctx.translate(-pF[0], -pF[1]);
      ctx.translate(fit.ox, fit.oy); ctx.scale(fit.f, fit.f);
      ctx.lineWidth = 4.2 * s * (Math.pow(fit.f, 0.4) * (1 - e) + e) / (fit.f * kz);   // same on-screen weight as before and after
      for (const L of sc.coast[v]) stroke(ctx, L, p * L.len);
      ctx.restore();
      dotAt = P;
    } else {
      ctx.lineWidth = 4.2 * s;
      for (const L of sc.final[v]) stroke(ctx, L, (anim ? 1 : p) * L.len);
    }
    // 2. dot pops (2.0 - 2.4 s)
    const d = (t - 2.0) / 0.4;
    if (d > 0) {
      const r = 8 * s * (d < 0.7 ? Math.min(1, d) * 1.25 : 1 + 0.25 * Math.max(0, 1 - (d - 0.7) / 0.3));
      ctx.fillStyle = /^#[0-9a-f]{6}$/i.test(opt.dot) ? opt.dot : "#fff";
      ctx.beginPath(); ctx.arc(dotAt[0], dotAt[1], r, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = "#fff";
    }
    // 3. dashed leader (2.3 - 2.8 s, later when zooming)
    const g = ease((t - lag - 2.3) / 0.5);
    if (g > 0) {
      ctx.lineWidth = 3.2 * s * lw;
      const [a, b] = sc.lead, len = hyp(a, b), ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len, end = len * g;
      ctx.beginPath();
      for (let k = 0; k < end; k += 16 * s) { const k2 = Math.min(k + 9 * s, end); ctx.moveTo(a[0] + ux * k, a[1] + uy * k); ctx.lineTo(a[0] + ux * k2, a[1] + uy * k2); }
      ctx.stroke();
    }
    // 4. label written (2.7 - 4.1 s, later when zooming)
    const w = Math.min(1, (t - lag - 2.7) / 1.4);
    if (w > 0) {
      if (sc.hand) {
        ctx.lineWidth = lw * 5 * s * Math.max(0.7, Math.min(1.4, sc.cap / (92 * s)));
        const L = sc.label[v], tot = L.reduce((a, b) => a + b.len, 0); let budget = w * tot;
        for (const l of L) { if (budget <= 0) break; stroke(ctx, l, budget); budget -= l.len; }
      } else {                               // other scripts: the font, revealed left to right
        ctx.font = fontCss(sc.cap, sc.text); ctx.textBaseline = "top";
        const m = ctx.measureText(sc.text).width;
        ctx.beginPath(); ctx.rect(sc.tx - 10 * s, sc.ty - 20 * s, (m + 20 * s) * ease(w), sc.cap + 40 * s); ctx.clip();
        ctx.fillText(sc.text, sc.tx, sc.ty + sc.cap * 0.05);
      }
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ files
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
  const yieldUI = () => new Promise(r => setTimeout(r, 0));

  // ------------------------------------------------------------ UI
  const FPS = 30;
  let land = null, scene = null, sceneKey = "", playing = false, t0 = 0, cur = 0, busy = false, cancel = false;
  const status = (m, k = "") => { const el = $("miStatus"); el.textContent = m; el.dataset.kind = k; };
  const dims = () => opt.res.split("x").map(Number);

  async function ensureScene() {
    const [W, H] = dims(), fc = RS.fonts ? JSON.stringify(RS.fonts.conf()) : "", key = JSON.stringify([opt.text, opt.lat, opt.lon, opt.side, opt.len, opt.shift, opt.size, opt.place, opt.style, opt.zoom, opt.zmode, fc, W, H]);
    if (scene && key === sceneKey) { scene.dur = opt.dur; return scene; }
    if (!land) { land = await RS.neLayer("land", m => status(m)); status(""); }
    if (!(opt.style !== "font" && drawable(opt.text))) {     // typed label: load its glyphs before measuring or drawing
      if (RS.fonts) await RS.fonts.ensure(opt.text);
      if (document.fonts) await document.fonts.load(fontCss(92 * H / 1080 * opt.size, opt.text), opt.text).catch(() => []);
    }
    scene = build(land, opt, W, H); scene.dur = opt.dur; sceneKey = key;
    return scene;
  }
  async function preview(t) {
    let sc; try { sc = await ensureScene(); } catch (e) { status(e.message, "error"); return; }
    const c = $("miCanvas"), box = c.parentElement.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(Math.min(box.width, 1200) * dpr), h = Math.round(w * sc.H / sc.W);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const ctx = c.getContext("2d"); ctx.setTransform(w / sc.W, 0, 0, h / sc.H, 0, 0);
    draw(ctx, sc, t, Math.round(t * FPS), "#263a2c");
    $("miScrub").max = sc.dur; $("miScrub").value = t; $("miClock").textContent = `${t.toFixed(1)} / ${sc.dur.toFixed(1)}초`;
    cur = t;
  }
  function play() {
    if (playing) { playing = false; $("miPlay").textContent = "▶ 재생"; return; }
    playing = true; $("miPlay").textContent = "❚❚ 정지";
    if (cur >= opt.dur - 0.05) cur = 0;
    t0 = performance.now() - cur * 1000;
    const step = async () => {
      if (!playing) return;
      const t = (performance.now() - t0) / 1000;
      if (t >= opt.dur) { await preview(opt.dur); playing = false; $("miPlay").textContent = "▶ 재생"; return; }
      await preview(t); requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  const safe = s => s.replace(/[\\/:*?"<>|\s]+/g, "_");

  async function exportMp4() {
    if (busy) { cancel = true; return; }
    if (typeof VideoEncoder === "undefined") { status("이 브라우저는 MP4 인코딩(WebCodecs)을 지원하지 않습니다. 최신 Chrome·Edge 에서 열어 주세요.", "error"); return; }
    const name = safe(`intro_${opt.text}`) + ".mp4";
    const handle = await askSave(name, "MP4 영상", "video/mp4", ".mp4"); if (handle === "cancel") return;
    const sc = await ensureScene(), {W, H} = sc, n = Math.round(sc.dur * FPS);
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
    const name = safe(`intro_${opt.text}`) + "_png.zip";
    const handle = await askSave(name, "PNG 시퀀스 (ZIP)", "application/zip", ".zip"); if (handle === "cancel") return;
    const sc = await ensureScene(), {W, H} = sc, n = Math.round(sc.dur * FPS);
    const cv = new OffscreenCanvas(W, H), ctx = cv.getContext("2d"), files = [], base = safe(opt.text).toLowerCase();
    await run(async f => {
      draw(ctx, sc, f / FPS, f, null);
      files.push({name: `${base}_${String(f).padStart(4, "0")}.png`, data: new Uint8Array(await (await cv.convertToBlob({type: "image/png"})).arrayBuffer())});
    }, n, async () => {
      const blob = zipStore(files), saved = await writeFile(handle, blob, name);
      status(`저장했습니다: ${saved} (${(blob.size / 1048576).toFixed(1)} MB, PNG ${n}장)\n프리미어: 압축을 풀고 가져오기에서 첫 번째 PNG를 고른 뒤 '이미지 시퀀스'에 체크하면 투명 배경 클립 하나로 들어옵니다 (30fps 로 해석되게 설정 확인).`, "ok");
    });
  }
  async function run(perFrame, n, done, cleanup) {
    busy = true; cancel = false; playing = false;
    const btns = [$("miMp4"), $("miPng")]; const labels = btns.map(b => b.textContent);
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

  function stationList() {
    const C = RS.app && RS.app.C && RS.app.C(); const st = (C && C.stations) || [];
    $("miStation").innerHTML = `<option value="">— 정차 지점에서 고르기 —</option>` +
      st.map((s, i) => `<option value="${i}">${i + 1}. ${String(s.ko || s.en || s.id).replace(/</g, "&lt;")}</option>`).join("");
  }
  function fill() {
    $("miText").value = opt.text; $("miLat").value = opt.lat; $("miLon").value = opt.lon;
    $("miSide").value = opt.side; $("miDur").value = opt.dur; $("miRes").value = opt.res; $("miSize").value = opt.size;
    $("miPlace").value = opt.place; $("miBoil").checked = opt.boil; $("miDot").value = opt.dot; $("miStyle").value = opt.style;
    $("miZoom").value = String(opt.zoom); $("miZmode").value = opt.zmode; $("miZmode").disabled = +opt.zoom === 1;
    $("miLen").value = opt.len; $("miShift").value = opt.shift;
    $("miLen").disabled = $("miShift").disabled = opt.side === "auto";
    $("miSizeVal").textContent = (+opt.size).toFixed(1) + "×";
  }
  function changed() { save(opt); if (!playing) preview(Math.min(cur || opt.dur, opt.dur)); }

  function mount() {
    const tabs = document.querySelector(".tabs"); if (!tabs || $("t4")) return;
    const b = document.createElement("button");
    b.setAttribute("role", "tab"); b.dataset.tab = "t4"; b.setAttribute("aria-selected", "false"); b.textContent = "4. 지명 소개";
    tabs.appendChild(b);
    const tab = document.createElement("div"); tab.className = "tab"; tab.id = "t4"; tab.hidden = true;
    tab.innerHTML = `
      <section>
        <h2>지명 소개 영상 <small>일본 지도 윤곽선 → 점 → 점선 → 손글씨 지명</small></h2>
        <div class="g3">
          <label class="f">표시할 글자 (영문은 손글씨, 한글·일본어는 글꼴)<input type="text" id="miText"></label>
          <label class="f">위도<input type="number" id="miLat" step="0.0001"></label>
          <label class="f">경도<input type="number" id="miLon" step="0.0001"></label>
        </div>
        <div class="bar">
          <select id="miStation" style="width:220px"></select>
          <input type="text" id="miQuery" placeholder="장소 이름으로 좌표 찾기 (예: 潮岬)" style="width:220px">
          <button id="miFind" class="small">찾기</button>
        </div>
        <div class="g4" style="margin-top:10px">
          <label class="f">글자 위치<select id="miSide"><option value="auto">자동 (지도와 안 겹치게)</option><option value="below">점 아래</option><option value="above">점 위</option><option value="right">점 오른쪽</option><option value="left">점 왼쪽</option></select></label>
          <label class="f">길이(초)<input type="number" id="miDur" min="4.5" max="30" step="0.5"></label>
          <label class="f">해상도<select id="miRes"><option value="1280x720">1280×720 (HD)</option><option value="1920x1080">1920×1080 (FHD)</option><option value="2560x1440">2560×1440</option><option value="3840x2160">3840×2160 (4K)</option></select></label>
          <label class="f">글자 크기 <span class="mono" id="miSizeVal"></span><input type="range" id="miSize" min="0.6" max="1.6" step="0.1"></label>
        </div>
        <div class="bar">
          <label class="f" style="width:180px">화면 배치<select id="miPlace"><option value="lt">좌상단</option><option value="ct">중상단</option><option value="rt">우상단</option><option value="lm">좌중단</option><option value="cm">중중단 (가운데)</option><option value="rm">우중단</option><option value="lb">좌하단</option><option value="cb">중하단</option><option value="rb">우하단</option></select></label>
          <label class="f" style="width:170px">점선 길이 (수동일 때)<input type="range" id="miLen" min="30" max="400" step="5"></label>
          <label class="f" style="width:170px">글자 옆으로 밀기 (수동일 때)<input type="range" id="miShift" min="-1" max="1" step="0.02"></label>
          <label class="f" style="width:170px">글자 방식<select id="miStyle"><option value="auto">자동 (영문 손글씨)</option><option value="font">항상 글꼴로</option></select></label>
          <label class="f" style="width:150px">점 기준 확대<select id="miZoom"><option value="1">없음 (일본 전체)</option><option value="2">2배</option><option value="3">3배</option><option value="4">4배</option><option value="5">5배</option></select></label>
          <label class="f" style="width:170px">확대 방식<select id="miZmode"><option value="after">지도 그린 뒤 확대</option><option value="start">처음부터 확대</option></select></label>
          <label class="f" style="width:70px">점 색<input type="color" id="miDot" style="height:var(--h);padding:2px;width:100%"></label>
          <label class="check" style="align-self:flex-end;height:var(--h)"><input type="checkbox" id="miBoil"> 선 떨림 (손그림 느낌 · 끄면 선이 고정됨)</label>
        </div>
        <p class="hint">일본 지도는 Natural Earth(퍼블릭 도메인)라 출처 표기 없이 수익 영상에 써도 됩니다. 영문 글자는 글꼴 없이 직접 그린 획이라 글꼴 라이선스 문제가 없습니다.
          한글·일본어는 '3. 글귀·영상 → 글꼴'에서 고른 글꼴과 굵기로 왼쪽부터 드러나게 표시됩니다.</p>
      </section>
      <section>
        <canvas id="miCanvas" style="width:100%;display:block;border-radius:6px;background:#263a2c"></canvas>
        <div class="ctl"><button id="miPlay">▶ 재생</button><input type="range" id="miScrub" class="grow" min="0" max="6" step="0.01" value="0"><span class="mono" id="miClock"></span></div>
        <div class="bar">
          <span class="grow"></span>
          <button id="miPng">PNG 시퀀스 (투명 배경)</button>
          <button id="miMp4" class="primary">MP4 저장 (검은 배경)</button>
        </div>
        <p class="hint">MP4: 프리미어에서 혼합 모드를 '스크린'으로 바꾸면 검은 배경이 사라지고 흰 선만 남습니다 (투명 배경과 똑같은 결과). PNG 시퀀스: 진짜 투명 배경이 필요할 때.</p>
        <div id="miStatus" style="white-space:pre-wrap;margin-top:10px;font-size:12.5px"></div>
      </section>`;
    $("t3").after(tab);
    fill();
    const num = (id, k, lo, hi) => $(id).addEventListener("change", e => { const v = parseFloat(e.target.value); if (isFinite(v)) { opt[k] = Math.max(lo, Math.min(hi, v)); changed(); } });
    $("miText").addEventListener("input", e => { opt.text = e.target.value.trim() || " "; changed(); });
    num("miLat", "lat", 20, 50); num("miLon", "lon", 120, 155); num("miDur", "dur", 4.5, 30);
    $("miSide").onchange = e => { opt.side = e.target.value; fill(); changed(); };
    $("miLen").oninput = e => { opt.len = +e.target.value; changed(); };
    $("miShift").oninput = e => { opt.shift = +e.target.value; changed(); };
    $("miRes").onchange = e => { opt.res = e.target.value; changed(); };
    $("miPlace").onchange = e => { opt.place = e.target.value; changed(); };
    $("miBoil").onchange = e => { opt.boil = e.target.checked; changed(); };
    $("miDot").oninput = e => { opt.dot = e.target.value; changed(); };
    $("miStyle").onchange = e => { opt.style = e.target.value; changed(); };
    $("miZoom").onchange = e => { opt.zoom = +e.target.value; fill(); changed(); };
    $("miZmode").onchange = e => { opt.zmode = e.target.value; changed(); };
    $("miSize").oninput = e => { opt.size = +e.target.value; $("miSizeVal").textContent = opt.size.toFixed(1) + "×"; changed(); };
    $("miStation").onchange = e => {
      const s = RS.app.C().stations[+e.target.value]; if (!s) return;
      Object.assign(opt, {lat: +s.lat, lon: +s.lon, text: String(s.en || s.ko || "").toUpperCase()}); fill(); changed();
    };
    $("miFind").onclick = async () => {
      const q = $("miQuery").value.trim(); if (!q) return;
      try { status("좌표 찾는 중…"); const [la, lo] = await RS.nominatim(q); Object.assign(opt, {lat: +la.toFixed(5), lon: +lo.toFixed(5)}); fill(); changed(); status(`찾았습니다: ${q} → ${la.toFixed(4)}, ${lo.toFixed(4)}`, "ok"); }
      catch (e) { status(e.message, "error"); }
    };
    $("miPlay").onclick = play;
    $("miScrub").oninput = e => { playing = false; $("miPlay").textContent = "▶ 재생"; preview(+e.target.value); };
    $("miMp4").onclick = exportMp4; $("miPng").onclick = exportPng;
    b.addEventListener("click", () => { stationList(); setTimeout(() => preview(cur || opt.dur), 0); });
    window.addEventListener("resize", () => { if (!tab.hidden) preview(cur); });
  }
  RS.mapIntro = {build, draw, textStrokes, drawable};
  mount();
})(RS);
