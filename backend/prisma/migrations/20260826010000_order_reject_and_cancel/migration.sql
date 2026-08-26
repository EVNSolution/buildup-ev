-- 특장사 거부 · 관리자 치우기 기록.
--
-- ⚠️ **더하기만 한다.** 기존 열을 지우거나 바꾸지 않는다.
--    「삭제」도 행을 지우지 않고 상태로 남긴다 — 서명된 계약이 연쇄로 지워진 사고 이후의 규칙.
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "rejected_at"   TIMESTAMP(3);
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "rejected_by"   VARCHAR(120);
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "reject_reason" VARCHAR(500);
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "canceled_at"   TIMESTAMP(3);
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "canceled_by"   VARCHAR(120);
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "cancel_reason" VARCHAR(500);

-- 주문을 치우는 권한 — 계정별로 켠다. 기본은 아무도 없다.
INSERT INTO "feature_module" ("code", "name", "surface", "sort_order", "active")
VALUES ('order.remove', '주문 치우기(관리자)', '관리자', 11, true)
ON CONFLICT ("code") DO NOTHING;
