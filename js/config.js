/* ===========================================================
   BUSAN FASHION WEEK — shared config layer
   Single source of truth for editable content.
   Stored in localStorage so the admin page and the public
   site share the same data on one origin.
   =========================================================== */
(function (global) {
  "use strict";

  var KEY = "bfw_config_v1";
  var SUBS_KEY = "bfw_submissions_v1";
  var RESV_KEY = "bfw_reservations_v1";

  /* -----------------------------------------------------------
     BACKEND KEYS — go-live switch.
     Fill these in to connect the real Supabase backend (see
     SUPABASE_SETUP.md). Kept OUT of the editable config object
     on purpose, so an admin "save" can never wipe them.
     Leave blank => the site runs in local/demo mode
     (reservations live only in this browser's storage).
  ----------------------------------------------------------- */
  var SUPABASE = {
    url: "",        // e.g. "https://abcd1234.supabase.co"
    anonKey: ""     // the public anon key (safe to ship in the browser)
  };

  /* ---- default content (mirrors the original markup) ---- */
  var DEFAULTS = {
    brand: {
      logo: null,            // dataURL when uploaded; null = text fallback
      textPrimary: "BUSAN",
      textSecondary: "FW",
      nameKo: "부산패션위크"
    },

    event: {
      year: "2026",
      venue: "@BEXCO",
      dateLine: "10. 29. — 10. 31.",
      dateFull: "2026.10.29 (목) — 10.31 (토)"
    },

    /* per-section: enabled + offMode ("coming" | "hidden") */
    sections: {
      story:      { enabled: true, offMode: "coming", label: "About" },
      schedule:   { enabled: true, offMode: "coming", label: "Schedule" },
      lastyear:   { enabled: true, offMode: "hidden", label: "2025 Lineup" },
      brands:     { enabled: false, offMode: "hidden", label: "Designer Brands" },
      university: { enabled: false, offMode: "hidden", label: "University Show" },
      ir:         { enabled: false, offMode: "hidden", label: "Invest Connect" },
      media:      { enabled: false, offMode: "hidden", label: "On Film" },
      archive:    { enabled: false, offMode: "hidden", label: "Archive" },
      instagram:  { enabled: false, offMode: "hidden", label: "Instagram" },
      visit:      { enabled: true, offMode: "coming", label: "Visit & Register" }
    },

    /* On Film / media */
    media: {
      mode: "youtube",                 // "youtube" | "video" | "live"
      url: "",                         // youtube id OR full url OR mp4 (empty => 준비중)
      title: "2026 부산패션위크 · Official Highlight Film",
      live: false,                     // marks the source as a live stream
      poster: null                     // optional thumbnail dataURL
    },

    /* Press / news coverage — cards under the Media section.
       Auto mode pulls from the Naver News API via a small proxy (see PRESS_SETUP.md).
       Manual entries always show; auto results are merged in when configured. */
    press: {
      auto: false,                     // true => fetch from proxyUrl
      proxyUrl: "",                    // your serverless endpoint, e.g. "/api/news"
      query: "부산패션위크",            // search keyword
      count: 6,
      items: []                        // manual: [{title, source, date, link, image}]
    },

    /* Archive entries — feed both the index preview and archive.html.
       Empty by default; add real past events in the admin console. */
    archive: [],

    /* Instagram */
    instagram: {
      handle: "btfa_bfw",
      profileUrl: "https://www.instagram.com/btfa_bfw/",
      token: "",                       // IG Basic Display long-lived token (optional)
      userId: "",                      // IG user id for Graph API (optional)
      count: 6,
      posts: []                        // manual fallback: [{image, link, caption}]
    },

    /* Naver map (오시는 길) */
    map: {
      naverClientId: "3rq3r6poqp",     // NAVER Cloud Maps client id (ncpKeyId)
      lat: 35.16871,
      lng: 129.1339,
      zoom: 16,
      address: "벡스코(BEXCO) 제1전시장 3B홀",
      addressEn: "BEXCO Exhibition Hall 1, 3B · Busan"
    },

    /* Registration (legacy participate form — kept for back-compat) */
    register: {
      open: true,
      externalUrl: "",                 // if set, CTA links here instead of the built-in form
      deadline: "2026.10.10",
      note: "참가 신청은 심사 후 개별 안내됩니다."
    },

    /* Audience reservation — per-show, first-come-first-served */
    reserve: {
      published: false,                // false => hide entry points on the main site (launch later)
      open: true,                      // false => register page shows "마감" note
      note: "전 좌석 무료 · 1인 1석 · 선착순 마감. 예약 후 발급되는 QR을 현장에서 제시하세요.",
      defaultCap: 300
    },

    /* Participating designer brands — logo wall. Empty until recruitment;
       add brands (with logos) in the admin console. */
    brands: [],

    /* Last year's (2025) participating lineup — split BRAND / UNIVERSITY (archive). */
    lastYear: {
      year: "2025",
      brands: [
        { name: "ERNESTO ABRAM", country: "INDONESIA", logo: "images/ly-ernesto-abram.png", link: "" },
        { name: "HARTONO GAN", country: "INDONESIA", logo: "images/ly-hartono-gan.png", dark: true, link: "" },
        { name: "Jérôme Blin", country: "FRANCE", logo: "images/ly-jerome-blin.png", link: "" },
        { name: "LAKON", country: "INDONESIA", logo: "images/ly-lakon.png", link: "" },
        { name: "강정석", logo: "images/ly-kangjungseok.png", link: "" },
        { name: "리온베", logo: "images/ly-reonve.png", fill: true, link: "" },
        { name: "마르즈", logo: "images/ly-marze.png", link: "" },
        { name: "바주요", logo: "images/ly-bajuyo.png", link: "" },
        { name: "박상조", logo: "images/ly-parksangjo.png", link: "" },
        { name: "부띠끄걸 × 경상국립대", logo: "images/ly-boutiquegirl.png", link: "" },
        { name: "스튜디오 디 뻬를라", logo: "images/ly-diperla.png", link: "" },
        { name: "신시얼리준", logo: "images/ly-sincerelyjune.png", link: "" },
        { name: "아꼬아", logo: "images/ly-accoa.png", link: "" },
        { name: "일로제", logo: "images/ly-ilroze.png", link: "" },
        { name: "이미경 뷰띠끄", logo: "images/ly-leemikyung.png", link: "" },
        { name: "이영희 프리젠트", logo: "images/ly-leeyounghee.png", link: "" },
        { name: "제이와이어패럴", logo: "images/ly-jyapparel.png", link: "" },
        { name: "PPBSTUDIO", logo: "images/ly-ppb.png", link: "" },
        { name: "13프로젝트", logo: "images/ly-13project.png", link: "" }
      ],
      universities: [
        { name: "경성대학교", country: "패션디자인학과", logo: "images/ly-uni-kyungsung.png", link: "" },
        { name: "동명대학교", country: "패션디자인학과", logo: "images/ly-uni-tongmyong.png", link: "" },
        { name: "동서대학교", country: "패션디자인학과", logo: "images/ly-uni-dongseo.png", link: "" },
        { name: "동아대학교", country: "패션디자인학과", logo: "images/ly-uni-donga.png", link: "" },
        { name: "동의대학교", country: "패션디자인학과", logo: "images/ly-uni-dongeui.png", link: "" },
        { name: "국립부경대학교", country: "패션디자인학과", logo: "images/ly-uni-pukyong.png", link: "" },
        { name: "부산대학교", country: "의류학과", logo: "images/ly-uni-pusan.png", link: "" },
        { name: "신라대학교", country: "디자인학부 패션디자인전공", logo: "images/ly-uni-silla.png", link: "" },
        { name: "영산대학교", country: "패션디자인학과", logo: "images/ly-uni-youngsan.png", link: "" }
      ]
    },

    /* Participating universities — logo wall. Empty until the open call;
       add schools (with logos) in the admin console. */
    universities: [],

    /* Runway shows — each capped, reservable. Edit freely in admin.
       Times from the official 본행사 타임테이블; lineups TBD until confirmed. */
    shows: [
      { id: "S01", day: 1, date: "2026.10.29", dow: "목", time: "10:00", end: "10:30", title: "Opening Show",       titleKo: "오프닝 패션쇼",     lineup: "개막식 · 전 참여 브랜드 합동", venue: "메인 런웨이", cap: 300, tbd: false },
      { id: "S02", day: 1, date: "2026.10.29", dow: "목", time: "13:00", end: "13:30", title: "Joint Show ①",       titleKo: "연합 패션쇼 ①",    lineup: "라인업 추후 공개",        venue: "메인 런웨이", cap: 300, tbd: true },
      { id: "S03", day: 1, date: "2026.10.29", dow: "목", time: "15:00", end: "15:30", title: "Joint Show ②",       titleKo: "연합 패션쇼 ②",    lineup: "라인업 추후 공개",        venue: "메인 런웨이", cap: 300, tbd: true },
      { id: "S04", day: 2, date: "2026.10.30", dow: "금", time: "11:30", end: "12:00", title: "Joint Show ③",       titleKo: "연합 패션쇼 ③",    lineup: "라인업 추후 공개",        venue: "메인 런웨이", cap: 300, tbd: true },
      { id: "S05", day: 2, date: "2026.10.30", dow: "금", time: "13:00", end: "13:30", title: "Joint Show ④",       titleKo: "연합 패션쇼 ④",    lineup: "라인업 추후 공개",        venue: "메인 런웨이", cap: 300, tbd: true },
      { id: "S07", day: 2, date: "2026.10.30", dow: "금", time: "14:00", end: "15:00", title: "Design Competition", titleKo: "부산패션디자인경진대회&부산콜렉션", lineup: "",            venue: "메인 런웨이", cap: 300, tbd: false },
      { id: "S06", day: 2, date: "2026.10.30", dow: "금", time: "17:00", end: "17:30", title: "Joint Show ⑤",       titleKo: "연합 패션쇼 ⑤",    lineup: "라인업 추후 공개",        venue: "메인 런웨이", cap: 300, tbd: true },
      { id: "S08", day: 3, date: "2026.10.31", dow: "토", time: "11:00", end: "11:30", title: "Joint Show ⑥",       titleKo: "연합 패션쇼 ⑥",    lineup: "라인업 추후 공개",        venue: "메인 런웨이", cap: 300, tbd: true },
      { id: "S09", day: 3, date: "2026.10.31", dow: "토", time: "13:00", end: "13:30", title: "Joint Show ⑦",       titleKo: "연합 패션쇼 ⑦",    lineup: "라인업 추후 공개",        venue: "메인 런웨이", cap: 300, tbd: true },
      { id: "S10", day: 3, date: "2026.10.31", dow: "토", time: "14:30", end: "15:00", title: "Joint Show ⑧",       titleKo: "연합 패션쇼 ⑧",    lineup: "라인업 추후 공개",        venue: "메인 런웨이", cap: 300, tbd: true },
      { id: "S11", day: 3, date: "2026.10.31", dow: "토", time: "16:00", end: "16:30", title: "Joint Show ⑨",       titleKo: "연합 패션쇼 ⑨",    lineup: "라인업 추후 공개",        venue: "메인 런웨이", cap: 300, tbd: true },
      { id: "S12", day: 3, date: "2026.10.31", dow: "토", time: "17:30", end: "18:00", title: "Joint Show ⑩",       titleKo: "연합 패션쇼 ⑩",    lineup: "라인업 추후 공개",                  venue: "메인 런웨이", cap: 300, tbd: true }
    ]
  };

  /* ---- deep merge so new default keys appear for old saved data ---- */
  function isObj(v) { return v && typeof v === "object" && !Array.isArray(v); }
  function merge(base, over) {
    var out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    if (!isObj(over)) return out;
    Object.keys(over).forEach(function (k) {
      if (isObj(base[k]) && isObj(over[k])) out[k] = merge(base[k], over[k]);
      else out[k] = over[k];
    });
    return out;
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function load() {
    try {
      var raw = global.localStorage.getItem(KEY);
      if (!raw) return clone(DEFAULTS);
      return merge(clone(DEFAULTS), JSON.parse(raw));
    } catch (e) {
      return clone(DEFAULTS);
    }
  }

  function save(cfg) {
    try {
      global.localStorage.setItem(KEY, JSON.stringify(cfg));
      return true;
    } catch (e) {
      // most likely quota (large images). surface to caller.
      return e;
    }
  }

  function reset() {
    try { global.localStorage.removeItem(KEY); } catch (e) {}
    return clone(DEFAULTS);
  }

  /* ---- registration submissions ---- */
  function loadSubs() {
    try { return JSON.parse(global.localStorage.getItem(SUBS_KEY)) || []; }
    catch (e) { return []; }
  }
  function addSub(entry) {
    var list = loadSubs();
    entry.id = "S" + Date.now();
    entry.at = new Date().toISOString();
    list.unshift(entry);
    try { global.localStorage.setItem(SUBS_KEY, JSON.stringify(list)); } catch (e) { return e; }
    return entry;
  }
  function saveSubs(list) {
    try { global.localStorage.setItem(SUBS_KEY, JSON.stringify(list)); return true; }
    catch (e) { return e; }
  }

  /* ---- audience reservations (per-show, first-come-first-served) ---- */
  function loadResv() {
    try { return JSON.parse(global.localStorage.getItem(RESV_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveResv(list) {
    try { global.localStorage.setItem(RESV_KEY, JSON.stringify(list)); return true; }
    catch (e) { return e; }
  }
  function normCode(code) {
    return String(code == null ? "" : code).trim().toUpperCase()
      .replace(/\s+/g, "").replace(/^BFW-?/, "");
  }
  function activeFor(list, showId) {
    return list.filter(function (r) { return r.showId === showId && r.status !== "cancelled"; });
  }
  // count of valid (non-cancelled) reservations for a show
  function reservedCount(showId) { return activeFor(loadResv(), showId).length; }
  // does this phone already hold a seat for this show?
  function hasReservation(showId, phone) {
    return activeFor(loadResv(), showId).some(function (r) { return r.phone === phone; });
  }
  function makeCode(showId, list) {
    var stub = String(showId).toUpperCase().replace(/[^A-Z0-9]/g, "");
    var alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no confusable chars
    for (var attempt = 0; attempt < 60; attempt++) {
      var s = "";
      for (var i = 0; i < 4; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
      var code = stub + "-" + s;
      if (!list.some(function (r) { return r.code === code; })) return code;
    }
    return stub + "-" + Date.now().toString(36).toUpperCase();
  }
  // attempt a reservation. returns {ok:true, entry} or {ok:false, reason:'full'|'dup'}
  function addResv(entry, cap) {
    var list = loadResv();
    var active = activeFor(list, entry.showId);
    if (cap && active.length >= cap) return { ok: false, reason: "full" };
    if (active.some(function (r) { return r.phone === entry.phone; })) return { ok: false, reason: "dup" };
    entry.id = "R" + Date.now() + Math.random().toString(36).slice(2, 6);
    entry.code = makeCode(entry.showId, list);
    entry.status = "reserved";
    entry.checkedIn = false;
    entry.checkedInAt = null;
    entry.at = new Date().toISOString();
    list.unshift(entry);
    var res = saveResv(list);
    if (res !== true) return { ok: false, reason: "storage", error: res };
    return { ok: true, entry: entry };
  }
  function findByCode(code) {
    var norm = normCode(code);
    if (!norm) return null;
    return loadResv().find(function (r) { return r.code === norm && r.status !== "cancelled"; }) || null;
  }
  function findByPhone(phone) {
    phone = String(phone || "").trim();
    return loadResv().filter(function (r) { return r.phone === phone && r.status !== "cancelled"; });
  }
  // mark a reservation as entered. {ok:true,entry} | {ok:false,reason:'notfound'|'already',entry?}
  function checkIn(code) {
    var list = loadResv();
    var norm = normCode(code);
    var r = list.find(function (x) { return x.code === norm && x.status !== "cancelled"; });
    if (!r) return { ok: false, reason: "notfound" };
    if (r.checkedIn) return { ok: false, reason: "already", entry: r };
    r.checkedIn = true;
    r.checkedInAt = new Date().toISOString();
    saveResv(list);
    return { ok: true, entry: r };
  }
  function undoCheckIn(id) {
    var list = loadResv();
    var r = list.find(function (x) { return x.id === id; });
    if (r) { r.checkedIn = false; r.checkedInAt = null; saveResv(list); }
    return r;
  }
  function cancelResv(id) {
    var list = loadResv();
    var r = list.find(function (x) { return x.id === id; });
    if (r) { r.status = "cancelled"; saveResv(list); }
    return r;
  }

  global.BFW = {
    KEY: KEY,
    SUPABASE: SUPABASE,
    hasBackend: function () { return !!(SUPABASE.url && SUPABASE.anonKey); },
    DEFAULTS: DEFAULTS,
    clone: clone,
    load: load,
    save: save,
    reset: reset,
    loadSubs: loadSubs,
    addSub: addSub,
    saveSubs: saveSubs,
    /* reservations */
    loadResv: loadResv,
    saveResv: saveResv,
    reservedCount: reservedCount,
    hasReservation: hasReservation,
    addResv: addResv,
    findByCode: findByCode,
    findByPhone: findByPhone,
    checkIn: checkIn,
    undoCheckIn: undoCheckIn,
    cancelResv: cancelResv,
    normCode: normCode
  };
})(window);
