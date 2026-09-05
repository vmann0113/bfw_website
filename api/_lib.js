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

async function sendSms(to, msg) {
  const d = await postForm("https://apis.aligo.in/send/", {
    key: ALIGO.key,
    user_id: ALIGO.userId,
    sender: ALIGO.sender,
    receiver: to,
    msg: msg.sms,
    title: msg.title,
    msg_type: "LMS",
    testmode_yn: ALIGO.testmode
  });
  const ok = String(d.result_code) === "1";
  return { ok, channel: "sms", detail: ok ? `msgid=${d.msg_id || ""}` : `${d.result_code} ${d.message || ""}` };
}

async function sendAlimtalk(kind, to, name, msg) {
  const tok = await postForm("https://kakaoapi.aligo.in/akv10/token/create/30/s/", {
    apikey: ALIGO.key,
    userid: ALIGO.userId
  });
  if (String(tok.code) !== "0" || !tok.token) {
    return { ok: false, channel: "alimtalk", detail: `token ${tok.code} ${tok.message || ""}` };
  }
  const d = await postForm("https://kakaoapi.aligo.in/akv10/alimtalk/send/", {
    apikey: ALIGO.key,
    userid: ALIGO.userId,
    token: tok.token,
    senderkey: ALIGO.senderKey,
    tpl_code: ALIGO.tpl[kind],
    sender: ALIGO.sender,
    receiver_1: to,
    recvname_1: name,
    subject_1: msg.title,
    message_1: msg.text,
    // 버튼 링크에 예약번호가 들어가므로 실제 주소를 함께 넘긴다
    button_1: JSON.stringify({
      button: [{
        name: msg.button.name,
        linkType: "WL",
        linkTypeName: "웹링크",
        linkMo: msg.button.mo,
        linkPc: msg.button.pc || msg.button.mo
      }]
    }),
    // 알림톡이 실패하면 문자로 대신 보낸다.
    // 문자에는 버튼이 없으므로 링크가 본문에 들어간 sms 를 쓴다.
    failover: "Y",
    fsubject_1: msg.title,
    fmessage_1: msg.sms,
    testMode: ALIGO.testmode
  });
  const ok = String(d.code) === "0";
  return { ok, channel: "alimtalk", detail: ok ? `msgid=${d.info && d.info.mid ? d.info.mid : ""}` : `${d.code} ${d.message || ""}` };
}

/* 알림톡이 준비돼 있으면 알림톡, 아니면 문자. 둘 다 없으면 미리보기(발송 안 함) */
async function deliver(kind, to, name, msg) {
  if (hasAlimtalk(kind)) return sendAlimtalk(kind, to, name, msg);
  if (hasSms()) return sendSms(to, msg);
  return { ok: true, channel: "dryrun", detail: "발송 설정이 없어 미리보기만 했습니다" };
}

module.exports = {
  json, digits, sb, findByCodes, alreadySent, logNoti,
  buildMessage, deliver, hasSms, hasAlimtalk, ALIGO, SITE
};
