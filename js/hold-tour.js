/* ===========================================================
   BUSAN FASHION WEEK — 사전 좌석 확보 화면 사용법 안내

   화면의 한 부분을 밝게 비추고 옆에 설명을 띄워, 한 단계씩 넘기며
   보여준다. 처음 들어왔을 때 한 번 자동으로 뜨고, '사용법' 버튼으로
   언제든 다시 볼 수 있다.

     HoldTour.start({ key, steps })        바로 시작
     HoldTour.autoStart({ key, steps })    본 적 없을 때만 시작

   step = {
     el    : "#selector" | function () { return element } | null(가운데 안내),
     title : "제목",
     html  : "설명 (HTML)",
     pad   : 비추는 여백(px, 기본 8)
     maxH  : 영역이 너무 길 때 윗부분만 이만큼 비춘다(px). 좌석 지도처럼 긴 곳에 쓴다.
   }

   '봤음' 기록은 이 브라우저에만 남긴다(localStorage). 막혀 있어도
   화면은 정상 동작하고, 그때는 매번 자동으로 뜰 뿐이다.
   =========================================================== */
(function (global) {
  "use strict";

  /* 움직임 효과는 넣지 않는다. 창이 뒤에 있거나 절전 중이면 애니메이션이 멈춰
     비추는 틀이 이전 자리에 남는 것을 확인했다. 매끄러움보다 정확함이 먼저다. */
  var CSS = [
    ".ht-block{position:fixed;inset:0;z-index:1000;background:transparent}",
    ".ht-dim{position:fixed;inset:0;z-index:1001;background:rgba(14,20,42,.58);pointer-events:none}",
    ".ht-hole{position:fixed;z-index:1002;border-radius:12px;pointer-events:none;",
    "  box-shadow:0 0 0 9999px rgba(14,20,42,.58),0 0 0 3px #fff,0 0 0 6px rgba(11,46,158,.9)}",
    ".ht-card{position:fixed;z-index:1003;width:360px;max-width:calc(100vw - 32px);background:#fff;",
    "  border-radius:14px;box-shadow:0 18px 50px rgba(10,20,60,.35);padding:18px 18px 14px;",
    "  font-family:'Pretendard Variable',Pretendard,-apple-system,system-ui,sans-serif;color:#1b2340}",
    ".ht-card .ht-step{font-family:'Space Mono',ui-monospace,monospace;font-size:.7rem;letter-spacing:.1em;color:#0b2e9e}",
    ".ht-card h3{margin:6px 0 8px;font-size:1.05rem;font-weight:800;line-height:1.4;word-break:keep-all}",
    ".ht-card .ht-body{font-size:.9rem;line-height:1.7;color:#3d4766;word-break:keep-all}",
    ".ht-card .ht-body b{color:#1b2340}",
    ".ht-card .ht-body .k{display:inline-block;padding:1px 7px;border-radius:5px;font-size:.8rem;",
    "  font-weight:700;border:1px solid #d5dae5;background:#f6f8fc;color:#1b2340;margin:0 1px}",
    ".ht-card .ht-body .sw{display:inline-block;width:13px;height:13px;border-radius:4px;vertical-align:-2px;margin-right:3px;border:1px solid #cfd5e2}",
    ".ht-card .ht-body ul,.ht-card .ht-body ol{margin:6px 0 0;padding-left:20px}",
    ".ht-card .ht-body li{margin:3px 0}",
    ".ht-dots{display:flex;gap:5px;margin-top:14px}",
    ".ht-dots i{width:6px;height:6px;border-radius:50%;background:#dfe3ec}",
    ".ht-dots i.on{background:#0b2e9e;width:16px;border-radius:3px}",
    ".ht-foot{display:flex;align-items:center;gap:8px;margin-top:12px}",
    ".ht-foot .sp{flex:1}",
    ".ht-btn{padding:8px 14px;border-radius:9px;border:1px solid #e3e7ef;background:#fff;color:#1b2340;",
    "  font-size:.86rem;cursor:pointer;font-family:inherit}",
    ".ht-btn:hover{border-color:#0b2e9e;color:#0b2e9e}",
    ".ht-btn.pri{background:#0b2e9e;border-color:#0b2e9e;color:#fff;font-weight:700}",
    ".ht-btn.pri:hover{background:#0a2887;color:#fff}",
    ".ht-skip{background:none;border:0;color:#8a93ad;font-size:.8rem;cursor:pointer;padding:6px 2px;font-family:inherit}",
    ".ht-skip:hover{color:#1b2340;text-decoration:underline}"
  ].join("\n");

  function css() {
    if (document.getElementById("ht-css")) return;
    var s = document.createElement("style");
    s.id = "ht-css";
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  function seen(key) { try { return localStorage.getItem(key) === "1"; } catch (e) { return false; } }
  function markSeen(key) { try { localStorage.setItem(key, "1"); } catch (e) {} }

  var active = null;

  function start(opt) {
    if (active) active.end(false);   // 이미 떠 있는 안내를 먼저 닫는다
    css();
    // 대상을 정해둔 단계인데 그 요소가 지금 화면에 없거나 숨겨져 있으면 건너뛴다.
    // (없는 칸을 가리키며 '여기에 적으세요' 라고 안내하는 일이 없도록)
    var steps = (opt.steps || []).filter(function (st) {
      if (!st.el) return true;
      var el = typeof st.el === "function" ? st.el() : document.querySelector(st.el);
      if (!el) return false;
      var r = el.getBoundingClientRect();
      return !(r.width === 0 && r.height === 0);
    });
    if (!steps.length) return;
    var i = 0;

    var block = document.createElement("div"); block.className = "ht-block";
    var dim = document.createElement("div"); dim.className = "ht-dim";
    var hole = document.createElement("div"); hole.className = "ht-hole";
    var card = document.createElement("div"); card.className = "ht-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-live", "polite");
    document.body.appendChild(block);
    document.body.appendChild(dim);
    document.body.appendChild(hole);
    document.body.appendChild(card);

    function target(step) {
      var el = typeof step.el === "function" ? step.el() : (step.el ? document.querySelector(step.el) : null);
      if (!el) return null;
      var r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;   // 숨겨진 요소
      return el;
    }

    function place() {
      var step = steps[i], el = target(step);
      var pad = step.pad != null ? step.pad : 8;
      var vw = window.innerWidth, vh = window.innerHeight;
      var cw = card.offsetWidth, ch = card.offsetHeight;

      if (!el) {
        // 가운데 안내 : 화면 전체를 어둡게, 카드를 가운데
        dim.style.display = "block";
        hole.style.display = "none";
        card.style.left = Math.round((vw - cw) / 2) + "px";
        card.style.top = Math.round((vh - ch) / 2) + "px";
        return;
      }
      dim.style.display = "none";           // 구멍의 그림자가 대신 어둡게 한다
      hole.style.display = "block";
      var r = el.getBoundingClientRect();
      var rh = step.maxH ? Math.min(r.height, step.maxH) : r.height;
      // 화면 가장자리에 붙은 요소(아래 고정 저장 막대 등)도 온전히 감싸도록 여백은 2px 만 둔다
      var t = Math.max(2, r.top - pad), l = Math.max(2, r.left - pad);
      var w = Math.min(vw - 4 - l, r.width + pad * 2), h = Math.min(vh - 2 - t, rh + pad * 2);
      hole.style.top = t + "px"; hole.style.left = l + "px";
      hole.style.width = w + "px"; hole.style.height = h + "px";

      // 카드 자리 : 오른쪽 → 왼쪽 → 아래 → 위 → 화면 안쪽 아무 데나
      var gap = 16, x, y;
      if (l + w + gap + cw <= vw - 12) { x = l + w + gap; y = t; }
      else if (l - gap - cw >= 12) { x = l - gap - cw; y = t; }
      else if (t + h + gap + ch <= vh - 12) { x = l; y = t + h + gap; }
      else if (t - gap - ch >= 12) { x = l; y = t - gap - ch; }
      else {
        // 어느 쪽에도 온전히 안 들어가면(창이 좁을 때) 비춘 곳과 반대편 끝에 붙인다
        x = Math.round((vw - cw) / 2);
        y = (t + h / 2 < vh / 2) ? vh - ch - 12 : 12;
      }
      x = Math.max(12, Math.min(vw - cw - 12, x));
      y = Math.max(12, Math.min(vh - ch - 12, y));
      card.style.left = Math.round(x) + "px";
      card.style.top = Math.round(y) + "px";
    }

    function show() {
      var step = steps[i], n = steps.length;
      card.innerHTML =
        '<div class="ht-step">' + (i + 1) + " / " + n + "</div>" +
        "<h3>" + step.title + "</h3>" +
        '<div class="ht-body">' + step.html + "</div>" +
        '<div class="ht-dots">' + steps.map(function (_, k) { return '<i class="' + (k === i ? "on" : "") + '"></i>'; }).join("") + "</div>" +
        '<div class="ht-foot">' +
          (i < n - 1 ? '<button type="button" class="ht-skip" data-ht="skip">건너뛰기</button>' : "") +
          '<span class="sp"></span>' +
          (i > 0 ? '<button type="button" class="ht-btn" data-ht="prev">이전</button>' : "") +
          '<button type="button" class="ht-btn pri" data-ht="next">' + (i < n - 1 ? "다음" : "시작하기") + "</button>" +
        "</div>";
      var el = target(step);
      if (el && el.scrollIntoView) {
        // 긴 영역은 윗부분이 보이게, 나머지는 가운데로
        el.scrollIntoView({ block: step.maxH ? "start" : "center", inline: "nearest", behavior: "auto" });
        if (step.maxH && step.offsetTop) window.scrollBy(0, -step.offsetTop);
      }
      // 스크롤이 끝난 뒤 자리를 잡는다
      place();
      setTimeout(place, 60);
      var btn = card.querySelector('[data-ht="next"]');
      if (btn) btn.focus({ preventScroll: true });
    }

    function onClick(e) {
      var b = e.target.closest ? e.target.closest("[data-ht]") : null;
      if (!b) return;
      var a = b.getAttribute("data-ht");
      if (a === "next") { if (i < steps.length - 1) { i++; show(); } else end(true); }
      else if (a === "prev") { if (i > 0) { i--; show(); } }
      else if (a === "skip") end(true);
    }
    function onKey(e) {
      if (e.key === "Escape") end(true);
      else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); if (i < steps.length - 1) { i++; show(); } else end(true); }
      else if (e.key === "ArrowLeft") { if (i > 0) { i--; show(); } }
    }
    var raf = 0;
    function onMove() { cancelAnimationFrame(raf); raf = requestAnimationFrame(place); }

    card.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);   // 안쪽 스크롤(주최측 지도)도 잡는다

    function end(done) {
      card.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
      [block, dim, hole, card].forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
      if (done && opt.key) markSeen(opt.key);
      active = null;
      if (opt.onEnd) opt.onEnd();
    }
    active = { end: end };
    show();
  }

  function end(done) { if (active) active.end(done); }

  global.HoldTour = {
    start: start,
    end: end,
    autoStart: function (opt) { if (!seen(opt.key)) start(opt); },
    isActive: function () { return !!active; }
  };
})(window);
