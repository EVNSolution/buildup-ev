-- 고객 인도 전인데 견적이 「완료」인 건을 「주문진행」으로 되돌린다(2026-09-14 지시).
--
-- 예전 흐름은 특장사가 「인도」(지금의 출고)를 끝내면 견적을 완료로 올렸다. 이제 완료는 우리 쪽 부가작업의
-- **고객 인도 완료** 때다. 옛 흐름으로 완료가 된 건이 부가작업에서 멈춰 있는데 영업 성과·마이페이지에는
-- 「완료」로 잡혔다(제보).
--
-- 행을 지우지 않는다 — 상태만 바꾸고, 바꾼 기록을 이력(quote_change_log)에 먼저 남긴다.
-- 대상: 견적이 completed · 특장사 출고(delivered) 완료 · 고객 인도(addon_delivered) 기록 없음.

INSERT INTO "quote_change_log" ("quote_id", "section", "field", "old_value", "new_value", "changed_by")
SELECT q."id", 'status', 'status', 'completed', 'ordered', 'migration (2026-09-14 고객 인도 전 완료 되돌림)'
FROM "quote" q
JOIN "order" o ON o."quote_id" = q."id"
WHERE q."status" = 'completed'
  AND EXISTS (SELECT 1 FROM "order_step" s WHERE s."order_id" = o."id" AND s."code" = 'delivered' AND s."status" = 'done')
  AND NOT EXISTS (SELECT 1 FROM "order_addon_step" a WHERE a."order_id" = o."id" AND a."code" = 'addon_delivered' AND a."status" = 'done');

UPDATE "quote" q
SET "status" = 'ordered'
FROM "order" o
WHERE o."quote_id" = q."id"
  AND q."status" = 'completed'
  AND EXISTS (SELECT 1 FROM "order_step" s WHERE s."order_id" = o."id" AND s."code" = 'delivered' AND s."status" = 'done')
  AND NOT EXISTS (SELECT 1 FROM "order_addon_step" a WHERE a."order_id" = o."id" AND a."code" = 'addon_delivered' AND a."status" = 'done');
