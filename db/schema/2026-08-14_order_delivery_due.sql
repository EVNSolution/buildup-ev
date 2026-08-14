-- 납기일 — 특장사가 발주를 **수락하면서 약속한 날**.
--
-- 발주서 특이사항: 「납기일자: 발주일로부터 15일 이내 (영업일 기준)」.
-- 서버가 수락 시점에 이 한도를 검증한다(shared/schedule/businessDays.ts).
--
-- ⚠️ 1단계에서 order_step 이 생기면 이 값은 order_step[po_accepted].planned_at 으로 옮긴다.
--    지금은 단계 테이블이 없어 주문에 직접 단다 — 옮길 때 컬럼을 지우고 데이터만 이관한다.
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "delivery_due" DATE;

-- 발주 수락 시각 — 납기 한도의 기산점. 수락 이후에 발주일을 되짚을 수 있어야 한다.
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "accepted_at" TIMESTAMP(3);
