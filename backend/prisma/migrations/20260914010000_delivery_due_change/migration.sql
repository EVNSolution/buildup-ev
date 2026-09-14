-- 관리자 납기일 변경 — 처음 약속한 날과 바꾼 사람·시각을 남긴다. 추가만 한다.
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "delivery_due_original" DATE;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "delivery_due_changed_by" VARCHAR(120);
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "delivery_due_changed_at" TIMESTAMP(3);
