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

   인터넷이 끊겨도 줄이 멈추면 안 된다. 그래서 명단을 미리 받아
   노트북에 두고, 끊긴 동안에는 그 명단으로 확인한 뒤 찍은 기록을
   쌓아 둔다. 연결이 돌아오면 자동으로 서버에 올린다.
   명단에는 관람객 이름·연락처가 들어가므로 24시간 지나면 스스로
   지워지고, 화면에서 바로 지울 수도 있다.
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
  var ROSTER_KEY = "bfw_gate_roster";
  var QUEUE_KEY = "bfw_gate_queue";
  var MAX_AGE = 24 * 60 * 60 * 1000;   // 명단은 하루 지나면 스스로 지운다
  var RESV = /^(?:BFW-?)?(S\d{2}-[A-Z0-9]{4,10})$/i;
  var PRESS = /^(?:BFW-?)?(PRS-[A-Z0-9]{4,10})$/i;

  var shows = [], curShow = "", holdTimer = null, busy = false;
  var online = (navigator.onLine !== false);

  /* ---------- 노트북에 남기는 자료 ---------- */
  function readJson(k, dflt) {
    try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : dflt; }
    catch (e) { return dflt; }
  }
  /* 저장이 막히거나 가득 차면 기록이 사라진다. 묻지 말고 알려야 한다. */
  function writeJson(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { return false; }
  }

  function loadRoster() {
    var o = readJson(ROSTER_KEY, null);
    if (!o || !o.at || !o.rows) return null;
    if (Date.now() - o.at > MAX_AGE) { try { localStorage.removeItem(ROSTER_KEY); } catch (e) {} return null; }
    return o;
  }
  function loadQueue() { var q = readJson(QUEUE_KEY, []); return Array.isArray(q) ? q : []; }
  function saveQueue(q) { return writeJson(QUEUE_KEY, q); }

  function clearLocal() {
    try { localStorage.removeItem(ROSTER_KEY); localStorage.removeItem(QUEUE_KEY); } catch (e) {}
    netBar();
  }

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
      idle(); loadStats(); netBar(); focusScan();
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

  function okCard(r, offlineMark) {
    beep("ok");
    paint("ok", "✓ 입장 확인", r.name,
      esc(r.titleKo || r.showTitle || "") + " · " + esc(r.time || "") +
      (offlineMark ? '<br><b style="color:#8a5300">오프라인으로 확인했습니다 — 연결되면 서버에 올립니다</b>' : ""),
      tierTag(r), "BFW-" + r.code);
    if (!offlineMark) loadStats();
    netBar();
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
  function notFound(code) {
    beep("bad");
    paint("bad", "✕ 확인되지 않는 입장권", "",
      "취소되었거나 없는 예약번호입니다.<br>이름이나 연락처로 다시 찾아보세요.",
      "", code ? "입력값 " + code : "");
  }
  function netError() {
    beep("bad");
    paint("bad", "✕ 연결 문제", "",
      "서버에 닿지 못했고 받아둔 명단도 없습니다. <b>입장권 문제가 아닙니다.</b><br>" +
      "인터넷을 확인한 뒤 다시 찍어 주세요.", "", "");
  }

  /* ---------- 오프라인 처리 ---------- */
  function normCode(c) {
    return String(c || "").trim().toUpperCase().replace(/\s+/g, "").replace(/^BFW-?/, "");
  }
  function fromRoster(code) {
    var o = loadRoster();
    if (!o) return null;
    var want = normCode(code);
    for (var i = 0; i < o.rows.length; i++) if (normCode(o.rows[i].code) === want) return o.rows[i];
    return null;
  }
  function queuedCodes() {
    var m = {};
    loadQueue().forEach(function (x) { m[normCode(x.code)] = true; });
    return m;
  }

  function offlineResv(code) {
    var o = loadRoster();
    if (!o) return netError();
    var r = fromRoster(code);
    if (!r) {
      beep("bad");
      return paint("bad", "✕ 명단에 없습니다", "",
        "받아둔 명단에서 찾지 못했습니다. 명단을 받은 뒤 들어온 예약일 수 있습니다.<br>" +
        "연결이 돌아오면 다시 찍어 주세요.", "", "BFW-" + normCode(code));
    }
    if (r.showId !== curShow) return wrongShow(r);
    if (r.checkedIn || queuedCodes()[normCode(r.code)]) return already(r);
    var q = loadQueue();
    q.push({ code: normCode(r.code), showId: curShow, at: Date.now() });
    if (!saveQueue(q)) {
      /* 저장이 막히면 이 입장은 어디에도 남지 않는다. 통과시키면 안 된다. */
      beep("bad");
      return paint("bad", "✕ 기록하지 못했습니다", r.name,
        "이 노트북에 기록을 저장할 수 없습니다. <b>입장을 종이에 적어 두세요.</b><br>" +
        "브라우저 저장 공간이 가득 찼거나 시크릿 창일 수 있습니다.",
        tierTag(r), "BFW-" + r.code);
    }
    okCard(r, true);
  }

  /* 쌓인 기록을 서버에 올린다. 이미 처리된 건(already)·다른 쇼(wrongshow)도
     더 보낼 필요가 없으므로 목록에서 뺀다. */
  /* 쌓인 기록을 올린다. 오프라인이라고 지레 멈추지 않는다 — 한 번 보내 보고
     그 결과로 연결 상태를 다시 판단한다. (끊김은 신호 없이 복구되기도 한다) */
  function syncQueue() {
    var q = loadQueue();
    if (!q.length) { netBar(); return Promise.resolve(); }
    var one = q[0];
    return Api.checkIn(one.code, one.showId).then(function (out) {
      if (out.reason === "network") { online = false; netBar(); return null; }
      if (!online) { online = true; netBar(); loadStats(); }
      if (out.ok || out.reason === "already" || out.reason === "wrongshow" || out.reason === "notfound") {
        saveQueue(loadQueue().filter(function (x) { return normCode(x.code) !== normCode(one.code); }));
        netBar();
        return syncQueue();
      }
      /* forbidden 등은 더 보내도 소용없다 — 목록은 그대로 두고 멈춘다 */
      return null;
    }).catch(function () { online = false; netBar(); return null; });
  }

  /* 연결이 돌아왔는지 스스로 확인한다. 브라우저가 'online' 신호를 주지 않는
     경우(끊긴 줄 몰랐거나, 공유기만 살아난 경우)가 있어 이 확인이 없으면
     한 번 끊긴 뒤 행사 내내 오프라인으로 굳는다. */
  function probe() {
    return fetch("gate-sw.js?p=" + Date.now(), { method: "HEAD", cache: "no-store" })
      .then(function (r) {
        if (!r || !r.ok) throw new Error("bad");
        if (!online) { online = true; netBar(); loadStats(); syncQueue(); }
      })
      .catch(function () { if (online) { online = false; netBar(); } });
  }

  /* ---------- 명단 받기 ---------- */
  function fetchRoster() {
    var b = $("btnRoster");
    if (b) { b.disabled = true; b.textContent = "받는 중…"; }
    return Api.listReservations().then(function (rows) {
      var slim = (rows || []).map(function (r) {
        return { code: r.code, showId: r.showId, name: r.name, phone: r.phone,
                 source: r.source, titleKo: r.titleKo, showTitle: r.showTitle,
                 time: r.time, checkedIn: !!r.checkedIn };
      });
      if (slim.length) { writeJson(ROSTER_KEY, { at: Date.now(), rows: slim }); online = true; }
      netBar();
      return slim.length;
    }).catch(function () { online = false; netBar(); return 0; })
      .then(function (n) {
        if (b) { b.disabled = false; b.textContent = "명단 받기"; }
        return n;
      });
  }

  /* ---------- 연결 상태 띠 ---------- */
  function netBar() {
    var el = $("net");
    if (!el) return;
    var o = loadRoster(), q = loadQueue().length;
    var parts = [];
    parts.push(online ? "온라인" : "오프라인");
    if (o) {
      var mins = Math.round((Date.now() - o.at) / 60000);
      parts.push("명단 " + o.rows.length + "건 (" + (mins < 1 ? "방금" : mins + "분 전") + ")");
    } else parts.push("명단 없음");
    if (q) parts.push("전송 대기 " + q + "건");
    el.textContent = parts.join(" · ");
    el.className = "net" + (online ? (q ? " warn" : "") : " off");
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
    if (!online) { clearScan(); return offlineResv(code); }
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
      if (out.reason === "network") { online = false; netBar(); return offlineResv(code); }
      notFound("BFW-" + code);
    }).catch(function () {
      busy = false; online = false; netBar(); offlineResv(code);
    });
    clearScan();
  }

  function doPress(code) {
    if (!online) {
      beep("warn");
      clearScan();
      return paint("warn", "프레스는 연결이 필요합니다", "",
        "프레스 입장은 오프라인으로 확인할 수 없습니다.<br>연결을 복구한 뒤 처리해 주세요.", "", code);
    }
    busy = true;
    paint("idle", "확인 중…", "", "", "", code);
    Api.pressCheckIn(code).then(function (out) {
      busy = false;
      if (out.ok) {
        beep("ok");
        return paint("ok", "✓ 프레스 입장", out.entry.reporter,
          esc(out.entry.media || ""), '<span class="tag">프레스</span>', code);
      }
      if (out.reason === "already" && out.entry) {
        beep("warn");
        return paint("warn", "⚠ 이미 입장한 프레스입니다", out.entry.reporter,
          esc(out.entry.media || ""), '<span class="tag">프레스</span>', code);
      }
      if (out.reason === "network") { online = false; netBar(); return netError(); }
      beep("bad");
      paint("bad", "✕ 승인된 프레스가 아닙니다", "", "", "", code);
    }).catch(function () { busy = false; online = false; netBar(); netError(); });
    clearScan();
  }

  /* 이름·연락처로 찾기 — 휴대폰이 꺼졌거나 QR이 안 읽힐 때 */
  function pickFrom(list, q) {
    beep("warn");
    paint("warn", "여러 명이 찾아졌습니다", "", "입장하실 분을 눌러 주세요.", "", "검색 " + q);
    $("picker").innerHTML = list.slice(0, 6).map(function (r) {
      return '<button type="button" data-code="' + esc(r.code) + '">' + esc(r.name) +
             "<small>" + esc(r.phone || "") + " · BFW-" + esc(r.code) +
             (r.checkedIn ? " · 이미 입장" : "") + "</small></button>";
    }).join("");
    $("picker").querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () { doResv(b.getAttribute("data-code")); });
    });
  }
  function searchResult(rows, q) {
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
    pickFrom(mine, q);
  }
  function offlineSearch(q) {
    var o = loadRoster();
    if (!o) return netError();
    var k = q.toLowerCase(), digits = q.replace(/[^0-9]/g, "");
    var hit = o.rows.filter(function (r) {
      if (k && String(r.name || "").toLowerCase().indexOf(k) >= 0) return true;
      if (digits.length >= 4 && String(r.phone || "").replace(/[^0-9]/g, "").indexOf(digits) >= 0) return true;
      return false;
    });
    searchResult(hit, q);
  }
  function doSearch(q) {
    if (!online) { clearScan(); return offlineSearch(q); }
    busy = true;
    paint("idle", "찾는 중…", "", "", "", q);
    Api.staffSearch(q).then(function (rows) {
      busy = false; clearScan();
      searchResult(rows, q);
    }).catch(function () { busy = false; online = false; netBar(); clearScan(); offlineSearch(q); });
  }

  /* ---------- 현황 ---------- */
  function loadStats() {
    if (!online) return;
    Api.attendanceStats().then(function (rows) {
      var r = (rows || []).filter(function (x) { return x.show_id === curShow; })[0];
      $("cEnt").textContent = r ? r.entered : 0;
      $("cRes").textContent = "/ " + (r ? r.reserved : 0) + " 예약";
      online = true; netBar();
    }).catch(function () { online = false; netBar(); });
  }

  /* ---------- 입력칸 ---------- */
  function clearScan() { $("scan").value = ""; }
  function focusScan() { try { $("scan").focus(); } catch (e) {} }

  function start() {
    $("login").style.display = "none";
    initShows();
    idle();
    netBar();
    loadStats();
    if (!loadRoster()) fetchRoster();
    syncQueue();

    setInterval(loadStats, 60000);
    setInterval(function () { if (loadQueue().length) syncQueue(); }, 20000);
    setInterval(netBar, 30000);
    setInterval(probe, 15000);
    /* 명단을 주기적으로 새로 받는다. 그래야 24시간 만료에 걸리지 않고,
       받아둔 뒤 들어온 예약도 오프라인에서 확인된다. */
    setInterval(function () { if (online) fetchRoster(); }, 30 * 60 * 1000);

    window.addEventListener("online", function () { online = true; netBar(); syncQueue(); loadStats(); });
    window.addEventListener("offline", function () { online = false; netBar(); });

    focusScan();
    setInterval(function () {
      if (document.activeElement !== $("scan") && !$("picker").contains(document.activeElement)) focusScan();
    }, 1200);
    document.addEventListener("click", function (e) {
      var t = e.target.tagName;
      if (t !== "BUTTON" && t !== "SELECT") focusScan();
    });

    var br = $("btnRoster");
    if (br) br.addEventListener("click", function () {
      fetchRoster().then(function (n) {
        if (n) { beep("ok"); paint("ok", "명단을 받았습니다", "", n + "건", "", ""); }
        else { beep("bad"); paint("bad", "명단을 받지 못했습니다", "", "연결을 확인해 주세요.", "", ""); }
      });
    });
    var bc = $("btnClear");
    if (bc) bc.addEventListener("click", function () {
      var q = loadQueue().length;
      if (q && !confirm("아직 서버에 올리지 못한 기록이 " + q + "건 있습니다. 그래도 지울까요?")) return;
      if (!q && !confirm("이 노트북에 저장된 관람객 명단을 지울까요?")) return;
      clearLocal();
      paint("idle", "저장된 자료를 지웠습니다", "", "", "", "");
    });
  }

  /* ---------- 시작 ---------- */
  tick(); setInterval(tick, 1000);

  $("scan").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); handle(this.value); }
  });

  $("btnOut").addEventListener("click", function () {
    if (loadQueue().length &&
        !confirm("서버에 올리지 못한 기록이 남아 있습니다. 그래도 로그아웃할까요?")) return;
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

  /* 새로고침해도 화면이 뜨도록 이 화면의 파일만 따로 담아 둔다 */
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("gate-sw.js").catch(function () {});
  }

  if (Api.hasStaff()) start();
  else setTimeout(function () { try { $("lgEmail").focus(); } catch (e) {} }, 100);
})();
