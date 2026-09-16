/* ===========================================================
   BUSAN FASHION WEEK — 사전 좌석 확보 (hold.html)

   브랜드 · 대학이 링크 하나로 자기 몫 좌석을 잡는다.
   로그인은 없다. 주소의 t= 값이 열쇠다.

     hold.html?t=<토큰>

   이 화면은 예약 시스템을 건드리지 않는다. 쓰는 것은
   holder_view / holder_set 두 개뿐이고, 둘 다 자기 몫만
   만질 수 있도록 서버에서 막혀 있다.
   =========================================================== */
(function () {
  "use strict";

  /* 이 화면은 메인 사이트 설정(js/config.js)에 기대지 않는다.
     운영의 config.js 는 예약 기능을 숨기려고 키를 일부러 비워두었고,
     거기를 채우면 메인 사이트의 공개 스위치를 건드리게 된다.
     그래서 연결 정보를 여기 따로 둔다. anon 키는 브라우저에 노출되도록
     설계된 공개 키이며, 실제 권한은 서버의 함수·RLS 가 막는다. */
  var SB = {
    url: "https://hjcrzdzrgmubipxcgzce.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqY3J6ZHpyZ211YmlweGNnemNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1MTcwMzEsImV4cCI6MjEwNDA5MzAzMX0.T_61-FVfL0fKkR3IDEO8x30UQGfMWBVL6oQAF5m4tF8"
  };
  var $ = function (id) { return document.getElementById(id); };

  var token = (new URLSearchParams(location.search).get("t") || "").trim();

  var data = null;      // holder_view 응답
  var picked = {};      // { seatId: true } — 지금 화면에서 고른 것
  var saved = {};       // 마지막으로 저장된 상태 (되돌리기용)
  var busy = false;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function keys(o) { return Object.keys(o).filter(function (k) { return o[k]; }); }

  /* 연락처 : 숫자만 받고 하이픈을 자동으로 넣는다 (010-1234-5678) */
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

  /* '9월 17일 00:15' — 한국 시간 기준 */
  function when(iso) {
    var d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
    var hh = String(d.getUTCHours()).padStart(2, "0");
    var mm = String(d.getUTCMinutes()).padStart(2, "0");
    return (d.getUTCMonth() + 1) + "월 " + d.getUTCDate() + "일 " + hh + ":" + mm;
  }

  function rpc(fn, body) {
    return fetch(SB.url.replace(/\/$/, "") + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: {
        apikey: SB.anonKey,
        Authorization: "Bearer " + SB.anonKey,
        "Content-Type": "application/json"
      },
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

  /* ---------- 화면 잠금 안내 ---------- */
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

  /* ---------- 좌석 격자 ----------
     실제 배치도와 같은 방향으로 그린다.
     한 구역은 3단(tier) × 열수(rows) 이고, 좌석번호는
     (단-1) × 열수 + 열번호 다. 좌측 구역은 바깥단이 왼쪽,
     우측 구역은 런웨이가 왼쪽이라 순서가 뒤집힌다. */
  function zoneBlock(z, seatsByZone) {
    var R = z.rows;
    var list = seatsByZone[z.code] || [];
    var byNum = {};
    list.forEach(function (s) { byNum[s.num] = s; });

    var el = document.createElement("div");
    el.className = "zone";
    el.setAttribute("data-zone", z.code);

    var h = document.createElement("div");
    h.className = "zone-h";
    h.innerHTML = '<b>' + esc(z.label) + '</b>' +
      '<span class="cnt" data-cnt="' + z.code + '">0 / ' + z.seatCount + '</span>' +
      '<span class="zbtns">' +
        '<button type="button" data-all="' + z.code + '">전체</button>' +
        '<button type="button" data-none="' + z.code + '">해제</button>' +
      '</span>';
    el.appendChild(h);

    var g = document.createElement("div");
    g.className = "grid";
    for (var r = 1; r <= R; r++) {
      var nums = (z.side === "L") ? [2 * R + r, R + r, r] : [r, R + r, 2 * R + r];
      for (var c = 0; c < 3; c++) {
        var s = byNum[nums[c]];
        var b = document.createElement("button");
        b.type = "button";
        b.className = "seat";
        b.textContent = nums[c];
        if (!s) { b.disabled = true; b.className += " other"; g.appendChild(b); continue; }
        b.setAttribute("data-seat", s.id);
        b.setAttribute("aria-label", z.label + " " + s.num + "번");
        if (s.state === "other" || s.state === "staff" || s.state === "reserved") {
          b.disabled = true;
          b.className += " " + s.state;
        }
        g.appendChild(b);
      }
    }
    el.appendChild(g);
    return el;
  }

  function render() {
    var h = data.holder, show = data.show;
    $("showTitle").textContent = show.titleKo + (show.lineup ? " — " + show.lineup : "");
    $("holderName").textContent = h.name + (h.kind === "univ" ? " (대학)" : " (브랜드)");

    var m = [];
    m.push('<span class="chip">일시 <b>' + esc(show.date) + " " + esc(show.startTime) + "</b></span>");
    m.push('<span class="chip">장소 <b>' + esc(show.venue) + "</b></span>");
    m.push('<span class="chip">전체 정원 <b>' + show.capacity + "석</b></span>");
    if (h.maxSeats != null) m.push('<span class="chip">확보 한도 <b>' + h.maxSeats + "석</b></span>");
    if (h.zones) m.push('<span class="chip">선택 가능 구역 <b>' + h.zones.join(", ") + "</b></span>");
    if (h.savedAt) {
      m.push('<span class="chip">마지막 저장 <b>' + esc(when(h.savedAt)) + "</b></span>");
    }
    $("meta").innerHTML = m.join("");

    /* 안내문 */
    var nt = [];
    if (h.closed) {
      nt.push('<div class="note bad"><h4>지금은 수정할 수 없습니다</h4>' +
        "사전 좌석 확보 기간이 아닙니다. 확보하신 내용은 그대로 보존되어 있으며, 아래에서 확인만 하실 수 있습니다. " +
        "변경이 필요하시면 사무국으로 연락해 주세요.</div>");
    } else {
      nt.push('<div class="note info"><h4>확보하실 좌석을 눌러 주세요</h4>' +
        "여기서 확보한 자리는 <b>일반 관람객 예약에서 즉시 제외</b>됩니다. " +
        "저장 후에도 기간 안에는 몇 번이든 다시 고치실 수 있습니다." +
        (h.maxSeats != null ? " 확보 한도는 <b>" + h.maxSeats + "석</b>입니다." : "") +
        "</div>");
      if (h.kind === "univ") {
        nt.push('<div class="note warn"><h4>대학 참여사께</h4>' +
          "관계자 좌석을 많이 확보하고 일부만 일반에 공개하실 경우, 구역 이름 옆의 " +
          "<b>전체</b> 를 눌러 한 구역씩 통째로 확보하신 뒤 공개할 자리만 <b>해제</b> 하시면 빠릅니다.</div>");
      }
    }
    $("notices").innerHTML = nt.join("");

    /* 좌석 */
    var byZone = {};
    data.seats.forEach(function (s) {
      (byZone[s.zone_code] = byZone[s.zone_code] || []).push(s);
    });
    var allowed = h.zones ? h.zones : null;
    var L = [], R = [];
    data.zones.forEach(function (z) { (z.side === "L" ? L : R).push(z); });
    $("sideL").innerHTML = ""; $("sideR").innerHTML = "";
    L.forEach(function (z) { $("sideL").appendChild(zoneBlock(z, byZone)); });
    R.forEach(function (z) { $("sideR").appendChild(zoneBlock(z, byZone)); });

    /* 고를 수 없는 구역은 아예 잠근다 */
    if (allowed) {
      document.querySelectorAll(".zone").forEach(function (zEl) {
        var code = zEl.getAttribute("data-zone");
        if (allowed.indexOf(code) >= 0) return;
        zEl.style.opacity = ".45";
        zEl.querySelectorAll("button").forEach(function (b) { b.disabled = true; });
        var c = zEl.querySelector(".cnt");
        if (c) c.textContent = "선택 불가";
      });
    }

    /* 이미 확보한 좌석을 골라둔 상태로 시작.
       단, 주최측이 구역을 바꿔 '배정 구역 밖'이 된 좌석은 빼고 시작한다.
       그대로 두면 저장할 때 구역 밖이라는 이유로 전체가 거부되어
       참여사가 아무것도 저장하지 못하게 된다. 대신 분명히 알린다. */
    picked = {};
    var outside = [];
    data.seats.forEach(function (s) {
      if (s.state !== "mine") return;
      if (allowed && allowed.indexOf(s.zone_code) < 0) { outside.push(s.id); return; }
      picked[s.id] = true;
    });
    // '되돌리기' 는 서버에 실제로 저장된 상태로 돌아가야 하므로 구역 밖 좌석도 포함한다
    saved = {};
    data.seats.forEach(function (s) { if (s.state === "mine") saved[s.id] = true; });
    if (outside.length && !h.closed) {
      $("notices").insertAdjacentHTML("beforeend",
        '<div class="note warn"><h4>배정 구역이 바뀌었습니다</h4>' +
        "주최측에서 선택 가능 구역을 조정해, 이전에 확보하신 좌석 중 <b>" + outside.length +
        "석</b>(" + esc(outside.join(", ")) + ")이 배정 구역 밖에 있습니다. " +
        "이 좌석은 선택에서 뺐으며, <b>저장하시면 해제</b>됩니다. " +
        "문의는 사무국으로 연락해 주세요.</div>");
    }

    if (h.closed) {
      document.querySelectorAll(".seat, .zbtns button").forEach(function (b) { b.disabled = true; });
      $("formBox").hidden = true;
    } else {
      $("cName").value = h.contactName || "";
      $("cPhone").value = h.contactPhone || "";
      bindPhone($("cPhone"));
    }

    $("loading").hidden = true;
    $("main").hidden = false;
    $("bar").hidden = false;
    $("saveBtn").disabled = !!h.closed;
    $("resetBtn").disabled = !!h.closed;
    paint();
  }

  /* ---------- 고른 상태를 화면에 반영 ---------- */
  function paint() {
    document.querySelectorAll(".seat[data-seat]").forEach(function (b) {
      var id = b.getAttribute("data-seat");
      var on = !!picked[id];
      if (b.classList.contains("other") || b.classList.contains("staff") ||
          b.classList.contains("reserved")) return;
      b.classList.toggle("mine", on);
    });
    document.querySelectorAll("[data-cnt]").forEach(function (el) {
      var code = el.getAttribute("data-cnt");
      if (el.textContent === "선택 불가") return;
      var tot = 0, n = 0;
      document.querySelectorAll('.zone[data-zone="' + code + '"] .seat[data-seat]').forEach(function (b) {
        tot++;
        if (picked[b.getAttribute("data-seat")]) n++;
      });
      el.textContent = n + " / " + tot;
    });

    var n = keys(picked).length;
    var max = data.holder.maxSeats;
    $("nMine").textContent = n;
    $("nMax").textContent = max != null ? " / " + max + "석" : "석";
    // 남이 확보한 것 + 주최측 지정 + 내가 지금 고른 것
    var otherLocks = data.seats.filter(function (s) {
      return s.state === "other" || s.state === "staff";
    }).length;
    $("nPublic").textContent = Math.max(0, data.show.capacity - otherLocks - n);

    var over = max != null && n > max;
    $("saveBtn").disabled = busy || data.holder.closed || over;
    if (over) say("한도(" + max + "석)를 " + (n - max) + "석 넘었습니다", "err");
    else if (!busy) say("", "");
  }

  function say(t, cls) {
    var el = $("msg");
    el.textContent = t;
    el.className = "msg" + (cls ? " " + cls : "");
  }

  /* ---------- 조작 ---------- */
  document.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("button") : null;
    if (!b || b.disabled) return;

    var seat = b.getAttribute("data-seat");
    if (seat) {
      if (picked[seat]) delete picked[seat]; else picked[seat] = true;
      paint();
      return;
    }
    var all = b.getAttribute("data-all");
    if (all) {
      document.querySelectorAll('.zone[data-zone="' + all + '"] .seat[data-seat]').forEach(function (s) {
        if (!s.disabled) picked[s.getAttribute("data-seat")] = true;
      });
      paint();
      return;
    }
    var none = b.getAttribute("data-none");
    if (none) {
      document.querySelectorAll('.zone[data-zone="' + none + '"] .seat[data-seat]').forEach(function (s) {
        delete picked[s.getAttribute("data-seat")];
      });
      paint();
      return;
    }
  });

  var REASON = {
    badtoken: "링크가 올바르지 않습니다. 사무국에서 받은 주소를 다시 확인해 주세요.",
    closed:   "사전 좌석 확보 기간이 아닙니다. 사무국으로 연락해 주세요.",
    overmax:  "확보 한도를 넘었습니다.",
    badzone:  "선택할 수 없는 구역이 포함되어 있습니다.",
    badseat:  "좌석번호가 올바르지 않습니다. 새로고침 후 다시 시도해 주세요.",
    taken:    "고르신 자리 중 일부를 방금 다른 참여사가 확보했습니다. 화면을 새로 불러왔습니다.",
    occupied: "고르신 자리 중 일부는 이미 관람객이 예약했습니다. 화면을 새로 불러왔습니다."
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
      // 자리를 빼앗긴 경우엔 최신 상태를 다시 받아야 한다
      if (r === "taken" || r === "occupied" || r === "badseat") return load(true);
      $("saveBtn").disabled = false;
    }).catch(function () {
      busy = false;
      $("saveBtn").disabled = false;
      say("통신이 원활하지 않습니다. 잠시 후 다시 시도해 주세요.", "err");
    });
  });

  $("resetBtn").addEventListener("click", function () {
    var allowed = data && data.holder.zones;
    var zoneOf = {};
    (data ? data.seats : []).forEach(function (s) { zoneOf[s.id] = s.zone_code; });
    picked = {};
    keys(saved).forEach(function (k) {
      if (allowed && allowed.indexOf(zoneOf[k]) < 0) return;  // 구역 밖은 되살리지 않는다
      picked[k] = true;
    });
    paint();
    say("마지막으로 저장한 상태로 되돌렸습니다", "");
  });

  /* 저장하지 않고 나가려 할 때 */
  window.addEventListener("beforeunload", function (e) {
    if (!data || data.holder.closed) return;
    var a = keys(picked).sort().join(","), b = keys(saved).sort().join(",");
    if (a !== b) { e.preventDefault(); e.returnValue = ""; }
  });

  /* ---------- 시작 ---------- */
  function load(keepMsg) {
    return rpc("holder_view", { p_token: token }).then(function (d) {
      if (!d || !d.ok) {
        if (d && d.reason === "badtoken") {
          return fatal("링크를 확인해 주세요",
            "이 주소로는 좌석 확보 화면을 열 수 없습니다. 사무국에서 받으신 링크를 " +
            "주소창에 그대로 붙여넣어 주세요. 링크 끝의 <code>?t=</code> 뒤 글자가 " +
            "빠지면 열리지 않습니다.");
        }
        return fatal("화면을 열 수 없습니다", "잠시 후 다시 시도해 주세요.");
      }
      data = d;
      render();
      if (keepMsg) say("다른 참여사의 확보 내용을 반영해 화면을 새로 불러왔습니다", "err");
    }).catch(function () {
      fatal("연결할 수 없습니다", "통신이 원활하지 않습니다. 잠시 후 다시 시도해 주세요.");
    });
  }

  if (!SB.url || !SB.anonKey) {
    fatal("아직 준비 중입니다", "사전 좌석 확보 창구가 아직 열리지 않았습니다.");
  } else if (!token) {
    fatal("링크를 확인해 주세요",
      "주소에 열쇠가 없습니다. 사무국에서 받으신 링크를 그대로 열어 주세요.");
  } else {
    load();
  }
})();
