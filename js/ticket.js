/* ===========================================================
   BUSAN FASHION WEEK — 모바일 입장권 (ticket.html)
   문자로 받은 링크 ?c=BFW-S01-ABC123 을 열면 QR과 관람 정보를 띄운다.
   개인정보는 서버에서 이름을 가려 내려주므로(홍*동) 링크가 새더라도
   연락처·이메일은 노출되지 않는다.
   =========================================================== */
(function () {
  "use strict";
  var Api = window.BFWApi;
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* ---- 실시간 시계 : 캡처본은 시간이 멈춰 있어 스태프가 구분한다 ---- */
  (function tick() {
    var d = new Date();
    function p(n) { return (n < 10 ? "0" : "") + n; }
    $("clock").textContent = p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
    setTimeout(tick, 1000);
  })();

  function qrSvg(text) {
    try {
      var qr = qrcode(0, "M");
      qr.addData(text);
      qr.make();
      return qr.createSvgTag({ cellSize: 5, margin: 0, scalable: true });
    } catch (e) {
      return '<div style="font:12px monospace;padding:10px">' + esc(text) + "</div>";
    }
  }

  var DOW = ["일", "월", "화", "수", "목", "금", "토"];
  function whenText(r) {
    var md = String(r.date || "").split(".").slice(1).join(".");
    var dow = "";
    try {
      var d = new Date(String(r.date || "").replace(/\./g, "-"));
      if (!isNaN(d)) dow = DOW[d.getDay()];
    } catch (e) {}
    return md + (dow ? "(" + dow + ")" : "") + " " + (r.start_time || "") +
           (r.end_time ? "–" + r.end_time : "");
  }

  function ticketEl(r) {
    var el = document.createElement("div");
    el.className = "ticket";
    var used = !!r.checked_in;
    el.innerHTML =
      '<div class="t-head">' +
        '<div class="kicker">2026 BUSAN FASHION WEEK</div>' +
        "<h2>" + esc(r.title_ko || r.show_title || "") + "</h2>" +
        '<div class="when">' + esc(whenText(r)) + "</div>" +
      "</div>" +
      '<div class="t-body">' +
        '<div class="live"><i></i>LIVE · 실시간 화면</div>' +
        '<div class="qr-frame">' + qrSvg("BFW-" + r.code) + "</div>" +
        '<div class="code">BFW-' + esc(r.code) + "</div>" +
        '<div class="who">' + esc(r.name_masked || "") + "님</div>" +
        '<div class="rows">' +
          "<div><dt>장소</dt><dd>벡스코 제1전시장 3B홀</dd></div>" +
          (r.seat_label
            ? "<div><dt>좌석</dt><dd>" + esc(r.seat_label) + "</dd></div>"
            : "<div><dt>좌석</dt><dd>자유석 · 선착순 착석</dd></div>") +
        "</div>" +
        '<div class="badge ' + (used ? "used" : "ok") + '">' +
          (used ? "입장 완료" : "입장 전 · 유효한 입장권") + "</div>" +
      "</div>";
    return el;
  }

  function show(html) { $("list").innerHTML = html; }

  var codes = [];
  try {
    var q = new URLSearchParams(location.search);
    codes = (q.get("c") || q.get("code") || "")
      .split(",")
      .map(function (x) { return x.trim(); })
      .filter(Boolean);
  } catch (e) {}

  if (!codes.length) {
    show('<div class="msg">입장권 주소가 올바르지 않습니다.<br>예약 확인은 <a href="register.html">내 예약 조회</a>에서 하실 수 있습니다.</div>');
    return;
  }

  Api.ticketView(codes).then(function (rows) {
    if (!rows || !rows.length) {
      show('<div class="msg">유효한 입장권을 찾을 수 없습니다.<br>취소되었거나 주소가 잘못되었을 수 있습니다.<br><br><a href="register.html">내 예약 조회 →</a></div>');
      return;
    }
    $("list").innerHTML = "";
    rows.forEach(function (r) { $("list").appendChild(ticketEl(r)); });
    $("guide").style.display = "";
  }).catch(function () {
    show('<div class="msg">입장권을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>');
  });
})();
