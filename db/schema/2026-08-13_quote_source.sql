-- 견적 출처(source) — 영업이 작성한 상담 견적인지, 고객이 공개 화면에서 직접 넣은 문의인지.
--
-- JSON(inputs)에 묻지 않고 컬럼으로 두는 이유: 관리자 화면에서 "미배정 공개 문의만" 을
-- 거르는 질의가 상시로 돈다. JSON 안을 뒤지는 조건은 인덱스도 못 타고 읽기도 어렵다.
--
-- 기존 견적은 전부 'sales' 로 남는다(기본값) — 동작이 달라지지 않는다.
--
-- 실행: sudo docker exec -i buildup-ev-postgres psql -U buildup -d buildup_ev -f - < 이 파일
-- ⚠️ 실행 전 pg_dump 백업.

ALTER TABLE quote
  ADD COLUMN IF NOT EXISTS source VARCHAR(10) NOT NULL DEFAULT 'sales';

COMMENT ON COLUMN quote.source IS 'sales = 영업 작성 상담 견적 / public = 고객이 공개 화면에서 직접 접수한 문의';

-- 미배정 문의 목록(관리자)이 자주 도는 질의 — 부분 인덱스로 가볍게 둔다
CREATE INDEX IF NOT EXISTS quote_public_unassigned_idx
  ON quote (created_at DESC)
  WHERE source = 'public' AND sales_user_id IS NULL;
