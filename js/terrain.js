// ---------------------------------------------------------------- real terrain: Natural Earth (ne_bg.py) and OpenStreetMap (osm_bg.py)
// Both produce the same structure the desktop program keeps in cfg.background.osm.
(function (RS) {
  const kmDist = (a, b) => Math.hypot((a[0] - b[0]) * 111.32 * Math.cos((a[1] + b[1]) / 2 * Math.PI / 180), (a[1] - b[1]) * 110.6);
  function thin(pts, minKm) {
    if (pts.length <= 3) return pts.slice();
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) if (kmDist(out[out.length - 1], pts[i]) >= minKm) out.push(pts[i]);
    out.push(pts[pts.length - 1]);
    return out;
  }
  const signed = r => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  const key = p => p[0].toFixed(6) + "," + p[1].toFixed(6);
  function ringsOf(sh) {
    if (sh.rings) return sh.rings;
    return sh.flat.map(f => { const r = []; for (let i = 0; i < f.length; i += 2) r.push([f[i], f[i + 1]]); return r; });
  }
  const ll = pts => pts.map(p => [+p[1].toFixed(5), +p[0].toFixed(5)]);

  function clipPolygon(ring, rect) {          // Sutherland-Hodgman, rect = [w, e, s, n]
    const [w, e, s, n] = rect;
    let out = ring.slice();
    for (const [axis, val, greater] of [[0, w, true], [0, e, false], [1, s, true], [1, n, false]]) {
      if (!out.length) return [];
      const inside = p => (greater ? p[axis] >= val : p[axis] <= val), nw = [];
      for (let i = 0; i < out.length; i++) {
        const a = out[i], b = out[(i + 1) % out.length], ia = inside(a), ib = inside(b);
        if (ia) nw.push(a);
        if (ia !== ib) { const d = b[axis] - a[axis], t = d === 0 ? 0 : (val - a[axis]) / d; nw.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
      }
      out = nw;
    }
    return out;
  }
  function lb(a, b, rect) {                    // Liang-Barsky, rect = [xmin, xmax, ymin, ymax]
    const [xmin, xmax, ymin, ymax] = rect, dx = b[0] - a[0], dy = b[1] - a[1];
    let t0 = 0, t1 = 1;
    for (const [p, q] of [[-dx, a[0] - xmin], [dx, xmax - a[0]], [-dy, a[1] - ymin], [dy, ymax - a[1]]]) {
      if (p === 0) { if (q < 0) return null; }
      else { const r = q / p; if (p < 0) { if (r > t1) return null; t0 = Math.max(t0, r); } else { if (r < t0) return null; t1 = Math.min(t1, r); } }
    }
    return [t0, t1];
  }
  function clipPolyline(pts, rect) {
    const out = []; let cur = null;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1], r = lb(a, b, rect);
      if (!r) { if (cur) { out.push(cur); cur = null; } continue; }
      const [t0, t1] = r;
      const p0 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0], p1 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
      if (!cur) cur = [p0]; else if (t0 > 0) { out.push(cur); cur = [p0]; }
      cur.push(p1);
      if (t1 < 1) { out.push(cur); cur = null; }
    }
    if (cur) out.push(cur);
    return out;
  }

  // ---------------------------------------------------------------- area around the route
  function viewKm(cfg, wkm, hkm) {
    const V = cfg.video || {}, W = V.width || 1920, H = V.height || 1080, u = Math.min(W, H) / 1080;
    const DW = W / u, DH = H / u, sc = Math.min((DW - 88) / Math.max(wkm, 1e-6), (DH - 270) / Math.max(hkm, 1e-6));
    return [DW / sc, DH / sc];
  }
  function routeBbox(cfg, margin = 0.25, coverView = true, maxDeg2 = null) {
    const lats = cfg.stations.map(s => s.lat), lons = cfg.stations.map(s => s.lon);
    for (const g of cfg.segments) for (const p of g.path || []) { lats.push(p[0]); lons.push(p[1]); }
    const s = Math.min(...lats), n = Math.max(...lats), w = Math.min(...lons), e = Math.max(...lons);
    const cy = (s + n) / 2, cx = (w + e) / 2, kx = 111.32 * Math.cos(cy * Math.PI / 180) || 1e-6, ky = 110.6;
    let wkm = Math.max((e - w) * kx, 1), hkm = Math.max((n - s) * ky, 1);
    if (coverView) {
      const [vw, vh] = viewKm(cfg, wkm, hkm);
      wkm = Math.max(wkm, vw); hkm = Math.max(hkm, vh);
      const zo = +((cfg.video || {}).outro_zoom || 1);           // the final zoom-out shows more map
      wkm *= zo; hkm *= zo;
    }
    wkm *= 1 + margin; hkm *= 1 + margin;
    if (maxDeg2) while ((wkm / kx) * (hkm / ky) > maxDeg2 && wkm > 1) { wkm *= 0.9; hkm *= 0.9; }
    return [cy - hkm / 2 / ky, cx - wkm / 2 / kx, cy + hkm / 2 / ky, cx + wkm / 2 / kx];
  }

  // ---------------------------------------------------------------- Natural Earth
  // layers: {land, islands, lakes, rivers, peaks}: arrays of {bbox, rings, props}
  function neBuild(layers, bbox, detail = 1, maxPeaks = 18) {
    const [s, w, n, e] = bbox, rect = [w, e, s, n];
    const span = kmDist([w, (s + n) / 2], [e, (s + n) / 2]);
    const step = Math.max(0.05, span * 0.0035 / Math.max(0.2, detail));
    const hit = sh => !(sh.bbox[2] < w || sh.bbox[0] > e || sh.bbox[3] < s || sh.bbox[1] > n);
    const land = [], coast = [], water = [], rivers = [];
    for (const layer of ["land", "islands"]) for (const sh of layers[layer] || []) {
      if (!hit(sh)) continue;
      const rings = ringsOf(sh).filter(r => r.length >= 4);
      if (!rings.length) continue;
      const areas = rings.map(signed);
      let big = 0; areas.forEach((a, i) => { if (Math.abs(a) > Math.abs(areas[big])) big = i; });
      const outer = areas[big] > 0;
      rings.forEach((ring, i) => {
        const hole = (areas[i] > 0) !== outer, cut = clipPolygon(ring, rect);
        if (cut.length >= 3) (hole ? water : land).push(thin(cut, step));
        if (!hole) for (const piece of clipPolyline(ring.concat([ring[0]]), rect)) if (piece.length >= 2) coast.push(thin(piece, step));
      });
    }
    for (const sh of layers.lakes || []) {
      if (!hit(sh)) continue;
      for (const ring of ringsOf(sh)) { const cut = clipPolygon(ring, rect); if (cut.length >= 3) water.push(thin(cut, step)); }
    }
    for (const sh of layers.rivers || []) {
      if (!hit(sh)) continue;
      for (const line of ringsOf(sh)) for (const piece of clipPolyline(line, rect)) if (piece.length >= 2) rivers.push(thin(piece, step));
    }
    const got = [];
    for (const sh of layers.peaks || []) {
      const rr = ringsOf(sh), p = rr[0] && rr[0][0];
      if (!p || p[0] < w || p[0] > e || p[1] < s || p[1] > n) continue;
      const pr = sh.props || {}, cla = String(pr.featurecla || pr.FEATURECLA || "").toLowerCase();
      if (!["", "range/mtn", "mountain", "peak"].includes(cla)) continue;
      const ele = parseFloat(pr.elevation ?? pr.ELEVATION ?? pr.elev ?? 0) || 0;
      got.push([ele, p[1], p[0], pr.name || pr.NAME || ""]);
    }
    got.sort((a, b) => b[0] - a[0]);
    const peaks = [];
    for (const g of got) { if (peaks.every(c => kmDist([g[2], g[1]], [c[2], c[1]]) > 6)) peaks.push(g); if (peaks.length >= maxPeaks) break; }
    return {sea_fill: true, bbox: bbox.slice(), source: "ne", land: land.map(ll), coast: coast.map(ll), water: water.map(ll),
            rivers: rivers.map(ll), peaks: peaks.map(([ele, la, lo, nm]) => ({at: [+la.toFixed(5), +lo.toFixed(5)], ele, name: nm})),
            attribution: "Natural Earth"};
  }

  // ---------------------------------------------------------------- OpenStreetMap (Overpass)
  const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
  async function osmFetch(bbox, log) {
    const area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
    if (area > 60) throw new Error(`범위가 너무 큽니다 (경로 주변 약 ${Math.round(area)}도²). 구간을 나누어 만들어 주세요.`);
    const b = bbox.map(v => v.toFixed(5)).join(",");
    const parts = [`way["natural"="coastline"](${b});`, `way["natural"="water"](${b});`, `relation["natural"="water"](${b});`, `node["natural"="peak"]["ele"](${b});`];
    if (area < 25) parts.push(`way["waterway"="river"]["name"](${b});`);
    const q = "[out:json][timeout:120];(" + parts.join("") + ");out geom;";
    let last = null;
    for (const url of OVERPASS) {
      try {
        log("OpenStreetMap에서 지형 받는 중… (넓으면 1~2분)");
        const r = await fetch(url, {method: "POST", body: new URLSearchParams({data: q})});
        if (!r.ok) throw new Error("HTTP " + r.status);
        return await r.json();
      } catch (e) { last = e; }
    }
    throw new Error("OpenStreetMap 서버에 연결하지 못했습니다: " + (last && last.message));
  }
  function mergeChains(lines) {
    lines = lines.filter(l => l.length >= 2).map(l => l.slice());
    const startAt = {};
    lines.forEach((l, i) => (startAt[key(l[0])] = startAt[key(l[0])] || []).push(i));
    const used = lines.map(() => false), chains = [];
    lines.forEach((l, i) => {
      if (used[i]) return;
      used[i] = true; let chain = l.slice();
      for (;;) {
        const nxt = (startAt[key(chain[chain.length - 1])] || []).filter(j => !used[j]);
        if (!nxt.length) break;
        used[nxt[0]] = true; chain = chain.concat(lines[nxt[0]].slice(1));
      }
      chains.push(chain);
    });
    let changed = true;
    while (changed) {
      changed = false;
      const ends = {}; chains.forEach((c, k) => (ends[key(c[c.length - 1])] = k));
      for (let k = 0; k < chains.length; k++) {
        const j = ends[key(chains[k][0])];
        if (j !== undefined && j !== k) { chains[j] = chains[j].concat(chains[k].slice(1)); chains.splice(k, 1); changed = true; break; }
      }
    }
    return chains;
  }
  function landFromCoast(chains, rect) {       // rect = [xmin, xmax, ymin, ymax]; land is LEFT of the way
    const land = [], coast = [], holes = [], open = [];
    const D = 1.5 * Math.max(rect[1] - rect[0], rect[3] - rect[2]);
    const eps = 1e-7;
    const onEdge = (p, r) => Math.abs(p[0] - r[0]) < eps || Math.abs(p[0] - r[1]) < eps || Math.abs(p[1] - r[2]) < eps || Math.abs(p[1] - r[3]) < eps;
    const out = p => {
      const dx = Math.abs(p[0] - rect[0]) < eps ? -1 : (Math.abs(p[0] - rect[1]) < eps ? 1 : 0);
      const dy = Math.abs(p[1] - rect[2]) < eps ? -1 : (Math.abs(p[1] - rect[3]) < eps ? 1 : 0);
      return [p[0] + dx * D, p[1] + dy * D];
    };
    for (const ch of chains) {
      const closed = key(ch[0]) === key(ch[ch.length - 1]) && ch.length > 3;
      if (closed && ch.every(p => rect[0] <= p[0] && p[0] <= rect[1] && rect[2] <= p[1] && p[1] <= rect[3])) {
        (signed(ch.slice(0, -1)) > 0 ? land : holes).push(ch.slice(0, -1));
        coast.push(ch); continue;
      }
      for (let sub of clipPolyline(ch, rect))
        if (sub.length >= 2 && onEdge(sub[0], rect) && onEdge(sub[sub.length - 1], rect)) {
          sub = [out(sub[0])].concat(sub, [out(sub[sub.length - 1])]);
          open.push(sub); coast.push(sub);
        }
    }
    const big = [rect[0] - D, rect[1] + D, rect[2] - D, rect[3] + D];
    const [xmin, xmax, ymin, ymax] = big, W = xmax - xmin, H = ymax - ymin, Pm = 2 * (W + H);
    const param = p => {
      if (Math.abs(p[1] - ymin) < eps) return p[0] - xmin;
      if (Math.abs(p[0] - xmax) < eps) return W + (p[1] - ymin);
      if (Math.abs(p[1] - ymax) < eps) return W + H + (xmax - p[0]);
      return 2 * W + H + (ymax - p[1]);
    };
    const mod = (a, m) => ((a % m) + m) % m;
    const corners = (e, s) => {
      const cs = [[0, [xmin, ymin]], [W, [xmax, ymin]], [W + H, [xmax, ymax]], [2 * W + H, [xmin, ymax]]];
      const span = mod(s - e, Pm), pts = [];
      for (const [cp, c] of cs) { const d = mod(cp - e, Pm); if (d > 1e-12 && d < span - 1e-12) pts.push([d, c]); }
      return pts.sort((a, b) => a[0] - b[0]).map(x => x[1]);
    };
    if (open.length) {
      const items = open.map(c => [param(c[0]), param(c[c.length - 1]), c]), used = new Set();
      for (let i = 0; i < items.length; i++) {
        if (used.has(i)) continue;
        let poly = [], cur = i, guard = 0;
        while (guard++ < items.length + 2) {
          used.add(cur);
          const [, e_, c] = items[cur];
          poly = poly.concat(c);
          const cand = items.map((it, j) => [mod(it[0] - e_, Pm), j]).filter(([, j]) => j === i || !used.has(j)).sort((a, b) => a[0] - b[0]);
          const j = cand[0][1];
          poly = poly.concat(corners(e_, items[j][0]));
          if (j === i) break;
          cur = j;
        }
        land.push(poly);
      }
    }
    return [land, coast, holes];
  }
  function areaKm2(r) {
    const k = 111.32 * Math.cos(r.reduce((a, p) => a + p[1], 0) / r.length * Math.PI / 180) * 110.6;
    return Math.abs(signed(r)) * k;
  }
  function osmProcess(data, bbox, maxPeaks = 22) {
    const [s, w, n, e] = bbox, rect = [w, e, s, n];
    const geom = el => (el.geometry || []).map(g => [g.lon, g.lat]);
    const coastWays = [], lakes = [], rivers = [], peaks = [];
    for (const el of data.elements || []) {
      const t = el.type, tags = el.tags || {};
      if (t === "way" && tags.natural === "coastline") coastWays.push(geom(el));
      else if (t === "way" && tags.natural === "water") { const g = geom(el); if (g.length > 3 && key(g[0]) === key(g[g.length - 1])) lakes.push(g.slice(0, -1)); }
      else if (t === "relation" && tags.natural === "water") {
        const outer = (el.members || []).filter(m => m.role === "outer" && m.geometry).map(geom);
        for (const ch of mergeChains(outer)) if (ch.length > 3 && key(ch[0]) === key(ch[ch.length - 1])) lakes.push(ch.slice(0, -1));
      } else if (t === "way" && tags.waterway === "river") rivers.push(geom(el));
      else if (t === "node" && tags.natural === "peak") {
        const ele = parseFloat(String(tags.ele || "0").split(" ")[0].replace(",", ".")) || 0;
        peaks.push([ele, el.lat, el.lon, tags.name || ""]);
      }
    }
    let land = [], coast = [], holes = [];
    if (coastWays.length) [land, coast, holes] = landFromCoast(mergeChains(coastWays), rect);
    const water = lakes.filter(r => areaKm2(r) >= 0.8).map(r => thin(r, 0.12)).concat(holes.map(h => thin(h, 0.12)));
    const riv = [];
    for (const r of rivers.sort((a, b) => b.length - a.length).slice(0, 60)) for (const c of clipPolyline(r, rect)) if (c.length >= 2) riv.push(thin(c, 0.12));
    peaks.sort((a, b) => b[0] - a[0]);
    const chosen = [];
    for (const p of peaks) { if (chosen.every(c => kmDist([p[2], p[1]], [c[2], c[1]]) > 4)) chosen.push(p); if (chosen.length >= maxPeaks) break; }
    return {sea_fill: land.length > 0, bbox: bbox.slice(), land: land.map(p => ll(thin(p, 0.12))), coast: coast.map(c => ll(thin(c, 0.12))),
            water: water.map(ll), rivers: riv.map(ll),
            peaks: chosen.map(([ele, la, lo, nm]) => ({at: [+la.toFixed(5), +lo.toFixed(5)], ele, name: nm})),
            attribution: "© OpenStreetMap contributors"};
  }
  function terrainSummary(d) {
    if (!d || !Object.keys(d).length) return "";
    const n = k => (d[k] || []).length;
    if (d.source === "ne") return `Natural Earth · 육지 ${n("land")} · 해안선 ${n("coast")} · 물 ${n("water")} · 강 ${n("rivers")} · 산 ${n("peaks")}`;
    return `OpenStreetMap · 바다/해안선 ${d.sea_fill ? n("land") : 0} · 호수 ${n("water")} · 강 ${n("rivers")} · 산 ${n("peaks")}`;
  }

  Object.assign(RS, {routeBbox, neBuild, osmFetch, osmProcess, terrainSummary, clipPolygon, clipPolyline, mergeChains, landFromCoast});
})(RS);
