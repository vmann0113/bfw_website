/* ===========================================================
   BUSAN FASHION WEEK — 현장등록 (walkin.html)

   행사장 배너의 QR 이 가리키는 화면이다. 예약 없이 오신 분이
   이름·연락처만 넣으면 그 자리에서 입장 처리된다.
   좌석이 없어 스탠딩이고, 알림톡도 QR 입장권도 없다 —
   제출 직후 뜨는 화면이 곧 입장 확인이다.

   어느 패션쇼인지는 화면이 고르지 않는다. 서버가 시각을 보고
   정한다(쇼 시작 60분 전 ~ 시작 후 10분). 그래서 배너는 한 종류면 된다.
   =========================================================== */
(function () {
  "use strict";
  var Api = window.BFWApi;
  var $ = function (id) { return document.getElementById(id); };

  var key = (function () {
    var m = /[?&]k=([^&#]+)/.exec(location.search);
    return m ? decodeURIComponent(m[1]) : "";
  })();

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function show(id) { $(id).classList.remove("hidden"); }
  function hide(id) { $(id).classList.add("hidden"); }

  function notice(title, body, when) {
    hide("loading"); hide("form");
    $("nTitle").textContent = title;
    $("nBody").innerHTML = body || "";
    $("nWhen").textContent = when || "";
    show("notice");
  }

  function bindPhone(el) {
    el.addEventListener("input", function () {
      var d = el.value.replace(/[^0-9]/g, "").slice(0, 11);
      if (d.length > 7) el.value = d.slice(0, 3) + "-" + d.slice(3, 7) + "-" + d.slice(7);
      else if (d.length > 3) el.value = d.slice(0, 3) + "-" + d.slice(3);
      else el.value = d;
      el.classList.remove("bad");
    });
  }

  var DOW = ["일", "월", "화", "수", "목", "금", "토"];
  function whenText(s) {
    var p = String(s.date || "").split(".");
    var dw = "";
    if (p.length === 3) {
      var d = new Date(+p[0], +p[1] - 1, +p[2]);
      if (!isNaN(d)) dw = "(" + DOW[d.getDay()] + ")";
    }
    return (p[1] || "") + "." + (p[2] || "") + dw;
  }

  if (!key) {
    notice("주소가 올바르지 않습니다", "행사장 배너의 QR 을 다시 찍어 주세요.");
    return;
  }

  Api.walkinShow(key).then(function (d) {
    if (!d || !d.ok) {
      notice("주소가 올바르지 않습니다", "행사장 배너의 QR 을 다시 찍어 주세요.");
      return;
    }
    if (!d.open) {
      if (!d.show) {
        notice("오늘 등록할 패션쇼가 없습니다", "행사 일정은 홈페이지에서 확인하실 수 있습니다.");
        return;
      }
      notice("아직 등록 시간이 아닙니다",
        "다음 패션쇼는 <b>" + esc(d.show.titleKo || d.show.title) + "</b> 입니다.<br>" +
        "시작 1시간 전부터 등록하실 수 있습니다.",
        d.nextAt + " 부터");
      return;
    }
    if (d.left <= 0) {
      notice("현장등록이 마감되었습니다",
        "<b>" + esc(d.show.titleKo || d.show.title) + "</b> 의 현장등록 " + d.cap + "명이 모두 찼습니다.<br>" +
        "다음 패션쇼를 이용해 주세요.");
      return;
    }

    $("sTitle").textContent = d.show.titleKo || d.show.title || "";
    $("sSub").textContent = (d.show.lineup || "") + (d.show.lineup ? " · " : "") + whenText(d.show);
    $("sTime").textContent = d.show.startTime + (d.show.endTime ? "–" + d.show.endTime : "");

    hide("loading");
    show("form");
  });

  bindPhone($("wPhone"));
  ["wName", "wPhone"].forEach(function (id) {
    $(id).addEventListener("input", function () { $(id).classList.remove("bad"); });
  });

  var REASON = {
    badkey:  "주소가 올바르지 않습니다. 배너의 QR 을 다시 찍어 주세요.",
    closed:  "지금은 등록 시간이 아닙니다. 패션쇼 시작 1시간 전부터 등록하실 수 있습니다.",
    full:    "현장등록이 마감되었습니다. 다음 패션쇼를 이용해 주세요.",
    badname: "이름을 정확히 적어 주세요.",
    badphone:"연락처를 정확히 적어 주세요.",
    dup:     "이 연락처로 이미 등록하셨습니다. 입구 스태프에게 말씀해 주세요.",
    network: "연결이 고르지 않습니다. 잠시 후 다시 시도해 주세요."
  };

  $("goBtn").addEventListener("click", function () {
    var name = $("wName").value.trim();
    var phone = $("wPhone").value.trim();
    var err = $("errBox");
    err.style.display = "none";

    if (!name) { $("wName").classList.add("bad"); $("wName").focus(); return; }
    if (phone.replace(/[^0-9]/g, "").length < 9) {
      $("wPhone").classList.add("bad"); $("wPhone").focus(); return;
    }
    if (!$("wAgree").checked) {
      err.textContent = "개인정보 수집·이용에 동의해 주세요.";
      err.style.display = "block";
      return;
    }

    var btn = $("goBtn");
    btn.disabled = true;
    btn.textContent = "등록 중…";

    Api.walkinRegister(key, { name: name, phone: phone }).then(function (res) {
      btn.disabled = false;
      btn.textContent = "등록하고 입장하기";
      if (!res.ok) {
        err.textContent = REASON[res.reason] || "지금 등록하지 못했습니다. 입구 스태프에게 말씀해 주세요.";
        err.style.display = "block";
        return;
      }
      $("dName").textContent = name + "님";
      $("dShow").textContent = (res.show.titleKo || res.show.title || "") + " · " + res.show.startTime;
      hide("main");
      show("doneWrap");
      window.scrollTo(0, 0);
    });
  });
})();
