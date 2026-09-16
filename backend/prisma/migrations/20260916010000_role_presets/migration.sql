-- 역할 프리셋(관리자 안의 자리)과 기준데이터 권한 쪼개기(2026-09-16 지시).
-- 칸·참조 행만 더한다. 기존 계정의 권한은 그대로다 — 프리셋은 비어 있고(null), 지정해야 적용된다.

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "admin_preset" VARCHAR(20);

-- 관리자 화면 탭과 1:1로 이어지는 기능모듈. 예전 「옵션DB·무게상수 관리」(basedata.manage)는
-- 우산으로 남겨 둔다 — 그것만 켜 둔 계정은 코드가 다섯을 켜진 것으로 본다(lib/permissions).
INSERT INTO "feature_module" ("code", "name", "surface", "sort_order", "active") VALUES
  ('customer.view',        '고객 목록',        '관리자', 16, true),
  ('basedata.weights',     '무게상수 관리',    '관리자', 17, true),
  ('basedata.dims',        '치수 프리셋 관리', '관리자', 18, true),
  ('basedata.optiondb',    '옵션DB 관리',      '관리자', 19, true),
  ('basedata.makerprice',  '특장사 단가 관리', '관리자', 20, true),
  ('basedata.holiday',     '공휴일 관리',      '관리자', 21, true)
ON CONFLICT ("code") DO NOTHING;

-- 「고객」 탭은 지금까지 관리자 모두에게 보였다 — 자리를 지정하기 전까지는 그대로여야 한다(역할 기본값).
-- 나머지 기준데이터 네 가지는 옛 우산(basedata.manage)이 켜져 있으면 코드가 켜진 것으로 본다(lib/permissions).
INSERT INTO "access_control" ("subject_type", "subject_ref", "module_code", "enabled", "memo") VALUES
  ('role', 'ADMIN', 'customer.view', true, '프리셋 도입 전과 같게 — 관리자 기본')
ON CONFLICT ("subject_type", "subject_ref", "module_code") DO NOTHING;

-- 「제작 배정 알림 메일」(notify.assign) 토글은 내린다 — 이제 받는 사람은 역할 프리셋이 정한다.
-- 행은 지우지 않는다(옛 설정 기록). active=false 라 계정 관리 화면의 죽은 토글만 사라진다.
UPDATE "feature_module" SET "active" = false WHERE "code" = 'notify.assign';
