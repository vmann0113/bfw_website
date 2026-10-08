/* ===========================================================
   BUSAN FASHION WEEK — data access layer
   One async API for both modes:
     • backend mode  → talks to Supabase (REST + RPC) when
       BFW.SUPABASE keys are filled in (see SUPABASE_SETUP.md)
     • local mode    → falls back to this browser's storage,
       so the prototype works with no backend.
   The frontend only ever calls BFWApi.* and awaits a Promise,
   so swapping modes needs no UI changes.
   =========================================================== */
(function (global) {
  "use strict";
  var BFW = global.BFW;
  var SB = BFW.SUPABASE || { url: "", anonKey: "" };
  var BACKEND = !!(SB.url && SB.anonKey);
  /* ---------- 스태프 로그인 세션 ----------------------------------------
     예전에는 토큰을 변수 하나에만 두어, 화면을 새로 고치면 로그인이 풀렸다.
     현장 체크인 기기가 실수로 새로고침되면 그 자리에서 다시 로그인해야 했다.
     그래서 sessionStorage 에 담는다 :
       · 새로고침·주소 재입력에는 살아남는다
       · 탭을 닫으면 사라진다 (공용 기기에 남지 않는다)
       · 다른 탭·다른 사람의 브라우저로는 넘어가지 않는다
     접근 토큰은 한 시간이면 만료되므로 갱신 토큰으로 조용히 늘린다.
     ------------------------------------------------------------------- */
  var staffToken = null;     // Supabase Auth JWT for staff (check-in / admin)
  var staffRefresh = null;   // 갱신 토큰
  var staffExp = 0;          // 만료 시각 (ms)
  var refreshing = null;     // 갱신이 겹치지 않도록 하나만 돈다
  var SKEY = "bfw_staff";

  function saveSession(d) {
    staffToken = d.access_token || null;
    staffRefresh = d.refresh_token || null;
    staffExp = Date.now() + (Number(d.expires_in || 3600) * 1000);
    try {
      sessionStorage.setItem(SKEY, JSON.stringify({ a: staffToken, r: staffRefresh, e: staffExp }));
    } catch (e) { /* 저장이 막혀 있어도 이번 화면에서는 그대로 쓴다 */ }
  }
  function clearSession() {
    staffToken = null; staffRefresh = null; staffExp = 0;
    try { sessionStorage.removeItem(SKEY); } catch (e) {}
  }
  /* 세션이 끊겼음을 화면에 알린다. 관리자 화면이 받아 로그인 창을 다시 띄운다.
     이게 없으면 "불러오는 중…"에서 멈춘 것처럼 보인다. */
  function staffExpired() {
    clearSession();
    try { window.dispatchEvent(new CustomEvent("bfw-staff-expired")); } catch (e) {}
  }
  (function restoreSession() {
    try {
      var v = JSON.parse(sessionStorage.getItem(SKEY) || "null");
      if (v && v.a) { staffToken = v.a; staffRefresh = v.r || null; staffExp = v.e || 0; }
    } catch (e) {}
  })();
  /* 갱신 토큰으로 접근 토큰을 다시 받는다. 실패하면 로그인 화면으로 돌아가야 하므로 비운다. */
  function refreshSession() {
    if (!BACKEND || !staffRefresh) return Promise.resolve(false);
    if (refreshing) return refreshing;
    refreshing = fetch(SB.url.replace(/\/$/, "") + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { apikey: SB.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: staffRefresh })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.access_token) { saveSession(d); return true; }
      return false;
    }).catch(function () { return false; }).then(function (ok) {
      refreshing = null; return ok;
    });
    return refreshing;
  }

  /* ---------- small REST helpers ---------- */
  function rest(path, opts, retried) {
    opts = opts || {};
    var headers = {
      apikey: SB.anonKey,
      Authorization: "Bearer " + (staffToken || SB.anonKey),
      "Content-Type": "application/json"
    };
    if (opts.headers) for (var k in opts.headers) headers[k] = opts.headers[k];
    return fetch(SB.url.replace(/\/$/, "") + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      return res.text().then(function (t) {
        var data = t ? JSON.parse(t) : null;
        if (!res.ok) {
          // 스태프 토큰이 만료됐을 뿐이면 조용히 갱신하고 한 번만 다시 시도한다
          if (res.status === 401 && staffToken) {
            if (staffRefresh && !retried) {
              return refreshSession().then(function (ok) {
                if (!ok) { staffExpired(); throw Object.assign(new Error("api"), { status: 401, data: data }); }
                return rest(path, opts, true);
              });
            }
            staffExpired();
          }
          throw Object.assign(new Error("api"), { status: res.status, data: data });
        }
        return data;
      });
    });
  }
  function rpc(fn, args) { return rest("/rest/v1/rpc/" + fn, { method: "POST", body: args || {} }); }

  /* ---------- normalize Supabase row → frontend shape ---------- */
  function fromRow(r) {
    if (!r) return null;
    return {
      id: r.id, code: r.code, showId: r.show_id,
      showTitle: r.show_title, titleKo: r.title_ko, lineup: r.lineup,
      day: r.day, date: r.date, time: r.start_time, end: r.end_time, venue: r.venue,
      name: r.name, phone: r.phone, email: r.email, marketing: r.marketing,
      seatId: r.seat_id, seatLabel: r.seat_label, source: r.source, holderId: r.holder_id,
      guestOrg: r.guest_org, guestTitle: r.guest_title,
      status: r.status, checkedIn: r.checked_in, checkedInAt: r.checked_in_at, at: r.created_at
    };
  }
  function fromPressRow(r) {
    if (!r) return null;
    return {
      id: r.id, media: r.media, reporter: r.reporter, phone: r.phone, email: r.email,
      types: r.types, days: r.days, note: r.note, status: r.status, code: r.code,
      checkedIn: r.checked_in, checkedInAt: r.checked_in_at, at: r.created_at
    };
  }
  function sha256(s) {
    try {
      var enc = new TextEncoder().encode(String(s));
      return crypto.subtle.digest("SHA-256", enc).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, "0"); }).join("");
      });
    } catch (e) { return Promise.resolve("plain:" + s); }
  }

  /* ===========================================================
     PUBLIC API
     =========================================================== */
  var Api = {
    mode: function () { return BACKEND ? "supabase" : "local"; },
    isBackend: function () { return BACKEND; },

    /* staff auth (backend only) — email/password → Supabase Auth */
    staffSignIn: function (email, password) {
      if (!BACKEND) return Promise.resolve({ ok: true, local: true });
      return fetch(SB.url.replace(/\/$/, "") + "/auth/v1/token?grant_type=password", {
        method: "POST",
        headers: { apikey: SB.anonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, password: password })
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.access_token) { saveSession(d); return { ok: true }; }
        return { ok: false, error: d.error_description || d.msg || "로그인 실패" };
      });
    },
    setStaffToken: function (t) { staffToken = t; },
    /* 공용 기기에서 쓰고 나면 이걸로 지운다 */
    staffSignOut: function () { clearSession(); },
    hasStaff: function () {
      if (!BACKEND) return true;
      if (!staffToken) return false;
      // 만료됐는데 갱신할 방법도 없으면 로그인 창을 다시 띄워야 한다
      if (staffExp && Date.now() >= staffExp && !staffRefresh) { clearSession(); return false; }
      return true;
    },

    /* ---- availability: { showId: {capacity, reserved, remaining} } ---- */
    availability: function () {
      if (BACKEND) {
        return rest("/rest/v1/show_availability?select=*").then(function (rows) {
          var map = {};
          (rows || []).forEach(function (r) {
            map[r.id] = {
              capacity: r.capacity, reserved: r.reserved, remaining: r.remaining,
              closed: !!r.closed, closeAt: r.reserve_close_at || null,
              locked: r.locked || 0, mode: r.seating_mode || "free"
            };
          });
          return map;
        });
      }
      var cfg = BFW.load(), list = BFW.loadResv(), map = {};
      (cfg.shows || []).forEach(function (s) {
        var cap = s.cap || cfg.reserve.defaultCap || 300;
        var reserved = list.filter(function (r) { return r.showId === s.id && r.status !== "cancelled"; }).length;
        map[s.id] = { capacity: cap, reserved: reserved, remaining: Math.max(0, cap - reserved) };
      });
      return Promise.resolve(map);
    },

    /* ---- reserve one seat (atomic on the server) ---- */
    reserve: function (show) {
      if (BACKEND) {
        /* 시연 모드(오픈 전 주최측 점검)는 전용 함수로 간다.
           실제 예약 함수는 손대지 않는다 — 오픈 직전에 핵심 코드를 건드리지 않기 위해서다. */
        if (show.demo) {
          return rpc("demo_reserve", {
            p_key: show.demo, p_show_id: show.showId,
            p_name: show.name, p_phone: show.phone,
            p_email: show.email || null, p_marketing: !!show.marketing
          }).then(function (d) {
            if (d && d.ok) return { ok: true, entry: fromRow(d.reservation) };
            return { ok: false, reason: (d && d.reason) || "error" };
          }).catch(function () { return { ok: false, reason: "network" }; });
        }
        return rpc("reserve_seat", {
          p_show_id: show.showId, p_seat_id: show.seatId || null,
          p_name: show.name, p_phone: show.phone,
          p_email: show.email || null, p_marketing: !!show.marketing
        }).then(function (d) {
          if (d && d.ok) return { ok: true, entry: fromRow(d.reservation) };
          return { ok: false, reason: (d && d.reason) || "error" };
        }).catch(function () { return { ok: false, reason: "network" }; });
      }
      var cfg = BFW.load(), s = (cfg.shows || []).find(function (x) { return x.id === show.showId; }) || {};
      var cap = s.cap || cfg.reserve.defaultCap || 300;
      var res = BFW.addResv({
        showId: show.showId, showTitle: show.showTitle, titleKo: show.titleKo, lineup: show.lineup,
        day: show.day, date: show.date, dow: show.dow, time: show.time, end: show.end, venue: show.venue,
        name: show.name, phone: show.phone, email: show.email, marketing: show.marketing
      }, cap);
      return Promise.resolve(res);
    },

    /* ================= 좌석 (구역 · 배치도) ================= */

    /* 쇼×구역 잔여석 — { showId: [ {code,label,side,sort,seatCount,reserved,locked,remaining} ] } */
    zoneAvailability: function () {
      if (BACKEND) {
        return rest("/rest/v1/zone_availability?select=*&order=sort").then(function (rows) {
          var by = {};
          (rows || []).forEach(function (r) {
            (by[r.show_id] = by[r.show_id] || []).push({
              code: r.zone_code, label: r.label, side: r.side, sort: r.sort,
              rows: r.rows_count, tiers: r.tiers, seatCount: r.seat_count,
              reserved: r.reserved, locked: r.locked, remaining: r.remaining
            });
          });
          return by;
        }).catch(function () { return {}; });
      }
      return Promise.resolve(BFW.localZones ? BFW.localZones() : {});
    },

    /* 한 구역의 좌석 상태 — [ {seatId,num,tier,row,status} ] status: free|taken|invite|blocked */
    seatMap: function (showId, zoneCode) {
      if (BACKEND) {
        return rpc("seat_map", { p_show_id: showId, p_zone_code: zoneCode })
          .then(function (rows) {
            return (rows || []).map(function (r) {
              return { seatId: r.seat_id, num: r.num, tier: r.tier, row: r.row_no, status: r.status };
            });
          }).catch(function () { return []; });
      }
      return Promise.resolve([]);
    },

    /* ---- 모바일 입장권 조회 (공개, 이름은 가려져서 옴) ---- */
    /* ---- 현장등록 : 배너 QR. 등록과 동시에 입장 처리된다 ---- */
    walkinShow: function (key) {
      if (!BACKEND) return Promise.resolve({ ok: false, reason: "nobackend" });
      return rpc("walkin_show", { p_key: key })
        .then(function (d) { return d || { ok: false, reason: "error" }; })
        .catch(function () { return { ok: false, reason: "network" }; });
    },
    walkinRegister: function (key, who) {
      if (!BACKEND) return Promise.resolve({ ok: false, reason: "nobackend" });
      return rpc("walkin_register", {
        p_key: key, p_name: who.name, p_phone: who.phone, p_marketing: !!who.marketing
      }).then(function (d) { return d || { ok: false, reason: "error" }; })
        .catch(function () { return { ok: false, reason: "network" }; });
    },

    /* ---- 브랜드 초청권 : 좌석 없는 사전등록 ---- */
    inviteView: function (token) {
      if (!BACKEND) return Promise.resolve({ ok: false, reason: "nobackend" });
      return rpc("invite_view", { p_token: token })
        .then(function (d) { return d || { ok: false, reason: "error" }; })
        .catch(function () { return { ok: false, reason: "network" }; });
    },
    inviteClaim: function (token, who) {
      if (!BACKEND) return Promise.resolve({ ok: false, reason: "nobackend" });
      return rpc("invite_claim", {
        p_token: token, p_name: who.name, p_phone: who.phone,
        p_email: who.email || null, p_marketing: !!who.marketing
      }).then(function (d) {
        if (d && d.ok) return { ok: true, brand: d.brand, entry: fromRow(d.reservation) };
        return { ok: false, reason: (d && d.reason) || "error" };
      }).catch(function () { return { ok: false, reason: "network" }; });
    },

    ticketView: function (codes) {
      if (BACKEND) {
        return rpc("ticket_view", { p_codes: codes })
          .then(function (rows) { return rows || []; })
          .catch(function () { return []; });
      }
      return Promise.resolve([]);
    },

    /* ---- 스태프: 쇼의 예약 방식 바꾸기 ('assigned' | 'free') ---- */
    setSeatingMode: function (showId, mode) {
      if (BACKEND) {
        return rpc("set_seating_mode", { p_show_id: showId, p_mode: mode })
          .then(function (d) { return d || { ok: false }; })
          .catch(function () { return { ok: false, reason: "network" }; });
      }
      return Promise.resolve({ ok: true });
    },

    /* ---- 스태프: 초청석 잠그기/풀기 (p_kind null 이면 해제) ---- */
    seatLockSet: function (showId, seatIds, kind, note) {
      if (BACKEND) {
        return rpc("seat_lock_set", { p_show_id: showId, p_seat_ids: seatIds, p_kind: kind || null, p_note: note || null })
          .then(function (d) { return d || { ok: false }; })
          .catch(function () { return { ok: false, reason: "network" }; });
      }
      return Promise.resolve({ ok: true });
    },

    /* ---- 스태프: 초청자 배정 ---- */
    inviteAssign: function (e) {
      if (BACKEND) {
        return rpc("invite_assign", {
          p_show_id: e.showId, p_seat_id: e.seatId, p_name: e.name,
          p_phone: e.phone || null, p_org: e.org || null, p_title: e.title || null
        }).then(function (d) {
          if (d && d.ok) return { ok: true, entry: fromRow(d.reservation) };
          return { ok: false, reason: (d && d.reason) || "error" };
        }).catch(function () { return { ok: false, reason: "network" }; });
      }
      return Promise.resolve({ ok: false, reason: "local" });
    },

    /* ---- 스태프: 좌석 현황판 (누가 어느 자리인지) ---- */
    seatAdminMap: function (showId) {
      if (BACKEND) {
        return rpc("seat_admin_map", { p_show_id: showId })
          .then(function (rows) { return rows || []; }).catch(function () { return []; });
      }
      return Promise.resolve([]);
    },

    /* ---- lookup my reservations by name + phone (both must match) ---- */
    lookupByPhone: function (phone, name) {
      if (BACKEND) {
        return rpc("lookup_reservations", { p_phone: phone, p_name: name })
          .then(function (rows) { return (rows || []).map(fromRow); })
          .catch(function () { return []; });
      }
      var nk = String(name || "").replace(/\s/g, "").toLowerCase();
      return Promise.resolve(BFW.findByPhone(phone).filter(function (r) {
        return String(r.name || "").replace(/\s/g, "").toLowerCase() === nk;
      }));
    },

    /* ---- find one reservation by code (for check-in scan) ---- */
    findByCode: function (code) {
      if (BACKEND) {
        return rpc("find_reservation", { p_code: BFW.normCode(code) })
          .then(function (rows) { return rows && rows[0] ? fromRow(rows[0]) : null; })
          .catch(function () { return null; });
      }
      return Promise.resolve(BFW.findByCode(code));
    },

    /* ---- staff search by name/phone (check-in) ---- */
    staffSearch: function (q) {
      if (BACKEND) {
        return rpc("staff_search", { p_q: q })
          .then(function (rows) { return (rows || []).map(fromRow); })
          .catch(function () { return []; });
      }
      var all = BFW.loadResv().filter(function (r) { return r.status !== "cancelled"; });
      var ql = String(q || "").toLowerCase();
      return Promise.resolve(all.filter(function (r) {
        return (r.phone || "").indexOf(q) >= 0 || (r.name || "").toLowerCase().indexOf(ql) >= 0;
      }));
    },

    /* ---- check in by code (atomic; blocks re-entry) ---- */
    checkIn: function (code) {
      if (BACKEND) {
        return rpc("check_in", { p_code: BFW.normCode(code) }).then(function (d) {
          if (d && d.ok) return { ok: true, entry: fromRow(d.reservation) };
          return { ok: false, reason: (d && d.reason) || "error", entry: d && d.reservation ? fromRow(d.reservation) : null };
        }).catch(function () { return { ok: false, reason: "network" }; });
      }
      return Promise.resolve(BFW.checkIn(code));
    },
    undoCheckIn: function (id) {
      if (BACKEND) return rpc("undo_check_in", { p_id: id }).then(function (d) { return fromRow(d && d.reservation); }).catch(function () { return null; });
      return Promise.resolve(BFW.undoCheckIn(id));
    },
    cancel: function (id, name, phone) {
      if (BACKEND) {
        return rpc("cancel_reservation", { p_id: id, p_name: name || null, p_phone: phone || null })
          .then(function (d) { return !!(d && d.ok); }).catch(function () { return false; });
      }
      return Promise.resolve(BFW.cancelResv(id));
    },
    /* 명단 오타 수정 (스태프 전용) — 이름·연락처·이메일만 고친다.
       patch 에 담지 않은 항목은 그대로 둔다. email 에 "" 를 주면 지운다. */
    editReservation: function (id, patch) {
      var p = patch || {};
      if (BACKEND) {
        return rpc("reservation_edit", {
          p_id: id,
          p_name: p.name == null ? null : p.name,
          p_phone: p.phone == null ? null : p.phone,
          p_email: p.email == null ? null : p.email
        }).then(function (d) {
          if (d && d.ok) return { ok: true, entry: d };
          return { ok: false, reason: (d && d.reason) || "error" };
        }).catch(function () { return { ok: false, reason: "network" }; });
      }
      return Promise.resolve({ ok: false, reason: "offline" });
    },
    /* 명단 수정 이력 (스태프 전용) */
    editHistory: function (limit) {
      if (BACKEND) {
        return rpc("resv_edit_history", { p_limit: limit || 100 })
          .then(function (d) { return (d && d.ok && d.rows) || []; })
          .catch(function () { return []; });
      }
      return Promise.resolve([]);
    },

    /* ---- admin: list all (optionally one show) ---- */
    /* 내보내기용 : 사전등록·초청권·내빈(reserved) 에 더해 현장등록(entered)까지 담는다.
       화면 목록은 지금처럼 예약만 보여주고, 파일에만 네 갈래가 모두 들어간다. */
    listForExport: function () {
      if (!BACKEND) return Promise.resolve([]);
      return rest("/rest/v1/reservations?select=*&status=in.(reserved,entered)&order=created_at.desc")
        .then(function (rows) { return (rows || []).map(fromRow); })
        .catch(function () { return []; });
    },
    /* 초청권을 준 참여사 이름 (id → 이름). holder_list 에는 id 가 없어 현황판을 쓴다. */
    holderNames: function () {
      if (!BACKEND) return Promise.resolve({});
      return rpc("holds_board", {}).then(function (d) {
        var by = {};
        ((d && d.holders) || []).forEach(function (h) { if (h && h.id) by[h.id] = h.name; });
        return by;
      }).catch(function () { return {}; });
    },

    listReservations: function (showId) {
      if (BACKEND) {
        var q = "/rest/v1/reservations?select=*&status=eq.reserved&order=created_at.desc";
        if (showId) q += "&show_id=eq." + encodeURIComponent(showId);
        return rest(q).then(function (rows) { return (rows || []).map(fromRow); }).catch(function () { return []; });
      }
      var list = BFW.loadResv().filter(function (r) { return r.status !== "cancelled"; });
      if (showId) list = list.filter(function (r) { return r.showId === showId; });
      return Promise.resolve(list);
    },
    clearAll: function () {
      if (BACKEND) return rpc("admin_clear_reservations", {}).then(function () { return true; }).catch(function () { return false; });
      return Promise.resolve(BFW.saveResv([]));
    },

    /* ================= 현장 스탠드석 인원 ================= */
    walkinSet: function (showId, count, note) {
      if (BACKEND) {
        return rpc("walkin_set", { p_show_id: showId, p_count: count, p_note: note || null })
          .then(function (d) { return { ok: !!(d && d.ok), reason: d && d.reason }; })
          .catch(function () { return { ok: false, reason: "network" }; });
      }
      try {
        var m = JSON.parse(localStorage.getItem("bfw_walkins_v1") || "{}");
        m[showId] = { count: count, note: note || "" };
        localStorage.setItem("bfw_walkins_v1", JSON.stringify(m));
      } catch (e) {}
      return Promise.resolve({ ok: true });
    },
    /* 구분 집계 : 사전등록 · 브랜드 초청권 · 주최측 내빈 · 현장등록 */
    attendanceReport: function () {
      if (!BACKEND) return Promise.resolve({ ok: false, reason: "nobackend" });
      return rpc("attendance_report", {})
        .then(function (d) { return d || { ok: false }; })
        .catch(function () { return { ok: false, reason: "network" }; });
    },

    attendanceStats: function () {
      if (BACKEND) {
        return rpc("attendance_stats", {}).then(function (rows) { return rows || []; })
          .catch(function () { return []; });
      }
      var cfg = BFW.load(), list = BFW.loadResv(), wk = {};
      try { wk = JSON.parse(localStorage.getItem("bfw_walkins_v1") || "{}"); } catch (e) {}
      return Promise.resolve((cfg.shows || []).map(function (sh) {
        var mine = list.filter(function (r) { return r.showId === sh.id && r.status !== "cancelled"; });
        var ent = mine.filter(function (r) { return r.checkedIn; }).length;
        var w = (wk[sh.id] && wk[sh.id].count) || 0;
        return { show_id: sh.id, title_ko: sh.titleKo || sh.title, day: sh.day,
                 reserved: mine.length, entered: ent, walkin: w, total: ent + w,
                 note: (wk[sh.id] && wk[sh.id].note) || null };
      }));
    },

    /* ================= MEMBERS (간편 회원) ================= */
    memberCurrent: function () { return BFW.getSession(); },
    memberSignUp: function (m) {
      if (BACKEND) {
        return rpc("member_sign_up", { p_name: m.name, p_phone: m.phone, p_email: m.email || null, p_password: m.password })
          .then(function (d) {
            if (d && d.ok) { BFW.setSession(d.member); return { ok: true, member: d.member }; }
            return { ok: false, reason: (d && d.reason) || "error" };
          }).catch(function () { return { ok: false, reason: "network" }; });
      }
      return sha256(m.password).then(function (h) {
        var res = BFW.addMember({ name: m.name, phone: m.phone, email: m.email || "", passHash: h });
        if (!res.ok) return res;
        var s = { id: res.member.id, name: m.name, phone: m.phone, email: m.email || "" };
        BFW.setSession(s);
        return { ok: true, member: s };
      });
    },
    memberSignIn: function (phone, password) {
      if (BACKEND) {
        return rpc("member_sign_in", { p_phone: phone, p_password: password }).then(function (d) {
          if (d && d.ok) { BFW.setSession(d.member); return { ok: true, member: d.member }; }
          return { ok: false, reason: (d && d.reason) || "badcred" };
        }).catch(function () { return { ok: false, reason: "network" }; });
      }
      var m = BFW.findMemberByPhone(phone);
      if (!m) return Promise.resolve({ ok: false, reason: "nomember" });
      return sha256(password).then(function (h) {
        if (h !== m.passHash) return { ok: false, reason: "badcred" };
        var s = { id: m.id, name: m.name, phone: m.phone, email: m.email || "" };
        BFW.setSession(s);
        return { ok: true, member: s };
      });
    },
    memberSignOut: function () { BFW.clearSession(); return Promise.resolve(true); },

    /* ================= PRESS VISIT ================= */
    pressApply: function (e) {
      if (BACKEND) {
        return rpc("press_apply", { p_media: e.media, p_reporter: e.reporter, p_phone: e.phone, p_email: e.email || null, p_types: e.types, p_days: e.days, p_note: e.note || null })
          .then(function (d) {
            if (d && d.ok) return { ok: true, entry: fromPressRow(d.application) };
            return { ok: false, reason: (d && d.reason) || "error" };
          }).catch(function () { return { ok: false, reason: "network" }; });
      }
      return Promise.resolve(BFW.addPressApp({ media: e.media, reporter: e.reporter, phone: e.phone, email: e.email || "", types: e.types, days: e.days, note: e.note || "" }));
    },
    pressLookup: function (phone, reporter) {
      if (BACKEND) {
        return rpc("press_lookup", { p_phone: phone, p_reporter: reporter })
          .then(function (rows) { return (rows || []).map(fromPressRow); }).catch(function () { return []; });
      }
      var nk = String(reporter || "").replace(/\s/g, "").toLowerCase();
      return Promise.resolve(BFW.findPressByPhone(phone).filter(function (p) {
        return String(p.reporter || "").replace(/\s/g, "").toLowerCase() === nk;
      }));
    },
    pressList: function () {
      if (BACKEND) return rest("/rest/v1/press_applications?select=*&order=created_at.desc").then(function (rows) { return (rows || []).map(fromPressRow); }).catch(function () { return []; });
      return Promise.resolve(BFW.loadPress());
    },
    /* 오픈 여부는 서버가 진짜다. 화면 설정만으로는 열지 않는다. */
    reservationsOpen: function () {
      if (!BACKEND) return Promise.resolve(true);
      return rpc("reservations_open", {}).then(function (d) { return d === true; }).catch(function () { return false; });
    },
    pressOpen: function () {
      if (!BACKEND) return Promise.resolve(true);
      return rpc("press_open", {}).then(function (d) { return d === true; }).catch(function () { return false; });
    },
    pressSetStatus: function (id, status) {
      if (BACKEND) return rpc("press_set_status", { p_id: id, p_status: status }).then(function (d) { return fromPressRow(d && d.application); }).catch(function () { return null; });
      return Promise.resolve(BFW.setPressStatus(id, status));
    },
    pressFindByCode: function (code) {
      if (BACKEND) return rpc("press_find", { p_code: BFW.normCode(code) }).then(function (rows) { return rows && rows[0] ? fromPressRow(rows[0]) : null; }).catch(function () { return null; });
      return Promise.resolve(BFW.findPressByCode(code));
    },
    pressCheckIn: function (code) {
      if (BACKEND) {
        return rpc("press_check_in", { p_code: BFW.normCode(code) }).then(function (d) {
          if (d && d.ok) return { ok: true, entry: fromPressRow(d.application) };
          return { ok: false, reason: (d && d.reason) || "error", entry: d && d.application ? fromPressRow(d.application) : null };
        }).catch(function () { return { ok: false, reason: "network" }; });
      }
      return Promise.resolve(BFW.pressCheckIn(code));
    },
    pressUndoCheckIn: function (id) {
      if (BACKEND) return rpc("press_undo_check_in", { p_id: id }).then(function (d) { return fromPressRow(d && d.application); }).catch(function () { return null; });
      return Promise.resolve(BFW.undoPressCheckIn(id));
    },
    pressDelete: function (id) {
      if (BACKEND) return rest("/rest/v1/press_applications?id=eq." + encodeURIComponent(id), { method: "DELETE" }).then(function () { return true; }).catch(function () { return false; });
      return Promise.resolve(BFW.deletePressApp(id));
    }
  };

  global.BFWApi = Api;
})(window);
