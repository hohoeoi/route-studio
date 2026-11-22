// ---------------------------------------------------------------- fonts: Korean / English / Japanese chosen separately
// Korean defaults to Nanum Myeongjo (the same design as the "나눔명조 OTF" package) with the weights that font ships.
// Web fonts come from Google Fonts in slices (unicode-range), so before drawing, the glyphs the project actually uses
// are loaded with document.fonts.load(); a canvas does not wait for them on its own.
(function (RS) {
  const $ = id => document.getElementById(id);
  const W_NAMES = {100: "아주 가늘게", 200: "가늘게 (ExtraLight)", 300: "가늘게 (Light)", 400: "보통 (Regular)", 500: "중간 (Medium)",
    600: "약간 굵게 (SemiBold)", 700: "굵게 (Bold)", 800: "아주 굵게 (ExtraBold)", 900: "가장 굵게 (Black)"};
  const KR = {
    "nanum-myeongjo": {label: "나눔명조 (나눔명조 OTF)", fam: ["Nanum Myeongjo", "NanumMyeongjoOTF", "NanumMyeongjo", "나눔명조"], g: "Nanum+Myeongjo:wght@400;700;800", w: [400, 700, 800]},
    "nanum-gothic": {label: "나눔고딕", fam: ["Nanum Gothic", "NanumGothic", "나눔고딕"], g: "Nanum+Gothic:wght@400;700;800", w: [400, 700, 800]},
    "nanum-square": {label: "나눔스퀘어 (PC에 설치된 경우만)", fam: ["NanumSquare", "NanumSquareOTF", "나눔스퀘어", "NanumSquare_ac"], g: null, w: [300, 400, 700, 800]},
    "noto-sans-kr": {label: "Noto Sans KR (본고딕)", fam: ["Noto Sans KR"], g: "Noto+Sans+KR:wght@300;400;500;700;900", w: [300, 400, 500, 700, 900]},
    "noto-serif-kr": {label: "Noto Serif KR (본명조)", fam: ["Noto Serif KR"], g: "Noto+Serif+KR:wght@400;600;700;900", w: [400, 600, 700, 900]},
    "file": {label: "내 글꼴 파일 (아래 버튼으로 올리기)", fam: [], g: null, w: null},
  };
  const EN = {
    "same": {label: "한글 글꼴과 같게", fam: [], g: null},
    "noto-sans": {label: "Noto Sans", fam: ["Noto Sans"], g: "Noto+Sans:wght@300;400;500;700;800;900"},
    "noto-serif": {label: "Noto Serif", fam: ["Noto Serif"], g: "Noto+Serif:wght@400;600;700;800;900"},
    "montserrat": {label: "Montserrat", fam: ["Montserrat"], g: "Montserrat:wght@300;400;500;700;800;900"},
    "playfair": {label: "Playfair Display", fam: ["Playfair Display"], g: "Playfair+Display:wght@400;600;700;800;900"},
  };
  const JP = {
    "noto-sans-jp": {label: "Noto Sans JP (고딕)", fam: ["Noto Sans JP"], g: "Noto+Sans+JP:wght@300;400;500;700;800;900"},
    "noto-serif-jp": {label: "Noto Serif JP (명조)", fam: ["Noto Serif JP"], g: "Noto+Serif+JP:wght@400;600;700;800;900"},
    "file": {label: "내 글꼴 파일 (아래 버튼으로 올리기)", fam: [], g: null},
  };
  const DEF = {kr: "nanum-myeongjo", bold: 800, normal: 400, en: "same", jp: "noto-sans-jp"};
  const KR_BASE = ["Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans CJK KR", "sans-serif"];
  const JP_BASE = ["Yu Gothic UI", "Yu Gothic", "Meiryo", "Hiragino Sans", "Noto Sans CJK JP"];
  const q = n => /^(serif|sans-serif|monospace)$/.test(n) ? n : `"${n}"`;
  const C = () => (RS.app && RS.app.C && RS.app.C()) || null;
  const conf = cfg => {
    const f = Object.assign({}, DEF, (cfg && cfg.web_fonts) || {});
    if (!KR[f.kr]) f.kr = DEF.kr; if (!EN[f.en]) f.en = DEF.en; if (!JP[f.jp]) f.jp = DEF.jp;
    return f;
  };

  // user = {kr, jp}: family names of fonts uploaded as files (set by the page)
  function stack(lang, f, user = {}) {
    const kr = f.kr === "file" && user.kr ? [user.kr] : KR[f.kr].fam;
    const en = EN[f.en].fam;
    if (lang === "jp") {
      const jp = f.jp === "file" && user.jp ? [user.jp] : JP[f.jp].fam;
      return jp.concat(JP_BASE, en, kr, KR_BASE).map(q).join(", ");
    }
    return en.concat(kr, KR_BASE).map(q).join(", ");
  }
  const weightOf = (f, role) => role === "Bold" ? +f.bold : +f.normal;
  const css = (size, lang, role, cfg, user) => { const f = conf(cfg); return `${weightOf(f, role)} ${size}px ${stack(lang, f, user)}`; };

  // every text on screen goes through Renderer.font(): route the chosen fonts and weights there
  if (RS.Renderer) RS.Renderer.prototype.font = function (size, lang = "kr", weight = "Bold") { return css(size, lang, weight, this.cfg, this.userFonts); };

  // ------------------------------------------------------------ loading the glyphs a project needs
  const linked = new Set();
  function link(g) {
    if (!g || linked.has(g)) return; linked.add(g);
    const l = document.createElement("link"); l.rel = "stylesheet";
    l.href = `https://fonts.googleapis.com/css2?family=${g}&display=swap`;
    document.head.appendChild(l);
  }
  function webFaces(f) {           // [family, google css] actually downloaded from Google Fonts
    const out = [];
    for (const p of [KR[f.kr], EN[f.en], JP[f.jp]]) if (p.g) out.push([p.fam[0], p.g]);
    return out;
  }
  function textOf(cfg, extra = "") {
    const parts = [cfg.stations, cfg.segments, cfg.header, cfg.summary, cfg.disclaimer];
    const s = JSON.stringify(parts) + extra + "0123456789:.-·()~ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz분시간";
    return [...new Set(s)].join("");
  }
  async function ensure(cfg, extra = "") {
    if (!document.fonts || !cfg) return;
    const f = conf(cfg), text = textOf(cfg, extra), jobs = [];
    for (const [fam, g] of webFaces(f)) {
      link(g);
      for (const w of new Set([+f.bold, +f.normal])) jobs.push(document.fonts.load(`${w} 40px "${fam}"`, text).catch(() => []));
    }
    await Promise.all(jobs);
  }
  function ready(cfg, extra = "") {
    if (!document.fonts || !cfg) return true;
    const f = conf(cfg), text = textOf(cfg, extra);
    try { return webFaces(f).every(([fam]) => [...new Set([+f.bold, +f.normal])].every(w => document.fonts.check(`${w} 40px "${fam}"`, text))); }
    catch (e) { return true; }
  }

  // ------------------------------------------------------------ UI (tab 3, 글꼴 card)
  const opts = (sel, table, val) => { sel.innerHTML = Object.entries(table).map(([k, v]) => `<option value="${k}"${k === val ? " selected" : ""}>${v.label}</option>`).join(""); };
  function weightsFor(f) { return KR[f.kr].w || [400, 700]; }
  function nearest(list, w) { return list.reduce((a, b) => Math.abs(b - w) < Math.abs(a - w) ? b : a, list[0]); }
  function fill() {
    const cfg = C(); if (!cfg || !$("fKr")) return;
    const f = conf(cfg), ws = weightsFor(f);
    opts($("fKr"), KR, f.kr); opts($("fEn"), EN, f.en); opts($("fJp"), JP, f.jp);
    for (const [id, cur] of [["fBold", f.bold], ["fNormal", f.normal]]) {
      $(id).innerHTML = ws.map(w => `<option value="${w}"${w === +cur ? " selected" : ""}>${W_NAMES[w] || w}</option>`).join("");
      $(id).disabled = !KR[f.kr].w;
    }
    const kr = KR[f.kr].label.replace(/ \(.*\)$/, ""), en = f.en === "same" ? "한글 글꼴과 같음" : EN[f.en].label;
    $("fontNow").textContent = `지금 설정: 한글 ${f.kr === "file" ? "내 글꼴 파일" : kr} (${W_NAMES[f.bold] || f.bold} / ${W_NAMES[f.normal] || f.normal}) · 영문 ${en} · 일본어 ${JP[f.jp].label.replace(/ \(.*\)$/, "")}` +
      (f.kr === "nanum-square" ? "\n나눔스퀘어는 웹 글꼴이 없어서 이 PC에 설치되어 있어야 보입니다. 없으면 맑은 고딕으로 나옵니다." : "");
  }
  let saveT = 0;
  async function apply(change) {
    const cfg = C(); if (!cfg) return;
    const f = conf(cfg); Object.assign(f, change);
    const ws = weightsFor(f); f.bold = nearest(ws, +f.bold); f.normal = nearest(ws, +f.normal);
    cfg.web_fonts = f;
    fill();
    clearTimeout(saveT); saveT = setTimeout(() => RS.cacheSet && RS.cacheSet("project", cfg), 500);
    await ensure(cfg); sig = signature(); RS.app.rebuildPreview();
  }
  function mount() {
    if (!$("fKr")) return;
    $("fKr").onchange = e => apply({kr: e.target.value});
    $("fEn").onchange = e => apply({en: e.target.value});
    $("fJp").onchange = e => apply({jp: e.target.value});
    $("fBold").onchange = e => apply({bold: +e.target.value});
    $("fNormal").onchange = e => apply({normal: +e.target.value});
    // uploading a file picks it; "기본으로" goes back to the defaults (the page's own handlers keep the file itself)
    $("fontKr").addEventListener("change", e => { if (e.target.files.length) setTimeout(() => apply({kr: "file"}), 400); });
    $("fontJp").addEventListener("change", e => { if (e.target.files.length) setTimeout(() => apply({jp: "file"}), 400); });
    $("fontClear").addEventListener("click", () => setTimeout(() => apply(Object.assign({}, DEF)), 200));
    // export waits until the glyphs are in (a canvas draws a stand-in font otherwise)
    $("exportBtn").addEventListener("click", e => {
      const cfg = C(); if (!cfg || ready(cfg) || $("exportBtn").textContent === "취소") return;
      e.stopImmediatePropagation(); e.preventDefault();
      const st = $("status"); st.textContent = "글꼴을 불러오는 중입니다. 잠시 후 MP4 저장을 다시 눌러 주세요."; st.dataset.kind = "warn";
      ensure(cfg).then(() => { RS.app.rebuildPreview(); st.textContent = "글꼴 준비가 끝났습니다. MP4 저장을 다시 눌러 주세요."; st.dataset.kind = "ok"; });
    }, true);
  }
  // project opened / names edited -> load any new glyphs, then redraw once
  let sig = "";
  const signature = () => { const cfg = C(); return cfg ? JSON.stringify(cfg.web_fonts || {}) + textOf(cfg) : ""; };
  setInterval(async () => {
    const s = signature(); if (!s || s === sig) return;
    const first = !sig; sig = s;
    if (first) fill();
    const cfg = C(); if (!ready(cfg)) { await ensure(cfg); RS.app.rebuildPreview(); }
    fill();
  }, 1000);

  RS.fonts = {css: (size, lang, role) => css(size, lang, role, C(), (RS.app && RS.app.state && RS.app.state.fonts) || {}),
    ensure: (extra = "") => ensure(C(), extra), conf: () => conf(C()), DEF, KR, EN, JP};
  mount();
})(RS);
