-- 손익 기능모듈 둘(조회·관리)과 경영관리·마스터 자리의 기본 구성(2026-09-16).
-- 돈에 관한 표라 **보는 것부터** 권한을 건다 — 주문 진행 현황과 성격이 다르다.
INSERT INTO "feature_module" ("code", "name", "surface", "sort_order", "active")
VALUES
  ('pnl.view',   '손익 조회', '관리자', 23, true),
  ('pnl.manage', '손익 관리', '관리자', 24, true)
ON CONFLICT ("code") DO NOTHING;

-- 자리 기본값. 모듈 행이 아직 없으면 건너뛴다(빈 DB 검증에서 외래키에 걸리지 않게)
INSERT INTO "access_control" ("subject_type", "subject_ref", "module_code", "enabled", "memo")
SELECT 'preset'::"SubjectType", v.ref, v.code, true, '프리셋 기본값 — 기능모듈 화면에서 고친다'
FROM (VALUES
  ('exec',   'pnl.view'),
  ('exec',   'pnl.manage'),
  ('master', 'pnl.view'),
  ('master', 'pnl.manage')
) AS v(ref, code)
WHERE EXISTS (SELECT 1 FROM "feature_module" fm WHERE fm."code" = v.code)
ON CONFLICT ("subject_type", "subject_ref", "module_code") DO NOTHING;
