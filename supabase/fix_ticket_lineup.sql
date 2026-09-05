-- =====================================================================
--  [수정] 모바일 입장권에 참여 브랜드(라인업)를 함께 내보낸다
--  "연합쇼 ④" 만으로는 어떤 쇼인지 알 수 없어 라인업을 추가합니다.
--  schema.sql 에도 반영돼 있습니다. SQL Editor 에 붙여넣고 실행하세요.
-- =====================================================================

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

grant execute on function public.ticket_view(text[]) to anon, authenticated;
