-- =====================================================================
--  검증 테스트 데이터 정리 + S13 정원 원복
--  SQL Editor 에 붙여넣고 한 번 실행하세요.
--  (실제 관람객 예약이 들어오기 전에 실행하는 것이 안전합니다)
-- =====================================================================

-- 1) S13 정원을 원래대로 300석
update public.shows set capacity = 300 where id = 'S13';

-- 2) 검증용으로 넣은 가짜 예약 삭제
--    010-9999-00xx (동시접속 테스트 20건) / 010-0000-0001 (기능 테스트)
delete from public.reservations
where phone_key like '0109999%'
   or phone_key = '01000000001';

-- 3) 검증용 프레스 신청 · 회원 삭제
delete from public.press_applications where phone_key = '01000000002';
delete from public.members            where phone    = '010-0000-0003';

-- 4) 정리 확인 — 셋 다 0 이어야 하고, 총 좌석은 3900 이어야 합니다
select
  (select count(*) from public.reservations)       as 남은_예약,
  (select count(*) from public.press_applications) as 남은_프레스신청,
  (select count(*) from public.members)            as 남은_회원,
  (select sum(capacity) from public.shows)         as 총_좌석;
-- 기대값: 남은_예약 0 · 남은_프레스신청 0 · 남은_회원 0 · 총_좌석 3900
