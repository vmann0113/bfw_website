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
  var staffToken = null; // Supabase Auth JWT for staff (check-in / admin)

  /* ---------- small REST helpers ---------- */
  function rest(path, opts) {
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
        if (!res.ok) throw Object.assign(new Error("api"), { status: res.status, data: data });
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
      status: r.status, checkedIn: r.checked_in, checkedInAt: r.checked_in_at, at: r.created_at
    };
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
        if (d.access_token) { staffToken = d.access_token; return { ok: true }; }
        return { ok: false, error: d.error_description || d.msg || "로그인 실패" };
      });
    },
    setStaffToken: function (t) { staffToken = t; },
    hasStaff: function () { return !BACKEND || !!staffToken; },

    /* ---- availability: { showId: {capacity, reserved, remaining} } ---- */
    availability: function () {
      if (BACKEND) {
        return rest("/rest/v1/show_availability?select=*").then(function (rows) {
          var map = {};
          (rows || []).forEach(function (r) {
            map[r.id] = { capacity: r.capacity, reserved: r.reserved, remaining: r.remaining };
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
        return rpc("reserve_seat", {
          p_show_id: show.showId, p_name: show.name, p_phone: show.phone,
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

    /* ---- lookup my reservations by phone ---- */
    lookupByPhone: function (phone) {
      if (BACKEND) {
        return rpc("lookup_reservations", { p_phone: phone })
          .then(function (rows) { return (rows || []).map(fromRow); })
          .catch(function () { return []; });
      }
      return Promise.resolve(BFW.findByPhone(phone));
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
    cancel: function (id) {
      if (BACKEND) return rpc("cancel_reservation", { p_id: id }).then(function () { return true; }).catch(function () { return false; });
      return Promise.resolve(BFW.cancelResv(id));
    },

    /* ---- admin: list all (optionally one show) ---- */
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
    }
  };

  global.BFWApi = Api;
})(window);
