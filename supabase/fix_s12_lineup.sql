-- =====================================================================
--  [수정] 10.31 16:00 · 연합쇼 ⑩ 의 참여 브랜드
--         '마르즈' → '메르최'
--  SQL Editor 에 붙여넣고 한 번 실행하세요.
--  schema.sql 에도 같은 내용이 반영돼 있습니다.
-- =====================================================================

update public.shows
   set lineup = '메르최 · 미지미지 · 바주요'
 where id = 'S12';

-- 이미 들어온 예약이 있다면 그 예약 내역의 표기도 함께 맞춘다.
-- (입장권과 안내 문자에 나가는 값이라 같이 고쳐야 한다)
update public.reservations
   set lineup = '메르최 · 미지미지 · 바주요'
 where show_id = 'S12';

-- 확인 : 참여 열에 '메르최 · 미지미지 · 바주요' 가 나와야 합니다
select id        as 쇼번호,
       date      as 날짜,
       start_time as 시각,
       title_ko  as 패션쇼,
       lineup    as 참여
  from public.shows
 where id = 'S12';
