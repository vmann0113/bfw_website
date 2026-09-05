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
