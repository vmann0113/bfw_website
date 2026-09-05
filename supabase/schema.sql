-- =====================================================================
--  2026 부산패션위크 — 관람 예약 / 프레스 신청 백엔드 스키마
--  Supabase SQL Editor 에 전체를 붙여넣고 한 번 실행하세요.
--  여러 번 실행해도 안전합니다(같은 결과로 수렴).
--
--  작성: 2026-09-05
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
  sort        int  default 0
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

create index if not exists idx_resv_show  on public.reservations(show_id) where status = 'reserved';
create index if not exists idx_resv_phone on public.reservations(phone_key);

-- 한 연락처는 한 쇼에 1석 (취소분 제외 → 취소 후 재예약 가능)
create unique index if not exists uniq_active_seat
  on public.reservations(show_id, phone_key) where status = 'reserved';

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
  ('S12',3,'2026.10.31','토','16:00','16:30','Joint Show ⑩','연합쇼 ⑩','마르즈 · 미지미지 · 바주요','메인 런웨이',300,false,12),
  ('S13',3,'2026.10.31','토','17:30','18:00','Joint Show ⑪','연합쇼 ⑪','동서대학교','메인 런웨이',300,false,13)
on conflict (id) do update set
  day=excluded.day, date=excluded.date, dow=excluded.dow,
  start_time=excluded.start_time, end_time=excluded.end_time,
  title=excluded.title, title_ko=excluded.title_ko, lineup=excluded.lineup,
  venue=excluded.venue, capacity=excluded.capacity, tbd=excluded.tbd, sort=excluded.sort;

-- =====================================================================
--  3. 잔여석 뷰 — 공개(누구나 읽기). 개인정보는 담기지 않고 숫자만 나갑니다.
-- =====================================================================

create or replace view public.show_availability as
select
  s.id,
  s.capacity,
  count(r.*) filter (where r.status = 'reserved')                          as reserved,
  greatest(s.capacity - count(r.*) filter (where r.status = 'reserved'), 0) as remaining
from public.shows s
left join public.reservations r on r.show_id = s.id
group by s.id, s.capacity;

-- =====================================================================
--  4. 기능(함수)
--     · 표에 직접 손대는 길은 5번에서 모두 막습니다.
--     · 아래 함수를 통해서만 데이터가 오갑니다.
-- =====================================================================

-- ---- 4-1. 예약 : 선착순의 핵심 ----
--  같은 쇼의 동시 요청을 shows 행 잠금으로 한 줄로 세워, 정원을 절대 넘기지 않습니다.
create or replace function public.reserve_seat(
  p_show_id text, p_name text, p_phone text, p_email text, p_marketing boolean
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_show   shows;
  v_count  int;
  v_code   text;
  v_row    reservations;
  v_pkey   text;
  v_try    int := 0;
begin
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

  -- 같은 연락처가 이미 이 쇼를 예약했는가
  if exists (select 1 from reservations
             where show_id = p_show_id and phone_key = v_pkey and status = 'reserved') then
    return json_build_object('ok', false, 'reason', 'dup');
  end if;

  -- 정원 확인
  select count(*) into v_count from reservations
    where show_id = p_show_id and status = 'reserved';
  if v_count >= v_show.capacity then
    return json_build_object('ok', false, 'reason', 'full');
  end if;

  -- 예약번호 발급 : 6자리. 혼동 글자(0,1,O,I)를 쓰지 않습니다.
  -- 충돌하면 다시 뽑습니다(최대 20회) — 잘못된 '중복' 안내를 막기 위함.
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
     name, phone, email, marketing)
  values
    (v_code, v_show.id, v_show.title, v_show.title_ko, v_show.lineup, v_show.day, v_show.date,
     v_show.start_time, v_show.end_time, v_show.venue,
     btrim(p_name), btrim(p_phone), nullif(btrim(coalesce(p_email,'')), ''), coalesce(p_marketing, false))
  returning * into v_row;

  return json_build_object('ok', true, 'reservation', row_to_json(v_row));
exception when unique_violation then
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
  where auth.role() = 'authenticated'
    and upper(code) = upper(btrim(p_code))
    and status = 'reserved'
  limit 1;
$$;

-- ---- 4-4. 스태프 검색 (이름/연락처 부분일치) ----
create or replace function public.staff_search(p_q text)
returns setof reservations
language sql security definer set search_path = public as $$
  select * from reservations
  where auth.role() = 'authenticated'
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
  if auth.role() <> 'authenticated' then
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
  if auth.role() <> 'authenticated' then
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

  if auth.role() <> 'authenticated' then
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
  if auth.role() <> 'authenticated' then
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
  if auth.role() <> 'authenticated' then
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
  where auth.role() = 'authenticated'
    and code = btrim(p_code)
    and status = 'approved';
$$;

create or replace function public.press_check_in(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.press_applications;
begin
  if auth.role() <> 'authenticated' then
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
  if auth.role() <> 'authenticated' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  update public.press_applications set checked_in = false, checked_in_at = null
    where id = p_id returning * into a;
  return jsonb_build_object('ok', true, 'application', to_jsonb(a));
end $$;

-- =====================================================================
--  5. 보안 : 표에 직접 접근하는 길을 전부 막습니다
--     브라우저에 실리는 공개 키로는 위 함수만 부를 수 있습니다.
-- =====================================================================

alter table public.shows              enable row level security;
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
revoke all on function
  public.reserve_seat(text,text,text,text,boolean),
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
  public.press_undo_check_in(uuid)
  from public, anon, authenticated;

-- 관람객(비로그인)도 쓸 수 있는 것
grant execute on function public.reserve_seat(text,text,text,text,boolean)      to anon, authenticated;
grant execute on function public.lookup_reservations(text,text)                 to anon, authenticated;
grant execute on function public.cancel_reservation(uuid,text,text)             to anon, authenticated;
grant execute on function public.member_sign_up(text,text,text,text)            to anon, authenticated;
grant execute on function public.member_sign_in(text,text)                      to anon, authenticated;
grant execute on function public.press_apply(text,text,text,text,text,text,text) to anon, authenticated;
grant execute on function public.press_lookup(text,text)                        to anon, authenticated;

-- 로그인한 스태프만 쓸 수 있는 것
grant execute on function public.find_reservation(text)        to authenticated;
grant execute on function public.staff_search(text)            to authenticated;
grant execute on function public.check_in(text)                to authenticated;
grant execute on function public.undo_check_in(uuid)           to authenticated;
grant execute on function public.admin_clear_reservations()    to authenticated;
grant execute on function public.press_set_status(uuid,text)   to authenticated;
grant execute on function public.press_find(text)              to authenticated;
grant execute on function public.press_check_in(text)          to authenticated;
grant execute on function public.press_undo_check_in(uuid)     to authenticated;

-- 잔여석(숫자만)은 공개
grant select on public.show_availability to anon, authenticated;

-- =====================================================================
--  6. 설치 확인
-- =====================================================================
select
  (select count(*) from public.shows)                      as 쇼_개수,
  (select sum(capacity) from public.shows)                 as 총_좌석,
  (select count(*) from public.show_availability)          as 잔여석_뷰,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('reserve_seat','lookup_reservations','find_reservation',
                         'staff_search','check_in','undo_check_in','cancel_reservation',
                         'admin_clear_reservations','member_sign_up','member_sign_in',
                         'press_apply','press_lookup','press_set_status','press_find',
                         'press_check_in','press_undo_check_in'))  as 기능_개수;
-- 기대값: 쇼_개수 13 · 총_좌석 3900 · 잔여석_뷰 13 · 기능_개수 16
