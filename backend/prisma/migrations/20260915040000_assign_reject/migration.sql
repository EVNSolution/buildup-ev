-- 「배정 거부」 — 관리자가 영업의 배정 요청을 사유와 함께 돌려보낸다(2026-09-15). 지금 상태를 적을 칸만 더한다.
-- 누가 언제 무엇을 요청·거부했는지는 quote_change_log 에 쌓는다. 기존 행·컬럼은 건드리지 않는다.
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "assign_rejected_at" TIMESTAMP(3);
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "assign_rejected_by" VARCHAR(120);
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "assign_reject_reason" VARCHAR(500);
