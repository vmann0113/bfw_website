-- =====================================================================
--  예약 마감 시각 — 쇼별로 "전날 자정"에 자동 마감
--    · 10.29 쇼 → 10.29 00:00 부터 마감 (= 10.28 자정)
--    · 10.30 쇼 → 10.30 00:00 부터 마감
--    · 10.31 쇼 → 10.31 00:00 부터 마감
--  정원이 먼저 차면 그 시점에 마감되는 것은 종전과 같습니다.
--
--  SQL Editor 에 붙여넣고 한 번 실행하세요. 여러 번 실행해도 안전합니다.
-- =====================================================================

-- ---- 1. 쇼마다 마감 시각을 담을 칸 추가 ----
alter table public.shows add column if not exists reserve_close_at timestamptz;

-- ---- 2. 쇼 날짜(예: '2026.10.29') 로부터 한국시간 자정을 계산해 채운다 ----
--  이미 값이 있는 쇼는 건드리지 않습니다(개별 조정분 보존).
update public.shows
   set reserve_close_at = (to_date(date, 'YYYY.MM.DD')::timestamp at time zone 'Asia/Seoul')
 where reserve_close_at is null
   and date is not null;

-- ---- 3. 잔여석 뷰에 마감 시각을 함께 실어 보낸다 (예약 화면이 읽음) ----
create or replace view public.show_availability as
select
  s.id,
  s.capacity,
  s.reserve_close_at,
  (s.reserve_close_at is not null and now() >= s.reserve_close_at)          as closed,
  count(r.*) filter (where r.status = 'reserved')                           as reserved,
  greatest(s.capacity - count(r.*) filter (where r.status = 'reserved'), 0) as remaining
from public.shows s
left join public.reservations r on r.show_id = s.id
group by s.id, s.capacity, s.reserve_close_at;

grant select on public.show_availability to anon, authenticated;

-- ---- 4. 예약 함수가 마감 시각을 강제하도록 교체 ----
--  화면에서만 막으면 우회할 수 있으므로 서버에서 최종 차단합니다.
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

  -- 마감 시각 지남 (쇼 전날 자정)
  if v_show.reserve_close_at is not null and now() >= v_show.reserve_close_at then
    return json_build_object('ok', false, 'reason', 'closed');
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

revoke all on function public.reserve_seat(text,text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.reserve_seat(text,text,text,text,boolean) to anon, authenticated;

-- =====================================================================
--  확인 — 쇼별 마감 시각 (한국시간으로 표시)
-- =====================================================================
select id, date as 쇼날짜,
       to_char(reserve_close_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as 마감시각,
       (now() >= reserve_close_at) as 지금마감됨
from public.shows order by sort;
-- 기대값: 10.29 쇼는 2026-10-29 00:00, 10.30 쇼는 2026-10-30 00:00,
--         10.31 쇼는 2026-10-31 00:00 · 지금마감됨은 모두 false

-- ---------------------------------------------------------------------
--  [참고] 특정 쇼의 마감을 따로 조정하고 싶을 때 (예: S01 을 10/28 18시로)
--    update public.shows
--       set reserve_close_at = timestamptz '2026-10-28 18:00+09'
--     where id = 'S01';
--
--  [참고] 특정 쇼를 즉시 마감하고 싶을 때
--    update public.shows set reserve_close_at = now() where id = 'S01';
--
--  [참고] 마감을 아예 없애고 싶을 때
--    update public.shows set reserve_close_at = null where id = 'S01';
-- ---------------------------------------------------------------------
