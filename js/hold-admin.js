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
        if (pick) selectShow(pick);
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

  function renderSwitch() {
    var open = !!board.holdsOpen;
    $("holdPill").className = "pill " + (open ? "on" : "off");
    $("holdPill").querySelector("span").textContent = open ? "열림" : "닫힘";
    $("holdDesc").textContent = open
      ? "참여사가 링크로 좌석을 고르고 저장할 수 있습니다."
      : "참여사는 링크로 확보 내용을 볼 수만 있고 고칠 수 없습니다.";
    $("holdToggle").textContent = open ? "창구 닫기" : "창구 열기";
    $("holdToggle").className = "btn " + (open ? "bad" : "pri");
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
      if (NO_RESERVATION.indexOf(s.id) >= 0) {
        if (s.locked > 0 || hs.length) out.push(esc(s.id) + " 은 예약을 받지 않는 쇼인데 잠긴 좌석이나 참여사가 있습니다.");
        return;
      }
      if (s.seating_mode !== "free") out.push(esc(s.id) + " 예약 방식이 '" + esc(s.seating_mode) + "' 입니다 (다른 쇼는 자유석).");
      if (hs.length > 1) {
        hs.forEach(function (h) {
          if (h.allowed_seats == null) {
            out.push(esc(s.id) + " <b>" + esc(h.name) + "</b> 는 배정 범위가 없어 <b>전 좌석</b>을 고를 수 있습니다. 여러 참여사 쇼라면 좌석을 나눠 배정하세요.");
          }
        });
      }
      hs.forEach(function (h) {
        if (h.zones && h.zones.length) out.push(esc(s.id) + " " + esc(h.name) + " 에 이전 방식의 구역 제한(" + esc(h.zones.join(",")) + ")이 남아 있습니다. '수정'에서 저장하면 해제됩니다.");
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
      var left = Math.max(0, s.capacity - s.locked - s.reserved);
      h.push('<button type="button" class="shw' + (s.id === showId ? " on" : "") + '" data-show="' + esc(s.id) + '">' +
        "<b>" + esc(s.id) + " · " + esc(s.title_ko) + "</b>" +
        "<span>" + esc(s.date.slice(5)) + " " + esc(s.start_time) + " · 참여사 " + hs.length + " · 일반 " + left + "</span></button>");
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
    $("showTitle").textContent = s.id + " · " + s.titleKo;
    $("showSub").textContent = s.date + " " + s.startTime + (s.lineup ? " · " + s.lineup : "");

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
          '<div class="nm">' + esc(x.name) + '<span class="kind">' + (x.kind === "univ" ? "대학" : "브랜드") + "</span></div>" +
          '<div class="meta">배정 <b>' + allot + "</b> · 확보 <b>" + x.held + "</b>석" +
            (x.maxSeats != null ? " · 한도 <b>" + x.maxSeats + "</b>" : "") +
            (x.contactName ? " · " + esc(x.contactName) : "") +
            (x.savedAt ? " · " + when(x.savedAt) : "") + "</div>" +
        "</div>" +
        '<div class="acts">' +
          '<button class="btn sm pri" data-act="copy" data-token="' + esc(x.token) + '" type="button">링크</button>' +
          '<button class="btn sm" data-act="pickAllot" data-id="' + esc(x.id) + '" type="button">배정 보기</button>' +
          '<button class="btn sm" data-act="edit" data-id="' + esc(x.id) + '" type="button">수정</button>' +
          '<button class="btn sm bad" data-act="del" data-id="' + esc(x.id) + '" type="button">삭제</button>' +
        "</div></div>");
    });
    $("holderList").innerHTML = h.join("");
  }

  function renderForm() {
    if (!editing) { $("formBox").innerHTML = ""; return; }
    var e = editing;
    $("formBox").innerHTML = '<div class="form">' +
      '<div class="row">' +
        '<div><label>참여사 이름</label><input type="text" id="fName" value="' + esc(e.name) + '"' + (e.holderId ? " disabled" : "") + ' placeholder="메르최 / 카마모에X소티에" /></div>' +
        '<div><label>구분</label><select id="fKind"><option value="brand"' + (e.kind === "brand" ? " selected" : "") + '>브랜드</option><option value="univ"' + (e.kind === "univ" ? " selected" : "") + '>대학</option></select></div>' +
        '<div><label>확보 한도(선택)</label><input type="number" id="fMax" min="1" max="300" value="' + (e.max != null ? e.max : "") + '" placeholder="없음" /></div>' +
      "</div>" +
      (e.holderId ? "" : '<div class="sub" style="margin-top:6px">협업 쇼(예: 카마모에X소티에)는 참여사 하나로 등록하세요. 추가한 뒤 지도에서 좌석을 골라 배정합니다.</div>') +
      '<div class="foot"><span id="fMsg" class="sub"></span>' +
        '<button class="btn sm" data-act="cancel" type="button">취소</button>' +
        '<button class="btn sm pri" data-act="save" type="button">' + (e.holderId ? "저장" : "추가하고 링크 만들기") + "</button>" +
      "</div></div>";
    var n = $("fName"); if (n && !e.holderId) n.focus();
  }

  function renderTool() {
    var d = mapData, cur = $("allotTo").value;
    $("allotTo").innerHTML = d.holders.length
      ? d.holders.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name) + "</option>"; }).join("")
      : '<option value="">(참여사 없음)</option>';
    if (focusId) $("allotTo").value = focusId;
    else if (cur && holderById(cur)) $("allotTo").value = cur;
    syncTool();
  }
  function syncTool() {
    var n = selection.length, hasH = mapData && mapData.holders.length > 0;
    $("selCnt").textContent = n;
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
    var gap = 1, sep = 8, lab = 34, run = 64, ends = 68;
    var availH = box.clientHeight || 700;
    var h = Math.floor((availH - ends - seps * sep - (rows + seps - 1) * gap) / rows);
    h = Math.max(9, Math.min(20, h));
    var availW = box.clientWidth || 600;
    var w = Math.floor((availW - 16 - run - 2 * lab - 8 * gap) / 6);
    w = Math.max(16, Math.min(44, w));
    return { w: w, h: h, gap: gap, sep: sep, lab: lab, run: run };
  }

  function renderMap() {
    var d = mapData, ai = allotIndex();
    $("mapTitle").textContent = d.show.id + " · " + d.show.titleKo;
    $("mapSub").textContent = d.show.date + " " + d.show.startTime;
    renderLegend();

    map = window.HallMap.create($("map"), {
      zones: d.zones,
      seats: d.seats,
      size: fitSize(d),
      drag: true,
      decorate: function (x, el) {
        var who = null, how = "";
        if (x.lock === "staff") {
          el.style.background = STAFF_COLOR; el.style.borderColor = STAFF_COLOR; how = "주최측 확보";
        } else if (x.lock) {
          var c = colorOf(x.lock); el.style.background = c; el.style.borderColor = c;
          who = holderById(x.lock); how = (who ? who.name : "참여사") + " 확보";
        } else if (x.res) {
          el.style.background = RESERVED_COLOR; el.style.borderColor = RESERVED_COLOR; how = "일반 예약";
        } else if (ai[x.id]) {
          var c2 = colorOf(ai[x.id]); el.style.background = tint(c2, 0.2); el.style.borderColor = tint(c2, 0.6);
          who = holderById(ai[x.id]); how = (who ? who.name : "참여사") + " 배정";
        }
        if (focusId && x.lock !== focusId && ai[x.id] !== focusId) el.style.opacity = ".28";
        el.title = x.id + " (" + x.t + "단 " + x.r + "열)" + (how ? " — " + how : "");
      },
      onZone: function (code, seats) {
        var ids = seats.map(function (s) { return s.id; });
        var all = ids.every(function (id) { return selection.indexOf(id) >= 0; });
        map.addSelection(ids, !all);
      },
      onChange: function (sel) { selection = sel; syncTool(); }
    });
    if (selection.length) map.setSelection(selection);

  }

  function renderLegend() {
    var d = mapData;
    $("legend").innerHTML = '<div class="hm-legend">' +
      '<span><i style="background:#fff"></i>빈 좌석</span>' +
      '<span><i style="background:' + tint(PALETTE[0], 0.2) + ";border-color:" + tint(PALETTE[0], 0.6) + '"></i>배정(연한 색)</span>' +
      '<span><i style="background:' + PALETTE[0] + ";border-color:" + PALETTE[0] + '"></i>확보(진한 색)</span>' +
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
    var name = e.holderId ? e.name : ($("fName").value || "").trim();
    var kind = $("fKind").value;
    var mx = $("fMax").value === "" ? null : parseInt($("fMax").value, 10);
    var msg = $("fMsg");
    function err(t) { msg.textContent = t; msg.style.color = "var(--bad)"; }
    if (!name) return err("이름을 입력하세요");
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
            copyText(url).then(function () {
              toast(name + " 추가 — 링크 복사됨. 이제 지도에서 좌석을 골라 '배정에 추가'를 누르세요");
            }).catch(function () { toast(name + " 추가했습니다. 지도에서 좌석을 골라 배정하세요"); });
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

  /* ---- 창구 ---- */
  $("holdToggle").addEventListener("click", function () {
    var next = !board.holdsOpen;
    if (!window.confirm(next
        ? "확보 창구를 열까요?\n\n링크를 받은 참여사가 좌석을 고르고 저장할 수 있게 됩니다."
        : "확보 창구를 닫을까요?\n\n참여사는 확보 내용을 볼 수만 있습니다. 확보된 좌석은 그대로 유지됩니다.")) return;
    $("holdToggle").disabled = true;
    rpc("holds_set_open", { p_open: next }).then(function (d) {
      $("holdToggle").disabled = false;
      if (!d || !d.ok) return toast("바꾸지 못했습니다", true);
      if (d.holdsOpen !== next) return toast("스위치가 바뀌지 않았습니다. 새로고침 후 확인해 주세요", true);
      toast(next ? "확보 창구를 열었습니다" : "확보 창구를 닫았습니다");
      loadBoard();
    }).catch(function () { $("holdToggle").disabled = false; toast("통신 오류", true); });
  });

  /* ---- 엑셀 ---- */
  $("exportBtn").addEventListener("click", function () {
    rpc("hold_export", {}).then(function (rows) {
      rows = rows || [];
      var lines = [["쇼", "패션쇼", "날짜", "시각", "참여사", "구분", "좌석", "구역", "번호", "담당자", "연락처", "마지막 저장"]];
      rows.forEach(function (r) {
        lines.push([r.show_id, r.title_ko, r.show_date, r.start_time, r.holder_name,
          r.kind === "univ" ? "대학" : r.kind === "brand" ? "브랜드" : "주최측",
          r.seat_id, r.zone_code, r.seat_num, r.contact_name || "", r.contact_phone || "", when(r.saved_at)]);
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

  /* ---- 이력 ---- */
  var ACT = { save: "확보 저장", restore: "되돌림", "delete": "참여사 삭제", allot: "배정 변경", reallot: "배정 이동으로 확보 해제", staff: "주최측" };
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

  $("reloadBtn").addEventListener("click", function () { reloadAll(true); });
  $("logoutBtn").addEventListener("click", logout);
  $("lBtn").addEventListener("click", doLogin);
  $("lPw").addEventListener("keydown", function (e) { if (e.key === "Enter") doLogin(); });
  $("lEmail").addEventListener("keydown", function (e) { if (e.key === "Enter") $("lPw").focus(); });

  session = loadSession();
  if (session && session.refresh_token) enter(); else showLogin("");
})();
