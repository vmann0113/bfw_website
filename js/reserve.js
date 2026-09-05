/* ===========================================================
   BUSAN FASHION WEEK — audience reservation (register.html)
   =========================================================== */
(function () {
  "use strict";
  var BFW = window.BFW;
  var Api = window.BFWApi;
  var cfg = BFW.load();
  var $ = function (id) { return document.getElementById(id); };
  // 선택 항목: [{ showId, zoneCode, seatId, seatLabel }] — 쇼당 한 자리
  var selected = [];
  var avail = {};      // { showId: {capacity, reserved, remaining, closed} }
  var zoneAvail = {};  // { showId: [ {code,label,side,sort,rows,seatCount,remaining} ] }
  var seatCtx = null;  // 좌석 시트가 다루는 { showId, zoneCode, zone }

  function selIndex(showId) {
    for (var i = 0; i < selected.length; i++) if (selected[i].showId === showId) return i;
    return -1;
  }
  function selOf(showId) { var i = selIndex(showId); return i >= 0 ? selected[i] : null; }
  // 쇼마다 예약 방식이 다르다: 'assigned'(좌석 지정) | 'free'(자유석)
  function modeOf(showId) { return (avail[showId] && avail[showId].mode) || "free"; }

  /* ---- brand wordmark ---- */
  (function () {
    var b = cfg.brand, nav = document.querySelector(".nav .brand");
    if (b.logo) nav.innerHTML = '<img class="brand-logo" src="' + b.logo + '" alt="">';
    else nav.innerHTML = "<b>" + esc(b.textPrimary) + '</b><span class="bul">●</span><b>' + esc(b.textSecondary) + "</b>";
  })();

  var shows = (cfg.shows || []).slice();
  $("mShows").textContent = shows.length + " Shows";
  var caps = shows.map(function (s) { return s.cap || cfg.reserve.defaultCap || 300; });
  $("mCap").textContent = "쇼당 " + (cfg.reserve.defaultCap || 300) + "석";
  $("bookNote").textContent = cfg.reserve.note || "";

  /* ---- closed state ---- */
  if (!cfg.reserve.open) {
    $("showGroups").classList.add("hidden");
    $("bookNote").classList.add("hidden");
    $("closedNote").style.display = "block";
  } else {
    $("showGroups").innerHTML = '<p class="lookup-empty">잔여 좌석을 불러오는 중…</p>';
    refreshAvailability();
  }

  // pull live seat counts, then render
  function refreshAvailability() {
    return Promise.all([Api.availability(), Api.zoneAvailability()]).then(function (res) {
      avail = res[0] || {};
      zoneAvail = res[1] || {};
      renderGroups();
    }).catch(function () {
      avail = {}; zoneAvail = {};
      renderGroups();
    });
  }

  /* ---- helpers ---- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function showById(id) { for (var i = 0; i < shows.length; i++) if (shows[i].id === id) return shows[i]; return null; }
  function capOf(s) { return (avail[s.id] && avail[s.id].capacity) || s.cap || cfg.reserve.defaultCap || 300; }
  function remainOf(s) {
    if (avail[s.id]) return Math.max(0, avail[s.id].remaining);
    return capOf(s);
  }
  // 쇼 전날 자정이 지나면 서버가 마감으로 표시한다
  function closedOf(s) { return !!(avail[s.id] && avail[s.id].closed); }
  function dispCode(code) { return "BFW-" + code; }
  function qrSvg(text) {
    try {
      var qr = qrcode(0, "M");
      qr.addData(text);
      qr.make();
      return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    } catch (e) { return '<div style="font:11px monospace;color:#888;padding:8px">' + esc(text) + "</div>"; }
  }

  /* ---- render show grid grouped by day ---- */
  function renderGroups() {
    var wrap = $("showGroups");
    wrap.innerHTML = "";
    var days = [];
    shows.forEach(function (s) { if (days.indexOf(s.day) < 0) days.push(s.day); });

    days.forEach(function (day) {
      var inDay = shows.filter(function (s) { return s.day === day; });
      var first = inDay[0] || {};
      var group = document.createElement("div");
      group.className = "day-group";
      group.innerHTML =
        '<div class="day-head"><div class="d">Day ' + esc(day) + '</div>' +
        '<div class="dt">' + esc(first.date || "") + (first.dow ? " (" + esc(first.dow) + ")" : "") + "</div></div>" +
        '<div class="show-grid"></div>';
      var grid = group.querySelector(".show-grid");

      inDay.forEach(function (s) {
        var cap = capOf(s), remain = remainOf(s);
        var closed = closedOf(s), full = remain <= 0, blocked = full || closed;
        var low = !blocked && remain > 0 && remain <= 30;
        var mySel = selOf(s.id), isSel = !!mySel;
        var pct = Math.min(100, Math.round(((cap - remain) / cap) * 100));
        var card = document.createElement("button");
        card.type = "button";
        card.className = "show-card" + (isSel ? " sel" : "") + (blocked ? " full" : "");
        card.setAttribute("data-id", s.id);
        card.innerHTML =
          '<div class="sc-top"><span class="sc-time">' + esc(s.time || "") + (s.end ? "–" + esc(s.end) : "") + "</span>" +
          (blocked ? '<span class="full-pill">' + (closed ? "종료" : "마감") + "</span>" : '<span class="sc-check">✓</span>') + "</div>" +
          '<div class="sc-title">' + esc(s.title || "") + "</div>" +
          (s.titleKo ? '<div class="sc-ko">' + esc(s.titleKo) + "</div>" : "") +
          '<div class="sc-venue">' + esc(s.lineup || s.venue || "") + "</div>" +
          (s.tbd ? '<div class="tbd-tag">참여 브랜드 추첨 배치 예정</div>' : "") +
          (mySel ? '<div class="sc-seat">' + (mySel.seatLabel ? "선택한 자리 · " + esc(mySel.seatLabel) : "선택됨 · 자유석") + "</div>" : "") +
          '<div class="cap">' +
            '<div class="cap-bar"><div class="cap-fill" style="width:' + pct + '%;' + (low || blocked ? "background:var(--coral)" : "") + '"></div></div>' +
            '<div class="cap-row">' +
              (closed
                ? '<span class="cap-remain low">예약 기간 종료</span>'
                : full
                ? '<span class="cap-remain low">예약 마감</span>'
                : '<span class="cap-remain' + (low ? " low" : "") + '">잔여 ' + remain + '석</span>') +
              '<span class="cap-total">' + (cap - remain) + " / " + cap + "</span>" +
            "</div>" +
          "</div>";
        if (!blocked) card.addEventListener("click", function () {
          if (modeOf(s.id) === "assigned") openSeatSheet(s.id);
          else toggleFree(s.id);
        });
        grid.appendChild(card);
      });
      wrap.appendChild(group);
    });
  }

  /* 자유석 쇼 : 좌석 없이 선택/해제만 한다 */
  function toggleFree(showId) {
    var i = selIndex(showId);
    if (i >= 0) selected.splice(i, 1);
    else selected.push({ showId: showId, zoneCode: null, seatId: null, seatLabel: null });
    renderGroups();
    syncBar();
  }

  function unselect(showId) {
    var i = selIndex(showId);
    if (i >= 0) selected.splice(i, 1);
    renderGroups();
    syncBar();
  }

  /* ---- 좌석 시트 1단계 : 구역 고르기 ---- */
  function openSeatSheet(showId) {
    var s = showById(showId);
    if (!s) return;
    seatCtx = { showId: showId, zoneCode: null, zone: null };
    $("seatTitle").textContent = s.titleKo || s.title || "좌석 선택";
    $("seatSub").textContent =
      "Day " + s.day + " · " + (s.date || "") + (s.dow ? " (" + s.dow + ")" : "") +
      " · " + (s.time || "") + (s.end ? "–" + s.end : "");
    $("zoneStep").classList.remove("hidden");
    $("seatStep").classList.add("hidden");
    renderZones();
    openSheet("seatSheet");
  }

  function zoneBtn(z) {
    var b = document.createElement("button");
    b.type = "button";
    var low = z.remaining > 0 && z.remaining <= 6;
    b.className = "zone-btn" + (low ? " low" : "");
    b.innerHTML =
      '<div class="zb-name">' + esc(z.label) + "</div>" +
      '<div class="zb-rem">' + (z.remaining > 0 ? "잔여 " + z.remaining + "석" : "잔여 없음") +
      " · 전체 " + z.seatCount + "석</div>";
    if (z.remaining > 0) b.addEventListener("click", function () { openZone(z.code); });
    else b.disabled = true;
    return b;
  }

  function renderZones() {
    var list = zoneAvail[seatCtx.showId] || [];
    var wrap = $("zoneMap");
    wrap.innerHTML = "";
    if (!list.length) {
      wrap.innerHTML = '<p class="lookup-empty">구역 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>';
      return;
    }
    function bySort(a, b) { return a.sort - b.sort; }
    var L = list.filter(function (z) { return z.side === "L"; }).sort(bySort);
    var R = list.filter(function (z) { return z.side === "R"; }).sort(bySort);

    var colL = document.createElement("div"); colL.className = "zone-col";
    L.forEach(function (z) { colL.appendChild(zoneBtn(z)); });
    var mid = document.createElement("div");
    mid.className = "zone-runway";
    mid.innerHTML = "<span>RUNWAY</span>";
    var colR = document.createElement("div"); colR.className = "zone-col";
    R.forEach(function (z) { colR.appendChild(zoneBtn(z)); });

    wrap.appendChild(colL); wrap.appendChild(mid); wrap.appendChild(colR);
  }

  /* ---- 좌석 시트 2단계 : 자리 고르기 ---- */
  function openZone(zoneCode) {
    var list = zoneAvail[seatCtx.showId] || [];
    var z = list.filter(function (x) { return x.code === zoneCode; })[0];
    if (!z) return;
    seatCtx.zoneCode = zoneCode;
    seatCtx.zone = z;
    $("zoneStep").classList.add("hidden");
    $("seatStep").classList.remove("hidden");
    $("seatGrid").innerHTML = '<p class="lookup-empty">좌석을 불러오는 중…</p>';
    Api.seatMap(seatCtx.showId, zoneCode).then(renderSeatGrid);
  }

  function renderSeatGrid(seats) {
    var z = seatCtx.zone, R = z.rows, grid = $("seatGrid");
    var byNum = {};
    (seats || []).forEach(function (x) { byNum[x.num] = x; });
    var mySel = selOf(seatCtx.showId);

    grid.innerHTML = "";
    grid.style.gridTemplateColumns = "repeat(3, auto)";
    for (var r = 1; r <= R; r++) {
      // 실제 배치도와 같은 순서. 좌측 구역은 바깥단이 왼쪽, 우측 구역은 반대.
      var nums = (z.side === "L") ? [2 * R + r, R + r, r] : [r, R + r, 2 * R + r];
      for (var c = 0; c < 3; c++) {
        var st = byNum[nums[c]] || { status: "blocked", num: nums[c], seatId: null };
        var picked = !!(mySel && mySel.seatId && mySel.seatId === st.seatId);
        var b = document.createElement("button");
        b.type = "button";
        b.className = "seat " + (picked ? "sel" : (st.status === "free" ? "" : st.status));
        b.textContent = st.num;
        b.setAttribute("aria-label", z.label + " " + st.num + "번" +
          (st.status === "free" ? " 선택 가능" : st.status === "taken" ? " 예약됨" : " 선택 불가"));
        if (st.status === "free" || picked) {
          (function (seat) { b.addEventListener("click", function () { pickSeat(seat); }); })(st);
        } else {
          b.disabled = true;
        }
        grid.appendChild(b);
      }
    }
    // 런웨이 표시를 실제 방향에 맞춰 옮긴다 (좌측 구역은 오른쪽이 런웨이)
    var side = $("runwaySide"), wrap = grid.parentNode;
    if (z.side === "L") wrap.appendChild(side);
    else wrap.insertBefore(side, grid);
  }

  function pickSeat(seat) {
    if (!seat || !seat.seatId) return;
    var item = {
      showId: seatCtx.showId, zoneCode: seatCtx.zoneCode,
      seatId: seat.seatId, seatLabel: seatCtx.zone.label + " " + seat.num + "번"
    };
    var i = selIndex(seatCtx.showId);
    if (i >= 0) selected[i] = item; else selected.push(item);
    closeSheet("seatSheet");
    renderGroups();
    syncBar();
  }

  $("zoneBack").addEventListener("click", function () {
    $("seatStep").classList.add("hidden");
    $("zoneStep").classList.remove("hidden");
    renderZones();
  });

  function syncBar() {
    var bar = $("selBar");
    $("selCount").textContent = selected.length;
    bar.classList.toggle("show", selected.length > 0);
  }

  /* ---- selection bar → open form ---- */
  $("selGo").addEventListener("click", function () {
    if (!selected.length) return;
    renderChosen();
    openSheet("formSheet");
  });

  function renderChosen() {
    var wrap = $("chosenList");
    wrap.innerHTML = "";
    selected.forEach(function (it) {
      var s = showById(it.showId);
      if (!s) return;
      var row = document.createElement("div");
      row.className = "chosen-row";
      row.innerHTML =
        '<span class="ct">D' + esc(s.day) + " · " + esc(s.time) + "</span>" +
        '<span class="cn">' + esc(s.titleKo || s.title) +
          (it.seatLabel ? ' · <b>' + esc(it.seatLabel) + "</b>" : "") + "</span>" +
        '<button type="button" class="cx" aria-label="제거">✕</button>';
      row.querySelector(".cx").addEventListener("click", function () {
        unselect(it.showId);
        if (!selected.length) closeSheet("formSheet");
        else renderChosen();
      });
      wrap.appendChild(row);
    });
  }

  /* ---- submit reservation ---- */
  $("rsvForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = $("fName").value.trim();
    var phone = $("fPhone").value.trim();
    var email = $("fEmail").value.trim();
    var agree = $("fAgree").checked;
    var mkt = $("fMkt").checked;
    var err = $("rsvErr");
    if (!name || !phone || !agree || phone.replace(/[^0-9]/g, "").length < 9) { err.classList.add("show"); return; }
    err.classList.remove("show");

    var submitBtn = $("rsvForm").querySelector('button[type=submit]');
    submitBtn.disabled = true;
    var origLabel = submitBtn.innerHTML;
    submitBtn.innerHTML = "예약 처리 중…";

    var picks = selected.slice();
    var done = [], failFull = [], failDup = [], failErr = [], failClosed = [], failTaken = [];

    // process sequentially so the server enforces first-come order cleanly
    var chain = Promise.resolve();
    picks.forEach(function (it) {
      var s = showById(it.showId);
      if (!s) return;
      chain = chain.then(function () {
        return Api.reserve({
          showId: s.id, seatId: it.seatId,
          showTitle: s.title, titleKo: s.titleKo, lineup: s.lineup,
          day: s.day, date: s.date, dow: s.dow, time: s.time, end: s.end, venue: s.venue,
          name: name, phone: phone, email: email, marketing: mkt
        }).then(function (res) {
          if (res.ok) done.push(res.entry);
          else if (res.reason === "dup") failDup.push(s);
          else if (res.reason === "full") failFull.push(s);
          else if (res.reason === "closed") failClosed.push(s);
          else if (res.reason === "taken" || res.reason === "locked") failTaken.push(it);
          else failErr.push(s);
        });
      });
    });

    chain.then(function () {
      selected = [];
      submitBtn.disabled = false;
      submitBtn.innerHTML = origLabel;
      closeSheet("formSheet");
      showDone(done, failFull, failDup, failErr, failClosed, failTaken);
      try { localStorage.setItem("bfw_last_phone", phone); localStorage.setItem("bfw_last_name", name); } catch (e2) {}
      $("fName").value = ""; $("fPhone").value = ""; $("fEmail").value = "";
      $("fAgree").checked = false; $("fMkt").checked = false;
      refreshAvailability();
      syncBar();
    });
  });

  function showDone(done, failFull, failDup, failErr, failClosed, failTaken) {
    var wrap = $("doneTickets");
    wrap.innerHTML = "";
    done.forEach(function (r) { wrap.appendChild(ticketEl(r, false)); });

    var failBox = $("doneFail");
    var msgs = [];
    if (failFull && failFull.length) msgs.push("‘" + failFull.map(function (s) { return s.titleKo || s.title; }).join(", ") + "’ 은(는) 방금 좌석이 마감되어 예약되지 않았습니다.");
    if (failDup && failDup.length) msgs.push("‘" + failDup.map(function (s) { return s.titleKo || s.title; }).join(", ") + "’ 은(는) 이미 이 연락처로 예약되어 있습니다.");
    if (failTaken && failTaken.length) msgs.push("‘" + failTaken.map(function (it) { return it.seatLabel || (showById(it.showId) || {}).titleKo || ""; }).join(", ") + "’ 은(는) 방금 다른 분이 선택하셨습니다. 다시 들어가 다른 자리를 골라 주세요.");
    if (failClosed && failClosed.length) msgs.push("‘" + failClosed.map(function (s) { return s.titleKo || s.title; }).join(", ") + "’ 은(는) 예약 기간이 끝났습니다. 공연 전날 자정에 마감되며, 당일에는 현장에서 스탠드석으로 관람하실 수 있습니다.");
    if (failErr && failErr.length) msgs.push("‘" + failErr.map(function (s) { return s.titleKo || s.title; }).join(", ") + "’ 은(는) 일시적인 오류로 예약하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    if (msgs.length) {
      failBox.innerHTML = msgs.join("<br>");
      failBox.style.display = "block";
      failBox.classList.add("fail-line");
    } else {
      failBox.style.display = "none";
    }
    if (!done.length) {
      wrap.innerHTML = '<p class="lookup-empty" style="text-align:center">새로 예약된 좌석이 없습니다.</p>';
    }
    openSheet("doneSheet");
  }

  function ticketEl(r, withCancel) {
    var el = document.createElement("div");
    el.className = "ticket" + (r.checkedIn ? " in" : "");
    el.innerHTML =
      '<div class="qr">' + qrSvg(dispCode(r.code)) + "</div>" +
      '<div class="ti">' +
        '<div class="tt">Day ' + esc(r.day) + " · " + esc(r.date) + " · " + esc(r.time) + (r.end ? "–" + esc(r.end) : "") + "</div>" +
        '<div class="tn">' + esc(r.titleKo || r.showTitle) + "</div>" +
        '<div class="tv">' + esc(r.showTitle || "") + (r.lineup ? " · " + esc(r.lineup) : "") + " · " + esc(r.name) + "</div>" +
        (r.seatLabel ? '<div class="sc-seat">' + esc(r.seatLabel) + "</div>" : "") +
        '<div class="code">' + esc(dispCode(r.code)) + "</div>" +
        '<div class="badge ' + (r.checkedIn ? "entered" : "ok") + '">' + (r.checkedIn ? "입장 완료" : "예약 완료") + "</div>" +
      "</div>" +
      (withCancel && !r.checkedIn ? '<button type="button" class="tcancel">예약취소</button>' : "");
    if (withCancel && !r.checkedIn) {
      el.querySelector(".tcancel").addEventListener("click", function () {
        if (!confirm("‘" + (r.titleKo || r.showTitle) + "’ 예약을 취소할까요?")) return;
        Api.cancel(r.id, $("lookupName").value.trim(), $("lookupPhone").value.trim()).then(function (ok) {
          if (!ok) { alert("예약을 취소하지 못했습니다. 이미 입장 처리되었거나, 입력하신 정보가 예약과 다릅니다."); return; }
          doLookup();
          refreshAvailability();
        });
      });
    }
    return el;
  }

  /* ---- tabs ---- */
  document.querySelectorAll(".rsv-tabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll(".rsv-tabs button").forEach(function (x) { x.classList.remove("on"); });
      b.classList.add("on");
      var pane = b.getAttribute("data-pane");
      $("bookPane").classList.toggle("hidden", pane !== "book");
      $("lookupPane").classList.toggle("hidden", pane !== "lookup");
      $("selBar").classList.toggle("show", pane === "book" && selected.length > 0);
      if (pane === "lookup") {
        try {
          var last = localStorage.getItem("bfw_last_phone");
          var lastN = localStorage.getItem("bfw_last_name");
          if (last && !$("lookupPhone").value) { $("lookupPhone").value = last; }
          if (lastN && !$("lookupName").value) { $("lookupName").value = lastN; }
        } catch (e) {}
        if ($("lookupPhone").value.trim() && $("lookupName").value.trim() && !$("lookupResult").innerHTML) doLookup();
      }
    });
  });

  /* ---- lookup : 예약자 이름 + 연락처가 모두 일치해야 조회됩니다 ---- */
  function doLookup() { runLookup($("lookupPhone").value.trim(), $("lookupName").value.trim()); }
  $("lookupBtn").addEventListener("click", doLookup);
  $("lookupPhone").addEventListener("keydown", function (e) { if (e.key === "Enter") doLookup(); });
  $("lookupName").addEventListener("keydown", function (e) { if (e.key === "Enter") doLookup(); });

  function runLookup(phone, name) {
    var box = $("lookupResult");
    if (!phone || !name) { box.innerHTML = '<p class="lookup-empty">예약자 이름과 연락처를 모두 입력해 주세요.</p>'; return; }
    box.innerHTML = '<p class="lookup-empty">조회 중…</p>';
    Api.lookupByPhone(phone, name).then(function (list) {
      if (!list || !list.length) { box.innerHTML = '<p class="lookup-empty">입력하신 이름·연락처로 예약된 내역이 없습니다.<br>예약할 때 적으신 내용과 같은지 확인해 주세요.</p>'; return; }
      box.innerHTML = '<div class="tickets" id="lookupTickets"></div>';
      var t = $("lookupTickets");
      list.forEach(function (r) { t.appendChild(ticketEl(r, true)); });
    });
  }

  /* ---- sheets ---- */
  function openSheet(id) { $(id).classList.add("show"); document.body.style.overflow = "hidden"; }
  function closeSheet(id) { $(id).classList.remove("show"); document.body.style.overflow = ""; }
  document.querySelectorAll("[data-close]").forEach(function (b) {
    b.addEventListener("click", function () { closeSheet(b.getAttribute("data-close")); });
  });
  document.querySelectorAll(".sheet").forEach(function (sh) {
    sh.addEventListener("click", function (e) { if (e.target === sh) closeSheet(sh.id); });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") document.querySelectorAll(".sheet.show").forEach(function (sh) { closeSheet(sh.id); });
  });

  /* ---- member autofill (간편 회원) ---- */
  function applyMember(m) {
    if (!m) return;
    if (!$("fName").value) $("fName").value = m.name || "";
    if (!$("fPhone").value) $("fPhone").value = m.phone || "";
    if (!$("fEmail").value) $("fEmail").value = m.email || "";
    if (!$("lookupPhone").value) $("lookupPhone").value = m.phone || "";
  }
  if (window.BFWAuth) applyMember(BFWAuth.current());
  window.addEventListener("bfw:member", function (e) { if (e.detail) applyMember(e.detail); });
})();
