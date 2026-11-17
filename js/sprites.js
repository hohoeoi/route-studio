// ---------------------------------------------------------------- drawing helpers, vehicle sprites, built-in cartoon assets
(function (RS) {
  const FONT_KR = '"NanumSquare", "나눔스퀘어", "NanumSquareOTF", "NanumSquare_ac", "Nanum Gothic", "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans CJK KR", sans-serif';
  const FONT_JP = '"Noto Sans JP", "Yu Gothic UI", "Yu Gothic", "Meiryo", "Hiragino Sans", "Noto Sans CJK JP", ' + FONT_KR;
  const WEIGHT = {Bold: 700, Medium: 400};

  const rgb = (c, a = 1) => a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const easeIO = t => -(Math.cos(Math.PI * clamp01(t)) - 1) / 2;
  const easeCub = t => { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  const easeBack = (t, c = 1.70158) => { t = clamp01(t); const c3 = c + 1; return 1 + c3 * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  function shade(c, k) {
    return c.map(v => Math.round(Math.max(0, Math.min(255, k < 1 ? v * k : v + (255 - v) * (k - 1)))));
  }
  function fmtMinutes(mins, lang) {
    const m = Math.round(mins), h = Math.floor(m / 60), r = m % 60;
    if (!h) return lang === "ko" ? `${r}분` : lang === "ja" ? `${r}分` : `${r} min`;
    if (!r) return lang === "ko" ? `${h}시간` : lang === "ja" ? `${h}時間` : `${h} h`;
    return lang === "ko" ? `${h}시간 ${r}분` : lang === "ja" ? `${h}時間${r}分` : `${h} h ${r} min`;
  }
  function newCanvas(w, h) {
    const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)))
      : Object.assign(document.createElement("canvas"), {width: Math.max(1, Math.ceil(w)), height: Math.max(1, Math.ceil(h))});
    return c;
  }
  function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

  // is a locally installed font actually there? (compares glyph widths against a fallback)
  function fontAvailable(name) {
    const c = newCanvas(10, 10).getContext("2d");
    const probe = "가나다라마바사 ABCabc 123";
    c.font = "40px monospace"; const a = c.measureText(probe).width;
    c.font = `40px "${name}", monospace`; const b = c.measureText(probe).width;
    return Math.abs(a - b) > 0.5;
  }
  function fontInUse() {
    for (const [n, label] of [["NanumSquare", "나눔스퀘어"], ["나눔스퀘어", "나눔스퀘어"], ["NanumSquareOTF", "나눔스퀘어"],
                              ["NanumSquare_ac", "나눔스퀘어_ac"], ["Nanum Gothic", "나눔고딕"], ["Malgun Gothic", "맑은 고딕"],
                              ["Apple SD Gothic Neo", "Apple SD Gothic Neo"], ["Noto Sans KR", "Noto Sans KR"], ["Noto Sans CJK KR", "Noto Sans CJK KR"]])
      if (fontAvailable(n)) return label;
    return "기본 글꼴";
  }

  // ---------------------------------------------------------------- vehicle sprites
  function drawVehicleParts(d, kind, col, frame, s) {
    const P = v => v * s;
    const rr = (x0, y0, x1, y1, r, fill) => { d.fillStyle = rgb(fill); d.beginPath(); d.roundRect(P(x0), P(y0), P(x1 - x0), P(y1 - y0), P(Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2))); d.fill(); };
    const rect = (x0, y0, x1, y1, fill) => { d.fillStyle = rgb(fill); d.fillRect(P(x0), P(y0), P(x1 - x0), P(y1 - y0)); };
    const poly = (pts, fill) => { d.fillStyle = rgb(fill); d.beginPath(); for (let i = 0; i < pts.length; i += 2) (i ? d.lineTo : d.moveTo).call(d, P(pts[i]), P(pts[i + 1])); d.closePath(); d.fill(); };
    const ell = (x0, y0, x1, y1, fill) => { d.fillStyle = typeof fill === "string" ? fill : rgb(fill); d.beginPath(); d.ellipse(P((x0 + x1) / 2), P((y0 + y1) / 2), P(Math.abs(x1 - x0) / 2), P(Math.abs(y1 - y0) / 2), 0, 0, Math.PI * 2); d.fill(); };
    const line = (pts, color, w, cap = "butt") => { d.strokeStyle = typeof color === "string" ? color : rgb(color); d.lineWidth = w * s; d.lineCap = cap; d.lineJoin = "round"; d.beginPath(); for (let i = 0; i < pts.length; i += 2) (i ? d.lineTo : d.moveTo).call(d, P(pts[i]), P(pts[i + 1])); d.stroke(); };
    const wheel = (cx, cy, r, ang0, arch, spokes = 5) => {
      if (arch) ell(cx - arch, cy - arch, cx + arch, cy + arch, [40, 37, 35]);
      ell(cx - r, cy - r, cx + r, cy + r, [52, 48, 46]);
      const q = r * 0.6;
      ell(cx - q, cy - q, cx + q, cy + q, [205, 203, 196]);
      for (let k = 0; k < spokes; k++) {
        const a = (ang0 + 360 / spokes * k) * Math.PI / 180;
        line([cx, cy, cx + q * 0.95 * Math.cos(a), cy + q * 0.95 * Math.sin(a)], [120, 118, 112], 0.16);
      }
      const h = r * 0.17; ell(cx - h, cy - h, cx + h, cy + h, [90, 88, 84]);
    };
    const glass = [206, 232, 244], glint = "rgba(255,255,255,0.67)";
    if (kind === "car") {
      const body = col, dark = shade(col, 0.68), light = shade(col, 1.45);
      poly([3.5, 4.9, 4.55, 2.45, 8.45, 2.45, 10.0, 4.9], body);
      rr(4.1, 2.45, 8.9, 3.3, 0.45, body);
      rr(1.5, 4.3, 11.7, 7.9, 1.25, dark);
      rr(1.5, 4.3, 11.7, 7.0, 1.25, body);
      rect(2.4, 5.9, 10.8, 7.0, body);
      line([2.3, 4.85, 10.9, 4.85], light, 0.22);
      poly([4.15, 4.45, 5.0, 2.95, 6.35, 2.95, 6.35, 4.45], glass);
      poly([6.8, 4.45, 6.8, 2.95, 8.15, 2.95, 9.25, 4.45], glass);
      line([5.0, 3.1, 4.55, 4.0], glint, 0.16);
      line([6.55, 4.6, 6.55, 6.9], dark, 0.14);
      rr(7.0, 5.3, 7.9, 5.5, 0.1, light);
      ell(10.75, 4.95, 11.55, 5.75, [255, 228, 120]);
      ell(1.6, 4.95, 2.2, 5.6, [232, 70, 62]);
      rr(11.2, 6.5, 11.9, 7.3, 0.3, [190, 188, 182]);
      rr(1.3, 6.5, 2.0, 7.3, 0.3, [190, 188, 182]);
      for (const cx of [3.7, 9.5]) wheel(cx, 7.75, 1.2, frame * 12, 1.45);
      return [1.8, 8.35, 11.6, 9.2];
    }
    if (kind === "walk") {
      const shirt = col, pants = [70, 74, 96], skin = [246, 214, 182], shirtD = shade(col, 0.7), pack = [226, 150, 64];
      const ph = 2 * Math.PI * frame / 8, dy = -Math.abs(Math.sin(ph)) * 0.22;
      const hip = [6.4, 6.0 + dy], sh = [6.55, 3.75 + dy];
      const leg = (off, c) => {
        const a = 0.62 * Math.sin(ph + off), b = 0.9 * Math.max(0, Math.cos(ph + off)) + 0.1;
        const kx = hip[0] + 1.55 * Math.sin(a), ky = hip[1] + 1.55 * Math.cos(a);
        const fx = kx + 1.55 * Math.sin(a - b), fy = ky + 1.55 * Math.cos(a - b);
        line([hip[0], hip[1], kx, ky, fx, fy], c, 0.95, "round");
        ell(fx - 0.5, fy - 0.3, fx + 1.15, fy + 0.5, [236, 232, 224]);
        ell(fx - 0.5, fy + 0.15, fx + 1.15, fy + 0.5, [90, 84, 78]);
      };
      const arm = (off, c) => {
        const a = -0.7 * Math.sin(ph + off);
        const ex = sh[0] + 1.15 * Math.sin(a), ey = sh[1] + 1.15 * Math.cos(a);
        const hx = ex + 1.0 * Math.sin(a + 0.35), hy = ey + 1.0 * Math.cos(a + 0.35);
        line([sh[0], sh[1], ex, ey], c, 0.72, "round");
        line([ex, ey, hx, hy], skin, 0.6, "round");
        ell(hx - 0.33, hy - 0.33, hx + 0.33, hy + 0.33, skin);
      };
      leg(Math.PI, shade(pants, 0.78));
      arm(0, shade(shirt, 0.78));
      rr(4.55, 3.3 + dy, 5.95, 5.95 + dy, 0.55, pack);
      rr(4.55, 3.3 + dy, 5.95, 3.9 + dy, 0.4, shade(pack, 0.8));
      rr(5.55, 3.25 + dy, 7.55, 6.35 + dy, 0.85, shirt);
      line([5.9, 6.0 + dy, 7.2, 6.0 + dy], pants, 0.55);
      line([5.75, 3.7 + dy, 5.75, 5.5 + dy], shirtD, 0.14);
      leg(0, pants);
      arm(Math.PI, shirt);
      const hx = 6.8, hy = 2.05 + dy;
      ell(hx - 1.1, hy - 1.05, hx + 1.1, hy + 1.1, skin);
      d.fillStyle = rgb([66, 48, 40]); d.beginPath();
      d.moveTo(P(hx), P(hy - 0.05));
      d.ellipse(P(hx), P(hy - 0.05), P(1.2), P(1.15), 0, 170 * Math.PI / 180, 355 * Math.PI / 180); d.closePath(); d.fill();
      ell(hx - 1.25, hy - 0.5, hx - 0.2, hy + 0.7, [66, 48, 40]);
      ell(hx + 0.38, hy - 0.12, hx + 0.68, hy + 0.2, [50, 42, 40]);
      d.strokeStyle = rgb([190, 110, 100]); d.lineWidth = 0.1 * s; d.beginPath();
      d.ellipse(P(hx + 0.525), P(hy + 0.4), P(0.325), P(0.25), 0, 20 * Math.PI / 180, 150 * Math.PI / 180); d.stroke();
      return [3.6, 8.75, 9.6, 9.5];
    }
    if (kind === "shinkansen") {
      const body = [250, 250, 248], dark = shade(col, 0.68);
      poly([12.6, 5.6, 11.2, 4.15, 9.4, 3.35, 6.6, 3.05, 1.0, 3.05, 1.0, 6.9, 12.5, 6.9], body);
      poly([1.0, 6.25, 12.55, 6.25, 12.5, 6.9, 1.0, 6.9], col);
      line([1.0, 5.95, 12.1, 5.95], shade(col, 1.5), 0.18);
      poly([11.9, 5.1, 10.9, 4.35, 9.6, 3.95, 9.6, 5.1], glass);
      line([10.9, 4.45, 10.2, 4.9], "rgba(255,255,255,0.7)", 0.14);
      for (const x of [1.6, 3.2, 4.8, 6.4, 8.0]) rr(x, 4.05, x + 1.15, 5.15, 0.22, glass);
      rr(1.1, 6.95, 12.2, 7.5, 0.25, dark);
      ell(12.15, 5.25, 12.75, 5.85, [255, 236, 150]);
      for (const cx of [3.1, 9.3]) wheel(cx, 7.6, 0.55, frame * 15, 0, 4);
      return [1.2, 8.1, 12.4, 8.85];
    }
    if (kind === "bus") {
      const body = col, dark = shade(col, 0.68), light = shade(col, 1.55);
      rr(0.9, 2.5, 12.1, 7.9, 1.0, dark);
      rr(0.9, 2.5, 12.1, 7.0, 1.0, body);
      rect(1.6, 6.0, 11.4, 7.0, body);
      rect(0.9, 5.45, 12.1, 5.8, light);
      rr(1.4, 2.35, 10.2, 2.85, 0.25, light);
      for (const x of [1.45, 3.1, 4.75, 6.4]) { rr(x, 3.1, x + 1.4, 4.85, 0.25, glass); line([x + 0.3, 4.6, x + 0.75, 3.3], glint, 0.13); }
      rr(8.1, 3.05, 9.9, 6.8, 0.25, dark);
      rr(8.25, 3.2, 8.95, 6.0, 0.15, glass);
      rr(9.05, 3.2, 9.75, 6.0, 0.15, glass);
      poly([10.2, 3.05, 11.6, 3.05, 12.0, 5.2, 10.2, 5.2], glass);
      rr(10.2, 2.55, 11.7, 2.95, 0.1, [40, 38, 36]);
      for (const x of [10.45, 10.85, 11.25]) rect(x, 2.65, x + 0.25, 2.85, [255, 176, 60]);
      rr(12.0, 3.2, 12.4, 4.4, 0.15, [60, 56, 52]);
      ell(11.35, 5.95, 12.0, 6.6, [255, 228, 120]);
      ell(0.95, 5.95, 1.5, 6.55, [232, 70, 62]);
      rr(11.6, 6.8, 12.3, 7.5, 0.3, [190, 188, 182]);
      for (const cx of [3.2, 9.3]) wheel(cx, 7.8, 1.1, frame * 12, 1.35);
      return [1.4, 8.45, 11.8, 9.25];
    }
    if (kind === "ferry") {
      const body = col, dark = shade(col, 0.68), white = [250, 250, 246];
      poly([0.7, 5.5, 12.5, 5.5, 10.9, 8.2, 2.3, 8.2], dark);
      poly([0.7, 5.5, 12.5, 5.5, 12.2, 6.0, 0.95, 6.0], body);
      poly([1.7, 7.0, 11.5, 7.0, 11.1, 7.55, 2.0, 7.55], [226, 84, 74]);
      rr(3.0, 3.85, 9.9, 5.55, 0.35, white);
      rr(4.3, 2.75, 8.3, 3.95, 0.35, white);
      rect(3.0, 5.3, 9.9, 5.55, shade(white, 0.88));
      rr(4.6, 3.0, 8.0, 3.55, 0.15, glass);
      for (let i = 0; i < 5; i++) { const x = 3.7 + i * 1.2; ell(x - 0.28, 4.07, x + 0.28, 4.63, [120, 190, 225]); }
      rect(5.7, 1.35, 6.9, 2.8, body);
      rect(5.7, 1.35, 6.9, 1.75, [58, 54, 52]);
      line([8.0, 2.75, 8.0, 1.5], [90, 86, 82], 0.12);
      poly([8.0, 1.5, 8.7, 1.72, 8.0, 1.95], [232, 70, 62]);
      return [1.0, 8.15, 12.0, 8.95];
    }
    // train / subway
    const body = col, dark = shade(col, 0.68), light = shade(col, 1.55);
    rr(0.8, 2.75, 12.3, 7.6, 1.05, body);
    rect(0.8, 5.55, 12.3, 5.95, light);
    rect(0.8, 5.95, 12.3, 6.15, dark);
    rr(1.3, 6.8, 11.8, 7.7, 0.3, dark);
    rr(1.3, 2.45, 11.3, 3.05, 0.3, light);
    line([4.6, 2.55, 5.4, 1.65, 6.2, 2.55], [70, 66, 62], 0.16);
    line([4.85, 1.6, 5.95, 1.6], [70, 66, 62], 0.22);
    for (const x of [1.5, 3.2, 6.7, 8.4]) { rr(x, 3.45, x + 1.3, 4.95, 0.25, glass); line([x + 0.25, 4.7, x + 0.65, 3.65], glint, 0.13); }
    rr(5.0, 3.4, 6.2, 6.7, 0.2, dark);
    rr(5.15, 3.55, 5.55, 4.9, 0.12, glass);
    rr(5.65, 3.55, 6.05, 4.9, 0.12, glass);
    poly([10.2, 3.4, 11.5, 3.4, 12.0, 5.0, 10.2, 5.0], glass);
    ell(11.2, 6.0, 11.9, 6.7, [255, 228, 120]);
    ell(0.95, 6.0, 1.5, 6.6, [232, 70, 62]);
    for (const cx of [2.7, 4.1, 8.9, 10.3]) wheel(cx, 7.9, 0.68, frame * 15, 0, 4);
    return [1.2, 8.45, 11.8, 9.2];
  }

  function buildVehicle(kind, col, frame, unitPx) {
    const s = unitPx, W = Math.ceil(13 * s), H = Math.ceil(10 * s);
    const body = newCanvas(W, H), d = body.getContext("2d");
    const sh = drawVehicleParts(d, kind, col, frame, s);
    // white outline: the silhouette stamped around the sprite
    const sil = newCanvas(W, H), sd = sil.getContext("2d");
    sd.drawImage(body, 0, 0); sd.globalCompositeOperation = "source-in"; sd.fillStyle = "#fff"; sd.fillRect(0, 0, W, H);
    const out = newCanvas(W, H), o = out.getContext("2d");
    o.fillStyle = "rgba(60,50,40,0.27)"; o.beginPath();
    o.ellipse((sh[0] + sh[2]) / 2 * s, (sh[1] + sh[3]) / 2 * s, (sh[2] - sh[0]) / 2 * s, (sh[3] - sh[1]) / 2 * s, 0, 0, Math.PI * 2); o.fill();
    const r = Math.max(1, 0.34 * s);
    for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; o.drawImage(sil, Math.cos(a) * r, Math.sin(a) * r); }
    o.drawImage(body, 0, 0);
    if (kind === "ferry") {           // waves along the hull and drifting smoke
      const ph = frame / 8;
      o.save(); o.beginPath(); o.rect(0, 0, W, 8.1 * s); o.clip();
      for (let i = -1; i < 8; i++) {
        const x = (i * 1.7 + ph * 1.7) * s;
        o.fillStyle = "rgba(150,205,235,0.92)"; o.strokeStyle = "#fff"; o.lineWidth = Math.max(1, 0.18 * s);
        o.beginPath(); o.ellipse(x + 0.85 * s, 8.075 * s, 0.85 * s, 0.525 * s, 0, 0, Math.PI * 2); o.fill(); o.stroke();
      }
      o.restore();
      for (let i = 0; i < 3; i++) {
        const p = (ph + i / 3) % 1, cx = (6.3 - p * 2.2) * s, cy = (1.3 - p * 1.0) * s, rr = (0.3 + 0.5 * p) * s;
        o.fillStyle = `rgba(235,235,232,${0.82 * (1 - p)})`; o.beginPath(); o.arc(cx, cy, rr, 0, Math.PI * 2); o.fill();
      }
    }
    return out;
  }

  function modeGlyph(d, x, y, s, kind, col) {
    const w = s * 1.12;
    d.fillStyle = rgb(col); d.strokeStyle = rgb(col); d.lineCap = "round";
    const ell = (x0, y0, x1, y1) => { d.beginPath(); d.ellipse((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, 0, 0, Math.PI * 2); d.fill(); };
    const rr = (x0, y0, x1, y1, r) => { d.beginPath(); d.roundRect(x0, y0, x1 - x0, y1 - y0, r); d.fill(); };
    if (kind === "walk") {
      ell(x - s * 0.17, y - s * 0.52, x + s * 0.17, y - s * 0.18);
      d.lineWidth = s * 0.16; d.beginPath(); d.moveTo(x, y - s * 0.2); d.lineTo(x, y + s * 0.1); d.stroke();
      d.lineWidth = s * 0.14; d.beginPath(); d.moveTo(x - s * 0.24, y + s * 0.5); d.lineTo(x, y + s * 0.1); d.lineTo(x + s * 0.26, y + s * 0.48); d.stroke();
      return;
    }
    if (kind === "car") {
      rr(x - w / 2, y - s * 0.12, x + w / 2, y + s * 0.3, s * 0.18);
      d.beginPath(); d.moveTo(x - w * 0.3, y - s * 0.12); d.lineTo(x - w * 0.18, y - s * 0.46); d.lineTo(x + w * 0.2, y - s * 0.46); d.lineTo(x + w * 0.32, y - s * 0.12); d.fill();
      for (const dx of [-w * 0.26, w * 0.26]) ell(x + dx - s * 0.13, y + s * 0.2, x + dx + s * 0.13, y + s * 0.46);
      return;
    }
    if (kind === "ferry") {
      d.beginPath(); d.moveTo(x - w / 2, y); d.lineTo(x + w / 2, y); d.lineTo(x + w * 0.32, y + s * 0.4); d.lineTo(x - w * 0.32, y + s * 0.4); d.fill();
      rr(x - w * 0.22, y - s * 0.42, x + w * 0.2, y - s * 0.02, s * 0.12);
      return;
    }
    rr(x - w / 2, y - s * 0.5, x + w / 2, y + s * 0.26, s * 0.2);
    d.fillStyle = "#fff";
    for (const dx of [-w * 0.19, w * 0.19]) rr(x + dx - w * 0.13, y - s * 0.34, x + dx + w * 0.13, y - s * 0.02, s * 0.06);
    d.fillStyle = rgb(col);
    for (const dx of [-w * 0.26, w * 0.26]) ell(x + dx - s * 0.11, y + s * 0.2, x + dx + s * 0.11, y + s * 0.44);
  }

  // ---------------------------------------------------------------- built-in cartoon assets (engine.py BUILTIN)
  // every drawer: (ctx, x, y, s) with (x, y) the foot of the object
  const P_ = (d, pts, fill) => { d.fillStyle = rgb(fill); d.beginPath(); for (let i = 0; i < pts.length; i += 2) (i ? d.lineTo : d.moveTo).call(d, pts[i], pts[i + 1]); d.closePath(); d.fill(); };
  const E_ = (d, x0, y0, x1, y1, fill) => { d.fillStyle = rgb(fill); d.beginPath(); d.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2); d.fill(); };
  const R_ = (d, x0, y0, x1, y1, fill, outline) => { d.fillStyle = rgb(fill); d.fillRect(x0, y0, x1 - x0, y1 - y0); if (outline) { d.strokeStyle = rgb(outline); d.lineWidth = Math.max(1, (x1 - x0) * 0.04); d.strokeRect(x0, y0, x1 - x0, y1 - y0); } };
  const LOBES = [[0.00, -0.58, 0.52], [-0.34, -0.38, 0.38], [0.34, -0.36, 0.36], [0.02, -0.86, 0.36]];
  function leafy(d, x, y, s, base, light, dark) {
    light = light || shade(base, 1.28); dark = dark || shade(base, 0.72);
    const trunk = [132, 98, 72];
    P_(d, [x - 0.13 * s, y + 0.44 * s, x - 0.07 * s, y - 0.30 * s, x + 0.07 * s, y - 0.30 * s, x + 0.13 * s, y + 0.44 * s], trunk);
    P_(d, [x + 0.02 * s, y + 0.10 * s, x + 0.26 * s, y - 0.18 * s, x + 0.20 * s, y - 0.02 * s, x + 0.06 * s, y + 0.22 * s], trunk);
    for (const [ox, oy, r] of LOBES) E_(d, x + (ox - r) * s, y + (oy - r * 0.86) * s + 0.10 * s, x + (ox + r) * s, y + (oy + r * 0.86) * s + 0.10 * s, dark);
    for (const [ox, oy, r] of LOBES) E_(d, x + (ox - r) * s, y + (oy - r * 0.86) * s, x + (ox + r) * s, y + (oy + r * 0.86) * s, base);
    E_(d, x - 0.40 * s, y - 0.92 * s, x - 0.02 * s, y - 0.52 * s, light);
    E_(d, x - 0.20 * s, y - 1.02 * s, x + 0.04 * s, y - 0.80 * s, light);
  }
  // many plain trees at once: one path per colour (a forest of 500 trees in 5 fills instead of 6000)
  function forest(d, pts, s) {
    const base = [104, 158, 96], light = shade(base, 1.28), dark = shade(base, 0.72);
    const pass = (fill, fn) => { d.fillStyle = rgb(fill); d.beginPath(); for (const [x, y] of pts) fn(x, y); d.fill(); };
    const ell = (x0, y0, x1, y1) => { const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2; d.moveTo(cx + rx, cy); d.ellipse(cx, cy, rx, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2); };
    pass([132, 98, 72], (x, y) => { d.moveTo(x - 0.13 * s, y + 0.44 * s); d.lineTo(x - 0.07 * s, y - 0.30 * s); d.lineTo(x + 0.07 * s, y - 0.30 * s); d.lineTo(x + 0.13 * s, y + 0.44 * s); d.closePath(); });
    pass(dark, (x, y) => { for (const [ox, oy, r] of LOBES) ell(x + (ox - r) * s, y + (oy - r * 0.86 + 0.10) * s, x + (ox + r) * s, y + (oy + r * 0.86 + 0.10) * s); });
    pass(base, (x, y) => { for (const [ox, oy, r] of LOBES) ell(x + (ox - r) * s, y + (oy - r * 0.86) * s, x + (ox + r) * s, y + (oy + r * 0.86) * s); });
    pass(light, (x, y) => { ell(x - 0.40 * s, y - 0.92 * s, x - 0.02 * s, y - 0.52 * s); ell(x - 0.20 * s, y - 1.02 * s, x + 0.04 * s, y - 0.80 * s); });
  }
  const drawTree = (d, x, y, s) => leafy(d, x, y, s, [104, 158, 96]);
  const roundTree = (a, b) => (d, x, y, s) => leafy(d, x, y, s, a, b);
  function drawPine(d, x, y, s) {
    P_(d, [x - 0.10 * s, y + 0.44 * s, x - 0.06 * s, y - 0.05 * s, x + 0.06 * s, y - 0.05 * s, x + 0.10 * s, y + 0.44 * s], [124, 92, 68]);
    const base = [74, 130, 88];
    [0.60, 0.47, 0.33].forEach((w, i) => {
      const yy = y + (0.16 - 0.40 * i) * s, top = yy - 0.66 * s, col = shade(base, 1.0 + 0.13 * i);
      P_(d, [x - w * s, yy, x - w * 0.55 * s, yy - 0.10 * s, x, top, x + w * 0.55 * s, yy - 0.10 * s, x + w * s, yy], shade(col, 0.78));
      P_(d, [x - w * s, yy, x - w * 0.55 * s, yy - 0.10 * s, x, top, x + w * 0.16 * s, yy - 0.30 * s, x - w * 0.05 * s, yy], col);
    });
  }
  function drawHouse(d, x, y, s) {
    R_(d, x - 0.42 * s, y - 0.42 * s, x + 0.42 * s, y + 0.1 * s, [244, 234, 214], [214, 196, 164]);
    P_(d, [x - 0.55 * s, y - 0.40 * s, x + 0.55 * s, y - 0.40 * s, x, y - 0.86 * s], [206, 98, 74]);
    R_(d, x - 0.09 * s, y - 0.24 * s, x + 0.09 * s, y + 0.1 * s, [150, 110, 84]);
    R_(d, x + 0.18 * s, y - 0.30 * s, x + 0.32 * s, y - 0.16 * s, [176, 206, 220]);
  }
  function drawTorii(d, x, y, s) {
    const c = [200, 60, 48];
    R_(d, x - 0.52 * s, y - 0.62 * s, x + 0.52 * s, y - 0.44 * s, c);
    R_(d, x - 0.38 * s, y - 0.34 * s, x + 0.38 * s, y - 0.22 * s, c);
    R_(d, x - 0.40 * s, y - 0.50 * s, x - 0.26 * s, y + 0.55 * s, c);
    R_(d, x + 0.26 * s, y - 0.50 * s, x + 0.40 * s, y + 0.55 * s, c);
  }
  function drawPagoda(d, x, y, s, roof = [226, 150, 120]) {
    const body = [236, 222, 200];
    [0.9, 0.72, 0.54].forEach((w, i) => {
      const yy = y + (0.30 - 0.42 * i) * s;
      R_(d, x - w * 0.42 * s, yy - 0.16 * s, x + w * 0.42 * s, yy + 0.16 * s, body);
      P_(d, [x - w * 0.62 * s, yy - 0.16 * s, x + w * 0.62 * s, yy - 0.16 * s, x, yy - 0.44 * s], roof);
    });
  }
  function drawMountain(d, x, y, s) {
    const rock = [138, 156, 148], lit = [168, 184, 172], sh = [104, 122, 118];
    P_(d, [x - 1.00 * s, y + 0.30 * s, x - 0.52 * s, y - 0.62 * s, x - 0.04 * s, y + 0.30 * s], shade(rock, 0.82));
    P_(d, [x - 0.52 * s, y - 0.62 * s, x - 0.34 * s, y - 0.34 * s, x - 0.44 * s, y - 0.30 * s, x - 0.56 * s, y - 0.38 * s, x - 0.68 * s, y - 0.28 * s], [228, 234, 232]);
    P_(d, [x - 0.70 * s, y + 0.30 * s, x + 0.12 * s, y - 0.92 * s, x + 0.95 * s, y + 0.30 * s], rock);
    P_(d, [x + 0.12 * s, y - 0.92 * s, x + 0.95 * s, y + 0.30 * s, x + 0.34 * s, y + 0.30 * s], sh);
    P_(d, [x + 0.12 * s, y - 0.92 * s, x - 0.22 * s, y - 0.42 * s, x - 0.02 * s, y - 0.44 * s, x + 0.10 * s, y - 0.62 * s], lit);
    P_(d, [x + 0.12 * s, y - 0.92 * s, x + 0.46 * s, y - 0.40 * s, x + 0.33 * s, y - 0.36 * s, x + 0.20 * s, y - 0.46 * s,
           x + 0.06 * s, y - 0.30 * s, x - 0.06 * s, y - 0.44 * s, x - 0.22 * s, y - 0.34 * s], [246, 248, 244]);
  }
  function drawLantern(d, x, y, s) {
    R_(d, x - 0.08 * s, y - 0.1 * s, x + 0.08 * s, y + 0.4 * s, [150, 146, 138]);
    R_(d, x - 0.24 * s, y - 0.5 * s, x + 0.24 * s, y - 0.1 * s, [236, 232, 220], [150, 146, 138]);
    P_(d, [x - 0.34 * s, y - 0.5 * s, x + 0.34 * s, y - 0.5 * s, x, y - 0.78 * s], [120, 116, 108]);
  }
  const BUILTIN = {   // name: [drawer, nominal width, label]
    tree: [drawTree, 1.1, "나무"], pine: [drawPine, 1.24, "소나무"],
    maple: [roundTree([214, 98, 52], [236, 144, 64]), 1.1, "단풍"], ginkgo: [roundTree([236, 192, 56], [248, 220, 100]), 1.1, "은행나무"],
    sakura: [roundTree([244, 186, 204], [252, 216, 226]), 1.1, "벚나무"], house: [drawHouse, 1.1, "집"],
    torii: [drawTorii, 1.04, "도리이"], pagoda: [drawPagoda, 1.1, "탑"], mountain: [drawMountain, 1.8, "산"],
    lantern: [drawLantern, 0.7, "석등"]};

  function fontStack(lang, user) {
    const base = lang === "jp" ? FONT_JP : FONT_KR;
    return user ? `"${user}", ${base}` : base;
  }

  Object.assign(RS, {rgb, clamp01, easeIO, easeCub, easeBack, shade, fmtMinutes, newCanvas, seeded, fontInUse,
    buildVehicle, modeGlyph, BUILTIN, forest, fontStack, WEIGHT});
})(RS);
