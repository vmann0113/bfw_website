/* ===========================================================
   관람 예약 자동 오픈 (하루 한 번, 한국시간 14:00)

   vercel.json 의 crons 에 등록돼 있다. 하는 일은 하나뿐이다 —
   오픈 시각이 됐으면 서버 스위치를 켜고, 아니면 아무것도 하지 않는다.

     GET /api/cron-open         자동 실행(Vercel)이 부르는 주소
     GET /api/cron-open?dry=1   켜지 않고 지금 판정만 확인 (아무나 봐도 되는 정보)

   실제 동작은 api/_open.js 에 있다. 날짜·시각도 거기서 고친다.
   =========================================================== */
const L = require("./_lib");
const OPEN = require("./_open");

function qs(url, key) {
  const m = new RegExp("[?&]" + key + "=([^&]*)").exec(url || "");
  return m ? decodeURIComponent(m[1]) : null;
}

module.exports = async (req, res) => {
  const dry = qs(req.url || "", "dry") === "1";

  /* 바깥에서 함부로 켜지 못하게 막는다. Vercel 자동 실행은 CRON_SECRET 을 함께 보낸다.
     판정만 보는 dry 조회는 바꾸는 게 없으므로 열어둔다. */
  const secret = process.env.CRON_SECRET || "";
  if (!dry && secret) {
    const auth = req.headers["authorization"] || "";
    if (auth !== "Bearer " + secret) {
      return L.json(res, 401, { ok: false, error: "unauthorized" });
    }
  }

  const open = await OPEN.maybeOpen(dry);
  return L.json(res, 200, { ok: true, openAt: OPEN.OPEN_AT, open: open });
};
