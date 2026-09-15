-- 「배정 요청」 — 계약완료(서명 끝) 뒤 영업이 서명본을 확인하고 누른다. 눌러야 관리자 제작 배정이 열린다(2026-09-15).
-- 칸만 더한다. 기존 행은 비어 있어(null) 지금 배정 대기 중인 건도 영업이 요청해야 넘어간다(지시).
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "assign_requested_at" TIMESTAMP(3);
ALTER TABLE "quote" ADD COLUMN IF NOT EXISTS "assign_requested_by" VARCHAR(120);
