/* ===========================================================
   입구 입장 확인 화면 (gate.html)

   노트북 + 모니터 + QR 리더기 조합을 전제로 만들었다.
   리더기는 '글자를 치고 Enter' 로 동작하므로, 입력칸에 항상
   포커스를 되돌려 둬야 다음 사람이 바로 찍힌다.

   화면에서 가리는 것
     · 유효한 입장권인가
     · 지금 입장 중인 쇼의 입장권이 맞는가   ← 서버가 판정한다
     · 이미 들어온 사람인가

   쇼가 다르면 서버가 입장 처리를 하지 않고 돌려보낸다. 그래야
   엉뚱한 문에서 입장권이 소진되는 일이 없다.
   =========================================================== */
(function () {
  "use strict";
  var BFW = window.BFW, Api = window.BFWApi;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  };

  var SHOW_KEY = "bfw_gate_show";
  var RESV = /^(?:BFW-?)?(S\d{2}-[A-Z0-9]{4,10})$/i;
  var PRESS = /^(?:BFW-?)?(PRS-[A-Z0-9]{4,10})$/i;
  var shows = [], curShow = "", holdTimer = null, busy = false;

  /* ---------- 소리 : 스태프가 화면을 못 볼 때를 위한 신호 ---------- */
  var actx = null;
  function beep(kind) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      var seq = kind === "ok" ? [[880, 0, .09], [1320, .1, .12]]
              : kind === "warn" ? [[520, 0, .18]]
              : [[220, 0, .3]];
      seq.forEach(function (s) {
        var o = actx.createOscillator(), g = actx.createGain();
        o.type = "sine"; o.frequency.value = s[0];
        o.connect(g); g.connect(actx.destination);
        var t = actx.currentTime + s[1];
        g.gain.setValueAtTime(.0001, t);
        g.gain.exponentialRampToValueAtTime(.25, t + .01);
        g.gain.exponentialRampToValueAtTime(.0001, t + s[2]);
        o.start(t); o.stop(t + s[2] + .02);
      });
    } catch (e) {}
  }

  /* ---------- 시계 ---------- */
  function tick() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, "0"); };
    $("clock").textContent = (d.getMonth() + 1) + "." + p(d.getDate()) + " " +
      p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }

  /* ---------- 지금 입장 중인 쇼 ---------- */
  function showLabel(s) {
    return s.date.slice(5) + " " + s.time + " · " + (s.titleKo || s.title);
  }
  /* 지금 시각에 가장 가까운(아직 끝나지 않은) 쇼를 기본으로 고른다 */
  function nearest() {
    var now = Date.now(), best = null, bestGap = Infinity;
    shows.forEach(function (s) {
      var t = new Date(s.date.replace(/\./g, "-") + "T" + s.time + ":00").getTime();
      if (isNaN(t)) return;
      var gap = Math.abs(t - now);
      if (gap < bestGap) { bestGap = gap; best = s.id; }
    });
    return best || (shows[0] && shows[0].id) || "";
  }
  function initShows() {
    var cfg = BFW.baked ? BFW.baked() : BFW.load();
    shows = (cfg.shows || []).filter(function (s) { return !s.tbd; });
    var sel = $("showSel");
    sel.innerHTML = shows.map(function (s) {
      return '<option value="' + esc(s.id) + '">' + esc(showLabel(s)) + "</option>";
    }).join("");
    var saved = "";
    try { saved = localStorage.getItem(SHOW_KEY) || ""; } catch (e) {}
    curShow = shows.some(function (s) { return s.id === saved; }) ? saved : nearest();
    sel.value = curShow;
    sel.addEventListener("change", function () {
      curShow = sel.value;
      try { localStorage.setItem(SHOW_KEY, curShow); } catch (e) {}
      idle(); loadStats(); focusScan();
    });
  }
  function showById(id) {
    for (var i = 0; i < shows.length; i++) if (shows[i].id === id) return shows[i];
    return null;
  }

  /* ---------- 화면 ---------- */
  function paint(cls, big, who, sub, tag, meta) {
    clearTimeout(holdTimer);
    $("stage").className = cls;
    $("big").textContent = big;
    $("who").textContent = who || "";
    $("sub").innerHTML = sub || "";
    $("tagWrap").innerHTML = tag || "";
    $("meta").textContent = meta || "";
    $("picker").innerHTML = "";
    if (cls !== "idle") holdTimer = setTimeout(idle, cls === "ok" ? 3500 : 6000);
  }
  function idle() {
    var s = showById(curShow);
    paint("idle", "QR을 찍어 주세요", "",
      s ? esc(showLabel(s)) + " 입장 중" : "", "", "");
  }

  var TIER = {
    brand: { t: "사전확보석", c: "b" },
    web:   { t: "공개모집 예약", c: "w" },
    vip:   { t: "VIP석", c: "v" }
  };
  function tierTag(r) {
    var t = TIER[r.source] || TIER.web;
    return '<span class="tag ' + t.c + '">' + t.t + "</span>";
  }

  function okCard(r) {
    beep("ok");
    paint("ok", "✓ 입장 확인", r.name,
      esc(r.titleKo || r.showTitle || "") + " · " + esc(r.time || ""),
      tierTag(r), "BFW-" + r.code);
    loadStats();
  }
  function wrongShow(r) {
    beep("bad");
    var mine = showById(r.showId);
    paint("bad", "✕ 다른 시간대 입장권", r.name,
      "이 입장권은 <b>" + esc(mine ? showLabel(mine) : r.showId) + "</b> 입니다.<br>" +
      "지금 입장 중인 쇼가 아닙니다 — 입장 처리하지 않았습니다.",
      tierTag(r), "BFW-" + r.code);
  }
  function already(r) {
    beep("warn");
    paint("warn", "⚠ 이미 입장한 분입니다", r.name,
      r.checkedInAt ? "입장 시각 " + new Date(r.checkedInAt).toLocaleString("ko-KR") : "",
      tierTag(r), "BFW-" + r.code);
  }
  function netError() {
    beep("bad");
    paint("bad", "✕ 연결 문제", "",
      "서버에 닿지 못했습니다. <b>입장권 문제가 아닙니다.</b><br>" +
      "인터넷을 확인하고 다시 찍어 주세요. 계속되면 새로고침 후 다시 로그인하세요.", "", "");
  }
  function notFound(code) {
    beep("bad");
    paint("bad", "✕ 확인되지 않는 입장권", "",
      "취소되었거나 없는 예약번호입니다.<br>이름이나 연락처로 다시 찾아보세요.",
      "", code ? "입력값 " + code : "");
  }

  /* ---------- 처리 ---------- */
  function handle(raw) {
    var q = String(raw || "").trim();
    if (!q || busy) return;
    var mr = RESV.exec(q), mp = PRESS.exec(q);

    if (mr) { doResv(mr[1].toUpperCase()); return; }
    if (mp) { doPress(mp[1].toUpperCase()); return; }
    doSearch(q);
  }

  function doResv(code) {
    busy = true;
    paint("idle", "확인 중…", "", "", "", code);
    Api.checkIn(code, curShow).then(function (out) {
      busy = false;
      if (out.ok) return okCard(out.entry);
      if (out.reason === "wrongshow" && out.entry) return wrongShow(out.entry);
      if (out.reason === "already" && out.entry) return already(out.entry);
      if (out.reason === "forbidden") {
        beep("bad");
        return paint("bad", "✕ 로그인이 필요합니다", "",
          "스태프 로그인이 풀렸습니다. 새로고침 후 다시 로그인해 주세요.", "", "");
      }
      if (out.reason === "network") return netError();
      notFound("BFW-" + code);
    }).catch(function () { busy = false; netError(); });
    clearScan();
  }

  function doPress(code) {
    busy = true;
    paint("idle", "확인 중…", "", "", "", code);
    Api.pressCheckIn(code).then(function (out) {
      busy = false;
      if (out.ok) {
        beep("ok");
        paint("ok", "✓ 프레스 입장", out.entry.reporter,
          esc(out.entry.media || ""), '<span class="tag">프레스</span>', code);
        return;
      }
      if (out.reason === "already" && out.entry) {
        beep("warn");
        return paint("warn", "⚠ 이미 입장한 프레스입니다", out.entry.reporter,
          esc(out.entry.media || ""), '<span class="tag">프레스</span>', code);
      }
      if (out.reason === "network") return netError();
      beep("bad");
      paint("bad", "✕ 승인된 프레스가 아닙니다", "", "", "", code);
    }).catch(function () { busy = false; netError(); });
    clearScan();
  }

  /* 이름·연락처로 찾기 — 휴대폰이 꺼졌거나 QR이 안 읽힐 때 */
  function doSearch(q) {
    busy = true;
    paint("idle", "찾는 중…", "", "", "", q);
    Api.staffSearch(q).then(function (rows) {
      busy = false;
      clearScan();
      var mine = (rows || []).filter(function (r) { return r.showId === curShow; });
      var other = (rows || []).filter(function (r) { return r.showId !== curShow; });

      if (!rows || !rows.length) {
        beep("bad");
        return paint("bad", "✕ 찾을 수 없습니다", "",
          "이름 또는 연락처를 다시 확인해 주세요.", "", "검색 " + q);
      }
      if (!mine.length) {
        beep("bad");
        var r0 = other[0], s0 = showById(r0.showId);
        return paint("bad", "✕ 다른 시간대 예약", r0.name,
          "이 분의 예약은 <b>" + esc(s0 ? showLabel(s0) : r0.showId) + "</b> 입니다.",
          tierTag(r0), "BFW-" + r0.code);
      }
      if (mine.length === 1) { doResv(mine[0].code); return; }

      beep("warn");
      paint("warn", "여러 명이 찾아졌습니다", "", "입장하실 분을 눌러 주세요.", "", "검색 " + q);
      $("picker").innerHTML = mine.slice(0, 6).map(function (r) {
        return '<button type="button" data-code="' + esc(r.code) + '">' + esc(r.name) +
               "<small>" + esc(r.phone || "") + " · BFW-" + esc(r.code) +
               (r.checkedIn ? " · 이미 입장" : "") + "</small></button>";
      }).join("");
      $("picker").querySelectorAll("button").forEach(function (b) {
        b.addEventListener("click", function () { doResv(b.getAttribute("data-code")); });
      });
    }).catch(function () { busy = false; netError(); });
  }

  /* ---------- 현황 ---------- */
  function loadStats() {
    Api.attendanceStats().then(function (rows) {
      var r = (rows || []).filter(function (x) { return x.show_id === curShow; })[0];
      $("cEnt").textContent = r ? r.entered : 0;
      $("cRes").textContent = "/ " + (r ? r.reserved : 0) + " 예약";
    }).catch(function () {});
  }

  /* ---------- 입력칸 ---------- */
  function clearScan() { var el = $("scan"); el.value = ""; }
  function focusScan() { try { $("scan").focus(); } catch (e) {} }

  function start() {
    $("login").style.display = "none";
    initShows();
    idle();
    loadStats();
    setInterval(loadStats, 60000);
    focusScan();
    /* 리더기 입력을 놓치지 않도록 포커스를 계속 되돌린다 */
    setInterval(function () {
      if (document.activeElement !== $("scan") && !$("picker").contains(document.activeElement)) focusScan();
    }, 1200);
    document.addEventListener("click", function (e) {
      if (e.target.tagName !== "BUTTON" && e.target.tagName !== "SELECT") focusScan();
    });
  }

  /* ---------- 시작 ---------- */
  tick(); setInterval(tick, 1000);

  $("scan").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); handle(this.value); }
  });

  $("btnOut").addEventListener("click", function () {
    Api.staffSignOut();
    location.reload();
  });

  $("lgForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var err = $("lgErr");
    err.style.display = "none";
    Api.staffSignIn($("lgEmail").value.trim(), $("lgPw").value).then(function (out) {
      if (out && out.ok) { start(); return; }
      err.textContent = (out && out.error) || "로그인하지 못했습니다.";
      err.style.display = "";
    }).catch(function () {
      err.textContent = "연결할 수 없습니다. 잠시 후 다시 시도해 주세요.";
      err.style.display = "";
    });
  });

  if (Api.hasStaff()) start();
  else setTimeout(function () { try { $("lgEmail").focus(); } catch (e) {} }, 100);
})();
