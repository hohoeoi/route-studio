// ---------------------------------------------------------------- frame renderer: port of engine.py Renderer
// Takes the same project (cfg) the desktop program saves, so projects open in either one.
(function (RS) {
  const {rgb, clamp01, easeIO, easeCub, easeBack, shade, fmtMinutes, newCanvas, seeded, buildVehicle, modeGlyph, BUILTIN, forest, fontStack, WEIGHT} = RS;
  const LANGS = ["ko", "ja", "en"];
  const ICONS = /[-�​-‏]/g;
  const MIN_RE = /(?:(\d+)\s*(?:시간|時間|h(?:ours?)?(?![A-Za-z])))?\s*(?:(\d+)\s*(?:분|分|min))/i;
  const mix = (a, b, t) => [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t));

  function tr(v, lang) {
    if (v && typeof v === "object" && !Array.isArray(v)) v = v[lang] || v.en || v.ko || v.ja || "";
    if (Array.isArray(v)) return v.map(x => (typeof x === "string" ? x.replace(ICONS, " ").replace(/\s+/g, " ").trim() : x));
    return typeof v === "string" ? v.replace(ICONS, " ").replace(/\s+/g, " ").trim() : (v || "");
  }
  function legMinutes(seg, lang) {
    const v = seg.minutes;
    if (typeof v === "number" && v > 0) return v;
    const m = MIN_RE.exec(tr(seg.sub, lang) || "");
    if (m && (m[1] || m[2])) return (+(m[1] || 0)) * 60 + (+(m[2] || 0));
    return 0;
  }
  const asColor = v => (Array.isArray(v) ? v.slice(0, 3).map(Number) : null);

  class Renderer {
    // opt: {width, height, images: {src: HTMLImageElement}, fonts: {kr, jp} (user font family names)}
    constructor(cfg, opt = {}) {
      this.cfg = cfg = JSON.parse(JSON.stringify(cfg));
      const V = cfg.video || {};
      this.W = opt.width || V.width || 1920; this.H = opt.height || V.height || 1080;
      this.FPS = +(V.fps || 30);
      this.u = Math.min(this.W, this.H) / 1080;
      this.DW = this.W / this.u; this.DH = this.H / this.u;
      this.R = this.u;
      this.lang = cfg.language || "ko";
      this.images = opt.images || {};
      this.userFonts = opt.fonts || {};
      const P = this.P = {};
      for (const [k, v] of Object.entries(cfg.palette || {})) P[k] = asColor(v);
      for (const [k, v] of Object.entries(RS.BASE_PALETTE)) if (!P[k]) P[k] = v.slice();
      P.card_bg = P.card_bg || [255, 255, 255];
      this.OUTLINE = !!V.route_outline;
      this.LINE_TAGS = !!V.line_labels;
      this.LEG_CHIP = !!V.leg_chip;
      this.TIME_PILLS = V.time_labels !== false;
      this.ROUTE_HALO = this.OUTLINE ? P.route_halo : null;
      this.TL = Object.assign({}, RS.BASE_TIMELINE, cfg.timeline || {});
      this.SPEED = Math.max(1, Math.min(5, +(this.TL.line_speed || 1)));   // route line drawing speed x1-x5
      this.BG = cfg.background || {};
      this.VEH = new Map();
      this.setupGeometry();
      this.setupSprites();
      this.setupCameras();
      this.setupTimeline();
      this.setupBackground();
    }

    // ---- text
    font(size, lang = "kr", weight = "Bold") { return `${WEIGHT[weight] || 700} ${size}px ${fontStack(lang, this.userFonts[lang])}`; }
    nameMain(s) { return s[this.lang] || s.en || s.ko || s.ja || "?"; }
    nameSub(s) {
      const main = this.nameMain(s), order = {ko: ["ja", "en"], ja: ["en"], en: ["ja"]}[this.lang], parts = [];
      for (const k of order) { const v = s[k]; if (v && v !== main && !parts.includes(v)) parts.push(v); }
      return parts.join("  ·  ");
    }
    mainFontLang() { return this.lang === "ja" ? "jp" : "kr"; }
    measure(text, font) { const c = this._mc || (this._mc = newCanvas(4, 4).getContext("2d")); c.font = font; return c.measureText(text).width; }

    // ---- geometry
    km(lat, lon) { return [(lon - this.LON0) * this.KM_LON, -(lat - this.LAT0) * this.KM_LAT]; }
    setupGeometry() {
      const cfg = this.cfg;
      this.STATIONS = cfg.stations || [];
      if (this.STATIONS.length < 2 || !(cfg.segments || []).length) throw new Error("지점 2개 이상과 구간 1개 이상이 필요합니다.");
      this.ST = {}; for (const s of this.STATIONS) this.ST[s.id] = s;
      const latMean = this.STATIONS.reduce((a, s) => a + s.lat, 0) / this.STATIONS.length;
      this.LAT0 = this.STATIONS[0].lat; this.LON0 = this.STATIONS[0].lon;
      this.KM_LAT = 110.6; this.KM_LON = 111.32 * Math.cos(latMean * Math.PI / 180);
      for (const s of this.STATIONS) [s.x, s.y] = this.km(s.lat, s.lon);
      this.LEGS = [];
      for (const seg of cfg.segments) {
        if (!this.ST[seg.from] || !this.ST[seg.to]) throw new Error(`구간이 없는 지점을 가리킵니다: ${seg.from} → ${seg.to}`);
        const path = seg.path, last = this.LEGS[this.LEGS.length - 1];
        let leg;
        if (!path && last && !last.haspath && last.from === seg.from && last.to === seg.to) leg = last;
        else {
          const a = this.ST[seg.from], b = this.ST[seg.to];
          let xs = [], ys = [];
          if (path && path.length >= 2) {
            const pts = [[a.x, a.y], ...path.map(p => this.km(p[0], p[1])), [b.x, b.y]];
            xs = pts.map(p => p[0]); ys = pts.map(p => p[1]);
          } else {
            const n = 240, dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1e-9, bul = seg.bulge ?? 0.08;
            const cx = (a.x + b.x) / 2 - dy / L * L * bul, cy = (a.y + b.y) / 2 + dx / L * L * bul;
            for (let k = 0; k < n; k++) { const t = k / (n - 1); xs.push((1 - t) ** 2 * a.x + 2 * (1 - t) * t * cx + t * t * b.x); ys.push((1 - t) ** 2 * a.y + 2 * (1 - t) * t * cy + t * t * b.y); }
          }
          let cum = [0];
          for (let k = 1; k < xs.length; k++) cum.push(cum[k - 1] + Math.hypot(xs[k] - xs[k - 1], ys[k] - ys[k - 1]));
          if (cum[cum.length - 1] < 1e-6) { xs = [a.x, a.x + 0.05]; ys = [a.y, a.y]; cum = [0, 0.05]; }
          leg = {from: seg.from, to: seg.to, xs, ys, cum, len: cum[cum.length - 1], phases: [], haspath: !!path};
          this.LEGS.push(leg);
        }
        const [f0, f1] = seg.frac || [0, 1];
        const col = asColor(seg.color) || this.P[seg.color] || this.P[seg.vehicle] || this.P.train;
        leg.phases.push({f0, f1, veh: seg.vehicle || "train", col, title: seg.title || "", sub: seg.sub || "",
                         travel_s: Math.max(0.2, +(seg.travel_s || 2) / this.SPEED), minutes: seg.minutes});
      }
      this.ALLX = []; this.ALLY = [];
      for (const l of this.LEGS) { this.ALLX.push(...l.xs); this.ALLY.push(...l.ys); }
    }
    at(leg, s) {
      const c = leg.cum; let lo = 0, hi = c.length - 1;
      if (s <= 0) return [leg.xs[0], leg.ys[0]];
      if (s >= c[hi]) return [leg.xs[hi], leg.ys[hi]];
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= s) lo = m; else hi = m; }
      const k = (s - c[lo]) / ((c[hi] - c[lo]) || 1);
      return [leg.xs[lo] + (leg.xs[hi] - leg.xs[lo]) * k, leg.ys[lo] + (leg.ys[hi] - leg.ys[lo]) * k];
    }

    // ---- pre-drawn pieces
    box(d, x, y, w, h, r, fill, shadow) {
      const R = this.R;
      d.save();
      if (shadow) { d.shadowColor = rgb(this.P.card_sh, shadow[0]); d.shadowBlur = shadow[1] * R; d.shadowOffsetY = shadow[2] * R; }
      d.fillStyle = rgb(this.P.card_bg, fill); d.beginPath(); d.roundRect(x * R, y * R, w * R, h * R, Math.min(r, w / 2, h / 2) * R); d.fill();
      d.restore();
      d.strokeStyle = rgb(this.P.card_bd); d.lineWidth = Math.max(1, 2 * R);
      d.beginPath(); d.roundRect(x * R, y * R, w * R, h * R, Math.min(r, w / 2, h / 2) * R); d.stroke();
    }
    buildCard(s, number, scale) {
      const P = this.P, R = this.R, fl = this.mainFontLang();
      const main = this.nameMain(s), sub = this.nameSub(s);
      const fMain = sz => this.font(sz, fl, "Bold"), fSub = sz => this.font(sz, "jp", "Medium");
      const tw = Math.max(this.measure(main, fMain(44 * scale)), sub ? this.measure(sub, fSub(25 * scale)) : 0);
      const pad = 26 * scale, badge = 56 * scale, gap = 18 * scale;
      const cw = pad + badge + gap + tw + pad, ch = (sub ? 104 : 84) * scale, m = 36;
      const cv = newCanvas((cw + 2 * m) * R, (ch + 2 * m) * R), d = cv.getContext("2d");
      this.box(d, m, m, cw, ch, 26 * scale, 0.965, [0.27, 24, 7]);
      const bx = m + pad, by = m + (ch - badge) / 2;
      d.fillStyle = rgb(P.marker); d.beginPath(); d.arc((bx + badge / 2) * R, (by + badge / 2) * R, badge / 2 * R, 0, Math.PI * 2); d.fill();
      d.font = this.font(30 * scale * R, "kr", "Bold"); d.fillStyle = "#fff"; d.textAlign = "center"; d.textBaseline = "alphabetic";
      const n = String(number), mt = d.measureText(n);   // centre the digit's own ink box in the circle
      d.fillText(n, (bx + badge / 2) * R, (by + badge / 2) * R + (mt.actualBoundingBoxAscent - mt.actualBoundingBoxDescent) / 2);
      d.textAlign = "left"; d.textBaseline = "middle";
      const tx = bx + badge + gap;
      d.fillStyle = rgb(P.ink); d.font = fMain(44 * scale * R);
      d.fillText(main, tx * R, (sub ? m + 38 * scale : m + ch / 2) * R);
      if (sub) { d.fillStyle = rgb(P.muted); d.font = fSub(25 * scale * R); d.fillText(sub, tx * R, (m + 76 * scale) * R); }
      return {img: cv, m, cw, ch};
    }
    buildPanel(lines, bar) {              // lines: [text, size, weight, color, fontlang]
      const R = this.R, pad = 26;
      const tw = Math.max(1, ...lines.map(([t, sz, wt, , fl]) => this.measure(t, this.font(sz, fl, wt))));
      const barW = bar ? 14 : 0;
      const cw = barW + pad * (bar ? 1.6 : 2) + tw, ch = 20 + lines.reduce((a, l) => a + l[1] * 1.45, 0), m = 30;
      const cv = newCanvas((cw + 2 * m) * R, (ch + 2 * m) * R), d = cv.getContext("2d");
      this.box(d, m, m, cw, ch, 22, 0.957, [0.25, 20, 6]);
      if (bar) {
        d.save(); d.beginPath(); d.roundRect(m * R, m * R, cw * R, ch * R, 22 * R); d.clip();
        d.fillStyle = rgb(bar); d.fillRect(m * R, m * R, barW * R, ch * R); d.restore();
      }
      let ty = m + 10;
      d.textBaseline = "middle";
      for (const [t, sz, wt, col, fl] of lines) {
        d.fillStyle = rgb(col); d.font = this.font(sz * R, fl, wt);
        d.fillText(t, (m + barW + pad * (bar ? 0.8 : 1)) * R, (ty + sz * 1.45 / 2) * R);
        ty += sz * 1.45;
      }
      return {img: cv, m, cw, ch};
    }
    buildPill(mins, kind, col) {
      const R = this.R, txt = fmtMinutes(mins, this.lang), f = sz => this.font(sz, this.mainFontLang(), "Bold");
      const tw = this.measure(txt, f(26)), gl = 26, pad = 16, gap = 9;
      const cw = pad + gl * 1.2 + gap + tw + pad, ch = 46, m = 22;
      const cv = newCanvas((cw + 2 * m) * R, (ch + 2 * m) * R), d = cv.getContext("2d");
      this.box(d, m, m, cw, ch, ch / 2, 0.965, [0.24, 14, 4]);
      modeGlyph(d, (m + pad + gl * 0.6) * R, (m + ch / 2) * R, gl * R, kind, col);
      d.fillStyle = rgb(this.P.ink); d.font = f(26 * R); d.textBaseline = "middle";
      d.fillText(txt, (m + pad + gl * 1.2 + gap) * R, (m + ch / 2) * R);
      return {img: cv, m, cw, ch};
    }
    setupSprites() {
      const P = this.P, lang = this.lang, fl = this.mainFontLang();
      const order = [];
      for (const leg of this.LEGS) { if (!order.length) order.push(leg.from); order.push(leg.to); }
      this.ORDER = order;
      this.CARDS = {}; const seen = {};
      order.forEach((sid, i) => {
        if (sid in seen) return;
        seen[sid] = i + 1;
        const s = this.ST[sid];
        this.CARDS[sid] = this.buildCard(s, i + 1, (s.big ? 1.0 : 0.74) * (this.H > this.W ? 0.7 : 1.0));
      });
      const cache = {};
      const get = (k, fn) => cache[k] || (cache[k] = fn());
      for (const leg of this.LEGS) for (const ph of leg.phases) {
        const title = tr(ph.title, lang), sub = tr(ph.sub, lang);
        ph.chip = get("chip|" + title + "|" + sub + "|" + ph.col, () => {
          const lines = [[title, 34, "Bold", P.ink, fl]];
          if (sub) lines.push([sub, 24, "Medium", P.muted, fl]);
          return this.buildPanel(lines, ph.col);
        });
        const mins = legMinutes(ph, lang);
        if (this.TIME_PILLS && mins > 0) ph.pill = get(["pill", Math.round(mins * 10), ph.veh, ph.col].join("|"), () => this.buildPill(mins, ph.veh, ph.col));
        if (this.LINE_TAGS && title) ph.tag = get("tag|" + title + "|" + ph.col, () => this.buildPanel([[title, 25, "Bold", P.ink, fl]], ph.col));
      }
      const hd = this.cfg.header || {};
      const title = tr(hd.title, lang);
      const big = [];
      for (const sid of order) if ((this.ST[sid].big || sid === order[0] || sid === order[order.length - 1]) && big[big.length - 1] !== sid) big.push(sid);
      const sub = tr(hd.subtitle, lang) || big.map(sid => this.nameMain(this.ST[sid])).join(" → ");
      const lines = title ? [[title, 44, "Bold", P.ink, fl]] : [];
      lines.push([sub, 25, "Medium", P.muted, fl]);
      this.HEADER = this.buildPanel(lines);
      let sl = this.cfg.summary;
      sl = (sl && !Array.isArray(sl) && typeof sl === "object") ? tr(sl, lang) : sl;
      if (typeof sl === "string") sl = sl.split("\n");
      sl = (sl || []).filter(x => x && String(x).trim());
      this.SUMMARY = sl.length ? this.buildPanel(sl.map(l => [l, 30, "Bold", P.ink, fl])) : null;
    }
    vehicle(kind, col, t) {
      const frame = (kind === "walk" || kind === "ferry") ? Math.floor(t * 8) % 8 : Math.floor(t * 18) % 6;
      if (!["walk", "car", "bus", "ferry", "shinkansen"].includes(kind)) kind = "train";
      const key = kind + col.join() + frame;
      let v = this.VEH.get(key);
      if (!v) { v = buildVehicle(kind, col, frame, 7 * this.R); this.VEH.set(key, v); }
      return v;
    }

    // ---- cameras
    cardExt(s) {
      const c = this.CARDS[s.id], off = 30, r = 22, side = s.side || "R";
      if (side === "L") return [off + c.cw, r, c.ch / 2, c.ch / 2];
      if (side === "T") return [c.cw / 2, c.cw / 2, off + c.ch, r];
      if (side === "B") return [c.cw / 2, c.cw / 2, r, off + c.ch];
      return [r, off + c.cw, c.ch / 2, c.ch / 2];
    }
    fit(xs, ys, sids, cap) {
      const DW = this.DW, DH = this.DH, mx = 44, mt = 120, mb = 150, aw = DW - 2 * mx, ah = DH - mt - mb;
      const exts = sids.filter(id => this.CARDS[id]).map(id => { const s = this.ST[id]; return [s.x, s.y, ...this.cardExt(s)]; });
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < xs.length; i++) { if (xs[i] < minX) minX = xs[i]; if (xs[i] > maxX) maxX = xs[i]; if (ys[i] < minY) minY = ys[i]; if (ys[i] > maxY) maxY = ys[i]; }
      let sc = cap, x0, x1, y0, y1;
      for (let k = 0; k < 900; k++) {
        x0 = minX - 12 / sc; x1 = maxX + 12 / sc; y0 = minY - 12 / sc; y1 = maxY + 12 / sc;
        for (const e of exts) { x0 = Math.min(x0, e[0] - e[2] / sc); x1 = Math.max(x1, e[0] + e[3] / sc); y0 = Math.min(y0, e[1] - e[4] / sc); y1 = Math.max(y1, e[1] + e[5] / sc); }
        if ((x1 - x0) * sc <= aw && (y1 - y0) * sc <= ah) break;
        sc *= 0.985;
      }
      const bandC = (mt + DH - mb) / 2;
      return [(x0 + x1) / 2, (y0 + y1) / 2 - (bandC - DH / 2) / sc, sc];
    }
    setupCameras() {
      this.CAM_OV = this.fit(this.ALLX, this.ALLY, this.STATIONS.map(s => s.id), 220);
      this.CAM_LEG = this.LEGS.map(l => this.fit(l.xs, l.ys, [l.from, l.to], 260));
    }
    setupTimeline() {
      const TL = this.TL; this.CAM_KEYS = []; this.REVEAL = {[this.STATIONS[0].id]: 0.6};
      const g = (k, d) => (TL[k] == null ? d : +TL[k]);
      let t = g("intro_s", 1.2);
      this.CAM_KEYS.push([t, t + g("zoom_in_s", 1.2), this.CAM_OV, this.CAM_LEG[0]]);
      t += g("zoom_in_s", 1.2);
      this.LEGS.forEach((leg, i) => {
        for (const ph of leg.phases) { ph.t0 = t; t += ph.travel_s; ph.t1 = t; }
        this.REVEAL[leg.to] = t;
        t += +((TL.pauses || {})[leg.to] || 0);
        if (i + 1 < this.LEGS.length) { this.CAM_KEYS.push([t, t + g("cam_move_s", 0.9), this.CAM_LEG[i], this.CAM_LEG[i + 1]]); t += g("cam_move_s", 0.9); }
      });
      t += 0.2;
      this.CAM_KEYS.push([t, t + g("zoom_out_s", 1.3), this.CAM_LEG[this.CAM_LEG.length - 1], this.CAM_OV]);
      t += g("zoom_out_s", 1.3);
      this.ROUTE_END = t; this.SUMMARY_T = t - 0.4; this.HOLD_S = g("outro_hold_s", 5);
      const zo = +((this.cfg.video || {}).outro_zoom || 1);
      if (zo > 1.01 && this.HOLD_S > 0.4) {
        const wide = [this.CAM_OV[0], this.CAM_OV[1], this.CAM_OV[2] / zo];
        this.CAM_KEYS.push([t + 0.2, t + 0.2 + Math.min(1.2, this.HOLD_S * 0.4), this.CAM_OV, wide]);
      }
      this.DUR = t + this.HOLD_S;
      this.NFRAMES = Math.round(this.DUR * this.FPS);
    }
    camera(t) {
      let cur = this.CAM_OV;
      for (const [a, b, c0, c1] of this.CAM_KEYS) {
        if (t < a) return cur;
        if (t < b) {
          const k = easeCub((t - a) / (b - a));
          const sc = Math.exp(Math.log(c0[2]) + (Math.log(c1[2]) - Math.log(c0[2])) * k);
          return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, sc];
        }
        cur = c1;
      }
      return cur;
    }
    scr(x, y, cam) { return [this.DW / 2 + (x - cam[0]) * cam[2], this.DH / 2 + (y - cam[1]) * cam[2]]; }

    // ---- background data (engine._setup_background)
    setupBackground() {
      const BG = this.BG, km = (a, b) => this.km(a, b), kp = lst => (lst || []).map(p => km(p[0], p[1]));
      const toPath = (polys, close) => {
        if (!polys.length) return null;
        const p = new Path2D();
        for (const poly of polys) {
          if (poly.length < 2) continue;
          p.moveTo(poly[0][0], poly[0][1]);
          for (let i = 1; i < poly.length; i++) p.lineTo(poly[i][0], poly[i][1]);
          if (close) p.closePath();
        }
        return p;
      };
      const water = (BG.water || []).map(w => kp(w.points));
      this.RIVERS = (BG.rivers || []).map(r => [kp(r.points), r.width_km || 0.7]);
      this.FIELDS = (BG.fields || []).map(f => [km(...f.at), f.rx, f.ry, f.seed]);
      this.CITIES = (BG.cities || []).map(c => [km(...c.at), c.rx, c.ry, c.seed]);
      this.CLOUDS = (BG.clouds || []).map(c => [km(...c.at), c.size]);
      this.LANDMARKS = (BG.landmarks || []).map(l => [l.type, km(...l.at), l.size || 1]);
      this.HILLS = [];
      for (const reg of BG.hill_regions || []) {
        const [x0, y1] = km(...reg.sw), [x1, y0] = km(...reg.ne), r = seeded(reg.seed || 1);
        for (let i = 0; i < reg.count; i++) this.HILLS.push([x0 + r() * (x1 - x0), y0 + r() * (y1 - y0), reg.rmin + r() * (reg.rmax - reg.rmin), Math.floor(r() * 2)]);
      }
      this.TREES = [];
      const dens = Math.max(0, Math.min(5, +(BG.asset_density ?? 1)));
      if (BG.trees_on_hills !== false) {
        const r = seeded(42), hills = [...this.HILLS].sort((a, b) => a[1] - b[1]).filter((_, i) => i % 2 === 0);
        for (let j = 0, n = Math.round(hills.length * dens); j < n && hills.length; j++) {
          const [hx, hy, hr] = hills[j % hills.length], spread = j < hills.length ? 1 : 2.2;
          this.TREES.push([hx + (r() - 0.5) * hr * spread, hy - hr * 0.25 + (r() - 0.5) * 0.5 * spread]);
        }
      }
      const xs = this.ALLX.concat(this.STATIONS.map(s => s.x)), ys = this.ALLY.concat(this.STATIONS.map(s => s.y));
      const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);
      const m = Math.max(5, 0.35 * Math.max(bx1 - bx0, by1 - by0));
      this.BBOX = [bx0 - m, bx1 + m, by0 - m, by1 + m];
      this.ROUTE_BBOX = [bx0, bx1, by0, by1];
      const osm = BG.osm || {};
      this.SEA_FILL = !!osm.sea_fill;
      const land = (osm.land || []).map(kp), coast = (osm.coast || []).map(kp);
      water.push(...(osm.water || []).map(kp));
      this.RIVERS.push(...(osm.rivers || []).map(r => [kp(r), 0.22]));
      this.ATTR = osm.attribution || "";
      this.LAND_P = this.SEA_FILL ? toPath(land, true) : null;
      this.COAST_P = toPath(coast, false);
      this.WATER_P = toPath(water, true);
      this.RIVER_P = this.RIVERS.map(([pts, w]) => [toPath([pts], false), w]);
      this._hit = newCanvas(2, 2).getContext("2d");
      this._wet = osm && Object.keys(osm).length ? toPath((osm.water || []).map(kp).concat(water), true) : null;
      const auto = BG.auto || {};
      this.DECOR = BG.decor !== false;
      this.ASSET_K = Math.max(1, Math.min(10, +(BG.asset_scale || 1)));   // size of trees, towns, mountains, landmarks, added assets
      this.ASSET_D = Math.max(0, Math.min(5, +(BG.asset_density ?? 1)));  // how many trees and added assets
      if (!this.DECOR) { this.FIELDS = []; this.CITIES = []; this.CLOUDS = []; this.LANDMARKS = []; this.HILLS = []; this.TREES = []; }
      if (auto.enabled && this.DECOR) this.autoTerrain(auto);
      this.SPRITES = this.DECOR ? this.placeAssets(BG.assets || []) : [];
      if (this.DECOR) for (const pk of osm.peaks || []) {
        const [x, y] = km(...pk.at);
        this.SPRITES.push([x, y, {builtin: "mountain"}, 4 + Math.min(6, (+pk.ele || 0) / 500)]);
      }
      this.SPRITES.sort((a, b) => a[1] - b[1]);
      this.HILLS.sort((a, b) => a[1] - b[1]);
      this.BLOBS = {};
    }
    onWater(x, y) {
      const h = this._hit;
      if (this.LAND_P && !h.isPointInPath(this.LAND_P, x, y, "evenodd")) return true;
      return !!(this._wet && h.isPointInPath(this._wet, x, y, "evenodd"));
    }
    autoTerrain(auto) {
      const dens = auto.density || {}, d = k => (dens[k] == null ? 1 : +dens[k]);
      const gh = d("hills"), gt = d("trees"), gf = d("fields"), gc = d("clouds"), gv = d("towns");
      const rng = seeded(+(auto.seed ?? 7) * 7919 + 13);
      const [x0, x1, y0, y1] = this.BBOX, w = x1 - x0, h = y1 - y0, A = w * h;
      const base = Math.max(0.45, Math.min(2.4, Math.sqrt(A) / 20));
      const free = (x, y, rad) => !this.onWater(x, y) && this.STATIONS.every(s => Math.hypot(s.x - x, s.y - y) > rad);
      for (let i = 0, n = Math.floor(Math.min(260, A / 45 * gh)); i < n; i++) {
        const x = x0 + rng() * w, y = y0 + rng() * h, r = base * (0.55 + 0.7 * rng()), k = Math.floor(rng() * 2);
        if (free(x, y, r * 0.9 + 0.5)) this.HILLS.push([x, y, r, k]);
      }
      for (let i = 0, n = Math.floor(Math.min(60, A / 200 * gf)); i < n; i++) {
        const rx = base * (1.2 + 1.6 * rng()), fx = x0 + rng() * w, fy = y0 + rng() * h;
        if (!this.onWater(fx, fy)) this.FIELDS.push([[fx, fy], rx, rx * 0.65, 500 + i]);
      }
      for (let i = 0, n = Math.floor(Math.min(10, Math.max(3, A / 500)) * gc); i < n; i++)
        this.CLOUDS.push([[x0 + rng() * w, y0 + rng() * h], base * (1.2 + 1.0 * rng())]);
      const hubs = new Set([this.LEGS[0].from, this.LEGS[this.LEGS.length - 1].to]);
      for (let i = 0; i + 1 < this.LEGS.length; i++) {
        const a = this.LEGS[i], b = this.LEGS[i + 1];
        if (a.phases[a.phases.length - 1].veh !== b.phases[0].veh) hubs.add(a.to);
      }
      [...hubs].sort().forEach((sid, k) => { const s = this.ST[sid]; this.CITIES.push([[s.x, s.y + 0.15 * base], base * 1.15, base * 0.85, 700 + k]); });
      for (let i = 0, n = Math.floor(A / 300 * gv); i < n; i++) {
        const x = x0 + rng() * w, y = y0 + rng() * h;
        if (free(x, y, base * 1.2)) this.CITIES.push([[x, y], base * 0.5, base * 0.4, 800 + i, "village"]);
      }
      for (let i = 0, n = Math.floor(Math.min(500, A / 30 * gt) * this.ASSET_D); i < n; i++) {
        const x = x0 + rng() * w, y = y0 + rng() * h;
        if (free(x, y, 0.5)) this.TREES.push([x, y]);
      }
    }
    placeAssets(assets) {
      const out = [], [x0, x1, y0, y1] = this.BBOX;
      const base = Math.max(0.45, Math.min(2.4, Math.sqrt((x1 - x0) * (y1 - y0)) / 20));
      const gauss = r => { let u = 0, v = 0; while (!u) u = r(); v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
      assets.forEach((a, ai) => {
        if (a.enabled === false) return;
        const rng = seeded((+a.seed || 1) + ai * 101), n = Math.round(+(a.count || 10) * this.ASSET_D), region = a.region || "map", size = +(a.size_km || 0.5);
        const pts = [];
        if (region === "route") {
          for (let i = 0; i < n; i++) {
            const k = Math.floor(rng() * this.ALLX.length), ang = rng() * 2 * Math.PI, dist = (0.25 + Math.abs(gauss(rng)) * 0.6) * base;
            pts.push([this.ALLX[k] + Math.cos(ang) * dist, this.ALLY[k] + Math.sin(ang) * dist]);
          }
        } else if (region === "stations") {
          for (const s of this.STATIONS) for (let i = 0; i < n; i++) {
            const ang = rng() * 2 * Math.PI, dist = (0.25 + rng() * 1.2) * base + 0.15;
            pts.push([s.x + Math.cos(ang) * dist, s.y + Math.sin(ang) * dist * 0.8]);
          }
        } else for (let i = 0; i < n; i++) pts.push([x0 + rng() * (x1 - x0), y0 + rng() * (y1 - y0)]);
        for (const [px, py] of pts) out.push([px, py, a, size * (0.8 + 0.4 * rng())]);
      });
      return out;
    }

    // ---- background drawing (engine._terrain)
    blob(d, cx, cy, rx, ry, color, seed, n = 14, wob = 0.16) {
      const key = seed + "|" + n + "|" + wob;
      let rr = this.BLOBS[key];
      if (!rr) { const r = seeded(seed + 1); rr = this.BLOBS[key] = Array.from({length: n}, () => 1 + wob * (r() - 0.5) * 2); }
      d.fillStyle = rgb(color); d.beginPath();
      for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; (i ? d.lineTo : d.moveTo).call(d, cx + Math.cos(a) * rx * rr[i], cy + Math.sin(a) * ry * rr[i]); }
      d.closePath(); d.fill();
    }
    buildings(d, x, y, s, seed) {
      const r = seeded(seed);
      for (let i = 0; i < 6; i++) {
        const bw = (0.28 + r() * 0.3) * s, bh = (0.5 + r() * 0.9) * s, bx = x + (i - 2.5) * 0.5 * s + (r() - 0.5) * 0.2 * s;
        d.fillStyle = rgb(i % 2 ? [234, 224, 206] : [225, 212, 190]); d.fillRect(bx - bw / 2, y - bh, bw, bh + 0.1 * s);
        d.strokeStyle = rgb(this.P.city_bd); d.lineWidth = 1; d.strokeRect(bx - bw / 2, y - bh, bw, bh + 0.1 * s);
        d.fillStyle = "rgb(176,196,206)";
        for (let wy = y - bh + 0.18 * s; wy < y - 0.1 * s; wy += 0.26 * s) { d.fillRect(bx - bw * 0.28, wy, bw * 0.22, 0.1 * s); d.fillRect(bx + bw * 0.06, wy, bw * 0.22, 0.1 * s); }
      }
    }
    bgImage(d, cam) {                // the user's picture: replaces or overlays the terrain
      const bi = this.cfg.background_image || {};
      const im = bi.file && this.images[bi.file];
      if (!im || !im.width) return false;
      const replace = bi.replace_terrain !== false;
      d.save();
      d.setTransform(1, 0, 0, 1, 0, 0);
      d.globalAlpha = replace ? 1 : +(bi.opacity ?? 0.6);
      if (bi.mode === "screen") {
        const sc = Math.max(this.W / im.width, this.H / im.height);
        d.drawImage(im, (this.W - im.width * sc) / 2, (this.H - im.height * sc) / 2, im.width * sc, im.height * sc);
      } else {
        const [bx0, bx1, by0, by1] = this.ROUTE_BBOX, mg = +(bi.margin_pct ?? 25) / 100;
        let w = Math.max(bx1 - bx0, 1) * (1 + 2 * mg), h = Math.max(by1 - by0, 1) * (1 + 2 * mg);
        const asp = im.width / im.height;
        if (w / h < asp) w = h * asp; else h = w / asp;
        const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2, u = this.u;
        if (replace) {
          if (!this._avg) { const c = newCanvas(1, 1).getContext("2d"); c.drawImage(im, 0, 0, 1, 1); this._avg = [...c.getImageData(0, 0, 1, 1).data].slice(0, 3); }
          d.fillStyle = rgb(this._avg); d.fillRect(0, 0, this.W, this.H);
        }
        const [sx0, sy0] = this.scr(cx - w / 2, cy - h / 2, cam), [sx1, sy1] = this.scr(cx + w / 2, cy + h / 2, cam);
        d.drawImage(im, sx0 * u, sy0 * u, (sx1 - sx0) * u, (sy1 - sy0) * u);
      }
      d.restore();
      return replace;
    }
    drawTerrain(d, cam) {
      const P = this.P, u = this.u, sc = cam[2], DW = this.DW, DH = this.DH;
      const bi = this.cfg.background_image || {};
      const hasImg = !!(bi.file && this.images[bi.file] && this.images[bi.file].width);
      const replace = hasImg && bi.replace_terrain !== false;
      d.setTransform(1, 0, 0, 1, 0, 0);
      d.fillStyle = rgb(this.SEA_FILL && !replace ? P.sea : P.plain);
      d.fillRect(0, 0, this.W, this.H);
      if (replace) this.bgImage(d, cam);
      const kmT = () => d.setTransform(u * sc, 0, 0, u * sc, u * (DW / 2 - cam[0] * sc), u * (DH / 2 - cam[1] * sc));
      const scrT = () => d.setTransform(u, 0, 0, u, 0, 0);
      d.lineJoin = "round"; d.lineCap = "round";
      if (!replace) {
        kmT();
        if (this.SEA_FILL && this.LAND_P) {
          if (this.COAST_P) { d.strokeStyle = rgb(P.sea.map(c => Math.round(c * 0.65 + 255 * 0.35))); d.lineWidth = 22 / sc; d.stroke(this.COAST_P); }
          d.fillStyle = rgb(P.plain); d.fill(this.LAND_P, "evenodd");
          if (this.COAST_P) { d.strokeStyle = rgb(P.sea_edge); d.lineWidth = 2.5 / sc; d.stroke(this.COAST_P); }
        }
        if (this.WATER_P) {
          d.fillStyle = rgb(P.sea); d.fill(this.WATER_P, "evenodd");
          d.strokeStyle = rgb(P.sea_edge); d.lineWidth = 3 / sc; d.stroke(this.WATER_P);
        }
        scrT();
        for (const [[fx, fy], rx, ry, sd] of this.FIELDS) {
          const [x, y] = this.scr(fx, fy, cam);
          if (x > -rx * sc * 1.3 && x < DW + rx * sc * 1.3 && y > -ry * sc * 1.3 && y < DH + ry * sc * 1.3) this.blob(d, x, y, rx * sc, ry * sc, P.field, sd);
        }
        kmT();
        for (const [path, wkm] of this.RIVER_P) {
          if (!path) continue;
          for (const [wm, col] of [[1, P.sea_edge], [0.73, P.river], [0.27, P.river_hi]]) {
            d.strokeStyle = rgb(col); d.lineWidth = Math.max(2 / sc, wkm * wm); d.stroke(path);
          }
        }
        scrT();
        for (const [[cx, cy], rx, ry, sd] of this.CITIES) {
          const [x, y] = this.scr(cx, cy, cam);
          if (x > -rx * sc * 1.3 && x < DW + rx * sc * 1.3 && y > -ry * sc * 1.3 && y < DH + ry * sc * 1.3) this.blob(d, x, y, rx * sc, ry * sc, P.city, sd, 14, 0.10);
        }
        for (const [hx, hy, hr, kind] of this.HILLS) {
          const [x, y] = this.scr(hx, hy, cam), r = hr * sc;
          if (x < -r || x > DW + r || y < -r || y > DH + r) continue;
          const col = kind === 0 ? P.hill_a : P.hill_b, sh = mix(col, P.hill_sh, 0.62);
          const E = (x0, y0, x1, y1, c) => { d.fillStyle = rgb(c); d.beginPath(); d.ellipse((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, 0, 0, Math.PI * 2); d.fill(); };
          E(x - r * 0.98, y - r * 0.70, x + r * 1.08, y + r * 0.70, shade(sh, 0.90));
          E(x - r, y - r * 0.86, x + r, y + r * 0.62, col);
          d.fillStyle = rgb(sh); d.beginPath(); d.ellipse(x, y + r * 0.11, r * 0.96, r * 0.51, 0, 0, Math.PI); d.closePath(); d.fill();
          E(x - r * 0.62, y - r * 0.78, x + r * 0.16, y - r * 0.06, shade(col, 1.14));
          E(x - r * 0.44, y - r * 0.72, x - r * 0.06, y - r * 0.34, shade(col, 1.26));
        }
      }
      if (hasImg && !replace) this.bgImage(d, cam);
      scrT();
      if (this.TREES.length && !replace) {
        const tsz = Math.max(sc * 0.42, 5) * this.ASSET_K, mg = 80 * this.ASSET_K, pts = [];
        for (const [tx, ty] of this.TREES) { const [x, y] = this.scr(tx, ty, cam); if (x > -mg && x < DW + mg && y > -mg && y < DH + mg) pts.push([x, y]); }
        forest(d, pts, tsz);
      }
      // towns and landmarks: always drawn (they used to appear only when zoomed in close), with a
      // minimum size so a wide map still shows them; bigger with the asset size setting
      if (this.DECOR && !replace) {
        const K = this.ASSET_K;
        this.CITIES.forEach(([[cx, cy], , ry, sd, kind], i) => {
          const [x, y] = this.scr(cx, cy, cam), m = 120 * K;
          if (x < -m || x > DW + m || y < -m || y > DH + m) return;
          if (kind === "village") {
            const s = Math.max(sc * 0.55, 9) * K, r = seeded(sd);
            for (let k = 0; k < 3; k++) BUILTIN.house[0](d, x + (k - 1) * s * 0.95 + (r() - 0.5) * s * 0.3, y + (r() - 0.5) * s * 0.4, s);
          } else this.buildings(d, x, y + ry * sc * 0.1, Math.max(sc * 0.8, 9) * K, 60 + i);
        });
        for (const [kind, [lx, ly], lsz] of this.LANDMARKS) {
          const [x, y] = this.scr(lx, ly, cam);
          (BUILTIN[kind] || BUILTIN.torii)[0](d, x, y, Math.max(sc * 0.75, 14) * lsz * K);
        }
      }
      for (const [ax, ay, a, size] of this.SPRITES) {
        const [x, y] = this.scr(ax, ay, cam), wpx = Math.max(size * sc, 13) * this.ASSET_K;
        if (x < -wpx || x > DW + wpx || y < -wpx * 2 || y > DH + wpx * 2) continue;
        if (a.builtin) { const [fn, nom] = BUILTIN[a.builtin] || BUILTIN.tree; fn(d, x, y, wpx / nom); }
        else if (a.file && this.images[a.file] && this.images[a.file].width) {
          const im = this.images[a.file], w = wpx, h = w * im.height / im.width;
          d.drawImage(im, x - w / 2, y - h, w, h);
        }
      }
    }

    progress(t) {
      let head = null;
      for (const leg of this.LEGS) {
        leg._f = 0;
        for (const ph of leg.phases) {
          if (t >= ph.t1) leg._f = Math.max(leg._f, ph.f1);
          else if (t > ph.t0) {
            const f = ph.f0 + (ph.f1 - ph.f0) * easeIO((t - ph.t0) / (ph.t1 - ph.t0));
            leg._f = Math.max(leg._f, f); head = [leg, ph, f];
          }
        }
      }
      return head;
    }
    sprite(ctx, pc, x, y, scale = 1, alpha = 1) {
      if (alpha <= 0) return;
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.drawImage(pc.img, x, y, pc.img.width / this.R * scale, pc.img.height / this.R * scale);
      ctx.globalAlpha = 1;
    }
    pasteCard(ctx, s, mx, my, prog) {
      const c = this.CARDS[s.id], scl = 0.6 + 0.4 * easeBack(prog), a = clamp01(prog * 1.8), off = 30, side = s.side || "R";
      let px, py;
      if (side === "L") { px = mx - off - (c.m + c.cw) * scl; py = my - (c.m + c.ch / 2) * scl; }
      else if (side === "R") { px = mx + off - c.m * scl; py = my - (c.m + c.ch / 2) * scl; }
      else if (side === "B") { px = mx - (c.m + c.cw / 2) * scl; py = my + off - c.m * scl; }
      else { px = mx - (c.m + c.cw / 2) * scl; py = my - off - (c.m + c.ch) * scl; }
      this.sprite(ctx, c, px, py, scl, a);
      return [px + c.m * scl, py + c.m * scl, px + (c.m + c.cw) * scl, py + (c.m + c.ch) * scl];
    }
    labelSpot(leg, ph, cam, pc, taken, upto) {
      const b = upto == null ? ph.f1 : upto, mid = (ph.f0 + b) / 2 * leg.len;
      const p0 = this.scr(...this.at(leg, mid - 0.6), cam), p1 = this.scr(...this.at(leg, mid + 0.6), cam);
      const cx0 = (p0[0] + p1[0]) / 2, cy0 = (p0[1] + p1[1]) / 2, dx = p1[0] - p0[0], dy = p1[1] - p0[1];
      const n = Math.hypot(dx, dy) || 1;
      for (const off of [34, -34, 72, -72]) {
        const cx = cx0 - dy / n * off, cy = cy0 + dx / n * off;
        const box = [cx - pc.cw / 2, cy - pc.ch / 2, cx + pc.cw / 2, cy + pc.ch / 2];
        if (box[0] < 6 || box[2] > this.DW - 6 || box[1] < 6 || box[3] > this.DH - 6) continue;
        if (!taken.some(r => box[0] < r[2] && r[0] < box[2] && box[1] < r[3] && r[1] < box[3])) return box;
      }
      return null;
    }
    moving(t) { return this.CAM_KEYS.some(([a, b]) => a <= t && t < b); }

    background(ctx, cam) {
      // the terrain only changes when the camera does: keep the last one (pauses, final hold)
      const key = cam.map(v => v.toFixed(4)).join();
      if (this._bgKey !== key || !this._bgCanvas) {
        if (!this._bgCanvas) this._bgCanvas = newCanvas(this.W, this.H);
        const d = this._bgCanvas.getContext("2d");
        this.drawTerrain(d, cam);
        this.drawMapText(d, cam);
        this._bgKey = key;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this._bgCanvas, 0, 0);
    }
    drawMapText(d, cam) {
      const P = this.P, sc = cam[2];
      d.setTransform(this.u, 0, 0, this.u, 0, 0);
      let kmv = 500;
      for (const v of [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500]) if (v * sc >= 110 && v * sc <= 320) { kmv = v; break; }
      const length = kmv * sc, bx0 = this.DW - 90 - length, by0 = this.DH - 64;
      d.strokeStyle = rgb(P.map_text); d.lineWidth = 3; d.lineCap = "butt";
      d.beginPath(); d.moveTo(bx0, by0); d.lineTo(bx0 + length, by0);
      for (const x of [bx0, bx0 + length]) { d.moveTo(x, by0 - 10); d.lineTo(x, by0 + 10); }
      d.stroke();
      d.fillStyle = rgb(P.map_text); d.font = this.font(23, "kr", "Medium"); d.textAlign = "right"; d.textBaseline = "alphabetic";
      d.fillText(kmv >= 1 ? `${kmv} km` : `${Math.round(kmv * 1000)} m`, bx0 + length, by0 - 20);
      if (this.ATTR) { d.font = this.font(16, "kr", "Medium"); d.fillText(this.ATTR, this.DW - 90, this.DH - 26); }
      const note = tr(this.cfg.disclaimer, this.lang);
      if (note) {
        const fs = 21; d.font = this.font(fs, this.lang === "ja" ? "jp" : "kr", "Medium"); d.textBaseline = "top";
        const hw = this.HEADER ? this.HEADER.cw + 2 * this.HEADER.m : 0, maxw = Math.max(this.DW * 0.2, this.DW - hw - 150);
        const lines = []; let cur = "";
        for (const w of note.split(" ")) { const t = (cur + " " + w).trim(); if (d.measureText(t).width > maxw && cur) { lines.push(cur); cur = w; } else cur = t; }
        lines.push(cur);
        let y = 60;
        for (const ln of lines) { d.fillText(ln, this.DW - 60, y); y += fs * 1.35; }
      }
      d.textAlign = "left";
    }

    render(ctx, t) {
      const P = this.P, u = this.u, cam = this.camera(t), sc = cam[2], DW = this.DW, DH = this.DH;
      this.background(ctx, cam);
      ctx.setTransform(u, 0, 0, u, 0, 0);
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      const head = this.progress(t);

      // drifting clouds
      ctx.fillStyle = rgb(P.cloud, 0.9);
      for (const [[cx, cy], cr] of this.CLOUDS) {
        const [x, y] = this.scr(cx + t * 0.10 * Math.max(cr, 0.5), cy, cam), r = cr * sc * 0.5;
        if (x < -3 * r || x > DW + 3 * r || y < -3 * r || y > DH + 3 * r) continue;
        ctx.beginPath();
        for (const [ox, oy, k] of [[-0.8, 0.1, 0.62], [0, -0.22, 0.8], [0.85, 0.12, 0.58], [0.1, 0.18, 0.7]]) {
          ctx.moveTo(x + ox * r + k * r, y + oy * r); ctx.ellipse(x + ox * r, y + oy * r, k * r, k * r * 0.72, 0, 0, Math.PI * 2);
        }
        ctx.fill();
      }

      // not-yet-travelled path
      const dstep = 26 / sc;
      ctx.fillStyle = rgb(P.ghost, 0.59);
      ctx.beginPath();
      for (const leg of this.LEGS) {
        const start = leg._f * leg.len + 0.2 * dstep;
        for (let s = Math.ceil(start / dstep) * dstep; s < leg.len; s += dstep) {
          const [x, y] = this.scr(...this.at(leg, s), cam);
          if (x > -20 && x < DW + 20 && y > -20 && y < DH + 20) { ctx.moveTo(x + 4.2, y); ctx.arc(x, y, 4.2, 0, Math.PI * 2); }
        }
      }
      ctx.fill();

      // travelled path
      for (const leg of this.LEGS) {
        if (leg._f <= 0) continue;
        for (const ph of leg.phases) {
          const a = ph.f0, b = Math.min(ph.f1, leg._f);
          if (b <= a) continue;
          const s0 = a * leg.len, s1 = b * leg.len;
          if (ph.veh === "walk") {
            const dots = new Path2D(), edge = new Path2D();
            for (let s = s0; s < s1; s += 10 / sc) {
              const [x, y] = this.scr(...this.at(leg, s), cam);
              if (this.OUTLINE) { edge.moveTo(x + 6.5, y); edge.arc(x, y, 6.5, 0, Math.PI * 2); dots.moveTo(x + 4.5, y); dots.arc(x, y, 4.5, 0, Math.PI * 2); }
              else { dots.moveTo(x + 5.5, y); dots.arc(x, y, 5.5, 0, Math.PI * 2); }
            }
            if (this.OUTLINE) { ctx.fillStyle = rgb(P.route_edge); ctx.fill(edge); }
            ctx.fillStyle = rgb(ph.col); ctx.fill(dots);
            continue;
          }
          const path = new Path2D();
          path.moveTo(...this.scr(...this.at(leg, s0), cam));
          for (let k = 0; k < leg.cum.length; k++) if (leg.cum[k] > s0 && leg.cum[k] < s1) path.lineTo(...this.scr(leg.xs[k], leg.ys[k], cam));
          path.lineTo(...this.scr(...this.at(leg, s1), cam));
          if (this.ROUTE_HALO) { ctx.strokeStyle = rgb(this.ROUTE_HALO); ctx.lineWidth = 27; ctx.stroke(path); }
          if (this.OUTLINE) { ctx.strokeStyle = rgb(P.route_edge); ctx.lineWidth = 20; ctx.stroke(path); }
          ctx.strokeStyle = rgb(ph.col); ctx.lineWidth = 13.5; ctx.stroke(path);
        }
      }

      // station markers
      for (const s of this.STATIONS) {
        if (!this.CARDS[s.id]) continue;
        const [mx, my] = this.scr(s.x, s.y, cam), rv = this.REVEAL[s.id];
        if (t < rv) {
          ctx.fillStyle = "rgb(246,243,234)"; ctx.strokeStyle = rgb(P.ghost); ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(mx, my, 6.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          continue;
        }
        const k = easeBack((t - rv) / 0.45), r = (s.big ? 16 : 13) * Math.max(k, 0.01);
        ctx.fillStyle = rgb(P.route_edge); ctx.beginPath(); ctx.arc(mx, my, r + 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = rgb(P.marker); ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = rgb(P.route_edge); ctx.beginPath(); ctx.arc(mx, my, r * 0.4, 0, Math.PI * 2); ctx.fill();
        const pt = t - rv;
        if (pt >= 0 && pt <= 1) {
          ctx.strokeStyle = rgb(P.marker, 0.7 * (1 - pt)); ctx.lineWidth = 4;
          ctx.beginPath(); ctx.arc(mx, my, r + 64 * pt, 0, Math.PI * 2); ctx.stroke();
        } else if (t > this.ROUTE_END && s.big) {
          const q = ((t - this.ROUTE_END) % 2) / 2;
          ctx.strokeStyle = rgb(P.marker, 0.59 * (1 - q)); ctx.lineWidth = 3.5;
          ctx.beginPath(); ctx.arc(mx, my, r + 54 * q, 0, Math.PI * 2); ctx.stroke();
        }
      }

      // vehicle
      if (head) {
        const [leg, ph, f] = head;
        const [x, y] = this.scr(...this.at(leg, f * leg.len), cam);
        const sp = this.vehicle(ph.veh, ph.col, t), w = sp.width / this.R, h = sp.height / this.R;
        ctx.drawImage(sp, x - w / 2, y - h * 0.78 + Math.sin(t * 9) * 3, w, h);
      }

      // name cards
      const taken = [];
      for (const s of this.STATIONS) {
        if (this.CARDS[s.id] && t >= this.REVEAL[s.id] + 0.1) {
          const [mx, my] = this.scr(s.x, s.y, cam);
          taken.push(this.pasteCard(ctx, s, mx, my, (t - this.REVEAL[s.id] - 0.1) / 0.5));
        }
      }
      // travel time per leg once the route is drawn
      if (this.TIME_PILLS && t > this.ROUTE_END - 0.5) {
        const fadeIn = clamp01((t - (this.ROUTE_END - 0.5)) / 0.6);
        for (const leg of this.LEGS) for (const ph of leg.phases) {
          if (!ph.pill) continue;
          const spot = this.labelSpot(leg, ph, cam, ph.pill, taken);
          if (!spot) continue;
          taken.push(spot);
          this.sprite(ctx, ph.pill, spot[0] - ph.pill.m, spot[1] - ph.pill.m, 1, fadeIn);
        }
      }
      // line name kept on each travelled leg
      if (this.LINE_TAGS) for (const leg of this.LEGS) {
        if (leg._f <= 0) continue;
        for (const ph of leg.phases) {
          if (!ph.tag) continue;
          const b = Math.min(ph.f1, leg._f);
          if (b <= ph.f0) continue;
          const spot = this.labelSpot(leg, ph, cam, ph.tag, taken, b);
          if (!spot) continue;
          taken.push(spot);
          this.sprite(ctx, ph.tag, spot[0] - ph.tag.m, spot[1] - ph.tag.m, 1, clamp01((b - ph.f0) / 0.25));
        }
      }
      // line being travelled (bottom-left)
      if (head && this.LEG_CHIP) {
        const ph = head[1], pc = ph.chip;
        this.sprite(ctx, pc, 50, DH - (pc.ch + 2 * pc.m) - 26, 1, clamp01((t - ph.t0) / 0.3) * clamp01((ph.t1 - t) / 0.3));
      }
      if (this.SUMMARY && t > this.SUMMARY_T) {
        const pc = this.SUMMARY;
        this.sprite(ctx, pc, DW - (pc.cw + 2 * pc.m) - 44, DH - (pc.ch + 2 * pc.m) - 96, 1, clamp01((t - this.SUMMARY_T) / 0.5));
      }
      this.sprite(ctx, this.HEADER, 56 - this.HEADER.m, 50 - this.HEADER.m, 1, clamp01(t / 0.6));
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
  }

  Object.assign(RS, {Renderer, tr, legMinutes});
})(RS);
