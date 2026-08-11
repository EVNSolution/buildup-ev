-- 권한 모듈 정리 — 실제로 지킬 수 있는 것만 남긴다.
--
-- 문제였던 것:
--   · view.all · subsidy.manage : 코드 어디에도 검사가 없어 켜고 꺼도 아무 일이 없었다
--   · 새로 만든 기능(수정·삭제·발송·실적·기준데이터)은 모듈 자체가 없어 통제 불가
--
-- ⚠️ 순서 주의: 이 SQL 을 **코드보다 먼저** 넣어야 한다.
--    반대로 하면 배포 직후 권한 행이 없어 전원이 403 이 된다.
BEGIN;

-- 1) 죽은 모듈 제거 (access_control 이 module_code 를 RESTRICT 로 참조 — 권한 행 먼저)
DELETE FROM access_control WHERE module_code IN ('view.all', 'subsidy.manage');
DELETE FROM feature_module  WHERE code        IN ('view.all', 'subsidy.manage');

-- 2) 새 모듈
INSERT INTO feature_module (code, name, surface, sort_order, active) VALUES
  ('quote.edit',      '견적 수정·복제',       '영업,관리자',  3, true),
  ('quote.delete',    '견적 삭제',            '관리자',       4, true),
  ('doc.send.email',  '메일 발송',            '영업,관리자',  5, true),
  ('doc.send.sign',   '전자서명 발송',        '영업,관리자',  6, true),
  ('stats.own',       '내 실적 조회',         '영업,관리자', 11, true),
  ('stats.all',       '전체 실적 조회',       '관리자',      12, true),
  ('basedata.manage', '옵션DB·무게상수 관리', '관리자',      13, true)
ON CONFLICT (code) DO NOTHING;

-- 3) 기존 모듈 정렬·표기 정리
UPDATE feature_module SET sort_order =  1 WHERE code = 'quote.create';
UPDATE feature_module SET sort_order =  2 WHERE code = 'quote.confirm';
UPDATE feature_module SET sort_order =  7 WHERE code = 'order.confirm';
UPDATE feature_module SET sort_order =  8 WHERE code = 'order.view';
UPDATE feature_module SET sort_order =  9 WHERE code = 'order.control';
UPDATE feature_module SET sort_order = 10, name = '구조변경 서류 조회' WHERE code = 'doc.view';
UPDATE feature_module SET sort_order = 14 WHERE code = 'account.manage';

-- 4) 역할 기본값 (계정별 override 는 그대로 우선한다)
--    quote.create 는 영업만 — POST /quotes 가 SALES 전용이라 관리자에게 줘도 통하지 않는다.
-- subject_type 만 enum("SubjectType") 이다. subject_ref 는 varchar 라 캐스팅하지 않는다.
INSERT INTO access_control (subject_type, subject_ref, module_code, enabled)
SELECT 'role'::"SubjectType", v.r, v.m, true FROM (VALUES
  ('SALES','quote.edit'),
  ('SALES','doc.send.email'),
  ('SALES','doc.send.sign'),
  ('SALES','stats.own'),
  ('ADMIN','quote.edit'),
  ('ADMIN','quote.delete'),
  ('ADMIN','doc.send.email'),
  ('ADMIN','doc.send.sign'),
  ('ADMIN','stats.own'),
  ('ADMIN','stats.all'),
  ('ADMIN','basedata.manage'),
  ('ADMIN','account.manage')
) AS v(r, m)
WHERE NOT EXISTS (
  SELECT 1 FROM access_control a
  WHERE a.subject_type = 'role'::"SubjectType"
    AND a.subject_ref  = v.r
    AND a.module_code  = v.m
);

COMMIT;
