/* ===========================================================
   예약 완료 · 취소 안내 발송
   홈페이지가 예약/취소 직후 이 주소를 부른다.

   POST /api/notify
     { codes: ["BFW-S01-ABC123", ...], phone: "010-...", event: "reserved" }

   보내는 사람을 홈페이지가 정하지 않는다. 예약번호와 연락처가 서로
   맞는지 서버가 확인한 뒤, 그 예약에 적힌 번호로만 보낸다.
   그래서 남의 번호로 문자를 보내게 만들 수 없다.
   =========================================================== */
const L = require("./_lib");

module.exports = async (req, res) => {
  // GET : 발송하지 않고 설정 상태만 알려준다 (값은 내보내지 않음)
  if (req.method === "GET") {
    // ?ip=1 : 이 함수가 바깥으로 나갈 때 쓰는 IP. 알리고 IP 등록에 필요해서 잰다.
    if (req.url && req.url.indexOf("ip=1") >= 0) {
      try {
        const r = await fetch("https://api.ipify.org?format=json");
        const d = await r.json();
        return L.json(res, 200, { ok: true, outboundIp: d.ip, region: process.env.VERCEL_REGION || null });
      } catch (e) {
        return L.json(res, 200, { ok: false, error: String(e && e.message) });
      }
    }
    // ?relay=1 : 중계가 살아 있는지. 조용히 죽는 게 가장 위험해서 확인 수단을 둔다.
    if (req.url && req.url.indexOf("relay=1") >= 0) {
      const u = L.ALIGO.relayUrl;
      if (!u) return L.json(res, 200, { ok: false, relay: "미설정" });
      try {
        const r = await fetch(u + (u.indexOf("?") >= 0 ? "&" : "?") + "ip=1");
        const t = await r.text();
        let d = null;
        try { d = JSON.parse(t); } catch (e) { d = { raw: t.slice(0, 200) }; }
        return L.json(res, 200, { ok: r.ok, status: r.status, relay: d,
          note: "relay.outboundIp 를 알리고 발송 서버 IP 에 등록해야 합니다" });
      } catch (e) {
        return L.json(res, 200, { ok: false, relay: "응답 없음", detail: String(e && e.message) });
      }
    }
    return L.json(res, 200, { ok: true, health: L.health() });
  }
  if (req.method !== "POST") return L.json(res, 405, { ok: false, error: "POST only" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const kind = body.event === "cancelled" ? "cancelled" : "reserved";
  // test:true → 모의 발송, test:false → 실제 발송, 없으면 환경변수를 따른다
  const opts = typeof body.test === "boolean" ? { test: body.test } : undefined;
  const phoneKey = L.digits(body.phone);
  let codes = body.codes || (body.code ? [body.code] : []);
  if (!Array.isArray(codes)) codes = [codes];
  codes = codes.map((c) => String(c || "").trim()).filter(Boolean).slice(0, 10);

  if (!codes.length || phoneKey.length < 9) {
    return L.json(res, 400, { ok: false, error: "codes/phone required" });
  }

  let rows;
  try {
    rows = await L.findByCodes(codes.map((c) => c.replace(/^BFW-?/i, "")));
  } catch (e) {
    // 원인을 감추면 고칠 수가 없다. 키 값은 담지 않고 사유만 돌려준다.
    return L.json(res, 500, {
      ok: false, error: "lookup failed",
      status: e && e.status, detail: (e && e.data) || String(e && e.message)
    });
  }

  // 예약번호와 연락처가 맞는 건만 남긴다
  const mine = (rows || []).filter((r) => L.digits(r.phone) === phoneKey);
  if (!mine.length) return L.json(res, 404, { ok: false, error: "not found" });

  const out = [];
  for (const r of mine) {
    try {
      if (await L.alreadySent(r.id, kind)) {
        out.push({ code: r.code, status: "skipped", detail: "이미 보냄" });
        continue;
      }
      const msg = L.buildMessage(kind, r);
      const sent = await L.deliver(kind, L.digits(r.phone), r.name || "", msg, opts);
      // 모의 발송을 'sent' 로 남기면, 같은 예약의 실제 발송이 "이미 보냄"으로
      // 건너뛰어진다(notifications 고유 인덱스). 그래서 'test' 로 남긴다.
      await L.logNoti({
        reservation_id: r.id, code: r.code, kind,
        channel: sent.channel, to_phone: r.phone,
        status: sent.ok ? (sent.test ? "test" : "sent") : "failed",
        detail: sent.detail || null
      });
      out.push({
        code: r.code,
        status: sent.ok ? (sent.test ? "test" : "sent") : "failed",
        channel: sent.channel,
        detail: sent.detail,
        // 발송 설정이 없을 때는 어떤 내용이 나갈지 미리 보여준다
        preview: sent.channel === "dryrun" ? msg.sms : undefined
      });
    } catch (e) {
      out.push({ code: r.code, status: "failed", detail: String(e && e.message) });
    }
  }

  return L.json(res, 200, { ok: true, mode: L.mode(), results: out });
};
