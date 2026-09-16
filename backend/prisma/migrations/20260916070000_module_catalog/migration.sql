-- 기능모듈 전수조사(2026-09-16) — 이름·순서·활성을 카탈로그(shared/rbac/modules)와 맞춘다.
--
-- ⚠️ **행을 지우지 않는다.** 쓰지 않게 된 모듈(견적 삭제·앱 알림·배정 알림 메일·옛 기준데이터 우산)도
--    `active=false` 로 내리기만 한다 — 이미 켜 둔 계정의 권한 기록을 잃지 않기 위해서다.
--    목록에는 안 뜨고(라우트가 카탈로그의 retired 를 거른다) 새로 켤 수도 없다.
--
-- ⚠️ 이름·순서는 이제 **화면이 카탈로그에서 읽는다.** 여기 값은 DB 를 카탈로그에 맞춰 두는 것뿐이고,
--    다음에 이름을 고칠 때는 카탈로그만 고치면 된다(마이그레이션이 더 필요하지 않다).
INSERT INTO "feature_module" ("code", "name", "surface", "sort_order", "active")
VALUES
  ('quote.create', '견적 만들기', '영업', 1, true),
  ('quote.edit', '견적 고치기', '영업,관리자', 2, true),
  ('quote.confirm', '견적 확정', '영업,관리자', 3, true),
  ('doc.send.email', '견적서·계약서 메일 발송', '영업,관리자', 4, true),
  ('doc.send.sign', '전자서명 요청', '영업,관리자', 5, true),
  ('doc.view', '구조변경 서류 보기', '관리자,특장사', 6, true),
  ('customer.view', '고객·서류함 보기', '관리자', 7, true),
  ('order.view', '주문 진행 보기', '영업,관리자,특장사', 8, true),
  ('order.confirm', '제작 배정', '관리자', 9, true),
  ('order.control', '제작 단계 진행', '관리자,특장사', 10, true),
  ('order.remove', '주문 치우기', '관리자', 11, true),
  ('addon.view', '부가작업 보기', '관리자', 12, true),
  ('addon.manage', '부가작업 진행', '관리자', 13, true),
  ('checklist.manage', '체크리스트 서식 관리', '관리자', 14, true),
  ('stats.own', '내 실적 보기', '영업,관리자', 15, true),
  ('stats.all', '전체 실적 보기', '관리자', 16, true),
  ('pnl.view', '손익 보기', '관리자', 17, true),
  ('pnl.manage', '손익 입력', '관리자', 18, true),
  ('basedata.optiondb', '옵션DB 관리', '관리자', 19, true),
  ('basedata.weights', '무게상수 관리', '관리자', 20, true),
  ('basedata.dims', '치수 프리셋 관리', '관리자', 21, true),
  ('basedata.makerprice', '특장사 단가 관리', '관리자', 22, true),
  ('basedata.holiday', '공휴일 관리', '관리자', 23, true),
  ('account.manage', '계정·권한 관리', '관리자', 24, true),
  ('quote.delete', '견적 삭제', '관리자', 25, false),
  ('notify.assign', '제작 배정 알림 메일', '관리자', 26, false),
  ('notify.push', '앱 알림', '영업,관리자,특장사', 27, false),
  ('basedata.manage', '기준데이터 관리(옛 우산)', '관리자', 28, false)
ON CONFLICT ("code") DO UPDATE
  SET "name" = EXCLUDED."name",
      "surface" = EXCLUDED."surface",
      "sort_order" = EXCLUDED."sort_order",
      "active" = EXCLUDED."active";

-- 물러난 모듈에 남아 있는 권한 행은 **그대로 둔다**(기록이다). 아무 데서도 검사하지 않으므로 효력이 없다.
