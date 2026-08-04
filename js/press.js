/* ===========================================================
   BUSAN FASHION WEEK — press visit application (press.html)
   =========================================================== */
(function () {
  "use strict";
  var BFW = window.BFW;
  var Api = window.BFWApi;
  var cfg = BFW.load();
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  /* brand wordmark */
  (function () {
    var b = cfg.brand, nav = document.querySelector(".nav .brand");
    if (b.logo) nav.innerHTML = '<img class="brand-logo" src="' + b.logo + '" alt="">';
    else nav.innerHTML = "<b>" + esc(b.textPrimary) + '</b><span class="bul">●</span><b>' + esc(b.textSecondary) + "</b>";
  })();

  var pv = cfg.pressVisit || { open: true, note: "" };
  $("prsNote").textContent = pv.note || "";
  if (!pv.open) {
    $("prsForm").classList.add("hidden");
    $("prsNote").classList.add("hidden");
    $("closedNote").style.display = "block";
  }

  /* day chips from shows */
  (function () {
    var wrap = $("pDays"), seen = {};
    (cfg.shows || []).forEach(function (s) {
      if (seen[s.day]) return;
      seen[s.day] = true;
      var text = "Day " + s.day + " · " + (s.date || "") + (s.dow ? " (" + s.dow + ")" : "");
      var lab = document.createElement("label");
      lab.className = "chip";
      lab.innerHTML = '<input type="checkbox" value="' + esc(text) + '"><span>' + esc(text) + "</span>";
      wrap.appendChild(lab);
    });
  })();

  /* member autofill */
  function applyMember(m) {
    if (!m) return;
    if (!$("pName").value) $("pName").value = m.name || "";
    if (!$("pPhone").value) $("pPhone").value = m.phone || "";
    if (!$("pEmail").value) $("pEmail").value = m.email || "";
    if (!$("stPhone").value) $("stPhone").value = m.phone || "";
  }
  if (window.BFWAuth) applyMember(BFWAuth.current());
  window.addEventListener("bfw:member", function (e) { if (e.detail) applyMember(e.detail); });

  function checkedVals(wrapId) {
    return Array.prototype.map.call(document.querySelectorAll("#" + wrapId + " input:checked"), function (i) { return i.value; });
  }

  /* submit */
  $("prsForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var media = $("pMedia").value.trim(), name = $("pName").value.trim();
    var phone = $("pPhone").value.trim(), email = $("pEmail").value.trim();
    var types = checkedVals("pTypes"), days = checkedVals("pDays");
    var err = $("prsErr");
    function fail(m) { err.textContent = m; err.classList.add("show"); }
    err.classList.remove("show");
    if (!media || !name || !phone) return fail("매체명·기자명·연락처를 입력해 주세요.");
    if (!types.length) return fail("취재 유형을 1개 이상 선택해 주세요.");
    if (!days.length) return fail("방문 희망일을 선택해 주세요.");
    if (!$("pAgree").checked) return fail("개인정보 수집·이용 동의가 필요합니다.");
    var btn = this.querySelector("button[type=submit]");
    btn.disabled = true;
    var ol = btn.innerHTML;
    btn.innerHTML = "접수 중…";
    Api.pressApply({ media: media, reporter: name, phone: phone, email: email, types: types.join(", "), days: days.join(", "), note: $("pNote").value.trim() }).then(function (res) {
      btn.disabled = false;
      btn.innerHTML = ol;
      if (!res.ok) {
        if (res.reason === "dup") return fail("이미 이 연락처로 접수된 신청이 있습니다. ‘신청 조회’ 탭에서 확인해 주세요.");
        return fail("일시적인 오류로 접수하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
      try { localStorage.setItem("bfw_last_phone", phone); } catch (e2) {}
      $("prsForm").classList.add("hidden");
      var d = $("applyDone");
      d.classList.remove("hidden");
      d.innerHTML =
        '<div class="done-card"><h2>접수 완료 ✓</h2>' +
        "<p>" + esc(media) + " · " + esc(name) + " 기자님의 프레스 방문 신청이 접수되었습니다.<br>심사 후 <b>승인되면 프레스 QR이 발급</b>되며, ‘신청 조회’ 탭에서 연락처로 확인할 수 있습니다.</p>" +
        '<button class="btn ghost" id="goStatus" style="margin-top:14px">신청 조회로 이동 →</button></div>';
      d.querySelector("#goStatus").addEventListener("click", function () {
        $("stPhone").value = phone;
        switchPane("status");
        runLookup(phone);
      });
    });
  });

  /* tabs */
  function switchPane(pane) {
    document.querySelectorAll(".rsv-tabs button").forEach(function (x) { x.classList.toggle("on", x.getAttribute("data-pane") === pane); });
    $("applyPane").classList.toggle("hidden", pane !== "apply");
    $("statusPane").classList.toggle("hidden", pane !== "status");
  }
  document.querySelectorAll(".rsv-tabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      var pane = b.getAttribute("data-pane");
      switchPane(pane);
      if (pane === "status") {
        try {
          var last = $("stPhone").value || localStorage.getItem("bfw_last_phone") || "";
          if (last) { $("stPhone").value = last; runLookup(last); }
        } catch (e) {}
      }
    });
  });

  /* lookup */
  function qrSvg(text) {
    try {
      var qr = qrcode(0, "M");
      qr.addData(text);
      qr.make();
      return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    } catch (e) { return '<div style="font:11px monospace;color:#888;padding:8px">' + esc(text) + "</div>"; }
  }
  $("stBtn").addEventListener("click", function () { runLookup($("stPhone").value.trim()); });
  $("stPhone").addEventListener("keydown", function (e) { if (e.key === "Enter") runLookup(this.value.trim()); });
  function runLookup(phone) {
    var box = $("stResult");
    if (!phone) { box.innerHTML = '<p class="lookup-empty">연락처를 입력해 주세요.</p>'; return; }
    box.innerHTML = '<p class="lookup-empty">조회 중…</p>';
    Api.pressLookup(phone).then(function (list) {
      if (!list || !list.length) { box.innerHTML = '<p class="lookup-empty">해당 연락처로 접수된 신청이 없습니다.</p>'; return; }
      box.innerHTML = '<div class="tickets"></div>';
      var t = box.querySelector(".tickets");
      list.forEach(function (p) { t.appendChild(card(p)); });
    });
  }
  function card(p) {
    var el = document.createElement("div");
    if (p.status === "approved") {
      el.className = "ticket" + (p.checkedIn ? " in" : "");
      el.innerHTML =
        '<div class="qr">' + qrSvg(p.code) + "</div>" +
        '<div class="ti">' +
          '<div class="tt">PRESS · ' + esc(p.types || "") + "</div>" +
          '<div class="tn">' + esc(p.media) + "</div>" +
          '<div class="tv">' + esc(p.reporter) + " 기자" + (p.days ? " · " + esc(p.days) : "") + "</div>" +
          '<div class="code">' + esc(p.code) + "</div>" +
          '<div class="badge ' + (p.checkedIn ? "entered" : "ok") + '">' + (p.checkedIn ? "입장 완료" : "승인 — 프레스 QR") + "</div>" +
          '<div class="tv" style="margin-top:8px">행사 당일 프레스 데스크에서 QR을 제시하고 비표를 수령하세요.</div>' +
        "</div>";
    } else {
      var pending = p.status !== "rejected";
      el.className = "ticket";
      el.innerHTML =
        '<div class="ti">' +
          '<div class="tt">PRESS · ' + esc(p.types || "") + "</div>" +
          '<div class="tn">' + esc(p.media) + "</div>" +
          '<div class="tv">' + esc(p.reporter) + " 기자" + (p.days ? " · " + esc(p.days) : "") + "</div>" +
          '<div class="badge ' + (pending ? "ok" : "entered") + '">' + (pending ? "심사중" : "반려됨") + "</div>" +
          '<div class="tv" style="margin-top:8px">' + (pending ? "승인이 완료되면 이 화면에 프레스 QR이 표시됩니다." : "아쉽지만 이번 신청은 승인되지 않았습니다. 문의는 사무국으로 부탁드립니다.") + "</div>" +
        "</div>";
    }
    return el;
  }
})();
