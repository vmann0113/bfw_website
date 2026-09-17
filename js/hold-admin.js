/* ===========================================================
   BUSAN FASHION WEEK — 사전 좌석 확보 관리 (hold-admin.html)

   왼쪽에서 조작하고, 오른쪽 세로 지도(실제 홀 모양)에서 좌석을 고른다.

   - 배정 : 참여사가 링크로 고를 수 있는 범위. 한 쇼에 여러 브랜드가 있으면
            협의한 대로 주최측이 좌석을 나눠준다(구역 통째로도, 몇 석씩도).
   - 확보 : 실제로 잡혀 일반 예약에서 빠진 좌석. 참여사가 링크로 하거나,
            개막식 내빈석처럼 주최측이 직접 한다.

   로그인 = Supabase 계정 + 스태프 명단. 서버 함수가 매번 명단을 확인한다.
   메인 사이트 설정(js/config.js)에 기대지 않는다.
   =========================================================== */
(function () {
  "use strict";
  /* ---------- PC 전용 ----------
     좌석 300석을 실제 홀 모양으로 보고 고르는 화면이라 휴대폰·태블릿에서는
     쓰지 않게 한다. 휴대폰/태블릿이거나 창이 너무 좁으면 안내만 띄우고
     아무것도 불러오지 않는다. (iPad 는 데스크톱 행세를 해서 터치로 가려낸다) */
  function isMobileDevice() {
    var ua = navigator.userAgent || "";
    if (/Android|iPhone|iPad|iPod|Mobile|Windows Phone|BlackBerry|Opera Mini|IEMobile/i.test(ua)) return true;
    if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return true;
    return false;
  }
  function pcOnlyNotice() {
    var st = document.createElement("style");
    st.textContent =
      ".pconly{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;" +
      "background:#f6f8fc;font-family:'Pretendard Variable',Pretendard,-apple-system,system-ui,sans-serif;color:#1b2340}" +
      ".pconly .card{max-width:420px;width:100%;background:#fff;border:1px solid #e3e7ef;border-radius:16px;" +
      "padding:32px 24px;text-align:center;box-shadow:0 2px 12px rgba(20,35,90,.06)}" +
      ".pconly .ic{width:56px;height:56px;margin:0 auto 16px;border-radius:14px;background:#eef2ff;display:flex;" +
      "align-items:center;justify-content:center}" +
      ".pconly .eb{font-family:'Space Mono',ui-monospace,monospace;font-size:.7rem;letter-spacing:.12em;color:#0b2e9e}" +
      ".pconly h1{margin:8px 0 10px;font-size:1.25rem;font-weight:800;line-height:1.4}" +
      ".pconly p{margin:0;font-size:.92rem;color:#6b7490;line-height:1.65;word-break:keep-all}" +
      ".pconly .fine{margin-top:18px;padding-top:14px;border-top:1px solid #eef0f4;font-size:.78rem;color:#8a93ad;word-break:keep-all}" +
      ".pconly h1{word-break:keep-all}";
    document.head.appendChild(st);
    document.body.innerHTML =
      '<div class="pconly"><div class="card">' +
      '<div class="ic"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#0b2e9e" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="13" rx="2"/>' +
      '<path d="M8 21h8M12 17v4"/></svg></div>' +
      '<div class="eb">2026 부산패션위크 · 주최측</div>' +
      "<h1>PC화면에서 좌석 관리를 해주세요.</h1>" +
      "<p>좌석 300석을 행사장 모양 그대로 보고 고르는 화면이라 휴대폰·태블릿에서는 이용할 수 없습니다.<br>" +
      "이 관리 화면은 PC에서 열어 주세요.</p>" +
      '<div class="fine">PC에서도 이 안내가 보이면 브라우저 창을 넓힌 뒤 새로고침해 주세요.</div>' +
      "</div></div>";
  }
  if (isMobileDevice() || window.innerWidth < 760) {
    pcOnlyNotice();
    return;
  }


  var SB = {
    url: "https://hjcrzdzrgmubipxcgzce.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqY3J6ZHpyZ211YmlweGNnemNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1MTcwMzEsImV4cCI6MjEwNDA5MzAzMX0.T_61-FVfL0fKkR3IDEO8x30UQGfMWBVL6oQAF5m4tF8"
  };

  var NO_RESERVATION = ["S07"];   // 부산패션디자인경진대회 & 부산컬렉션
  var PALETTE = ["#0b2e9e", "#d9480f", "#0f766e", "#7c3aed", "#c2255c", "#a16207", "#1c7ed6", "#5f3dc4"];
  var STAFF_COLOR = "#3b3f4a";
  var RESERVED_COLOR = "#c9ced9";

  var SESSION_KEY = "bfw_hold_admin_session";
  var session = null;
  var board = null;       // holds_board
  var showId = null;
  var mapData = null;     // holds_show_map
  var map = null;         // HallMap 인스턴스
  var focusId = null;     // 지도에서 강조할 참여사
  var editing = null;     // { holderId|null, name, kind, max }
  var selection = [];
  var selMode = "zone";   // 구역 단위로 시작 → 필요하면 좌석 단위로 바꿔 몇 자리 뺀다

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function when(iso) {
    if (!iso) return "—";
    var d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
    return (d.getUTCMonth() + 1) + "/" + d.getUTCDate() + " " +
      String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0");
  }
  /* 쇼 이름은 홈페이지 스케줄표와 똑같이 쓴다.
     연합쇼는 참여 브랜드·학교 이름이 곧 쇼 이름이다("오교 · 리온베 · 이영희 프리젠트").
     '연합쇼 ④' 같은 번호는 내부용이라 보여주지 않는다.
     참여 칸이 비었거나 '오프닝'인 개막식·경진대회만 행사명을 쓴다. */
  function showName(title, lineup) {
    var lu = String(lineup || "").trim();
    return (!lu || lu === "오프닝") ? String(title || "") : lu;
  }
  var DOW = ["일", "월", "화", "수", "목", "금", "토"];
  /* '2026.10.30' + '10:30' → '10.30(금) 10:30' */
  function showWhen(date, time) {
    var p = String(date || "").split(".");
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return (+p[1]) + "." + (+p[2]) + (isNaN(d) ? "" : "(" + DOW[d.getDay()] + ")") + " " + (time || "");
  }

  function tint(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }
  function toast(msg, isErr) {
    var t = document.createElement("div");
    t.className = "toast" + (isErr ? " err" : "");
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, isErr ? 5600 : 2800);
  }

  /* ================= 로그인 ================= */
  function saveSession(s) {
    session = s;
    try { if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); else sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
  }
  function loadSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch (e) { return null; }
  }
  function fromAuth(d, email) {
    return { access_token: d.access_token, refresh_token: d.refresh_token,
             expires_at: Date.now() + (d.expires_in || 3600) * 1000,
             email: (d.user && d.user.email) || email || "" };
  }
  function authPost(path, body) {
    return fetch(SB.url + "/auth/v1/" + path, {
      method: "POST", headers: { apikey: SB.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); });
  }
  function refreshIfNeeded(force) {
    if (!session) return Promise.reject(new Error("nosession"));
    if (!force && Date.now() < session.expires_at - 60000) return Promise.resolve();
    return authPost("token?grant_type=refresh_token", { refresh_token: session.refresh_token }).then(function (x) {
      if (!x.ok || !x.d.access_token) throw new Error("refresh");
      saveSession(fromAuth(x.d, session.email));
    });
  }
  function rpc(fn, body, retried) {
    return refreshIfNeeded(false).then(function () {
      return fetch(SB.url + "/rest/v1/rpc/" + fn, {
        method: "POST",
        headers: { apikey: SB.anonKey, Authorization: "Bearer " + session.access_token, "Content-Type": "application/json" },
        body: JSON.stringify(body || {})
      });
    }).then(function (r) {
      return r.text().then(function (t) {
        var d = null;
        try { d = t ? JSON.parse(t) : null; } catch (e) {}
        if (r.status === 401 && !retried) return refreshIfNeeded(true).then(function () { return rpc(fn, body, true); });
        if (!r.ok) throw Object.assign(new Error("api"), { status: r.status, data: d });
        return d;
      });
    });
  }
  function showLogin(msg, cls) {
    $("mainView").hidden = true;
    $("loginView").hidden = false;
    $("lMsg").innerHTML = msg ? '<div class="note ' + (cls || "bad") + '">' + msg + "</div>" : "";
  }
  function doLogin() {
    var email = $("lEmail").value.trim(), pw = $("lPw").value;
    if (!email || !pw) return showLogin("이메일과 비밀번호를 입력해 주세요.");
    $("lBtn").disabled = true;
    $("lMsg").innerHTML = '<div class="sub">확인 중…</div>';
    authPost("token?grant_type=password", { email: email, password: pw }).then(function (x) {
      $("lBtn").disabled = false;
      if (!x.ok || !x.d.access_token) return showLogin("로그인하지 못했습니다. 이메일과 비밀번호를 확인해 주세요.");
      $("lPw").value = "";
      saveSession(fromAuth(x.d, email));
      enter();
    }).catch(function () { $("lBtn").disabled = false; showLogin("통신이 원활하지 않습니다."); });
  }
  function logout() { saveSession(null); board = mapData = null; showLogin("로그아웃했습니다.", "info"); }
  function enter() {
    return rpc("is_staff", {}).then(function (ok) {
      if (ok !== true) { saveSession(null); return showLogin("이 계정은 <b>스태프 명단에 없습니다.</b>"); }
      $("loginView").hidden = true;
      $("mainView").hidden = false;
      $("whoAmI").textContent = session.email;
      syncTopHeight();
      var h = (location.hash || "").replace("#", "");
      return loadBoard().then(function () {
        var first = (board.shows || []).filter(function (s) { return NO_RESERVATION.indexOf(s.id) < 0; })[0];
        var pick = (board.shows || []).some(function (s) { return s.id === h; }) && NO_RESERVATION.indexOf(h) < 0 ? h : (first && first.id);
        if (pick) selectShow(pick).then(function () {
          // 처음 들어왔을 때 한 번 자동으로 안내한다
          if (window.HoldTour) setTimeout(function () { window.HoldTour.autoStart({ key: TOUR_KEY, steps: tourSteps() }); }, 400);
        });
      });
    }).catch(function () { saveSession(null); showLogin("로그인이 만료되었습니다. 다시 로그인해 주세요."); });
  }

  /* ================= 전체 현황 ================= */
  function loadBoard() {
    return rpc("holds_board", {}).then(function (d) {
      if (!d || !d.ok) { if (d && d.reason === "forbidden") return logout(); throw new Error("board"); }
      board = d;
      renderSwitch();
      renderAlerts();
      renderShowList();
    }).catch(function () { toast("현황을 불러오지 못했습니다", true); });
  }

  /* 창구는 참여사마다 따로 연다. 여기는 전체 현황과 한꺼번에 여닫는 버튼. */
  function renderSwitch() {
    var hs = board.holders || [];
    var open = hs.filter(function (h) { return h.is_open; });
    var closedOf = function (k) { return hs.filter(function (h) { return h.kind === k && !h.is_open; }).length; };
    $("holdPill").className = "pill " + (open.length ? "on" : "off");
    $("holdPill").querySelector("span").textContent = hs.length
      ? "열림 " + open.length + "곳 / 전체 " + hs.length + "곳"
      : "참여사 없음";
    $("holdDesc").innerHTML = "창구는 <b>참여사마다 따로</b> 엽니다. 열린 참여사만 링크로 좌석을 고르고 저장할 수 있고, " +
      "닫힌 참여사는 볼 수만 있습니다. 참여사 줄의 <b>열기·닫기</b>로 하나씩, 아래 버튼으로 한꺼번에 바꿉니다.";
    $("openBrand").disabled = !closedOf("brand");
    $("openUniv").disabled = !closedOf("univ");
    $("closeAll").disabled = !open.length;
  }

  function holdersOfBoard(sid) {
    return (board.holders || []).filter(function (h) { return h.show_id === sid; });
  }

  function renderAlerts() {
    var out = [];
    if (board.reservationsOpen) {
      out.push("일반 관람객 예약이 <b>열려 있습니다</b>. 사전 확보 기간에는 보통 닫아둡니다.");
    }
    (board.shows || []).forEach(function (s) {
      var hs = holdersOfBoard(s.id);
      var nm = esc(showWhen(s.date, s.start_time) + " " + showName(s.title_ko, s.lineup));
      if (NO_RESERVATION.indexOf(s.id) >= 0) {
        if (s.locked > 0 || hs.length) out.push(nm + " 은 예약을 받지 않는 쇼인데 잠긴 좌석이나 참여사가 있습니다.");
        return;
      }
      if (s.seating_mode !== "free") out.push(nm + " 예약 방식이 '" + esc(s.seating_mode) + "' 입니다 (다른 쇼는 자유석).");
      if (hs.length > 1) {
        hs.forEach(function (h) {
          if (h.allowed_seats == null) {
            out.push(nm + " <b>" + esc(h.name) + "</b> 는 배정 범위가 없어 <b>전 좌석</b>을 고를 수 있습니다. 여러 참여사 쇼라면 좌석을 나눠 배정하세요.");
          }
        });
      }
      hs.forEach(function (h) {
        if (h.zones && h.zones.length) out.push(nm + " " + esc(h.name) + " 에 이전 방식의 구역 제한(" + esc(h.zones.join(",")) + ")이 남아 있습니다. '수정'에서 저장하면 해제됩니다.");
      });
    });
    // 조작 영역을 밀어내지 않게 접어둔다. 건수는 제목에 보인다.
    var wasOpen = !!document.querySelector("#alerts details[open]");
    $("alerts").innerHTML = out.length
      ? '<details class="warnbox"' + (wasOpen ? " open" : "") + "><summary>확인이 필요한 항목 " + out.length + "건</summary>" +
        '<div class="body">' + out.map(function (t) { return "· " + t; }).join("<br>") + "</div></details>"
      : "";
  }

  function renderShowList() {
    var h = [];
    (board.shows || []).forEach(function (s) {
      if (NO_RESERVATION.indexOf(s.id) >= 0) return;
      var hs = holdersOfBoard(s.id);
      var nOpen = hs.filter(function (x) { return x.is_open; }).length;
      var left = Math.max(0, s.capacity - s.locked - s.reserved);
      h.push('<button type="button" class="shw' + (s.id === showId ? " on" : "") + '" data-show="' + esc(s.id) + '">' +
        "<b>" + esc(showName(s.title_ko, s.lineup)) + "</b>" +
        "<span>" + esc(showWhen(s.date, s.start_time)) + " · 참여사 " + hs.length + (nOpen ? " (열림 " + nOpen + ")" : "") + " · 일반 " + left + "</span></button>");
    });
    $("showList").innerHTML = h.join("");
  }

  /* ================= 쇼 하나 ================= */
  function selectShow(id) {
    showId = id;
    try { history.replaceState(null, "", "#" + id); } catch (e) {}
    focusId = null;
    editing = null;
    selection = [];
    renderShowList();
    $("logBox").innerHTML = "";
    return loadShow();
  }

  function loadShow() {
    $("mapTitle").textContent = "불러오는 중…";
    return rpc("holds_show_map", { p_show_id: showId }).then(function (d) {
      if (!d || !d.ok) { toast("지도를 불러오지 못했습니다", true); return; }
      mapData = d;
      renderShow();
    }).catch(function () { toast("지도를 불러오지 못했습니다", true); });
  }

  function colorOf(hid) {
    if (!mapData) return "#6b7490";
    for (var i = 0; i < mapData.holders.length; i++) if (mapData.holders[i].id === hid) return PALETTE[i % PALETTE.length];
    return "#6b7490";
  }
  function holderById(hid) {
    return (mapData ? mapData.holders : []).filter(function (h) { return h.id === hid; })[0];
  }
  /* 좌석 → 배정받은 참여사 */
  function allotIndex() {
    var m = {};
    mapData.holders.forEach(function (h) { (h.allowedSeats || []).forEach(function (sid) { m[sid] = h.id; }); });
    return m;
  }

  function renderShow() {
    var d = mapData, s = d.show;
    $("showBox").hidden = false;
    $("toolBox").hidden = false;
    $("showTitle").textContent = showName(s.titleKo, s.lineup);
    $("showSub").textContent = showWhen(s.date, s.startTime);

    var lock = { holder: 0, staff: 0 }, allotted = 0;
    var ai = allotIndex();
    d.seats.forEach(function (x) {
      if (x.lock === "staff") lock.staff++; else if (x.lock) lock.holder++;
      if (ai[x.id]) allotted++;
    });
    var left = Math.max(0, s.capacity - lock.holder - lock.staff - d.reserved);
    $("kpis").innerHTML =
      '<div class="kpi"><b>' + s.capacity + "</b><span>정원</span></div>" +
      '<div class="kpi"><b>' + allotted + "</b><span>배정</span></div>" +
      '<div class="kpi"><b>' + lock.holder + "</b><span>참여사 확보</span></div>" +
      '<div class="kpi"><b>' + lock.staff + "</b><span>주최측 확보</span></div>" +
      '<div class="kpi hi"><b>' + left + "</b><span>일반 공개</span></div>";

    renderHolders();
    renderForm();
    renderTool();
    renderMap();
  }

  function renderHolders() {
    var d = mapData;
    if (!d.holders.length) {
      $("holderList").innerHTML = '<div class="empty">아직 참여사가 없습니다. 개막식처럼 주최측만 잡는 쇼라면 참여사 없이 지도에서 바로 확보하세요.</div>';
      return;
    }
    var h = [];
    d.holders.forEach(function (x) {
      var allot = x.allowedSeats == null ? "전 좌석" : x.allowedSeats.length + "석";
      h.push('<div class="hr' + (x.id === focusId ? " on" : "") + '" data-focus="' + esc(x.id) + '">' +
        '<span class="sw8" style="background:' + colorOf(x.id) + '"></span>' +
        "<div>" +
          '<div class="nm">' + esc(x.name) + '<span class="kind">' + (x.kind === "univ" ? "대학" : "브랜드") + "</span>" +
            '<span class="pill sm ' + (x.isOpen ? "on" : "off") + '"><i></i>' + (x.isOpen ? "열림" : "닫힘") + "</span></div>" +
          '<div class="meta">배정 <b>' + allot + "</b> · 확보 <b>" + x.held + "</b>석" + (x.vip ? " (VIP <b>" + x.vip + "</b>" + (x.vipMissing ? ", 명단 미입력 <b>" + x.vipMissing + "</b>" : "") + ")" : "") +
            (x.maxSeats != null ? " · 한도 <b>" + x.maxSeats + "</b>" : "") +
            (x.contactName ? " · " + esc(x.contactName) : "") +
            (x.savedAt ? " · " + when(x.savedAt) : "") + "</div>" +
        "</div>" +
        '<div class="acts">' +
          (x.isOpen
            ? '<button class="btn sm bad" data-act="open" data-open="0" data-id="' + esc(x.id) + '" type="button">닫기</button>'
            : '<button class="btn sm go" data-act="open" data-open="1" data-id="' + esc(x.id) + '" type="button">열기</button>') +
          '<button class="btn sm pri" data-act="copy" data-token="' + esc(x.token) + '" type="button">링크</button>' +
          '<button class="btn sm" data-act="pickAllot" data-id="' + esc(x.id) + '" type="button">배정 보기</button>' +
          '<button class="btn sm" data-act="edit" data-id="' + esc(x.id) + '" type="button">수정</button>' +
          '<button class="btn sm bad" data-act="del" data-id="' + esc(x.id) + '" type="button">삭제</button>' +
        "</div></div>");
    });
    $("holderList").innerHTML = h.join("");
  }

  /* 참여사 후보 = 스케줄표의 참여 칸(lineup)을 ' · ' 로 나눈 이름.
     협업(카마모에X소티에)은 이미 한 덩어리라 그대로 한 참여사가 된다.
     해외브랜드는 주최측이 잡으므로 뺀다. 이미 추가한 이름도 뺀다. */
  var CUSTOM = "__custom";
  function guessKind(name) { return /대학교|대학|국립대|대$/.test(name) ? "univ" : "brand"; }
  function lineupCandidates() {
    var s = mapData.show, taken = {};
    mapData.holders.forEach(function (h) { taken[h.name] = true; });
    var lu = String(s.lineup || "").trim();
    if (!lu || lu === "오프닝") return [];
    return lu.split("·").map(function (x) { return x.trim(); }).filter(function (x) {
      return x && !/해외브랜드/.test(x) && !taken[x];
    });
  }

  function renderForm() {
    if (!editing) { $("formBox").innerHTML = ""; return; }
    var e = editing;
    var nameCell;
    if (e.holderId) {
      nameCell = '<div><label>참여사 이름</label><input type="text" id="fName" value="' + esc(e.name) + '" disabled /></div>';
    } else {
      var cands = lineupCandidates();
      nameCell = '<div><label>참여사</label><select id="fPick">' +
        cands.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + "</option>"; }).join("") +
        '<option value="' + CUSTOM + '">직접 입력…</option></select>' +
        '<input type="text" id="fName" style="margin-top:6px" placeholder="스케줄표에 없는 이름"' + (cands.length ? " hidden" : "") + " /></div>";
      if (cands.length) e.kind = guessKind(cands[0]);
    }
    $("formBox").innerHTML = '<div class="form">' +
      '<div class="row">' +
        nameCell +
        '<div><label>구분</label><select id="fKind"><option value="brand"' + (e.kind === "brand" ? " selected" : "") + '>브랜드</option><option value="univ"' + (e.kind === "univ" ? " selected" : "") + '>대학</option></select></div>' +
        '<div><label>확보 한도(선택)</label><input type="number" id="fMax" min="1" max="300" value="' + (e.max != null ? e.max : "") + '" placeholder="없음" /></div>' +
      "</div>" +
      (e.holderId ? "" : '<div class="sub" style="margin-top:6px">' +
        (lineupCandidates().length
          ? "홈페이지 스케줄표에 적힌 이 쇼의 참여사 중 아직 추가하지 않은 곳만 나옵니다. 구분(브랜드/대학)은 자동으로 골라지니 확인만 하세요."
          : "이 쇼의 스케줄표 참여사는 모두 추가했습니다. 다른 이름이 필요하면 직접 입력하세요.") + "</div>") +
      '<div class="foot"><span id="fMsg" class="sub"></span>' +
        '<button class="btn sm" data-act="cancel" type="button">취소</button>' +
        '<button class="btn sm pri" data-act="save" type="button">' + (e.holderId ? "저장" : "추가하고 링크 만들기") + "</button>" +
      "</div></div>";
    var pk = $("fPick");
    if (pk) {
      if (pk.value === CUSTOM) $("fName").focus(); else pk.focus();
    }
  }
  // 고른 참여사에 맞춰 구분을 바꾸고, '직접 입력'일 때만 이름 칸을 보여준다
  document.addEventListener("change", function (ev) {
    if (!ev.target || ev.target.id !== "fPick") return;
    var v = ev.target.value, n = $("fName");
    n.hidden = v !== CUSTOM;
    if (v === CUSTOM) { n.value = ""; n.focus(); }
    else $("fKind").value = guessKind(v);
  });

  function renderTool() {
    var d = mapData, cur = $("allotTo").value;
    $("allotTo").innerHTML = d.holders.length
      ? d.holders.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name) + "</option>"; }).join("")
      : '<option value="">(참여사 없음)</option>';
    if (focusId) $("allotTo").value = focusId;
    else if (cur && holderById(cur)) $("allotTo").value = cur;
    syncTool();
  }
  var MODE_HINT = {
    zone: "좌석 어디를 눌러도 <b>그 구역 전체</b>가 선택/해제됩니다. 구역을 고른 뒤 몇 자리만 빼려면 <b>좌석 단위</b>로 바꾸세요.",
    seat: "누른 좌석만 선택/해제됩니다. <b>끌면</b> 여러 석을 한 번에. 이미 선택된 좌석에서 끌기 시작하면 해제 방향으로 칠해집니다."
  };
  function syncMode() {
    [].forEach.call($("modeSeg").querySelectorAll("button"), function (b) {
      b.classList.toggle("on", b.getAttribute("data-mode") === selMode);
    });
    $("modeHint").innerHTML = MODE_HINT[selMode];
  }
  $("modeSeg").addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("button[data-mode]") : null;
    if (!b) return;
    selMode = b.getAttribute("data-mode");
    if (map) map.setMode(selMode);
    syncMode();
  });

  function syncTool() {
    var n = selection.length, hasH = mapData && mapData.holders.length > 0;
    $("selCnt").textContent = n;
    // 구역별 선택 현황 — 구역을 고른 뒤 몇 자리 뺐는지 바로 보인다. 일부만 선택된 구역은 노랗게.
    var sum = map && map.summary ? map.summary().filter(function (z) { return z.selected > 0; }) : [];
    $("zoneSum").innerHTML = sum.map(function (z) {
      return '<span class="' + (z.selected < z.total ? "part" : "") + '">' + z.code + " " + z.selected + "/" + z.total + "</span>";
    }).join("");
    syncMode();
    $("clearSel").disabled = !n;
    $("allotAdd").disabled = !n || !hasH;
    $("allotRemove").disabled = !n || !hasH;
    $("allotTo").disabled = !hasH;
    $("staffOn").disabled = !n;
    $("staffOff").disabled = !n;
  }

  /* 홀 전체가 한 화면에 들어오도록 좌석 칸 크기를 정한다.
     세로는 50열이라 높이가 기준이고, 가로는 남으니 넓혀서 누르기 쉽게 한다. */
  function fitSize(d) {
    var box = $("map");
    var bands = {}, rows = 0;
    d.zones.forEach(function (z) { bands[z.sort] = Math.max(bands[z.sort] || 0, z.rows); });
    Object.keys(bands).forEach(function (k) { rows += bands[k]; });
    var seps = Math.max(0, Object.keys(bands).length - 1);
    var gap = 2, sep = 8, lab = 34, run = 64, ends = 56;
    // 오른쪽 패널에서 제목 줄을 뺀 높이. (지도 상자 높이는 지도를 그린 뒤 내용에 따라 늘어나므로 쓰지 않는다)
    var panel = $("mapPanel"), rh = panel.querySelector(".rh");
    var availH = panel.clientHeight - (rh ? rh.offsetHeight : 30) - 34;
    // 좌석은 둥근 정사각형. 번호가 읽히도록 최소 16px — 화면이 낮으면 지도 쪽만 살짝 스크롤된다.
    var sq = Math.floor((availH - ends - seps * sep - (rows + seps - 1) * gap) / rows);
    sq = Math.max(16, Math.min(26, sq));
    return { w: sq, h: sq, gap: gap, sep: sep, lab: lab, run: run,
             fs: Math.max(8, Math.round(sq * 0.5)), rad: Math.max(3, Math.round(sq * 0.28)) };
  }

  function renderMap() {
    var d = mapData, ai = allotIndex();
    $("mapTitle").textContent = showName(d.show.titleKo, d.show.lineup);
    $("mapSub").textContent = showWhen(d.show.date, d.show.startTime);
    renderLegend();

    map = window.HallMap.create($("map"), {
      zones: d.zones,
      seats: d.seats,
      size: fitSize(d),
      numbers: true,
      drag: true,
      mode: selMode,
      decorate: function (x, el) {
        var who = null, how = "";
        // 진하게 칠한 칸(확보)은 흰 글자, 연한 칸(배정)은 참여사 색 글자로 번호가 읽히게 한다
        if (x.lock === "staff") {
          el.style.background = STAFF_COLOR; el.style.borderColor = STAFF_COLOR; el.style.color = "#fff"; how = "주최측 확보";
        } else if (x.lock) {
          var c = colorOf(x.lock); el.style.background = c; el.style.borderColor = c; el.style.color = "#fff";
          who = holderById(x.lock); how = (who ? who.name : "참여사") + (x.g === "vip" ? " VIP석" : " 일반초청석") + " 확보";
          // VIP석은 금색 테두리로 구분한다
          if (x.g === "vip") { el.style.boxShadow = "inset 0 0 0 2px " + VIP_RING; how += " — " + (x.gn || "?") + " / " + (x.go || "?") + " / " + (x.gp || "?"); }
        } else if (x.res) {
          el.style.background = RESERVED_COLOR; el.style.borderColor = RESERVED_COLOR; el.style.color = "#fff"; how = "일반 예약";
        } else if (ai[x.id]) {
          var c2 = colorOf(ai[x.id]); el.style.background = tint(c2, 0.16); el.style.borderColor = tint(c2, 0.55); el.style.color = c2;
          who = holderById(ai[x.id]); how = (who ? who.name : "참여사") + " 배정";
        }
        if (focusId && x.lock !== focusId && ai[x.id] !== focusId) el.style.opacity = ".28";
        el.title = x.z + "구역 " + x.n + "번 (" + x.t + "단 " + x.r + "열)" + (how ? " — " + how : "");
      },
      onZone: function (code) { map.toggleZone(code); },
      onChange: function (sel) { selection = sel; syncTool(); }
    });
    if (selection.length) map.setSelection(selection);
    syncTool();   // 새 지도 기준으로 구역별 현황·버튼 상태를 맞춘다

  }

  var VIP_RING = "#f5b800";
  function renderLegend() {
    var d = mapData;
    $("legend").innerHTML = '<div class="hm-legend">' +
      '<span><i style="background:#fff"></i>빈 좌석</span>' +
      '<span><i style="background:' + tint(PALETTE[0], 0.2) + ";border-color:" + tint(PALETTE[0], 0.6) + '"></i>배정(연한 색)</span>' +
      '<span><i style="background:' + PALETTE[0] + ";border-color:" + PALETTE[0] + '"></i>일반초청석 확보(진한 색)</span>' +
      '<span><i style="background:' + PALETTE[0] + ";border-color:" + PALETTE[0] + ";box-shadow:inset 0 0 0 2px " + VIP_RING + '"></i>VIP석 확보(금색 테두리)</span>' +
      '<span><i style="background:' + STAFF_COLOR + '"></i>주최측 확보</span>' +
      '<span><i style="background:' + RESERVED_COLOR + '"></i>일반 예약</span>' +
      '<span><i style="outline:2px solid #ff4d6d;border-color:transparent"></i>선택 중</span>' +
      "</div>" +
      (d.holders.length ? '<div class="hm-legend">' + d.holders.map(function (x) {
        return '<span><i style="background:' + colorOf(x.id) + '"></i>' + esc(x.name) + "</span>";
      }).join("") + "</div>" : "");
  }

  function reloadAll(keepSel) {
    var sel = keepSel ? selection.slice() : [];
    return Promise.all([loadBoard(), rpc("holds_show_map", { p_show_id: showId })]).then(function (r) {
      var d = r[1];
      if (!(d && d.ok)) return;
      mapData = d;
      // 사용자가 지도에서 끄는 중이면 끝날 때까지 기다렸다가 그린다
      return whenIdle().then(function () {
        // keepSel 이면 불러오기 전 선택을 되살리고, 아니면 지금 선택을 그대로 둔다.
        // (불러오는 사이 사용자가 새로 끌어 고른 좌석을 지우지 않기 위해)
        if (keepSel) selection = sel;
        renderShow();
      });
    });
  }
  function whenIdle() {
    return new Promise(function (resolve) {
      (function wait() {
        if (map && map.isDragging && map.isDragging()) return setTimeout(wait, 80);
        resolve();
      })();
    });
  }

  /* ================= 조작 ================= */
  document.addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest("button,[data-focus]") : null;
    if (!b) return;

    var sid = b.getAttribute("data-show");
    if (sid && b.classList.contains("shw")) { selectShow(sid); return; }

    var act = b.getAttribute("data-act");
    if (!act && b.hasAttribute("data-focus")) {
      var f = b.getAttribute("data-focus");
      focusId = focusId === f ? null : f;
      renderHolders(); renderTool(); renderMap();
      return;
    }
    if (!act || b.disabled) return;
    ev.stopPropagation();

    if (act === "copy") {
      var url = location.origin + location.pathname.replace(/[^/]*$/, "") + "hold.html?t=" + b.getAttribute("data-token");
      copyText(url).then(function () { toast("링크를 복사했습니다"); }).catch(function () { window.prompt("아래 링크를 복사하세요", url); });
    } else if (act === "pickAllot") {
      var x = holderById(b.getAttribute("data-id"));
      if (!x) return;
      focusId = x.id;
      renderHolders(); renderTool(); renderMap();
      if (x.allowedSeats == null) toast(x.name + " 는 배정 범위가 없습니다 (전 좌석 가능)");
      else { map.setSelection(x.allowedSeats); toast(x.name + " 배정 " + x.allowedSeats.length + "석을 선택했습니다"); }
    } else if (act === "edit") {
      var y = holderById(b.getAttribute("data-id"));
      if (!y) return;
      editing = { holderId: y.id, name: y.name, kind: y.kind, max: y.maxSeats };
      renderForm();
    } else if (act === "open") {
      var z = holderById(b.getAttribute("data-id"));
      if (z) setOpen([z.id], b.getAttribute("data-open") === "1", null, z.name);
    } else if (act === "del") {
      deleteHolder(b.getAttribute("data-id"));
    } else if (act === "cancel") {
      editing = null; renderForm();
    } else if (act === "save") {
      saveHolder();
    } else if (act === "restore") {
      restoreLog(b.getAttribute("data-log"));
    }
  });

  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t);
    return Promise.reject(new Error("noclip"));
  }

  $("addBtn").addEventListener("click", function () {
    editing = { holderId: null, name: "", kind: "brand", max: null };
    renderForm();
  });

  function saveHolder() {
    var e = editing;
    var pick = $("fPick");
    var name = e.holderId ? e.name
      : (pick && pick.value !== CUSTOM ? pick.value : ($("fName").value || "")).trim();
    var kind = $("fKind").value;
    var mx = $("fMax").value === "" ? null : parseInt($("fMax").value, 10);
    var msg = $("fMsg");
    function err(t) { msg.textContent = t; msg.style.color = "var(--bad)"; }
    if (!name) return err("참여사 이름을 입력하세요");
    if (mx != null && (isNaN(mx) || mx < 1 || mx > 300)) return err("한도는 1~300");
    if (!e.holderId && mapData.holders.some(function (h) { return h.name === name; })) return err("같은 이름이 이미 있습니다");
    msg.textContent = "저장 중…"; msg.style.color = "";
    // 좌석 배정은 지도에서 한다. 이전 방식의 구역 제한은 여기서 해제한다(p_zones=null).
    rpc("holder_upsert", { p_show_id: showId, p_name: name, p_kind: kind, p_max_seats: mx, p_zones: null, p_close_at: null })
      .then(function (d) {
        if (!d || !d.ok) return err("저장하지 못했습니다" + (d && d.reason ? " (" + d.reason + ")" : ""));
        var isNew = !e.holderId;
        editing = null;
        return reloadAll(true).then(function () {
          if (isNew) {
            focusId = d.id;
            renderHolders(); renderTool(); renderMap();
            var url = location.origin + location.pathname.replace(/[^/]*$/, "") + "hold.html?t=" + d.token;
            // 참여사가 하나뿐이면 배정 없이 전 좌석에서 고르므로 배정을 권하지 않는다
            var many = mapData.holders.length > 1;
            copyText(url).then(function () {
              toast(name + " 추가 — 링크 복사됨. " + (many
                ? "여러 참여사 쇼이니 지도에서 좌석을 골라 '배정에 추가'로 나눠 주세요"
                : "카카오톡·메일로 보내시면 됩니다") + ". 창구는 닫힌 채로 시작하니 준비되면 '열기'를 누르세요");
            }).catch(function () { toast(name + " 추가했습니다. '링크' 버튼으로 주소를 복사해 보내세요"); });
          } else {
            toast(name + " 저장했습니다");
          }
        });
      }).catch(function () { err("통신 오류"); });
  }

  function deleteHolder(id) {
    var x = holderById(id);
    if (!x) return;
    var w = "'" + x.name + "' 를 삭제할까요?\n\n링크가 더 이상 열리지 않습니다.";
    if (x.held > 0) w += "\n\n확보한 " + x.held + "석이 풀려 일반 공개로 돌아갑니다.\n(좌석 목록은 변경 이력에 보관됩니다)";
    if (!window.confirm(w)) return;
    rpc("holder_delete", { p_id: id }).then(function (d) {
      if (!d || !d.ok) return toast("삭제하지 못했습니다", true);
      if (focusId === id) focusId = null;
      toast(x.name + " 삭제" + (d.released ? " — " + d.released + "석 해제" : ""));
      reloadAll(false);
    }).catch(function () { toast("통신 오류", true); });
  }

  /* ---- 배정 ---- */
  function allot(mode) {
    var hid = $("allotTo").value;
    var h = holderById(hid);
    if (!h || !selection.length) return;
    var ids = selection.slice();

    // 주최측이 확보한 좌석은 배정 대상이 아니다. 구역째 골라도 빼고 보낸다.
    var staffCut = 0;
    if (mode === "add") {
      var lockOf = {};
      mapData.seats.forEach(function (x) { lockOf[x.id] = x.lock; });
      ids = ids.filter(function (sid) { return lockOf[sid] !== "staff"; });
      staffCut = selection.length - ids.length;
      if (!ids.length) return toast("선택한 좌석은 모두 주최측이 확보한 좌석이라 배정할 수 없습니다", true);
    }

    if (mode === "add") {
      // 다른 참여사에 배정돼 있던 좌석은 옮겨온다. 미리 확인한다.
      var ai = allotIndex(), from = {};
      ids.forEach(function (sid) { var o = ai[sid]; if (o && o !== hid) from[o] = (from[o] || 0) + 1; });
      var names = Object.keys(from).map(function (o) { var hh = holderById(o); return (hh ? hh.name : "?") + " " + from[o] + "석"; });
      if (names.length && !window.confirm("선택한 좌석 중 일부가 이미 다른 참여사에 배정돼 있습니다.\n\n" +
          names.join("\n") + "\n\n" + h.name + " 에게 옮길까요?")) return;
    }
    run(false);

    function run(force) {
      rpc("holder_allot", { p_holder_id: hid, p_seat_ids: ids, p_mode: mode, p_force: force }).then(function (d) {
        if (d && !d.ok && d.reason === "heldbyother") {
          if (!window.confirm((d.seats || []).length + "석은 다른 참여사가 이미 확보한 좌석입니다.\n(" +
              (d.seats || []).slice(0, 12).join(", ") + ((d.seats || []).length > 12 ? " …" : "") + ")\n\n" +
              "그 확보를 풀고 " + h.name + " 에게 배정할까요?\n풀린 내용은 그 참여사 이력에 남습니다.")) return;
          return run(true);
        }
        if (!d || !d.ok) return toast("배정하지 못했습니다" + (d && d.reason ? " (" + d.reason + ")" : ""), true);
        var t = h.name + " 배정 " + (d.unlimited ? "제한 없음" : d.allotted + "석");
        if (d.moved) t += " · 다른 참여사에서 " + d.moved + "석 옮겨옴";
        if (d.released) t += " · 확보 " + d.released + "석 해제";
        if (staffCut || d.skippedStaff) t += " · 주최측 확보 " + Math.max(staffCut, d.skippedStaff || 0) + "석은 제외";
        toast(t);
        if (d.outOfAllot > 0) toast(h.name + " 가 이미 확보한 " + d.outOfAllot + "석이 배정 밖에 남았습니다. 참여사가 다음에 저장하면 풀립니다.", true);
        // 강조할 참여사를 먼저 정해두면 새로 불러와 그릴 때 한 번에 반영된다.
        // (예전에는 불러온 뒤 또 그려서, 그 틈에 좌석을 끌면 선택이 사라졌다)
        focusId = hid;
        map.clearSelection();
        reloadAll(false);
      }).catch(function () { toast("통신 오류", true); });
    }
  }
  $("allotAdd").addEventListener("click", function () { allot("add"); });
  $("allotRemove").addEventListener("click", function () { allot("remove"); });

  /* ---- 주최측 직접 확보 ---- */
  function staffHold(on) {
    if (!selection.length) return;
    var ids = selection.slice();
    if (!window.confirm(on
        ? "선택한 " + ids.length + "석을 주최측이 직접 확보할까요?\n일반 예약에서 빠집니다."
        : "선택한 좌석 중 주최측이 확보한 좌석을 해제할까요?\n일반 공개로 돌아갑니다.")) return;
    rpc("staff_hold_set", { p_show_id: showId, p_seat_ids: ids, p_on: on }).then(function (d) {
      if (!d || !d.ok) return toast("처리하지 못했습니다" + (d && d.reason ? " (" + d.reason + ")" : ""), true);
      var t = on ? "주최측 확보 " + d.changed + "석" : "주최측 확보 해제 " + d.changed + "석";
      if (d.skipped && d.skipped.length) t += " · 참여사 확보/일반 예약 " + d.skipped.length + "석은 건너뜀";
      toast(t);
      map.clearSelection();
      reloadAll(false);
    }).catch(function () { toast("통신 오류", true); });
  }
  $("staffOn").addEventListener("click", function () { staffHold(true); });
  $("staffOff").addEventListener("click", function () { staffHold(false); });
  $("clearSel").addEventListener("click", function () { if (map) map.clearSelection(); });

  /* ---- 창구 : 참여사별 ----
     ids 를 주면 그 참여사만, 아니면 kind('brand'|'univ'|null=전부)에 해당하는 참여사 전부.
     서버가 저장 뒤 다시 읽은 상태를 돌려주므로, 요청한 대로 바뀌었는지 하나하나 확인한다. */
  var openBusy = false;
  function setOpen(ids, open, kind, label) {
    if (openBusy) return;
    var who = label || (kind === "brand" ? "브랜드 참여사 모두" : kind === "univ" ? "대학 참여사 모두" : "참여사 모두");
    if (!window.confirm(open
        ? who + "의 창구를 열까요?\n\n링크로 좌석을 고르고 저장할 수 있게 됩니다."
        : who + "의 창구를 닫을까요?\n\n링크로 볼 수만 있게 됩니다. 확보된 좌석은 그대로 유지됩니다.")) return;
    openBusy = true;
    rpc("holder_open_set", { p_ids: ids, p_open: open, p_kind: kind }).then(function (d) {
      openBusy = false;
      if (!d || !d.ok) return toast("바꾸지 못했습니다" + (d && d.reason ? " (" + d.reason + ")" : ""), true);
      var wrong = (d.holders || []).filter(function (h) { return h.isOpen !== open; });
      if (wrong.length) {
        toast(wrong.map(function (h) { return h.name; }).join(", ") + " 의 창구가 바뀌지 않았습니다. 새로고침 후 확인해 주세요", true);
      } else {
        toast(who + " — 창구 " + (open ? "열림" : "닫힘") + (ids ? "" : " (" + d.changed + "곳 바뀜)"));
      }
      reloadAll(true);
    }).catch(function () { openBusy = false; toast("통신 오류 — 새로고침 후 상태를 확인해 주세요", true); reloadAll(true); });
  }
  $("openBrand").addEventListener("click", function () { setOpen(null, true, "brand"); });
  $("openUniv").addEventListener("click", function () { setOpen(null, true, "univ"); });
  $("closeAll").addEventListener("click", function () { setOpen(null, false, null); });

  /* ---- 엑셀 ---- */
  $("exportBtn").addEventListener("click", function () {
    rpc("hold_export", {}).then(function (rows) {
      rows = rows || [];
      var lines = [["쇼", "패션쇼", "날짜", "시각", "참여사", "구분", "좌석", "구역", "번호", "좌석 종류",
                    "VIP 이름", "VIP 소속", "VIP 연락처", "담당자", "연락처", "마지막 저장"]];
      rows.forEach(function (r) {
        var sh = (board.shows || []).filter(function (x) { return x.id === r.show_id; })[0];
        lines.push([r.show_id, sh ? showName(sh.title_ko, sh.lineup) : r.title_ko, r.show_date, r.start_time, r.holder_name,
          r.kind === "univ" ? "대학" : r.kind === "brand" ? "브랜드" : "주최측",
          r.seat_id, r.zone_code, r.seat_num,
          r.kind === "staff" ? "주최측" : r.grade === "vip" ? "VIP석" : "일반초청석",
          r.grade === "vip" ? r.guest_name || "" : "", r.grade === "vip" ? r.guest_org || "" : "", r.grade === "vip" ? r.guest_phone || "" : "",
          r.contact_name || "", r.contact_phone || "", when(r.saved_at)]);
      });
      var csv = lines.map(function (row) {
        return row.map(function (v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(",");
      }).join("\r\n");
      var a = document.createElement("a");
      var d = new Date(Date.now() + 9 * 3600 * 1000);
      a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
      a.download = "BFW_사전좌석확보_" + d.toISOString().slice(0, 16).replace(/[-:T]/g, "") + ".csv";
      document.body.appendChild(a); a.click(); a.remove();
      toast(rows.length + "석 내려받았습니다");
    }).catch(function () { toast("내려받지 못했습니다", true); });
  });

  /* ---- 전체 백업 : 참여사·확보 좌석·이력 전부를 JSON 파일로 ---- */
  $("backupBtn").addEventListener("click", function () {
    rpc("hold_backup", {}).then(function (d) {
      if (!d || !d.ok) return toast("백업하지 못했습니다", true);
      var a = document.createElement("a");
      var t = new Date(Date.now() + 9 * 3600 * 1000);
      a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 1)], { type: "application/json" }));
      a.download = "BFW_사전좌석확보_백업_" + t.toISOString().slice(0, 16).replace(/[-:T]/g, "") + ".json";
      document.body.appendChild(a); a.click(); a.remove();
      toast("백업 저장 — 참여사 " + d.holders.length + "곳 · 잠긴 좌석 " + d.locks.length + "석 · 이력 " + d.log.length + "건");
    }).catch(function () { toast("백업하지 못했습니다", true); });
  });

  /* ---- 이력 ---- */
  var ACT = { save: "확보 저장", restore: "되돌림", "delete": "참여사 삭제", allot: "배정 변경", reallot: "배정 이동으로 확보 해제", staff: "주최측",
              open: "창구 열림", close: "창구 닫힘" };
  $("logBtn").addEventListener("click", function () {
    if (!showId) return;
    $("logBox").innerHTML = '<div class="sub" style="margin-top:8px">불러오는 중…</div>';
    rpc("hold_log", { p_show_id: showId, p_limit: 200 }).then(function (rows) {
      rows = rows || [];
      if (!rows.length) { $("logBox").innerHTML = '<div class="empty">이력이 없습니다.</div>'; return; }
      var h = ['<div class="tbl-wrap"><table><thead><tr><th>시각</th><th>대상</th><th>동작</th><th>석</th><th>바뀐 뒤</th><th></th></tr></thead><tbody>'];
      rows.forEach(function (r) {
        var can = (r.action === "save" || r.action === "restore" || r.action === "reallot") && r.prev_count > 0;
        h.push("<tr><td class=\"mono\">" + when(r.created_at) + "</td>" +
          "<td>" + esc(r.holder_name) + (r.contact_name ? '<br><span class="sub">' + esc(r.contact_name) + "</span>" : "") + "</td>" +
          "<td>" + (ACT[r.action] || esc(r.action)) + "</td>" +
          '<td class="mono">' + r.prev_count + "→<b>" + r.seat_count + "</b></td>" +
          '<td class="seats">' + (r.seat_ids && r.seat_ids.length ? esc(r.seat_ids.join(" ")) : "—") + "</td>" +
          "<td>" + (can ? '<button class="btn sm" data-act="restore" data-log="' + r.id + '" type="button">직전으로</button>' : "") + "</td></tr>");
      });
      h.push("</tbody></table></div>");
      $("logBox").innerHTML = h.join("");
    }).catch(function () { $("logBox").innerHTML = '<div class="note bad">이력을 불러오지 못했습니다.</div>'; });
  });

  function restoreLog(id) {
    if (!window.confirm("이 저장 직전 상태로 되돌릴까요?\n되돌린 것도 이력에 남습니다.")) return;
    rpc("hold_restore", { p_log_id: parseInt(id, 10), p_which: "prev" }).then(function (d) {
      if (!d || !d.ok) {
        var why = d && d.reason === "taken" ? "그 사이 다른 참여사가 가져간 좌석이 있어 되돌릴 수 없습니다: " + (d.seats || []).join(", ")
          : d && d.reason === "noholder" ? "삭제된 참여사라 되돌릴 수 없습니다. 이력의 좌석 목록을 참고하세요."
          : d && d.reason === "notallowed" ? "지금은 이 참여사 배정 범위 밖인 좌석이 있어 되돌릴 수 없습니다: " + (d.seats || []).join(", ") + " — 먼저 그 좌석을 다시 배정해 주세요"
          : "되돌리지 못했습니다" + (d && d.reason ? " (" + d.reason + ")" : "");
        return toast(why, true);
      }
      toast(d.restored + "석으로 되돌렸습니다");
      reloadAll(false).then(function () { $("logBtn").click(); });
    }).catch(function () { toast("통신 오류", true); });
  }

  function syncTopHeight() {
    var t = document.querySelector(".top");
    if (t) document.documentElement.style.setProperty("--top-h", (t.offsetHeight + 8) + "px");
  }
  var resizeTimer = null;
  window.addEventListener("resize", function () {
    syncTopHeight();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (!mapData || $("mainView").hidden) return;
      whenIdle().then(function () { var keep = selection.slice(); renderMap(); if (keep.length) map.setSelection(keep); });
    }, 180);
  });

  /* ================= 사용법 안내 ================= */
  function boxOf(id) { var e = $(id); return e ? (e.closest(".box") || e) : null; }
  function lineOf(id) { var e = $(id); return e ? (e.closest(".line") || e) : null; }
  function tourSteps() {
    var nH = mapData ? mapData.holders.length : 0;
    return [
      { el: null,
        title: "사전 좌석 확보 관리",
        html: "브랜드·대학이 좌석을 미리 잡도록 <b>링크를 만들어 보내고</b>, 여러 참여사가 함께하는 쇼는 <b>좌석을 나눠 주는</b> 화면입니다.<br><br>" +
              "두 가지만 구분하시면 됩니다.<ul>" +
              "<li><b>배정</b> — 그 참여사가 <b>고를 수 있는 범위</b> (주최측이 정함)</li>" +
              "<li><b>확보</b> — 실제로 잡혀 <b>일반 예약에서 빠진 좌석</b> (참여사가 링크로, 또는 주최측이 직접)</li></ul>" },
      { el: function () { return boxOf("holdPill"); },
        title: "확보 창구는 참여사마다 따로",
        html: "창구가 <b>열린 참여사만</b> 링크로 좌석을 고르고 저장할 수 있습니다. 닫힌 참여사는 <b>볼 수만</b> 있고, 확보된 좌석은 그대로 유지됩니다.<br><br>" +
              "브랜드와 대학의 기간이 다르면 <span class='k'>브랜드 모두 열기</span> <span class='k'>대학 모두 열기</span>로 따로 열고, " +
              "한 곳만 바꿀 때는 참여사 줄의 <b>열기·닫기</b>를 누르세요.<br>" +
              "새로 추가한 참여사는 <b>닫힌 채로</b> 시작합니다." },
      { el: function () { return boxOf("showList"); },
        title: "패션쇼 고르기",
        html: "홈페이지 스케줄표와 같은 이름으로 나옵니다. 쇼마다 <b>참여사 수</b>와 <b>일반 공개 좌석 수</b>가 함께 보입니다." },
      { el: "#kpis",
        title: "이 쇼의 현황",
        html: "<b>배정 · 참여사 확보 · 주최측 확보 · 일반 공개</b> 좌석 수입니다.<br><b>일반 공개</b>가 관람객이 예약할 수 있는 좌석입니다." },
      { el: function () { var b = $("addBtn"); return b ? b.parentNode : null; },
        title: "① 참여사를 추가하고 링크 보내기",
        html: "<span class='k'>+ 참여사 추가</span> → 목록에서 참여사를 고르면 <b>링크가 자동으로 복사</b>됩니다. " +
              "목록은 홈페이지 스케줄표에 적힌 이 쇼의 참여사라 이름을 칠 필요가 없습니다.<br>" +
              "카카오톡이나 메일로 그 참여사에게 보내시면 됩니다.<br><br>" +
              "참여사마다 링크가 다르고, 받은 곳은 <b>자기 몫만</b> 고칠 수 있습니다. " +
              "협업 쇼(예: 카마모에X소티에)는 <b>참여사 하나</b>로 등록하세요." },
      { el: function () { return $("modeSeg") ? $("modeSeg").closest(".modes") : null; },
        title: "② 지도에서 좌석 고르기",
        html: "<ul><li><span class='k'>구역 단위</span> 좌석 하나만 눌러도 그 구역 전체</li>" +
              "<li><span class='k'>좌석 단위</span> 누른 좌석만. <b>끌면</b> 여러 석</li></ul>" +
              "예) A구역에서 뒤 3자리만 빼려면 → 구역 단위로 A를 한 번 → 좌석 단위로 바꿔 3자리.<br>" +
              "구역별로 <span class='k'>A 33/36</span> 처럼 몇 석 골랐는지 보입니다." },
      { el: "#mapPanel", maxH: 420,
        title: "좌석 지도",
        html: "벡스코 3B홀 모양 그대로입니다. 위가 <b>무대</b>, 가운데가 <b>런웨이</b>, 칸 안 숫자가 <b>좌석번호</b>예요(2025 배치도와 같은 번호).<ul>" +
              "<li>연한 색 — 참여사 <b>배정</b></li><li>진한 색 — 참여사 <b>확보</b> (금색 테두리는 <b>VIP석</b>)</li><li>짙은 회색 — <b>주최측 확보</b></li></ul>" +
              "좌석에 마우스를 올리면 누구 좌석인지 나옵니다. 구역 글자(A~H)를 누르면 구역 전체가 선택됩니다." },
      { el: function () { return lineOf("allotTo"); },
        title: "③ 고른 좌석을 참여사에게 배정",
        html: (nH ? "" : "<b>지금 이 쇼에는 참여사가 없어</b> 배정할 곳이 없습니다. 참여사를 추가하면 여기서 고를 수 있습니다.<br><br>") +
              "<b>주최측이 확보한 좌석은 배정되지 않습니다.</b> 구역을 통째로 골라도 그 좌석은 자동으로 빠집니다.<br><br>" +
              "<b>여러 참여사가 함께하는 쇼</b>에서 씁니다. 참여사를 고르고 <b>배정에 추가</b>. 브랜드끼리 협의해 나눈 구역·좌석을 이렇게 나눠 줍니다. " +
              "참여사가 하나뿐인 쇼는 배정하지 않아도 전 좌석에서 고를 수 있습니다.<br><br>" +
              "다른 참여사에 이미 배정된 좌석이면 <b>옮길지 먼저 묻고</b>, 그 참여사가 이미 확보했으면 <b>한 번 더</b> 묻습니다." },
      { el: function () { return lineOf("staffOn"); },
        title: "주최측이 직접 확보",
        html: "개막식 내빈석처럼 <b>링크 없이 주최측이 잡을 좌석</b>은 여기서 바로 확보합니다.<br>참여사가 이미 확보한 좌석은 건드리지 않고 건너뜁니다." },
      { el: "#holderList",
        title: "참여사 관리",
        html: nH
          ? "<b>열림/닫힘</b> 표시와 <b>열기·닫기</b> 버튼으로 이 참여사 창구만 바꿉니다.<br>" +
            "<span class='k'>링크</span> 다시 복사 · <span class='k'>배정 보기</span> 그 참여사 범위를 지도에서 선택 · <span class='k'>수정</span> · <span class='k'>삭제</span><br><br>" +
            "줄을 누르면 지도에서 <b>그 참여사 좌석만 강조</b>됩니다. 삭제해도 갖고 있던 좌석 목록은 이력에 남습니다."
          : "추가한 참여사가 이곳에 한 줄씩 나오고, 줄마다 <b>열기·닫기</b> · <b>링크</b>(다시 복사) · <b>배정 보기</b> · <b>수정</b> · <b>삭제</b> 버튼이 붙습니다.<br><br>" +
            "지금 이 쇼에는 아직 참여사가 없습니다. 삭제해도 갖고 있던 좌석 목록은 이력에 남습니다." },
      { el: function () { return boxOf("logBtn"); },
        title: "변경 이력과 엑셀",
        html: "배정·확보·삭제가 <b>모두 기록</b>됩니다. <span class='k'>이 쇼 이력 보기</span>를 누르면 목록이 열리고, " +
              "참여사가 실수로 지웠다면 그 줄의 <b>직전으로</b> 버튼으로 되돌릴 수 있어요.<br><br>" +
              "위쪽 <span class='k'>확보 현황 엑셀</span>은 좌석 하나가 한 줄인 전체 목록입니다. 의자 라벨 인쇄 등에 쓰세요.<br>" +
              "<span class='k'>전체 백업</span>은 참여사·링크·확보 좌석·VIP 명단·이력을 모두 담은 파일입니다. <b>하루 한 번</b> 받아 두세요." },
      { el: null,
        title: "진행 순서",
        html: "<ol><li>쇼마다 <b>참여사 추가</b> → 링크 전달</li>" +
              "<li>여러 참여사 쇼는 <b>좌석 배정</b></li>" +
              "<li>기간이 된 참여사부터 <b>창구 열기</b> (브랜드·대학 따로 가능)</li>" +
              "<li>기간이 끝난 참여사는 <b>창구 닫기</b></li>" +
              "<li><b>엑셀</b> 내려받아 보관</li></ol><br>" +
              "이 안내는 오른쪽 위 <span class='k'>사용법</span>에서 언제든 다시 볼 수 있습니다." }
    ];
  }
  var TOUR_KEY = "bfw_tour_holdadmin_v2";
  $("helpBtn").addEventListener("click", function () {
    if (mapData && window.HoldTour) window.HoldTour.start({ key: TOUR_KEY, steps: tourSteps() });
  });

  $("reloadBtn").addEventListener("click", function () { reloadAll(true); });
  $("logoutBtn").addEventListener("click", logout);
  $("lBtn").addEventListener("click", doLogin);
  $("lPw").addEventListener("keydown", function (e) { if (e.key === "Enter") doLogin(); });
  $("lEmail").addEventListener("keydown", function (e) { if (e.key === "Enter") $("lPw").focus(); });

  session = loadSession();
  if (session && session.refresh_token) enter(); else showLogin("");
})();
