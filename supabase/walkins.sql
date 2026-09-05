-- ⚠ 이 파일의 내용은 schema.sql 에 통합되었습니다 (2026-09-05).
-- 새로 설치하거나 다시 적용할 때는 schema.sql 하나만 실행하세요.
-- 이 파일은 변경 이력을 남기기 위해 보관합니다.

-- =====================================================================
--  현장 스탠드석 입장 인원 기록 (예약 없이 오신 관람객)
--  관리자 → 현장 체크인 화면에서 쇼별로 인원수를 직접 입력합니다.
--  SQL Editor 에 붙여넣고 한 번 실행하세요. 여러 번 실행해도 안전합니다.
-- =====================================================================

-- 쇼당 한 줄. 숫자를 고쳐 넣으면 덮어씁니다.
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
  if auth.role() <> 'authenticated' then
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
  where auth.role() = 'authenticated'
  group by s.id, s.title_ko, s.day, s.sort, w.count, w.note
  order by s.sort;
$$;

-- ---- 실행 권한 : 로그인한 스태프 전용 ----
revoke all on function
  public.walkin_set(text,int,text), public.attendance_stats()
  from public, anon, authenticated;

grant execute on function public.walkin_set(text,int,text) to authenticated;
grant execute on function public.attendance_stats()        to authenticated;

-- ---- 설치 확인 : 2 가 나와야 합니다 ----
select count(*) as 추가된_기능
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('walkin_set','attendance_stats');
