/* ===========================================================
   BUSAN FASHION WEEK — 사전 좌석 확보 관리 (hold-admin.html)

   주최측이 쓰는 화면. 브랜드·대학별 링크를 만들고, 한 쇼에 여러
   참여사가 있을 때 협의한 대로 구역을 나눠 배정한다.

   로그인은 Supabase 계정 + 스태프 명단(public.staff) 둘 다 필요하다.
   서버 함수가 매번 명단을 확인하므로, 이 화면을 우회해도 권한이
   생기지 않는다.

   메인 사이트 설정(js/config.js)에 기대지 않는다 — hold.js 와 같은 이유.
   =========================================================== */
(function () {
  "use strict";

  var SB = {
    url: "https://hjcrzdzrgmubipxcgzce.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqY3J6ZHpyZ211YmlweGNnemNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1MTcwMzEsImV4cCI6MjEwNDA5MzAzMX0.T_61-FVfL0fKkR3IDEO8x30UQGfMWBVL6oQAF5m4tF8"
  };

  /* 예약 자체를 받지 않는 쇼. 참여사 링크도 만들지 않는다. */
  var NO_RESERVATION = ["S07"];   // 부산패션디자인경진대회 & 부산컬렉션

  /* 참여사를 구분하는 색 (같은 쇼 안에서 순서대로) */
  var PALETTE = ["#0b2e9e", "#c2410c", "#0f766e", "#7c3aed", "#b91c1c", "#a16207", "#be185d", "#1d4ed8"];

  var ZONES_L = ["A", "B", "C", "D"];
  var ZONES_R = ["E", "F", "G", "H"];

  var SESSION_KEY = "bfw_hold_admin_session";
  var session = null;   // { access_token, refresh_token, expires_at, email }
  var board = null;     // holds_board 응답
  var editing = null;   // { showId, holderId|null, zones:{}, name, kind, max }

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
  function toast(msg, isErr) {
    var t = document.createElement("div");
    t.className = "toast" + (isErr ? " err" : "");
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, isErr ? 5200 : 2600);
  }

  /* ---------------- 로그인 세션 ---------------- */
  function saveSession(s) {
    session = s;
    try {
      if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch (e) {}
  }
  function loadSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch (e) { return null; }
  }
  function fromAuth(d, email) {
    return {
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expires_at: Date.now() + (d.expires_in || 3600) * 1000,
      email: (d.user && d.user.email) || email || ""
    };
  }
  function authPost(path, body) {
    return fetch(SB.url + "/auth/v1/" + path, {
      method: "POST",
      headers: { apikey: SB.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); });
  }
  function refreshIfNeeded(force) {
    if (!session) return Promise.reject(new Error("nosession"));
    if (!force && Date.now() < session.expires_at - 60 * 1000) return Promise.resolve();
    return authPost("token?grant_type=refresh_token", { refresh_token: session.refresh_token })
      .then(function (x) {
        if (!x.ok || !x.d.access_token) throw new Error("refresh");
        saveSession(fromAuth(x.d, session.email));
      });
  }

  /* 로그인 토큰으로 서버 함수 호출. 만료되면 한 번 갱신 후 재시도. */
  function rpc(fn, body, retried) {
    return refreshIfNeeded(false).then(function () {
      return fetch(SB.url + "/rest/v1/rpc/" + fn, {
        method: "POST",
        headers: {
          apikey: SB.anonKey,
          Authorization: "Bearer " + session.access_token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body || {})
      });
    }).then(function (r) {
      return r.text().then(function (t) {
        var d = null;
        try { d = t ? JSON.parse(t) : null; } catch (e) {}
        if (r.status === 401 && !retried) {
          return refreshIfNeeded(true).then(function () { return rpc(fn, body, true); });
        }
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
      if (!x.ok || !x.d.access_token) {
        return showLogin("로그인하지 못했습니다. 이메일과 비밀번호를 확인해 주세요.");
      }
      $("lPw").value = "";
      saveSession(fromAuth(x.d, email));
      return enter();
    }).catch(function () {
      $("lBtn").disabled = false;
      showLogin("통신이 원활하지 않습니다. 잠시 후 다시 시도해 주세요.");
    });
  }

  function logout() {
    saveSession(null);
    board = null;
    showLogin("로그아웃했습니다.", "info");
  }

  /* 로그인은 됐어도 스태프 명단에 없으면 들여보내지 않는다 */
  function enter() {
    return rpc("is_staff", {}).then(function (isStaff) {
      if (isStaff !== true) {
        saveSession(null);
        return showLogin("이 계정은 <b>스태프 명단에 없습니다.</b> 관리자에게 명단 등록을 요청하세요.");
      }
      $("loginView").hidden = true;
      $("mainView").hidden = false;
      $("whoAmI").textContent = session.email + " 로 로그인됨";
      return load();
    }).catch(function () {
      saveSession(null);
      showLogin("로그인이 만료되었습니다. 다시 로그인해 주세요.");
    });
  }

  /* ---------------- 데이터 ---------------- */
  function load() {
    $("shows").innerHTML = '<div class="card sub">불러오는 중…</div>';
    return rpc("holds_board", {}).then(function (d) {
      if (!d || !d.ok) {
        if (d && d.reason === "forbidden") return logout();
        throw new Error("board");
      }
      board = d;
      render();
    }).catch(function () {
      $("shows").innerHTML = '<div class="note bad">현황을 불러오지 못했습니다. 새로고침해 주세요.</div>';
    });
  }

  function holdersOf(showId) {
    return (board.holders || []).filter(function (h) { return h.show_id === showId; });
  }
  function colorOf(showId, holderId) {
    var list = holdersOf(showId);
    for (var i = 0; i < list.length; i++) if (list[i].id === holderId) return PALETTE[i % PALETTE.length];
    return "#6b7490";
  }
  /* 쇼 안에서 구역별로 누가 배정받았는지. 한 구역에 둘 이상이면 겹침. */
  function zoneOwners(showId) {
    var m = {};
    holdersOf(showId).forEach(function (h) {
      (h.zones || []).forEach(function (z) { (m[z] = m[z] || []).push(h); });
    });
    return m;
  }
  function linkOf(token) {
    return location.origin + location.pathname.replace(/[^/]*$/, "") + "hold.html?t=" + token;
  }

  /* ---------------- 그리기 ---------------- */
  function render() {
    /* 창구 스위치 */
    var open = !!board.holdsOpen;
    $("holdPill").className = "pill " + (open ? "on" : "off");
    $("holdPill").querySelector("span").textContent = open ? "열림" : "닫힘";
    $("holdDesc").textContent = open
      ? "참여사가 링크로 좌석을 고치고 저장할 수 있습니다."
      : "참여사는 링크로 확보 내용을 볼 수만 있고 고칠 수 없습니다.";
    $("holdToggle").textContent = open ? "창구 닫기" : "창구 열기";
    $("holdToggle").className = "btn " + (open ? "bad" : "pri");

    /* 점검 : 예약 열기 전에 잡아내야 할 이상 */
    var alerts = [];
    if (board.reservationsOpen) {
      alerts.push('<div class="note warn"><h4>일반 관람객 예약이 열려 있습니다</h4>' +
        "사전 확보 기간에는 보통 일반 예약을 닫아둡니다. 확보 중인 좌석과 일반 예약이 동시에 진행되고 있는지 확인해 주세요.</div>");
    }
    var odd = [];
    (board.shows || []).forEach(function (s) {
      if (NO_RESERVATION.indexOf(s.id) >= 0) {
        if (s.locked > 0 || holdersOf(s.id).length) odd.push(s.id + " 예약을 받지 않는 쇼인데 잠금/참여사가 있음");
        return;
      }
      if (s.seating_mode !== "free") odd.push(s.id + " 예약 방식이 '" + s.seating_mode + "' (다른 쇼는 자유석)");
      var owners = zoneOwners(s.id);
      Object.keys(owners).forEach(function (z) {
        if (owners[z].length > 1) {
          odd.push(s.id + " " + z + "구역이 " + owners[z].map(function (h) { return h.name; }).join(" · ") + " 에 겹쳐 배정됨");
        }
      });
    });
    if (odd.length) {
      alerts.push('<div class="note warn"><h4>확인이 필요한 항목 ' + odd.length + "건</h4>" +
        odd.map(function (t) { return "· " + esc(t); }).join("<br>") + "</div>");
    }
    $("alerts").innerHTML = alerts.join("");

    /* 쇼 목록 */
    var html = [];
    (board.shows || []).forEach(function (s) {
      if (NO_RESERVATION.indexOf(s.id) >= 0) return;
      html.push(showCard(s));
    });
    html.push('<div class="sub" style="padding:0 4px">부산패션디자인경진대회 & 부산컬렉션(S07)은 예약을 받지 않아 목록에서 뺐습니다.</div>');
    $("shows").innerHTML = html.join("");
  }

  function showCard(s) {
    var holders = holdersOf(s.id);
    var held = holders.reduce(function (a, h) { return a + (h.held || 0); }, 0);
    var publicLeft = Math.max(0, s.capacity - s.locked - s.reserved);
    var owners = zoneOwners(s.id);

    var h = [];
    h.push('<div class="card" data-show="' + esc(s.id) + '">');
    h.push('<div class="show-h"><div>' +
      '<div class="t">' + esc(s.id) + " · " + esc(s.title_ko) + "</div>" +
      '<div class="l">' + esc(s.date) + " " + esc(s.start_time) + (s.lineup ? " · " + esc(s.lineup) : "") + "</div>" +
      "</div>" +
      '<div class="stats">' +
        '<span class="stat">정원 <b>' + s.capacity + "</b></span>" +
        '<span class="stat">참여사 확보 <b>' + held + "</b></span>" +
        (s.staff_locked ? '<span class="stat">주최측 잠금 <b>' + s.staff_locked + "</b></span>" : "") +
        (s.reserved ? '<span class="stat">일반 예약 <b>' + s.reserved + "</b></span>" : "") +
        '<span class="stat hi">일반 공개 잔여 <b>' + publicLeft + "</b></span>" +
      "</div></div>");

    /* 구역 배정 현황 */
    function zc(z) {
      var list = owners[z] || [];
      var cls = "zc" + (list.length ? " taken" : "") + (list.length > 1 ? " clash" : "");
      var style = list.length === 1 ? ' style="border-color:' + colorOf(s.id, list[0].id) + '"' : "";
      var names = list.length ? list.map(function (x) { return esc(x.name); }).join("<br>") : "미배정";
      return '<div class="' + cls + '"' + style + "><b>" + z + "</b><span>" + names + "</span></div>";
    }
    h.push('<div class="zmap"><div class="zcol">' + ZONES_L.map(zc).join("") + '</div>' +
      '<div class="zrun" title="런웨이"></div>' +
      '<div class="zcol">' + ZONES_R.map(zc).join("") + "</div></div>");

    /* 참여사 표 */
    if (holders.length) {
      h.push('<div class="tbl-wrap"><table><thead><tr>' +
        "<th>참여사</th><th>구역</th><th>한도</th><th>확보</th><th>담당자</th><th>마지막 저장</th><th></th>" +
        "</tr></thead><tbody>");
      holders.forEach(function (x) {
        h.push("<tr>" +
          '<td><span class="dot" style="background:' + colorOf(s.id, x.id) + '"></span><b>' + esc(x.name) + "</b> " +
            '<span class="kind">' + (x.kind === "univ" ? "대학" : "브랜드") + "</span></td>" +
          '<td class="mono">' + (x.zones && x.zones.length ? esc(x.zones.join(" · ")) : '<span class="sub">전 구역</span>') + "</td>" +
          '<td class="mono">' + (x.max_seats != null ? x.max_seats + "석" : "—") + "</td>" +
          '<td class="mono"><b>' + (x.held || 0) + "</b>석</td>" +
          "<td>" + (x.contact_name ? esc(x.contact_name) + '<br><span class="sub mono">' + esc(x.contact_phone || "") + "</span>" : '<span class="sub">—</span>') + "</td>" +
          '<td class="sub mono">' + when(x.saved_at) + "</td>" +
          '<td><div class="acts">' +
            '<button class="btn sm pri" data-act="copy" data-token="' + esc(x.token) + '" type="button">링크 복사</button>' +
            '<button class="btn sm" data-act="edit" data-id="' + esc(x.id) + '" type="button">수정</button>' +
            '<button class="btn sm bad" data-act="del" data-id="' + esc(x.id) + '" type="button">삭제</button>' +
          "</div></td></tr>");
      });
      h.push("</tbody></table></div>");
    } else {
      h.push('<div class="empty">아직 참여사가 없습니다.</div>');
    }

    /* 편집 폼 (이 쇼를 편집 중일 때만) */
    if (editing && editing.showId === s.id) {
      h.push(editForm(s, owners));
    } else {
      h.push('<div style="margin-top:12px"><button class="btn sm" data-act="add" data-show="' + esc(s.id) + '" type="button">+ 참여사 추가</button></div>');
    }

    h.push("</div>");
    return h.join("");
  }

  function editForm(s, owners) {
    var e = editing;
    function zb(z) {
      var others = (owners[z] || []).filter(function (x) { return x.id !== e.holderId; });
      var on = !!e.zones[z];
      var cls = (on ? "on" : "") + (others.length ? " used" : "");
      var title = others.length ? ' title="' + esc(others.map(function (x) { return x.name; }).join(", ")) + ' 에 이미 배정됨"' : "";
      return '<button type="button" class="' + cls + '" data-zone="' + z + '"' + title + ">" + z + "</button>";
    }
    return '<div class="form" id="editForm">' +
      "<h2 style=\"font-size:.95rem\">" + (e.holderId ? "참여사 수정" : "참여사 추가") + "</h2>" +
      '<div class="row" style="margin-top:10px">' +
        '<div><label>참여사 이름</label><input type="text" id="fName" value="' + esc(e.name) + '"' +
          (e.holderId ? " disabled" : "") + ' placeholder="예) 메르최 / 카마모에X소티에" /></div>' +
        '<div><label>구분</label><select id="fKind">' +
          '<option value="brand"' + (e.kind === "brand" ? " selected" : "") + ">브랜드</option>" +
          '<option value="univ"' + (e.kind === "univ" ? " selected" : "") + ">대학</option>" +
        "</select></div>" +
        '<div><label>확보 한도 (비우면 제한 없음)</label><input type="number" id="fMax" min="1" max="300" value="' +
          (e.max != null ? e.max : "") + '" /></div>' +
      "</div>" +
      '<div class="row2"><label>배정 구역 (아무것도 안 고르면 전 구역)</label>' +
        '<div class="zpick">' + ZONES_L.map(zb).join("") + '<span class="gap"></span>' + ZONES_R.map(zb).join("") + "</div>" +
        '<div class="hint">노란 테두리는 같은 쇼의 다른 참여사에 이미 배정된 구역입니다. 겹쳐도 저장은 되지만, 좌석은 먼저 저장한 쪽이 가져갑니다.</div>' +
      "</div>" +
      (e.holderId ? "" : '<div class="hint">협업 쇼(예: 카마모에X소티에)는 참여사 하나로 등록하세요.</div>') +
      '<div class="foot"><span id="fMsg" class="sub"></span>' +
        '<button class="btn" data-act="cancel" type="button">취소</button>' +
        '<button class="btn pri" data-act="save" type="button">' + (e.holderId ? "수정 저장" : "추가하고 링크 만들기") + "</button>" +
      "</div></div>";
  }

  /* ---------------- 조작 ---------------- */
  document.addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest("button") : null;
    if (!b || b.disabled) return;

    if (b.hasAttribute("data-zone") && editing) {
      var z = b.getAttribute("data-zone");
      editing.zones[z] = !editing.zones[z];
      rerenderKeepForm();
      return;
    }

    var act = b.getAttribute("data-act");
    if (!act) return;

    if (act === "copy") {
      var url = linkOf(b.getAttribute("data-token"));
      copyText(url).then(function () { toast("링크를 복사했습니다"); })
        .catch(function () { window.prompt("아래 링크를 복사하세요", url); });
      return;
    }
    if (act === "add") {
      editing = { showId: b.getAttribute("data-show"), holderId: null, zones: {}, name: "", kind: "brand", max: null };
      render();
      var f = $("fName"); if (f) f.focus();
      return;
    }
    if (act === "edit") {
      var x = (board.holders || []).filter(function (y) { return y.id === b.getAttribute("data-id"); })[0];
      if (!x) return;
      var zs = {}; (x.zones || []).forEach(function (q) { zs[q] = true; });
      editing = { showId: x.show_id, holderId: x.id, zones: zs, name: x.name, kind: x.kind, max: x.max_seats };
      render();
      return;
    }
    if (act === "cancel") { editing = null; render(); return; }
    if (act === "save") { return saveHolder(); }
    if (act === "del") { return deleteHolder(b.getAttribute("data-id")); }
    if (act === "restore") { return restoreLog(b.getAttribute("data-log")); }
  });

  /* 폼 입력값을 잃지 않고 다시 그린다 */
  function rerenderKeepForm() {
    if (editing) {
      var n = $("fName"), k = $("fKind"), m = $("fMax");
      if (n && !n.disabled) editing.name = n.value;
      if (k) editing.kind = k.value;
      if (m) editing.max = m.value === "" ? null : parseInt(m.value, 10);
    }
    render();
  }

  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t);
    return Promise.reject(new Error("noclip"));
  }

  function saveHolder() {
    rerenderKeepForm();
    var e = editing;
    var name = (e.name || "").trim();
    var msg = $("fMsg");
    if (!name) { msg.textContent = "참여사 이름을 입력하세요"; msg.style.color = "var(--bad)"; return; }
    if (e.max != null && (isNaN(e.max) || e.max < 1 || e.max > 300)) {
      msg.textContent = "한도는 1~300 사이로 입력하세요"; msg.style.color = "var(--bad)"; return;
    }
    // 새로 추가할 때 같은 쇼에 같은 이름이 있으면, 서버는 '기존 참여사 수정'으로 처리한다.
    // 모르고 덮어쓰지 않도록 미리 막는다.
    if (!e.holderId) {
      var dup = holdersOf(e.showId).filter(function (x) { return x.name === name; })[0];
      if (dup) { msg.textContent = "이 쇼에 같은 이름의 참여사가 이미 있습니다"; msg.style.color = "var(--bad)"; return; }
    }
    var zones = Object.keys(e.zones).filter(function (z) { return e.zones[z]; }).sort();
    msg.textContent = "저장 중…"; msg.style.color = "";

    rpc("holder_upsert", {
      p_show_id: e.showId, p_name: name, p_kind: e.kind,
      p_max_seats: e.max, p_zones: zones.length ? zones : null, p_close_at: null
    }).then(function (d) {
      if (!d || !d.ok) {
        var m2 = $("fMsg"); if (m2) { m2.textContent = "저장하지 못했습니다" + (d && d.reason ? " (" + d.reason + ")" : ""); m2.style.color = "var(--bad)"; }
        return;
      }
      var wasNew = !e.holderId;
      editing = null;
      return load().then(function () {
        if (d.outOfZone > 0) {
          toast(name + " 의 확보 좌석 " + d.outOfZone + "석이 새 구역 밖에 있습니다. 참여사가 다음에 저장하면 풀립니다.", true);
        } else if (wasNew) {
          copyText(linkOf(d.token)).then(function () { toast(name + " 추가 — 링크를 복사했습니다"); })
            .catch(function () { toast(name + " 추가했습니다. '링크 복사'를 눌러 주세요"); });
        } else {
          toast(name + " 수정했습니다");
        }
      });
    }).catch(function () {
      var m3 = $("fMsg"); if (m3) { m3.textContent = "통신 오류 — 다시 시도해 주세요"; m3.style.color = "var(--bad)"; }
    });
  }

  function deleteHolder(id) {
    var x = (board.holders || []).filter(function (y) { return y.id === id; })[0];
    if (!x) return;
    var warn = "'" + x.name + "' 를 삭제할까요?\n\n링크가 더 이상 열리지 않습니다.";
    if (x.held > 0) {
      warn += "\n\n이 참여사가 확보한 " + x.held + "석이 풀려 일반 공개로 돌아갑니다." +
        "\n(좌석 목록은 변경 이력에 보관됩니다)";
    }
    if (!window.confirm(warn)) return;
    rpc("holder_delete", { p_id: id }).then(function (d) {
      if (!d || !d.ok) return toast("삭제하지 못했습니다" + (d && d.reason ? " (" + d.reason + ")" : ""), true);
      toast(x.name + " 삭제" + (d.released ? " — " + d.released + "석 해제" : ""));
      if (editing && editing.holderId === id) editing = null;
      load();
    }).catch(function () { toast("통신 오류 — 다시 시도해 주세요", true); });
  }

  /* 창구 켜기/끄기 */
  $("holdToggle").addEventListener("click", function () {
    var next = !board.holdsOpen;
    var ask = next
      ? "확보 창구를 열까요?\n\n링크를 받은 참여사가 좌석을 고르고 저장할 수 있게 됩니다."
      : "확보 창구를 닫을까요?\n\n참여사는 확보 내용을 볼 수만 있고 고칠 수 없게 됩니다.\n확보된 좌석은 그대로 유지됩니다.";
    if (!window.confirm(ask)) return;
    $("holdToggle").disabled = true;
    rpc("holds_set_open", { p_open: next }).then(function (d) {
      $("holdToggle").disabled = false;
      if (!d || !d.ok) return toast("바꾸지 못했습니다", true);
      // 서버가 돌려준 실제 상태로 확인한다 (요청한 값과 다르면 알린다)
      if (d.holdsOpen !== next) return toast("스위치가 바뀌지 않았습니다. 새로고침 후 다시 확인해 주세요", true);
      toast(next ? "확보 창구를 열었습니다" : "확보 창구를 닫았습니다");
      load();
    }).catch(function () {
      $("holdToggle").disabled = false;
      toast("통신 오류 — 다시 시도해 주세요", true);
    });
  });

  /* 엑셀(CSV) 내려받기 — 좌석 하나가 한 줄 */
  $("exportBtn").addEventListener("click", function () {
    rpc("hold_export", {}).then(function (rows) {
      rows = rows || [];
      var head = ["쇼", "패션쇼", "날짜", "시각", "참여사", "구분", "좌석", "구역", "번호", "담당자", "연락처", "마지막 저장"];
      var lines = [head];
      rows.forEach(function (r) {
        lines.push([r.show_id, r.title_ko, r.show_date, r.start_time, r.holder_name,
          r.kind === "univ" ? "대학" : r.kind === "brand" ? "브랜드" : "주최측",
          r.seat_id, r.zone_code, r.seat_num, r.contact_name || "", r.contact_phone || "", when(r.saved_at)]);
      });
      var csv = lines.map(function (row) {
        return row.map(function (v) {
          v = String(v == null ? "" : v);
          return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
        }).join(",");
      }).join("\r\n");
      // 엑셀이 한글을 깨뜨리지 않도록 BOM 을 붙인다
      var blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
      var a = document.createElement("a");
      var d = new Date(Date.now() + 9 * 3600 * 1000);
      a.href = URL.createObjectURL(blob);
      a.download = "BFW_사전좌석확보_" + d.toISOString().slice(0, 16).replace(/[-:T]/g, "") + ".csv";
      document.body.appendChild(a); a.click(); a.remove();
      toast(rows.length + "석 내려받았습니다");
    }).catch(function () { toast("내려받지 못했습니다", true); });
  });

  /* 변경 이력 */
  function loadLog() {
    $("logBox").innerHTML = '<div class="sub" style="margin-top:12px">불러오는 중…</div>';
    rpc("hold_log", { p_show_id: null, p_limit: 200 }).then(function (rows) {
      rows = rows || [];
      if (!rows.length) { $("logBox").innerHTML = '<div class="empty">아직 이력이 없습니다.</div>'; return; }
      var ACT = { save: "저장", restore: "되돌림", "delete": "삭제" };
      var h = ['<div class="tbl-wrap"><table class="log"><thead><tr>' +
        "<th>시각</th><th>쇼</th><th>참여사</th><th>동작</th><th>좌석 수</th><th>바뀐 뒤 좌석</th><th></th></tr></thead><tbody>"];
      rows.forEach(function (r) {
        h.push("<tr>" +
          '<td class="mono">' + when(r.created_at) + "</td>" +
          '<td class="mono">' + esc(r.show_id) + "</td>" +
          "<td>" + esc(r.holder_name) + (r.contact_name ? '<br><span class="sub">' + esc(r.contact_name) + "</span>" : "") + "</td>" +
          "<td>" + (ACT[r.action] || esc(r.action)) + "</td>" +
          '<td class="mono">' + r.prev_count + " → <b>" + r.seat_count + "</b></td>" +
          '<td class="seats">' + (r.seat_ids && r.seat_ids.length ? esc(r.seat_ids.join(" ")) : "—") + "</td>" +
          "<td>" + (r.action !== "delete" && r.prev_count > 0
            ? '<button class="btn sm" data-act="restore" data-log="' + r.id + '" type="button">이 직전으로</button>'
            : "") + "</td></tr>");
      });
      h.push("</tbody></table></div>");
      $("logBox").innerHTML = h.join("");
    }).catch(function () {
      $("logBox").innerHTML = '<div class="note bad">이력을 불러오지 못했습니다.</div>';
    });
  }
  $("logBtn").addEventListener("click", loadLog);

  function restoreLog(id) {
    if (!window.confirm("이 저장이 일어나기 직전 상태로 되돌릴까요?\n\n되돌린 것도 이력에 남습니다.")) return;
    rpc("hold_restore", { p_log_id: parseInt(id, 10), p_which: "prev" }).then(function (d) {
      if (!d || !d.ok) {
        var why = d && d.reason === "taken"
          ? "그 사이 다른 참여사가 가져간 좌석이 있어 되돌릴 수 없습니다: " + (d.seats || []).join(", ")
          : d && d.reason === "noholder" ? "삭제된 참여사라 되돌릴 수 없습니다. 이력의 좌석 목록을 참고해 다시 등록해 주세요."
          : "되돌리지 못했습니다" + (d && d.reason ? " (" + d.reason + ")" : "");
        return toast(why, true);
      }
      toast(d.restored + "석으로 되돌렸습니다");
      load(); loadLog();
    }).catch(function () { toast("통신 오류 — 다시 시도해 주세요", true); });
  }

  $("reloadBtn").addEventListener("click", function () { load(); });
  $("logoutBtn").addEventListener("click", logout);
  $("lBtn").addEventListener("click", doLogin);
  $("lPw").addEventListener("keydown", function (e) { if (e.key === "Enter") doLogin(); });
  $("lEmail").addEventListener("keydown", function (e) { if (e.key === "Enter") $("lPw").focus(); });

  /* ---------------- 시작 ---------------- */
  session = loadSession();
  if (session && session.refresh_token) enter();
  else showLogin("");
})();
