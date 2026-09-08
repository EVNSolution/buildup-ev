-- 발주서 별지(2페이지) — 커스텀 주문의 상세 요청사항.
--
-- `remark`(비고)는 발주서 1페이지 양식에 맞춰 4줄·40자로 묶여 있어 긴 글을 담지 못한다.
-- 커스텀 건은 설명할 것이 많아 그 칸에 우겨넣으면 뜻이 전달되지 않았다(제보).
--
-- ⚠️ **더하기만 한다.** 기존 컬럼·데이터는 건드리지 않는다(CLAUDE.md).
--    셋 다 NULL 허용이라 기존 행은 그대로 두고 지나간다 — 이미 배정된 커스텀 주문은
--    별지가 비어 있고, 비어 있으면 수락 강제가 걸리지 않는다(신규 배정부터 적용).
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "appendix" TEXT;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "appendix_ack_at" TIMESTAMP(3);
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "appendix_ack_by" VARCHAR(120);
