/* ===========================================================
   관람 예약 자동 오픈

   정해진 시각(한국시간)이 되면 서버 스위치
   app_settings.reservations_open 을 스스로 켠다.
   사람이 그 시각에 자리에 없어도 열리게 하려는 장치다.

   누가 부르나
     · /api/cron-open    매일 한국시간 14:00 (vercel.json 의 crons)
     · /api/cron-remind  매일 한국시간 10:00 — 혹시 위가 실패했을 때의 예비

   안전장치
     · OPEN_AT 보다 이른 시각에는 어떤 경우에도 켜지 않는다
     · 이미 켜져 있으면 아무것도 하지 않는다 (몇 번 돌아도 결과가 같다)
     · 비교는 한국시간 'YYYY-MM-DD HH:MM' 문자열로만 한다
   끄려면 OPEN_AT 을 빈 문자열로 둔다.

   날짜·시각을 바꾸면 js/popup.js 의 openFrom 과
   js/reserve.js 의 안내 문구도 함께 고쳐야 한다.
   =========================================================== */
const L = require("./_lib");

const OPEN_AT = "2026-10-06 14:00";

/* 한국시간 현재를 'YYYY-MM-DD HH:MM' 으로 */
function kstNow() {
  const k = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return k.getUTCFullYear() + "-" + p(k.getUTCMonth() + 1) + "-" + p(k.getUTCDate()) +
    " " + p(k.getUTCHours()) + ":" + p(k.getUTCMinutes());
}

async function maybeOpen(dry) {
  const now = kstNow();
  if (!OPEN_AT) return { acted: false, why: "자동 오픈 꺼짐", now: now };
  if (now < OPEN_AT) return { acted: false, why: "오픈 시각 전", now: now, openAt: OPEN_AT };

  let cur = null;
  try {
    const rows = await L.sb("/rest/v1/app_settings?select=reservations_open&limit=1");
    cur = rows && rows[0] ? rows[0].reservations_open : null;
  } catch (e) {
    return { acted: false, why: "상태 조회 실패", detail: String(e && e.message), now: now };
  }
  if (cur === true) return { acted: false, why: "이미 열려 있음", now: now };
  if (dry) return { acted: false, why: "dry — 실제로는 열었을 상태", wouldOpen: true, now: now };

  try {
    await L.sb("/rest/v1/app_settings?id=eq.true", {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: { reservations_open: true }
    });
  } catch (e) {
    return { acted: false, why: "켜지 못함", detail: String(e && e.message), now: now };
  }
  return { acted: true, why: "관람 예약을 열었습니다", now: now };
}

module.exports = { OPEN_AT, kstNow, maybeOpen };
