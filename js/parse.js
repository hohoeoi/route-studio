// ---------------------------------------------------------------- route text parsing
// Port of gmaps_link.py / maps_api.py (text part).  Same rules as the desktop program.
const RS = (typeof window !== "undefined" ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));

(function (RS) {
  const NB = "(?![A-Za-z])";   // JS \b is ASCII-only, so '시간\b' would never match - use this instead
  const TIME = /^(오전|오후|AM|PM|午前|午後)?\s*(\d{1,2}):(\d{2})\s*(AM|PM)?$/i;
  const PLATFORM = new RegExp("^(승강장|乗り場|のりば|Platform|Track)" + NB, "i");
  const FARE = /^(?:요금|運賃|Fare|Price)\s*[:：]?\s*(.+)$/i;
  const MONEY = /^(?:[A-Z]{0,3}\s*[¥￥₩$€£]|[A-Z]{3}\s)\s*\d[\d,.\s]*\d?\s*$/;
  const DUR = new RegExp("^(?:(\\d+)\\s*(?:시간|時間|hr|h)" + NB + ")?\\s*(?:(\\d+)\\s*(?:분|分|min))?", "i");
  const WALK = ["도보", "걷기", "徒歩", "Walk", "Walking"];
  const VEHICLE_HINT = [
    ["shinkansen", ["신칸센", "新幹線", "Shinkansen"]],
    ["subway", ["지하철", "메트로", "地下鉄", "Subway", "Metro", "Line"]],
    ["bus", ["버스", "バス", "Bus"]],
    ["ferry", ["페리", "フェリー", "Ferry", "배편"]],
    ["train", ["신칸센", "新幹線", "본선", "本線", "선", "線", "특급", "急行", "JR", "Express", "Train"]]];
  const SPACE_BEFORE = ["보통", "쾌속", "신쾌속", "특별쾌속", "특급", "급행", "준급", "각역정차",
    "노조미", "히카리", "고다마", "사쿠라", "미즈호"];
  // Google Maps prints a vehicle badge in front of the line name ("기차", "KTX", ...).
  // In Korean it labels every high-speed train "KTX", even a Shinkansen.
  const BADGE = [
    ["shinkansen", ["KTX", "고속철도", "고속열차", "High-speed"]],
    ["subway", ["지하철", "메트로", "地下鉄", "Subway", "Metro"]],
    ["bus", ["버스", "バス", "Bus"]],
    ["ferry", ["페리", "선박", "フェリー", "Ferry"]],
    ["train", ["기차", "열차", "전철", "트램", "경전철", "電車", "列車", "Train", "Tram"]]];
  const KIND_WORDS = {
    shinkansen: ["신칸센", "新幹線", "shinkansen", "bullet train"],
    train: ["열차", "기차", "전철", "철도", "電車", "列車", "train", "rail"],
    subway: ["지하철", "地下鉄", "subway", "metro"],
    bus: ["버스", "バス", "bus"],
    walk: ["도보", "걷기", "徒歩", "walk"],
    car: ["자동차", "차", "택시", "車", "car", "drive", "taxi"],
    ferry: ["배", "페리", "フェリー", "ferry", "boat"]};
  const LANGS = ["ko", "ja", "en"];
  const VEHICLE_WORD = {
    ko: {train: "열차", subway: "지하철", bus: "버스", walk: "도보", car: "자동차", ferry: "배", shinkansen: "신칸센"},
    ja: {train: "電車", subway: "地下鉄", bus: "バス", walk: "徒歩", car: "車", ferry: "フェリー", shinkansen: "新幹線"},
    en: {train: "Train", subway: "Subway", bus: "Bus", walk: "Walk", car: "Drive", ferry: "Ferry", shinkansen: "Shinkansen"}};
  const ICONS = /[-�​-‏]/g;
  const WORD = /[0-9A-Za-z぀-ヿ㐀-鿿가-힯]/g;

  class RouteError extends Error {}

  const startsWithAny = (s, arr) => arr.some(w => s.startsWith(w));
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function stripChars(s, chars) {
    let a = 0, b = s.length;
    while (a < b && chars.includes(s[a])) a++;
    while (b > a && chars.includes(s[b - 1])) b--;
    return s.slice(a, b);
  }

  function clock(m) {
    let h = +m[2]; const mi = +m[3];
    const tag = (m[1] || m[4] || "").toUpperCase();
    if (["오후", "PM", "午後"].includes(tag) && h < 12) h += 12;
    if (["오전", "AM", "午前"].includes(tag) && h === 12) h = 0;
    return h * 60 + mi;
  }
  function minutesOf(line) {
    let h = null, m = null;
    const d = DUR.exec(line.trim());
    if (d) { h = d[1]; m = d[2]; }
    if (!h && !m) {
      const mm = /(?:(\d+)\s*(?:시간|時間|h))?\s*(?:(\d+)\s*(?:분|分|min))/.exec(line);
      if (mm) { h = mm[1]; m = mm[2]; }
    }
    if (!h && !m) return null;
    return (+(h || 0)) * 60 + (+(m || 0));
  }
  const isDuration = l => /^(약\s*|About\s*)?\d+\s*(분|分|min|시간|時間|h)/i.test(l.trim());
  function isAddress(l) {
    const s = l.trim();
    return /〒|\d{3}[-−–]\d{4}|,\s*[\p{L}\p{N}_]+,/u.test(s) || startsWithAny(s, ["일본", "日本", "대한민국"]);
  }
  function splitBadge(t) {
    t = t.trim();
    for (const [kind, words] of BADGE) for (const w of words) {
      if (t.toLowerCase().startsWith(w.toLowerCase()) && t.length > w.length)
        return [kind, stripChars(t.slice(w.length), " ·-–—:")];
      if (t.toLowerCase() === w.toLowerCase()) return [kind, ""];
    }
    return [null, t];
  }
  const words = t => (t.match(WORD) || []).length;
  function kindOf(text) {
    for (const [kind, ws] of VEHICLE_HINT) if (ws.some(w => text.toLowerCase().includes(w.toLowerCase()))) return kind;
    return "train";
  }
  function tidy(text) {
    let out = text.replace(ICONS, " ");
    for (const w of SPACE_BEFORE) {
      out = out.replace(new RegExp("(?<=[^\\s])" + esc(w), "g"), " " + w);
      out = out.replace(new RegExp(esc(w) + "(?=[^\\s\\d])", "g"), w + " ");
    }
    out = out.replace(/([가-힯]{2,})\1/g, "$1");
    let toks = out.split(/\s+/).filter(Boolean);
    for (let i = 2; i < toks.length; i++) if (toks.slice(0, i).includes(toks[i])) { toks = toks.slice(0, i); break; }
    return toks.join(" ");
  }
  const norm = n => n.replace(/[\s역駅]|Station/gi, "").toLowerCase();

  function parseItinerary(text, dropWalks = true) {
    let lines = text.replace(/ /g, " ").split("\n").map(l => l.trim()).filter(Boolean);
    const seq = []; let fare = null; const clk = []; let cand = [];
    let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      const fm = FARE.exec(l);
      if (fm && MONEY.test(fm[1].trim())) { fare = fare || fm[1].trim(); i++; continue; }
      if (MONEY.test(l)) { fare = fare || l.trim(); i++; continue; }
      const tm = TIME.exec(l);
      if (tm) {
        clk.push(clock(tm));
        let j = i + 1;
        while (j < lines.length && (PLATFORM.test(lines[j]) || isAddress(lines[j]) || TIME.test(lines[j]))) j++;
        if (j < lines.length) { seq.push(["stop", lines[j]]); cand = []; i = j + 1; continue; }
        break;
      }
      if (isDuration(l)) {
        if (cand.length) {
          const walk = cand.some(c => startsWithAny(c, WALK));
          let badge = null; const names = [];
          for (const c of cand) {
            const [k, rest] = splitBadge(c);
            badge = badge || k;
            if (rest) names.push(rest);
          }
          let real = names.filter(c => words(c) >= 2);
          if (!real.length) real = names.length ? names : cand;
          const name = real.reduce((a, b) => (words(b) > words(a) ? b : a));
          const kind = walk ? "walk" : (badge || kindOf(name));
          const prev = seq[seq.length - 1];
          // "열차에 계속 탑승" (stay on the train): Google splits one ride into two legs with no stop between - join them
          if (prev && prev[0] === "leg" && kind !== "walk" && prev[1] !== "walk") prev[3] += minutesOf(l) || 1;
          else seq.push(["leg", kind, walk ? "도보" : tidy(name), minutesOf(l) || 1]);
          cand = [];
        }
        i++; continue;
      }
      if (PLATFORM.test(l) || isAddress(l) || startsWithAny(l, ["정거장 ID", "Stop ID", "정류장", "停留所"])) { i++; continue; }
      // service notices ("기노쿠니선: 지연", "난키 선: 안전 확인 지연") and "stay on the train" lines are not line names
      if (/[:：].*(지연|운휴|운행|遅延|運休|見合わせ|delay|suspend)/i.test(l) || /^(열차에 계속 탑승|そのまま乗車|Stay on)/i.test(l)) { i++; continue; }
      if (words(l) || startsWithAny(l, WALK)) cand.push(l.trim());
      i++;
    }
    let out = [];
    for (const it of seq) {
      if (it[0] === "stop" && out.length && out[out.length - 1][0] === "stop" && norm(out[out.length - 1][1]) === norm(it[1])) continue;
      out.push(it);
    }
    while (out.length && out[0][0] !== "stop") out.shift();
    while (out.length && out[out.length - 1][0] !== "stop") out.pop();
    if (dropWalks) {
      let changed = true;
      while (changed) {
        changed = false;
        for (let k = 0; k < out.length; k++) {
          const it = out[k];
          if (it[0] !== "leg") continue;
          if (it[1] !== "walk" && norm(out[k - 1][1]) !== norm(out[k + 1][1])) continue;
          const last = !out.slice(k + 1).some(x => x[0] === "leg");
          if (norm(out[k - 1][1]) === norm(out[k + 1][1]) || !last) out.splice(k, 2);
          else out.splice(k - 1, 2);
          changed = true; break;
        }
      }
    }
    const stops = out.filter(x => x[0] === "stop").map(x => x[1]);
    const legs = out.filter(x => x[0] === "leg").map(x => ({kind: x[1], line: x[2], min: x[3]}));
    if (stops.length < 2 || legs.length !== stops.length - 1)
      throw new RouteError(`경로 텍스트를 해석하지 못했습니다 (지점 ${stops.length}개, 구간 ${legs.length}개).\nGoogle 지도의 경로 패널 전체를 복사했는지 확인해 주세요.`);
    let total = null;
    if (clk.length >= 2) { total = clk[clk.length - 1] - clk[0]; if (total < 0) total += 1440; }
    return {stops, legs, fare, total_min: total};
  }

  function regionOf(text) {
    for (const w of ["일본", "日本", "Japan"]) if (text.includes(w)) return "일본";
    for (const w of ["대한민국", "한국", "Korea"]) if (text.includes(w)) return "대한민국";
    return "";
  }
  function looksLikeItinerary(text) {
    const lines = text.replace(/ /g, " ").split("\n").map(l => l.trim()).filter(Boolean);
    if (!lines.length) return false;
    if (lines.filter(l => l.includes("|")).length >= Math.max(1, Math.floor(lines.length / 2))) return false;
    const times = lines.filter(l => TIME.test(l)).length;
    const marks = lines.filter(l => PLATFORM.test(l) || FARE.test(l) || l.includes("정거장 ID") || l.includes("Stop ID") || startsWithAny(l, WALK)).length;
    return times >= 2 || (times >= 1 && marks >= 2) || marks >= 3;
  }
  function itineraryToText(p, region = "") {
    const w = {walk: "도보", train: "열차", subway: "지하철", bus: "버스", ferry: "배", shinkansen: "신칸센"};
    const rows = [], head = [];
    if (p.total_min) head.push(`전체 ${p.total_min}분`);
    if (p.fare) head.push(`요금 ${p.fare}`);
    if (head.length) rows.push("# " + head.join(" · "));
    p.stops.forEach((name, i) => {
      const q = `${name} ${region}`.trim();
      if (i < p.legs.length) {
        const lg = p.legs[i];
        rows.push(`${q} = ${name} / ${name} / ${name} | ${w[lg.kind] || "열차"} | ${lg.line} | ${lg.min}`);
      } else rows.push(`${q} = ${name} / ${name} / ${name}`);
    });
    return rows.join("\n");
  }
  const fmtG = x => String(+x.toFixed(6));
  function tidyRows(text) {
    const all = text.split("\n").map(l => l.trim()).filter(Boolean);
    const head = all.filter(l => l.startsWith("#"));
    const rows = all.filter(l => !l.startsWith("#"));
    const items = rows.map(r => {
      const parts = r.split("|").map(p => p.trim());
      const name = parts[0];
      const short = name.includes("=") ? name.split("=").slice(1).join("=").split("/")[0].trim() : name.split("@")[0].trim();
      let leg = null;
      if (parts.length >= 4) {
        const mins = parts[3].replace(/[^\d.]/g, "") || "0";
        const [badge, line] = splitBadge(parts[2]);
        let mode = parts[1];
        if (badge && ["열차", "기차", "train"].includes(mode.trim()))
          mode = {shinkansen: "신칸센", subway: "지하철", bus: "버스", ferry: "배", train: "열차"}[badge];
        leg = {mode, line: line || parts[2], min: parseFloat(mins)};
      }
      return {row: name, short, leg};
    });
    const before = items.length, out = [];
    for (const it of items) {
      const last = out[out.length - 1];
      if (last && !last.leg && norm(last.short) === norm(it.short)) { out[out.length - 1] = it; continue; }
      if (last && last.leg && norm(last.short) === norm(it.short)) { out[out.length - 1] = {row: last.row, short: last.short, leg: it.leg}; continue; }
      if (last && last.leg && WALK.includes(last.leg.mode.trim())) {
        const lastRow = !it.leg;
        if (norm(last.short) === norm(it.short) || !lastRow) { out[out.length - 1] = {row: last.row, short: last.short, leg: it.leg}; continue; }
        out.pop();
      }
      out.push(it);
    }
    while (out.length && out[out.length - 1].leg) { const l = out[out.length - 1]; out[out.length - 1] = {row: l.row, short: l.short, leg: null}; }
    const lines = out.map(it => it.leg ? `${it.row} | ${it.leg.mode} | ${it.leg.line} | ${fmtG(it.leg.min)}` : it.row);
    return [head.concat(lines).join("\n"), before - out.length];
  }

  function kindWord(word) {
    const w = word.trim().toLowerCase();
    for (const [k, ws] of Object.entries(KIND_WORDS)) if (ws.some(x => w === x.toLowerCase())) return k;
    return "train";
  }
  function parseStop(field) {
    let names = null;
    if (field.includes("=")) {
      const at = field.indexOf("=");
      const n = field.slice(at + 1); field = field.slice(0, at);
      const parts = n.split("/").map(p => p.trim());
      while (parts.length < 3) parts.push("");
      const [ko, ja, en] = parts;
      const fb = en || ko || ja || field.trim();
      names = {ko: ko || fb, ja: ja || fb, en: en || fb};
    }
    let ll = null;
    if (field.includes("@")) {
      const at = field.indexOf("@");
      const c = field.slice(at + 1); field = field.slice(0, at);
      const [a, b] = c.replace(/\s/g, "").split(",").map(Number);
      if (isFinite(a) && isFinite(b)) ll = [a, b];
    }
    return [field.trim(), ll, names];
  }
  function fmtMin(m, lang) {
    m = Math.max(1, Math.round(m));
    const h = Math.floor(m / 60), r = m % 60;
    if (!h) return lang === "ko" ? `${r}분` : lang === "ja" ? `${r}分` : `${r} min`;
    if (!r) return lang === "ko" ? `${h}시간` : lang === "ja" ? `${h}時間` : `${h} h`;
    return lang === "ko" ? `${h}시간 ${r}분` : lang === "ja" ? `${h}時間${r}分` : `${h} h ${r} min`;
  }

  // Text -> rows ready for geocoding.  Same format as the desktop "텍스트로 경로 만들기":
  //   stop = name [@lat,lon] [= 한글 / 日本語 / English] | 수단 | 노선 | 분
  function parseRouteText(text) {
    let headTotal = null, headFare = null;
    for (const l of text.split("\n")) {
      if (l.trim().startsWith("#")) {
        const t = /전체\s*(\d+)\s*분/.exec(l), f = /요금\s*(\S.*)$/.exec(l);
        if (t) headTotal = +t[1];
        if (f) headFare = f[1].trim();
      }
    }
    if (looksLikeItinerary(text)) {
      const it = parseItinerary(text);
      headTotal = it.total_min || headTotal;
      headFare = it.fare || headFare;
      text = itineraryToText(it, regionOf(text));
    }
    const rows = text.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
    if (rows.length < 2) throw new RouteError("지점을 2줄 이상 입력해 주세요.");
    const parsed = rows.map((row, i) => {
      const parts = row.split("|").map(p => p.trim());
      const [query, ll, names] = parseStop(parts[0]);
      let leg = null;
      if (i + 1 < rows.length) {
        if (parts.length < 4) throw new RouteError(`${i + 1}번째 줄: '이름 | 수단 | 노선 | 분' 형식이어야 합니다.\n\n  ${row.slice(0, 60)}`);
        const mins = parseFloat(parts[3].replace("분", "").replace("min", "").trim());
        if (!isFinite(mins)) throw new RouteError(`${i + 1}번째 줄: 소요 시간(분)은 숫자여야 합니다.`);
        const [badge, line] = splitBadge(parts[2]);
        let kind = kindWord(parts[1]);
        if (badge && kind === "train") kind = badge;
        leg = {kind, line: line || parts[2], min: mins};
      }
      return {query, ll, names, leg};
    });
    return {rows: parsed, headTotal, headFare};
  }

  function assignSides(stations) {
    stations.forEach((s, i) => {
      const prev = stations[i - 1] || s, nxt = stations[i + 1] || s;
      const dy = (nxt.lat - prev.lat) * 110.6;
      const dx = (nxt.lon - prev.lon) * 111.32 * Math.cos(s.lat * Math.PI / 180);
      s.side = Math.abs(dy) >= Math.abs(dx) * 0.8 ? (i % 2 === 0 ? "R" : "L") : (i % 2 === 0 ? "T" : "B");
    });
  }

  // rows with coordinates (and optional ground paths) -> project
  function buildProject(p, coords, paths, targetSeconds = 16) {
    const {rows, headTotal, headFare} = p;
    const stations = rows.map((r, i) => {
      const nm = r.names || {ko: r.query, ja: r.query, en: r.query};
      return {id: "s" + i, ko: nm.ko, ja: nm.ja, en: nm.en, lat: coords[i][0], lon: coords[i][1], side: "R",
              big: i === 0 || i === rows.length - 1};
    });
    const segments = [];
    rows.forEach((r, i) => {
      if (!r.leg) return;
      const {kind, line, min} = r.leg;
      const seg = {from: "s" + i, to: "s" + (i + 1), vehicle: kind, color: kind, bulge: i % 2 === 0 ? 0.08 : -0.08,
                   title: {}, minutes: Math.round(min * 10) / 10};
      seg.sub = {};
      for (const l of LANGS) { seg.title[l] = line || VEHICLE_WORD[l][kind]; seg.sub[l] = `${VEHICLE_WORD[l][kind]} · ${fmtMin(min, l)}`; }
      if (paths && paths[i] && paths[i].length >= 2 && kind !== "ferry") seg.path = paths[i];
      segments.push(seg);
    });
    assignSides(stations);
    const w = segments.map(s => Math.pow(Math.max(s.minutes, 3), 0.6));
    const sw = w.reduce((a, b) => a + b, 0);
    segments.forEach((s, i) => s.travel_s = Math.round(Math.max(0.9, targetSeconds * w[i] / sw) * 100) / 100);
    const ride = segments.reduce((a, s) => a + s.minutes, 0);
    const total = headTotal || ride;
    const summary = {};
    for (const l of LANGS) {
      summary[l] = [`${stations[0][l]} → ${stations[stations.length - 1][l]}   ${fmtMin(total, l)}`];
      if (headFare) summary[l].push({ko: "요금 ", ja: "運賃 ", en: "Fare "}[l] + headFare);
    }
    return {stations, segments, summary, pauses: {}};
  }

  // tidy a project saved by an older build (gmaps_link.clean_project): vehicle badges stuck to the
  // front of line names, icon glyphs, summary lines added twice.  Returns how many things changed.
  function cleanProject(cfg) {
    let fixed = 0;
    for (const seg of cfg.segments || []) {
      const title = seg.title, isObj = title && typeof title === "object";
      const parts = isObj ? title : {ko: title || "", ja: title || "", en: title || ""};
      let badge = null;
      for (const [lang, txt] of Object.entries(parts)) {
        if (typeof txt !== "string") continue;
        const [k, rest0] = splitBadge(txt);
        const rest = (rest0 || txt).replace(ICONS, " ").split(/\s+/).filter(Boolean).join(" ");
        badge = badge || k;
        if (rest !== txt) { parts[lang] = rest; fixed++; }
      }
      if (isObj) seg.title = parts; else if (badge || fixed) seg.title = parts.ko;
      if (badge && [undefined, null, "train"].includes(seg.vehicle)) {
        seg.vehicle = badge;
        if ([undefined, null, "train"].includes(seg.color)) seg.color = badge;
        fixed++;
      }
    }
    const sm = cfg.summary;
    if (sm && typeof sm === "object" && !Array.isArray(sm))
      for (const [lang, lines] of Object.entries(sm)) {
        if (!Array.isArray(lines)) continue;
        const seen = new Set(), out = [];
        for (const ln of lines) { if (seen.has(ln)) { fixed++; continue; } seen.add(ln); out.push(ln); }
        sm[lang] = out;
      }
    return fixed;
  }

  Object.assign(RS, {RouteError, parseItinerary, itineraryToText, regionOf, looksLikeItinerary, tidyRows,
    splitBadge, tidy, parseRouteText, buildProject, fmtMin, VEHICLE_WORD, LANGS, assignSides, cleanProject});
})(RS);
if (typeof module !== "undefined") module.exports = RS;
