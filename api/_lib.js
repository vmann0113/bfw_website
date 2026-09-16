/* ===========================================================
   부산패션위크 — 알림 발송 공용 모듈 (서버 전용)
   이 파일은 Vercel 서버에서만 실행됩니다. 브라우저로 내려가지 않으므로
   여기서 읽는 키들은 관람객에게 노출되지 않습니다.

   필요한 환경변수 (Vercel → Settings → Environment Variables)
     SUPABASE_URL                예: https://xxxx.supabase.co
     SUPABASE_SERVICE_ROLE_KEY   Supabase 대시보드의 service_role 키 (절대 공개 금지)
     ALIGO_KEY                   알리고 API 키
     ALIGO_USER_ID               알리고 아이디
     ALIGO_SENDER                등록된 발신번호 (예: 0517446321)
   알림톡을 켤 때 추가
     ALIGO_SENDER_KEY            카카오 발신프로필 키
     ALIGO_TPL_RESERVED          예약완료 템플릿 코드
     ALIGO_TPL_REMINDER          전날 안내 템플릿 코드
     ALIGO_TPL_CANCELLED         취소 템플릿 코드
   선택
     ALIGO_TESTMODE=Y            실제 발송 없이 성공 응답만 받음 (요금 0원)
     SITE_URL                    안내 문자에 넣을 주소
     CRON_SECRET                 전날 안내 자동발송 보호용 임의 문자열
   =========================================================== */

const SB_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SITE = (process.env.SITE_URL || "https://www.busanfashionweek.com").replace(/\/$/, "");

const ALIGO = {
  key: process.env.ALIGO_KEY || "",
  userId: process.env.ALIGO_USER_ID || "",
  sender: process.env.ALIGO_SENDER || "",
  senderKey: process.env.ALIGO_SENDER_KEY || "",
  tpl: {
    reserved: process.env.ALIGO_TPL_RESERVED || "",
    reminder: process.env.ALIGO_TPL_REMINDER || "",
    cancelled: process.env.ALIGO_TPL_CANCELLED || ""
  },
  testmode: process.env.ALIGO_TESTMODE === "Y" ? "Y" : "N"
};

const hasSms = () => !!(ALIGO.key && ALIGO.userId && ALIGO.sender);
const hasAlimtalk = (kind) => !!(hasSms() && ALIGO.senderKey && ALIGO.tpl[kind]);

const digits = (v) => String(v == null ? "" : v).replace(/[^0-9]/g, "");

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

/* ---------- Supabase (서버 키로 접근) ---------- */
async function sb(path, opts = {}) {
  if (!SB_URL || !SB_KEY) throw new Error("supabase-env-missing");
  const r = await fetch(SB_URL + path, {
    method: opts.method || "GET",
    headers: Object.assign(
      {
        apikey: SB_KEY,
        Authorization: "Bearer " + SB_KEY,
        "Content-Type": "application/json"
      },
      opts.headers || {}
    ),
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const t = await r.text();
  const data = t ? JSON.parse(t) : null;
  if (!r.ok) throw Object.assign(new Error("supabase"), { status: r.status, data });
  return data;
}

const RESV_COLS =
  "id,code,show_id,title_ko,show_title,lineup,day,date,start_time,end_time,venue," +
  "name,phone,phone_key,seat_label,status,source";

async function findByCodes(codes) {
  const list = codes.map((c) => `"${String(c).replace(/[^A-Za-z0-9-]/g, "")}"`).join(",");
  return sb(`/rest/v1/reservations?select=${RESV_COLS}&code=in.(${list})`);
}

async function alreadySent(reservationId, kind) {
  const rows = await sb(
    `/rest/v1/notifications?select=id&reservation_id=eq.${reservationId}&kind=eq.${kind}&status=eq.sent&limit=1`
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function logNoti(entry) {
  try {
    await sb("/rest/v1/notifications", { method: "POST", body: entry });
  } catch (e) {
    /* 이력 기록 실패가 발송 자체를 막지는 않는다 */
  }
}

/* 여러 건을 한 번에 기록한다. 1500건을 한 건씩 넣으면 시간이 모자란다. */
async function logNotiMany(entries) {
  if (!entries || !entries.length) return;
  for (let i = 0; i < entries.length; i += 500) {
    try {
      await sb("/rest/v1/notifications", { method: "POST", body: entries.slice(i, i + 500) });
    } catch (e) {
      /* 같은 예약에 이미 'sent' 가 있으면 고유 인덱스가 막는다 — 정상 동작 */
    }
  }
}

/* 1000건씩 끊어서 전부 가져온다 (PostgREST 기본 상한을 넘기지 않기 위해) */
async function sbAll(path) {
  const out = [];
  const step = 1000;
  for (let from = 0; ; from += step) {
    const sep = path.indexOf("?") >= 0 ? "&" : "?";
    const rows = await sb(path + sep + "limit=" + step + "&offset=" + from);
    if (!Array.isArray(rows) || !rows.length) break;
    out.push.apply(out, rows);
    if (rows.length < step) break;
  }
  return out;
}

/* 전날 안내를 보내야 할 예약. 이미 보낸 건은 뺀다. */
async function reminderTargets(dateStr) {
  const rows = await sbAll(
    "/rest/v1/reservations?select=" + RESV_COLS +
    "&date=eq." + encodeURIComponent(dateStr) + "&status=eq.reserved&order=created_at"
  );
  const done = await sbAll(
    "/rest/v1/notifications?select=reservation_id&kind=eq.reminder&status=eq.sent"
  );
  const skip = {};
  done.forEach(function (d) { if (d.reservation_id) skip[d.reservation_id] = true; });
  return rows.filter(function (r) { return !skip[r.id]; });
}

/* ---------- 문구 만들기 ----------
   알림톡은 "승인된 템플릿과 한 글자라도 다르면" 발송이 거부된다.
   그래서 아래 tmplText() 는 등록한 템플릿의 고정 문구를 그대로 두고
   #{변수} 자리만 채운다. 템플릿을 고치면 여기도 같이 고쳐야 한다.

   대체문자(문자로 대신 나가는 경우)에는 버튼이 없으므로
   본문 끝에 링크를 글자로 붙인다. 이게 없으면 카톡을 못 받는 분은
   입장권을 열 방법이 없다.
   ---------------------------------------------------------------- */
const DOW = ["일", "월", "화", "수", "목", "금", "토"];

function whenLine(r) {
  // '2026.10.29' → '10.29(목) 11:00'
  const md = String(r.date || "").split(".").slice(1).join(".");
  let dow = "";
  try {
    const d = new Date(String(r.date || "").replace(/\./g, "-"));
    if (!isNaN(d)) dow = DOW[d.getDay()];
  } catch (e) {}
  return `${md}${dow ? "(" + dow + ")" : ""} ${r.start_time || ""}`;
}

// "연합쇼 ④" 만으로는 어떤 쇼인지 알 수 없으므로 참여 브랜드를 괄호로 덧붙인다
function showName(r) {
  const t = r.title_ko || r.show_title || "";
  return r.lineup ? `${t} (${r.lineup})` : t;
}
function seatText(r) { return r.seat_label || "자유석 · 선착순 착석"; }
function ticketUrl(r) { return `${SITE}/ticket.html?c=BFW-${r.code}`; }
function registerUrl() { return `${SITE}/register.html`; }

/* 승인 템플릿과 동일한 본문 (변수만 치환) */
function tmplText(kind, r) {
  const 이름 = r.name || "";
  const 공연 = showName(r);
  const 일시 = whenLine(r);
  const 좌석 = seatText(r);
  const 예약번호 = "BFW-" + r.code;

  if (kind === "reserved") {
    return (
      `[2026 부산패션위크] 관람 예약이 완료되었습니다.\n\n` +
      `${이름}님, 예약 내용을 확인해 주세요.\n\n` +
      `▶ 공연 : ${공연}\n` +
      `▶ 일시 : ${일시}\n` +
      `▶ 좌석 : ${좌석}\n` +
      `▶ 예약번호 : ${예약번호}\n\n` +
      `· 장소 : 벡스코 제1전시장 3B홀\n` +
      `· 시작 20분 전까지 입장대기해 주세요\n` +
      `· 입구에서 모바일 입장권 화면을 제시해 주세요\n` +
      `· 예약 취소는 홈페이지에서 하실 수 있습니다`
    );
  }
  if (kind === "reminder") {
    return (
      `[2026 부산패션위크] 내일 관람 예정입니다.\n\n` +
      `${이름}님, 내일 뵙겠습니다.\n\n` +
      `▶ 공연 : ${공연}\n` +
      `▶ 일시 : ${일시}\n` +
      `▶ 좌석 : ${좌석}\n` +
      `▶ 예약번호 : ${예약번호}\n\n` +
      `· 장소 : 벡스코 제1전시장 3B홀\n` +
      `· 시작 20분 전까지 입장대기해 주세요\n` +
      `· 사정이 생기시면 홈페이지에서 취소해 주세요.\n` +
      `  다른 분이 관람하실 수 있습니다`
    );
  }
  return (
    `[2026 부산패션위크] 관람 예약이 취소되었습니다.\n\n` +
    `${이름}님\n\n` +
    `▶ 공연 : ${공연}\n` +
    `▶ 일시 : ${일시}\n` +
    `▶ 예약번호 : ${예약번호}\n\n` +
    `다시 예약하시려면 홈페이지를 이용해 주세요.`
  );
}

const TITLES = {
  reserved: "[부산패션위크] 관람 예약 완료",
  reminder: "[부산패션위크] 내일 관람 안내",
  cancelled: "[부산패션위크] 관람 예약 취소"
};

function buildMessage(kind, r) {
  const body = tmplText(kind, r);
  const isCancel = kind === "cancelled";
  const link = isCancel ? registerUrl() : ticketUrl(r);
  const label = isCancel ? "예약 페이지" : "모바일 입장권 보기";
  return {
    title: TITLES[kind] || TITLES.reserved,
    // 알림톡 본문 : 승인 템플릿과 동일해야 한다 (링크는 버튼이 담당)
    text: body,
    // 문자 / 대체문자 : 버튼이 없으므로 링크를 글자로 붙인다
    sms: `${body}\n\n▶ ${label}\n${link}`,
    button: { name: label, mo: link, pc: isCancel ? link : "" }
  };
}

/* ---------- 알리고 발송 ---------- */
async function postForm(url, params) {
  const body = new URLSearchParams();
  Object.keys(params).forEach((k) => {
    if (params[k] !== undefined && params[k] !== null && params[k] !== "") body.append(k, params[k]);
  });
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
    body
  });
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch (e) {
    return { result_code: -99, message: t.slice(0, 200) };
  }
}

/* 요청이 테스트/실제를 지정했으면 그걸 따르고, 없으면 환경변수를 따른다.
   환경변수를 고치려면 재배포가 필요해서, 요청 단위로 고를 수 있게 해 둔다. */
function resolveTest(opts) {
  if (opts && typeof opts.test === "boolean") return opts.test ? "Y" : "N";
  return ALIGO.testmode;
}

async function sendSms(to, msg, tmode) {
  const d = await postForm("https://apis.aligo.in/send/", {
    key: ALIGO.key,
    user_id: ALIGO.userId,
    sender: ALIGO.sender,
    receiver: to,
    msg: msg.sms,
    title: msg.title,
    msg_type: "LMS",
    testmode_yn: tmode || "N"
  });
  const ok = String(d.result_code) === "1";
  return {
    ok, channel: "sms", test: (tmode || "N") === "Y",
    detail: ok ? `msgid=${d.msg_id || ""}` : `${d.result_code} ${d.message || ""}`
  };
}

async function aligoToken() {
  const tok = await postForm("https://kakaoapi.aligo.in/akv10/token/create/30/s/", {
    apikey: ALIGO.key,
    userid: ALIGO.userId
  });
  if (String(tok.code) !== "0" || !tok.token) {
    throw Object.assign(new Error("token"), { detail: `token ${tok.code} ${tok.message || ""}` });
  }
  return tok.token;
}

/* 알림톡 다건 발송. 알리고는 한 번에 최대 500명까지 받는다.
   items : [{ to, name, msg }]  — msg 는 buildMessage() 결과
   응답은 건별이 아니라 묶음 단위(성공/실패 건수)로만 온다. */
const ALIMTALK_BATCH = 500;

async function sendAlimtalkBulk(kind, items, tmode) {
  let token;
  try {
    token = await aligoToken();
  } catch (e) {
    return { ok: false, channel: "alimtalk", detail: e.detail || String(e && e.message) };
  }
  const p = {
    apikey: ALIGO.key,
    userid: ALIGO.userId,
    token: token,
    senderkey: ALIGO.senderKey,
    tpl_code: ALIGO.tpl[kind],
    sender: ALIGO.sender,
    // 알림톡이 막히면 문자로 대신 보낸다. 문자에는 버튼이 없으므로
    // 링크가 본문에 들어간 sms 를 쓴다.
    failover: "Y",
    testMode: tmode || "N"
  };
  items.forEach(function (it, i) {
    const n = i + 1;
    p["receiver_" + n] = it.to;
    p["recvname_" + n] = it.name || "";
    p["subject_" + n] = it.msg.title;
    p["message_" + n] = it.msg.text;
    p["button_" + n] = JSON.stringify({
      button: [{
        name: it.msg.button.name,
        linkType: "WL",
        linkTypeName: "웹링크",
        linkMo: it.msg.button.mo,
        linkPc: it.msg.button.pc || it.msg.button.mo
      }]
    });
    p["fsubject_" + n] = it.msg.title;
    p["fmessage_" + n] = it.msg.sms;
  });
  const d = await postForm("https://kakaoapi.aligo.in/akv10/alimtalk/send/", p);
  const ok = String(d.code) === "0";
  const info = d.info || {};
  return {
    ok,
    channel: "alimtalk",
    test: (tmode || "N") === "Y",
    detail: ok
      ? `mid=${info.mid || ""} 성공${info.scnt != null ? info.scnt : items.length}/실패${info.fcnt != null ? info.fcnt : 0}`
      : `${d.code} ${d.message || ""}`
  };
}

async function sendAlimtalk(kind, to, name, msg, tmode) {
  return sendAlimtalkBulk(kind, [{ to: to, name: name, msg: msg }], tmode);
}

/* 알림톡이 준비돼 있으면 알림톡, 아니면 문자. 둘 다 없으면 미리보기(발송 안 함) */
async function deliver(kind, to, name, msg, opts) {
  const tmode = resolveTest(opts);
  if (hasAlimtalk(kind)) return sendAlimtalk(kind, to, name, msg, tmode);
  if (hasSms()) return sendSms(to, msg, tmode);
  return { ok: true, channel: "dryrun", test: true, detail: "발송 설정이 없어 미리보기만 했습니다" };
}

/* 다건 발송. 500명씩 끊어서 보낸다. 반환값은 묶음별 결과 배열. */
async function deliverBulk(kind, items, opts) {
  const tmode = resolveTest(opts);
  const out = [];
  for (let i = 0; i < items.length; i += ALIMTALK_BATCH) {
    const chunk = items.slice(i, i + ALIMTALK_BATCH);
    let r;
    if (hasAlimtalk(kind)) r = await sendAlimtalkBulk(kind, chunk, tmode);
    else if (hasSms()) {
      // 문자 API 는 다건 형식이 달라, 여기서는 한 건씩 보낸다
      const each = [];
      for (const it of chunk) each.push(await sendSms(it.to, it.msg, tmode));
      r = {
        ok: each.every(function (x) { return x.ok; }),
        channel: "sms", test: tmode === "Y",
        detail: `성공${each.filter(function (x) { return x.ok; }).length}/${each.length}`
      };
    } else r = { ok: true, channel: "dryrun", test: true, detail: "발송 설정이 없어 미리보기만 했습니다" };
    out.push({ result: r, items: chunk });
  }
  return out;
}

/* 지금 어떤 경로로 나가는지 알려준다 — 점검용.
   alimtalk : 알림톡으로 나감 (실패하면 문자로 자동 대체)
   sms      : 알림톡 설정이 없어 문자로만 나감
   dryrun   : 발송 설정이 아예 없어 미리보기만 하고 실제로는 안 나감 */
function mode() {
  var kinds = ["reserved", "reminder", "cancelled"];
  var ready = kinds.filter(function (k) { return hasAlimtalk(k); });
  if (ready.length === kinds.length) return "alimtalk";
  if (ready.length) return "alimtalk(" + ready.join(",") + ")+sms";
  if (hasSms()) return "sms";
  return "dryrun";
}

/* 설정이 어디까지 채워졌는지 — 값은 절대 내보내지 않고 채워졌는지만 */
function health() {
  return {
    mode: mode(),
    aligo: { key: !!ALIGO.key, userId: !!ALIGO.userId, sender: !!ALIGO.sender, senderKey: !!ALIGO.senderKey },
    templates: { reserved: !!ALIGO.tpl.reserved, reminder: !!ALIGO.tpl.reminder, cancelled: !!ALIGO.tpl.cancelled },
    // 주소는 비밀이 아니라 그대로, 키는 길이만 (오타·줄바꿈 섞임을 잡기 위해)
    supabase: { url: SB_URL || null, serviceKeyLen: SB_KEY.length, serviceKeyLooksJwt: SB_KEY.split(".").length === 3 },
    site: SITE,
    testmode: ALIGO.testmode === "Y"
  };
}

module.exports = {
  json, digits, sb, sbAll, findByCodes, alreadySent, logNoti, logNotiMany,
  reminderTargets, buildMessage, deliver, deliverBulk,
  hasSms, hasAlimtalk, mode, health, resolveTest, ALIGO, SITE
};
