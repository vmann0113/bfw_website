/* ===========================================================
   BUSAN FASHION WEEK — 벡스코 3B홀 좌석 지도

   실측 배치(가로 40.5m × 세로 102m, 세로형)를 그대로 따른다.

                 ┌──────── 무대 · LED ────────┐
        구역  3단 2단 1단 │  런웨이  │ 1단 2단 3단  구역
          A   ▯  ▯  ▯   │         │  ▯  ▯  ▯    E    ← 무대 최근접
          …  (12열)      │         │ (12열)
          B / C (12열)   │         │  F / G
          D   (14열)     │         │  H
                 └──────── 연출석 ────────┘

   - 런웨이 양옆으로 50열이 세로로 길게 늘어서고, 깊이는 3단이다.
   - 1단이 런웨이에 붙어 있다. 그래서 왼쪽은 [3단 2단 1단], 오른쪽은
     [1단 2단 3단] 순서로 좌우 대칭이 된다.
   - 한 구역 안 번호 = (단-1) × 열수 + 열번호. 열번호 1 이 무대 쪽.

   사전 좌석 확보 화면 두 곳(hold.html, hold-admin.html)이 같이 쓴다.
   메인 사이트 파일과는 무관하다.
   =========================================================== */
(function (global) {
  "use strict";

  var CSS = [
    ".hm{--hm-w:26px;--hm-h:14px;--hm-gap:2px;--hm-sep:9px;--hm-lab:30px;--hm-run:54px;",
    "  font-family:inherit;user-select:none;-webkit-user-select:none;display:inline-block}",
    ".hm-end{display:flex;align-items:center;justify-content:center;border-radius:8px;",
    "  font-size:.7rem;letter-spacing:.14em;font-weight:700;color:#55639b;height:26px}",
    ".hm-stage{background:linear-gradient(180deg,#c9d4f2,#dfe6f7);margin-bottom:8px}",
    ".hm-booth{background:#eef1f7;color:#8a93ad;margin-top:8px;width:40%;margin-left:auto;margin-right:auto}",
    ".hm-grid{display:grid;column-gap:var(--hm-gap);row-gap:var(--hm-gap);",
    "  grid-template-columns:var(--hm-lab) repeat(3,var(--hm-w)) var(--hm-run) repeat(3,var(--hm-w)) var(--hm-lab)}",
    ".hm-run{grid-column:5;grid-row:1/-1;border-radius:6px;display:flex;align-items:center;justify-content:center;",
    "  background:linear-gradient(180deg,#dfe6f7,#eef2ff);border:1px dashed #c3cfef}",
    ".hm-run span{writing-mode:vertical-rl;font-size:.62rem;letter-spacing:.3em;color:#7a86b3;font-weight:700}",
    ".hm-lab{display:flex;align-items:center;justify-content:center;border-radius:6px;font-weight:800;",
    "  font-size:.8rem;color:#44506f;background:#f1f3f8;border:1px solid transparent}",
    ".hm-lab.click{cursor:pointer}",
    ".hm-lab.click:hover{border-color:#0b2e9e;color:#0b2e9e;background:#eef2ff}",
    ".hm-seat{padding:0;margin:0;border:1px solid #dfe3ec;background:#fff;border-radius:3px;",
    "  font-size:.56rem;line-height:1;color:#8a93ad;cursor:pointer;font-family:ui-monospace,monospace;",
    "  display:flex;align-items:center;justify-content:center;touch-action:none}",
    ".hm-seat:disabled{cursor:not-allowed}",
    ".hm-seat.sel{outline:2px solid #ff4d6d;outline-offset:0;z-index:1;position:relative}",
    ".hm-legend{display:flex;flex-wrap:wrap;gap:6px 12px;margin-top:12px;font-size:.74rem;color:#6b7490}",
    ".hm-legend i{display:inline-block;width:12px;height:12px;border-radius:3px;border:1px solid #dfe3ec;",
    "  vertical-align:-2px;margin-right:4px}"
  ].join("\n");

  function injectCss() {
    if (document.getElementById("hm-css")) return;
    var st = document.createElement("style");
    st.id = "hm-css";
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  /*
    opt = {
      zones, seats,                 // 서버 데이터. seat 는 id, z|zone_code, n|num, t|tier, r|row_no
      size: { w, h, gap, sep, lab, run },   // 칸 크기(px). 생략하면 기본값
      numbers: bool,                // 칸 안에 좌석번호 표시
      drag: bool,                   // 끌어서 여러 석 선택 (주최측 화면)
      decorate(seat, el),           // 좌석 칸의 색·글자·disabled 를 정한다
      canSelect(seat) -> bool,      // 선택할 수 있는 좌석인가
      onSeat(seat),                 // 칸을 눌렀을 때 (drag=false 일 때)
      onZone(zoneCode, seats),      // 구역 이름을 눌렀을 때
      onChange(selectionSet)        // 선택이 바뀌었을 때 (drag=true 일 때)
    }
  */
  function create(container, opt) {
    injectCss();
    opt = opt || {};
    var sz = opt.size || {};
    var zones = opt.zones || [];
    var seats = (opt.seats || []).map(function (s) {
      return {
        id: s.id,
        z: s.z != null ? s.z : s.zone_code,
        n: s.n != null ? s.n : s.num,
        t: s.t != null ? s.t : s.tier,
        r: s.r != null ? s.r : s.row_no,
        raw: s
      };
    });
    var byId = {};
    seats.forEach(function (s) { byId[s.id] = s; });
    var sel = {};
    var els = {};

    var root = document.createElement("div");
    root.className = "hm";
    if (sz.w) root.style.setProperty("--hm-w", sz.w + "px");
    if (sz.h) root.style.setProperty("--hm-h", sz.h + "px");
    if (sz.gap != null) root.style.setProperty("--hm-gap", sz.gap + "px");
    if (sz.sep) root.style.setProperty("--hm-sep", sz.sep + "px");
    if (sz.lab) root.style.setProperty("--hm-lab", sz.lab + "px");
    if (sz.run) root.style.setProperty("--hm-run", sz.run + "px");

    var stage = document.createElement("div");
    stage.className = "hm-end hm-stage";
    stage.textContent = "무대 · LED";
    root.appendChild(stage);

    var grid = document.createElement("div");
    grid.className = "hm-grid";
    root.appendChild(grid);

    var booth = document.createElement("div");
    booth.className = "hm-end hm-booth";
    booth.textContent = "연출석";
    root.appendChild(booth);

    /* 구역을 무대에서 가까운 순으로 줄 세우고, 좌우 같은 순번끼리 같은 높이에 둔다 */
    function bySort(a, b) { return a.sort - b.sort; }
    var L = zones.filter(function (z) { return z.side === "L"; }).sort(bySort);
    var R = zones.filter(function (z) { return z.side === "R"; }).sort(bySort);
    var bands = [];
    var rowSizes = [];
    var line = 1;
    var nb = Math.max(L.length, R.length);
    for (var i = 0; i < nb; i++) {
      var rows = Math.max(L[i] ? L[i].rows : 0, R[i] ? R[i].rows : 0);
      bands.push({ L: L[i], R: R[i], start: line, rows: rows });
      for (var k = 0; k < rows; k++) rowSizes.push("var(--hm-h)");
      line += rows;
      if (i < nb - 1) { rowSizes.push("var(--hm-sep)"); line += 1; }
    }
    grid.style.gridTemplateRows = rowSizes.join(" ");

    var run = document.createElement("div");
    run.className = "hm-run";
    run.innerHTML = "<span>RUNWAY</span>";
    grid.appendChild(run);

    var bandOf = {};
    bands.forEach(function (b) {
      if (b.L) bandOf[b.L.code] = b;
      if (b.R) bandOf[b.R.code] = b;
    });
    var sideOf = {};
    zones.forEach(function (z) { sideOf[z.code] = z.side; });

    /* 구역 이름표 */
    function label(z, col) {
      var b = bandOf[z.code];
      var el = document.createElement("div");
      el.className = "hm-lab" + (opt.onZone ? " click" : "");
      el.style.gridColumn = col;
      el.style.gridRow = b.start + " / span " + b.rows;
      el.textContent = z.code;
      el.title = z.label + " · " + z.seatCount + "석" + (opt.onZone ? " — 누르면 구역 전체" : "");
      if (opt.onZone) {
        el.addEventListener("click", function () {
          opt.onZone(z.code, seats.filter(function (s) { return s.z === z.code; }));
        });
      }
      grid.appendChild(el);
    }
    L.forEach(function (z) { label(z, 1); });
    R.forEach(function (z) { label(z, 9); });

    /* 좌석 */
    seats.forEach(function (s) {
      var b = bandOf[s.z];
      if (!b) return;
      var col = sideOf[s.z] === "L" ? 5 - s.t : 5 + s.t;
      var el = document.createElement("button");
      el.type = "button";
      el.className = "hm-seat";
      el.setAttribute("data-seat", s.id);
      el.style.gridColumn = col;
      el.style.gridRow = String(b.start + s.r - 1);
      if (opt.numbers) el.textContent = s.n;
      el.title = s.z + "구역 " + s.n + "번 (" + s.t + "단 " + s.r + "열)";
      els[s.id] = el;
      grid.appendChild(el);
    });

    function paint(id) {
      var s = byId[id], el = els[id];
      if (!s || !el) return;
      var keep = el.className.indexOf(" sel") >= 0;
      el.className = "hm-seat";
      el.removeAttribute("style");
      var col = sideOf[s.z] === "L" ? 5 - s.t : 5 + s.t;
      el.style.gridColumn = col;
      el.style.gridRow = String(bandOf[s.z].start + s.r - 1);
      el.disabled = false;
      if (opt.numbers) el.textContent = s.n;
      if (opt.decorate) opt.decorate(s.raw, el);
      if (sel[id]) el.classList.add("sel");
    }
    function paintAll() { Object.keys(els).forEach(paint); }

    /* 선택 */
    function selectable(id) {
      var s = byId[id];
      if (!s) return false;
      return opt.canSelect ? !!opt.canSelect(s.raw) : true;
    }
    function setSel(id, on) {
      if (on && selectable(id)) sel[id] = true; else delete sel[id];
      if (els[id]) els[id].classList.toggle("sel", !!sel[id]);
    }

    /* 같은 자리에 지도를 다시 그리면 이전 지도의 전역 처리기를 치운다.
       치우지 않으면 다시 그릴 때마다 window 에 쌓인다. */
    if (container.__hmCleanup) { try { container.__hmCleanup(); } catch (x) {} }
    var cleanups = [];

    var dragging = false;
    if (opt.drag) {
      var paintOn = true, touched = {};
      grid.addEventListener("pointerdown", function (e) {
        var el = e.target.closest ? e.target.closest(".hm-seat") : null;
        if (!el) return;
        e.preventDefault();
        var id = el.getAttribute("data-seat");
        dragging = true;
        touched = {};
        paintOn = !sel[id];
        touched[id] = true;
        setSel(id, paintOn);
        try { grid.setPointerCapture(e.pointerId); } catch (x) {}
      });
      grid.addEventListener("pointermove", function (e) {
        if (!dragging) return;
        var t = document.elementFromPoint(e.clientX, e.clientY);
        var el = t && t.closest ? t.closest(".hm-seat") : null;
        if (!el) return;
        var id = el.getAttribute("data-seat");
        if (touched[id]) return;
        touched[id] = true;
        setSel(id, paintOn);
      });
      var end = function () {
        if (!dragging) return;
        dragging = false;
        if (opt.onChange) opt.onChange(api.getSelection());
      };
      grid.addEventListener("pointerup", end);
      grid.addEventListener("pointercancel", end);
      window.addEventListener("pointerup", end);
      cleanups.push(function () { window.removeEventListener("pointerup", end); });
    } else {
      grid.addEventListener("click", function (e) {
        var el = e.target.closest ? e.target.closest(".hm-seat") : null;
        if (!el || el.disabled) return;
        var s = byId[el.getAttribute("data-seat")];
        if (s && opt.onSeat) opt.onSeat(s.raw);
      });
    }

    container.innerHTML = "";
    container.appendChild(root);
    container.__hmCleanup = function () { cleanups.forEach(function (f) { f(); }); };

    var api = {
      el: root,
      /* 끄는 중이면 다시 그리지 말 것 — 선택이 사라진다 */
      isDragging: function () { return dragging; },
      getSelection: function () { return Object.keys(sel).sort(); },
      setSelection: function (ids) {
        Object.keys(sel).forEach(function (id) { setSel(id, false); });
        (ids || []).forEach(function (id) { setSel(id, true); });
        if (opt.onChange) opt.onChange(api.getSelection());
      },
      addSelection: function (ids, on) {
        (ids || []).forEach(function (id) { setSel(id, on !== false); });
        if (opt.onChange) opt.onChange(api.getSelection());
      },
      clearSelection: function () {
        Object.keys(sel).forEach(function (id) { setSel(id, false); });
        if (opt.onChange) opt.onChange(api.getSelection());
      },
      repaint: function (id) { if (id) paint(id); else paintAll(); },
      seatsInZone: function (code) {
        return seats.filter(function (s) { return s.z === code; }).map(function (s) { return s.id; });
      }
    };
    paintAll();
    return api;
  }

  global.HallMap = { create: create };
})(window);
