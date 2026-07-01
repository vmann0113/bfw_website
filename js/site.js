/* ===========================================================
   BUSAN FASHION WEEK — apply config to the public site
   Reads window.BFW config and renders brand, section
   visibility, On Film video, archive, Instagram and the map.
   =========================================================== */
(function () {
  "use strict";
  if (!window.BFW) return;
  var cfg = window.BFW.load();

  function el(html) {
    var t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstChild;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* ---------- BRAND (nav + footer) ---------- */
  function applyBrand() {
    var b = cfg.brand;
    var nav = document.querySelector(".nav .brand");
    // Nav logo is authored directly in the HTML (two-state wave wordmark);
    // only fall back to a config wordmark if an admin logo is explicitly set.
    if (nav && b.logo) {
      nav.innerHTML = '<img class="brand-logo" src="' + b.logo + '" alt="' + esc(b.nameKo || "Busan Fashion Week") + '" />';
    }
  }

  /* ---------- EVENT BASICS ---------- */
  function applyEvent() {
    var e = cfg.event;
    var yr = document.querySelector(".hero__year");
    if (yr) yr.textContent = e.year;

    var where = document.querySelector(".hero__where");
    if (where) {
      var v = e.venue || "";
      if (v.charAt(0) === "@") where.innerHTML = '<span class="at">@</span>' + esc(v.slice(1));
      else where.textContent = v;
    }
    var when = document.querySelector(".hero__when");
    if (when) {
      var parts = (e.dateLine || "").split("—");
      if (when.querySelector("img")) {
        // date artwork authored in HTML — leave it
      } else if (parts.length === 2) {
        when.innerHTML = esc(parts[0].trim()) + ' <span class="dash">—</span> ' + esc(parts[1].trim());
      } else {
        when.textContent = e.dateLine;
      }
    }
    var visitDate = document.querySelector('#visit dd .en');
    var visitDd = document.querySelector('#visit dd');
    if (visitDd && e.dateFull) {
      visitDd.childNodes[0].nodeValue = e.dateFull;
    }
  }

  /* ---------- SECTION ON/OFF ---------- */
  function applySections() {
    Object.keys(cfg.sections).forEach(function (id) {
      var s = cfg.sections[id];
      var sec = document.getElementById(id);
      if (!sec) return;
      var navLink = document.querySelector('.nav-links a[href="#' + id + '"], .footer__cols a[href="#' + id + '"]');

      if (s.enabled) return; // visible as authored

      if (s.offMode === "hidden") {
        sec.style.display = "none";
        document.querySelectorAll('a[href="#' + id + '"]').forEach(function (a) {
          if (!a.classList.contains("nav-cta")) a.style.display = "none";
        });
      } else {
        // coming-soon: keep the section header, replace the body
        var wrap = sec.querySelector(".wrap") || sec;
        var head = wrap.querySelector(".sec-head, .ig-head");
        Array.prototype.slice.call(wrap.children).forEach(function (c) {
          if (c !== head) c.style.display = "none";
        });
        var note = el(
          '<div class="coming-state">' +
            '<span class="coming-badge">COMING SOON</span>' +
            "<p>준비중입니다.</p>" +
          "</div>"
        );
        wrap.appendChild(note);
      }
    });
  }

  /* ---------- ON FILM ---------- */
  function ytId(u) {
    if (!u) return "";
    if (!/[/.]/.test(u)) return u; // already an id
    var m = u.match(/(?:youtu\.be\/|v=|embed\/|live\/)([\w-]{6,})/);
    return m ? m[1] : u;
  }
  function applyMedia() {
    var m = cfg.media;
    var frame = document.getElementById("videoFrame");
    var cap = document.querySelector(".media-cap .meta");
    if (cap) cap.textContent = m.title;

    var liveTag = document.querySelector(".media-cap .meta:last-child");
    if (liveTag) liveTag.textContent = m.live ? "LIVE ●" : "YouTube ↗";
    if (m.live && liveTag) liveTag.classList.add("is-live");

    if (!frame) return;
    var playBtn = document.getElementById("playBtn");

    // No video set yet → show a "준비중" state instead of an empty/broken frame.
    if (!m.url) {
      if (playBtn) playBtn.style.display = "none";
      if (!frame.querySelector(".media-coming")) {
        frame.appendChild(el('<div class="media-coming">준비중입니다.</div>'));
      }
      return;
    }

    if (m.poster) {
      var slot = frame.querySelector("image-slot");
      if (slot) {
        slot.style.background = "#000 url('" + m.poster + "') center/cover no-repeat";
      }
    }
    if (!playBtn) return;
    playBtn.addEventListener("click", function () {
      var slot = frame.querySelector("image-slot");
      if (slot) slot.style.display = "none";
      playBtn.style.display = "none";
      var node;
      if (m.mode === "video") {
        node = document.createElement("video");
        node.src = m.url; node.controls = true; node.autoplay = true; node.playsInline = true;
        node.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000";
      } else {
        node = document.createElement("iframe");
        var id = ytId(m.url);
        node.src = "https://www.youtube.com/embed/" + id + "?autoplay=1&rel=0" + (m.live ? "&autoplay=1" : "");
        node.allow = "autoplay; encrypted-media; fullscreen";
        node.allowFullscreen = true;
      }
      frame.appendChild(node);
    }, { once: true });
  }

  /* ---------- 2025 LINEUP (BRAND / UNIVERSITY logo walls, archive) ---------- */
  function lyCard(b) {
    var hasLink = !!b.link;
    var tag = hasLink ? "a" : "div";
    var inner =
      '<div class="ly-logo__tile' + (b.logo ? "" : " empty") + (b.dark ? " dark" : "") + (b.fill ? " fill" : "") + '">' +
        (b.logo ? '<img src="' + esc(b.logo) + '" alt="' + esc(b.name) + '" />' : '<span>' + esc(b.name) + '</span>') +
      "</div>" +
      (b.name ? '<div class="ly-logo__name">' + esc(b.name) + "</div>" : "") +
      (b.country ? '<div class="ly-logo__country">' + esc(b.country) + "</div>" : "");
    return el("<" + tag + ' class="ly-logo"' +
      (hasLink ? ' href="' + esc(b.link) + '" target="_blank" rel="noopener"' : "") + ">" + inner + "</" + tag + ">");
  }
  function fillLy(gridId, items) {
    var grid = document.getElementById(gridId);
    if (!grid) return;
    grid.innerHTML = "";
    if (!items || !items.length) { grid.appendChild(el('<div class="wall-empty">준비중입니다.</div>')); return; }
    items.forEach(function (b) { grid.appendChild(lyCard(b)); });
  }
  function applyLastYear() {
    if (!cfg.lastYear) return;
    fillLy("lyBrandGrid", cfg.lastYear.brands);
    fillLy("lyUniGrid", cfg.lastYear.universities);
  }

  /* ---------- BRANDS (logo wall) ---------- */
  function applyBrands() {
    var grid = document.getElementById("brandGrid");
    if (!grid || !cfg.brands) return;
    var tabs = document.querySelector("#brands .brand-tabs");
    grid.innerHTML = "";
    if (!cfg.brands.length) {
      if (tabs) tabs.style.display = "none";
      grid.appendChild(el('<div class="wall-empty">준비중입니다.</div>'));
      return;
    }
    if (tabs) tabs.style.display = "";
    cfg.brands.forEach(function (b, i) {
      var href = b.link || "";
      var hasLink = !!b.link;
      var inner =
        '<div class="bcard__top"><span class="no">' + esc(b.no || "") + "</span>" +
          (b.country ? '<span class="flag">' + esc(b.country) + "</span>" : "") + "</div>" +
        '<div class="bcard__logo' + (b.logo ? "" : " empty") + '">' +
          (b.logo
            ? '<img src="' + esc(b.logo) + '" alt="' + esc(b.name) + '" />'
            : '<span class="bn">' + esc(b.name) + "</span>") +
        "</div>" +
        '<div class="bcard__name"><span class="bk">' + esc(b.nameKo || "") + "</span>" +
          (hasLink ? '<span class="arrow">↗</span>' : "") + "</div>";
      var tag = hasLink ? "a" : "div";
      var card = el("<" + tag + ' class="bcard r' + (b.cat === "intl" ? " intl" : "") + (i < 8 ? " in" : "") + '" data-cat="' + esc(b.cat || "kr") + '"' +
        (hasLink ? ' href="' + esc(href) + '" target="_blank" rel="noopener"' : "") + ">" + inner + "</" + tag + ">");
      grid.appendChild(card);
    });
    wireBrandFilter();
  }
  function wireBrandFilter() {
    var tabs = document.querySelectorAll(".brand-tab");
    var cards = document.querySelectorAll("#brandGrid .bcard");
    tabs.forEach(function (tab) {
      tab.onclick = function () {
        tabs.forEach(function (t) { t.setAttribute("aria-selected", "false"); });
        tab.setAttribute("aria-selected", "true");
        var f = tab.getAttribute("data-filter");
        cards.forEach(function (c) {
          c.style.display = (f === "all" || c.getAttribute("data-cat") === f) ? "" : "none";
        });
      };
    });
  }

  /* ---------- UNIVERSITIES (logo wall) ---------- */
  function applyUniversities() {
    var grid = document.getElementById("uniGrid");
    if (!grid || !cfg.universities) return;
    grid.innerHTML = "";
    if (!cfg.universities.length) {
      grid.appendChild(el('<div class="wall-empty">준비중입니다.</div>'));
      return;
    }
    cfg.universities.forEach(function (u) {
      var hasLink = !!u.link;
      var tag = hasLink ? "a" : "div";
      var inner =
        '<div class="uni-logo__img' + (u.logo ? "" : " empty") + '">' +
          (u.logo ? '<img src="' + esc(u.logo) + '" alt="' + esc(u.name) + '" />' : "") +
        "</div>" +
        '<span class="uni-logo__name">' + esc(u.name) + "</span>";
      var card = el("<" + tag + ' class="uni-logo"' +
        (hasLink ? ' href="' + esc(u.link) + '" target="_blank" rel="noopener"' : "") + ">" + inner + "</" + tag + ">");
      grid.appendChild(card);
    });
  }

  /* ---------- PRESS (news cards) ---------- */
  function pressCard(it) {
    var host = "";
    try { host = it.link ? new URL(it.link).hostname.replace(/^www\./, "") : ""; } catch (e) {}
    var source = it.source || host || "기사";
    var thumb = it.image
      ? '<div class="pc__thumb" style="background-image:url(\'' + esc(it.image) + '\')"></div>'
      : '<div class="pc__thumb empty"><span>' + esc(source) + "</span></div>";
    return el(
      '<a class="pcard" href="' + esc(it.link || "#") + '" target="_blank" rel="noopener">' +
        thumb +
        '<div class="pc__body">' +
          '<div class="pc__meta"><span class="pc__src">' + esc(source) + "</span>" +
            (it.date ? '<span class="pc__date">' + esc(it.date) + "</span>" : "") + "</div>" +
          '<div class="pc__title">' + esc(it.title || "") + "</div>" +
        "</div>" +
        '<span class="pc__arrow">↗</span>' +
      "</a>"
    );
  }
  function renderPress(items) {
    var grid = document.getElementById("pressGrid");
    if (!grid) return;
    var p = cfg.press || {};
    var n = p.count || 6;
    grid.innerHTML = "";
    if (!items || !items.length) {
      grid.appendChild(el('<div class="wall-empty">준비중입니다.</div>'));
      return;
    }
    items.slice(0, n).forEach(function (it) { grid.appendChild(pressCard(it)); });
  }
  function applyPress() {
    var grid = document.getElementById("pressGrid");
    if (!grid) return;
    var p = cfg.press || {};
    var more = document.getElementById("pressMore");
    if (more) more.href = "https://search.naver.com/search.naver?where=news&query=" + encodeURIComponent(p.query || "부산패션위크");

    var manual = (p.items || []).slice();
    renderPress(manual); // show manual immediately

    if (p.auto && p.proxyUrl) {
      fetch(p.proxyUrl + (p.proxyUrl.indexOf("?") < 0 ? "?" : "&") + "query=" + encodeURIComponent(p.query || "부산패션위크") + "&count=" + (p.count || 6))
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var fetched = (data.items || data || []).map(function (x) {
            return {
              title: stripTags(x.title || x.headline || ""),
              source: x.source || x.publisher || "",
              date: x.date || x.pubDate || "",
              link: x.link || x.url || "",
              image: x.image || x.thumbnail || null
            };
          });
          // manual entries first, then auto (de-duped by link)
          var seen = {}; var merged = [];
          manual.concat(fetched).forEach(function (it) {
            var key = it.link || it.title;
            if (seen[key]) return; seen[key] = 1; merged.push(it);
          });
          renderPress(merged);
        })
        .catch(function () { /* keep manual */ });
    }
  }
  function stripTags(s) { return String(s || "").replace(/<[^>]*>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"); }

  /* ---------- ARCHIVE (index preview) ---------- */
  function applyArchive() {
    var grid = document.querySelector("#archive .arch-grid");
    if (!grid) return;
    var items = cfg.archive.slice(0, 6);
    grid.innerHTML = "";
    if (!items.length) {
      grid.appendChild(el('<div class="wall-empty">준비중입니다.</div>'));
      return;
    }
    items.forEach(function (a, i) {
      var href = a.link || "archive.html";
      var bg = a.image
        ? 'style="background-image:url(' + "'" + a.image + "'" + ')"'
        : "";
      var card = el(
        '<a class="arch r in' + (i ? " d" + i : "") + '" href="' + esc(href) + '">' +
          '<div class="arch__bg' + (a.image ? "" : " empty") + '" ' + bg + ">" +
            (a.image ? "" : '<span class="arch__ph">' + esc(a.year) + "</span>") +
          "</div>" +
          '<div class="arch__meta"><div class="arch__yr">' + esc(a.year) + "</div>" +
          '<div class="arch__t">' + esc(a.title) + "</div></div>" +
        "</a>"
      );
      grid.appendChild(card);
    });
    // "view all" link
    var head = document.querySelector("#archive .sec-head .aside");
    if (head && !document.querySelector("#archive .arch-all")) {
      var more = el('<a class="arch-all" href="archive.html">전체 아카이브 보기 →</a>');
      head.parentNode.appendChild(more);
    }
  }

  /* ---------- INSTAGRAM ---------- */
  function renderIgCells(posts) {
    var grid = document.querySelector("#instagram .ig-grid");
    if (!grid) return;
    grid.innerHTML = "";
    var n = cfg.instagram.count || 6;
    for (var i = 0; i < n; i++) {
      var p = posts[i];
      var href = (p && p.link) || cfg.instagram.profileUrl || "#";
      var bg = p && p.image ? 'style="background-image:url(' + "'" + p.image + "'" + ')"' : "";
      var cell = el(
        '<a class="ig-cell r in' + (i % 4 ? " d" + (i % 4) : "") + '" href="' + esc(href) + '" target="_blank" rel="noopener">' +
          '<div class="ig-img' + (p && p.image ? "" : " empty") + '" ' + bg + ">" +
            (p && p.image ? "" : '<span class="ig-ph">@' + esc(cfg.instagram.handle) + "</span>") +
          "</div>" +
        "</a>"
      );
      grid.appendChild(cell);
    }
  }
  function applyInstagram() {
    var ig = cfg.instagram;
    var handle = document.querySelector("#instagram .ig-handle");
    if (handle) handle.textContent = "@" + ig.handle;
    var follow = document.querySelector("#instagram .ig-head a");
    if (follow) follow.href = ig.profileUrl;

    // 1) try live fetch if a token is provided (works once deployed with a valid token)
    if (ig.token) {
      var url = "https://graph.instagram.com/me/media?fields=media_url,permalink,caption,media_type,thumbnail_url&limit=" +
        (ig.count || 6) + "&access_token=" + encodeURIComponent(ig.token);
      fetch(url)
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data && data.data && data.data.length) {
            var posts = data.data.map(function (m) {
              return {
                image: m.media_type === "VIDEO" ? m.thumbnail_url : m.media_url,
                link: m.permalink,
                caption: m.caption || ""
              };
            });
            renderIgCells(posts);
          } else {
            renderIgCells(ig.posts || []);
          }
        })
        .catch(function () { renderIgCells(ig.posts || []); });
    } else {
      renderIgCells(ig.posts || []);
    }
  }

  /* ---------- NAVER MAP ---------- */
  function applyMap() {
    var box = document.querySelector("#visit .visit-map");
    if (!box) return;
    var m = cfg.map;

    // update address text in the info column
    var dds = document.querySelectorAll("#visit .visit-info dd");
    if (dds[1] && m.address) {
      dds[1].childNodes[0].nodeValue = m.address;
      var en = dds[1].querySelector(".en");
      if (en && m.addressEn) en.textContent = m.addressEn;
    }

    if (!m.naverClientId) return; // keep placeholder map image

    // surface auth/domain failures instead of a silent blank map
    window.navermap_authFailure = function () {
      box.innerHTML = '<div class="map-err">네이버 지도 인증 실패 — 콘솔에 현재 도메인이 등록되지 않았거나 반영 전입니다.<br>등록 후 몇 분 뒤 새로고침해 주세요.</div>';
    };

    // swap the placeholder for a live Naver map container
    box.innerHTML = '<div id="naverMap" style="position:absolute;inset:0"></div>';
    var s = document.createElement("script");
    s.src = "https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=" + encodeURIComponent(m.naverClientId);
    s.onload = function () {
      try {
        var naver = window.naver;
        var pos = new naver.maps.LatLng(m.lat, m.lng);
        var map = new naver.maps.Map("naverMap", { center: pos, zoom: m.zoom || 16 });
        new naver.maps.Marker({ position: pos, map: map });
      } catch (e) {}
    };
    s.onerror = function () {
      box.innerHTML = '<div class="map-err">네이버 지도 키가 유효하지 않거나 도메인이 등록되지 않았습니다.</div>';
    };
    document.head.appendChild(s);
  }

  /* ---------- RESERVE entry points (nav + visit CTAs) ---------- */
  function applyReserve() {
    var r = cfg.reserve || {};
    var navCta = document.querySelector(".nav .nav-cta");
    var primary = document.querySelector("#visit .btn.primary");
    var target = "register.html";

    if (!r.published) {
      // Not launched yet: remove all reservation entry points from the public site.
      if (navCta) navCta.style.display = "none";
      if (primary) primary.style.display = "none";
      document.querySelectorAll('a[href="register.html"]').forEach(function (a) {
        if (a !== navCta && a !== primary) a.style.display = "none";
      });
      return;
    }

    // Published. Reservation is live (or shows the closed note on register.html).
    if (navCta) { navCta.style.display = ""; navCta.href = target; }
    if (primary) {
      primary.style.display = "";
      if (!r.open) {
        primary.classList.add("is-disabled");
        primary.removeAttribute("href");
        primary.innerHTML = "예약 마감 <span>·</span>";
      } else {
        primary.href = target;
      }
    }
  }

  /* ---------- renumber visible section indices (e.g. after IR is hidden) ---------- */
  function renumberSections() {
    var secs = document.querySelectorAll("section.section");
    var n = 0;
    secs.forEach(function (sec) {
      if (getComputedStyle(sec).display === "none") return;
      var idx = sec.querySelector(".idx");
      if (!idx) return;
      n++;
      var num = "(" + String(n).replace(/^(\d)$/, "0$1") + ")";
      idx.textContent = idx.textContent.replace(/^\(\d+\)/, num);
    });
  }

  /* ---------- run ---------- */
  function init() {
    applyBrand();
    applyEvent();
    applySections();
    applyMedia();
    applyBrands();
    applyLastYear();
    applyUniversities();
    applyPress();
    applyArchive();
    applyInstagram();
    applyMap();
    applyReserve();
    renumberSections();
    document.documentElement.setAttribute("data-bfw-ready", "1");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
