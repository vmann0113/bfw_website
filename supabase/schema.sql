-- =====================================================================
--  2026 부산패션위크 — 관람 예약 / 프레스 신청 백엔드 스키마
--  Supabase SQL Editor 에 전체를 붙여넣고 한 번 실행하세요.
--  여러 번 실행해도 안전합니다(같은 결과로 수렴).
--
--  작성: 2026-09-05 (마감시각·현장인원 통합본)
--  이 파일 하나가 최종 상태입니다. walkins.sql / deadline.sql 은 이미 적용된
--  중간 패치이므로 다시 실행할 필요가 없습니다.
--  대상 프로젝트: hjcrzdzrgmubipxcgzce
-- =====================================================================

create extension if not exists pgcrypto;

-- =====================================================================
--  1. 표(테이블)
-- =====================================================================

-- ---- shows : 쇼 마스터. 좌석 정원의 유일한 기준 ----
create table if not exists public.shows (
  id          text primary key,
  day         int  not null,
  date        text,
  dow         text,
  start_time  text,
  end_time    text,
  title       text,
  title_ko    text,
  lineup      text,
  venue       text default '메인 런웨이',
  capacity    int  not null default 300,
  tbd         boolean default false,
  sort        int  default 0,
  reserve_close_at timestamptz,    -- 예약 마감 시각(쇼 전날 자정). null이면 마감 없음
  seating_mode text not null default 'free'   -- 'assigned'(지정좌석) | 'free'(자유석)
);
-- 이 열들이 없던 시기에 만든 데이터베이스를 위해
alter table public.shows add column if not exists reserve_close_at timestamptz;
alter table public.shows add column if not exists seating_mode text not null default 'free';

-- ---- zones : 객석 구역 (A~H, 쇼와 무관하게 고정) ----
--  실제 배치: 무대/LED 앞으로 런웨이가 있고 좌·우에 각 4개 구역.
--  한 구역은 "런웨이 방향 열(row) × 깊이 3단(tier)" 격자다.
--  번호는 1단(런웨이 최근접)부터 채워진다: A구역이면 1~12=1단, 13~24=2단, 25~36=3단.
create table if not exists public.zones (
  code       text primary key,          -- 'A' ~ 'H'
  side       text not null,             -- 'L'(좌) | 'R'(우)
  label      text not null,             -- 'A구역'
  rows_count int  not null,             -- 런웨이 방향 열 수 (12 또는 14)
  tiers      int  not null default 3,   -- 계단 단 수
  seat_count int  not null,             -- rows_count * tiers
  sort       int  not null              -- 무대에서 가까운 순
);

-- ---- seats : 좌석 마스터 (구역 × 번호, 쇼와 무관) ----
create table if not exists public.seats (
  id        text primary key,           -- 'A-01' ~ 'H-42'
  zone_code text not null references public.zones(code),
  num       int  not null,              -- 구역 안 번호 (1~36 또는 1~42)
  tier      int  not null,              -- 1=런웨이 최근접
  row_no    int  not null,              -- 1=무대 최근접
  unique (zone_code, num)
);
create index if not exists idx_seats_zone on public.seats(zone_code);

-- ---- show_seat_locks : 쇼별로 예약을 막아둔 좌석 (초청석 등) ----
create table if not exists public.show_seat_locks (
  show_id    text not null references public.shows(id),
  seat_id    text not null references public.seats(id),
  kind       text not null default 'invite',   -- 'invite'(초청) | 'blocked'(사용 안 함)
  note       text,
  created_at timestamptz default now(),
  primary key (show_id, seat_id)
);

-- ---- reservations : 관람 예약 ----
--  phone_key / name_key 는 입력값에서 자동 생성되는 "대조용" 열입니다.
--  010-1234-5678 과 01012345678 을 같은 사람으로 취급하기 위한 장치입니다.
create table if not exists public.reservations (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,
  show_id       text not null references public.shows(id),
  show_title    text,
  title_ko      text,
  lineup        text,
  day           int,
  date          text,
  start_time    text,
  end_time      text,
  venue         text,
  name          text not null,
  phone         text not null,
  email         text,
  marketing     boolean default false,
  status        text not null default 'reserved',
  checked_in    boolean default false,
  checked_in_at timestamptz,
  created_at    timestamptz default now(),
  phone_key text generated always as (regexp_replace(phone, '[^0-9]', '', 'g')) stored,
  name_key  text generated always as (lower(regexp_replace(name, '\s', '', 'g'))) stored
);

-- 좌석제 도입에 따라 추가된 열 (이전에 만든 데이터베이스도 갱신됨)
alter table public.reservations add column if not exists seat_id    text references public.seats(id);
alter table public.reservations add column if not exists seat_label text;
alter table public.reservations add column if not exists source     text not null default 'web';  -- 'web' | 'invite'
alter table public.reservations add column if not exists guest_org   text;   -- 초청자 소속
alter table public.reservations add column if not exists guest_title text;   -- 초청자 직위
-- 초청 내빈은 연락처를 모르는 경우가 있어 선택값으로 둔다
-- (phone_key 가 null 이면 고유색인에 걸리지 않으므로 여러 건이 공존할 수 있다)
alter table public.reservations alter column phone drop not null;

create index if not exists idx_resv_show  on public.reservations(show_id) where status = 'reserved';
create index if not exists idx_resv_phone on public.reservations(phone_key);

-- 한 연락처는 한 쇼에 1석 (취소분 제외 → 취소 후 재예약 가능)
create unique index if not exists uniq_active_seat
  on public.reservations(show_id, phone_key) where status = 'reserved';

-- 한 좌석은 한 쇼에서 한 번만 (오버부킹 최종 방어선)
create unique index if not exists uniq_seat_per_show
  on public.reservations(show_id, seat_id) where status = 'reserved' and seat_id is not null;

-- ---- notifications : 문자·알림톡 발송 이력 ----
--  같은 안내를 두 번 보내지 않기 위한 기록이자, 발주처 보고용 근거자료.
--  서버(Vercel 함수)만 접근한다. 브라우저에서는 읽지도 쓰지도 못한다.
create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  reservation_id uuid references public.reservations(id) on delete set null,
  code         text,                       -- 예약번호 (예약이 지워져도 이력은 남는다)
  kind         text not null,              -- 'reserved' | 'reminder' | 'cancelled'
  channel      text not null,              -- 'alimtalk' | 'sms' | 'dryrun'
  to_phone     text,
  status       text not null,              -- 'sent' | 'failed' | 'skipped' | 'test'(모의발송)
  detail       text,
  created_at   timestamptz default now()
);
create index if not exists idx_noti_resv on public.notifications(reservation_id);
-- 한 예약에 같은 종류의 안내는 한 번만 (성공한 건 기준)
create unique index if not exists uniq_noti_once
  on public.notifications(reservation_id, kind) where status = 'sent';

alter table public.notifications enable row level security;
-- 정책 없음 = anon/authenticated 모두 차단. 서버 전용 키로만 접근한다.

-- ---- members : 간편 회원 ----
create table if not exists public.members (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text not null unique,
  email      text,
  pass_hash  text not null,
  created_at timestamptz default now()
);

-- ---- press_applications : 프레스 방문 신청 ----
create table if not exists public.press_applications (
  id            uuid primary key default gen_random_uuid(),
  media         text not null,
  reporter      text not null,
  phone         text not null,
  email         text,
  types         text,
  days          text,
  note          text,
  status        text not null default 'pending',
  code          text unique,
  checked_in    boolean default false,
  checked_in_at timestamptz,
  created_at    timestamptz default now(),
  phone_key    text generated always as (regexp_replace(phone, '[^0-9]', '', 'g')) stored,
  reporter_key text generated always as (lower(regexp_replace(reporter, '\s', '', 'g'))) stored
);

create index if not exists idx_press_phone on public.press_applications(phone_key);

-- =====================================================================
--  2. 쇼 시드 — 2026 확정 라인업 13개 (홈페이지 config 에서 기계 추출)
--     쇼 정보가 바뀌면 이 블록만 다시 실행하면 갱신됩니다.
-- =====================================================================

insert into public.shows
  (id,day,date,dow,start_time,end_time,title,title_ko,lineup,venue,capacity,tbd,sort)
values
  ('S01',1,'2026.10.29','목','11:00','11:50','Opening','패페부산X부산패션위크 개막식','오프닝','메인 런웨이',300,false,1),
  ('S02',1,'2026.10.29','목','13:00','13:30','Joint Show ①','연합쇼 ①','레뷰라X코타로 타니야마 · 해외브랜드 연합쇼','메인 런웨이',300,false,2),
  ('S03',1,'2026.10.29','목','14:30','15:00','Joint Show ②','연합쇼 ②','동아대학교','메인 런웨이',300,false,3),
  ('S04',1,'2026.10.29','목','16:00','16:30','Joint Show ③','연합쇼 ③','이미경 뷰띠끄 · 르망고 · 해외브랜드 연합쇼','메인 런웨이',300,false,4),
  ('S05',2,'2026.10.30','금','10:30','11:00','Joint Show ④','연합쇼 ④','오교 · 리온베 · 이영희 프리젠트','메인 런웨이',300,false,5),
  ('S06',2,'2026.10.30','금','12:00','12:30','Joint Show ⑤','연합쇼 ⑤','국립부경대학교 · 동명대학교 · 소언한복X경상국립대','메인 런웨이',300,false,6),
  ('S07',2,'2026.10.30','금','14:00','16:00','Design Competition','부산패션디자인경진대회 & 부산컬렉션','','메인 런웨이',300,false,7),
  ('S08',2,'2026.10.30','금','17:00','17:30','Joint Show ⑥','연합쇼 ⑥','동의대학교 · 경성대학교','메인 런웨이',300,false,8),
  ('S09',3,'2026.10.31','토','11:00','11:30','Joint Show ⑦','연합쇼 ⑦','신라대학교 · 영산대학교','메인 런웨이',300,false,9),
  ('S10',3,'2026.10.31','토','13:00','13:30','Joint Show ⑧','연합쇼 ⑧','부산대학교','메인 런웨이',300,false,10),
  ('S11',3,'2026.10.31','토','14:30','15:00','Joint Show ⑨','연합쇼 ⑨','카마모에X소티에 · 스튜디오 디 뻬를라 · 프랭커스','메인 런웨이',300,false,11),
  ('S12',3,'2026.10.31','토','16:00','16:30','Joint Show ⑩','연합쇼 ⑩','메르최 · 미지미지 · 바주요','메인 런웨이',300,false,12),
  ('S13',3,'2026.10.31','토','17:30','18:00','Joint Show ⑪','연합쇼 ⑪','동서대학교','메인 런웨이',300,false,13)
on conflict (id) do update set
  day=excluded.day, date=excluded.date, dow=excluded.dow,
  start_time=excluded.start_time, end_time=excluded.end_time,
  title=excluded.title, title_ko=excluded.title_ko, lineup=excluded.lineup,
  venue=excluded.venue, capacity=excluded.capacity, tbd=excluded.tbd, sort=excluded.sort;

-- 쇼 날짜로부터 "전날 자정"(= 쇼 당일 00:00 한국시간)을 계산해 채운다.
-- 이미 값이 있는 쇼는 건드리지 않는다(개별 조정분 보존).
update public.shows
   set reserve_close_at = (to_date(shows.date, 'YYYY.MM.DD')::timestamp at time zone 'Asia/Seoul')
 where reserve_close_at is null
   and shows.date is not null;

-- ---- 구역 8개 : 좌 A~D, 우 E~H (무대에서 가까운 순) ----
insert into public.zones (code, side, label, rows_count, tiers, seat_count, sort) values
  ('A','L','A구역',12,3,36,1), ('B','L','B구역',12,3,36,2),
  ('C','L','C구역',12,3,36,3), ('D','L','D구역',14,3,42,4),
  ('E','R','E구역',12,3,36,1), ('F','R','F구역',12,3,36,2),
  ('G','R','G구역',12,3,36,3), ('H','R','H구역',14,3,42,4)
on conflict (code) do update set
  side=excluded.side, label=excluded.label, rows_count=excluded.rows_count,
  tiers=excluded.tiers, seat_count=excluded.seat_count, sort=excluded.sort;

-- ---- 좌석 300개 자동 생성 (번호 = (단-1) × 열수 + 열번호) ----
insert into public.seats (id, zone_code, num, tier, row_no)
select z.code || '-' || lpad((((t - 1) * z.rows_count + r))::text, 2, '0'),
       z.code,
       (t - 1) * z.rows_count + r,
       t,
       r
from public.zones z
cross join generate_series(1, 3) as t
cross join lateral generate_series(1, z.rows_count) as r
on conflict (id) do nothing;

-- =====================================================================
--  3. 잔여석 뷰 — 공개(누구나 읽기). 개인정보는 담기지 않고 숫자만 나갑니다.
-- =====================================================================

--  주의: PostgreSQL 은 기존 뷰를 교체할 때 열 순서를 바꾸거나 중간에 끼워넣지
--  못한다. 새 열은 반드시 맨 뒤에 붙일 것.
create or replace view public.show_availability as
select
  s.id,
  s.capacity,
  count(r.*) filter (where r.status = 'reserved')                           as reserved,
  greatest(s.capacity
           - count(r.*) filter (where r.status = 'reserved')
           - (select count(*) from public.show_seat_locks k where k.show_id = s.id), 0) as remaining,
  s.reserve_close_at,
  (s.reserve_close_at is not null and now() >= s.reserve_close_at)          as closed,
  (select count(*) from public.show_seat_locks k where k.show_id = s.id)    as locked,
  s.seating_mode
from public.shows s
left join public.reservations r on r.show_id = s.id
group by s.id, s.capacity, s.reserve_close_at, s.seating_mode;

-- ---- 구역별 잔여석 (공개) : 예약 화면 1단계에서 쓴다 ----
create or replace view public.zone_availability as
select
  sh.id                                   as show_id,
  z.code                                  as zone_code,
  z.label,
  z.side,
  z.sort,
  z.rows_count,
  z.tiers,
  z.seat_count,
  (select count(*) from public.reservations r
     where r.show_id = sh.id and r.status = 'reserved'
       and r.seat_id in (select id from public.seats where zone_code = z.code)) as reserved,
  (select count(*) from public.show_seat_locks k
     join public.seats s2 on s2.id = k.seat_id
    where k.show_id = sh.id and s2.zone_code = z.code)                          as locked,
  z.seat_count
    - (select count(*) from public.reservations r
         where r.show_id = sh.id and r.status = 'reserved'
           and r.seat_id in (select id from public.seats where zone_code = z.code))
    - (select count(*) from public.show_seat_locks k
         join public.seats s2 on s2.id = k.seat_id
        where k.show_id = sh.id and s2.zone_code = z.code)                      as remaining
from public.shows sh
cross join public.zones z;

grant select on public.zone_availability to anon, authenticated;

-- =====================================================================
--  4. 기능(함수)
--     · 표에 직접 손대는 길은 5번에서 모두 막습니다.
--     · 아래 함수를 통해서만 데이터가 오갑니다.
-- =====================================================================

-- ---- 4-1. 예약 : 선착순의 핵심 ----
--  쇼마다 방식이 다르다.
--   · seating_mode='assigned' → 관람객이 좌석을 지정한다 (p_seat_id 필수)
--   · seating_mode='free'     → 잔여석만 세고 현장 착석은 선착순 (p_seat_id 무시)
--  어느 쪽이든 초청석으로 잠근 자리는 온라인 정원에서 자동으로 빠진다.
-- ===================================================================
--  오픈 스위치 (서버측)
--  화면에서 예약 입구를 숨겨도, 이 함수들을 직접 호출하면 예약이 된다.
--  그래서 "아직 안 열었다"는 판단을 서버에서 한 번 더 한다.
--  오픈할 때 :  update public.app_settings set reservations_open = true;
-- ===================================================================
create table if not exists public.app_settings (
  id                boolean primary key default true check (id),
  reservations_open boolean     not null default false,
  press_open        boolean     not null default false,
  holds_open        boolean     not null default false,
  updated_at        timestamptz not null default now()
);
-- 나중에 추가된 항목 (이미 만들어진 데이터베이스에도 붙도록)
alter table public.app_settings
  add column if not exists holds_open boolean not null default false;
insert into public.app_settings (id) values (true) on conflict (id) do nothing;
alter table public.app_settings enable row level security;  -- 정책 없음 = 직접 접근 차단

create or replace function public.reservations_open() returns boolean
language sql stable security definer set search_path = public as $fn$
  select coalesce((select reservations_open from public.app_settings where id), false);
$fn$;

create or replace function public.press_open() returns boolean
language sql stable security definer set search_path = public as $fn$
  select coalesce((select press_open from public.app_settings where id), false);
$fn$;

-- (예전) 사전 좌석 확보 창구 전체 스위치. 지금은 창구를 참여사마다 따로 연다
-- (seat_holders.is_open, holder_open_set). 이 값은 더 이상 열고 닫는 데 쓰지 않는다.
create or replace function public.holds_open() returns boolean
language sql stable security definer set search_path = public as $fn$
  select coalesce((select holds_open from public.app_settings where id), false);
$fn$;

-- ===================================================================
--  스태프 명단
--
--  예전에는 스태프 함수가 "로그인만 했으면" 허락했다. 그런데 Supabase 는
--  기본으로 누구나 가입할 수 있어서, 자기 이메일로 가입·인증만 하면
--  예약 전체 삭제·예약자 연락처 조회·좌석 전부 잠그기가 가능했다.
--
--  이제는 로그인에 더해 이 명단에 있어야 한다. 가입 설정이 다시 열려도
--  명단에 없는 사람은 아무것도 못 한다.
--
--  스태프 추가 :  insert into public.staff (email) values ('name@example.com');
--  스태프 제거 :  delete from public.staff where email = 'name@example.com';
-- ===================================================================
create table if not exists public.staff (
  email      text primary key,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.staff enable row level security;  -- 정책 없음 = 직접 접근 차단

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $fn$
  select auth.role() = 'authenticated'
     and exists (
       select 1 from public.staff s
        where lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
     );
$fn$;

drop function if exists public.reserve_seat(text,text,text,text,boolean);
drop function if exists public.reserve_seat(text,text,text,text,text,boolean);

create or replace function public.reserve_seat(
  p_show_id text, p_seat_id text, p_name text, p_phone text, p_email text, p_marketing boolean
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_show     shows;
  v_seat     seats;
  v_zone     zones;
  v_count    int;
  v_locked   int;
  v_open     int;
  v_code     text;
  v_row      reservations;
  v_pkey     text;
  v_try      int := 0;
  v_seat_id  text := null;
  v_label    text := null;
begin
  -- 아직 오픈 전이면 어떤 경로로 불러도 받지 않는다
  if not public.reservations_open() then
    return json_build_object('ok', false, 'reason', 'notopen');
  end if;

  v_pkey := regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g');
  if length(v_pkey) < 9 then
    return json_build_object('ok', false, 'reason', 'badphone');
  end if;
  if coalesce(btrim(p_name), '') = '' then
    return json_build_object('ok', false, 'reason', 'badname');
  end if;

  -- 쇼 행 잠금 → 같은 쇼 동시 예약을 직렬화 (오버부킹 방지)
  select * into v_show from shows where id = p_show_id for update;
  if not found then
    return json_build_object('ok', false, 'reason', 'noshow');
  end if;

  -- 예약 마감 시각을 지났는가 (쇼 전날 자정)
  if v_show.reserve_close_at is not null and now() >= v_show.reserve_close_at then
    return json_build_object('ok', false, 'reason', 'closed');
  end if;

  -- 같은 연락처가 이미 이 쇼를 예약했는가
  if exists (select 1 from reservations
             where show_id = p_show_id and phone_key = v_pkey and status = 'reserved') then
    return json_build_object('ok', false, 'reason', 'dup');
  end if;

  if v_show.seating_mode = 'assigned' then
    -- ── 지정좌석 ──
    if coalesce(btrim(p_seat_id), '') = '' then
      return json_build_object('ok', false, 'reason', 'noseat');
    end if;
    select * into v_seat from seats where id = btrim(p_seat_id);
    if not found then
      return json_build_object('ok', false, 'reason', 'noseat');
    end if;
    select * into v_zone from zones where code = v_seat.zone_code;

    if exists (select 1 from show_seat_locks
               where show_id = p_show_id and seat_id = v_seat.id) then
      return json_build_object('ok', false, 'reason', 'locked');
    end if;
    if exists (select 1 from reservations
               where show_id = p_show_id and seat_id = v_seat.id and status = 'reserved') then
      return json_build_object('ok', false, 'reason', 'taken');
    end if;
    v_seat_id := v_seat.id;
    v_label   := v_zone.label || ' ' || v_seat.num || '번';
  end if;

  -- 정원 확인 : 전체 정원에서 초청석을 뺀 만큼만 온라인으로 받는다
  select count(*) into v_locked from show_seat_locks where show_id = p_show_id;
  v_open := greatest(v_show.capacity - v_locked, 0);
  select count(*) into v_count from reservations
    where show_id = p_show_id and status = 'reserved';
  if v_count >= v_open then
    return json_build_object('ok', false, 'reason', 'full');
  end if;

  -- 예약번호 발급 : 6자리. 혼동 글자(0,1,O,I)를 쓰지 않는다.
  loop
    v_try := v_try + 1;
    v_code := v_show.id || '-' || (
      select string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ',
                               1 + floor(random() * 32)::int, 1), '')
      from generate_series(1, 6)
    );
    exit when not exists (select 1 from reservations where code = v_code);
    if v_try >= 20 then
      return json_build_object('ok', false, 'reason', 'codefail');
    end if;
  end loop;

  insert into reservations
    (code, show_id, show_title, title_ko, lineup, day, date, start_time, end_time, venue,
     name, phone, email, marketing, seat_id, seat_label, source)
  values
    (v_code, v_show.id, v_show.title, v_show.title_ko, v_show.lineup, v_show.day, v_show.date,
     v_show.start_time, v_show.end_time, v_show.venue,
     btrim(p_name), btrim(p_phone), nullif(btrim(coalesce(p_email,'')), ''), coalesce(p_marketing, false),
     v_seat_id, v_label, 'web')
  returning * into v_row;

  return json_build_object('ok', true, 'reservation', row_to_json(v_row));
exception when unique_violation then
  if v_seat_id is not null and exists (
       select 1 from reservations
        where show_id = p_show_id and seat_id = v_seat_id and status = 'reserved') then
    return json_build_object('ok', false, 'reason', 'taken');
  end if;
  return json_build_object('ok', false, 'reason', 'dup');
end $$;

-- ---- 4-2. 내 예약 조회 : 이름 + 연락처 둘 다 일치해야 합니다 ----
--  이름은 공백/대소문자 차이를 무시하고 대조합니다.
create or replace function public.lookup_reservations(p_phone text, p_name text)
returns setof reservations
language sql security definer set search_path = public as $$
  select * from reservations
  where phone_key = regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g')
    and name_key  = lower(regexp_replace(coalesce(p_name,''), '\s', '', 'g'))
    and length(regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g')) >= 9
    and coalesce(btrim(p_name), '') <> ''
    and status = 'reserved'
  order by created_at desc;
$$;

-- ---- 4-3. 예약번호로 찾기 : 스태프 전용 ----
--  공개하면 예약번호를 무차별 대입해 명단 전체를 긁어갈 수 있어 잠급니다.
--  (홈페이지 관람객 화면은 이 기능을 쓰지 않습니다. 현장 체크인 전용)
create or replace function public.find_reservation(p_code text)
returns setof reservations
language sql security definer set search_path = public as $$
  select * from reservations
  where public.is_staff()
    and upper(code) = upper(btrim(p_code))
    and status = 'reserved'
  limit 1;
$$;

-- ---- 4-3b. 모바일 티켓 보기 (공개) ----
--  문자로 받은 링크에서 QR을 띄우는 용도. 예약번호를 무작위로 대입해도
--  이름은 가려져 있고 연락처·이메일은 아예 나가지 않는다.
--  (어느 좌석이 찼는지는 예약 화면에서 이미 공개되는 정보다)
--  반환 열이 바뀌었으므로 기존 함수를 지우고 다시 만든다
drop function if exists public.ticket_view(text[]);

create or replace function public.ticket_view(p_codes text[])
returns table (
  code text, show_id text, title_ko text, show_title text, lineup text,
  day int, date text, start_time text, end_time text, venue text,
  seat_label text, name_masked text, checked_in boolean
) language sql security definer set search_path = public as $$
  select r.code, r.show_id, r.title_ko, r.show_title, r.lineup,
         r.day, r.date, r.start_time, r.end_time, r.venue,
         r.seat_label,
         case
           when char_length(r.name) <= 1 then r.name
           when char_length(r.name) = 2 then left(r.name, 1) || '*'
           else left(r.name, 1) || repeat('*', char_length(r.name) - 2) || right(r.name, 1)
         end,
         r.checked_in
  from reservations r
  where r.status = 'reserved'
    -- 링크에는 'BFW-S01-ABC123' 형태로 들어오므로 접두어를 떼고 대조한다
    and upper(r.code) = any (
      select upper(regexp_replace(btrim(c), '^BFW-?', '', 'i')) from unnest(p_codes) as c
    )
  order by r.date, r.start_time;
$$;

-- ---- 4-4. 스태프 검색 (이름/연락처 부분일치) ----
create or replace function public.staff_search(p_q text)
returns setof reservations
language sql security definer set search_path = public as $$
  select * from reservations
  where public.is_staff()
    and status = 'reserved'
    and (phone ilike '%' || p_q || '%'
      or phone_key ilike '%' || regexp_replace(coalesce(p_q,''), '[^0-9]', '', 'g') || '%'
      or name ilike '%' || p_q || '%')
  order by created_at desc
  limit 50;
$$;

-- ---- 4-5. 입장 처리 (재입장 차단) — 스태프 전용 ----
create or replace function public.check_in(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare v_row reservations;
begin
  if not public.is_staff() then
    return json_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into v_row from reservations
    where upper(code) = upper(btrim(p_code)) and status = 'reserved' for update;
  if not found then
    return json_build_object('ok', false, 'reason', 'notfound');
  end if;
  if v_row.checked_in then
    return json_build_object('ok', false, 'reason', 'already', 'reservation', row_to_json(v_row));
  end if;
  update reservations set checked_in = true, checked_in_at = now()
    where id = v_row.id returning * into v_row;
  return json_build_object('ok', true, 'reservation', row_to_json(v_row));
end $$;

create or replace function public.undo_check_in(p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_row reservations;
begin
  if not public.is_staff() then
    return json_build_object('ok', false, 'reason', 'forbidden');
  end if;
  update reservations set checked_in = false, checked_in_at = null
    where id = p_id returning * into v_row;
  return json_build_object('ok', true, 'reservation', row_to_json(v_row));
end $$;

-- ---- 4-6. 예약 취소 ----
--  스태프는 그냥 취소할 수 있고,
--  관람객 본인은 이름 + 연락처가 그 예약과 일치해야 취소됩니다.
create or replace function public.cancel_reservation(
  p_id uuid, p_name text default null, p_phone text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare v_row reservations;
begin
  select * into v_row from reservations where id = p_id and status = 'reserved' for update;
  if not found then
    return json_build_object('ok', false, 'reason', 'notfound');
  end if;

  if not public.is_staff() then
    if v_row.phone_key <> regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g')
       or v_row.name_key <> lower(regexp_replace(coalesce(p_name,''), '\s', '', 'g')) then
      return json_build_object('ok', false, 'reason', 'forbidden');
    end if;
    if v_row.checked_in then
      return json_build_object('ok', false, 'reason', 'checkedin');
    end if;
  end if;

  update reservations set status = 'cancelled' where id = p_id;
  return json_build_object('ok', true);
end $$;

-- ---- 4-7. 전체 초기화 — 스태프 전용 (테스트 데이터 정리용) ----
create or replace function public.admin_clear_reservations()
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then
    return json_build_object('ok', false, 'reason', 'forbidden');
  end if;
  update reservations set status = 'cancelled' where status = 'reserved';
  return json_build_object('ok', true);
end $$;

-- ---- 4-8. 간편 회원 ----
create or replace function public.member_sign_up(
  p_name text, p_phone text, p_email text, p_password text
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare m public.members;
begin
  if length(coalesce(p_password,'')) < 4 then
    return jsonb_build_object('ok', false, 'reason', 'weak');
  end if;
  if exists (select 1 from public.members where phone = p_phone) then
    return jsonb_build_object('ok', false, 'reason', 'dup');
  end if;
  insert into public.members (name, phone, email, pass_hash)
  values (btrim(p_name), btrim(p_phone), nullif(btrim(coalesce(p_email,'')),''), crypt(p_password, gen_salt('bf')))
  returning * into m;
  return jsonb_build_object('ok', true, 'member',
    jsonb_build_object('id', m.id, 'name', m.name, 'phone', m.phone, 'email', coalesce(m.email,'')));
end $$;

create or replace function public.member_sign_in(
  p_phone text, p_password text
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare m public.members;
begin
  select * into m from public.members where phone = p_phone;
  if m.id is null then
    return jsonb_build_object('ok', false, 'reason', 'nomember');
  end if;
  if m.pass_hash <> crypt(p_password, m.pass_hash) then
    return jsonb_build_object('ok', false, 'reason', 'badcred');
  end if;
  return jsonb_build_object('ok', true, 'member',
    jsonb_build_object('id', m.id, 'name', m.name, 'phone', m.phone, 'email', coalesce(m.email,'')));
end $$;

-- ---- 4-9. 프레스 방문 신청 ----
create or replace function public.press_apply(
  p_media text, p_reporter text, p_phone text, p_email text,
  p_types text, p_days text, p_note text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.press_applications; v_pkey text;
begin
  if not public.press_open() then
    return jsonb_build_object('ok', false, 'reason', 'notopen');
  end if;

  v_pkey := regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g');
  if length(v_pkey) < 9 then
    return jsonb_build_object('ok', false, 'reason', 'badphone');
  end if;
  if exists (select 1 from public.press_applications
             where phone_key = v_pkey and status <> 'rejected') then
    return jsonb_build_object('ok', false, 'reason', 'dup');
  end if;
  insert into public.press_applications (media, reporter, phone, email, types, days, note)
  values (btrim(p_media), btrim(p_reporter), btrim(p_phone),
          nullif(btrim(coalesce(p_email,'')),''), p_types, p_days, p_note)
  returning * into a;
  return jsonb_build_object('ok', true, 'application', to_jsonb(a));
end $$;

-- 신청자 본인 조회 : 기자명 + 연락처 둘 다 일치해야 합니다.
create or replace function public.press_lookup(p_phone text, p_reporter text)
returns setof public.press_applications
language sql security definer set search_path = public as $$
  select * from public.press_applications
  where phone_key    = regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g')
    and reporter_key = lower(regexp_replace(coalesce(p_reporter,''), '\s', '', 'g'))
    and length(regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g')) >= 9
    and coalesce(btrim(p_reporter), '') <> ''
  order by created_at desc;
$$;

create or replace function public.press_set_status(p_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.press_applications; new_code text; v_try int := 0;
begin
  if not public.is_staff() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into a from public.press_applications where id = p_id for update;
  if a.id is null then
    return jsonb_build_object('ok', false, 'reason', 'notfound');
  end if;
  if p_status = 'approved' and a.code is null then
    loop
      v_try := v_try + 1;
      new_code := 'PRS-' || (
        select string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ',
                                 1 + floor(random() * 32)::int, 1), '')
        from generate_series(1, 6)
      );
      exit when not exists (select 1 from public.press_applications where code = new_code);
      if v_try >= 20 then
        return jsonb_build_object('ok', false, 'reason', 'codefail');
      end if;
    end loop;
    a.code := new_code;
  end if;
  update public.press_applications set status = p_status, code = a.code where id = p_id
  returning * into a;
  return jsonb_build_object('ok', true, 'application', to_jsonb(a));
end $$;

-- 코드로 찾기 : 스태프 전용 (관람 예약과 동일한 이유)
create or replace function public.press_find(p_code text)
returns setof public.press_applications
language sql security definer set search_path = public as $$
  select * from public.press_applications
  where public.is_staff()
    and code = btrim(p_code)
    and status = 'approved';
$$;

create or replace function public.press_check_in(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.press_applications;
begin
  if not public.is_staff() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into a from public.press_applications
    where code = btrim(p_code) and status = 'approved' for update;
  if a.id is null then
    return jsonb_build_object('ok', false, 'reason', 'notfound');
  end if;
  if a.checked_in then
    return jsonb_build_object('ok', false, 'reason', 'already', 'application', to_jsonb(a));
  end if;
  update public.press_applications set checked_in = true, checked_in_at = now()
    where id = a.id returning * into a;
  return jsonb_build_object('ok', true, 'application', to_jsonb(a));
end $$;

create or replace function public.press_undo_check_in(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.press_applications;
begin
  if not public.is_staff() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  update public.press_applications set checked_in = false, checked_in_at = null
    where id = p_id returning * into a;
  return jsonb_build_object('ok', true, 'application', to_jsonb(a));
end $$;

-- ---- 4-9b. 쇼의 예약 방식 바꾸기 (스태프 전용) ----
--  이미 관람객 예약이 들어온 뒤 방식을 바꾸면 기존 예약의 좌석 정보가
--  현재 방식과 어긋나므로, 예약이 있으면 막는다.
create or replace function public.set_seating_mode(p_show_id text, p_mode text)
returns json language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.is_staff() then
    return json_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_mode not in ('assigned', 'free') then
    return json_build_object('ok', false, 'reason', 'badmode');
  end if;
  select count(*) into v_n from reservations
    where show_id = p_show_id and status = 'reserved' and source = 'web';
  if v_n > 0 then
    return json_build_object('ok', false, 'reason', 'hasreservations', 'count', v_n);
  end if;
  update shows set seating_mode = p_mode where id = p_show_id;
  return json_build_object('ok', true, 'mode', p_mode);
end $$;

-- ---- 4-10. 좌석 배치도 (공개) : 개인정보 없이 자리 상태만 ----
create or replace function public.seat_map(p_show_id text, p_zone_code text)
returns table (seat_id text, num int, tier int, row_no int, status text)
language sql security definer set search_path = public as $$
  select s.id, s.num, s.tier, s.row_no,
    case
      when k.seat_id is not null then coalesce(k.kind, 'invite')
      when r.id is not null      then 'taken'
      else 'free'
    end
  from seats s
  left join show_seat_locks k
         on k.show_id = p_show_id and k.seat_id = s.id
  left join reservations r
         on r.show_id = p_show_id and r.seat_id = s.id and r.status = 'reserved'
  where s.zone_code = p_zone_code
  order by s.tier, s.row_no;
$$;

-- ---- 4-11. 초청석 잠그기/풀기 (스태프 전용) ----
--  p_kind 가 null 이면 잠금 해제.
create or replace function public.seat_lock_set(
  p_show_id text, p_seat_ids text[], p_kind text, p_note text default null
) returns json language plpgsql security definer set search_path = public as $$
declare v_n int := 0;
begin
  if not public.is_staff() then
    return json_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_seat_ids is null or array_length(p_seat_ids, 1) is null then
    return json_build_object('ok', false, 'reason', 'noseats');
  end if;

  if p_kind is null then
    delete from show_seat_locks
     where show_id = p_show_id and seat_id = any(p_seat_ids);
    get diagnostics v_n = row_count;
    return json_build_object('ok', true, 'unlocked', v_n);
  end if;

  -- 이미 관람객이 예약한 자리는 잠글 수 없다
  if exists (select 1 from reservations
             where show_id = p_show_id and seat_id = any(p_seat_ids)
               and status = 'reserved' and source = 'web') then
    return json_build_object('ok', false, 'reason', 'occupied');
  end if;

  insert into show_seat_locks (show_id, seat_id, kind, note)
  select p_show_id, sid, p_kind, p_note from unnest(p_seat_ids) as sid
  on conflict (show_id, seat_id) do update
    set kind = excluded.kind, note = excluded.note;
  get diagnostics v_n = row_count;
  return json_build_object('ok', true, 'locked', v_n);
end $$;

-- ---- 4-12. 초청자 배정 (스태프 전용) ----
--  잠가둔 초청석에 명단을 넣는다. 일반 예약과 같은 형태로 저장되므로
--  QR 발급·현장 체크인·명단 내려받기가 전부 동일하게 동작한다.
create or replace function public.invite_assign(
  p_show_id text, p_seat_id text, p_name text,
  p_phone text default null, p_org text default null, p_title text default null
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_show shows; v_seat seats; v_zone zones; v_row reservations;
  v_code text; v_try int := 0; v_pkey text;
begin
  if not public.is_staff() then
    return json_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if coalesce(btrim(p_name), '') = '' then
    return json_build_object('ok', false, 'reason', 'badname');
  end if;

  select * into v_show from shows where id = p_show_id for update;
  if not found then return json_build_object('ok', false, 'reason', 'noshow'); end if;
  select * into v_seat from seats where id = p_seat_id;
  if not found then return json_build_object('ok', false, 'reason', 'noseat'); end if;
  select * into v_zone from zones where code = v_seat.zone_code;

  if exists (select 1 from reservations
             where show_id = p_show_id and seat_id = p_seat_id and status = 'reserved') then
    return json_build_object('ok', false, 'reason', 'taken');
  end if;

  v_pkey := nullif(regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g'), '');
  if v_pkey is not null and exists (
       select 1 from reservations
        where show_id = p_show_id and phone_key = v_pkey and status = 'reserved') then
    return json_build_object('ok', false, 'reason', 'dup');
  end if;

  loop
    v_try := v_try + 1;
    v_code := v_show.id || '-' || (
      select string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ',
                               1 + floor(random() * 32)::int, 1), '')
      from generate_series(1, 6));
    exit when not exists (select 1 from reservations where code = v_code);
    if v_try >= 20 then return json_build_object('ok', false, 'reason', 'codefail'); end if;
  end loop;

  insert into reservations
    (code, show_id, show_title, title_ko, lineup, day, date, start_time, end_time, venue,
     name, phone, email, marketing, seat_id, seat_label, source, guest_org, guest_title)
  values
    (v_code, v_show.id, v_show.title, v_show.title_ko, v_show.lineup, v_show.day, v_show.date,
     v_show.start_time, v_show.end_time, v_show.venue,
     btrim(p_name), nullif(btrim(coalesce(p_phone,'')), ''), null, false,
     v_seat.id, v_zone.label || ' ' || v_seat.num || '번', 'invite',
     nullif(btrim(coalesce(p_org,'')), ''), nullif(btrim(coalesce(p_title,'')), ''))
  returning * into v_row;

  return json_build_object('ok', true, 'reservation', row_to_json(v_row));
end $$;

-- ---- 4-13. 좌석 현황판 (스태프 전용) : 누가 어느 자리인지 ----
create or replace function public.seat_admin_map(p_show_id text)
returns table (
  seat_id text, zone_code text, zone_label text, num int, tier int, row_no int,
  status text, name text, guest_org text, guest_title text, phone text,
  code text, checked_in boolean, source text, lock_note text
) language sql security definer set search_path = public as $$
  select s.id, s.zone_code, z.label, s.num, s.tier, s.row_no,
    case
      when r.id is not null      then 'taken'
      when k.seat_id is not null then coalesce(k.kind, 'invite')
      else 'free'
    end,
    r.name, r.guest_org, r.guest_title, r.phone, r.code, r.checked_in, r.source, k.note
  from seats s
  join zones z on z.code = s.zone_code
  left join show_seat_locks k
         on k.show_id = p_show_id and k.seat_id = s.id
  left join reservations r
         on r.show_id = p_show_id and r.seat_id = s.id and r.status = 'reserved'
  where public.is_staff()
  order by z.side desc, z.sort, s.tier, s.row_no;
$$;

-- =====================================================================
--  5. 보안 : 표에 직접 접근하는 길을 전부 막습니다
--     브라우저에 실리는 공개 키로는 위 함수만 부를 수 있습니다.
-- =====================================================================

alter table public.shows              enable row level security;
alter table public.zones              enable row level security;
alter table public.seats              enable row level security;
alter table public.show_seat_locks    enable row level security;
-- zones / seats / show_seat_locks : 정책 없음 = 직접 접근 차단.
-- 좌석 정보는 zone_availability 뷰와 seat_map() 함수로만 나간다.
alter table public.reservations       enable row level security;
alter table public.members            enable row level security;
alter table public.press_applications enable row level security;

-- shows : 일정·정원은 공개 정보
drop policy if exists "shows readable" on public.shows;
create policy "shows readable" on public.shows for select using (true);

-- reservations : 로그인한 스태프만 직접 열람 (관리자 명단 화면)
drop policy if exists "staff read reservations" on public.reservations;
create policy "staff read reservations" on public.reservations
  for select to authenticated using (true);

-- members : 직접 접근 전면 금지 (정책 없음 = 기본 거부)

-- press_applications : 스태프만 열람/삭제
drop policy if exists "staff read press" on public.press_applications;
create policy "staff read press" on public.press_applications
  for select to authenticated using (true);
drop policy if exists "staff delete press" on public.press_applications;
create policy "staff delete press" on public.press_applications
  for delete to authenticated using (true);

-- ---- 실행 권한 ----
-- 먼저 전부 회수한 뒤, 필요한 것만 다시 부여합니다.
-- ===================================================================
--  사전 좌석 확보 (브랜드 · 대학 자율 선택)
--
--  브랜드는 VIP 자리를, 대학은 관계자 자리를 미리 확보한다. 예전에는
--  구글 시트/폼으로 받았는데, 그러면 확보한 자리가 일반 예약에서
--  빠지지 않아 손으로 옮겨야 했다. 여기서는 확보하는 순간 바로
--  show_seat_locks 에 들어가므로 일반 정원이 자동으로 줄어든다.
--
--  로그인을 만들지 않는다. 링크에 들어간 토큰이 열쇠다.
--  각 브랜드/학교는 자기 몫만 만질 수 있고, 남의 확보분이나 스태프가
--  잠근 자리(내빈석 등)는 건드릴 수 없다.
-- ===================================================================
create table if not exists public.seat_holders (
  id            uuid primary key default gen_random_uuid(),
  token         text unique not null,           -- 링크에 들어가는 열쇠
  show_id       text not null references public.shows(id),
  name          text not null,                  -- '메르최' | '동서대학교'
  kind          text not null default 'brand',  -- 'brand'(브랜드) | 'univ'(대학)
  max_seats     int,                            -- 확보 한도. null = 제한 없음
  zones         text[],                         -- 고를 수 있는 구역. null = 전 구역
  close_at      timestamptz,                    -- 이 시각 이후 수정 불가
  contact_name  text,                           -- 마지막으로 저장한 담당자
  contact_phone text,
  saved_at      timestamptz,                    -- 마지막 저장 시각
  created_at    timestamptz default now(),
  unique (show_id, name)
);
create index if not exists idx_holders_show on public.seat_holders(show_id);
alter table public.seat_holders enable row level security;  -- 정책 없음 = 직접 접근 차단

-- 좌석 단위 배정. 한 쇼에 여러 참여사가 있으면 주최측이 협의 결과대로
-- 좌석을 나눠준다(구역 통째로도, 몇 석씩도). 참여사는 이 안에서만 확보한다.
--   null = 제한 없음(전 좌석) / '{}' = 아무 좌석도 고를 수 없음
alter table public.seat_holders add column if not exists allowed_seats text[];

-- 창구는 참여사마다 따로 연다. 브랜드와 대학의 확보 기간이 다르기 때문.
--   false(기본) = 링크로 볼 수만 있음 / true = 고르고 저장할 수 있음
-- 새로 추가한 참여사는 닫힌 채로 시작한다. 주최측이 '열기'를 눌러야 열린다.
alter table public.seat_holders add column if not exists is_open   boolean not null default false;
alter table public.seat_holders add column if not exists opened_at timestamptz;  -- 마지막으로 열거나 닫은 시각

-- ---- 저장 이력 (덧붙이기만 한다. 지우거나 고치지 않는다) ----
--  저장할 때마다 '바꾸기 전'과 '바꾼 후'의 좌석 목록을 통째로 남긴다.
--  브랜드가 실수로 전부 지웠거나, 누가 언제 무엇을 바꿨는지 따져야 할 때
--  이 기록만 있으면 되돌릴 수 있다. 조사 결과 그 자체가 자산이므로
--  현재 상태(show_seat_locks)와 별도로 보관한다.
create table if not exists public.seat_hold_log (
  id            bigserial primary key,
  holder_id     uuid,                      -- 참여사가 지워져도 이력은 남는다
  show_id       text not null,
  holder_name   text not null,             -- 그 시점의 이름을 박아둔다
  action        text not null,             -- 'save' | 'restore' | 'delete' | 'allot' | 'reallot' | 'staff'
  prev_seat_ids text[] not null default '{}',   -- 바꾸기 전
  seat_ids      text[] not null default '{}',   -- 바꾼 후
  prev_count    int not null default 0,
  seat_count    int not null default 0,
  contact_name  text,
  contact_phone text,
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_holdlog_holder on public.seat_hold_log(holder_id);
create index if not exists idx_holdlog_show   on public.seat_hold_log(show_id, created_at desc);
alter table public.seat_hold_log enable row level security;  -- 정책 없음 = 직접 접근 차단

-- 어느 좌석이 누구 몫인지. null 이면 스태프가 잠근 자리(내빈석 등).
alter table public.show_seat_locks
  add column if not exists holder_id uuid references public.seat_holders(id) on delete cascade;
create index if not exists idx_locks_holder on public.show_seat_locks(holder_id);

-- ---- 링크로 보는 화면 : 내 정보 + 쇼 정보 + 좌석 상태 ----
create or replace function public.holder_view(p_token text)
returns json language plpgsql security definer set search_path = public as $fn$
declare
  h       public.seat_holders;
  v_show  public.shows;
  v_seats json;
  v_close timestamptz;
begin
  select * into h from seat_holders where token = btrim(p_token);
  if not found then
    return json_build_object('ok', false, 'reason', 'badtoken');
  end if;
  select * into v_show from shows where id = h.show_id;
  -- 기한은 두지 않는다. 스태프가 창구를 열어둔 동안에만 수정할 수 있다.
  -- (close_at 은 특정 참여사만 따로 마감해야 할 때를 위해 남겨둔다)
  v_close := h.close_at;

  select json_agg(x order by x.zone_code, x.num) into v_seats from (
    select s.id, s.zone_code, s.num, s.tier, s.row_no,
           case
             when l.holder_id = h.id      then 'mine'
             when l.holder_id is not null then 'other'
             when l.seat_id  is not null  then 'staff'
             when r.seat_id  is not null  then 'reserved'
             else 'free'
           end as state
      from seats s
      left join show_seat_locks l on l.show_id = h.show_id and l.seat_id = s.id
      left join reservations    r on r.show_id = h.show_id and r.seat_id = s.id
                                 and r.status = 'reserved'
  ) x;

  return json_build_object(
    'ok', true,
    'holder', json_build_object(
      'name', h.name, 'kind', h.kind,
      'maxSeats', h.max_seats, 'zones', h.zones, 'allowedSeats', h.allowed_seats,
      'closeAt', v_close,
      'closed', (not h.is_open) or (v_close is not null and now() >= v_close),
      'contactName', h.contact_name, 'contactPhone', h.contact_phone,
      'savedAt', h.saved_at),
    'show', json_build_object(
      'id', v_show.id, 'titleKo', v_show.title_ko, 'lineup', v_show.lineup,
      'date', v_show.date, 'startTime', v_show.start_time, 'venue', v_show.venue,
      'capacity', v_show.capacity),
    'zones', (select json_agg(json_build_object(
                'code', z.code, 'label', z.label, 'side', z.side,
                'rows', z.rows_count, 'tiers', z.tiers, 'seatCount', z.seat_count)
                order by z.side, z.sort) from zones z),
    'seats', coalesce(v_seats, '[]'::json),
    'lockedTotal', (select count(*) from show_seat_locks where show_id = h.show_id)
  );
end $fn$;

-- ---- 확보 좌석 저장 : 보낸 목록으로 '내 몫'을 통째로 바꾼다 ----
--  더하고 빼는 방식보다 단순하고, 같은 요청을 두 번 보내도 결과가 같다.
create or replace function public.holder_set(
  p_token text, p_seat_ids text[],
  p_contact_name text default null, p_contact_phone text default null
) returns json language plpgsql security definer set search_path = public as $fn$
declare
  h       public.seat_holders;
  v_show  public.shows;
  v_close timestamptz;
  v_ids   text[] := coalesce(p_seat_ids, '{}');
  v_bad   text[];
  v_taken text[];
  v_prev  text[];
begin
  select * into h from seat_holders where token = btrim(p_token);
  if not found then
    return json_build_object('ok', false, 'reason', 'badtoken');
  end if;

  -- 같은 쇼에 여러 참여사가 동시에 저장할 수 있다. 쇼 행을 잠가 순서를 만든다.
  select * into v_show from shows where id = h.show_id for update;
  -- 창구 상태는 쇼를 잠근 '뒤에' 다시 읽는다. 화면을 연 사이 주최측이 닫았을 수 있다.
  select * into h from seat_holders where id = h.id;
  if not found or not h.is_open then
    return json_build_object('ok', false, 'reason', 'closed');
  end if;
  v_close := h.close_at;
  if v_close is not null and now() >= v_close then
    return json_build_object('ok', false, 'reason', 'closed');
  end if;

  if h.max_seats is not null and coalesce(array_length(v_ids, 1), 0) > h.max_seats then
    return json_build_object('ok', false, 'reason', 'overmax', 'maxSeats', h.max_seats);
  end if;

  select array_agg(sid) into v_bad
    from unnest(v_ids) sid
   where not exists (select 1 from seats where id = sid);
  if v_bad is not null then
    return json_build_object('ok', false, 'reason', 'badseat', 'seats', v_bad);
  end if;

  if h.zones is not null then
    select array_agg(s.id) into v_bad
      from seats s where s.id = any(v_ids) and not (s.zone_code = any(h.zones));
    if v_bad is not null then
      return json_build_object('ok', false, 'reason', 'badzone', 'seats', v_bad);
    end if;
  end if;

  -- 주최측이 좌석 단위로 나눠준 범위 밖
  if h.allowed_seats is not null then
    select array_agg(sid) into v_bad
      from unnest(v_ids) sid where not (sid = any(h.allowed_seats));
    if v_bad is not null then
      return json_build_object('ok', false, 'reason', 'notallowed', 'seats', v_bad);
    end if;
  end if;

  -- 남이 이미 확보했거나 스태프가 잠근 자리
  select array_agg(seat_id) into v_taken
    from show_seat_locks
   where show_id = h.show_id and seat_id = any(v_ids)
     and (holder_id is null or holder_id <> h.id);
  if v_taken is not null then
    return json_build_object('ok', false, 'reason', 'taken', 'seats', v_taken);
  end if;

  -- 이미 관람객이 예약한 자리 (지정좌석 쇼에서만 생길 수 있다)
  select array_agg(seat_id) into v_taken
    from reservations
   where show_id = h.show_id and seat_id = any(v_ids) and status = 'reserved';
  if v_taken is not null then
    return json_build_object('ok', false, 'reason', 'occupied', 'seats', v_taken);
  end if;

  -- 바꾸기 전 상태를 먼저 담아둔다 (이력에 남겨 되돌릴 수 있게)
  select coalesce(array_agg(seat_id order by seat_id), '{}') into v_prev
    from show_seat_locks where show_id = h.show_id and holder_id = h.id;

  delete from show_seat_locks where show_id = h.show_id and holder_id = h.id;
  if coalesce(array_length(v_ids, 1), 0) > 0 then
    insert into show_seat_locks (show_id, seat_id, kind, note, holder_id)
    select h.show_id, sid, 'invite', h.name, h.id from unnest(v_ids) sid;
  end if;

  insert into seat_hold_log (holder_id, show_id, holder_name, action,
                             prev_seat_ids, seat_ids, prev_count, seat_count,
                             contact_name, contact_phone)
  values (h.id, h.show_id, h.name, 'save',
          v_prev, v_ids,
          coalesce(array_length(v_prev, 1), 0), coalesce(array_length(v_ids, 1), 0),
          nullif(btrim(p_contact_name), ''), nullif(btrim(p_contact_phone), ''));

  update seat_holders
     set contact_name  = coalesce(nullif(btrim(p_contact_name), ''), contact_name),
         contact_phone = coalesce(nullif(btrim(p_contact_phone), ''), contact_phone),
         saved_at      = now()
   where id = h.id;

  return json_build_object(
    'ok', true,
    'saved', coalesce(array_length(v_ids, 1), 0),
    'publicRemaining', greatest(0, v_show.capacity -
      (select count(*) from show_seat_locks where show_id = h.show_id))
  );
end $fn$;

-- ---- 링크 만들기 (스태프 전용) ----
--  같은 쇼·같은 이름으로 다시 부르면 링크를 유지한 채 조건만 바꾼다.
create or replace function public.holder_upsert(
  p_show_id text, p_name text, p_kind text default 'brand',
  p_max_seats int default null, p_zones text[] default null,
  p_close_at timestamptz default null
) returns json language plpgsql security definer set search_path = public as $fn$
declare h public.seat_holders;
begin
  if not public.is_staff() then
    return json_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into h from seat_holders where show_id = p_show_id and name = btrim(p_name);
  if found then
    update seat_holders
       set kind = p_kind, max_seats = p_max_seats, zones = p_zones,
           close_at = coalesce(p_close_at, close_at)
     where id = h.id returning * into h;
  else
    insert into seat_holders (token, show_id, name, kind, max_seats, zones, close_at)
    values (replace(gen_random_uuid()::text, '-', ''), p_show_id, btrim(p_name),
            p_kind, p_max_seats, p_zones, p_close_at)
    returning * into h;
  end if;
  return json_build_object(
    'ok', true, 'id', h.id, 'token', h.token, 'name', h.name, 'showId', h.show_id,
    -- 구역을 좁혔는데 이미 고른 좌석이 새 구역 밖에 있으면 알려준다.
    -- 참여사가 다음에 저장할 때 그 좌석은 풀리게 된다.
    'outOfZone', case when h.zones is null then 0 else (
       select count(*) from show_seat_locks l join seats se on se.id = l.seat_id
        where l.holder_id = h.id and not (se.zone_code = any(h.zones))) end
  );
end $fn$;

-- ---- 저장 이력 조회 (스태프 전용) ----
create or replace function public.hold_log(p_show_id text default null, p_limit int default 500)
returns table (
  id bigint, show_id text, holder_name text, action text,
  prev_count int, seat_count int, seat_ids text[], prev_seat_ids text[],
  contact_name text, contact_phone text, created_at timestamptz
) language sql stable security definer set search_path = public as $fn$
  select l.id, l.show_id, l.holder_name, l.action,
         l.prev_count, l.seat_count, l.seat_ids, l.prev_seat_ids,
         l.contact_name, l.contact_phone, l.created_at
    from seat_hold_log l
   where public.is_staff()
     and (p_show_id is null or l.show_id = p_show_id)
   order by l.created_at desc
   limit greatest(1, least(coalesce(p_limit, 500), 5000))
$fn$;

-- ---- 이력의 한 시점으로 되돌리기 (스태프 전용) ----
--  실수로 지웠거나 잘못 덮어썼을 때 쓴다. 되돌리는 것도 이력에 남는다.
create or replace function public.hold_restore(p_log_id bigint, p_which text default 'prev')
returns json language plpgsql security definer set search_path = public as $fn$
declare
  g       public.seat_hold_log;
  h       public.seat_holders;
  v_ids   text[];
  v_prev  text[];
  v_taken text[];
begin
  if not public.is_staff() then
    return json_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into g from seat_hold_log where id = p_log_id;
  if not found then
    return json_build_object('ok', false, 'reason', 'nolog');
  end if;
  -- 'allot'(배정 변경)·'staff'(주최측 확보)는 좌석 확보 상태가 아니라
  -- 되돌리면 엉뚱한 좌석이 확보된다. 참여사의 확보 이력만 되돌린다.
  if g.action not in ('save', 'restore', 'reallot') then
    return json_build_object('ok', false, 'reason', 'notrestorable');
  end if;
  select * into h from seat_holders where id = g.holder_id;
  if not found then
    return json_build_object('ok', false, 'reason', 'noholder');
  end if;

  v_ids := case when p_which = 'after' then g.seat_ids else g.prev_seat_ids end;
  perform 1 from shows where id = h.show_id for update;

  -- 그 사이 배정이 바뀌어 지금은 이 참여사 범위 밖인 좌석이 있으면 되돌리지 않는다.
  -- 그대로 되돌리면 남에게 배정된 좌석을 쥐게 되어 상태가 꼬인다.
  if h.allowed_seats is not null then
    select array_agg(sid order by sid) into v_taken
      from unnest(v_ids) sid where not (sid = any(h.allowed_seats));
    if v_taken is not null then
      return json_build_object('ok', false, 'reason', 'notallowed', 'seats', v_taken);
    end if;
  end if;

  -- 그 사이 남이 차지한 자리가 있으면 그대로는 되돌릴 수 없다
  select array_agg(seat_id) into v_taken
    from show_seat_locks
   where show_id = h.show_id and seat_id = any(v_ids)
     and (holder_id is null or holder_id <> h.id);
  if v_taken is not null then
    return json_build_object('ok', false, 'reason', 'taken', 'seats', v_taken);
  end if;

  select coalesce(array_agg(seat_id order by seat_id), '{}') into v_prev
    from show_seat_locks where show_id = h.show_id and holder_id = h.id;

  delete from show_seat_locks where show_id = h.show_id and holder_id = h.id;
  if coalesce(array_length(v_ids, 1), 0) > 0 then
    insert into show_seat_locks (show_id, seat_id, kind, note, holder_id)
    select h.show_id, sid, 'invite', h.name, h.id from unnest(v_ids) sid;
  end if;

  insert into seat_hold_log (holder_id, show_id, holder_name, action,
                             prev_seat_ids, seat_ids, prev_count, seat_count, note)
  values (h.id, h.show_id, h.name, 'restore',
          v_prev, v_ids,
          coalesce(array_length(v_prev, 1), 0), coalesce(array_length(v_ids, 1), 0),
          '이력 #' || p_log_id || ' 의 ' || p_which || ' 상태로 되돌림');

  return json_build_object('ok', true, 'restored', coalesce(array_length(v_ids, 1), 0));
end $fn$;

-- ---- 확보 현황 한 장으로 내려받기 (스태프 전용) ----
--  좌석 하나가 한 줄. 엑셀로 열어 보관하거나 좌석 라벨 인쇄에 쓴다.
create or replace function public.hold_export()
returns table (
  show_id text, title_ko text, show_date text, start_time text,
  holder_name text, kind text, seat_id text, zone_code text, seat_num int,
  contact_name text, contact_phone text, saved_at timestamptz
) language sql stable security definer set search_path = public as $fn$
  select s.id, s.title_ko, s.date, s.start_time,
         coalesce(h.name, '(스태프 지정)'), coalesce(h.kind, 'staff'),
         l.seat_id, se.zone_code, se.num,
         h.contact_name, h.contact_phone, h.saved_at
    from show_seat_locks l
    join shows s  on s.id = l.show_id
    join seats se on se.id = l.seat_id
    left join seat_holders h on h.id = l.holder_id
   where public.is_staff()
   order by s.sort, coalesce(h.name, ''), se.zone_code, se.num
$fn$;

-- ---- 창구 열기/닫기 : 참여사별 (스태프 전용) ----
--  p_ids  : 이 참여사들만. null 이면 아래 조건에 맞는 참여사 전부
--  p_kind : 'brand' | 'univ' | null(전부)   — p_ids 가 null 일 때만 쓴다
--  바뀐 참여사마다 이력에 'open' / 'close' 로 남긴다.
--  돌려주는 holders 는 저장된 뒤 데이터베이스에서 다시 읽은 실제 상태다.
create or replace function public.holder_open_set(p_ids uuid[], p_open boolean, p_kind text default null)
returns json language plpgsql security definer set search_path = public as $fn$
declare
  v_open boolean := coalesce(p_open, false);
  v_ids  uuid[];
begin
  if not public.is_staff() then
    return json_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_kind is not null and p_kind not in ('brand', 'univ') then
    return json_build_object('ok', false, 'reason', 'badkind');
  end if;

  with t as (
    update seat_holders h
       set is_open = v_open, opened_at = now()
     where h.is_open is distinct from v_open
       and (case when p_ids is not null then h.id = any(p_ids)
                 else (p_kind is null or h.kind = p_kind) end)
    returning h.id, h.show_id, h.name, h.contact_name, h.contact_phone
  ), l as (
    insert into seat_hold_log (holder_id, show_id, holder_name, action,
                               prev_seat_ids, seat_ids, prev_count, seat_count,
                               contact_name, contact_phone, note)
    select t.id, t.show_id, t.name, case when v_open then 'open' else 'close' end,
           cur.ids, cur.ids, cardinality(cur.ids), cardinality(cur.ids),
           t.contact_name, t.contact_phone,
           case when v_open then '창구 열림' else '창구 닫힘' end
      from t
      cross join lateral (
        select coalesce(array_agg(seat_id order by seat_id), '{}') as ids
          from show_seat_locks where holder_id = t.id) cur
    returning holder_id
  )
  select coalesce(array_agg(holder_id), '{}') into v_ids from l;

  return json_build_object(
    'ok', true,
    'changed', cardinality(v_ids),
    'holders', (select coalesce(json_agg(json_build_object('id', h.id, 'name', h.name, 'isOpen', h.is_open)), '[]'::json)
                  from seat_holders h
                 where (case when p_ids is not null then h.id = any(p_ids)
                             else (p_kind is null or h.kind = p_kind) end))
  );
end $fn$;

-- (예전) 전체 스위치. 호환을 위해 남기되, 이제는 '참여사 전부 열기/닫기'와 같다.
create or replace function public.holds_set_open(p_open boolean)
returns json language plpgsql security definer set search_path = public as $fn$
declare r json;
begin
  if not public.is_staff() then
    return json_build_object('ok', false, 'reason', 'forbidden');
  end if;
  update app_settings set holds_open = coalesce(p_open, false), updated_at = now() where id;
  r := public.holder_open_set(null, p_open, null);
  return json_build_object('ok', true, 'changed', r->'changed');
end $fn$;

-- ---- 주최측 현황판 (스태프 전용) ----
--  스위치 상태, 쇼별 정원·예약·확보·일반잔여·예약방식, 참여사 전체를 한 번에.
--  예약을 열기 전 이상한 잠금(예: 테스트 잔여물)을 여기서 잡아낸다.
create or replace function public.holds_board()
returns json language plpgsql security definer set search_path = public as $fn$
begin
  if not public.is_staff() then
    return json_build_object('ok', false, 'reason', 'forbidden');
  end if;
  return json_build_object(
    'ok', true,
    'holdsOpen', public.holds_open(),
    'reservationsOpen', public.reservations_open(),
    'shows', (select coalesce(json_agg(x order by x.sort), '[]'::json) from (
       select s.id, s.title_ko, s.lineup, s.date, s.start_time, s.capacity, s.sort, s.seating_mode,
              (select count(*) from reservations r
                where r.show_id = s.id and r.status = 'reserved')                    as reserved,
              (select count(*) from show_seat_locks l where l.show_id = s.id)          as locked,
              (select count(*) from show_seat_locks l
                where l.show_id = s.id and l.holder_id is null)                        as staff_locked
         from shows s) x),
    'holders', (select coalesce(json_agg(y order by y.show_id, y.name), '[]'::json) from (
       select h.id, h.show_id, h.name, h.kind, h.max_seats, h.zones, h.token, h.allowed_seats,
              h.is_open, h.opened_at,
              (select count(*) from show_seat_locks l where l.holder_id = h.id) as held,
              h.contact_name, h.contact_phone, h.saved_at, h.created_at
         from seat_holders h) y)
  );
end $fn$;

-- ---- 참여사 삭제 (스태프 전용) ----
--  잡아둔 좌석은 함께 풀린다(show_seat_locks 가 cascade). 지우기 전에
--  무엇을 갖고 있었는지 이력에 통째로 남긴다 — 조사 결과를 잃지 않기 위해.
create or replace function public.holder_delete(p_id uuid)
returns json language plpgsql security definer set search_path = public as $fn$
declare
  h      public.seat_holders;
  v_prev text[];
begin
  if not public.is_staff() then
    return json_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into h from seat_holders where id = p_id;
  if not found then
    return json_build_object('ok', false, 'reason', 'noholder');
  end if;
  perform 1 from shows where id = h.show_id for update;

  select coalesce(array_agg(seat_id order by seat_id), '{}') into v_prev
    from show_seat_locks where holder_id = h.id;

  insert into seat_hold_log (holder_id, show_id, holder_name, action,
                             prev_seat_ids, seat_ids, prev_count, seat_count,
                             contact_name, contact_phone, note)
  values (h.id, h.show_id, h.name, 'delete',
          v_prev, '{}', coalesce(array_length(v_prev, 1), 0), 0,
          h.contact_name, h.contact_phone,
          '참여사 삭제 — 구분 ' || h.kind ||
          coalesce(' / 구역 ' || array_to_string(h.zones, ','), '') ||
          coalesce(' / 한도 ' || h.max_seats, ''));

  delete from seat_holders where id = h.id;
  return json_build_object('ok', true, 'released', coalesce(array_length(v_prev, 1), 0));
end $fn$;

-- ---- 쇼 하나의 좌석 지도 (스태프 전용) ----
--  주최측 화면 오른쪽 지도가 쓴다. 좌석마다 누가 확보했는지(lock),
--  일반 예약이 있는지(res). 배정 범위는 holders[].allowedSeats 로 판단한다.
create or replace function public.holds_show_map(p_show_id text)
returns json language plpgsql security definer set search_path = public as $fn$
declare v_show public.shows;
begin
  if not public.is_staff() then
    return json_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into v_show from shows where id = p_show_id;
  if not found then
    return json_build_object('ok', false, 'reason', 'noshow');
  end if;
  return json_build_object(
    'ok', true,
    'holdsOpen', public.holds_open(),
    'show', json_build_object(
      'id', v_show.id, 'titleKo', v_show.title_ko, 'lineup', v_show.lineup,
      'date', v_show.date, 'startTime', v_show.start_time,
      'capacity', v_show.capacity, 'seatingMode', v_show.seating_mode),
    'zones', (select json_agg(json_build_object(
                'code', z.code, 'label', z.label, 'side', z.side, 'rows', z.rows_count,
                'tiers', z.tiers, 'seatCount', z.seat_count, 'sort', z.sort)
                order by z.side, z.sort) from zones z),
    'holders', (select coalesce(json_agg(json_build_object(
                'id', h.id, 'name', h.name, 'kind', h.kind, 'maxSeats', h.max_seats,
                'token', h.token, 'allowedSeats', h.allowed_seats,
                'isOpen', h.is_open, 'openedAt', h.opened_at,
                'held', (select count(*) from show_seat_locks l where l.holder_id = h.id),
                'contactName', h.contact_name, 'contactPhone', h.contact_phone,
                'savedAt', h.saved_at, 'createdAt', h.created_at)
                order by h.created_at), '[]'::json)
                from seat_holders h where h.show_id = p_show_id),
    'seats', (select json_agg(json_build_object(
                'id', se.id, 'z', se.zone_code, 'n', se.num, 't', se.tier, 'r', se.row_no,
                'lock', case when l.seat_id is null then null
                             when l.holder_id is null then 'staff'
                             else l.holder_id::text end,
                'res', exists (select 1 from reservations r
                                where r.show_id = p_show_id and r.seat_id = se.id
                                  and r.status = 'reserved'))
                order by se.zone_code, se.num)
                from seats se
                left join show_seat_locks l on l.show_id = p_show_id and l.seat_id = se.id),
    'reserved', (select count(*) from reservations where show_id = p_show_id and status = 'reserved')
  );
end $fn$;

-- ---- 좌석 배정 (스태프 전용) ----
--  p_mode : 'set' 이 목록으로 교체 / 'add' 더하기 / 'remove' 빼기 / 'clear' 제한 없음으로
--  한 좌석은 한 참여사에게만 배정된다. 다른 참여사에 배정된 좌석을 넣으면
--  그쪽 배정에서 빠지고 이쪽으로 옮겨온다.
--  단, 그 좌석을 다른 참여사가 이미 '확보'했다면 그냥 옮기지 않는다
--  (heldbyother 로 알려준다). p_force=true 일 때만 그 확보를 풀고 옮기며,
--  푼 내용은 그 참여사 이력에 통째로 남긴다.
create or replace function public.holder_allot(
  p_holder_id uuid, p_seat_ids text[], p_mode text default 'set', p_force boolean default false
) returns json language plpgsql security definer set search_path = public as $fn$
declare
  h        public.seat_holders;
  oh       public.seat_holders;
  o        record;
  v_ids    text[] := coalesce(p_seat_ids, '{}');
  v_old    text[];
  v_new    text[];
  v_in     text[];
  v_bad    text[];
  v_held   text[];
  v_oprev  text[];
  v_oafter text[];
  v_moved  int := 0;
  v_rel    int := 0;
  v_n      int;
begin
  if not public.is_staff() then
    return json_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_mode not in ('set', 'add', 'remove', 'clear') then
    return json_build_object('ok', false, 'reason', 'badmode');
  end if;
  select * into h from seat_holders where id = p_holder_id;
  if not found then
    return json_build_object('ok', false, 'reason', 'noholder');
  end if;
  perform 1 from shows where id = h.show_id for update;

  select array_agg(sid) into v_bad
    from unnest(v_ids) sid where not exists (select 1 from seats where id = sid);
  if v_bad is not null then
    return json_build_object('ok', false, 'reason', 'badseat', 'seats', v_bad);
  end if;

  v_old := h.allowed_seats;

  if p_mode = 'clear' then
    v_new := null; v_in := '{}';
  elsif p_mode = 'add' then
    select coalesce(array_agg(distinct x order by x), '{}') into v_new
      from unnest(coalesce(v_old, '{}') || v_ids) x;
    v_in := v_ids;
  elsif p_mode = 'remove' then
    select coalesce(array_agg(x order by x), '{}') into v_new
      from unnest(coalesce(v_old, '{}')) x where not (x = any(v_ids));
    v_in := '{}';
  else
    select coalesce(array_agg(distinct x order by x), '{}') into v_new from unnest(v_ids) x;
    v_in := v_new;
  end if;

  -- 옮겨오려는 좌석을 다른 참여사가 이미 확보했는가
  select array_agg(l.seat_id order by l.seat_id) into v_held
    from show_seat_locks l
   where l.show_id = h.show_id and l.seat_id = any(v_in)
     and l.holder_id is not null and l.holder_id <> h.id;
  if v_held is not null and not p_force then
    return json_build_object('ok', false, 'reason', 'heldbyother', 'seats', v_held);
  end if;

  -- 강제로 옮기는 경우 : 다른 참여사의 확보를 풀고, 그 전 상태를 이력에 남긴다
  if v_held is not null then
    for o in select distinct l.holder_id as hid from show_seat_locks l
              where l.show_id = h.show_id and l.seat_id = any(v_held) and l.holder_id <> h.id
    loop
      select * into oh from seat_holders where id = o.hid;
      select coalesce(array_agg(seat_id order by seat_id), '{}') into v_oprev
        from show_seat_locks where holder_id = oh.id;
      delete from show_seat_locks where holder_id = oh.id and seat_id = any(v_held);
      get diagnostics v_n = row_count;
      v_rel := v_rel + v_n;
      select coalesce(array_agg(seat_id order by seat_id), '{}') into v_oafter
        from show_seat_locks where holder_id = oh.id;
      insert into seat_hold_log (holder_id, show_id, holder_name, action,
                                 prev_seat_ids, seat_ids, prev_count, seat_count,
                                 contact_name, contact_phone, note)
      values (oh.id, oh.show_id, oh.name, 'reallot',
              v_oprev, v_oafter,
              coalesce(array_length(v_oprev, 1), 0), coalesce(array_length(v_oafter, 1), 0),
              oh.contact_name, oh.contact_phone,
              '주최측이 좌석 배정을 ' || h.name || ' 에게 옮기면서 확보 해제');
    end loop;
  end if;

  -- 다른 참여사 배정에서 옮겨올 좌석을 뺀다.
  -- 빼앗긴 쪽 이력에도 남긴다 — 그래야 '왜 줄었는지'를 그 참여사 기준으로 추적할 수 있다.
  select count(distinct x) into v_moved
    from seat_holders oo, unnest(oo.allowed_seats) x
   where oo.show_id = h.show_id and oo.id <> h.id and x = any(v_in);
  for o in select oo.id as hid from seat_holders oo
            where oo.show_id = h.show_id and oo.id <> h.id and oo.allowed_seats && v_in
  loop
    select * into oh from seat_holders where id = o.hid;
    v_oprev := oh.allowed_seats;
    select coalesce(array_agg(x order by x), '{}') into v_oafter
      from unnest(oh.allowed_seats) x where not (x = any(v_in));
    update seat_holders set allowed_seats = v_oafter where id = oh.id;
    insert into seat_hold_log (holder_id, show_id, holder_name, action,
                               prev_seat_ids, seat_ids, prev_count, seat_count, note)
    values (oh.id, oh.show_id, oh.name, 'allot',
            v_oprev, v_oafter,
            coalesce(array_length(v_oprev, 1), 0), coalesce(array_length(v_oafter, 1), 0),
            '주최측이 배정 좌석 ' ||
            (coalesce(array_length(v_oprev, 1), 0) - coalesce(array_length(v_oafter, 1), 0)) ||
            '석을 ' || h.name || ' 에게 옮김');
  end loop;

  update seat_holders set allowed_seats = v_new where id = h.id;

  -- 배정 변경도 기록한다 (누가 언제 어떤 범위를 받았는지)
  insert into seat_hold_log (holder_id, show_id, holder_name, action,
                             prev_seat_ids, seat_ids, prev_count, seat_count, note)
  values (h.id, h.show_id, h.name, 'allot',
          coalesce(v_old, '{}'), coalesce(v_new, '{}'),
          coalesce(array_length(v_old, 1), 0), coalesce(array_length(v_new, 1), 0),
          '좌석 배정 ' || p_mode ||
          case when v_new is null then ' — 제한 없음(전 좌석)' else '' end ||
          case when v_moved > 0 then ' / 다른 참여사에서 ' || v_moved || '석 옮겨옴' else '' end);

  return json_build_object(
    'ok', true,
    'allotted', coalesce(array_length(v_new, 1), 0),
    'unlimited', v_new is null,
    'moved', v_moved,
    'released', v_rel,
    -- 이 참여사가 이미 확보한 좌석 중 새 배정 밖에 남은 것 (다음 저장 때 풀린다)
    'outOfAllot', case when v_new is null then 0 else (
       select count(*) from show_seat_locks l
        where l.holder_id = h.id and not (l.seat_id = any(v_new))) end
  );
end $fn$;

-- ---- 주최측 직접 확보 / 해제 (스태프 전용) ----
--  개막식 내빈석처럼 참여사 링크 없이 주최측이 잡는 좌석.
--  참여사가 이미 확보했거나 일반 예약이 있는 좌석은 건너뛰고 알려준다.
create or replace function public.staff_hold_set(p_show_id text, p_seat_ids text[], p_on boolean)
returns json language plpgsql security definer set search_path = public as $fn$
declare
  v_ids   text[] := coalesce(p_seat_ids, '{}');
  v_bad   text[];
  v_skip  text[];
  v_prev  text[];
  v_after text[];
  v_n     int := 0;
begin
  if not public.is_staff() then
    return json_build_object('ok', false, 'reason', 'forbidden');
  end if;
  perform 1 from shows where id = p_show_id for update;
  if not found then
    return json_build_object('ok', false, 'reason', 'noshow');
  end if;
  select array_agg(sid) into v_bad
    from unnest(v_ids) sid where not exists (select 1 from seats where id = sid);
  if v_bad is not null then
    return json_build_object('ok', false, 'reason', 'badseat', 'seats', v_bad);
  end if;

  select coalesce(array_agg(seat_id order by seat_id), '{}') into v_prev
    from show_seat_locks where show_id = p_show_id and holder_id is null;

  if p_on then
    select array_agg(sid order by sid) into v_skip
      from unnest(v_ids) sid
     where exists (select 1 from show_seat_locks l
                    where l.show_id = p_show_id and l.seat_id = sid and l.holder_id is not null)
        or exists (select 1 from reservations r
                    where r.show_id = p_show_id and r.seat_id = sid and r.status = 'reserved');
    insert into show_seat_locks (show_id, seat_id, kind, note, holder_id)
    select p_show_id, sid, 'invite', '주최측', null from unnest(v_ids) sid
     where not exists (select 1 from show_seat_locks l where l.show_id = p_show_id and l.seat_id = sid)
       and not exists (select 1 from reservations r
                        where r.show_id = p_show_id and r.seat_id = sid and r.status = 'reserved');
    get diagnostics v_n = row_count;
  else
    delete from show_seat_locks
     where show_id = p_show_id and holder_id is null and seat_id = any(v_ids);
    get diagnostics v_n = row_count;
  end if;

  select coalesce(array_agg(seat_id order by seat_id), '{}') into v_after
    from show_seat_locks where show_id = p_show_id and holder_id is null;

  if v_n > 0 then
    insert into seat_hold_log (holder_id, show_id, holder_name, action,
                               prev_seat_ids, seat_ids, prev_count, seat_count, note)
    values (null, p_show_id, '주최측', 'staff',
            v_prev, v_after,
            coalesce(array_length(v_prev, 1), 0), coalesce(array_length(v_after, 1), 0),
            case when p_on then '주최측 직접 확보 ' else '주최측 확보 해제 ' end || v_n || '석');
  end if;

  return json_build_object('ok', true, 'changed', v_n, 'skipped', coalesce(v_skip, '{}'));
end $fn$;

-- ---- 누가 몇 석 확보했는지 (스태프 전용) ----
create or replace function public.holder_list()
returns table (
  show_id text, title_ko text, name text, kind text,
  max_seats int, zones text[], close_at timestamptz,
  token text, held int, contact_name text, contact_phone text, saved_at timestamptz
) language sql stable security definer set search_path = public as $fn$
  select h.show_id, s.title_ko, h.name, h.kind,
         h.max_seats, h.zones, h.close_at,
         h.token,
         (select count(*)::int from show_seat_locks l where l.holder_id = h.id),
         h.contact_name, h.contact_phone, h.saved_at
    from seat_holders h
    join shows s on s.id = h.show_id
   where public.is_staff()
   order by s.sort, h.name
$fn$;

revoke all on function
  public.reserve_seat(text,text,text,text,text,boolean),
  public.seat_map(text,text),
  public.ticket_view(text[]),
  public.set_seating_mode(text,text),
  public.seat_lock_set(text,text[],text,text),
  public.invite_assign(text,text,text,text,text,text),
  public.seat_admin_map(text),
  public.lookup_reservations(text,text),
  public.find_reservation(text),
  public.staff_search(text),
  public.check_in(text),
  public.undo_check_in(uuid),
  public.cancel_reservation(uuid,text,text),
  public.admin_clear_reservations(),
  public.member_sign_up(text,text,text,text),
  public.member_sign_in(text,text),
  public.press_apply(text,text,text,text,text,text,text),
  public.press_lookup(text,text),
  public.press_set_status(uuid,text),
  public.press_find(text),
  public.press_check_in(text),
  public.press_undo_check_in(uuid),
  public.holder_view(text),
  public.holder_set(text,text[],text,text),
  public.holder_upsert(text,text,text,int,text[],timestamptz),
  public.holder_list(),
  public.hold_log(text,int),
  public.hold_restore(bigint,text),
  public.hold_export(),
  public.holds_set_open(boolean),
  public.holder_open_set(uuid[],boolean,text),
  public.holds_board(),
  public.holder_delete(uuid),
  public.is_staff(),
  public.holds_show_map(text),
  public.holder_allot(uuid,text[],text,boolean),
  public.staff_hold_set(text,text[],boolean)
  from public, anon, authenticated;

-- 관람객(비로그인)도 쓸 수 있는 것
grant execute on function public.reserve_seat(text,text,text,text,text,boolean) to anon, authenticated;
grant execute on function public.seat_map(text,text)                            to anon, authenticated;
grant execute on function public.ticket_view(text[])                            to anon, authenticated;
grant execute on function public.lookup_reservations(text,text)                 to anon, authenticated;
grant execute on function public.cancel_reservation(uuid,text,text)             to anon, authenticated;
grant execute on function public.member_sign_up(text,text,text,text)            to anon, authenticated;
grant execute on function public.member_sign_in(text,text)                      to anon, authenticated;
grant execute on function public.press_apply(text,text,text,text,text,text,text) to anon, authenticated;
grant execute on function public.press_lookup(text,text)                        to anon, authenticated;
-- 사전 좌석 확보 : 링크의 토큰이 열쇠라 비로그인도 쓸 수 있어야 한다
grant execute on function public.holder_view(text)                              to anon, authenticated;
grant execute on function public.holder_set(text,text[],text,text)              to anon, authenticated;

-- 로그인한 스태프만 쓸 수 있는 것
grant execute on function public.set_seating_mode(text,text)                      to authenticated;
grant execute on function public.seat_lock_set(text,text[],text,text)             to authenticated;
grant execute on function public.invite_assign(text,text,text,text,text,text)     to authenticated;
grant execute on function public.seat_admin_map(text)                             to authenticated;
grant execute on function public.find_reservation(text)        to authenticated;
grant execute on function public.staff_search(text)            to authenticated;
grant execute on function public.check_in(text)                to authenticated;
grant execute on function public.undo_check_in(uuid)           to authenticated;
grant execute on function public.admin_clear_reservations()    to authenticated;
grant execute on function public.holder_upsert(text,text,text,int,text[],timestamptz) to authenticated;
grant execute on function public.holder_list()                 to authenticated;
-- 스태프 화면이 로그인 직후 '명단에 있는가' 를 확인할 때 쓴다 (자기 자신에 대한 참/거짓만 돌려준다)
grant execute on function public.is_staff()                    to authenticated;
grant execute on function public.hold_log(text,int)            to authenticated;
grant execute on function public.hold_restore(bigint,text)     to authenticated;
grant execute on function public.hold_export()                 to authenticated;
grant execute on function public.holds_set_open(boolean)       to authenticated;
grant execute on function public.holder_open_set(uuid[],boolean,text) to authenticated;
grant execute on function public.holds_board()                 to authenticated;
grant execute on function public.holder_delete(uuid)           to authenticated;
grant execute on function public.holds_show_map(text)          to authenticated;
grant execute on function public.holder_allot(uuid,text[],text,boolean) to authenticated;
grant execute on function public.staff_hold_set(text,text[],boolean)    to authenticated;
grant execute on function public.press_set_status(uuid,text)   to authenticated;
grant execute on function public.press_find(text)              to authenticated;
grant execute on function public.press_check_in(text)          to authenticated;
grant execute on function public.press_undo_check_in(uuid)     to authenticated;

-- 잔여석(숫자만)은 공개
grant select on public.show_availability to anon, authenticated;

-- =====================================================================
--  6. 현장 스탠드석 인원 (예약 없이 오신 관람객)
--     관리자 → 현장 체크인 화면에서 쇼별 인원수를 직접 입력합니다.
-- =====================================================================

create table if not exists public.walkins (
  show_id    text primary key references public.shows(id),
  count      int  not null default 0 check (count >= 0),
  note       text,
  updated_at timestamptz default now()
);

alter table public.walkins enable row level security;
-- 정책을 만들지 않음 = 직접 접근 전면 차단. 아래 함수로만 오갑니다.

-- ---- 현장 인원 입력/수정 (스태프 전용) ----
--  같은 쇼를 다시 입력하면 덮어씁니다. 0 을 넣으면 0 으로 기록됩니다.
create or replace function public.walkin_set(
  p_show_id text, p_count int, p_note text default null
) returns json language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then
    return json_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if not exists (select 1 from shows where id = p_show_id) then
    return json_build_object('ok', false, 'reason', 'noshow');
  end if;
  if p_count is null or p_count < 0 or p_count > 100000 then
    return json_build_object('ok', false, 'reason', 'badcount');
  end if;

  insert into walkins (show_id, count, note, updated_at)
  values (p_show_id, p_count, nullif(btrim(coalesce(p_note,'')),''), now())
  on conflict (show_id) do update
    set count = excluded.count, note = excluded.note, updated_at = now();

  return json_build_object('ok', true, 'show_id', p_show_id, 'count', p_count);
end $$;

-- ---- 쇼별 입장 집계 : 예약 입장 + 현장 인원 (스태프 전용) ----
--  결과 예: S01 · 예약 300 · 입장확인 241 · 현장 57 · 합계 298
create or replace function public.attendance_stats()
returns table (
  show_id  text,
  title_ko text,
  day      int,
  reserved bigint,
  entered  bigint,
  walkin   int,
  total    bigint,
  note     text
) language sql security definer set search_path = public as $$
  select
    s.id,
    s.title_ko,
    s.day,
    count(r.*) filter (where r.status = 'reserved')                  as reserved,
    count(r.*) filter (where r.status = 'reserved' and r.checked_in) as entered,
    coalesce(w.count, 0)                                             as walkin,
    count(r.*) filter (where r.status = 'reserved' and r.checked_in)
      + coalesce(w.count, 0)                                         as total,
    w.note
  from shows s
  left join reservations r on r.show_id = s.id
  left join walkins w      on w.show_id = s.id
  where public.is_staff()
  group by s.id, s.title_ko, s.day, s.sort, w.count, w.note
  order by s.sort;
$$;

-- ---- 실행 권한 : 로그인한 스태프 전용 ----
revoke all on function
  public.walkin_set(text,int,text), public.attendance_stats()
  from public, anon, authenticated;

grant execute on function public.walkin_set(text,int,text) to authenticated;
grant execute on function public.attendance_stats()        to authenticated;

-- =====================================================================
--  7. 설치 확인
-- =====================================================================
select
  (select count(*) from public.shows)                             as 쇼_개수,
  (select sum(capacity) from public.shows)                        as 총_좌석,
  (select count(*) from public.shows where reserve_close_at is not null) as 마감시각_설정된_쇼,
  (select count(*) from public.zones)                             as 구역_개수,
  (select count(*) from public.notifications)                     as 발송이력,
  (select count(*) from public.seats)                             as 좌석_개수,
  (select count(*) from public.show_availability)                 as 잔여석_뷰,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('reserve_seat','lookup_reservations','find_reservation',
                         'staff_search','check_in','undo_check_in','cancel_reservation',
                         'admin_clear_reservations','member_sign_up','member_sign_in',
                         'press_apply','press_lookup','press_set_status','press_find',
                         'press_check_in','press_undo_check_in',
                         'walkin_set','attendance_stats',
                         'seat_map','seat_lock_set','invite_assign','seat_admin_map',
                         'ticket_view','set_seating_mode'))            as 기능_개수;
-- 기대값: 쇼_개수 13 · 총_좌석 3900 · 마감시각_설정된_쇼 13
--         구역_개수 8 · 좌석_개수 300 · 잔여석_뷰 13 · 기능_개수 24

-- =====================================================================
--  구역별 좌석 확인 (A~D 좌측 / E~H 우측, 무대에서 가까운 순)
-- =====================================================================
select z.side as 좌우, z.code as 구역, z.rows_count as 열수, z.tiers as 단수,
       z.seat_count as 정원, count(s.id) as 실제생성, min(s.num) as 첫번호, max(s.num) as 끝번호
from public.zones z left join public.seats s on s.zone_code = z.code
group by z.side, z.code, z.rows_count, z.tiers, z.seat_count, z.sort
order by z.side desc, z.sort;
-- 기대값: A~C·E~G 각 36석(1~36) · D·H 각 42석(1~42) · 합계 300석

-- =====================================================================
--  쇼별 예약 마감 시각 확인 (한국시간)
-- =====================================================================
select id, date as 쇼날짜,
       to_char(reserve_close_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as 예약마감,
       (now() >= reserve_close_at) as 지금마감됨
from public.shows order by sort;

-- ---------------------------------------------------------------------
--  [참고] 특정 쇼의 마감을 따로 조정할 때
--    update public.shows set reserve_close_at = timestamptz '2026-10-28 18:00+09' where id = 'S01';
--  [참고] 특정 쇼를 즉시 마감할 때
--    update public.shows set reserve_close_at = now() where id = 'S01';
--  [참고] 마감을 없앨 때
--    update public.shows set reserve_close_at = null where id = 'S01';
-- ---------------------------------------------------------------------
