/* ===========================================================
   BUSAN FASHION WEEK — Admin console logic
   =========================================================== */
(function () {
  "use strict";
  var BFW = window.BFW;
  var cfg = BFW.load();
  var dirty = false;

  var $ = function (id) { return document.getElementById(id); };
  var saveState = $("saveState");

  function markDirty() {
    dirty = true;
    saveState.textContent = "저장되지 않음";
    saveState.className = "savestate dirty";
  }
  function markSaved() {
    dirty = false;
    saveState.textContent = "저장됨";
    saveState.className = "savestate saved";
  }
  function toast(msg, isErr) {
    var t = $("toast");
    t.textContent = msg;
    t.className = "toast show" + (isErr ? " err" : "");
    clearTimeout(t._t);
    t._t = setTimeout(function () { t.className = "toast"; }, 2400);
  }

  /* ---------- image helpers (downscale to protect localStorage) ---------- */
  function fileToDataURL(file, maxW, mime, quality) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          var scale = Math.min(1, maxW / img.width);
          var w = Math.round(img.width * scale);
          var h = Math.round(img.height * scale);
          var c = document.createElement("canvas");
          c.width = w; c.height = h;
          c.getContext("2d").drawImage(img, 0, 0, w, h);
          try {
            resolve(c.toDataURL(mime || "image/jpeg", quality || 0.82));
          } catch (e) { resolve(reader.result); }
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function pickImage(opts, cb) {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = function () {
      var f = input.files[0];
      if (!f) return;
      fileToDataURL(f, opts.maxW, opts.mime, opts.quality).then(cb).catch(function () {
        toast("이미지를 불러오지 못했습니다.", true);
      });
    };
    input.click();
  }

  /* ---------- TAB switching ---------- */
  var crumbMap = {
    brand: "브랜드", brandlist: "참여 브랜드", unilist: "참여 대학", lastyear: "2025 라인업", event: "행사 정보", sections: "섹션 On/Off", media: "On Film 영상",
    press: "언론 보도", archive: "아카이브", instagram: "인스타그램", map: "오시는 길 · 지도",
    shows: "쇼 관리", seats: "좌석 · 초청석", reservations: "예약 현황", pressvisit: "프레스 방문", checkin: "현장 체크인"
  };
  document.querySelectorAll("#navlist button").forEach(function (b) {
    b.addEventListener("click", function () {
      var tab = b.getAttribute("data-tab");
      document.querySelectorAll("#navlist button").forEach(function (x) { x.classList.remove("active"); });
      b.classList.add("active");
      document.querySelectorAll(".panel").forEach(function (p) {
        p.classList.toggle("active", p.getAttribute("data-panel") === tab);
      });
      $("crumb").textContent = crumbMap[tab] || "";
      $("side").classList.remove("open");
      if (tab === "seats") withStaff(initSeats);
      if (tab === "reservations") withStaff(renderResv);
      if (tab === "pressvisit") withStaff(renderPressApps);
      if (tab === "checkin") withStaff(initCheckin);
      if (tab !== "checkin") stopScan();
    });
  });
  $("menuBtn").addEventListener("click", function () { $("side").classList.toggle("open"); });

  /* ---------- bind a text/number/checkbox input to a cfg path ---------- */
  function bind(id, getVal, setVal, evt) {
    var node = $(id);
    if (!node) return;
    if (node.type === "checkbox") node.checked = getVal();
    else node.value = getVal();
    node.addEventListener(evt || "input", function () {
      setVal(node.type === "checkbox" ? node.checked : node.value);
      markDirty();
    });
  }

  /* ---------- BRAND ---------- */
  function renderLogo() {
    var t = $("logoThumb");
    if (cfg.brand.logo) {
      t.style.backgroundImage = "url('" + cfg.brand.logo + "')";
      t.textContent = "";
    } else {
      t.style.backgroundImage = "";
      t.textContent = "로고 없음";
    }
  }
  $("logoPick").addEventListener("click", function () {
    pickImage({ maxW: 600, mime: "image/png" }, function (d) {
      cfg.brand.logo = d; renderLogo(); markDirty();
    });
  });
  $("logoClear").addEventListener("click", function () {
    cfg.brand.logo = null; renderLogo(); markDirty();
  });
  bind("brandPrimary", function () { return cfg.brand.textPrimary; }, function (v) { cfg.brand.textPrimary = v; });
  bind("brandSecondary", function () { return cfg.brand.textSecondary; }, function (v) { cfg.brand.textSecondary = v; });
  bind("brandNameKo", function () { return cfg.brand.nameKo; }, function (v) { cfg.brand.nameKo = v; });

  /* ---------- EVENT ---------- */
  bind("evYear", function () { return cfg.event.year; }, function (v) { cfg.event.year = v; });
  bind("evVenue", function () { return cfg.event.venue; }, function (v) { cfg.event.venue = v; });
  bind("evDateLine", function () { return cfg.event.dateLine; }, function (v) { cfg.event.dateLine = v; });
  bind("evDateFull", function () { return cfg.event.dateFull; }, function (v) { cfg.event.dateFull = v; });
  bind("cdOn", function () { return cfg.countdown.enabled; }, function (v) { cfg.countdown.enabled = v; }, "change");
  bind("cdTarget", function () { return cfg.countdown.target; }, function (v) { cfg.countdown.target = v; }, "change");
  bind("cdLabel", function () { return cfg.countdown.label; }, function (v) { cfg.countdown.label = v; });

  /* ---------- SECTIONS ---------- */
  function renderSections() {
    var wrap = $("sectionRows");
    wrap.innerHTML = "";
    Object.keys(cfg.sections).forEach(function (id) {
      var s = cfg.sections[id];
      var row = document.createElement("div");
      row.className = "sec-row" + (s.enabled ? "" : "");
      row.innerHTML =
        '<label class="switch"><input type="checkbox" ' + (s.enabled ? "checked" : "") + '><span class="track"></span></label>' +
        '<div class="meta"><div class="nm">' + (s.label || id) + '</div><div class="id">#' + id + '</div></div>' +
        '<div class="offwrap"><select>' +
          '<option value="coming"' + (s.offMode === "coming" ? " selected" : "") + '>OFF → 준비중 표시</option>' +
          '<option value="hidden"' + (s.offMode === "hidden" ? " selected" : "") + '>OFF → 완전히 숨김</option>' +
        '</select></div>';
      var toggle = row.querySelector('input[type=checkbox]');
      var select = row.querySelector("select");
      function syncDim() { row.classList.toggle("off-disabled", toggle.checked); }
      syncDim();
      toggle.addEventListener("change", function () { s.enabled = toggle.checked; syncDim(); markDirty(); });
      select.addEventListener("change", function () { s.offMode = select.value; markDirty(); });
      wrap.appendChild(row);
    });
  }

  /* ---------- MEDIA ---------- */
  bind("mediaMode", function () { return cfg.media.mode; }, function (v) { cfg.media.mode = v; }, "change");
  bind("mediaUrl", function () { return cfg.media.url; }, function (v) { cfg.media.url = v; });
  bind("mediaTitle", function () { return cfg.media.title; }, function (v) { cfg.media.title = v; });
  bind("mediaLive", function () { return cfg.media.live; }, function (v) { cfg.media.live = v; }, "change");
  function renderPoster() {
    var t = $("posterThumb");
    if (cfg.media.poster) { t.style.backgroundImage = "url('" + cfg.media.poster + "')"; t.textContent = ""; }
    else { t.style.backgroundImage = ""; t.textContent = "없음"; }
  }
  $("posterPick").addEventListener("click", function () {
    pickImage({ maxW: 1280 }, function (d) { cfg.media.poster = d; renderPoster(); markDirty(); });
  });
  $("posterClear").addEventListener("click", function () { cfg.media.poster = null; renderPoster(); markDirty(); });

  /* ---------- BRAND LIST (logos) ---------- */
  function renderBrandList() {
    var wrap = $("brandItems");
    wrap.innerHTML = "";
    (cfg.brands || []).forEach(function (b, i) {
      var item = document.createElement("div");
      item.className = "item";
      item.innerHTML =
        '<div class="thumb logo" data-thumb style="' + (b.logo ? "background-image:url('" + b.logo + "')" : "") + '">' + (b.logo ? "" : "로고") + "</div>" +
        '<div class="grow">' +
          '<div class="row"><div class="field" style="margin:0"><label>번호</label><input type="text" data-k="no" value="' + attr(b.no) + '" style="max-width:90px"></div>' +
          '<div class="field" style="margin:0;flex:1"><label>영문명 (로고 미등록 시 표시)</label><input type="text" data-k="name" value="' + attr(b.name) + '"></div></div>' +
          '<div class="row"><div class="field" style="margin:0;flex:1"><label>한글명</label><input type="text" data-k="nameKo" value="' + attr(b.nameKo) + '"></div>' +
          '<div class="field" style="margin:0"><label>구분</label><select data-k="cat"><option value="kr"' + (b.cat !== "intl" ? " selected" : "") + '>국내</option><option value="intl"' + (b.cat === "intl" ? " selected" : "") + '>해외</option></select></div></div>' +
          '<div class="field" style="margin:0"><label>국가 표기 (해외, 선택)</label><input type="text" data-k="country" value="' + attr(b.country) + '" placeholder="🇫🇷 FRANCE"></div>' +
          '<div class="field" style="margin:0"><label>링크 (선택)</label><input type="url" data-k="link" value="' + attr(b.link) + '" placeholder="비우면 링크 없음"></div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost sm" data-act="img">로고 업로드</button>' +
          '<button class="btn danger sm" data-act="imgclear">로고 삭제</button></div>' +
        "</div>" +
        '<div class="ord"><button data-act="up">↑</button><button data-act="down">↓</button><button data-act="del">✕</button></div>';
      item.querySelectorAll("[data-k]").forEach(function (inp) {
        var ev = inp.tagName === "SELECT" ? "change" : "input";
        inp.addEventListener(ev, function () { b[inp.getAttribute("data-k")] = inp.value; markDirty(); });
      });
      item.querySelector('[data-act=img]').addEventListener("click", function () {
        pickImage({ maxW: 600, mime: "image/png" }, function (d) { b.logo = d; renderBrandList(); markDirty(); });
      });
      item.querySelector('[data-act=imgclear]').addEventListener("click", function () { b.logo = null; renderBrandList(); markDirty(); });
      item.querySelector('[data-act=up]').addEventListener("click", function () { if (i > 0) { swap(cfg.brands, i, i - 1); renderBrandList(); markDirty(); } });
      item.querySelector('[data-act=down]').addEventListener("click", function () { if (i < cfg.brands.length - 1) { swap(cfg.brands, i, i + 1); renderBrandList(); markDirty(); } });
      item.querySelector('[data-act=del]').addEventListener("click", function () { cfg.brands.splice(i, 1); renderBrandList(); markDirty(); });
      wrap.appendChild(item);
    });
  }
  $("brandAdd").addEventListener("click", function () {
    cfg.brands = cfg.brands || [];
    cfg.brands.push({ no: "", name: "", nameKo: "", cat: "kr", country: "", logo: null, link: "" });
    renderBrandList(); markDirty();
  });

  /* ---------- UNIVERSITY LIST (logos) ---------- */
  function renderUniList() {
    var wrap = $("uniItems");
    wrap.innerHTML = "";
    (cfg.universities || []).forEach(function (u, i) {
      var item = document.createElement("div");
      item.className = "item";
      item.innerHTML =
        '<div class="thumb logo" data-thumb style="' + (u.logo ? "background-image:url('" + u.logo + "')" : "") + '">' + (u.logo ? "" : "로고") + "</div>" +
        '<div class="grow">' +
          '<div class="field" style="margin:0"><label>학교명</label><input type="text" data-k="name" value="' + attr(u.name) + '"></div>' +
          '<div class="field" style="margin:0"><label>링크 (선택)</label><input type="url" data-k="link" value="' + attr(u.link) + '" placeholder="비우면 링크 없음"></div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost sm" data-act="img">로고 업로드</button>' +
          '<button class="btn danger sm" data-act="imgclear">로고 삭제</button></div>' +
        "</div>" +
        '<div class="ord"><button data-act="up">↑</button><button data-act="down">↓</button><button data-act="del">✕</button></div>';
      item.querySelectorAll("[data-k]").forEach(function (inp) {
        inp.addEventListener("input", function () { u[inp.getAttribute("data-k")] = inp.value; markDirty(); });
      });
      item.querySelector('[data-act=img]').addEventListener("click", function () {
        pickImage({ maxW: 600, mime: "image/png" }, function (d) { u.logo = d; renderUniList(); markDirty(); });
      });
      item.querySelector('[data-act=imgclear]').addEventListener("click", function () { u.logo = null; renderUniList(); markDirty(); });
      item.querySelector('[data-act=up]').addEventListener("click", function () { if (i > 0) { swap(cfg.universities, i, i - 1); renderUniList(); markDirty(); } });
      item.querySelector('[data-act=down]').addEventListener("click", function () { if (i < cfg.universities.length - 1) { swap(cfg.universities, i, i + 1); renderUniList(); markDirty(); } });
      item.querySelector('[data-act=del]').addEventListener("click", function () { cfg.universities.splice(i, 1); renderUniList(); markDirty(); });
      wrap.appendChild(item);
    });
  }
  $("uniAdd").addEventListener("click", function () {
    cfg.universities = cfg.universities || [];
    cfg.universities.push({ name: "", logo: null, link: "" });
    renderUniList(); markDirty();
  });

  /* ---------- 2025 LINEUP (BRAND / UNIVERSITY logo lists) ---------- */
  function renderLogoList(wrapId, list, rerender) {
    var wrap = $(wrapId);
    wrap.innerHTML = "";
    list.forEach(function (b, i) {
      var item = document.createElement("div");
      item.className = "item";
      item.innerHTML =
        '<div class="thumb logo" data-thumb style="' + (b.logo ? "background-image:url('" + b.logo + "')" : "") + '">' + (b.logo ? "" : "로고") + "</div>" +
        '<div class="grow">' +
          '<div class="field" style="margin:0"><label>브랜드/브랜드랩명</label><input type="text" data-k="name" value="' + attr(b.name) + '"></div>' +
          '<div class="field" style="margin:0"><label>국가 (예: INDONESIA)</label><input type="text" data-k="country" value="' + attr(b.country) + '" placeholder="비우면 미표시"></div>' +
          '<div class="field" style="margin:0"><label>링크 (선택)</label><input type="url" data-k="link" value="' + attr(b.link) + '" placeholder="비우면 링크 없음"></div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost sm" data-act="img">로고 업로드</button>' +
          '<button class="btn danger sm" data-act="imgclear">로고 삭제</button></div>' +
        "</div>" +
        '<div class="ord"><button data-act="up">↑</button><button data-act="down">↓</button><button data-act="del">✕</button></div>';
      item.querySelectorAll("[data-k]").forEach(function (inp) {
        inp.addEventListener("input", function () { b[inp.getAttribute("data-k")] = inp.value; markDirty(); });
      });
      item.querySelector('[data-act=img]').addEventListener("click", function () {
        pickImage({ maxW: 600, mime: "image/png" }, function (d) { b.logo = d; rerender(); markDirty(); });
      });
      item.querySelector('[data-act=imgclear]').addEventListener("click", function () { b.logo = null; rerender(); markDirty(); });
      item.querySelector('[data-act=up]').addEventListener("click", function () { if (i > 0) { swap(list, i, i - 1); rerender(); markDirty(); } });
      item.querySelector('[data-act=down]').addEventListener("click", function () { if (i < list.length - 1) { swap(list, i, i + 1); rerender(); markDirty(); } });
      item.querySelector('[data-act=del]').addEventListener("click", function () { list.splice(i, 1); rerender(); markDirty(); });
      wrap.appendChild(item);
    });
  }
  function renderLastYear() {
    cfg.lastYear = cfg.lastYear || { year: "2025", brands: [], universities: [] };
    cfg.lastYear.brands = cfg.lastYear.brands || [];
    cfg.lastYear.universities = cfg.lastYear.universities || [];
    renderLogoList("lyBrandItems", cfg.lastYear.brands, renderLastYear);
    renderLogoList("lyUniItems", cfg.lastYear.universities, renderLastYear);
  }
  $("lyBrandAdd").addEventListener("click", function () {
    cfg.lastYear.brands.push({ name: "", country: "", logo: null, link: "" }); renderLastYear(); markDirty();
  });
  $("lyUniAdd").addEventListener("click", function () {
    cfg.lastYear.universities.push({ name: "", country: "", logo: null, link: "" }); renderLastYear(); markDirty();
  });

  /* ---------- PRESS ---------- */
  bind("pressAuto", function () { return cfg.press.auto; }, function (v) { cfg.press.auto = v; }, "change");
  bind("pressQuery", function () { return cfg.press.query; }, function (v) { cfg.press.query = v; });
  bind("pressCount", function () { return cfg.press.count; }, function (v) { cfg.press.count = parseInt(v, 10) || 6; });
  bind("pressProxy", function () { return cfg.press.proxyUrl; }, function (v) { cfg.press.proxyUrl = v; });
  function renderPress() {
    var wrap = $("pressItems");
    wrap.innerHTML = "";
    (cfg.press.items || []).forEach(function (a, i) {
      var item = document.createElement("div");
      item.className = "item";
      item.innerHTML =
        '<div class="thumb" data-thumb style="' + (a.image ? "background-image:url('" + a.image + "')" : "") + '">' + (a.image ? "" : "이미지") + "</div>" +
        '<div class="grow">' +
          '<div class="row"><div class="field" style="margin:0;flex:1"><label>언론사</label><input type="text" data-k="source" value="' + attr(a.source) + '" placeholder="부산일보"></div>' +
          '<div class="field" style="margin:0"><label>날짜</label><input type="text" data-k="date" value="' + attr(a.date) + '" placeholder="2026.10.29"></div></div>' +
          '<div class="field" style="margin:0"><label>제목</label><input type="text" data-k="title" value="' + attr(a.title) + '"></div>' +
          '<div class="field" style="margin:0"><label>기사 링크</label><input type="url" data-k="link" value="' + attr(a.link) + '" placeholder="https://"></div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost sm" data-act="img">썰네일 업로드</button>' +
          '<button class="btn danger sm" data-act="imgclear">썰네일 삭제</button></div>' +
        "</div>" +
        '<div class="ord"><button data-act="up">↑</button><button data-act="down">↓</button><button data-act="del">✕</button></div>';
      item.querySelectorAll("[data-k]").forEach(function (inp) {
        inp.addEventListener("input", function () { a[inp.getAttribute("data-k")] = inp.value; markDirty(); });
      });
      item.querySelector('[data-act=img]').addEventListener("click", function () {
        pickImage({ maxW: 800 }, function (d) { a.image = d; renderPress(); markDirty(); });
      });
      item.querySelector('[data-act=imgclear]').addEventListener("click", function () { a.image = null; renderPress(); markDirty(); });
      item.querySelector('[data-act=up]').addEventListener("click", function () { if (i > 0) { swap(cfg.press.items, i, i - 1); renderPress(); markDirty(); } });
      item.querySelector('[data-act=down]').addEventListener("click", function () { if (i < cfg.press.items.length - 1) { swap(cfg.press.items, i, i + 1); renderPress(); markDirty(); } });
      item.querySelector('[data-act=del]').addEventListener("click", function () { cfg.press.items.splice(i, 1); renderPress(); markDirty(); });
      wrap.appendChild(item);
    });
  }
  $("pressAdd").addEventListener("click", function () {
    cfg.press.items = cfg.press.items || [];
    cfg.press.items.push({ title: "", source: "", date: "", link: "", image: null });
    renderPress(); markDirty();
  });

  /* ---------- ARCHIVE ---------- */
  function renderArchive() {
    var wrap = $("archiveItems");
    wrap.innerHTML = "";
    cfg.archive.forEach(function (a, i) {
      var item = document.createElement("div");
      item.className = "item";
      item.innerHTML =
        '<div class="thumb" data-thumb style="' + (a.image ? "background-image:url('" + a.image + "')" : "") + '">' + (a.image ? "" : "이미지") + "</div>" +
        '<div class="grow">' +
          '<div class="row"><div class="field" style="margin:0"><label>연도</label><input type="text" data-k="year" value="' + attr(a.year) + '"></div>' +
          '<div class="field" style="margin:0"><label>제목</label><input type="text" data-k="title" value="' + attr(a.title) + '"></div></div>' +
          '<div class="field" style="margin:0"><label>링크 (선택)</label><input type="url" data-k="link" value="' + attr(a.link) + '" placeholder="비우면 갤러리 페이지로 연결"></div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost sm" data-act="img">배경 이미지</button>' +
          '<button class="btn danger sm" data-act="imgclear">이미지 삭제</button></div>' +
        "</div>" +
        '<div class="ord"><button data-act="up">↑</button><button data-act="down">↓</button><button data-act="del">✕</button></div>';

      item.querySelectorAll("input[data-k]").forEach(function (inp) {
        inp.addEventListener("input", function () { a[inp.getAttribute("data-k")] = inp.value; markDirty(); });
      });
      item.querySelector('[data-act=img]').addEventListener("click", function () {
        pickImage({ maxW: 1400 }, function (d) { a.image = d; renderArchive(); markDirty(); });
      });
      item.querySelector('[data-act=imgclear]').addEventListener("click", function () { a.image = null; renderArchive(); markDirty(); });
      item.querySelector('[data-act=up]').addEventListener("click", function () { if (i > 0) { swap(cfg.archive, i, i - 1); renderArchive(); markDirty(); } });
      item.querySelector('[data-act=down]').addEventListener("click", function () { if (i < cfg.archive.length - 1) { swap(cfg.archive, i, i + 1); renderArchive(); markDirty(); } });
      item.querySelector('[data-act=del]').addEventListener("click", function () { cfg.archive.splice(i, 1); renderArchive(); markDirty(); });
      wrap.appendChild(item);
    });
  }
  $("archiveAdd").addEventListener("click", function () {
    cfg.archive.push({ year: "", title: "", image: null, link: "" });
    renderArchive(); markDirty();
  });

  /* ---------- INSTAGRAM ---------- */
  bind("igHandle", function () { return cfg.instagram.handle; }, function (v) { cfg.instagram.handle = v; });
  bind("igProfile", function () { return cfg.instagram.profileUrl; }, function (v) { cfg.instagram.profileUrl = v; });
  bind("igToken", function () { return cfg.instagram.token; }, function (v) { cfg.instagram.token = v; });
  bind("igCount", function () { return cfg.instagram.count; }, function (v) { cfg.instagram.count = parseInt(v, 10) || 6; });
  function renderIg() {
    var wrap = $("igItems");
    wrap.innerHTML = "";
    cfg.instagram.posts.forEach(function (p, i) {
      var item = document.createElement("div");
      item.className = "item";
      item.innerHTML =
        '<div class="thumb" style="' + (p.image ? "background-image:url('" + p.image + "')" : "") + '">' + (p.image ? "" : "이미지") + "</div>" +
        '<div class="grow"><div class="field" style="margin:0"><label>게시물 링크</label><input type="url" data-k="link" value="' + attr(p.link) + '" placeholder="https://www.instagram.com/p/..."></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost sm" data-act="img">이미지 업로드</button></div></div>' +
        '<div class="ord"><button data-act="up">↑</button><button data-act="down">↓</button><button data-act="del">✕</button></div>';
      item.querySelector("input[data-k]").addEventListener("input", function (e) { p.link = e.target.value; markDirty(); });
      item.querySelector('[data-act=img]').addEventListener("click", function () { pickImage({ maxW: 1080 }, function (d) { p.image = d; renderIg(); markDirty(); }); });
      item.querySelector('[data-act=up]').addEventListener("click", function () { if (i > 0) { swap(cfg.instagram.posts, i, i - 1); renderIg(); markDirty(); } });
      item.querySelector('[data-act=down]').addEventListener("click", function () { if (i < cfg.instagram.posts.length - 1) { swap(cfg.instagram.posts, i, i + 1); renderIg(); markDirty(); } });
      item.querySelector('[data-act=del]').addEventListener("click", function () { cfg.instagram.posts.splice(i, 1); renderIg(); markDirty(); });
      wrap.appendChild(item);
    });
  }
  $("igAdd").addEventListener("click", function () { cfg.instagram.posts.push({ image: null, link: "" }); renderIg(); markDirty(); });

  /* ---------- MAP ---------- */
  bind("mapClient", function () { return cfg.map.naverClientId; }, function (v) { cfg.map.naverClientId = v.trim(); });
  bind("mapLat", function () { return cfg.map.lat; }, function (v) { cfg.map.lat = parseFloat(v); });
  bind("mapLng", function () { return cfg.map.lng; }, function (v) { cfg.map.lng = parseFloat(v); });
  bind("mapZoom", function () { return cfg.map.zoom; }, function (v) { cfg.map.zoom = parseInt(v, 10) || 16; });
  bind("mapAddr", function () { return cfg.map.address; }, function (v) { cfg.map.address = v; });
  bind("mapAddrEn", function () { return cfg.map.addressEn; }, function (v) { cfg.map.addressEn = v; });

  /* ---------- RESERVE settings ---------- */
  bind("rsvPublished", function () { return cfg.reserve.published; }, function (v) { cfg.reserve.published = v; }, "change");
  bind("rsvOpen", function () { return cfg.reserve.open; }, function (v) { cfg.reserve.open = v; }, "change");
  bind("rsvCap", function () { return cfg.reserve.defaultCap; }, function (v) { cfg.reserve.defaultCap = parseInt(v, 10) || 300; });
  bind("rsvNote", function () { return cfg.reserve.note; }, function (v) { cfg.reserve.note = v; });

  /* ---------- PRESS VISIT settings ---------- */
  bind("pvOpen", function () { return cfg.pressVisit.open; }, function (v) { cfg.pressVisit.open = v; }, "change");
  bind("pvNote", function () { return cfg.pressVisit.note; }, function (v) { cfg.pressVisit.note = v; });

  /* ---------- SHOWS ---------- */
  var showCounts = {}; // { showId: reservedCount } — refreshed from the API
  function renderShows() {
    BFWApi.availability().then(function (map) {
      showCounts = {};
      for (var k in map) showCounts[k] = map[k].reserved;
      renderShowsRows();
    }).catch(renderShowsRows);
  }
  function renderShowsRows() {
    var wrap = $("showItems");
    wrap.innerHTML = "";
    $("showCount").textContent = "(" + cfg.shows.length + "개)";
    cfg.shows.forEach(function (s, i) {
      var resv = showCounts[s.id] || 0;
      var item = document.createElement("div");
      item.className = "show-item";
      item.innerHTML =
        '<div class="si-head"><span class="si-id">' + esc(s.id) + '</span>' +
        '<span class="si-resv">예약 <b>' + resv + '</b> / ' + (s.cap || cfg.reserve.defaultCap) + '석</span></div>' +
        '<div class="si-grid">' +
          fld("Day", "number", "day", s.day) +
          fld("날짜", "text", "date", s.date) +
          fld("요일", "text", "dow", s.dow) +
          fld("시작", "text", "time", s.time) +
          fld("종료", "text", "end", s.end) +
          fld("정원", "number", "cap", s.cap) +
        '</div>' +
        '<div class="si-grid2">' +
          fld("제목 (EN)", "text", "title", s.title) +
          fld("한글 제목", "text", "titleKo", s.titleKo) +
          fld("라인업 / 참여", "text", "lineup", s.lineup) +
        '</div>' +
        '<div class="si-foot">' +
          '<label class="si-tbd"><input type="checkbox" data-k="tbd"' + (s.tbd ? " checked" : "") + '> 참여 브랜드 추첨 배치 예정 (TBD)</label>' +
          '<div style="display:flex;gap:6px;margin-left:auto">' +
            '<button class="btn ghost sm" data-act="up">↑</button>' +
            '<button class="btn ghost sm" data-act="down">↓</button>' +
            '<button class="si-del" data-act="del">삭제</button>' +
          '</div>' +
        '</div>';
      item.querySelectorAll("input[data-k]").forEach(function (inp) {
        var ev = inp.type === "checkbox" ? "change" : "input";
        inp.addEventListener(ev, function () {
          var k = inp.getAttribute("data-k");
          if (inp.type === "checkbox") s[k] = inp.checked;
          else s[k] = (k === "day" || k === "cap") ? (parseInt(inp.value, 10) || 0) : inp.value;
          markDirty();
        });
      });
      item.querySelector('[data-act=up]').addEventListener("click", function () { if (i > 0) { swap(cfg.shows, i, i - 1); renderShows(); markDirty(); } });
      item.querySelector('[data-act=down]').addEventListener("click", function () { if (i < cfg.shows.length - 1) { swap(cfg.shows, i, i + 1); renderShows(); markDirty(); } });
      item.querySelector('[data-act=del]').addEventListener("click", function () {
        if (resv > 0 && !confirm("이 쇼에 " + resv + "건의 예약이 있습니다. 정말 삭제할까요? (예약 내역은 남습니다)")) return;
        cfg.shows.splice(i, 1); renderShows(); markDirty();
      });
      wrap.appendChild(item);
    });
  }
  function fld(label, type, key, val) {
    return '<div class="field"><label>' + label + '</label><input type="' + type + '" data-k="' + key + '" value="' + attr(val) + '"></div>';
  }
  function nextShowId() {
    var max = 0;
    cfg.shows.forEach(function (s) { var n = parseInt(String(s.id).replace(/\D/g, ""), 10); if (n > max) max = n; });
    return "S" + String(max + 1).padStart(2, "0");
  }
  $("showAdd").addEventListener("click", function () {
    var last = cfg.shows[cfg.shows.length - 1] || {};
    cfg.shows.push({ id: nextShowId(), day: last.day || 1, date: last.date || "", dow: last.dow || "", time: "", end: "", title: "", titleKo: "", lineup: "", venue: last.venue || "메인 런웨이", cap: cfg.reserve.defaultCap || 300, tbd: true });
    renderShows(); markDirty();
  });

  /* ---------- staff gate (backend mode only) ---------- */
  function withStaff(run) {
    if (BFWApi.hasStaff()) { run(); return; }
    var ov = document.createElement("div");
    ov.className = "staff-gate";
    ov.innerHTML =
      '<form class="staff-card">' +
        '<h3>스태프 로그인</h3>' +
        '<p>현장 체크인·예약 관리는 스태프 인증이 필요합니다.</p>' +
        '<input type="email" id="stEmail" placeholder="이메일" autocomplete="username">' +
        '<input type="password" id="stPw" placeholder="비밀번호" autocomplete="current-password">' +
        '<div class="st-err" id="stErr"></div>' +
        '<button class="btn primary" type="submit">로그인</button>' +
      '</form>';
    document.body.appendChild(ov);
    ov.querySelector("form").addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = ov.querySelector("button");
      btn.disabled = true; btn.textContent = "확인 중…";
      BFWApi.staffSignIn($("stEmail").value.trim(), $("stPw").value).then(function (r) {
        if (r.ok) { document.body.removeChild(ov); run(); }
        else { $("stErr").textContent = r.error || "로그인 실패"; btn.disabled = false; btn.textContent = "로그인"; }
      });
    });
  }
  /* ==========================================================
     좌석 · 초청석 관리
     쇼별로 자리를 잠그면 관람객 예약 화면에서 선택되지 않는다.
     ========================================================== */
  var szInited = false, szShowId = null, szZones = [], szSeats = {}, szPick = {}, szMode = "free";

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function seatIdOf(zoneCode, num) { return zoneCode + "-" + pad2(num); }
  function zoneOrder(a, b) { return a.side === b.side ? a.sort - b.sort : (a.side === "L" ? -1 : 1); }

  function initSeats() {
    if (!szInited) {
      var sel = $("szShow");
      sel.innerHTML = (cfg.shows || []).map(function (s2) {
        return '<option value="' + esc(s2.id) + '">' + esc(s2.id) + " · D" + esc(s2.day) +
               " " + esc(s2.time || "") + " · " + esc(s2.titleKo || s2.title || "") + "</option>";
      }).join("");
      sel.addEventListener("change", function () { szPick = {}; loadSeats(); });
      $("szReload").addEventListener("click", function () { szPick = {}; loadSeats(); });
      $("szPrint").addEventListener("click", printSeats);
      $("szLockSel").addEventListener("click", function () { applyLock(Object.keys(szPick), "invite"); });
      $("szUnlockSel").addEventListener("click", function () { applyLock(Object.keys(szPick), null); });
      $("szClearSel").addEventListener("click", function () { szPick = {}; renderSeatAdmin(); });
      $("sqLock").addEventListener("click", function () { quickRange("invite"); });
      $("sqUnlock").addEventListener("click", function () { quickRange(null); });
      document.querySelectorAll('input[name="szMode"]').forEach(function (r) {
        r.addEventListener("change", function () { changeMode(r.value); });
      });
      szInited = true;
    }
    loadSeats();
  }

  function loadSeats() {
    szShowId = $("szShow").value;
    $("szMap").innerHTML = '<div class="empty-state">불러오는 중…</div>';
    Promise.all([BFWApi.zoneAvailability(), BFWApi.seatAdminMap(szShowId), BFWApi.availability()])
      .then(function (res) {
      szMode = ((res[2] || {})[szShowId] || {}).mode || "free";
      renderMode();
      szZones = ((res[0] || {})[szShowId] || []).slice();
      szSeats = {};
      (res[1] || []).forEach(function (r) { szSeats[r.seat_id] = r; });
      var zsel = $("sqZone");
      if (zsel && !zsel.options.length && szZones.length) {
        zsel.innerHTML = szZones.slice().sort(zoneOrder).map(function (z) {
          return '<option value="' + esc(z.code) + '">' + esc(z.label) + "</option>";
        }).join("");
      }
      renderSeatAdmin();
    });
  }

  function renderSeatAdmin() {
    var wrap = $("szMap");
    if (!szZones.length) {
      wrap.innerHTML = '<div class="empty-state">구역 정보를 불러오지 못했습니다. 새로고침해 주세요.</div>';
      return;
    }
    function bySort(a, b) { return a.sort - b.sort; }
    var L = szZones.filter(function (z) { return z.side === "L"; }).sort(bySort);
    var R = szZones.filter(function (z) { return z.side === "R"; }).sort(bySort);
    wrap.innerHTML = "";
    var colL = document.createElement("div"); colL.className = "sam-col";
    L.forEach(function (z) { colL.appendChild(zoneBlock(z)); });
    var mid = document.createElement("div"); mid.className = "sam-runway";
    mid.innerHTML = "<span>RUNWAY</span>";
    var colR = document.createElement("div"); colR.className = "sam-col";
    R.forEach(function (z) { colR.appendChild(zoneBlock(z)); });
    wrap.appendChild(colL); wrap.appendChild(mid); wrap.appendChild(colR);
    renderSzSummary();
  }

  function zoneBlock(z) {
    var box = document.createElement("div");
    box.className = "sam-zone";
    var lock = 0, take = 0;
    for (var n = 1; n <= z.seatCount; n++) {
      var st = szSeats[seatIdOf(z.code, n)];
      if (!st) continue;
      if (st.status === "taken") take++;
      else if (st.status !== "free") lock++;
    }
    box.innerHTML = "<h4>" + esc(z.label) + "</h4>" +
      '<div class="zmeta">전체 ' + z.seatCount + "석 · 초청 " + lock + " · 예약 " + take + "</div>";
    var g = document.createElement("div");
    g.className = "sam-grid";
    var R = z.rows;
    for (var r = 1; r <= R; r++) {
      // 실제 배치도와 같은 방향 (좌측 구역은 바깥단이 왼쪽)
      var nums = (z.side === "L") ? [2 * R + r, R + r, r] : [r, R + r, 2 * R + r];
      for (var c = 0; c < 3; c++) g.appendChild(seatBtn(z, nums[c]));
    }
    box.appendChild(g);
    return box;
  }

  function seatBtn(z, num) {
    var id = seatIdOf(z.code, num);
    var st = szSeats[id] || { status: "free" };
    var b = document.createElement("button");
    b.type = "button";
    var cls = "sseat";
    if (szPick[id]) cls += " pick";
    else if (st.status === "taken") cls += " taken";
    else if (st.status !== "free") cls += " invite";
    b.className = cls;
    b.textContent = num;
    b.title = z.label + " " + num + "번" +
      (st.status === "taken" ? " · 예약 " + (st.name || "") : st.status !== "free" ? " · 초청석" : "");
    if (st.status === "taken") {
      b.disabled = true;
    } else {
      b.addEventListener("click", function () {
        if (szPick[id]) { delete szPick[id]; b.classList.remove("pick"); }
        else { szPick[id] = true; b.classList.add("pick"); }
        syncSzBar();
      });
    }
    return b;
  }

  function renderMode() {
    document.querySelectorAll('input[name="szMode"]').forEach(function (r) {
      r.checked = (r.value === szMode);
    });
    $("szModeNote").innerHTML = szMode === "assigned"
      ? "관람객이 예약할 때 <b>구역 → 좌석</b> 순으로 자리를 직접 고릅니다. 발급되는 QR과 안내 문자에 좌석번호가 함께 나갑니다."
      : "관람객은 <b>쇼만 선택</b>하고 자리는 현장에서 선착순으로 앉습니다. 아래에서 초청석을 잠그면 그만큼 온라인 정원이 줄어듭니다.";
  }

  function changeMode(mode) {
    if (mode === szMode) return;
    BFWApi.setSeatingMode(szShowId, mode).then(function (r) {
      if (r && r.ok) {
        szMode = mode;
        renderMode();
        toast(mode === "assigned" ? "지정좌석제로 바꿨습니다." : "자유석으로 바꿨습니다.");
        loadSeats();
      } else if (r && r.reason === "hasreservations") {
        toast("이미 예약 " + (r.count || "") + "건이 들어와 방식을 바꿀 수 없습니다. 예약을 정리한 뒤 변경하세요.", true);
        renderMode();
      } else if (r && r.reason === "forbidden") {
        toast("스태프 로그인이 필요합니다.", true);
        renderMode();
      } else {
        toast("변경하지 못했습니다.", true);
        renderMode();
      }
    });
  }

  function renderSzSummary() {
    var total = 0, lock = 0, take = 0;
    szZones.forEach(function (z) { total += z.seatCount; });
    Object.keys(szSeats).forEach(function (k) {
      var st = szSeats[k];
      if (st.status === "taken") take++;
      else if (st.status !== "free") lock++;
    });
    $("szSummary").innerHTML =
      "<span>전체 <b>" + total + "</b>석</span>" +
      '<span class="s-lock">초청석 <b>' + lock + "</b>석</span>" +
      '<span class="s-take">관람객 예약 <b>' + take + "</b>석</span>" +
      "<span>예약 가능 <b>" + (total - lock - take) + "</b>석</span>";
    syncSzBar();
  }

  function syncSzBar() {
    var n = Object.keys(szPick).length;
    $("szPickCount").textContent = n;
    $("szActions").classList.toggle("show", n > 0);
  }

  function applyLock(ids, kind) {
    if (!ids || !ids.length) { toast("자리를 먼저 선택해 주세요.", true); return; }
    BFWApi.seatLockSet(szShowId, ids, kind, null).then(function (r) {
      if (r && r.ok) {
        toast(kind ? ids.length + "자리를 초청석으로 잠갔습니다." : ids.length + "자리 잠금을 해제했습니다.");
        szPick = {};
        loadSeats();
      } else if (r && r.reason === "occupied") {
        toast("이미 관람객이 예약한 자리가 있어 잠글 수 없습니다.", true);
      } else if (r && r.reason === "forbidden") {
        toast("스태프 로그인이 필요합니다.", true);
      } else {
        toast("처리하지 못했습니다.", true);
      }
    });
  }

  function quickRange(kind) {
    var zc = $("sqZone").value;
    var z = szZones.filter(function (x) { return x.code === zc; })[0];
    if (!z) { toast("구역을 선택해 주세요.", true); return; }
    var a = parseInt($("sqFrom").value, 10), b = parseInt($("sqTo").value, 10);
    if (isNaN(a) || isNaN(b)) { toast("시작·끝 번호를 입력해 주세요.", true); return; }
    if (a > b) { var t = a; a = b; b = t; }
    if (a < 1 || b > z.seatCount) { toast(z.label + "은 1~" + z.seatCount + "번까지입니다.", true); return; }
    var ids = [];
    for (var n = a; n <= b; n++) ids.push(seatIdOf(zc, n));
    applyLock(ids, kind);
  }

  /* 연속된 번호를 1~12 형태로 묶는다 (라벨 작업용 인쇄) */
  function toRanges(nums) {
    if (!nums.length) return "";
    nums = nums.slice().sort(function (a, b) { return a - b; });
    var out = [], st = nums[0], prev = nums[0];
    for (var i = 1; i <= nums.length; i++) {
      var n = nums[i];
      if (n !== prev + 1) {
        out.push(st === prev ? String(st) : st + "~" + prev);
        st = n;
      }
      prev = n;
    }
    return out.join(", ");
  }

  function printSeats() {
    var sh = (cfg.shows || []).filter(function (x) { return x.id === szShowId; })[0] || {};
    var rows = [], total = 0;
    szZones.slice().sort(zoneOrder).forEach(function (z) {
      var list = [];
      for (var n = 1; n <= z.seatCount; n++) {
        var st = szSeats[seatIdOf(z.code, n)];
        if (st && st.status !== "free" && st.status !== "taken") list.push(n);
      }
      if (list.length) { rows.push({ label: z.label, nums: list }); total += list.length; }
    });
    var body = rows.length
      ? rows.map(function (r) {
          return "<tr><td class=z>" + esc(r.label) + "</td><td class=c>" + r.nums.length +
                 "석</td><td>" + esc(toRanges(r.nums)) + "</td></tr>";
        }).join("")
      : '<tr><td colspan="3" style="text-align:center;padding:30px;color:#888">잠긴 초청석이 없습니다.</td></tr>';
    var html =
      "<!doctype html><html lang=ko><head><meta charset=utf-8><title>초청석 지정 현황</title><style>" +
      "body{font-family:'Pretendard',system-ui,sans-serif;margin:40px;color:#16204a}" +
      "h1{font-size:20px;margin:0 0 4px}.sub{color:#667;font-size:13px;margin-bottom:22px}" +
      "table{width:100%;border-collapse:collapse;font-size:14px}" +
      "th,td{padding:10px 12px;border-bottom:1px solid #e2e6ef;text-align:left}" +
      "th{background:#f4f6fa;font-size:12px;letter-spacing:.05em}" +
      "td.z{font-weight:700;width:110px}td.c{width:80px;font-variant-numeric:tabular-nums}" +
      ".tot{margin-top:18px;font-weight:700}" +
      ".note{margin-top:26px;font-size:12px;color:#667;line-height:1.7}" +
      "</style></head><body>" +
      "<h1>초청석 지정 현황</h1>" +
      '<div class="sub">' + esc(sh.id || "") + " · " + esc(sh.titleKo || sh.title || "") +
      " · " + esc(sh.date || "") + " " + esc(sh.time || "") + "</div>" +
      "<table><thead><tr><th>구역</th><th>좌석 수</th><th>좌석 번호</th></tr></thead><tbody>" +
      body + "</tbody></table>" +
      '<div class="tot">합계 ' + total + "석</div>" +
      '<div class="note">※ 번호가 작을수록 런웨이·무대에 가깝습니다. 각 구역은 3단 계단식이며 ' +
      "1단(런웨이 최근접)부터 번호가 매겨집니다.<br>※ 이 표를 보고 해당 의자에 라벨을 부착하세요.</div>" +
      "</body></html>";
    var w = window.open("", "_blank");
    if (!w) { toast("팝업이 차단되었습니다. 팝업을 허용해 주세요.", true); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(function () { w.print(); }, 300);
  }

  /* ---------- RESERVATIONS dashboard ---------- */
  var resvCache = [];
  function renderResv() {
    $("resvBody").innerHTML = '<tr><td colspan="7"><div class="empty-state">불러오는 중…</div></td></tr>';
    BFWApi.listReservations().then(function (list) {
      resvCache = list || [];
      renderResvStats();
      populateFilter();
      renderResvTable();
    });
  }
  function renderResvStats() {
    var wrap = $("resvStats");
    wrap.innerHTML = "";
    cfg.shows.forEach(function (s) {
      var active = resvCache.filter(function (r) { return r.showId === s.id; });
      var cap = s.cap || cfg.reserve.defaultCap || 300;
      var inCount = active.filter(function (r) { return r.checkedIn; }).length;
      var pct = Math.min(100, Math.round((active.length / cap) * 100));
      var card = document.createElement("div");
      card.className = "stat-card";
      card.innerHTML =
        '<div class="sc-h"><span class="sc-id">' + esc(s.id) + '</span><span class="sc-time">D' + esc(s.day) + ' · ' + esc(s.time) + '</span></div>' +
        '<div class="sc-name">' + esc(s.titleKo || s.title) + '</div>' +
        '<div class="sc-bar"><div class="sc-fill' + (active.length >= cap ? " warn" : "") + '" style="width:' + pct + '%"></div></div>' +
        '<div class="sc-nums"><span class="resv">' + active.length + ' / ' + cap + '</span><span class="inct">입장 ' + inCount + '</span></div>';
      wrap.appendChild(card);
    });
  }
  function populateFilter() {
    var sel = $("resvFilter");
    var cur = sel.value;
    sel.innerHTML = '<option value="">전체 쇼</option>' + cfg.shows.map(function (s) {
      return '<option value="' + esc(s.id) + '">' + esc(s.id) + ' · ' + esc(s.title) + '</option>';
    }).join("");
    sel.value = cur;
  }
  $("resvFilter").addEventListener("change", renderResvTable);
  function renderResvTable() {
    var body = $("resvBody");
    var filter = $("resvFilter").value;
    var list = resvCache.slice();
    if (filter) list = list.filter(function (r) { return r.showId === filter; });
    body.innerHTML = "";
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="7"><div class="empty-state">예약 내역이 없습니다.</div></td></tr>';
      return;
    }
    list.forEach(function (r) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + fmtDate(r.at) + "</td>" +
        '<td style="font-family:var(--a-mono)">BFW-' + esc(r.code) + "</td>" +
        "<td>" + esc(r.showId) + " · " + esc(r.titleKo || r.showTitle || "") + "</td>" +
        "<td>" + esc(r.name) + "</td>" +
        "<td>" + esc(r.phone) + "</td>" +
        '<td><span class="pill ' + (r.checkedIn ? "entered" : "reserved") + '">' + (r.checkedIn ? "입장완료" : "예약") + "</span></td>" +
        '<td><div class="row-acts">' +
          '<button class="btn ghost sm" data-act="toggle">' + (r.checkedIn ? "입장취소" : "입장처리") + "</button>" +
          '<button class="btn danger sm" data-act="cancel">취소</button>' +
        "</div></td>";
      tr.querySelector('[data-act=toggle]').addEventListener("click", function () {
        (r.checkedIn ? BFWApi.undoCheckIn(r.id) : BFWApi.checkIn("BFW-" + r.code)).then(renderResv);
      });
      tr.querySelector('[data-act=cancel]').addEventListener("click", function () {
        if (confirm("이 예약을 취소할까요?")) BFWApi.cancel(r.id).then(renderResv);
      });
      body.appendChild(tr);
    });
  }
  $("resvRefresh").addEventListener("click", renderResv);
  $("resvClear").addEventListener("click", function () {
    if (confirm("모든 예약 내역을 삭제할까요? 되돌릴 수 없습니다.")) BFWApi.clearAll().then(renderResv);
  });
  $("resvCsv").addEventListener("click", function () {
    var list = resvCache;
    if (!list.length) { toast("내보낼 내역이 없습니다.", true); return; }
    var cols = ["at", "code", "showId", "showTitle", "day", "date", "time", "name", "phone", "email", "marketing", "checkedIn", "checkedInAt"];
    var rows = [cols.join(",")].concat(list.map(function (r) {
      return cols.map(function (c) {
        var v = c === "code" ? "BFW-" + r.code : r[c];
        return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
      }).join(",");
    }));
    var blob = new Blob(["\ufeff" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "bfw_reservations.csv"; a.click();
  });

  /* ---------- PRESS VISIT dashboard ---------- */
  var pvCache = [];
  function renderPressApps() {
    $("pvBody").innerHTML = '<tr><td colspan="7"><div class="empty-state">불러오는 중…</div></td></tr>';
    BFWApi.pressList().then(function (list) { pvCache = list || []; renderPvTable(); });
  }
  function pvPill(st) {
    if (st === "approved") return '<span class="pill entered">승인</span>';
    if (st === "rejected") return '<span class="pill" style="background:rgba(0,0,0,.08);color:#888">반려</span>';
    return '<span class="pill reserved">심사중</span>';
  }
  function renderPvTable() {
    var body = $("pvBody");
    var filter = $("pvFilter").value;
    var list = pvCache.slice();
    if (filter) list = list.filter(function (p) { return p.status === filter; });
    $("pvCount").textContent = "(" + pvCache.length + "건 · 승인 " + pvCache.filter(function (p) { return p.status === "approved"; }).length + "건)";
    body.innerHTML = "";
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="7"><div class="empty-state">신청 내역이 없습니다.</div></td></tr>';
      return;
    }
    list.forEach(function (p) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + fmtDate(p.at) + "</td>" +
        "<td>" + esc(p.media) + "</td>" +
        "<td>" + esc(p.reporter) + "</td>" +
        "<td>" + esc(p.phone) + "</td>" +
        "<td>" + esc(p.types || "") + (p.days ? "<br>" + esc(p.days) : "") + "</td>" +
        "<td>" + pvPill(p.status) + (p.code ? '<div style="font-family:var(--a-mono);font-size:.72rem;margin-top:4px">' + esc(p.code) + (p.checkedIn ? " · 입장" : "") + "</div>" : "") + "</td>" +
        '<td><div class="row-acts">' +
          (p.status !== "approved" ? '<button class="btn ghost sm" data-act="ok">승인</button>' : "") +
          (p.status !== "rejected" ? '<button class="btn ghost sm" data-act="no">반려</button>' : "") +
          '<button class="btn danger sm" data-act="del">삭제</button>' +
        "</div></td>";
      var okB = tr.querySelector('[data-act=ok]');
      if (okB) okB.addEventListener("click", function () {
        BFWApi.pressSetStatus(p.id, "approved").then(function (out) {
          toast("승인 완료 — 프레스 QR " + ((out && out.code) || "") + " 발급");
          renderPressApps();
        });
      });
      var noB = tr.querySelector('[data-act=no]');
      if (noB) noB.addEventListener("click", function () {
        if (confirm(p.media + " · " + p.reporter + " 신청을 반려할까요?")) BFWApi.pressSetStatus(p.id, "rejected").then(renderPressApps);
      });
      tr.querySelector('[data-act=del]').addEventListener("click", function () {
        if (confirm("이 신청을 삭제할까요? 되돌릴 수 없습니다.")) BFWApi.pressDelete(p.id).then(renderPressApps);
      });
      body.appendChild(tr);
    });
  }
  $("pvFilter").addEventListener("change", renderPvTable);
  $("pvRefresh").addEventListener("click", renderPressApps);
  $("pvCsv").addEventListener("click", function () {
    if (!pvCache.length) { toast("내보낼 내역이 없습니다.", true); return; }
    var cols = ["at", "media", "reporter", "phone", "email", "types", "days", "note", "status", "code", "checkedIn"];
    var rows = [cols.join(",")].concat(pvCache.map(function (p) {
      return cols.map(function (c) { return '"' + String(p[c] == null ? "" : p[c]).replace(/"/g, '""') + '"'; }).join(",");
    }));
    var blob = new Blob(["\ufeff" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "bfw_press_visits.csv"; a.click();
  });

  /* ---------- CHECK-IN ---------- */
  var ciInited = false, scanner = null;
  function initCheckin() {
    if (!ciInited) {
      $("ciSearch").addEventListener("click", function () { doCheckinSearch($("ciInput").value); });
      $("ciInput").addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); doCheckinSearch(this.value); }
      });
      $("ciScanBtn").addEventListener("click", toggleScan);
      initWalkin();
      ciInited = true;
    }
    renderWalkinStats();
    $("ciInput").focus();
  }

  /* QR 리더기는 '글자 입력 + Enter' 로 동작한다. 한 건 처리할 때마다
     입력칸을 비우고 포커스를 되돌려야 다음 사람 스캔이 들어온다. */
  function ciReset() { $("ciInput").value = ""; $("ciInput").focus(); }
  function ciHint(html) {
    var h = $("ciHint");
    if (!h) return;
    if (!html) { h.style.display = "none"; h.innerHTML = ""; return; }
    h.style.display = ""; h.innerHTML = html;
  }
  var RESV_CODE = /^(?:BFW-?)?(S\d{2}-[A-Z0-9]{4,10})$/;
  var PRESS_CODE = /^(?:BFW-?)?(PRS-[A-Z0-9]{4,10})$/;

  /* 스캔 즉시 입장 처리 — 클릭 없이 다음 사람으로 넘어간다 */
  function autoCheckin(code) {
    var res = $("ciResult");
    res.innerHTML = '<div class="ci-card neutral"><div class="ci-status">확인 중…</div></div>';
    BFWApi.checkIn("BFW-" + code).then(function (out) {
      if (out.ok) { showCiCard(out.entry, "entered"); toast(out.entry.name + "님 입장 ✓"); }
      else if (out.reason === "already" && out.entry) { showCiCard(out.entry, "already"); toast("이미 입장한 예약입니다.", true); }
      else if (out.reason === "forbidden") {
        res.innerHTML = '<div class="ci-card warn"><div class="ci-status">✕ 스태프 로그인이 필요합니다</div><div class="ci-show">화면을 새로고침한 뒤 다시 로그인해 주세요.</div></div>';
      } else {
        res.innerHTML = '<div class="ci-card warn"><div class="ci-status">✕ 예약 없음</div><div class="ci-show">‘BFW-' + esc(code) + '’ 에 해당하는 예약이 없습니다. 취소된 예약일 수 있습니다.</div></div>';
      }
      ciReset();
    });
  }
  function autoPressCheckin(code) {
    var res = $("ciResult");
    res.innerHTML = '<div class="ci-card neutral"><div class="ci-status">확인 중…</div></div>';
    BFWApi.pressCheckIn(code).then(function (out) {
      if (out.ok) { showPressCiCard(out.entry, "entered"); toast(out.entry.reporter + " 기자 입장 ✓"); }
      else if (out.reason === "already" && out.entry) { showPressCiCard(out.entry, "already"); toast("이미 입장한 프레스입니다.", true); }
      else if (out.reason === "forbidden") {
        res.innerHTML = '<div class="ci-card warn"><div class="ci-status">✕ 스태프 로그인이 필요합니다</div></div>';
      } else {
        res.innerHTML = '<div class="ci-card warn"><div class="ci-status">✕ 프레스 승인 없음</div><div class="ci-show">‘' + esc(code) + '’ 에 해당하는 승인된 프레스가 없습니다.</div></div>';
      }
      ciReset();
    });
  }

  /* ---------- 현장 스탠드석 인원 ---------- */
  function initWalkin() {
    var sel = $("wkShow");
    if (!sel) return;
    sel.innerHTML = (cfg.shows || []).map(function (s2) {
      return '<option value="' + esc(s2.id) + '">D' + esc(s2.day) + " · " + esc(s2.time || "") + " · " + esc(s2.titleKo || s2.title || s2.id) + "</option>";
    }).join("");
    $("wkSave").addEventListener("click", function () {
      var id = sel.value, n = parseInt($("wkCount").value, 10);
      if (!id || isNaN(n) || n < 0) { toast("인원수를 숫자로 입력해 주세요.", true); return; }
      BFWApi.walkinSet(id, n, $("wkNote").value.trim()).then(function (r) {
        if (r.ok) {
          toast(id + " 현장 인원 " + n + "명 저장 ✓");
          $("wkCount").value = ""; $("wkNote").value = "";
          renderWalkinStats();
        } else toast(r.reason === "forbidden" ? "스태프 로그인이 필요합니다." : "저장하지 못했습니다.", true);
      });
    });
  }
  function renderWalkinStats() {
    var box = $("wkStats");
    if (!box) return;
    box.innerHTML = '<div class="empty-state">불러오는 중…</div>';
    BFWApi.attendanceStats().then(function (rows) {
      if (!rows || !rows.length) { box.innerHTML = '<div class="empty-state">집계할 자료가 없습니다.</div>'; return; }
      var tR = 0, tE = 0, tW = 0;
      var h = '<table class="wk-table"><thead><tr><th>쇼</th><th>예약</th><th>입장 확인</th><th>현장</th><th>합계</th></tr></thead><tbody>';
      rows.forEach(function (r) {
        tR += +r.reserved; tE += +r.entered; tW += +r.walkin;
        h += '<tr><td><b>' + esc(r.show_id) + '</b> · ' + esc(r.title_ko || "") + (r.note ? ' <span class="wk-note">' + esc(r.note) + '</span>' : "") + '</td>' +
             '<td>' + r.reserved + '</td><td>' + r.entered + '</td><td>' + r.walkin + '</td><td><b>' + r.total + '</b></td></tr>';
      });
      h += '</tbody><tfoot><tr><td>전체 합계</td><td>' + tR + '</td><td>' + tE + '</td><td>' + tW + '</td><td><b>' + (tE + tW) + '</b></td></tr></tfoot></table>';
      box.innerHTML = h;
    });
  }
  function doCheckinSearch(q) {
    q = String(q || "").trim();
    var res = $("ciResult");
    if (!q) { res.innerHTML = ""; ciHint(""); return; }

    // 키보드가 한글 모드인 채로 스캔되면 코드가 자모로 깨져 들어온다
    if (/[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(q) && /[-0-9]/.test(q)) {
      ciHint('⌨ 키보드가 <b>한글 모드</b>인 것 같습니다. <b>한/영 키</b>를 눌러 영문으로 바꾼 뒤 다시 스캔해 주세요.');
      res.innerHTML = "";
      ciReset();
      return;
    }
    ciHint("");

    // QR·예약번호 형태면 곧바로 입장 처리 (연속 스캔)
    var up = q.toUpperCase().replace(/\s+/g, "");
    var mp = up.match(PRESS_CODE);
    if (mp) { autoPressCheckin(mp[1]); return; }
    var mc = up.match(RESV_CODE);
    if (mc) { autoCheckin(mc[1]); return; }

    // 코드가 아니면 이름·연락처 검색 — 자동 입장 처리하지 않는다
    res.innerHTML = '<div class="ci-card neutral"><div class="ci-status">조회 중…</div></div>';
    BFWApi.staffSearch(q).then(function (matches) {
      if (!matches.length) {
        res.innerHTML = '<div class="ci-card warn"><div class="ci-status">✕ 예약 없음</div><div class="ci-show">‘' + esc(q) + '’ 에 해당하는 예약을 찾을 수 없습니다.</div></div>';
        return;
      }
      if (matches.length === 1) { showCiCard(matches[0]); return; }
      res.innerHTML = '<div class="ci-card neutral"><div class="ci-status">' + matches.length + '건 검색됨 — 선택하세요</div><div class="ci-multi"></div></div>';
      var box = res.querySelector(".ci-multi");
      matches.forEach(function (r) {
        var row = document.createElement("div");
        row.className = "ci-pick";
        row.innerHTML = '<span class="cp-t">' + esc(r.showId) + ' · ' + esc(r.time || "") + '</span><span class="cp-n">' + esc(r.name) + ' · ' + esc(r.phone) + '</span>' +
          '<span class="pill ' + (r.checkedIn ? "entered" : "reserved") + '">' + (r.checkedIn ? "입장완료" : "예약") + '</span>';
        row.addEventListener("click", function () { showCiCard(r); });
        box.appendChild(row);
      });
    });
  }
  function showCiCard(r, mode) {
    var res = $("ciResult");
    var already = r.checkedIn;
    var cls = (mode === "entered") ? "ok" : (already ? "warn" : "ok");
    var status = (mode === "entered") ? "✓ 입장 완료"
               : already ? "⚠ 이미 입장한 예약입니다"
               : "✓ 유효한 예약";
    res.innerHTML =
      '<div class="ci-card ' + cls + '">' +
        '<div class="ci-status">' + status + '</div>' +
        '<div class="ci-name">' + esc(r.name) + '</div>' +
        '<div class="ci-show">' + esc(r.showId) + ' · ' + esc(r.titleKo || r.showTitle || "") + ' · ' + esc(r.time || "") + '</div>' +
        '<div class="ci-meta">BFW-' + esc(r.code) + ' · ' + esc(r.phone) + (already && r.checkedInAt ? ' · 입장 ' + fmtDate(r.checkedInAt) : "") + '</div>' +
        '<div class="ci-actions"></div>' +
      '</div>';
    var acts = res.querySelector(".ci-actions");
    if (already) {
      var undo = mkBtn("btn ghost", "입장 취소");
      undo.addEventListener("click", function () { BFWApi.undoCheckIn(r.id).then(function () { toast("입장을 취소했습니다."); reReadAndShow(r.code); ciReset(); }); });
      acts.appendChild(undo);
    } else {
      var go = mkBtn("btn primary", "입장 확인 →");
      go.addEventListener("click", function () {
        BFWApi.checkIn("BFW-" + r.code).then(function (out) {
          if (out.ok) { toast(r.name + "님 입장 처리됨 ✓"); reReadAndShow(r.code, "entered"); }
          else if (out.reason === "already") { toast("이미 입장한 예약입니다.", true); reReadAndShow(r.code, "already"); }
          else toast("처리 실패", true);
          ciReset();
        });
      });
      acts.appendChild(go);
    }
    var clear = mkBtn("btn ghost", "다음 →");
    clear.addEventListener("click", function () { res.innerHTML = ""; ciHint(""); ciReset(); });
    acts.appendChild(clear);
  }
  function reReadAndShow(code, mode) {
    BFWApi.findByCode("BFW-" + code).then(function (r) { if (r) showCiCard(r, mode); });
  }
  function showPressCiCard(p, mode) {
    var res = $("ciResult");
    var already = p.checkedIn;
    res.innerHTML =
      '<div class="ci-card ' + ((mode === "entered") ? "ok" : (already ? "warn" : "ok")) + '">' +
        '<div class="ci-status">' + ((mode === "entered") ? "✓ 입장 완료" : already ? "⚠ 이미 입장한 프레스입니다" : "✓ 승인된 프레스") + '</div>' +
        '<div class="ci-name">' + esc(p.reporter) + ' <span style="font-weight:400">· ' + esc(p.media) + '</span></div>' +
        '<div class="ci-show">PRESS · ' + esc(p.types || "") + (p.days ? " · " + esc(p.days) : "") + '</div>' +
        '<div class="ci-meta">' + esc(p.code) + ' · ' + esc(p.phone) + (already && p.checkedInAt ? ' · 입장 ' + fmtDate(p.checkedInAt) : "") + '</div>' +
        '<div class="ci-actions"></div>' +
      '</div>';
    var acts = res.querySelector(".ci-actions");
    if (already) {
      var undo = mkBtn("btn ghost", "입장 취소");
      undo.addEventListener("click", function () { BFWApi.pressUndoCheckIn(p.id).then(function () { toast("입장을 취소했습니다."); reShowPress(p.code); ciReset(); }); });
      acts.appendChild(undo);
    } else {
      var go = mkBtn("btn primary", "입장 확인 →");
      go.addEventListener("click", function () {
        BFWApi.pressCheckIn(p.code).then(function (out) {
          if (out.ok) { toast(p.reporter + " 기자 입장 처리됨 ✓"); reShowPress(p.code, "entered"); }
          else if (out.reason === "already") { toast("이미 입장했습니다.", true); reShowPress(p.code, "already"); }
          else toast("처리 실패", true);
          ciReset();
        });
      });
      acts.appendChild(go);
    }
    var clear = mkBtn("btn ghost", "다음 →");
    clear.addEventListener("click", function () { res.innerHTML = ""; ciHint(""); ciReset(); });
    acts.appendChild(clear);
  }
  function reShowPress(code, mode) { BFWApi.pressFindByCode(code).then(function (p) { if (p) showPressCiCard(p, mode); }); }
  function mkBtn(cls, label) { var b = document.createElement("button"); b.className = cls; b.textContent = label; return b; }

  function toggleScan() {
    var wrap = $("ciScanWrap");
    if (scanner) { stopScan(); return; }
    if (typeof Html5Qrcode === "undefined") { toast("스캐너를 불러오지 못했습니다. 검색을 사용하세요.", true); return; }
    wrap.style.display = "block";
    $("ciScanBtn").textContent = "■ 스캔 중지";
    scanner = new Html5Qrcode("ciReader");
    scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 220 },
      function (decoded) { doCheckinSearch(decoded); stopScan(); },
      function () {}
    ).catch(function () { toast("카메라를 사용할 수 없습니다. 검색을 사용하세요.", true); stopScan(); });
  }
  function stopScan() {
    var wrap = $("ciScanWrap");
    if (wrap) wrap.style.display = "none";
    var btn = $("ciScanBtn"); if (btn) btn.textContent = "📷 카메라 스캔";
    if (scanner) { try { scanner.stop().then(function () { scanner.clear(); }); } catch (e) {} scanner = null; }
  }

  /* ---------- helpers ---------- */
  function swap(arr, i, j) { var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
  function attr(s) { return String(s == null ? "" : s).replace(/"/g, "&quot;"); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }
  function fmtDate(iso) {
    try { var d = new Date(iso); return d.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
    catch (e) { return iso; }
  }

  /* ---------- SAVE / RESET ---------- */
  $("saveBtn").addEventListener("click", function () {
    var res = BFW.save(cfg);
    if (res === true) { markSaved(); toast("저장되었습니다. 사이트에 반영됩니다."); }
    else { toast("저장 실패: 이미지 용량이 너무 큽니다. 이미지 수를 줄여주세요.", true); }
  });
  $("resetBtn").addEventListener("click", function (e) {
    e.preventDefault();
    if (confirm("모든 설정을 기본값으로 되돌릴까요? (접수내역은 유지됩니다)")) {
      cfg = BFW.reset();
      renderAll();
      markSaved();
      toast("기본값으로 초기화했습니다.");
    }
  });

  window.addEventListener("beforeunload", function (e) {
    if (dirty) { e.preventDefault(); e.returnValue = ""; }
  });

  /* ---------- initial render ---------- */
  function renderAll() {
    renderLogo();
    $("brandPrimary").value = cfg.brand.textPrimary;
    $("brandSecondary").value = cfg.brand.textSecondary;
    $("brandNameKo").value = cfg.brand.nameKo;
    $("evYear").value = cfg.event.year;
    $("evVenue").value = cfg.event.venue;
    $("evDateLine").value = cfg.event.dateLine;
    $("evDateFull").value = cfg.event.dateFull;
    $("cdOn").checked = cfg.countdown.enabled;
    $("cdTarget").value = cfg.countdown.target;
    $("cdLabel").value = cfg.countdown.label;
    renderSections();
    $("mediaMode").value = cfg.media.mode;
    $("mediaUrl").value = cfg.media.url;
    $("mediaTitle").value = cfg.media.title;
    $("mediaLive").checked = cfg.media.live;
    renderPoster();
    renderArchive();
    renderPress();
    $("pressAuto").checked = cfg.press.auto;
    $("pressQuery").value = cfg.press.query;
    $("pressCount").value = cfg.press.count;
    $("pressProxy").value = cfg.press.proxyUrl;
    renderBrandList();
    renderUniList();
    renderLastYear();
    $("igHandle").value = cfg.instagram.handle;
    $("igProfile").value = cfg.instagram.profileUrl;
    $("igToken").value = cfg.instagram.token;
    $("igCount").value = cfg.instagram.count;
    renderIg();
    $("mapClient").value = cfg.map.naverClientId;
    $("mapLat").value = cfg.map.lat;
    $("mapLng").value = cfg.map.lng;
    $("mapZoom").value = cfg.map.zoom;
    $("mapAddr").value = cfg.map.address;
    $("mapAddrEn").value = cfg.map.addressEn;
    $("rsvPublished").checked = cfg.reserve.published;
    $("rsvOpen").checked = cfg.reserve.open;
    $("rsvCap").value = cfg.reserve.defaultCap;
    $("rsvNote").value = cfg.reserve.note;
    $("pvOpen").checked = cfg.pressVisit.open;
    $("pvNote").value = cfg.pressVisit.note;
    renderShows();
  }
  renderAll();
  markSaved();
})();
