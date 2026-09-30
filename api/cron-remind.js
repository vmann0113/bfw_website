/* ===========================================================
   전날 관람 안내 (알림톡 UL_0999)

   하루에 한 번 자동 실행되어, 내일 패션쇼를 예약한 분들에게
   안내를 보낸다. vercel.json 의 crons 에 등록돼 있다.

     GET /api/cron-remind          자동 실행(Vercel)이 부르는 주소
     GET /api/cron-remind?dry=1    보내지 않고 대상 건수만 확인
     GET /api/cron-remind?date=2026.10.30   날짜를 직접 지정

   같은 예약에 두 번 나가지 않는다 — 이미 'sent' 이력이 있는 건은
   제외하고, 데이터베이스에도 (예약, 종류) 고유 인덱스가 걸려 있다.
   그래서 실행이 겹치거나 중간에 끊겨도 다시 부르면 이어서 보낸다.
   =========================================================== */
const L = require("./_lib");

/* 한국 시간 기준 '내일' 을 'YYYY.MM.DD' 로. shows/reservations 의
   date 컬럼이 이 형식의 문자열이다. */
function kstTomorrow() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  kst.setUTCDate(kst.getUTCDate() + 1);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return y + "." + m + "." + d;
}

function qs(url, key) {
  const m = new RegExp("[?&]" + key + "=([^&]*)").exec(url || "");
  return m ? decodeURIComponent(m[1]) : null;
}

module.exports = async (req, res) => {
  const url = req.url || "";
  const dry = qs(url, "dry") === "1";

  /* 이 주소는 바깥에서도 부를 수 있으므로 열어두지 않는다.
     CRON_SECRET 을 넣어두면 Vercel 자동 실행이 그 값을 함께 보낸다.
     건수만 보는 dry 조회는 개인정보가 없어 열어둔다. */
  const secret = process.env.CRON_SECRET || "";
  if (!dry && secret) {
    const auth = req.headers["authorization"] || "";
    if (auth !== "Bearer " + secret) {
      return L.json(res, 401, { ok: false, error: "unauthorized" });
    }
  }

  const date = qs(url, "date") || kstTomorrow();

  let targets;
  try {
    targets = await L.reminderTargets(date);
  } catch (e) {
    return L.json(res, 500, {
      ok: false, error: "lookup failed",
      status: e && e.status, detail: (e && e.data) || String(e && e.message)
    });
  }

  if (dry) {
    return L.json(res, 200, {
      ok: true, date: date, mode: L.mode(),
      count: targets.length,
      shows: targets.reduce(function (acc, r) {
        acc[r.show_id] = (acc[r.show_id] || 0) + 1;
        return acc;
      }, {}),
      note: secret ? "보안키 설정됨" : "CRON_SECRET 미설정 — 설정을 권합니다"
    });
  }

  if (!targets.length) {
    return L.json(res, 200, { ok: true, date: date, count: 0, note: "보낼 대상이 없습니다" });
  }

  const items = targets.map(function (r) {
    return { to: L.digits(r.phone), name: r.name || "", msg: L.buildMessage("reminder", r), row: r };
  });

  let batches;
  try {
    batches = await L.deliverBulk("reminder", items);
  } catch (e) {
    return L.json(res, 500, { ok: false, error: "send failed", detail: String(e && e.message) });
  }

  /* 이력은 한 번에 기록한다. 묶음 단위 결과라 같은 묶음의 건은 같은 상태가 된다. */
  const logs = [];
  const summary = [];
  batches.forEach(function (b) {
    const st = b.result.ok ? (b.result.test ? "test" : "sent") : "failed";
    summary.push({ count: b.items.length, status: st, channel: b.result.channel, detail: b.result.detail });
    b.items.forEach(function (it) {
      logs.push({
        reservation_id: it.row.id, code: it.row.code, kind: "reminder",
        channel: b.result.channel, to_phone: it.row.phone,
        status: st, detail: b.result.detail || null
      });
    });
  });
  await L.logNotiMany(logs);

  return L.json(res, 200, {
    ok: true, date: date, mode: L.mode(),
    count: targets.length, batches: summary
  });
};
