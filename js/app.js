// ---------------------------------------------------------------- page logic
(function (RS) {
  const $ = id => document.getElementById(id);
  const LANGS = ["ko", "ja", "en"];
  const VEHICLES = ["train", "shinkansen", "subway", "bus", "walk", "car", "ferry"];
  const VEH_KO = {train: "열차", shinkansen: "신칸센", subway: "지하철", bus: "버스", walk: "도보", car: "자동차", ferry: "배"};
  const REGIONS = {route: "경로 주변", stations: "각 역 주변", map: "지도 전체"};
  const DENSITY = [["hills", "언덕"], ["trees", "나무"], ["fields", "들판"], ["clouds", "구름"], ["towns", "마을"]];
  const settings = {
    get(k, d) { try { const v = localStorage.getItem("rs." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("rs." + k, JSON.stringify(v)); } catch (e) { /* private window */ } }};

  const state = {cfg: null, prev: null, playing: false, t: 0, exporting: false, images: {}, fonts: {}, loading: false};
  const C = () => state.cfg;

  function setStatus(msg, kind = "") { const el = $("status"); el.textContent = msg; el.dataset.kind = kind; }

  // ---------------------------------------------------------------- project: defaults, migration, autosave
  function normalize(cfg) {
    const b = RS.blankProject();
    for (const k of Object.keys(b)) if (cfg[k] == null) cfg[k] = b[k];
    cfg.video = Object.assign({}, RS.BASE_VIDEO, cfg.video);
    cfg.timeline = Object.assign({}, RS.BASE_TIMELINE, cfg.timeline);
    cfg.timeline.pauses = cfg.timeline.pauses || {};
    cfg.background = Object.assign({}, b.background, cfg.background);
    cfg.background.auto = Object.assign({}, RS.BASE_AUTO, cfg.background.auto);
    cfg.background.auto.density = Object.assign({}, RS.BASE_AUTO.density, cfg.background.auto.density);
    cfg.background_image = Object.assign({}, b.background_image, cfg.background_image);
    cfg.palette = Object.assign({}, RS.BASE_PALETTE, cfg.palette);
    for (const k of ["title", "disclaimer"]) {
      const holder = k === "title" ? (cfg.header = cfg.header || {}) : cfg;
      if (typeof holder[k] !== "object" || !holder[k]) { const v = holder[k] || ""; holder[k] = {ko: v, ja: v, en: v}; }
    }
    if (Array.isArray(cfg.summary) || typeof cfg.summary !== "object" || !cfg.summary) {
      const v = Array.isArray(cfg.summary) ? cfg.summary : String(cfg.summary || "").split("\n").filter(Boolean);
      cfg.summary = {ko: v.slice(), ja: v.slice(), en: v.slice()};
    }
    return cfg;
  }
  function migrate(cfg) {
    let note = "";
    if ((cfg.video.rev || 0) < 3) { cfg.video.line_labels = false; cfg.video.leg_chip = false; cfg.video.rev = 3; }
    const n = RS.cleanProject(cfg);
    if (n) note = `저장된 경로에서 ${n}군데를 정리했습니다 (노선 이름 앞의 수단 표시, 중복된 요약 줄).`;
    return note;
  }
  let saveTmr = null, prevTmr = null;
  function touch(rebuild = true) {
    if (state.loading) return;
    clearTimeout(saveTmr);
    saveTmr = setTimeout(() => RS.cacheSet("project", C()).then(() => { $("saveNote").textContent = "자동 저장됨 " + new Date().toLocaleTimeString(); }), 700);
    if (rebuild) { clearTimeout(prevTmr); prevTmr = setTimeout(rebuildPreview, 150); }
  }
  async function loadProject(cfg, note) {
    state.cfg = normalize(cfg);
    const m = migrate(state.cfg);
    await loadImages();
    await loadFonts();
    loadUI();
    state.t = 0;
    rebuildPreview();
    const missing = missingFiles();
    const msgs = [note, m, missing.length ? `이 브라우저에서 열 수 없는 파일 ${missing.length}개 (데스크톱 경로): ${missing.slice(0, 3).join(", ")} — 2. 배경에서 다시 골라 주세요.` : ""].filter(Boolean);
    if (msgs.length) setStatus(msgs.join("\n"), missing.length ? "warn" : "ok");
    touch(false);
  }
  function missingFiles() {
    const c = C(), out = [], f = c.background_image.file;
    if (f && !f.startsWith("data:")) out.push(f);
    for (const a of c.background.assets || []) if (a.file && !a.file.startsWith("data:")) out.push(a.file);
    return out;
  }
  async function loadImages() {
    const srcs = new Set();
    const c = C();
    if (c.background_image.file && c.background_image.file.startsWith("data:")) srcs.add(c.background_image.file);
    for (const a of c.background.assets || []) if (a.file && a.file.startsWith("data:")) srcs.add(a.file);
    for (const src of srcs) {
      if (state.images[src]) continue;
      const im = new Image(); im.src = src;
      try { await im.decode(); state.images[src] = im; } catch (e) { /* broken picture: skipped */ }
    }
  }
  async function loadFonts() {
    state.fonts = {};
    for (const k of ["kr", "jp"]) {
      const name = ((C().fonts || {})[k] || [])[0];
      if (!name || !String(name).startsWith("web:")) continue;
      const buf = await RS.cacheGet("font:" + name);
      if (!buf) continue;
      try {
        const fam = "RSUser" + k + name.length;
        const ff = new FontFace(fam, buf); await ff.load(); document.fonts.add(ff);
        state.fonts[k] = fam;
      } catch (e) { setStatus("글꼴 파일을 읽지 못했습니다: " + name.slice(4), "warn"); }
    }
    const kr = ((C().fonts || {}).kr || [])[0], jp = ((C().fonts || {}).jp || [])[0];
    $("fontLbl").textContent = `지금 쓰는 글꼴: 한글/영문 ${state.fonts.kr ? kr.slice(4) : RS.fontInUse()}` +
      (state.fonts.jp ? ` · 일본어 ${jp.slice(4)}` : "");
  }

  // ---------------------------------------------------------------- UI <- cfg
  const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  function loadUI() {
    state.loading = true;
    const c = C(), V = c.video, BG = c.background, bi = c.background_image;
    // tab 2
    $("clean").checked = BG.decor === false;
    $("autoOn").checked = !!BG.auto.enabled;
    for (const [k] of DENSITY) { $("d_" + k).value = BG.auto.density[k] ?? 1; $("dv_" + k).textContent = (+$("d_" + k).value).toFixed(1) + "×"; }
    $("seed").value = BG.auto.seed ?? 7;
    $("assetScale").value = BG.asset_scale || 1; $("assetScaleVal").textContent = (+$("assetScale").value).toFixed(1) + "×";
    $("assetDensity").value = BG.asset_density ?? 1; $("assetDensityVal").textContent = (+$("assetDensity").value).toFixed(1) + "×";
    $("terrainLbl").textContent = RS.terrainSummary(BG.osm) || "실제 지형: 없음";
    $("bgMode").value = bi.mode === "screen" ? "screen" : "map";
    $("bgMargin").value = bi.margin_pct ?? 25;
    $("bgReplace").checked = bi.replace_terrain !== false;
    $("bgOpacity").value = bi.opacity ?? 1; $("bgOpVal").textContent = (+$("bgOpacity").value).toFixed(2);
    $("bgName").textContent = bi.file ? (bi.file.startsWith("data:") ? (bi.name || "이미지") : "열 수 없음: " + bi.file) : "없음";
    // tab 3
    for (const r of document.querySelectorAll("input[name=lang]")) r.checked = r.value === (c.language || "ko");
    for (const l of LANGS) {
      $("title_" + l).value = c.header.title[l] || "";
      $("disc_" + l).value = c.disclaimer[l] || "";
      $("sum_" + l).value = (c.summary[l] || []).join("\n");
    }
    $("res").value = `${V.width}x${V.height}`;
    if (!$("res").value) $("res").value = "1920x1080";
    $("fps").value = String(V.fps || 30);
    $("quality").value = V.web_quality || "high";
    $("outroZoom").value = V.outro_zoom ?? 1;
    $("outline").checked = !!V.route_outline;
    $("lineLabels").checked = !!V.line_labels;
    $("legChip").checked = !!V.leg_chip;
    $("timeLabels").checked = V.time_labels !== false;
    for (const k of ["intro_s", "zoom_in_s", "cam_move_s", "zoom_out_s", "outro_hold_s"]) $("tl_" + k).value = c.timeline[k];
    $("lineSpeed").value = c.timeline.line_speed || 1; $("lineSpeedVal").textContent = (+$("lineSpeed").value).toFixed(1) + "×";
    state.loading = false;
    renderTables();
  }

  // ---------------------------------------------------------------- tables (stations / segments / assets)
  function renderTables() {
    const c = C(), lang = c.language || "ko";
    const ids = c.stations.map(s => s.id);
    let h = "<tr><th>#</th><th>한글</th><th>日本語</th><th>English</th><th>위도</th><th>경도</th><th>카드</th><th>큰</th><th>멈춤</th><th></th></tr>";
    c.stations.forEach((s, i) => {
      h += `<tr data-i="${i}"><td class="n">${i + 1}</td>` +
        ["ko", "ja", "en"].map(k => `<td><input type="text" data-f="${k}" value="${esc(s[k])}" style="min-width:80px"></td>`).join("") +
        `<td><input type="number" data-f="lat" step="0.0001" value="${(+s.lat).toFixed(5)}" style="width:86px"></td>` +
        `<td><input type="number" data-f="lon" step="0.0001" value="${(+s.lon).toFixed(5)}" style="width:92px"></td>` +
        `<td><select data-f="side" style="min-width:46px">${["L", "R", "T", "B"].map(v => `<option${(s.side || "R") === v ? " selected" : ""}>${v}</option>`).join("")}</select></td>` +
        `<td><input type="checkbox" data-f="big"${s.big ? " checked" : ""}></td>` +
        `<td><input type="number" data-f="pause" step="0.1" min="0" value="${c.timeline.pauses[s.id] || 0}" style="width:52px"></td>` +
        `<td class="act"><button class="icon" data-a="up">▲</button><button class="icon" data-a="down">▼</button><button class="icon" data-a="del">✕</button></td></tr>`;
    });
    $("stTbl").innerHTML = h;
    const colNames = Object.keys(c.palette).filter(k => !["sea", "sea_edge", "plain", "field", "hill_a", "hill_b", "hill_sh", "river", "river_hi",
      "city", "city_bd", "roof", "ink", "muted", "card_bd", "ghost", "card_bg", "card_sh", "route_edge", "map_text", "cloud", "route_halo"].includes(k));
    const stName = id => { const s = c.stations.find(x => x.id === id); return s ? `${c.stations.indexOf(s) + 1}. ${s[lang] || s.ko || id}` : id + " (없음)"; };
    h = "<tr><th>#</th><th>출발</th><th>도착</th><th>수단</th><th>색</th><th>노선</th><th>부제</th><th>분</th><th>초</th><th></th></tr>";
    c.segments.forEach((g, i) => {
      const colVal = Array.isArray(g.color) ? "custom" : (g.color || g.vehicle);
      const hex = "#" + (Array.isArray(g.color) ? g.color : (c.palette[colVal] || [0, 0, 0])).map(v => (+v).toString(16).padStart(2, "0")).join("");
      const sel = cur => ids.map(id => `<option value="${esc(id)}"${id === cur ? " selected" : ""}>${esc(stName(id))}</option>`).join("") + (ids.includes(cur) ? "" : `<option selected value="${esc(cur)}">${esc(cur)} (없음)</option>`);
      h += `<tr data-i="${i}"><td class="n">${i + 1}</td>` +
        `<td><select data-f="from" style="min-width:92px">${sel(g.from)}</select></td><td><select data-f="to" style="min-width:92px">${sel(g.to)}</select></td>` +
        `<td><select data-f="vehicle" style="min-width:64px">${VEHICLES.map(v => `<option value="${v}"${g.vehicle === v ? " selected" : ""}>${VEH_KO[v]}</option>`).join("")}</select></td>` +
        `<td style="white-space:nowrap"><select data-f="color" style="width:68px">${colNames.map(n => `<option${n === colVal ? " selected" : ""}>${n}</option>`).join("")}<option value="custom"${colVal === "custom" ? " selected" : ""}>직접</option></select>` +
        `<input type="color" data-f="hex" value="${hex}" style="width:26px;padding:0;border:none;vertical-align:middle"></td>` +
        `<td><input type="text" data-f="title" value="${esc(RS.tr(g.title, lang))}" style="min-width:90px"></td>` +
        `<td><input type="text" data-f="sub" value="${esc(RS.tr(g.sub, lang))}" style="min-width:64px"></td>` +
        `<td><input type="number" data-f="minutes" step="1" min="0" value="${g.minutes ?? ""}" style="width:48px"></td>` +
        `<td><input type="number" data-f="travel_s" step="0.1" min="0.3" value="${g.travel_s ?? 2}" style="width:48px"></td>` +
        `<td class="act"><button class="icon" data-a="up">▲</button><button class="icon" data-a="down">▼</button><button class="icon" data-a="del">✕</button></td></tr>`;
    });
    $("sgTbl").innerHTML = h;
    h = "<tr><th>종류</th><th>개수</th><th>크기(km)</th><th>배치</th><th>시드</th><th>사용</th><th></th></tr>";
    (c.background.assets || []).forEach((a, i) => {
      const kind = a.builtin ? (RS.BUILTIN[a.builtin] || [0, 0, a.builtin])[2] : (a.name || (a.file && !a.file.startsWith("data:") ? "열 수 없음: " + a.file.split(/[\\/]/).pop() : "PNG"));
      h += `<tr data-i="${i}"><td>${esc(kind)}</td>` +
        `<td><input type="number" data-f="count" min="1" step="1" value="${a.count ?? 10}" style="width:60px"></td>` +
        `<td><input type="number" data-f="size_km" min="0.05" step="0.1" value="${a.size_km ?? 0.5}" style="width:64px"></td>` +
        `<td><select data-f="region" style="min-width:96px">${Object.entries(REGIONS).map(([k, v]) => `<option value="${k}"${(a.region || "map") === k ? " selected" : ""}>${v}</option>`).join("")}</select></td>` +
        `<td><input type="number" data-f="seed" step="1" value="${a.seed ?? 1}" style="width:56px"></td>` +
        `<td><input type="checkbox" data-f="enabled"${a.enabled !== false ? " checked" : ""}></td>` +
        `<td class="act"><button class="icon" data-a="del">✕</button></td></tr>`;
    });
    $("asTbl").innerHTML = h;
  }
  function tableEvents() {
    // tables are rebuilt after the event: replacing a row while its input is losing focus throws
    const later = () => setTimeout(renderTables, 0);
    const rowOf = e => { const tr = e.target.closest("tr[data-i]"); return tr ? +tr.dataset.i : -1; };
    const moveIn = (arr, i, d) => { if (i + d < 0 || i + d >= arr.length) return false; [arr[i], arr[i + d]] = [arr[i + d], arr[i]]; return true; };
    $("stTbl").addEventListener("change", e => {
      const i = rowOf(e), f = e.target.dataset.f; if (i < 0 || !f) return;
      const s = C().stations[i];
      if (f === "big") s.big = e.target.checked;
      else if (f === "lat" || f === "lon") { const v = parseFloat(e.target.value); if (isFinite(v)) s[f] = v; }
      else if (f === "pause") { const v = parseFloat(e.target.value); if (v > 0) C().timeline.pauses[s.id] = v; else delete C().timeline.pauses[s.id]; }
      else s[f] = e.target.value;
      if (["ko", "ja", "en"].includes(f)) later();
      touch();
    });
    $("stTbl").addEventListener("click", e => {
      const a = e.target.dataset.a, i = rowOf(e); if (!a || i < 0) return;
      const L = C().stations;
      if (a === "del") {
        const id = L[i].id, used = C().segments.filter(g => g.from === id || g.to === id).length;
        if (used) { setStatus(`이 지점을 쓰는 구간이 ${used}개 있습니다. 구간을 먼저 고치거나 지워 주세요.`, "warn"); return; }
        L.splice(i, 1);
      } else if (!moveIn(L, i, a === "up" ? -1 : 1)) return;
      later(); touch();
    });
    $("sgTbl").addEventListener("change", e => {
      const i = rowOf(e), f = e.target.dataset.f; if (i < 0 || !f) return;
      const g = C().segments[i], lang = C().language || "ko";
      if (f === "title" || f === "sub") {
        if (!g[f] || typeof g[f] !== "object") { const v = g[f] || ""; g[f] = {ko: v, ja: v, en: v}; }
        g[f][lang] = e.target.value;
      } else if (f === "minutes" || f === "travel_s") { const v = parseFloat(e.target.value); if (isFinite(v) && v >= 0) g[f] = f === "travel_s" ? Math.max(0.3, v) : v; }
      else if (f === "hex") { const h = e.target.value; g.color = [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16)); later(); }
      else if (f === "color") { if (e.target.value !== "custom") g.color = e.target.value; later(); }
      else if (f === "vehicle") { const old = g.vehicle; g.vehicle = e.target.value; if (!Array.isArray(g.color) && (g.color === old || !g.color)) g.color = g.vehicle; later(); }
      else g[f] = e.target.value;
      touch();
    });
    $("sgTbl").addEventListener("click", e => {
      const a = e.target.dataset.a, i = rowOf(e); if (!a || i < 0) return;
      const L = C().segments;
      if (a === "del") L.splice(i, 1); else if (!moveIn(L, i, a === "up" ? -1 : 1)) return;
      later(); touch();
    });
    $("asTbl").addEventListener("change", e => {
      const i = rowOf(e), f = e.target.dataset.f; if (i < 0 || !f) return;
      const a = C().background.assets[i];
      if (f === "enabled") a.enabled = e.target.checked;
      else if (f === "region") a.region = e.target.value;
      else { const v = parseFloat(e.target.value); if (isFinite(v)) a[f] = f === "size_km" ? v : Math.round(v); }
      touch();
    });
    $("asTbl").addEventListener("click", e => {
      if (e.target.dataset.a !== "del") return;
      C().background.assets.splice(rowOf(e), 1); later(); touch();
    });
    $("addSt").onclick = () => {
      const L = C().stations, ids = new Set(L.map(s => s.id));
      let n = 0; while (ids.has("p" + n)) n++;
      const last = L[L.length - 1] || {lat: 35, lon: 135};
      L.push({id: "p" + n, ko: "새 지점", ja: "新規", en: "New stop", lat: last.lat + 0.01, lon: last.lon + 0.01, side: "R", big: false});
      renderTables(); touch();
    };
    $("addSg").onclick = () => {
      const st = C().stations;
      if (st.length < 2) { setStatus("먼저 정차 지점을 2개 이상 추가해 주세요.", "warn"); return; }
      C().segments.push({from: st[st.length - 2].id, to: st[st.length - 1].id, vehicle: "train", color: "train", bulge: 0.08,
        title: {ko: "새 구간", ja: "新区間", en: "New leg"}, sub: {ko: "", ja: "", en: ""}, travel_s: 2.0});
      renderTables(); touch();
    };
    $("refitBtn").onclick = () => {
      const target = Math.max(3, +$("target").value || 16), segs = C().segments;
      settings.set("target", target);
      const w = segs.map(s => Math.pow(Math.max(+s.minutes || 3, 3), 0.6)), sw = w.reduce((a, b) => a + b, 0) || 1;
      segs.forEach((s, i) => (s.travel_s = +Math.max(0.9, target * w[i] / sw).toFixed(2)));
      renderTables(); touch();
    };
  }

  // ---------------------------------------------------------------- route import
  function applyPieces(p) {
    const c = C();
    Object.assign(c, {stations: p.stations, segments: p.segments, summary: p.summary});
    c.timeline.pauses = p.pauses || {};
    const bg = c.background;
    Object.assign(bg, {water: [], rivers: [], fields: [], cities: [], hill_regions: [], landmarks: [], clouds: [], trees_on_hills: false});
    delete bg.osm;                                   // terrain of another place
    bg.auto.enabled = true;
    state.t = 0;
    loadUI(); rebuildPreview(); touch(false);
  }
  const target = () => Math.max(3, +$("target").value || 16);
  function convertText() {
    const ta = $("routeText"), text = ta.value;
    try {
      if (RS.looksLikeItinerary(text)) {
        const it = RS.parseItinerary(text);
        ta.value = RS.itineraryToText(it, RS.regionOf(text));
        setStatus(`구글 지도 경로를 정리했습니다: 지점 ${it.stops.length}개, 구간 ${it.legs.length}개` +
                  (it.total_min ? ` · 전체 ${RS.fmtMin(it.total_min, "ko")}` : "") + (it.fare ? ` · 요금 ${it.fare}` : ""), "ok");
      } else {
        const [out, removed] = RS.tidyRows(text);
        ta.value = out;
        setStatus(removed ? `정리했습니다: 도보·중복 ${removed}줄을 붐습니다.` : "정리할 것이 없습니다.");
      }
      settings.set("text", ta.value);
    } catch (e) { setStatus(e.message, "error"); }
  }
  async function busy(btn, fn) {
    btn.disabled = true;
    try { await fn(); } catch (e) { setStatus(e.message || String(e), "error"); } finally { btn.disabled = false; }
  }
  const buildRoute = () => busy($("buildBtn"), async () => {
    settings.set("text", $("routeText").value);
    const parsed = RS.parseRouteText($("routeText").value);
    const res = await RS.resolve(parsed, {apiKey: $("apiKey").value, road: $("roadChk").checked}, m => setStatus(m));
    applyPieces(RS.buildProject(parsed, res.coords, res.paths, target()));
    const roads = res.paths.filter(Boolean).length;
    setStatus(`경로를 만들었습니다: 지점 ${C().stations.length}개, 구간 ${C().segments.length}개` + (roads ? ` · 실제 지형 선 ${roads}구간` : "") +
      (res.notes.length ? "\n" + res.notes.join("\n") : "") + "\n표에서 이름·카드 위치를 다듬을 수 있습니다. 바다·해안선은 '2. 배경'에서 불러오세요.", res.notes.length ? "warn" : "ok");
  });
  function epoch() {
    const d = $("depDate").value, t = $("depTime").value, off = parseFloat($("utc").value) || 0;
    if (!d || !t) return null;
    const ms = Date.parse(`${d}T${t}:00Z`);
    return isFinite(ms) ? ms / 1000 - off * 3600 : null;
  }
  const fetchRoute = () => busy($("fetchBtn"), async () => {
    const key = $("apiKey").value.trim();
    if (!key) throw new Error("Google Routes API 키를 입력해 주세요.");
    const places = $("places").value.split("\n").map(l => l.trim()).filter(Boolean).map(line => {
      if (!line.includes("=")) return {query: line, names: null};
      const [q, n] = [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)];
      const parts = n.split("/").map(x => x.trim()); while (parts.length < 3) parts.push("");
      const fb = parts[2] || parts[0] || parts[1] || q.trim();
      return {query: q.trim(), names: {ko: parts[0] || fb, ja: parts[1] || fb, en: parts[2] || fb}};
    });
    if (places.length < 2) throw new Error("장소를 2줄 이상 입력해 주세요 (출발 / 도착).");
    saveSettings();
    applyPieces(await RS.fetchRoute(key, places, $("mode").value, epoch(), target(), m => setStatus(m)));
    setStatus(`Google에서 경로를 가져왔습니다: 지점 ${C().stations.length}개, 구간 ${C().segments.length}개`, "ok");
  });
  const fetchLink = () => busy($("linkBtn"), async () => {
    const parsed = RS.parseLink($("link").value);
    saveSettings();
    const key = $("apiKey").value.trim(), mode = parsed.mode || "transit";
    if (parsed.mode) $("mode").value = parsed.mode;
    $("places").value = parsed.stops.map(s => s.query || s.name).join("\n");
    if (key) {
      const places = parsed.stops.map(s => ({query: s.latlon ? s.latlon.map(v => v.toFixed(6)).join(",") : (s.query || s.name),
        names: s.name ? {ko: s.name, ja: s.name, en: s.name} : null}));
      try {
        applyPieces(await RS.fetchRoute(key, places, mode, epoch(), target(), m => setStatus(m)));
        setStatus(`링크의 좌표로 노선·환승·소요 시간까지 불러왔습니다 (지점 ${C().stations.length}개).`, "ok");
        return;
      } catch (e) {
        applyPieces(await RS.piecesFromStops(parsed.stops, mode, target(), key, m => setStatus(m)));
        setStatus(`Google Routes API 호출이 실패해서 좌표만 사용했습니다 (환승·노선·소요 시간 없음).\n수단: ${mode} · ${e.message.split("\n")[0]}`, "warn");
        return;
      }
    }
    applyPieces(await RS.piecesFromStops(parsed.stops, mode, target(), null, m => setStatus(m)));
    setStatus("API 키가 없어 좌표만 불러왔습니다. 환승역·노선 이름·소요 시간은 링크에 들어 있지 않습니다.", "warn");
  });
  function saveSettings() {
    for (const k of ["apiKey", "mode", "depDate", "depTime", "utc", "places", "link", "target"]) settings.set(k, $(k).value);
    settings.set("road", $("roadChk").checked);
  }

  // ---------------------------------------------------------------- background tab
  const terrainBbox = maxDeg2 => RS.routeBbox(C(), 0.25, true, maxDeg2);
  const loadNE = () => busy($("neBtn"), async () => {
    if (C().stations.length < 2) throw new Error("먼저 경로(지점 2개 이상)를 만들어 주세요.");
    const layers = {};
    for (const k of ["land", "islands", "lakes", "rivers", "peaks"]) {
      try { layers[k] = await RS.neLayer(k, m => setStatus(m)); }
      catch (e) { if (k === "land") throw e; layers[k] = []; }
    }
    setStatus("Natural Earth 지도에서 지형을 만드는 중…");
    C().background.osm = RS.neBuild(layers, terrainBbox(null), +$("detail").value);
    $("terrainLbl").textContent = RS.terrainSummary(C().background.osm);
    setStatus("지도 모양을 넣었습니다: " + RS.terrainSummary(C().background.osm), "ok");
    touch();
  });
  const loadOSM = () => busy($("osmBtn"), async () => {
    if (C().stations.length < 2) throw new Error("먼저 경로(지점 2개 이상)를 만들어 주세요.");
    const bbox = terrainBbox(9.0);
    const ck = "osm:" + bbox.map(v => v.toFixed(3)).join("_");
    let res = await RS.cacheGet(ck);
    if (res) setStatus("저장해 둔 지형을 사용합니다 (인터넷 불필요).");
    else { res = RS.osmProcess(await RS.osmFetch(bbox, m => setStatus(m)), bbox); await RS.cacheSet(ck, res); }
    C().background.osm = res;
    $("terrainLbl").textContent = RS.terrainSummary(res);
    setStatus("자세한 지형을 넣었습니다: " + RS.terrainSummary(res), "ok");
    touch();
  });
  function readDataURL(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); }); }

  function bgEvents() {
    const g = () => C().background;
    $("clean").onchange = e => { g().decor = !e.target.checked; touch(); };
    $("autoOn").onchange = e => { g().auto.enabled = e.target.checked; touch(); };
    $("dens").innerHTML = DENSITY.map(([k, lab]) => `<span>${lab}</span><input type="range" id="d_${k}" min="0" max="3" step="0.1"><span class="mono" id="dv_${k}"></span>`).join("");
    for (const [k] of DENSITY) $("d_" + k).oninput = e => { g().auto.density[k] = +(+e.target.value).toFixed(1); $("dv_" + k).textContent = (+e.target.value).toFixed(1) + "×"; touch(); };
    $("assetScale").oninput = e => { g().asset_scale = +(+e.target.value).toFixed(1); $("assetScaleVal").textContent = g().asset_scale.toFixed(1) + "×"; touch(); };
    $("assetDensity").oninput = e => { g().asset_density = +(+e.target.value).toFixed(1); $("assetDensityVal").textContent = g().asset_density.toFixed(1) + "×"; touch(); };
    $("seed").onchange = e => { const v = parseInt(e.target.value, 10); if (isFinite(v)) { g().auto.seed = v; touch(); } };
    $("reseed").onclick = () => { g().auto.seed = 1 + Math.floor(Math.random() * 9999); $("seed").value = g().auto.seed; touch(); };
    $("theme").innerHTML = Object.keys(RS.THEMES).map(t => `<option>${t}</option>`).join("");
    $("applyTheme").onclick = () => {
      const pal = JSON.parse(JSON.stringify(RS.BASE_PALETTE));
      Object.assign(pal, JSON.parse(JSON.stringify(RS.THEMES[$("theme").value])));
      // keep colours the user added for named lines (e.g. 'keihan')
      for (const [k, v] of Object.entries(C().palette)) if (!(k in pal)) pal[k] = v;
      C().palette = pal; renderTables(); touch();
    };
    $("neBtn").onclick = loadNE;
    $("osmBtn").onclick = loadOSM;
    $("clearTerrain").onclick = () => { delete g().osm; $("terrainLbl").textContent = "실제 지형: 없음"; touch(); };
    $("detail").oninput = e => ($("detailVal").textContent = (+e.target.value).toFixed(1));
    $("detailVal").textContent = "1.0";
    $("neFiles").onchange = async e => {
      try {
        const got = await RS.neStoreFiles([...e.target.files], m => setStatus(m));
        const names = Object.keys(got);
        if (!names.length) throw new Error("Natural Earth 파일 이름이 아닙니다 (예: ne_10m_land.zip).");
        setStatus(`이 브라우저에 보관했습니다: ${names.join(", ")}. 이제 '지도 모양 불러오기'를 누르세요.`, "ok");
      } catch (err) { setStatus("지도 파일을 읽지 못했습니다: " + err.message, "error"); }
      e.target.value = "";
    };
    $("bgFile").onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      const url = await readDataURL(f);
      Object.assign(C().background_image, {file: url, name: f.name});
      await loadImages(); loadUI(); touch(); e.target.value = "";
    };
    $("bgClear").onclick = () => { C().background_image.file = ""; loadUI(); touch(); };
    $("bgMode").onchange = e => { C().background_image.mode = e.target.value; touch(); };
    $("bgMargin").onchange = e => { const v = parseFloat(e.target.value); if (isFinite(v)) { C().background_image.margin_pct = v; touch(); } };
    $("bgReplace").onchange = e => { C().background_image.replace_terrain = e.target.checked; touch(); };
    $("bgOpacity").oninput = e => { C().background_image.opacity = +e.target.value; $("bgOpVal").textContent = (+e.target.value).toFixed(2); touch(); };
    $("builtinPick").innerHTML = Object.entries(RS.BUILTIN).map(([k, v]) => `<option value="${k}">${v[2]}</option>`).join("");
    $("addBuiltin").onclick = () => {
      const L = g().assets = g().assets || [];
      L.push({builtin: $("builtinPick").value, count: 30, size_km: 0.5, region: "route", seed: L.length + 1});
      renderTables(); touch();
    };
    $("pngFiles").onchange = async e => {
      const L = g().assets = g().assets || [];
      for (const f of e.target.files) L.push({file: await readDataURL(f), name: f.name, count: 20, size_km: 0.5, region: "route", seed: L.length + 1});
      await loadImages(); renderTables(); touch(); e.target.value = "";
    };
  }

  // ---------------------------------------------------------------- texts & video tab
  function outEvents() {
    for (const r of document.querySelectorAll("input[name=lang]")) r.onchange = () => { C().language = r.value; renderTables(); touch(); };
    for (const l of LANGS) {
      $("title_" + l).oninput = e => { C().header.title[l] = e.target.value; touch(); };
      $("disc_" + l).oninput = e => { C().disclaimer[l] = e.target.value; touch(); };
      $("sum_" + l).oninput = e => { C().summary[l] = e.target.value.split("\n").filter(x => x.trim()); touch(); };
    }
    const V = () => C().video;
    $("res").onchange = e => { const [w, h] = e.target.value.split("x").map(Number); V().width = w; V().height = h; touch(); };
    $("fps").onchange = e => { V().fps = +e.target.value; touch(); };
    $("quality").onchange = e => { V().web_quality = e.target.value; touch(false); };
    $("outroZoom").onchange = e => { const v = parseFloat(e.target.value); if (isFinite(v)) { V().outro_zoom = Math.max(1, Math.min(4, v)); touch(); } };
    for (const [id, k] of [["outline", "route_outline"], ["lineLabels", "line_labels"], ["legChip", "leg_chip"], ["timeLabels", "time_labels"]])
      $(id).onchange = e => { V()[k] = e.target.checked; touch(); };
    for (const k of ["intro_s", "zoom_in_s", "cam_move_s", "zoom_out_s", "outro_hold_s"])
      $("tl_" + k).onchange = e => { const v = parseFloat(e.target.value); if (isFinite(v)) { C().timeline[k] = Math.max(0, v); touch(); } };
    const pickFont = k => async e => {
      const f = e.target.files[0]; if (!f) return;
      const name = "web:" + f.name;
      await RS.cacheSet("font:" + name, await f.arrayBuffer());
      C().fonts = C().fonts || {}; C().fonts[k] = [name];
      await loadFonts(); touch(); e.target.value = "";
    };
    $("fontKr").onchange = pickFont("kr");
    $("fontJp").onchange = pickFont("jp");
    $("fontClear").onclick = async () => { C().fonts = {kr: [], jp: []}; await loadFonts(); touch(); };
  }

  // ---------------------------------------------------------------- saving files
  // A page opened from a file (file://) loses the file name on a plain download link (Chrome saves it as
  // "download"), so the browser's own Save dialog is used when it exists; it is asked for BEFORE the long
  // render, while the click still counts as the user's action.
  async function askSave(name, desc, mime, ext) {
    if (!window.showSaveFilePicker) return null;
    try { return await window.showSaveFilePicker({suggestedName: name, types: [{description: desc, accept: {[mime]: [ext]}}]}); }
    catch (e) { if (e.name === "AbortError") return "cancel"; return null; }
  }
  async function writeFile(handle, blob, name) {
    if (handle && handle !== "cancel") {
      const w = await handle.createWritable(); await w.write(blob); await w.close();
      return handle.name || name;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    return name;
  }
  const safeName = s => s.replace(/[\\/:*?"<>|\s]+/g, "_");

  // ---------------------------------------------------------------- preview
  const cv = () => $("preview");
  function rendererFor(w, h) {
    return new RS.Renderer(C(), {width: w, height: h, images: state.images, fonts: state.fonts});
  }
  function rebuildPreview() {
    const V = C().video, W = V.width, H = V.height;
    const box = $("stage").getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const scale = Math.min(1, Math.min(box.width - 24, 1600) * dpr / W);
    const w = Math.max(320, Math.round(W * scale)), h = Math.round(w * H / W);
    const c = cv();
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    if (C().stations.length < 2 || !C().segments.length) { state.prev = null; drawEmpty(); $("dur").textContent = ""; return; }
    try { state.prev = rendererFor(w, h); }
    catch (e) { state.prev = null; setStatus("미리보기를 만들 수 없습니다: " + e.message, "error"); drawEmpty(); return; }
    $("scrub").max = state.prev.DUR.toFixed(2);
    state.t = Math.min(state.t, state.prev.DUR);
    drawAt(state.t);
    const p = state.prev;
    $("dur").textContent = `길이 ${p.DUR.toFixed(1)}초 (경로 ${p.ROUTE_END.toFixed(1)} + 끝 유지 ${p.HOLD_S.toFixed(1)}) · ${W}×${H} · ${p.FPS}fps`;
  }
  function drawEmpty() {
    const c = cv(), x = c.getContext("2d");
    x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = "#d9e3c8"; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = "#6f685d"; x.font = "16px sans-serif"; x.fillText("경로를 만들면 여기에 미리보기가 나옵니다", 20, 30);
  }
  function drawAt(t) {
    if (!state.prev) return;
    state.t = t;
    state.prev.render(cv().getContext("2d"), t);
    $("scrub").value = t;
    $("clock").textContent = `${t.toFixed(1)} / ${state.prev.DUR.toFixed(1)}초`;
  }
  function play() {
    if (!state.prev) return;
    state.playing = true; $("playBtn").textContent = "❚❚ 정지";
    if (state.t >= state.prev.DUR - 0.05) state.t = 0;
    let last = performance.now();
    const step = now => {
      if (!state.playing || !state.prev) return;
      const t = state.t + (now - last) / 1000; last = now;
      if (t >= state.prev.DUR) { drawAt(state.prev.DUR); stop(); return; }
      drawAt(t);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function stop() { state.playing = false; $("playBtn").textContent = "▶ 재생"; }

  // ---------------------------------------------------------------- MP4 export (WebCodecs)
  function pickCodec(w, h, fps) {
    const mbps = Math.ceil(w / 16) * Math.ceil(h / 16) * fps;
    if (mbps > 522240) return "avc1.640033";
    if (mbps > 245760) return "avc1.64002a";
    return "avc1.640028";
  }
  const yieldUI = () => new Promise(r => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });
  function toI420(rgba, W, H, out) {
    // BT.709 video range, integer maths, two rows at a time (chroma = average of each 2x2 block)
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
  async function exportMp4() {
    if (state.exporting) { state.cancel = true; return; }
    if (!state.prev) { setStatus("먼저 경로를 만들어 주세요.", "error"); return; }
    if (typeof VideoEncoder === "undefined") { setStatus("이 브라우저는 MP4 인코딩(WebCodecs)을 지원하지 않습니다. 최신 Chrome 이나 Edge 에서 열어 주세요.", "error"); return; }
    stop();
    const V = C().video, W = V.width, H = V.height, fps = +V.fps || 30, q = V.web_quality || "high";
    const st = C().stations, nm = s => s[C().language || "ko"] || s.ko || s.en || "";
    const name = safeName(`route_${nm(st[0])}_${nm(st[st.length - 1])}`) + ".mp4";
    const handle = await askSave(name, "MP4 영상", "video/mp4", ".mp4");
    if (handle === "cancel") return;
    const qp = {normal: 26, high: 21, max: 17}[q] || 21;
    const bitrate = Math.round(W * H * fps * ({normal: 0.17, high: 0.33, max: 0.66}[q] || 0.33));
    let cfg = {codec: pickCodec(W, H, fps), width: W, height: H, framerate: fps, bitrateMode: "quantizer", avc: {format: "avc"}}, useQ = true;
    try {
      if (!(await VideoEncoder.isConfigSupported(cfg)).supported) {
        useQ = false; cfg = Object.assign({}, cfg, {bitrateMode: "constant", bitrate});
        if (!(await VideoEncoder.isConfigSupported(cfg)).supported) throw new Error(`이 브라우저에서 ${W}x${H} ${fps}fps H.264 인코딩을 지원하지 않습니다.`);
      }
    } catch (e) { setStatus(e.message, "error"); return; }
    let rend;
    try { rend = rendererFor(W, H); } catch (e) { setStatus(e.message, "error"); return; }
    const canvas = new OffscreenCanvas(W, H), ctx = canvas.getContext("2d", {alpha: false, willReadFrequently: true});
    const yuv = new Uint8Array(W * H * 3 / 2), mux = new RS.Mp4Writer(W, H, fps);
    let failed = null;
    const encoder = new VideoEncoder({output: (chunk, meta) => mux.add(chunk, meta), error: e => { failed = e; }});
    encoder.configure(cfg);
    state.exporting = true; state.cancel = false;
    $("exportBtn").textContent = "취소"; $("bar").hidden = false;
    const total = rend.NFRAMES, t0 = performance.now();
    try {
      for (let n = 0; n < total; n++) {
        if (state.cancel) throw new Error("취소했습니다.");
        if (failed) throw failed;
        rend.render(ctx, n / fps);
        // own RGB -> YUV (BT.709 video range): what Premiere expects from an HD file
        toI420(ctx.getImageData(0, 0, W, H).data, W, H, yuv);
        const frame = new VideoFrame(yuv, {format: "I420", codedWidth: W, codedHeight: H, timestamp: Math.round(n * 1e6 / fps),
          duration: Math.round(1e6 / fps), colorSpace: {primaries: "bt709", transfer: "bt709", matrix: "bt709", fullRange: false}});
        const key = n % (fps * 2) === 0;
        encoder.encode(frame, useQ ? {keyFrame: key, avc: {quantizer: qp}} : {keyFrame: key});
        frame.close();
        while (encoder.encodeQueueSize > 6) await new Promise(r => encoder.addEventListener("dequeue", r, {once: true}));
        if (n % 5 === 0 || n === total - 1) {
          const el = (performance.now() - t0) / 1000, sp = (n + 1) / el;
          $("barFill").style.width = ((n + 1) / total * 100).toFixed(1) + "%";
          setStatus(`MP4 만드는 중 ${n + 1}/${total} · 초당 ${sp.toFixed(0)}프레임 · 남은 시간 약 ${Math.ceil((total - n - 1) / sp)}초`);
          await yieldUI();
        }
      }
      await encoder.flush();
      if (failed) throw failed;
      const blob = mux.finish(), secs = (performance.now() - t0) / 1000;
      const saved = await writeFile(handle, blob, name);
      setStatus(`저장했습니다: ${saved} (${(blob.size / 1048576).toFixed(1)} MB, ${W}x${H} ${fps}fps, ${rend.DUR.toFixed(1)}초) · 만드는 데 ${secs.toFixed(1)}초`, "ok");
      window.__lastExport = {name, size: blob.size, secs, frames: total, blob, mode: useQ ? "qp" + qp : "cbr"};
    } catch (e) {
      setStatus(e.message || String(e), e.message === "취소했습니다." ? "" : "error");
    } finally {
      try { encoder.close(); } catch (e) { /* closed */ }
      state.exporting = false; $("exportBtn").textContent = "MP4 저장"; $("bar").hidden = true; $("barFill").style.width = "0";
    }
  }

  // ---------------------------------------------------------------- wiring
  function init() {
    for (const b of document.querySelectorAll(".tabs button")) b.onclick = () => {
      for (const x of document.querySelectorAll(".tabs button")) x.setAttribute("aria-selected", String(x === b));
      for (const t of document.querySelectorAll(".tab")) t.hidden = t.id !== b.dataset.tab;
      settings.set("tab", b.dataset.tab);
    };
    const tab = settings.get("tab", "t1"); const tb = document.querySelector(`.tabs button[data-tab=${tab}]`); if (tb) tb.click();
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const defaults = {apiKey: "", mode: "transit", depDate: tomorrow, depTime: "08:00", utc: "9", places: "Namba Station, Osaka\nKifune Shrine, Kyoto", link: "", target: "16"};
    for (const [k, d] of Object.entries(defaults)) $(k).value = settings.get(k, d);
    $("roadChk").checked = settings.get("road", true);
    $("routeText").value = settings.get("text", "");
    for (const k of ["apiKey", "mode", "depDate", "depTime", "utc", "places", "link", "target"]) $(k).addEventListener("change", saveSettings);
    $("roadChk").onchange = saveSettings;
    $("keyShow").onchange = e => ($("apiKey").type = e.target.checked ? "text" : "password");
    $("routeText").addEventListener("input", () => settings.set("text", $("routeText").value));
    $("clearBtn").onclick = () => { $("routeText").value = ""; settings.set("text", ""); };
    $("convertBtn").onclick = convertText;
    $("buildBtn").onclick = buildRoute;
    $("fetchBtn").onclick = fetchRoute;
    $("linkBtn").onclick = fetchLink;
    tableEvents(); bgEvents(); outEvents();
    $("playBtn").onclick = () => (state.playing ? stop() : play());
    $("scrub").oninput = e => { stop(); drawAt(+e.target.value); };
    $("jStart").onclick = () => { stop(); drawAt(0); };
    $("jEnd").onclick = () => { stop(); if (state.prev) drawAt(Math.max(0, state.prev.ROUTE_END - 0.05)); };
    $("jHold").onclick = () => { stop(); if (state.prev) drawAt(Math.min(state.prev.DUR, state.prev.ROUTE_END + 2.5)); };
    $("exportBtn").onclick = exportMp4;
    $("lineSpeed").oninput = e => { C().timeline.line_speed = +(+e.target.value).toFixed(1); $("lineSpeedVal").textContent = C().timeline.line_speed.toFixed(1) + "×"; touch(); };
    $("newBtn").onclick = () => { if (confirmLoss()) loadProject(RS.blankProject(), "새 프로젝트를 시작했습니다."); };
    $("sampleBtn").onclick = () => { if (confirmLoss()) loadProject(RS.defaultProject(), "예시 경로(난바 → 오하라 → 기후네 신사)를 불러왔습니다."); };
    $("saveBtn").onclick = async () => {
      const st = C().stations, name = safeName(st.length ? `route_${st[0].ko}_${st[st.length - 1].ko}` : "route_project") + ".json";
      const handle = await askSave(name, "Route Studio 프로젝트", "application/json", ".json");
      if (handle === "cancel") return;
      try {
        const saved = await writeFile(handle, new Blob([JSON.stringify(C(), null, 1)], {type: "application/json"}), name);
        setStatus("프로젝트 파일을 저장했습니다: " + saved + " (데스크톱 프로그램에서도 열 수 있습니다)", "ok");
      } catch (e) { setStatus("저장하지 못했습니다: " + e.message, "error"); }
    };
    $("openFile").onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try { await loadProject(JSON.parse(await f.text()), "열었습니다: " + f.name); }
      catch (err) { setStatus("프로젝트 파일을 열지 못했습니다: " + err.message, "error"); }
      e.target.value = "";
    };
    let rt = null;
    window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(rebuildPreview, 150); });
    const start = async () => {
      const saved = await RS.cacheGet("project");
      await loadProject(saved || RS.defaultProject(), saved ? "이전 작업을 이어서 불러왔습니다 (자동 저장)." : "예시 경로를 불러왔습니다. 경로 텍스트를 붙여 넣고 '경로 만들기'를 누르세요.");
    };
    (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(start);
  }
  // Nothing is lost by switching: the current work is in the browser's autosave until replaced.
  // confirm() cannot be used inside a published page, so a second click within 4 s confirms.
  let armed = 0;
  function confirmLoss() {
    if (!C() || C().stations.length < 2) return true;
    if (Date.now() - armed < 4000) { armed = 0; return true; }
    armed = Date.now();
    setStatus("지금 작업이 바뀝니다. 먼저 '프로젝트 저장'을 해 두세요. 계속하려면 같은 버튼을 한 번 더 누르세요.", "warn");
    return false;
  }
  RS.app = {state, rebuildPreview, drawAt, exportMp4, loadProject, C};
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})(RS);
