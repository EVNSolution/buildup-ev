-- 치수 프리셋 하대옵셋트 = 35 (2026-09-14 지시: 전 사양 공통).
-- **비어 있는 칸만** 채운다 — 그사이 관리자가 탭에서 넣은 값은 덮어쓰지 않는다.
-- 관리자 화면의 변경 이력에도 보이도록 option_db_change_log 에 먼저 남긴다(편집 화면으로 고친 것과 같은 모양).
INSERT INTO "option_db_change_log" ("table_name", "row_key", "field", "old_value", "new_value", "action", "changed_by")
SELECT 'dimension_preset', "model_code" || '|' || "body_type" || '|' || "top_size", 'offset', NULL, '35', 'update', 'migration (2026-09-14 지시)'
FROM "dimension_preset"
WHERE "offset" IS NULL;

UPDATE "dimension_preset" SET "offset" = 35, "updated_at" = CURRENT_TIMESTAMP WHERE "offset" IS NULL;
