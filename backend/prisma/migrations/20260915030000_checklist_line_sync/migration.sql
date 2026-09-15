-- 체크리스트 **제출 전**에는 서식 수정을 따라가게 한다(2026-09-15). 줄이 어느 서식 항목에서 왔는지(item_id)와
-- 서식에서 빠져 더는 보이지 않는 줄(retired_at)을 적을 칸만 더한다. 기존 행·컬럼은 건드리지 않는다(줄은 지우지 않는다).
ALTER TABLE "order_checklist_line" ADD COLUMN IF NOT EXISTS "item_id" INTEGER;
ALTER TABLE "order_checklist_line" ADD COLUMN IF NOT EXISTS "retired_at" TIMESTAMP(3);
-- 같은 체크리스트에 같은 서식 항목 줄은 하나 — 두 화면이 동시에 열어 맞춰도 줄이 겹치지 않는다(NULL 은 겹쳐도 된다)
CREATE UNIQUE INDEX IF NOT EXISTS "order_checklist_line_item_unique" ON "order_checklist_line"("checklist_id", "item_id");
