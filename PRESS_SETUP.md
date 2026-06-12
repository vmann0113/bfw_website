# 부산패션위크 — 언론 보도 자동 수집 설정 (네이버 뉴스 API)

Media 섹션의 **언론 보도** 카드를 네이버 뉴스에서 **자동 수집**하기 위한 가이드입니다.
수동 등록만으로도 운영되며, 아래는 "자동"을 켤 때만 필요합니다.

> **왜 프록시(서버)가 필요한가** — 네이버 검색 API는 ① Client ID/**Secret**이 필요하고
> (Secret은 브라우저에 노출되면 안 됨) ② 브라우저에서 직접 부르면 **CORS**로 차단됩니다.
> 그래서 아주 작은 서버 함수를 하나 두고, 우리 사이트는 그 함수만 호출합니다.
> 사이트(정적) → 내 프록시(서버) → 네이버 API.

---

## 1. 네이버 개발자 키 발급

1. <https://developers.naver.com/apps/#/register> 에서 애플리케이션 등록
2. 사용 API: **검색(Search)** 선택 → 비로그인 오픈 API
3. 발급되는 **Client ID** / **Client Secret** 복사
4. 검색 API는 일 25,000건까지 무료 — 행사 규모에 충분합니다.

---

## 2. 프록시 함수 배포 (Vercel 예시)

가장 간단한 무료 방법입니다. (Cloudflare Workers, Netlify Functions 등도 동일 원리)

`api/news.js` 파일 하나만 만들면 됩니다:

```js
// api/news.js  — Vercel Serverless Function
export default async function handler(req, res) {
  const query = req.query.query || "부산패션위크";
  const count = Math.min(parseInt(req.query.count || "6", 10), 24);

  const r = await fetch(
    "https://openapi.naver.com/v1/search/news.json?display=" + count +
      "&sort=date&query=" + encodeURIComponent(query),
    {
      headers: {
        "X-Naver-Client-Id": process.env.NAVER_ID,        // 환경변수
        "X-Naver-Client-Secret": process.env.NAVER_SECRET // 환경변수
      }
    }
  );
  const data = await r.json();

  // 사이트가 기대하는 형태로 정리
  const items = (data.items || []).map((x) => ({
    title: x.title.replace(/<[^>]*>/g, ""),     // <b> 태그 제거
    source: hostToName(x.originallink || x.link),
    date: (x.pubDate ? new Date(x.pubDate) : new Date())
      .toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" })
      .replace(/\. ?/g, ".").replace(/\.$/, ""),
    link: x.originallink || x.link,
    image: null                                  // 검색 API는 썸네일 미제공 → 언론사명 카드로 표시
  }));

  // 우리 사이트는 같은 출처(브라우저)에서 부르므로 CORS 허용
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=900");        // 15분 캐시
  res.status(200).json({ items });
}

function hostToName(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    const map = {
      "busan.com": "부산일보", "kookje.co.kr": "국제신문",
      "yna.co.kr": "연합뉴스", "newsis.com": "뉴시스",
      "mk.co.kr": "매일경제", "hankyung.com": "한국경제"
    };
    return map[h] || h.split(".")[0];
  } catch (e) { return "기사"; }
}
```

배포:

```bash
npm i -g vercel
vercel                       # 프로젝트 배포
vercel env add NAVER_ID      # 네이버 Client ID 입력
vercel env add NAVER_SECRET  # 네이버 Client Secret 입력
vercel --prod
```

배포 후 주소: `https://<your-app>.vercel.app/api/news`

---

## 3. 사이트에 연결

관리자(admin.html) → **언론 보도** 탭에서:

1. **자동 수집 사용** 켜기
2. **검색어**: `부산패션위크` (원하면 `부산 패션위크` 등으로 조정)
3. **표시 개수**: `6`
4. **프록시 URL**: 위 배포 주소 `https://<your-app>.vercel.app/api/news`
5. 저장 → 메인 페이지 Media 섹션에 최신 기사 카드가 자동 표시됩니다.

> 동작 방식: 사이트는 `프록시URL?query=부산패션위크&count=6` 을 호출하고,
> 반환된 `items` 를 **수동 등록 기사 뒤에** 합쳐서(중복 링크 제거) 보여줍니다.
> 즉 중요한 보도는 수동으로 고정하고, 나머지는 자동으로 채울 수 있습니다.

---

## 4. 응답 형식 (다른 소스를 쓸 경우)

프록시는 아래 형태의 JSON만 돌려주면 됩니다. 구글 뉴스 RSS 등 다른 소스로 바꿔도
이 형식만 맞추면 사이트 수정이 필요 없습니다.

```json
{
  "items": [
    {
      "title": "기사 제목",
      "source": "언론사명",
      "date": "2026.10.29",
      "link": "https://...",
      "image": null
    }
  ]
}
```

- `image`가 `null`이면 사이트는 **언론사명을 넣은 네이비 카드**로 표시합니다.
- 썸네일을 넣고 싶으면 `image`에 이미지 URL을 채우세요. (검색 API는 미제공 →
  필요 시 각 기사 OG 이미지를 서버에서 추가로 긁어와야 합니다.)

---

## 5. 메모

- **캐시**: 위 예시는 15분 캐시(`s-maxage=900`)라 트래픽이 몰려도 네이버 호출이 폭증하지 않습니다.
- **정확도**: 검색어가 너무 넓으면 무관 기사가 섞일 수 있습니다. `"부산패션위크"` 처럼
  붙여 쓰거나, 서버 함수에서 제목 필터(`title.includes`)를 한 줄 추가하면 깔끔합니다.
- **수동 우선**: 자동이 꺼져 있어도 admin에 등록한 기사들은 항상 표시됩니다.
