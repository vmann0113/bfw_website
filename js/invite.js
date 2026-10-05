/* ===========================================================
   BUSAN FASHION WEEK — 브랜드 초청권 신청 (invite.html)

   참여사가 받은 링크(invite.html?t=토큰)를 손님에게 뿌리면,
   손님이 이름·연락처만 넣고 사전등록과 똑같은 QR 입장권을 받는다.
   자리는 자유석이고 입장은 1순위다.

   이 화면이 쓰는 서버 기능은 두 개뿐이다 — invite_view / invite_claim.
   예약 시스템의 다른 흐름(reserve_seat 등)은 건드리지 않는다.
   =========================================================== */
(function () {
  "use strict";
  var Api = window.BFWApi;
  var $ = function (id) { return document.getElementById(id); };

  var token = (function () {
    var m = /[?&]t=([^&#]+)/.exec(location.search);
    return m ? decodeURIComponent(m[1]) : "";
  })();

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function show(id) { $(id).classList.remove("hidden"); }
  function hide(id) { $(id).classList.add("hidden"); }

  function notice(title, body) {
    hide("loading"); hide("form"); hide("done");
    $("nTitle").textContent = title;
    $("nBody").innerHTML = body;
    show("notice");
  }

  /* 연락처 칸은 숫자만 받고 하이픈을 넣어 준다 */
  function bindPhone(el) {
    el.addEventListener("input", function () {
      var d = el.value.replace(/[^0-9]/g, "").slice(0, 11);
      if (d.length > 7) el.value = d.slice(0, 3) + "-" + d.slice(3, 7) + "-" + d.slice(7);
      else if (d.length > 3) el.value = d.slice(0, 3) + "-" + d.slice(3);
      else el.value = d;
      el.classList.remove("bad");
    });
  }

  function whenText(s) {
    return (s.date || "") + (s.day ? " · Day " + s.day : "") + " · " +
           (s.startTime || "") + (s.endTime ? "–" + s.endTime : "");
  }

  var SHOW = null;

  if (!token) {
    notice("링크가 올바르지 않습니다", "참여사에서 받으신 주소를 끝까지 그대로 열어 주세요.");
    return;
  }

  Api.inviteView(token).then(function (d) {
    if (!d || !d.ok) {
      notice("링크가 올바르지 않습니다", "참여사에서 받으신 주소를 끝까지 그대로 열어 주세요.");
      return;
    }
    SHOW = d.show || {};
    document.title = d.brand + " 초청권 | 2026 부산패션위크";
    $("hTitle").innerHTML = esc(d.brand) + "<br>초청권 신청";

    if (!d.open || d.quota <= 0) {
      notice("아직 신청을 받지 않습니다", "초청권 신청이 열리면 다시 안내해 드립니다.");
      return;
    }
    if (d.left <= 0) {
      notice("초청권이 모두 나갔습니다",
        esc(d.brand) + " 초청권 " + d.quota + "장이 모두 신청되었습니다.<br>초대해 주신 곳으로 문의해 주세요.");
      return;
    }

    $("sTitle").textContent = (SHOW.titleKo || SHOW.title || "") +
      (SHOW.lineup ? " — " + SHOW.lineup : "");
    $("sWhen").textContent = whenText(SHOW);
    /* shows.venue 는 홀 안의 위치(메인 런웨이)라, 처음 오시는 분을 위해 건물부터 적는다 */
    $("sVenue").textContent = "벡스코 제1전시장 3B홀" + (SHOW.venue ? " · " + SHOW.venue : "");
    $("leftTag").textContent = "남은 초청권 " + d.left + "장";

    hide("loading");
    show("form");
  });

  bindPhone($("iPhone"));
  ["iName", "iPhone"].forEach(function (id) {
    $(id).addEventListener("input", function () { $(id).classList.remove("bad"); });
  });

  var REASON = {
    badtoken: "링크가 올바르지 않습니다. 받으신 주소를 다시 확인해 주세요.",
    closed:   "지금은 초청권 신청을 받지 않습니다.",
    full:     "초청권이 모두 나갔습니다. 초대해 주신 곳으로 문의해 주세요.",
    badname:  "이름을 정확히 적어 주세요.",
    badphone: "연락처를 정확히 적어 주세요.",
    dup:      "이 연락처로 같은 패션쇼를 이미 신청하셨습니다.",
    soldout:  "이 패션쇼는 좌석이 모두 찼습니다.",
    late:     "이 패션쇼는 신청 기간이 끝났습니다.",
    network:  "연결이 고르지 않습니다. 잠시 후 다시 시도해 주세요."
  };

  $("goBtn").addEventListener("click", function () {
    var name = $("iName").value.trim();
    var phone = $("iPhone").value.trim();
    var email = $("iEmail").value.trim();
    var err = $("errBox");
    err.style.display = "none";

    if (!name) { $("iName").classList.add("bad"); $("iName").focus(); return; }
    if (phone.replace(/[^0-9]/g, "").length < 9) {
      $("iPhone").classList.add("bad"); $("iPhone").focus(); return;
    }
    if (!$("iAgree").checked) {
      err.textContent = "개인정보 수집·이용에 동의해 주세요.";
      err.style.display = "block";
      return;
    }

    var btn = $("goBtn");
    btn.disabled = true;
    btn.textContent = "발급 중…";

    Api.inviteClaim(token, { name: name, phone: phone, email: email, marketing: false })
      .then(function (res) {
        btn.disabled = false;
        btn.textContent = "초청권 받기";
        if (!res.ok) {
          err.textContent = REASON[res.reason] || "지금 발급하지 못했습니다. 잠시 후 다시 시도해 주세요.";
          err.style.display = "block";
          return;
        }
        notifySend(res.entry, phone);
        drawDone(res.entry);
      });
  });

  /* 알림톡(또는 문자) 발송. 서버가 예약번호와 연락처가 맞는지 확인한 뒤
     그 예약에 적힌 번호로만 보낸다. 실패해도 발급은 이미 끝난 일이다. */
  function notifySend(entry, phone) {
    try {
      fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codes: ["BFW-" + entry.code], phone: phone, event: "reserved" })
      }).catch(function () {});
    } catch (e) {}
  }

  function drawDone(entry) {
    hide("form");
    $("dCode").textContent = "BFW-" + entry.code;
    $("tLink").href = "ticket.html?c=" + encodeURIComponent(entry.code);
    try {
      var qr = qrcode(0, "M");
      qr.addData("BFW-" + entry.code);
      qr.make();
      $("qrBox").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    } catch (e) {
      $("qrBox").textContent = "BFW-" + entry.code;
    }
    show("done");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
})();
