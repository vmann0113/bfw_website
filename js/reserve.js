/* ===========================================================
   BUSAN FASHION WEEK — audience reservation (register.html)
   =========================================================== */
(function () {
  "use strict";
  var BFW = window.BFW;
  var Api = window.BFWApi;
  var cfg = BFW.load();
  var $ = function (id) { return document.getElementById(id); };
  var selected = []; // ordered list of showIds
  var avail = {};    // { showId: {capacity, reserved, remaining} }

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
    return Api.availability().then(function (map) {
      avail = map || {};
      renderGroups();
    }).catch(function () {
      avail = {};
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
        var cap = capOf(s), remain = remainOf(s), full = remain <= 0;
        var low = remain > 0 && remain <= 30;
        var isSel = selected.indexOf(s.id) >= 0;
        var pct = Math.min(100, Math.round(((cap - remain) / cap) * 100));
        var card = document.createElement("button");
        card.type = "button";
        card.className = "show-card" + (isSel ? " sel" : "") + (full ? " full" : "");
        card.setAttribute("data-id", s.id);
        card.innerHTML =
          '<div class="sc-top"><span class="sc-time">' + esc(s.time || "") + (s.end ? "–" + esc(s.end) : "") + "</span>" +
          (full ? '<span class="full-pill">마감</span>' : '<span class="sc-check">✓</span>') + "</div>" +
          '<div class="sc-title">' + esc(s.title || "") + "</div>" +
          (s.titleKo ? '<div class="sc-ko">' + esc(s.titleKo) + "</div>" : "") +
          '<div class="sc-venue">' + esc(s.lineup || s.venue || "") + "</div>" +
          (s.tbd ? '<div class="tbd-tag">참여 브랜드 추첨 배치 예정</div>' : "") +
          '<div class="cap">' +
            '<div class="cap-bar"><div class="cap-fill" style="width:' + pct + '%;' + (low || full ? "background:var(--coral)" : "") + '"></div></div>' +
            '<div class="cap-row">' +
              (full
                ? '<span class="cap-remain low">예약 마감</span>'
                : '<span class="cap-remain' + (low ? " low" : "") + '">잔여 ' + remain + '석</span>') +
              '<span class="cap-total">' + (cap - remain) + " / " + cap + "</span>" +
            "</div>" +
          "</div>";
        if (!full) card.addEventListener("click", function () { toggle(s.id); });
        grid.appendChild(card);
      });
      wrap.appendChild(group);
    });
  }

  function toggle(id) {
    var i = selected.indexOf(id);
    if (i >= 0) selected.splice(i, 1);
    else selected.push(id);
    renderGroups();
    syncBar();
  }

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
    selected.forEach(function (id) {
      var s = showById(id);
      if (!s) return;
      var row = document.createElement("div");
      row.className = "chosen-row";
      row.innerHTML =
        '<span class="ct">D' + esc(s.day) + " · " + esc(s.time) + "</span>" +
        '<span class="cn">' + esc(s.titleKo || s.title) + "</span>" +
        '<button type="button" class="cx" aria-label="제거">✕</button>';
      row.querySelector(".cx").addEventListener("click", function () {
        toggle(id);
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
    if (!name || !phone || !agree) { err.classList.add("show"); return; }
    err.classList.remove("show");

    var submitBtn = $("rsvForm").querySelector('button[type=submit]');
    submitBtn.disabled = true;
    var origLabel = submitBtn.innerHTML;
    submitBtn.innerHTML = "예약 처리 중…";

    var ids = selected.slice();
    var done = [], failFull = [], failDup = [], failErr = [];

    // process sequentially so the server enforces first-come order cleanly
    var chain = Promise.resolve();
    ids.forEach(function (id) {
      var s = showById(id);
      if (!s) return;
      chain = chain.then(function () {
        return Api.reserve({
          showId: s.id, showTitle: s.title, titleKo: s.titleKo, lineup: s.lineup,
          day: s.day, date: s.date, dow: s.dow, time: s.time, end: s.end, venue: s.venue,
          name: name, phone: phone, email: email, marketing: mkt
        }).then(function (res) {
          if (res.ok) done.push(res.entry);
          else if (res.reason === "dup") failDup.push(s);
          else if (res.reason === "full") failFull.push(s);
          else failErr.push(s);
        });
      });
    });

    chain.then(function () {
      selected = [];
      submitBtn.disabled = false;
      submitBtn.innerHTML = origLabel;
      closeSheet("formSheet");
      showDone(done, failFull, failDup, failErr);
      try { localStorage.setItem("bfw_last_phone", phone); } catch (e2) {}
      $("fName").value = ""; $("fPhone").value = ""; $("fEmail").value = "";
      $("fAgree").checked = false; $("fMkt").checked = false;
      refreshAvailability();
      syncBar();
    });
  });

  function showDone(done, failFull, failDup, failErr) {
    var wrap = $("doneTickets");
    wrap.innerHTML = "";
    done.forEach(function (r) { wrap.appendChild(ticketEl(r, false)); });

    var failBox = $("doneFail");
    var msgs = [];
    if (failFull && failFull.length) msgs.push("‘" + failFull.map(function (s) { return s.titleKo || s.title; }).join(", ") + "’ 은(는) 방금 좌석이 마감되어 예약되지 않았습니다.");
    if (failDup && failDup.length) msgs.push("‘" + failDup.map(function (s) { return s.titleKo || s.title; }).join(", ") + "’ 은(는) 이미 이 연락처로 예약되어 있습니다.");
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
        '<div class="code">' + esc(dispCode(r.code)) + "</div>" +
        '<div class="badge ' + (r.checkedIn ? "entered" : "ok") + '">' + (r.checkedIn ? "입장 완료" : "예약 완료") + "</div>" +
      "</div>" +
      (withCancel && !r.checkedIn ? '<button type="button" class="tcancel">예약취소</button>' : "");
    if (withCancel && !r.checkedIn) {
      el.querySelector(".tcancel").addEventListener("click", function () {
        if (!confirm("‘" + (r.titleKo || r.showTitle) + "’ 예약을 취소할까요?")) return;
        Api.cancel(r.id).then(function () {
          runLookup($("lookupPhone").value.trim());
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
          if (last && !$("lookupPhone").value) { $("lookupPhone").value = last; runLookup(last); }
        } catch (e) {}
      }
    });
  });

  /* ---- lookup ---- */
  $("lookupBtn").addEventListener("click", function () { runLookup($("lookupPhone").value.trim()); });
  $("lookupPhone").addEventListener("keydown", function (e) { if (e.key === "Enter") runLookup(this.value.trim()); });

  function runLookup(phone) {
    var box = $("lookupResult");
    if (!phone) { box.innerHTML = '<p class="lookup-empty">연락처를 입력해 주세요.</p>'; return; }
    box.innerHTML = '<p class="lookup-empty">조회 중…</p>';
    Api.lookupByPhone(phone).then(function (list) {
      if (!list || !list.length) { box.innerHTML = '<p class="lookup-empty">해당 연락처로 예약된 내역이 없습니다.</p>'; return; }
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
})();
