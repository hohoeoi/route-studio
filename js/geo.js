// ---------------------------------------------------------------- network: coordinates, Google Routes, map files
(function (RS) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const LANGS = ["ko", "ja", "en"];

  // ---- small persistent cache (IndexedDB)
  function idb() {
    return new Promise((res, rej) => {
      const rq = indexedDB.open("route-studio-web", 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore("kv");
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  }
  async function cacheGet(k) {
    try {
      const db = await idb();
      return await new Promise(res => { const rq = db.transaction("kv").objectStore("kv").get(k); rq.onsuccess = () => res(rq.result); rq.onerror = () => res(undefined); });
    } catch (e) { return undefined; }
  }
  async function cacheSet(k, v) {
    try {
      const db = await idb();
      await new Promise(res => { const tx = db.transaction("kv", "readwrite"); tx.objectStore("kv").put(v, k); tx.oncomplete = res; tx.onerror = res; });
    } catch (e) { /* the cache is optional */ }
  }
  async function cacheKeys(prefix) {
    try {
      const db = await idb();
      return await new Promise(res => { const rq = db.transaction("kv").objectStore("kv").getAllKeys(); rq.onsuccess = () => res(rq.result.filter(k => String(k).startsWith(prefix))); rq.onerror = () => res([]); });
    } catch (e) { return []; }
  }

  // ---- geometry helpers
  function decodePolyline(s) {
    const pts = []; let i = 0, lat = 0, lng = 0;
    while (i < s.length) {
      for (let w = 0; w < 2; w++) {
        let shift = 0, result = 0, b;
        do { b = s.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        const d = (result & 1) ? ~(result >> 1) : (result >> 1);
        if (w === 0) lat += d; else lng += d;
      }
      pts.push([lat / 1e5, lng / 1e5]);
    }
    return pts;
  }
  function havKm(a, b) {
    const r = Math.PI / 180, p1 = a[0] * r, p2 = b[0] * r, dp = p2 - p1, dl = (b[1] - a[1]) * r;
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function thinPath(path, minKm = 0.03) {
    if (path.length <= 2) return path.map(p => [p[0], p[1]]);
    const out = [path[0]];
    for (let i = 1; i < path.length - 1; i++) if (havKm(out[out.length - 1], path[i]) >= minKm) out.push(path[i]);
    out.push(path[path.length - 1]);
    return out.map(p => [+p[0].toFixed(6), +p[1].toFixed(6)]);
  }

  // ---- Google Routes API (v2)
  const FIELD_MASK = ["routes.duration", "routes.travelAdvisory.transitFare", "routes.legs.steps.travelMode", "routes.legs.steps.distanceMeters",
    "routes.legs.steps.staticDuration", "routes.legs.steps.polyline.encodedPolyline", "routes.legs.steps.startLocation",
    "routes.legs.steps.endLocation", "routes.legs.steps.transitDetails"].join(",");
  const MODE_V2 = {transit: "TRANSIT", driving: "DRIVE", walking: "WALK", bicycling: "BICYCLE"};
  function waypoint(q) {
    if (Array.isArray(q)) return {location: {latLng: {latitude: q[0], longitude: q[1]}}};
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(q);
    if (m) return {location: {latLng: {latitude: +m[1], longitude: +m[2]}}};
    return {address: q};
  }
  async function postRoutes(key, body) {
    let r;
    try {
      r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {method: "POST",
        headers: {"Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELD_MASK}, body: JSON.stringify(body)});
    } catch (e) { throw new Error("Google 서버에 접속하지 못했습니다 (" + e.message + ")"); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${(data.error || {}).status || r.status} ${(data.error || {}).message || ""}\n(API 키, Routes API 사용 설정, 결제 계정을 확인하세요)`);
    return data;
  }
  async function requestRoutes(key, origin, dest, mode, epoch, lang) {
    const body = {origin: waypoint(origin), destination: waypoint(dest), travelMode: MODE_V2[mode] || "TRANSIT", languageCode: lang};
    if (mode === "transit") {        // transit needs a departure in the future: a past one returns nothing
      const now = Date.now() / 1000, when = epoch && epoch > now + 120 ? epoch : now + 1800;
      body.departureTime = new Date(when * 1000).toISOString().replace(/\.\d+Z$/, "Z");
    }
    let data = await postRoutes(key, body);
    if (!(data.routes || []).length && body.departureTime) { delete body.departureTime; data = await postRoutes(key, body); }
    if (!(data.routes || []).length) throw new Error("경로를 찾지 못했습니다 (Google 응답에 경로가 없음). 일본·한국의 대중교통은 Google API가 지원하지 않습니다 — 경로 텍스트 붙여넣기를 쓰세요.");
    return toLegacy(data);
  }
  const durS = v => parseInt(String(v || "0").replace("s", ""), 10) || 0;
  const llOf = loc => { const x = (loc || {}).latLng || {}; return {lat: x.latitude || 0, lng: x.longitude || 0}; };
  function toLegacy(data) {
    const route = data.routes[0], leg = route.legs[0];
    const mm = {WALK: "WALKING", TRANSIT: "TRANSIT", DRIVE: "DRIVING", BICYCLE: "BICYCLING"};
    const steps = [];
    for (const st of leg.steps || []) {
      const tm = mm[st.travelMode || "WALK"] || "WALKING", dist = st.distanceMeters || 0;
      let dur = durS(st.staticDuration);
      if (!dur) dur = Math.round(dist / (tm === "WALKING" ? 1.3 : 9));
      const step = {travel_mode: tm, distance: dist, duration: dur, path: decodePolyline((st.polyline || {}).encodedPolyline || ""),
                    start: llOf(st.startLocation), end: llOf(st.endLocation)};
      const td = st.transitDetails;
      if (tm === "TRANSIT" && td) {
        const sd = td.stopDetails || {}, tl = td.transitLine || {};
        step.transit = {name: tl.name || "", short: tl.nameShort || "", color: tl.color || "", vtype: (tl.vehicle || {}).type || "HEAVY_RAIL",
          dep: {name: (sd.departureStop || {}).name || "", loc: llOf((sd.departureStop || {}).location)},
          arr: {name: (sd.arrivalStop || {}).name || "", loc: llOf((sd.arrivalStop || {}).location)}};
        if (!st.staticDuration && sd.arrivalTime && sd.departureTime) step.duration = Math.round((Date.parse(sd.arrivalTime) - Date.parse(sd.departureTime)) / 1000);
      }
      const prev = steps[steps.length - 1];
      if (prev && tm !== "TRANSIT" && prev.travel_mode === tm) {
        prev.path = prev.path.concat(step.path); prev.distance += dist; prev.duration += step.duration; prev.end = step.end;
      } else steps.push(step);
    }
    const out = {steps, total: durS(route.duration) || steps.reduce((a, s) => a + s.duration, 0)};
    const fare = (route.travelAdvisory || {}).transitFare;
    if (fare && fare.units != null) {
      const sym = {JPY: "¥", KRW: "₩", USD: "$", EUR: "€"}[fare.currencyCode] || (fare.currencyCode + " ");
      out.fare = sym + Number(fare.units).toLocaleString("en-US");
    }
    return out;
  }
  const TRANSIT_KIND = {HIGH_SPEED_TRAIN: "shinkansen", LONG_DISTANCE_TRAIN: "train", BUS: "bus", INTERCITY_BUS: "bus", TROLLEYBUS: "bus",
                        SHARE_TAXI: "bus", FERRY: "ferry", SUBWAY: "subway", METRO_RAIL: "subway"};
  const hexRgb = h => { h = (h || "").replace("#", ""); if (h.length === 3) h = h.split("").map(c => c + c).join(""); return h.length === 6 ? [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) : null; };
  const fmtDist = m => (m >= 1000 ? (m / 1000).toFixed(1) + " km" : Math.round(m / 10) * 10 + " m");

  // one origin -> destination, answers in several languages -> nodes + segments (maps_api.parse_leg)
  function parseLeg(byLang, originNames, destNames, originFb, destFb) {
    const langs = LANGS.filter(l => byLang[l]), main = byLang.en ? "en" : langs[0];
    const steps = byLang[main].steps;
    const other = {}; for (const l of langs) other[l] = byLang[l].steps.length === steps.length ? byLang[l].steps : steps;
    const perLang = fn => { const o = {}; for (const l of langs) { try { o[l] = fn(l, other[l]); } catch (e) { o[l] = fn(main, steps); } } return o; };
    let keep = steps.map(st => !(st.travel_mode === "WALKING" && st.distance < 120 && st.duration <= 120 && steps.length > 1));
    if (!keep.some(Boolean)) keep = steps.map(() => true);
    const nodes = [], segs = [];
    let first = true;
    steps.forEach((st, i) => {
      if (!keep[i]) return;
      const mode = st.travel_mode, durMin = st.duration / 60;
      let kind, col, s, e, sN = null, eN = null, title;
      if (mode === "TRANSIT" && st.transit) {
        const t = st.transit;
        kind = TRANSIT_KIND[t.vtype] || "train"; col = hexRgb(t.color) || kind;
        s = t.dep.loc; e = t.arr.loc;
        sN = perLang((l, S) => S[i].transit.dep.name); eN = perLang((l, S) => S[i].transit.arr.name);
        title = perLang((l, S) => { const x = S[i].transit; return x.short && x.name && !x.name.includes(x.short) ? `${x.name} ${x.short}` : (x.name || x.short || RS.VEHICLE_WORD[l][kind]); });
      } else {
        kind = mode === "DRIVING" ? "car" : "walk"; col = kind;
        s = st.start; e = st.end;
        title = {}; for (const l of langs) title[l] = RS.VEHICLE_WORD[l][kind];
      }
      const sub = {};
      for (const l of langs) {
        sub[l] = `${RS.VEHICLE_WORD[l][kind]} · ${RS.fmtMin(durMin, l)}`;
        if (kind === "walk" || kind === "car") sub[l] += " · " + fmtDist(st.distance);
      }
      if (first) { nodes.push({name: originNames || sN || originFb, lat: s.lat, lon: s.lng}); first = false; }
      else if (sN && nodes[nodes.length - 1].generic) { nodes[nodes.length - 1].name = sN; delete nodes[nodes.length - 1].generic; }
      nodes.push({name: eN || {}, lat: e.lat, lon: e.lng, generic: !eN});
      segs.push({vehicle: kind, color: col, title, sub, path: thinPath(st.path), dur_min: durMin});
    });
    if (destNames) nodes[nodes.length - 1].name = destNames;
    else if (nodes[nodes.length - 1].generic) nodes[nodes.length - 1].name = destFb;
    for (const n of nodes) {
      delete n.generic;
      for (const l of LANGS) if (!n.name[l]) n.name[l] = n.name.en || Object.values(n.name).find(Boolean) || "Waypoint";
    }
    return [nodes, segs];
  }
  // places: [{query, names|null}] -> project pieces (maps_api.fetch_route + build_project_pieces)
  async function fetchRoute(key, places, mode, epoch, target, log) {
    const stations = [], segments = [], summary = {ko: [], ja: [], en: []}, legIds = [];
    const langs = ["en", "ko", "ja"], total = (places.length - 1) * langs.length;
    let done = 0;
    for (let li = 0; li + 1 < places.length; li++) {
      const a = places[li], b = places[li + 1], byLang = {};
      for (const l of langs) {
        try { byLang[l] = await requestRoutes(key, a.query, b.query, mode, epoch, l); }
        catch (e) { if (l === "en") throw e; }
        log(`Google 경로 검색 ${++done} / ${total}`);
      }
      const fb = p => ({ko: p.query, ja: p.query, en: p.query});
      const [nodes, segs] = parseLeg(byLang, a.names, b.names, fb(a), fb(b));
      const base = stations.length;
      nodes.forEach((n, ni) => {
        if (li > 0 && ni === 0) return;
        stations.push({id: "s" + stations.length, ko: n.name.ko, ja: n.name.ja, en: n.name.en, lat: n.lat, lon: n.lon, side: "R", big: false});
      });
      const ids = (li > 0 ? [stations[base - 1].id] : []).concat(stations.slice(base).map(s => s.id));
      segs.forEach((sg, k) => segments.push(Object.assign({}, sg, {from: ids[k], to: ids[k + 1]})));
      legIds.push([ids[0], ids[ids.length - 1], byLang.en.total, byLang.en.fare]);
    }
    const marks = new Set([legIds[0][0], ...legIds.map(x => x[1])]);
    for (const s of stations) s.big = marks.has(s.id);
    RS.assignSides(stations);
    const w = segments.map(s => Math.pow(Math.max(s.dur_min, 3), 0.6)), sw = w.reduce((x, y) => x + y, 0);
    segments.forEach((s, i) => { s.travel_s = +Math.max(0.9, target * w[i] / sw).toFixed(2); s.bulge = 0; s.minutes = +s.dur_min.toFixed(1); delete s.dur_min; });
    legIds.forEach(([a, b, tot, fare], li) => {
      const sa = stations.find(s => s.id === a), sb = stations.find(s => s.id === b);
      for (const l of LANGS) {
        const word = {ko: `${li + 1}구간`, ja: `区間${li + 1}`, en: `Leg ${li + 1}`}[l];
        summary[l].push(`${word}  ${sa[l]} → ${sb[l]}   ${RS.fmtMin(tot / 60, l)}` + (fare ? " · " + fare : ""));
      }
    });
    if (legIds.length > 1) {
      const tot = legIds.reduce((x, y) => x + y[2], 0);
      for (const l of LANGS) summary[l].push(`${{ko: "합계", ja: "合計", en: "Total"}[l]}   ${RS.fmtMin(tot / 60, l)}`);
    }
    const pauses = {}; for (const x of legIds.slice(0, -1)) pauses[x[1]] = 1.0;
    return {stations, segments, summary, pauses};
  }
  async function roadPath(key, a, b, mode) {
    try { const r = await requestRoutes(key, a, b, mode, null, "en"); return thinPath(r.steps.flatMap(s => s.path)); }
    catch (e) { return []; }
  }

  // ---- OpenStreetMap Nominatim
  async function nominatim(q) {
    const ck = "geo:" + q, hit = await cacheGet(ck);
    if (hit) return hit;
    const url = "https://nominatim.openstreetmap.org/search?" + new URLSearchParams({q, format: "json", limit: "1", "accept-language": "ko"});
    let r;
    try { r = await fetch(url); }
    catch (e) { throw new Error(`좌표 검색에 접속하지 못했습니다 (${q}). 인터넷 연결을 확인하거나 '이름 @위도,경도' 로 좌표를 직접 적어 주세요.`); }
    if (!r.ok) throw new Error("OpenStreetMap 좌표 검색 실패 (HTTP " + r.status + ")");
    const res = await r.json();
    if (!res.length) throw new Error(`장소를 찾지 못했습니다: ${q}\n(지역 이름을 덧붙이거나 '이름 @위도,경도' 로 직접 적어 주세요)`);
    const v = [+res[0].lat, +res[0].lon];
    await cacheSet(ck, v);
    return v;
  }

  // text rows -> coordinates (+ ground paths).  Google first (knows Korean names), then OpenStreetMap.
  async function resolve(parsed, opts, log) {
    const rows = parsed.rows, n = rows.length;
    const coords = rows.map(r => r.ll), paths = new Array(n - 1).fill(null), notes = [];
    const key = (opts.apiKey || "").trim();
    if (key) {
      for (let i = 0; i < n - 1; i++) {
        const ferry = rows[i].leg && rows[i].leg.kind === "ferry";
        if (coords[i] && coords[i + 1] && (!opts.road || ferry)) continue;
        log(`Google 경로 확인 ${i + 1}/${n - 1}`);
        try {
          const r = await requestRoutes(key, coords[i] || rows[i].query, coords[i + 1] || rows[i + 1].query, "driving", null, "en");
          const st = r.steps;
          if (!coords[i]) coords[i] = [st[0].start.lat, st[0].start.lng];
          if (!coords[i + 1]) coords[i + 1] = [st[st.length - 1].end.lat, st[st.length - 1].end.lng];
          if (opts.road && !ferry) paths[i] = thinPath(st.flatMap(s => s.path));
        } catch (e) {
          notes.push(`Google 요청 실패 (${rows[i].query} → ${rows[i + 1].query}): ${e.message.split("\n")[0]}`);
          if (/접속하지 못했습니다/.test(e.message)) break;
        }
      }
    }
    const missing = coords.map((c, i) => (c ? -1 : i)).filter(i => i >= 0);
    for (let k = 0; k < missing.length; k++) {
      const i = missing[k];
      log(`OpenStreetMap 좌표 검색 ${k + 1}/${missing.length}: ${rows[i].query}`);
      if (k) await sleep(1100);
      coords[i] = await nominatim(rows[i].query);
    }
    return {coords, paths, notes};
  }

  // ---- Google Maps share links (gmaps_link.py).  A short maps.app.goo.gl link cannot be opened from
  // a web page (the browser blocks reading where it redirects), so the long address is needed.
  const MODES = {"0": "driving", "1": "bicycling", "2": "walking", "3": "transit"};
  const COUNTRY = ["일본", "日本", "Japan", "대한민국", "한국", "韓国", "South Korea", "Korea", "중국", "中国", "China", "대만", "台湾", "Taiwan"];
  const LATLON = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
  const unq = s => { try { return decodeURIComponent(s.replace(/\+/g, " ")); } catch (e) { return s; } };
  function cleanName(raw) {
    let s = raw.split(",")[0].replace(/[〒]?\s*\d{3}[-−–]\d{4}|\b\d{5}(?:-\d{4})?\b/g, " ");
    if (/[぀-ヿ㐀-鿿가-힯]/.test(s)) { const m = /\s[A-Za-z]/.exec(s); if (m) s = s.slice(0, m.index); }
    s = s.split(/\s+/).filter(Boolean).join(" ");
    for (const c of [...COUNTRY].sort((a, b) => b.length - a.length)) if (s.endsWith(" " + c) || s === c) s = s.slice(0, s.length - c.length).trim();
    s = s.replace(/^[\s·\-−–]+|[\s·\-−–]+$/g, "");
    return s || raw.split(",")[0].trim();
  }
  function stop(raw, latlon) {
    let name = raw ? cleanName(unq(raw)) : "";
    if (!name && latlon) name = `${latlon[0].toFixed(4)}, ${latlon[1].toFixed(4)}`;
    return {query: raw ? unq(raw) : name, name, latlon};
  }
  function parseLink(url) {
    url = url.trim();
    if (!/^https?:/.test(url)) throw new Error("http로 시작하는 링크를 붙여넣어 주세요.");
    if (/goo\.gl\//.test(url)) throw new Error("짧은 링크(maps.app.goo.gl)는 웹 버전에서 바로 펼칠 수 없습니다.\n링크를 브라우저에서 한 번 연 뒤, 주소창의 긴 주소(google.com/maps/dir/…)를 복사해 붙여넣어 주세요.");
    const u = new URL(url), q = u.searchParams;
    if (q.get("origin") || q.get("destination")) {
      const names = [q.get("origin") || "", ...(q.get("waypoints") || "").split("|").filter(w => w.trim()), q.get("destination") || ""];
      const stops = names.filter(n => n.trim()).map(n => { const m = LATLON.exec(n); return m ? stop("", [+m[1], +m[2]]) : stop(encodeURIComponent(n), null); });
      if (stops.length < 2) throw new Error("링크에서 출발지와 도착지를 찾지 못했습니다.");
      return {stops, mode: q.get("travelmode")};
    }
    if (!url.includes("/maps/dir/")) throw new Error("경로(길찾기) 링크가 아닙니다.\nGoogle 지도에서 경로를 검색한 뒤의 주소를 넣어 주세요.");
    const path = url.split("/maps/dir/")[1].split("?")[0], names = [];
    for (const seg of path.split("/")) { if (!seg || seg.startsWith("@") || seg.includes("=")) break; names.push(seg); }
    const coords = [...url.matchAll(/!1d(-?\d+\.\d+)!2d(-?\d+\.\d+)/g)].map(m => [+m[2], +m[1]]);
    const modes = [...url.matchAll(/!3e(\d)/g)];
    const mode = modes.length ? MODES[modes[modes.length - 1][1]] : null;
    let stops = names.map((n, i) => { const m = LATLON.exec(unq(n)); return m ? stop("", [+m[1], +m[2]]) : stop(n, coords[i] || null); });
    if (stops.length < 2 && coords.length >= 2) stops = coords.map(c => stop("", c));
    if (stops.length < 2) throw new Error("링크에서 출발지와 도착지를 찾지 못했습니다.");
    return {stops, mode};
  }
  const MODE_KIND = {driving: "car", walking: "walk", bicycling: "walk", transit: "train"};
  // stops with known coordinates -> pieces (no travel times are invented: legs show the distance)
  async function piecesFromStops(stops, mode, target, key, log) {
    const kind = MODE_KIND[mode || ""] || "train", pts = [], stations = [];
    for (let i = 0; i < stops.length; i++) {
      const s = stops[i];
      let p = s.latlon;
      if (!p) { log(`좌표 검색 ${i + 1}/${stops.length}`); if (i) await sleep(1100); p = await nominatim(s.query || s.name); }
      pts.push(p);
      const nm = s.name || "";
      stations.push({id: "s" + i, ko: nm, ja: nm, en: nm, lat: p[0], lon: p[1], side: "R", big: i === 0 || i === stops.length - 1});
    }
    const segments = [], dists = [];
    for (let i = 0; i + 1 < stops.length; i++) {
      const dkm = havKm(pts[i], pts[i + 1]); dists.push(dkm);
      const title = {}, sub = {};
      for (const l of LANGS) { title[l] = RS.VEHICLE_WORD[l][kind]; sub[l] = `${RS.VEHICLE_WORD[l][kind]} · ${fmtDist(dkm * 1000)}`; }
      segments.push({from: "s" + i, to: "s" + (i + 1), vehicle: kind, color: kind, title, sub, bulge: i % 2 === 0 ? 0.08 : -0.08});
    }
    RS.assignSides(stations);
    if (key && kind !== "ferry") for (let i = 0; i < segments.length; i++) {
      log(`도로 모양 ${i + 1}/${segments.length}`);
      const p = await roadPath(key, pts[i], pts[i + 1], kind === "walk" ? "walking" : "driving");
      if (p.length >= 2) segments[i].path = p;
    }
    const w = dists.map(d => Math.pow(Math.max(d, 1), 0.6)), sw = w.reduce((a, b) => a + b, 0) || 1;
    segments.forEach((g, i) => (g.travel_s = +Math.max(0.9, target * w[i] / sw).toFixed(2)));
    const total = dists.reduce((a, b) => a + b, 0), summary = {};
    for (const l of LANGS) summary[l] = [`${stations[0][l]} → ${stations[stations.length - 1][l]}   ${fmtDist(total * 1000)}`];
    return {stations, segments, summary, pauses: {}};
  }

  // ---- Natural Earth files: GeoJSON (download) or the desktop program's zipped shapefiles
  // shape = {bbox:[w,s,e,n], rings:[[[lon,lat],...]], props}
  function bboxOf(rings) {
    let w = 180, s = 90, e = -180, n = -90;
    for (const r of rings) for (const p of r) { if (p[0] < w) w = p[0]; if (p[0] > e) e = p[0]; if (p[1] < s) s = p[1]; if (p[1] > n) n = p[1]; }
    return [w, s, e, n];
  }
  function shapesFromGeoJSON(gj) {
    const out = [];
    const add = (rings, props) => out.push({bbox: bboxOf(rings), rings, props});
    for (const f of gj.features || []) {
      const g = f.geometry, pr = f.properties || {};
      if (!g) continue;
      if (g.type === "Polygon") add(g.coordinates, pr);
      else if (g.type === "MultiPolygon") for (const p of g.coordinates) add(p, pr);
      else if (g.type === "LineString") add([g.coordinates], pr);
      else if (g.type === "MultiLineString") add(g.coordinates, pr);
      else if (g.type === "Point") add([[g.coordinates]], pr);
      else if (g.type === "MultiPoint") for (const p of g.coordinates) add([[p]], pr);
    }
    return out;
  }
  function readDbf(buf) {
    if (!buf || buf.byteLength < 32) return [];
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    const nrec = dv.getInt32(4, true), hlen = dv.getInt16(8, true), rlen = dv.getInt16(10, true);
    const fields = []; let p = 32;
    const dec = new TextDecoder("latin1");
    while (p < hlen - 1 && u8[p] !== 0x0d) {
      const name = dec.decode(u8.subarray(p, p + 11)).split("\0")[0].toLowerCase();
      fields.push([name, u8[p + 16]]); p += 32;
    }
    const rows = []; p = hlen;
    for (let i = 0; i < nrec && p + rlen <= buf.byteLength; i++, p += rlen) {
      const row = {}; let q = p + 1;
      for (const [nm, ln] of fields) { row[nm] = dec.decode(u8.subarray(q, q + ln)).trim(); q += ln; }
      rows.push(row);
    }
    return rows;
  }
  function shapesFromShp(buf, dbf) {
    const dv = new DataView(buf), out = [], rows = readDbf(dbf);
    let pos = 100, idx = -1;
    while (pos + 8 <= buf.byteLength) {
      const clen = dv.getInt32(pos + 4, false) * 2, c = pos + 8;
      pos = c + clen; idx++;
      if (c + 4 > buf.byteLength) break;
      const st = dv.getInt32(c, true);
      if ([1, 11, 21].includes(st)) {
        const x = dv.getFloat64(c + 4, true), y = dv.getFloat64(c + 12, true);
        out.push({bbox: [x, y, x, y], rings: [[[x, y]]], props: rows[idx] || {}});
        continue;
      }
      if (![3, 5, 13, 15, 23, 25].includes(st)) continue;
      const bbox = [dv.getFloat64(c + 4, true), dv.getFloat64(c + 12, true), dv.getFloat64(c + 20, true), dv.getFloat64(c + 28, true)];
      const np = dv.getInt32(c + 36, true), nn = dv.getInt32(c + 40, true);
      const parts = []; for (let i = 0; i < np; i++) parts.push(dv.getInt32(c + 44 + 4 * i, true));
      const xs = c + 44 + 4 * np, rings = [];
      for (let i = 0; i < np; i++) {
        const a = parts[i], b = i + 1 < np ? parts[i + 1] : nn, ring = [];
        for (let k = a; k < b; k++) ring.push([dv.getFloat64(xs + 16 * k, true), dv.getFloat64(xs + 16 * k + 8, true)]);
        rings.push(ring);
      }
      out.push({bbox, rings, props: rows[idx] || {}});
    }
    return out;
  }
  async function unzip(buf) {             // {name: ArrayBuffer} for .shp and .dbf members
    const dv = new DataView(buf), u8 = new Uint8Array(buf), out = {};
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("zip 파일이 아닙니다");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    for (let k = 0; k < count; k++) {
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + elen + clen;
      if (!/\.(shp|dbf)$/i.test(name)) continue;
      const ln = dv.getUint16(off + 26, true), le = dv.getUint16(off + 28, true);
      const data = u8.subarray(off + 30 + ln + le, off + 30 + ln + le + csize);
      let ab;
      if (method === 0) ab = data.slice().buffer;
      else if (method === 8) ab = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer();
      else throw new Error("지원하지 않는 압축 방식");
      out[name.toLowerCase().endsWith(".shp") ? "shp" : "dbf"] = ab;
    }
    if (!out.shp) throw new Error("zip 안에 .shp 파일이 없습니다");
    return out;
  }
  const NE_NAMES = {land: "ne_10m_land", islands: "ne_10m_minor_islands", lakes: "ne_10m_lakes",
                    rivers: "ne_10m_rivers_lake_centerlines", peaks: "ne_10m_geography_regions_elevation_points"};
  function layerOf(fileName) {
    const f = fileName.toLowerCase();
    if (f.includes("minor_islands")) return "islands";
    if (f.includes("lakes") && !f.includes("centerline")) return "lakes";
    if (f.includes("river")) return "rivers";
    if (f.includes("elevation") || f.includes("peak")) return "peaks";
    if (f.includes("land")) return "land";
    return null;
  }
  async function shapesFromFile(file) {
    const buf = await file.arrayBuffer();
    if (/\.zip$/i.test(file.name)) { const z = await unzip(buf); return shapesFromShp(z.shp, z.dbf); }
    if (/\.shp$/i.test(file.name)) return shapesFromShp(buf, null);
    return shapesFromGeoJSON(JSON.parse(new TextDecoder().decode(buf)));
  }
  // compact form for the browser cache: each ring a Float64Array (fast to store and load)
  const pack = shapes => shapes.map(sh => ({bbox: sh.bbox, flat: sh.rings.map(r => Float64Array.from(r.flat())),
    props: sh.props && Object.keys(sh.props).length ? {featurecla: sh.props.featurecla, elevation: sh.props.elevation, elev: sh.props.elev, name: sh.props.name} : undefined}));
  const NE_URLS = name => [`https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/${name}.geojson`,
                           `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/${name}.geojson`];
  // a layer kept in this browser (downloaded or picked from a file earlier), else downloaded now
  async function neLayer(layer, log, download = true) {
    const ck = "ne2:" + layer, hit = await cacheGet(ck);
    if (hit) return hit;
    if (!download) return null;
    let last = null;
    for (const url of NE_URLS(NE_NAMES[layer])) {
      try {
        log(`지도 데이터 받는 중: ${NE_NAMES[layer]} …`);
        const r = await fetch(url);
        if (!r.ok) throw new Error("HTTP " + r.status);
        const shapes = pack(shapesFromGeoJSON(await r.json()));
        await cacheSet(ck, shapes);
        return shapes;
      } catch (e) { last = e; }
    }
    throw new Error(`지도 데이터를 받지 못했습니다 (${NE_NAMES[layer]}): ${last && last.message}\n` +
      `데스크톱 프로그램이 받아 둔 zip(사용자 폴더\\.route_studio\\natural_earth)을 '파일에서…'로 골라도 됩니다.`);
  }
  async function neStoreFiles(files, log) {
    const got = {};
    for (const f of files) {
      const layer = layerOf(f.name);
      if (!layer) continue;
      log(`읽는 중: ${f.name}`);
      (got[layer] = got[layer] || []).push(...pack(await shapesFromFile(f)));
    }
    for (const [k, v] of Object.entries(got)) await cacheSet("ne2:" + k, v);
    return got;
  }

  Object.assign(RS, {cacheGet, cacheSet, cacheKeys, resolve, fetchRoute, roadPath, parseLink, piecesFromStops, nominatim,
    neLayer, neStoreFiles, layerOf, shapesFromFile, havKm, decodePolyline});
})(RS);
