-- 발주서 비고 — 배정 시 관리자가 적는 주문별 요청사항.
-- ⚠️ 컬럼 하나만 더한다. 기존 데이터는 그대로다(NULL 허용).
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "remark" VARCHAR(500);
