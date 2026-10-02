# 현장등록 · 브랜드 초청권 설계

2026 부산패션위크 관람 예약 시스템에 입장 경로 두 가지를 더한다.
작성 2026-10-03.

## 왜 만드나

**현장등록** — 사전등록 없이 온 관람객을 쇼당 50명까지 받는다. 좌석이 없으므로
스탠딩으로 본다. 현장 배너의 QR로 등록하며, 결과 보고에서 사전등록과 구분해야 한다.

**브랜드 초청권** — 참가 브랜드가 좌석을 지정하지 않은 초청 10장을 갖고 싶어 한다.
브랜드는 손님이 누구일지 아직 모른다. 손님은 사전등록과 똑같이 QR 입장권을 받되
자리는 자유석이고, **가장 먼저 입장한다**.

## 결정된 것

| 갈림길 | 정한 것 |
|---|---|
| 배너 QR | 1종. 서버가 **시각을 보고 쇼를 고른다** |
| 초청권 정원 | 확보 좌석과 **별도로 10장 추가** (일반 공개가 그만큼 준다) |
| 현장등록 흐름 | **등록 = 입장**. 제출 즉시 입장 처리 |
| 초청권 배포 | **브랜드별 신청 링크 1개**, 손님이 직접 이름·연락처 입력 |
| 입장 순서 | 브랜드 초청 → 사전등록 → 현장등록. 시스템은 **표시와 경고만**, 막지 않는다 |
| 손님 고지 | 신청 화면 · 완료 화면 · **QR 입장권**에 어느 줄로 올지 표기 |

## 데이터

입장 종류는 이미 있는 `reservations.source` 한 칸으로 구분한다. 순위를 따로
저장하지 않는다 — `source` 에서 바로 나오므로 순서가 바뀌어도 코드 한 줄이다.

| source | 뜻 | 순위 | 좌석 | 입장권 |
|---|---|---|---|---|
| `brand` | 브랜드 초청권 | 1 | 자유석 | QR |
| `web` | 사전등록 | 2 | 자유석 | QR |
| `walkin` | 현장등록 | 3 | 스탠딩 | 없음(등록 즉시 입장) |
| `invite` | 주최측 내빈 | 별도 | 지정석 | QR |

### 표 바꾸기

```sql
alter table public.reservations
  add column if not exists holder_id uuid references public.seat_holders(id);
create index if not exists idx_resv_holder on public.reservations(holder_id);

alter table public.seat_holders
  add column if not exists invite_quota int     not null default 0,
  add column if not exists invite_open  boolean not null default false;

alter table public.shows
  add column if not exists walkin_cap int not null default 50;
```

- `holder_id` — 어느 브랜드가 준 초청권인가. 브랜드별 집계에 쓴다.
- `invite_quota` — 그 브랜드가 줄 수 있는 장수(기본 0, 주최측이 10으로 연다).
- `invite_open` — 좌석 확보 창구와 **따로** 여닫는다. 좌석 확보가 끝나도 초청권은 열어둘 수 있다.
- `walkin_cap` — 쇼당 현장등록 한도.

기존 `walkins`(쇼별 인원수 수기 입력)는 **그대로 둔다.** 장비가 안 될 때의 보험이다.
보고 표의 기본값은 실제 등록 건수를 쓰고, 수기 숫자는 따로 보여준다.

## 서버 함수

모든 접근은 지금처럼 `security definer` 함수로만 한다. 표에 직접 닿는 길은 없다.

### `invite_view(p_token text)`
브랜드 초청 신청 화면이 처음 부른다. 토큰으로 브랜드와 쇼, 남은 장수를 돌려준다.
개인정보는 돌려주지 않는다.

```
→ { ok, brand, show:{id,titleKo,date,startTime,venue}, quota, used, left, open }
```

### `invite_claim(p_token text, p_name text, p_phone text, p_email text, p_marketing boolean)`
손님이 제출할 때. 예약 1건을 만든다.

거부 조건 — `badtoken` / `closed`(invite_open=false) / `full`(장수 소진) /
`badname` / `badphone` / `dup`(같은 번호가 그 쇼에 이미 있음) / `soldout`(쇼 정원 초과) /
`late`(쇼 예약 마감 시각 지남)

성공하면 `reservations` 에 `source='brand'`, `holder_id=브랜드`, `seat_id=null`,
`checked_in=false` 로 넣고 예약번호를 돌려준다. **`reservations_open()` 과 무관하게 동작한다** —
초청권은 일반 예약보다 먼저 돌릴 수 있어야 한다.

정원 계산: 자리를 잡지 않으므로 `show_availability.remaining` 에서 1씩 줄어든다.
"확보와 별도로 10장 추가"가 자동으로 성립한다.

### `walkin_show()`
지금 등록할 수 있는 쇼를 서버 시각(한국시간)으로 고른다. 화면이 고르지 않는다.

규칙 — 쇼 **시작 60분 전부터 시작 후 10분까지**가 등록 창구다.
창구가 아니면 다음 쇼와 열리는 시각을 함께 돌려준다.

```
→ { ok, open:boolean, show:{...}|null, nextAt, cap, used, left }
```

### `walkin_register(p_key text, p_name text, p_phone text, p_marketing boolean)`
제출 즉시 입장 처리한다. `source='walkin'`, `seat_id=null`,
`checked_in=true`, `checked_in_at=now()`.

거부 조건 — `badkey` / `closed`(창구 시간 아님) / `full`(50명 소진) /
`badname` / `badphone` / `dup`(같은 번호가 그 쇼에 이미 있음)

`p_key` 는 `app_settings.walkin_key` 와 대조하는 고정 열쇠다. 배너 QR 주소에 들어간다.
주소를 추측해서 들어오는 것을 막는다(QR 사진이 돌면 막을 수 없다 — 그래서 창구 시간과
한도, 번호 중복 검사가 실제 방어선이다).

### `attendance_report()`
쇼별로 구분 집계를 돌려준다. 스태프 전용.

```
→ [{ show_id, title_ko, capacity,
     web:{booked,entered}, brand:{booked,entered}, walkin:{entered},
     invite:{booked,entered}, walkin_manual }]
```

### 고칠 함수
- `ticket_view` — 반환에 `source` 추가 (입장권에 줄 안내를 띄우기 위해)
- `check_in` — 반환에 `source` 추가 (체크인 화면이 순위 뱃지를 띄우기 위해)
- `holder_view` / `holder_list` / `holds_board` — 초청권 한도·사용량·링크를 함께

## 화면

### 새로 만드는 둘

**`invite.html?t=<브랜드토큰>` — 브랜드 초청 신청**
- 맨 위: `○○브랜드 초청` · **1순위 입장**
- 쇼는 브랜드의 쇼로 고정. 고르는 칸이 없다
- 이름 · 연락처 · 개인정보 동의
- 남은 장수 표시, 0이면 마감 화면
- 제출 후: 완료 화면에 **"초청권 입장줄로 와 주세요 · 가장 먼저 입장합니다"**,
  QR 입장권 링크, 알림톡 발송(기존 승인 템플릿 그대로)

**`walkin.html?k=<열쇠>` — 현장등록 (배너 QR)**
- 맨 위에 크게: `지금 등록하는 쇼 — S05 연합쇼 ④ 10:30`
- 창구 시간이 아니면: `다음 쇼 S06 12:00 · 11:00부터 등록`
- 이름 · 연락처 · 동의. **좌석 없는 스탠딩**임을 제출 전에 분명히
- 제출 즉시 전체화면: **"등록 완료 · 바로 입장하세요"** + `현장등록 입장줄`
- 50명 소진 시 마감 화면
- PC 전용이 아니다. 휴대폰 화면을 기준으로 만든다

### 고치는 셋

**`ticket.html`** — 맨 위에 줄 안내 띠 하나. `source` 에 따라 글만 바뀐다.

| source | 띠 |
|---|---|
| `brand` | **초청권 입장줄** · 가장 먼저 입장합니다 |
| `web` | **사전등록 입장줄** · 초청권 다음입니다 |
| `invite` | **내빈 입장** · 지정된 좌석으로 안내드립니다 |

**관리자 · 현장 체크인** — 위에 `지금 입장 단계` 버튼 셋(① 초청권 ② 사전등록 ③ 현장등록).
스캔 결과에 순위 뱃지를 띄우고, **단계보다 늦은 순위면 빨간 경고**를 낸다. 막지는 않는다.
현장에서 줄이 섞일 때 시스템이 강제로 막으면 더 큰 사고가 난다.

**참여사 관리(`hold-admin`)** — 브랜드마다 초청권 **링크 발급 · 한도(기본 10) · 사용 현황(3/10) ·
창구 열기/닫기**. 좌석 확보 창구와 별개로 여닫는다.

## 집계와 보고

관리자 예약 현황에 구분 집계를 싣고, 같은 내용을 CSV 로 내보낸다.

| 쇼 | 사전등록 | 브랜드 초청 | 현장등록 | 합계 |
|---|---|---|---|---|
| S05 | 예약 240 / 입장 198 | 예약 10 / 입장 9 | 32 | 239 |

명단 CSV 에 **구분 열**이 붙는다. 브랜드 초청은 어느 브랜드인지도 함께 나간다.

## 지키는 것

- **기존 예약·좌석 확보 흐름을 건드리지 않는다.** `reserve_seat` 와 `holder_set` 은 그대로 둔다
- 표 접근은 전부 함수로만. 새 표를 만들지 않는다(칸 네 개만 는다)
- 같은 번호로 한 쇼에 두 번 들어오지 못한다 — 사전·브랜드·현장이 **한 표에 쌓이므로** 자동으로 걸린다
- 브랜드 초청도 쇼 정원을 넘기지 못한다
- 현장등록은 정원 밖(스탠딩)이라 좌석 수와 무관하게 센다

## 시험 계획

운영에 올리기 전에 미리보기에서 전부 확인한다.

1. 초청권 — 링크 열기 / 10장 소진 / 마감 화면 / 같은 번호 재신청 거부 / 창구 닫힘
2. 초청권 QR — 입장권에 `초청권 입장줄` 이 뜨는지, 체크인에서 1순위 뱃지가 뜨는지
3. 현장등록 — 창구 시간 안팎 / 50명 소진 / 같은 번호 재등록 / 등록 즉시 입장 처리 확인
4. 입장 단계 — ①에서 사전등록 QR 을 찍으면 경고가 뜨고 통과도 되는지
5. 집계 — 셋을 섞어 넣고 보고 표와 CSV 숫자가 맞는지
6. **기존 기능 회귀** — 일반 예약·조회·취소·좌석 확보가 그대로인지

## 아직 안 정한 것

- 브랜드 초청권을 **몇 개 브랜드에** 열어줄지 (현재 참여사 22곳)
- 현장등록 명단의 보관 기간과 파기 시점
- 알림톡에 "1순위 입장" 을 넣을지 — 넣으려면 템플릿 재심사 3~5영업일
