-- 부가작업을 **보는 것**과 **굴리는 것**을 나눈다(2026-09-16 지시 — 영업관리·경영관리도 볼 수 있게).
-- 칸만 더한다. 기존 계정은 addon.manage 를 그대로 쓰고, 관리는 보기를 겸한다(코드가 편다).
INSERT INTO "feature_module" ("code", "name", "surface", "sort_order", "active") VALUES
  ('addon.view', '부가작업 조회', '관리자', 22, true)
ON CONFLICT ("code") DO NOTHING;
