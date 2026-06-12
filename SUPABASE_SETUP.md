# 부산패션위크 — 관람 예약 백엔드 구축 가이드 (Supabase)

이 문서는 관람 예약 시스템을 **실서버(Supabase)** 에 연결하기 위한 설계서입니다.
프런트엔드(`register.html`, `admin.html`)는 이미 백엔드와 통신하도록 작성되어 있고,
`js/config.js` 상단의 키 두 개만 채우면 자동으로 서버 모드로 전환됩니다.

> **왜 서버가 필요한가** — 진짜 선착순(여러 관람객이 같은 잔여석을 실시간으로 나눠
> 가지며 정확히 마감)은 한 곳의 공용 DB에서 **원자적으로** 좌석을 차감해야 오버부킹이
> 발생하지 않습니다. 아래 `reserve_seat` 함수가 그 핵심(행 잠금 + 정원 확인 + 삽입을
> 한 트랜잭션으로)입니다.

---

## 0. 전체 구조

```
관람객 브라우저 ──┐
                 ├─(anon key)─▶ Supabase REST/RPC ──▶ Postgres
스태프 스캐너  ──┘                     │
                                       └─(DB Webhook)─▶ Edge Function ─▶ 알림톡/SMS 발송
```

- **공개(anon)**: 잔여석 조회 · 예약(`reserve_seat`) · 내 예약 조회 · 예약번호 조회
- **스태프(로그인 필요)**: 현장 체크인 · 전체 예약 조회 · 취소 · 입장 처리
- **자동 발송**: 예약이 생기면 DB 웹훅 → Edge Function이 문자/알림톡 전송

---

## 1. 프로젝트 생성 & 키 확보

1. <https://supabase.com> 에서 프로젝트 생성 (Region: **Northeast Asia (Seoul)** 권장)
2. **Project Settings → API** 에서 아래 두 값 복사
   - `Project URL` (예: `https://abcd1234.supabase.co`)
   - `anon public` key
3. `js/config.js` 상단의 `SUPABASE` 에 붙여넣기:

```js
var SUPABASE = {
  url: "https://abcd1234.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6..."
};
```

> 비워두면 지금처럼 **로컬 데모 모드**(이 브라우저에만 저장)로 동작합니다.
> anon key는 브라우저에 노출돼도 안전합니다 — 실제 보호는 아래 RLS가 합니다.

---

## 2. 스키마 (SQL Editor 에 붙여넣고 실행)

```sql
-- ===== shows: 쇼 마스터 (정원의 권위 있는 출처) =====
create table public.shows (
  id          text primary key,         -- 'S01' ...
  day         int  not null,
  date        text,                      -- '2026.10.29'
  dow         text,                      -- '목'
  start_time  text,                      -- '11:00'
  end_time    text,                      -- '11:30'
  title       text,                      -- 'Opening Show'
  title_ko    text,                      -- '개막식 · 오프닝 패션쇼'
  lineup      text,                      -- '국내·해외 3개사 내외'
  venue       text default '메인 런웨이',
  capacity    int  not null default 300,
  tbd         boolean default true,      -- 참여 브랜드 추첨 배치 예정 여부
  sort        int  default 0
);

-- ===== reservations: 예약(좌석) =====
create table public.reservations (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,    -- 'S01-AB12' (표시는 'BFW-' 접두)
  show_id       text not null references public.shows(id),
  -- 예약 시점의 쇼 정보를 복사 보관(이력 정확성 + 단순 조회)
  show_title    text,
  title_ko      text,
  lineup        text,
  day           int,
  date          text,
  start_time    text,
  end_time      text,
  venue         text,
  -- 신청자
  name          text not null,
  phone         text not null,
  email         text,
  marketing     boolean default false,
  -- 상태
  status        text not null default 'reserved',  -- 'reserved' | 'cancelled'
  checked_in    boolean default false,
  checked_in_at timestamptz,
  created_at    timestamptz default now()
);

-- 빠른 카운트/조회
create index idx_resv_show on public.reservations(show_id) where status = 'reserved';
create index idx_resv_phone on public.reservations(phone);

-- 한 연락처는 한 쇼에 1석만 (취소분은 제외 → 취소 후 재예약 허용)
create unique index uniq_active_seat
  on public.reservations(show_id, phone) where status = 'reserved';
```

---

## 3. 쇼 시드 (현재 12개 쇼 — 관리자에서 바꾸면 이 표도 함께 갱신)

```sql
insert into public.shows (id,day,date,dow,start_time,end_time,title,title_ko,lineup,capacity,tbd,sort) values
('S01',1,'2026.10.29','목','11:00','11:30','Opening Show','개막식 · 오프닝 패션쇼','전 참여 브랜드 합동 무대',300,false,1),
('S02',1,'2026.10.29','목','13:00','13:30','Joint Show ①','부산패션위크 연합쇼 ①','국내·해외 3개사 내외',300,true,2),
('S03',1,'2026.10.29','목','14:30','15:00','Joint Show ②','부산패션위크 연합쇼 ②','대학 2개교',300,true,3),
('S04',1,'2026.10.29','목','16:00','16:30','Joint Show ③','부산패션위크 연합쇼 ③','국내·해외 3개사 내외',300,true,4),
('S05',2,'2026.10.30','금','10:30','11:00','Joint Show ④','부산패션위크 연합쇼 ④','대학 1개교',300,true,5),
('S06',2,'2026.10.30','금','12:30','13:00','Joint Show ⑤','부산패션위크 연합쇼 ⑤','대학 2개교',300,true,6),
('S07',2,'2026.10.30','금','14:00','14:30','Joint Show ⑥','부산패션위크 연합쇼 ⑥','국내·해외 3개사 내외',300,true,7),
('S08',2,'2026.10.30','금','15:30','16:00','Joint Show ⑦','부산패션위크 연합쇼 ⑦','대학 2개교',300,true,8),
('S09',3,'2026.10.31','토','11:00','11:30','Joint Show ⑧','부산패션위크 연합쇼 ⑧','국내·해외 3개사 내외',300,true,9),
('S10',3,'2026.10.31','토','13:00','13:30','Joint Show ⑨','부산패션위크 연합쇼 ⑨','대학 2개교',300,true,10),
('S11',3,'2026.10.31','토','16:00','16:30','Joint Show ⑩','부산패션위크 연합쇼 ⑩','국내 3개사 내외',300,true,11),
('S12',3,'2026.10.31','토','17:30','18:00','Joint Show ⑪','부산패션위크 연합쇼 ⑪','대학 1개교',300,true,12);
```

---

## 4. 잔여석 뷰

```sql
create or replace view public.show_availability as
select
  s.id,
  s.capacity,
  count(r.*) filter (where r.status = 'reserved')                       as reserved,
  greatest(s.capacity - count(r.*) filter (where r.status='reserved'),0) as remaining
from public.shows s
left join public.reservations r on r.show_id = s.id
group by s.id, s.capacity;
```

---

## 5. 함수 (RPC)

### 5-1. 예약 — 선착순 핵심 (오버부킹 불가)

```sql
create or replace function public.reserve_seat(
  p_show_id text, p_name text, p_phone text, p_email text, p_marketing boolean
) returns json
language plpgsql security definer set search_path = public as $$
declare v_show shows; v_count int; v_code text; v_row reservations;
begin
  -- 쇼 행을 잠가 같은 쇼의 동시 예약을 직렬화 (오버부킹 방지의 핵심)
  select * into v_show from shows where id = p_show_id for update;
  if not found then return json_build_object('ok',false,'reason','noshow'); end if;

  -- 중복(같은 연락처가 이미 이 쇼 예약)
  if exists (select 1 from reservations
             where show_id=p_show_id and phone=p_phone and status='reserved') then
    return json_build_object('ok',false,'reason','dup');
  end if;

  -- 정원 확인
  select count(*) into v_count from reservations
    where show_id=p_show_id and status='reserved';
  if v_count >= v_show.capacity then
    return json_build_object('ok',false,'reason','full');
  end if;

  -- 예약번호 생성 (혼동 글자 없이 4자리)
  v_code := v_show.id || '-' ||
            upper(translate(substr(encode(gen_random_bytes(4),'hex'),1,4),'01o','XYZ'));

  insert into reservations
    (code, show_id, show_title, title_ko, lineup, day, date, start_time, end_time, venue,
     name, phone, email, marketing)
  values
    (v_code, v_show.id, v_show.title, v_show.title_ko, v_show.lineup, v_show.day, v_show.date,
     v_show.start_time, v_show.end_time, v_show.venue,
     p_name, p_phone, p_email, coalesce(p_marketing,false))
  returning * into v_row;

  return json_build_object('ok',true,'reservation',row_to_json(v_row));
exception when unique_violation then
  -- 동시성으로 중복/코드 충돌 시
  return json_build_object('ok',false,'reason','dup');
end $$;
```

### 5-2. 내 예약 조회 / 예약번호 조회 / 스태프 검색

```sql
create or replace function public.lookup_reservations(p_phone text)
returns setof reservations language sql security definer set search_path=public as $$
  select * from reservations
  where phone = p_phone and status='reserved' order by created_at desc;
$$;

create or replace function public.find_reservation(p_code text)
returns setof reservations language sql security definer set search_path=public as $$
  select * from reservations
  where upper(code) = upper(p_code) and status='reserved' limit 1;
$$;
```

> `staff_search`(이름/연락처 부분검색)와 아래 입장 함수들은 **스태프만** 실행해야 하므로
> `auth.role() = 'authenticated'` 를 확인합니다.

```sql
create or replace function public.staff_search(p_q text)
returns setof reservations language sql security definer set search_path=public as $$
  select * from reservations
  where status='reserved'
    and (phone ilike '%'||p_q||'%' or name ilike '%'||p_q||'%')
    and auth.role() = 'authenticated'
  order by created_at desc limit 50;
$$;
```

### 5-3. 입장 처리 (재입장 차단) · 취소 — 스태프 전용

```sql
create or replace function public.check_in(p_code text)
returns json language plpgsql security definer set search_path=public as $$
declare v_row reservations;
begin
  if auth.role() <> 'authenticated' then
    return json_build_object('ok',false,'reason','forbidden');
  end if;
  select * into v_row from reservations
    where upper(code)=upper(p_code) and status='reserved' for update;
  if not found then return json_build_object('ok',false,'reason','notfound'); end if;
  if v_row.checked_in then
    return json_build_object('ok',false,'reason','already','reservation',row_to_json(v_row));
  end if;
  update reservations set checked_in=true, checked_in_at=now()
    where id=v_row.id returning * into v_row;
  return json_build_object('ok',true,'reservation',row_to_json(v_row));
end $$;

create or replace function public.undo_check_in(p_id uuid)
returns json language plpgsql security definer set search_path=public as $$
declare v_row reservations;
begin
  if auth.role() <> 'authenticated' then return json_build_object('ok',false); end if;
  update reservations set checked_in=false, checked_in_at=null
    where id=p_id returning * into v_row;
  return json_build_object('ok',true,'reservation',row_to_json(v_row));
end $$;

create or replace function public.cancel_reservation(p_id uuid)
returns json language plpgsql security definer set search_path=public as $$
begin
  -- 본인 취소(공개)도 허용하려면 이 함수는 anon 도 호출 가능하게 둡니다.
  update reservations set status='cancelled' where id=p_id;
  return json_build_object('ok',true);
end $$;

create or replace function public.admin_clear_reservations()
returns json language plpgsql security definer set search_path=public as $$
begin
  if auth.role() <> 'authenticated' then return json_build_object('ok',false); end if;
  update reservations set status='cancelled' where status='reserved';
  return json_build_object('ok',true);
end $$;
```

---

## 6. RLS (행 수준 보안) — 직접 테이블 접근 차단

```sql
alter table public.shows        enable row level security;
alter table public.reservations enable row level security;

-- shows: 누구나 읽기 (잔여석/일정 표시용)
create policy "shows readable" on public.shows for select using (true);

-- reservations: 직접 select/insert/update/delete 전면 차단.
--   (예약/조회/입장은 위 SECURITY DEFINER 함수로만)
-- 정책을 만들지 않으면 RLS 활성 상태에서 기본 거부됩니다.

-- 관리자 대시보드의 "전체 예약 목록"은 인증된 스태프만 직접 read 허용
create policy "staff read reservations" on public.reservations
  for select using (auth.role() = 'authenticated');

-- show_availability 뷰는 anon 도 읽도록 권한 부여
grant select on public.show_availability to anon, authenticated;
grant execute on function public.reserve_seat(text,text,text,text,boolean) to anon, authenticated;
grant execute on function public.lookup_reservations(text) to anon, authenticated;
grant execute on function public.find_reservation(text)     to anon, authenticated;
grant execute on function public.cancel_reservation(uuid)   to anon, authenticated;
grant execute on function public.staff_search(text)         to authenticated;
grant execute on function public.check_in(text)             to authenticated;
grant execute on function public.undo_check_in(uuid)        to authenticated;
grant execute on function public.admin_clear_reservations() to authenticated;
```

---

## 7. 스태프 로그인 (현장 체크인 단말)

현장 체크인·전체 예약 조회는 로그인한 스태프만 가능합니다.

1. **Authentication → Providers → Email** 활성화, **"Confirm email" 끄기**(내부 계정).
2. **Authentication → Users → Add user** 로 현장 스태프 계정 1개 생성
   (예: `staff@bfw.local` / 강력한 비밀번호). 단말이 여러 대여도 같은 계정 공유 가능.
3. 전용 스캐너/단말에서 `admin.html` 의 **현장 체크인** 탭을 열면 로그인 폼이 뜨고,
   한 번 로그인하면 토큰이 유지됩니다. (프런트는 `BFWApi.staffSignIn(email,pw)` 사용)

> 관람객 예약 화면(`register.html`)은 로그인 없이 누구나 사용합니다.

---

## 8. 예약 확인 문자 / 알림톡 자동 발송 (Edge Function)

예약이 생성되면 DB 웹훅이 Edge Function을 호출해 문자/알림톡을 보냅니다.
아래는 **Solapi(쿨에스엠에스)** 예시입니다 — 카카오 알림톡 + SMS/LMS 폴백을 지원합니다.
(NHN Cloud, 알리고 등 다른 제공사도 동일 구조로 교체 가능)

### 8-1. Edge Function 생성

`supabase/functions/notify-reservation/index.ts`

```ts
import { createHmac } from "node:crypto";

const API_KEY = Deno.env.get("SOLAPI_API_KEY")!;
const API_SECRET = Deno.env.get("SOLAPI_API_SECRET")!;
const SENDER = Deno.env.get("SMS_SENDER")!;       // 등록된 발신번호 '0517470000'

function authHeader() {
  const date = new Date().toISOString();
  const salt = crypto.randomUUID();
  const sig = createHmac("sha256", API_SECRET).update(date + salt).digest("hex");
  return `HMAC-SHA256 apiKey=${API_KEY}, date=${date}, salt=${salt}, signature=${sig}`;
}

Deno.serve(async (req) => {
  const { record } = await req.json();            // 웹훅 payload (INSERT된 row)
  if (!record?.phone) return new Response("skip");

  const text =
    `[부산패션위크] 관람 예약 완료\n` +
    `${record.title_ko ?? record.show_title} (${record.date} ${record.start_time})\n` +
    `예약번호 BFW-${record.code}\n` +
    `현장 입구에서 이 번호/QR을 제시해 주세요.`;

  const res = await fetch("https://api.solapi.com/messages/v4/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader() },
    body: JSON.stringify({
      message: {
        to: record.phone.replace(/\D/g, ""),
        from: SENDER,
        text,                                     // LMS/SMS 본문 (알림톡 사용 시 kakaoOptions 추가)
        // kakaoOptions: { pfId: "...", templateId: "...", variables: {...} }
      },
    }),
  });
  return new Response(await res.text(), { status: res.ok ? 200 : 500 });
});
```

배포 & 시크릿:

```bash
supabase functions deploy notify-reservation --no-verify-jwt
supabase secrets set SOLAPI_API_KEY=... SOLAPI_API_SECRET=... SMS_SENDER=0517470000
```

### 8-2. DB 웹훅 연결

**Database → Webhooks → Create**
- Table: `reservations`, Events: **Insert**
- Type: **Supabase Edge Function** → `notify-reservation`

> **알림톡으로 보내려면**: 카카오 비즈니스 채널 + 발신프로필(pfId)과 **사전 승인된 템플릿**이
> 필요합니다. 위 본문 형식 그대로 템플릿을 등록하고, `kakaoOptions` 를 채운 뒤
> 미수신 시 SMS로 폴백하도록 설정하면 됩니다. (행사성 정보 발송은 채널 추가 친구가
> 아니어도 가능한 정보성 템플릿으로 신청)

---

## 9. 동작 점검 체크리스트

- [ ] `js/config.js` 에 url/anonKey 입력 → `register.html` 새로고침 시 잔여석이 DB 값으로 표시
- [ ] 예약 1건 생성 → `reservations` 에 row + 문자 수신
- [ ] 정원을 일부러 1로 낮춰 동시에 2명 예약 → 한 명만 성공, 다른 한 명 `full`
- [ ] 같은 번호로 같은 쇼 재예약 → `dup`
- [ ] 스태프 로그인 후 QR/번호로 입장 → 두 번째 시도 시 `이미 입장`
- [ ] `show_availability` 가 예약/취소에 따라 갱신

---

## 10. 규모 / 비용 메모

- 12쇼 × 300석 = 최대 3,600 예약 — Supabase **무료 플랜**으로 충분합니다.
- 오픈 순간 트래픽이 몰려도 `for update` 행 잠금은 **쇼 단위**라 서로 다른 쇼는 병렬 처리됩니다.
- 문자 비용만 사용량 과금(건당 수~수십 원). 알림톡이 SMS보다 저렴합니다.
- 백업: Supabase 자동 일일 백업 + 행사 후 `reservations` CSV 보관(관리자에서 내보내기 제공).
