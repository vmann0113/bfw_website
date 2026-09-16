/* ===========================================================
   BUSAN FASHION WEEK — 사전 좌석 확보 (hold.html)

   브랜드 · 대학이 링크 하나로 자기 몫 좌석을 잡는다.
   로그인은 없다. 주소의 t= 값이 열쇠다.

     hold.html?t=<토큰>

   좌석 지도는 주최측 화면과 같은 js/hall-map.js 를 쓴다(실제 홀 모양,
   둥근 정사각형 + 좌석번호). 선택 방식은 두 가지:
     - 구역 단위 : 좌석 어디를 눌러도 그 구역에서 고를 수 있는 좌석 전체
     - 좌석 단위 : 누른 좌석만
   그래서 "A구역 전체 중 뒤 3자리만 공개"는 구역 단위로 한 번,
   좌석 단위로 세 번이면 된다.

   이 화면은 예약 시스템을 건드리지 않는다. 쓰는 것은 holder_view /
   holder_set 두 개뿐이고, 둘 다 자기 몫만 만질 수 있도록 서버에서 막혀
   있다. 메인 사이트 설정(js/config.js)에도 기대지 않는다.
   =========================================================== */
(function () {
  "use strict";

  /* 운영의 config.js 는 예약 기능을 숨기려고 키를 일부러 비워두었다.
     anon 키는 브라우저 노출을 전제로 한 공개 키이며, 권한은 서버가 막는다. */
  var SB = {
    url: "https://hjcrzdzrgmubipxcgzce.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqY3J6ZHpyZ211YmlweGNnemNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1MTcwMzEsImV4cCI6MjEwNDA5MzAzMX0.T_61-FVfL0fKkR3IDEO8x30UQGfMWBVL6oQAF5m4tF8"
  };
  var NAVY = "#0b2e9e";

  var $ = function (id) { return document.getElementById(id); };
  var token = (new URLSearchParams(location.search).get("t") || "").trim();

  var data = null;      // holder_view 응답
  var map = null;       // HallMap
  var picked = {};      // 지금 화면에서 고른 좌석
  var saved = {};       // 서버에 저장된 상태 (되돌리기용)
  var inRange = {};     // 이 참여사가 고를 수 있는 좌석
  var byId = {};
  var mode = "seat";    // 참여사는 보통 몇 자리를 고르므로 좌석 단위로 시작. 대학은 구역 단위로 시작.
  var busy = false;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function keys(o) { return Object.keys(o).filter(function (k) { return o[k]; }); }

  /* 연락처 : 숫자만 받고 하이픈을 자동으로 넣는다 */
  function formatPhone(v) {
    var d = String(v || "").replace(/[^0-9]/g, "").slice(0, 11);
    if (d.length < 4) return d;
    if (d.indexOf("02") === 0) {
      if (d.length <= 5) return d.slice(0, 2) + "-" + d.slice(2);
      if (d.length <= 9) return d.slice(0, 2) + "-" + d.slice(2, d.length - 4) + "-" + d.slice(-4);
      return d.slice(0, 2) + "-" + d.slice(2, 6) + "-" + d.slice(6, 10);
    }
    if (d.length <= 7) return d.slice(0, 3) + "-" + d.slice(3);
    if (d.length <= 10) return d.slice(0, 3) + "-" + d.slice(3, 6) + "-" + d.slice(6);
    return d.slice(0, 3) + "-" + d.slice(3, 7) + "-" + d.slice(7);
  }
  function bindPhone(el) {
    if (!el || el.__phoneBound) return;
    el.__phoneBound = true;
    el.setAttribute("inputmode", "numeric");
    el.addEventListener("input", function () { el.value = formatPhone(el.value); });
    el.value = formatPhone(el.value);
  }
  /* '9월 17일 00:15' — 한국 시간 */
  function when(iso) {
    var d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
    return (d.getUTCMonth() + 1) + "월 " + d.getUTCDate() + "일 " +
      String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0");
  }

  function rpc(fn, body) {
    return fetch(SB.url + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: { apikey: SB.anonKey, Authorization: "Bearer " + SB.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.text().then(function (t) {
        var d = null;
        try { d = t ? JSON.parse(t) : null; } catch (e) { d = null; }
        if (!r.ok) throw Object.assign(new Error("api"), { status: r.status, data: d });
        return d;
      });
    });
  }

  function fatal(title, body) {
    $("loading").hidden = true;
    $("main").hidden = true;
    $("bar").hidden = true;
    var box = document.createElement("div");
    box.className = "note bad";
    box.style.marginTop = "40px";
    box.innerHTML = "<h4>" + esc(title) + "</h4>" + body;
    $("wrap").appendChild(box);
  }

  /* ---------- 고를 수 있는 좌석 ----------
     다른 참여사·주최측·관람객이 잡은 좌석은 안 된다.
     주최측이 좌석을 나눠줬으면(allowedSeats) 그 안에서만,
     예전 방식 구역 제한(zones)이 있으면 그 구역 안에서만. */
  function computeRange() {
    var h = data.holder;
    var allow = null;
    if (h.allowedSeats) { allow = {}; h.allowedSeats.forEach(function (id) { allow[id] = true; }); }
    inRange = {};
    data.seats.forEach(function (s) {
      if (s.state === "other" || s.state === "staff" || s.state === "reserved") return;
      if (h.zones && h.zones.indexOf(s.zone_code) < 0) return;
      if (allow && !allow[s.id]) return;
      inRange[s.id] = true;
    });
  }
  function canPick(s) { return !data.holder.closed && !!inRange[s.id]; }
  var hasRange = false;   // 주최측이 범위를 정해줬는가 (정해줬으면 범위를 눈에 띄게 칠한다)

  /* ---------- 좌석 칸 모양 ---------- */
  function decorate(s, el) {
    var st = s.state;
    if (picked[s.id]) {
      el.style.background = NAVY; el.style.borderColor = NAVY; el.style.color = "#fff";
    } else if (st === "other") {
      el.style.background = "#e8ebf1"; el.style.borderColor = "#e8ebf1"; el.style.color = "#a9b0c2";
    } else if (st === "staff") {
      el.style.background = "#efe9dc"; el.style.borderColor = "#e6dcc6"; el.style.color = "#a8977a";
    } else if (st === "reserved") {
      el.style.background = "#e8ebf1"; el.style.borderColor = "#e8ebf1"; el.style.color = "#a9b0c2";
    } else if (!inRange[s.id]) {
      el.style.background = "#f6f7fa"; el.style.borderColor = "#eef0f4"; el.style.color = "#c8cdd8";
    } else if (hasRange) {
      el.style.background = "#f1f4ff"; el.style.borderColor = "#b9c6f5"; el.style.color = "#3a4a86";
    }
    if (!canPick(s)) el.disabled = true;
    var why = picked[s.id] ? "확보(선택됨)" : st === "other" ? "다른 참여사 확보" : st === "staff" ? "주최측 지정"
      : st === "reserved" ? "관람객 예약" : !inRange[s.id] ? "선택할 수 없는 좌석" : "선택 가능";
    el.title = s.zone_code + "구역 " + s.num + "번 — " + why;
  }

  function sizeForWidth() {
    var w = ($("map").clientWidth || 340);
    var lab = w < 420 ? 24 : 30, run = w < 420 ? 30 : 48, gap = 3;
    var sq = Math.floor((w - 8 - run - 2 * lab - 8 * gap) / 6);
    sq = Math.max(22, Math.min(30, sq));
    return { w: sq, h: sq, gap: gap, sep: 12, lab: lab, run: run,
             fs: Math.max(9, Math.round(sq * 0.46)), rad: Math.round(sq * 0.28) };
  }

  function drawMap() {
    map = window.HallMap.create($("map"), {
      zones: data.zones,
      seats: data.seats,
      size: sizeForWidth(),
      numbers: true,
      drag: false,
      decorate: decorate,
      onSeat: function (s) {
        if (!canPick(s)) return;
        if (mode === "zone") toggleZone(s.zone_code);
        else { if (picked[s.id]) delete picked[s.id]; else picked[s.id] = true; map.repaint(s.id); }
        paintCounts();
      },
      onZone: function (code) {
        if (data.holder.closed) return;
        toggleZone(code);
        paintCounts();
      }
    });
  }

  /* 구역에서 고를 수 있는 좌석이 전부 골라져 있으면 전부 해제, 아니면 전부 선택 */
  function toggleZone(code) {
    var ids = data.seats.filter(function (s) { return s.zone_code === code && canPick(s); })
                        .map(function (s) { return s.id; });
    if (!ids.length) return;
    var all = ids.every(function (id) { return picked[id]; });
    ids.forEach(function (id) { if (all) delete picked[id]; else picked[id] = true; map.repaint(id); });
  }

  /* ---------- 선택 방식 ---------- */
  var MODE_HINT = {
    zone: "좌석 어디를 눌러도 <b>그 구역에서 고를 수 있는 좌석 전체</b>가 선택/해제됩니다.<br>몇 자리만 빼려면 <b>좌석 단위</b>로 바꿔 그 자리를 누르세요.",
    seat: "누른 좌석만 선택/해제됩니다. 구역 글자(A~H)를 누르면 구역 전체를 한 번에."
  };
  function syncMode() {
    [].forEach.call($("modeSeg").querySelectorAll("button"), function (b) {
      b.classList.toggle("on", b.getAttribute("data-mode") === mode);
    });
    $("modeHint").innerHTML = MODE_HINT[mode];
    if (map && map.setMode) map.setMode(mode);
  }
  $("modeSeg").addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("button[data-mode]") : null;
    if (!b || !data || data.holder.closed) return;
    mode = b.getAttribute("data-mode");
    syncMode();
  });

  /* ---------- 화면 ---------- */
  function render() {
    var h = data.holder, show = data.show;
    byId = {};
    data.seats.forEach(function (s) { byId[s.id] = s; });
    computeRange();
    hasRange = !!(h.allowedSeats || h.zones);

    $("showTitle").textContent = show.titleKo + (show.lineup ? " — " + show.lineup : "");
    $("holderName").textContent = h.name + (h.kind === "univ" ? " (대학)" : " (브랜드)");

    var m = [];
    m.push('<span class="chip">일시 <b>' + esc(show.date) + " " + esc(show.startTime) + "</b></span>");
    m.push('<span class="chip">장소 <b>' + esc(show.venue) + "</b></span>");
    m.push('<span class="chip">전체 정원 <b>' + show.capacity + "석</b></span>");
    if (hasRange) m.push('<span class="chip">고를 수 있는 좌석 <b>' + keys(inRange).length + "석</b></span>");
    if (h.maxSeats != null) m.push('<span class="chip">확보 한도 <b>' + h.maxSeats + "석</b></span>");
    if (h.savedAt) m.push('<span class="chip">마지막 저장 <b>' + esc(when(h.savedAt)) + "</b></span>");
    $("meta").innerHTML = m.join("");

    /* 이미 확보한 좌석으로 시작. 단, 주최측이 범위를 바꿔 지금은 범위 밖인 좌석은 빼고 알린다
       (그대로 두면 저장할 때 전체가 거부되어 아무것도 저장할 수 없다). */
    picked = {}; saved = {};
    var outside = [];
    data.seats.forEach(function (s) {
      if (s.state !== "mine") return;
      saved[s.id] = true;
      if (!inRange[s.id]) { outside.push(s.zone_code + "구역 " + s.num + "번"); return; }
      picked[s.id] = true;
    });
    // 확보한 좌석은 '고를 수 있는' 좌석이기도 하다(해제할 수 있어야 하므로)
    keys(picked).forEach(function (id) { inRange[id] = true; });

    var nt = [];
    if (h.closed) {
      nt.push('<div class="note bad"><h4>지금은 수정할 수 없습니다</h4>' +
        "사전 좌석 확보 기간이 아닙니다. 확보하신 내용은 그대로 보존되어 있으며, 아래에서 확인만 하실 수 있습니다. " +
        "변경이 필요하시면 사무국으로 연락해 주세요.</div>");
    } else {
      nt.push('<div class="note info"><h4>확보하실 좌석을 골라 주세요</h4>' +
        "여기서 확보한 자리는 <b>일반 관람객 예약에서 즉시 제외</b>됩니다. 기간 안에는 몇 번이든 다시 고치실 수 있습니다." +
        (hasRange ? " <b>파랗게 테두리 친 좌석</b>이 주최측과 협의해 배정된 범위입니다." : "") +
        (h.maxSeats != null ? " 확보 한도는 <b>" + h.maxSeats + "석</b>입니다." : "") + "</div>");
      if (h.kind === "univ") {
        nt.push('<div class="note warn"><h4>대학 참여사께</h4>' +
          "좌석을 많이 확보하고 일부만 일반에 공개하실 때는 <b>구역 단위</b>로 구역 전체를 고른 뒤, " +
          "<b>좌석 단위</b>로 바꿔 공개할 자리만 누르시면 빠릅니다.</div>");
      }
      if (outside.length) {
        nt.push('<div class="note warn"><h4>배정 범위가 바뀌었습니다</h4>' +
          "주최측에서 범위를 조정해, 확보하신 좌석 중 <b>" + outside.length + "석</b>(" + esc(outside.join(", ")) +
          ")이 범위 밖에 있습니다. 이 좌석은 선택에서 뺐으며 <b>저장하시면 해제</b>됩니다.</div>");
      }
    }
    $("notices").innerHTML = nt.join("");

    mode = h.kind === "univ" ? "zone" : "seat";
    $("loading").hidden = true;
    $("main").hidden = false;
    $("bar").hidden = false;
    $("tools").style.display = h.closed ? "none" : "";
    drawMap();
    syncMode();

    $("legend").innerHTML =
      '<span><i style="background:' + NAVY + ";border-color:" + NAVY + '"></i>우리가 확보</span>' +
      (hasRange ? '<span><i style="background:#f1f4ff;border-color:#b9c6f5"></i>고를 수 있는 좌석</span>'
                : '<span><i style="background:#fff"></i>고를 수 있는 좌석</span>') +
      '<span><i style="background:#e8ebf1;border-color:#e8ebf1"></i>다른 참여사</span>' +
      '<span><i style="background:#efe9dc;border-color:#e6dcc6"></i>주최측 지정</span>' +
      (hasRange ? '<span><i style="background:#f6f7fa;border-color:#eef0f4"></i>선택할 수 없음</span>' : "");

    if (h.closed) {
      $("formBox").hidden = true;
      $("saveBtn").disabled = true;
      $("resetBtn").disabled = true;
    } else {
      $("cName").value = h.contactName || "";
      $("cPhone").value = h.contactPhone || "";
      bindPhone($("cPhone"));
    }
    paintCounts();
  }

  function paintCounts() {
    var n = keys(picked).length;
    var max = data.holder.maxSeats;
    $("nMine").textContent = n;
    $("nMax").textContent = max != null ? " / " + max + "석" : "석";
    var otherLocks = data.seats.filter(function (s) { return s.state === "other" || s.state === "staff"; }).length;
    $("nPublic").textContent = Math.max(0, data.show.capacity - otherLocks - n);

    // 구역별 현황 — 몇 자리 뺐는지 바로 보이게. 일부만 고른 구역은 노랗게.
    var z = {};
    data.seats.forEach(function (s) {
      if (!canPick(s)) return;
      var r = z[s.zone_code] || (z[s.zone_code] = { sel: 0, tot: 0 });
      r.tot++; if (picked[s.id]) r.sel++;
    });
    $("zoneSum").innerHTML = Object.keys(z).sort().filter(function (k) { return z[k].sel > 0; }).map(function (k) {
      return '<span class="' + (z[k].sel < z[k].tot ? "part" : "") + '">' + k + " " + z[k].sel + "/" + z[k].tot + "</span>";
    }).join("");

    var over = max != null && n > max;
    $("saveBtn").disabled = busy || data.holder.closed || over;
    if (over) say("한도(" + max + "석)를 " + (n - max) + "석 넘었습니다", "err");
    else if (!busy && $("msg").className.indexOf("err") >= 0 && $("msg").textContent.indexOf("한도") === 0) say("", "");
  }

  function say(t, cls) {
    $("msg").textContent = t;
    $("msg").className = "msg" + (cls ? " " + cls : "");
  }

  var REASON = {
    badtoken:   "링크가 올바르지 않습니다. 사무국에서 받은 주소를 다시 확인해 주세요.",
    closed:     "사전 좌석 확보 기간이 아닙니다. 사무국으로 연락해 주세요.",
    overmax:    "확보 한도를 넘었습니다.",
    badzone:    "선택할 수 없는 구역이 포함되어 있습니다. 화면을 새로 불러왔습니다.",
    notallowed: "배정 범위 밖 좌석이 포함되어 있습니다. 주최측이 범위를 바꿨을 수 있어 화면을 새로 불러왔습니다.",
    badseat:    "좌석번호가 올바르지 않습니다. 화면을 새로 불러왔습니다.",
    taken:      "고르신 자리 중 일부를 방금 다른 참여사가 확보했습니다. 화면을 새로 불러왔습니다.",
    occupied:   "고르신 자리 중 일부는 이미 관람객이 예약했습니다. 화면을 새로 불러왔습니다."
  };

  $("saveBtn").addEventListener("click", function () {
    if (busy) return;
    busy = true;
    $("saveBtn").disabled = true;
    say("저장 중…", "");
    rpc("holder_set", {
      p_token: token,
      p_seat_ids: keys(picked),
      p_contact_name: $("cName").value.trim(),
      p_contact_phone: $("cPhone").value.trim()
    }).then(function (d) {
      busy = false;
      if (d && d.ok) {
        saved = {};
        keys(picked).forEach(function (k) { saved[k] = true; });
        say("저장했습니다 · 확보 " + d.saved + "석 / 일반 공개 " + d.publicRemaining + "석", "ok");
        $("saveBtn").disabled = false;
        return;
      }
      var r = (d && d.reason) || "";
      say(REASON[r] || "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", "err");
      // 상황이 바뀐 경우엔 최신 상태를 다시 받아야 한다
      if (r === "taken" || r === "occupied" || r === "badseat" || r === "notallowed" || r === "badzone") return load(true);
      $("saveBtn").disabled = false;
    }).catch(function () {
      busy = false;
      $("saveBtn").disabled = false;
      say("통신이 원활하지 않습니다. 잠시 후 다시 시도해 주세요.", "err");
    });
  });

  $("resetBtn").addEventListener("click", function () {
    var before = keys(picked);
    picked = {};
    keys(saved).forEach(function (k) { if (inRange[k]) picked[k] = true; });
    before.concat(keys(picked)).forEach(function (id) { map.repaint(id); });
    paintCounts();
    say("마지막으로 저장한 상태로 되돌렸습니다", "");
  });

  window.addEventListener("beforeunload", function (e) {
    if (!data || data.holder.closed) return;
    var a = keys(picked).sort().join(","), b = keys(saved).filter(function (k) { return inRange[k]; }).sort().join(",");
    if (a !== b) { e.preventDefault(); e.returnValue = ""; }
  });

  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (data) { drawMap(); syncMode(); } }, 200);
  });

  function load(keepMsg) {
    return rpc("holder_view", { p_token: token }).then(function (d) {
      if (!d || !d.ok) {
        if (d && d.reason === "badtoken") {
          return fatal("링크를 확인해 주세요",
            "이 주소로는 좌석 확보 화면을 열 수 없습니다. 사무국에서 받으신 링크를 주소창에 그대로 붙여넣어 주세요. " +
            "링크 끝의 <code>?t=</code> 뒤 글자가 빠지면 열리지 않습니다.");
        }
        return fatal("화면을 열 수 없습니다", "잠시 후 다시 시도해 주세요.");
      }
      var msg = keepMsg ? { t: $("msg").textContent, c: $("msg").className } : null;
      data = d;
      render();
      if (msg) { $("msg").textContent = msg.t; $("msg").className = msg.c; }
    }).catch(function () {
      fatal("연결할 수 없습니다", "통신이 원활하지 않습니다. 잠시 후 다시 시도해 주세요.");
    });
  }

  if (!window.HallMap) {
    fatal("화면을 열 수 없습니다", "좌석 지도를 불러오지 못했습니다. 새로고침해 주세요.");
  } else if (!token) {
    fatal("링크를 확인해 주세요", "주소에 열쇠가 없습니다. 사무국에서 받으신 링크를 그대로 열어 주세요.");
  } else {
    load();
  }
})();
