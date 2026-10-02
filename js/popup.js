/* ===========================================================
   BUSAN FASHION WEEK — 메인 팝업 공지

   메인 화면(index.html)에만 붙는다. 다른 페이지·예약 시스템과
   아무 관계가 없고, 이 파일을 지우면 팝업만 사라진다.

   바꿀 일이 생기면 바로 아래 POPUP 값만 고치면 된다.
     · 끄기        : enabled 를 false 로
     · 오픈 후 교체 : variant 를 "open" 으로  (이미지와 링크가 함께 바뀐다)
     · 노출 종료일  : until (이 날짜가 지나면 더 뜨지 않는다)
   =========================================================== */
(function () {
  "use strict";

  var POPUP = {
    enabled: true,
    /* "soon" : 오픈 전 (COMING SOON, 링크 없음)
       "open" : 오픈 후 (예약하러 가기 → 예약 페이지) */
    variant: "soon",
    /* 이 날짜까지만 보여준다. 행사 전날(10.28)까지 */
    until: "2026-10-28",
    art: {
      soon: { pc: "images/popup-soon.webp", mo: "images/popup-soon-m.webp", link: "" },
      open: { pc: "images/popup-open.webp", mo: "images/popup-open-m.webp", link: "register.html" }
    },
    /* 가로 폭이 이보다 좁으면 모바일 전용 이미지를 쓴다 */
    mobileAt: 640,
    /* "오늘 하루 보지 않기" 를 저장하는 열쇠 (판이 바뀌면 다시 보여준다) */
    key: "bfw_popup_2026"
  };

  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }

  /* 노출 기간이 지났는가 (문자열 비교로 충분하다 — 둘 다 YYYY-MM-DD) */
  function expired() { return POPUP.until && today() > POPUP.until; }

  /* 오늘은 보지 않기로 했는가 */
  function hiddenToday() {
    try {
      var v = localStorage.getItem(POPUP.key);
      return v === POPUP.variant + "|" + today();
    } catch (e) { return false; }   // 저장이 막혀 있으면 그냥 보여준다
  }
  function hideForToday() {
    try { localStorage.setItem(POPUP.key, POPUP.variant + "|" + today()); } catch (e) {}
  }

  function build() {
    var art = POPUP.art[POPUP.variant];
    if (!art) return;
    var mobile = window.matchMedia("(max-width:" + POPUP.mobileAt + "px)").matches;
    var src = mobile ? art.mo : art.pc;

    var back = document.createElement("div");
    back.className = "bfwpop";
    back.setAttribute("role", "dialog");
    back.setAttribute("aria-modal", "true");
    back.setAttribute("aria-label", "2026 부산패션위크 공지");

    var box = document.createElement("div");
    box.className = "bfwpop-box";

    /* 링크가 있을 때만 <a> 로 감싼다. 없으면 눌러도 아무 일이 없어야 한다. */
    var art_el;
    if (art.link) {
      art_el = document.createElement("a");
      art_el.href = art.link;
      art_el.className = "bfwpop-art";
    } else {
      art_el = document.createElement("div");
      art_el.className = "bfwpop-art";
    }
    var img = document.createElement("img");
    img.src = src;
    img.alt = POPUP.variant === "open"
      ? "2026 부산패션위크 패션쇼 관람 예약 접수 중"
      : "2026 부산패션위크 패션쇼 관람 예약 10월 6일 오픈";
    art_el.appendChild(img);

    var bar = document.createElement("div");
    bar.className = "bfwpop-bar";
    bar.innerHTML =
      '<label class="bfwpop-day"><input type="checkbox" id="bfwpopDay"><span>오늘 하루 보지 않기</span></label>' +
      '<button type="button" class="bfwpop-x" id="bfwpopClose">닫기</button>';

    box.appendChild(art_el);
    box.appendChild(bar);
    back.appendChild(box);
    document.body.appendChild(back);

    function close() {
      if (document.getElementById("bfwpopDay").checked) hideForToday();
      back.parentNode && back.parentNode.removeChild(back);
      document.removeEventListener("keydown", onKey);
    }
    function onKey(e) { if (e.key === "Escape") close(); }

    document.getElementById("bfwpopClose").addEventListener("click", close);
    /* 바깥을 눌러도 닫는다. 이미지·아래 띠를 누른 경우는 제외한다. */
    back.addEventListener("click", function (e) { if (e.target === back) close(); });
    document.addEventListener("keydown", onKey);
  }

  function start() {
    if (!POPUP.enabled || expired() || hiddenToday()) return;
    build();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
