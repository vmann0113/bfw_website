-- =====================================================================
--  [수정] 모바일 입장권 조회 — 'BFW-' 접두어를 떼고 대조하도록 교체
--  schema.sql 에도 같은 내용이 반영돼 있습니다.
--  SQL Editor 에 붙여넣고 한 번 실행하세요.
-- =====================================================================

-- ---- 4-3b. 모바일 티켓 보기 (공개) ----
--  문자로 받은 링크에서 QR을 띄우는 용도. 예약번호를 무작위로 대입해도
--  이름은 가려져 있고 연락처·이메일은 아예 나가지 않는다.
--  (어느 좌석이 찼는지는 예약 화면에서 이미 공개되는 정보다)
create or replace function public.ticket_view(p_codes text[])
returns table (
  code text, show_id text, title_ko text, show_title text,
  day int, date text, start_time text, end_time text, venue text,
  seat_label text, name_masked text, checked_in boolean
) language sql security definer set search_path = public as $$
  select r.code, r.show_id, r.title_ko, r.show_title,
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

-- 확인 : 아래가 1건 나오면 정상 (없는 예약번호면 0건이 정상입니다)
-- select count(*) from public.ticket_view(array['BFW-S03-CR4K8Q']);
