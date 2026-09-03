-- 「앱 알림」 기능모듈 — 계정별로 앱 푸시 알림을 켜고 끈다.
--
-- 메일 알림(notify.assign)과 **다른 모듈**이다. 메일은 배정 건만 나가지만 앱 알림은
-- 단계별 대화 등 여러 곳에서 쓰이고, 받을 사람도 다르다.
--
-- ⚠️ 참조 데이터만 더한다. 기존 행·컬럼은 건드리지 않는다(재실행해도 안전).
--
-- 기본값은 **관리자·특장사 역할 모두 켬**이다. 실제로 알림이 가려면 본인이 기기에서
-- 「알림 받기」를 눌러 구독해야 하므로, 여기서까지 꺼 두면 켰는데 안 오는 일이 생긴다.
-- 특정 계정만 빼려면 관리자 화면에서 그 계정을 끈다.
INSERT INTO "feature_module" ("code", "name", "surface", "sort_order", "active")
VALUES ('notify.push', '앱 알림', '공통', 11, true)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "access_control" ("subject_type", "subject_ref", "module_code", "enabled")
VALUES ('role', 'ADMIN', 'notify.push', true),
       ('role', 'MAKER', 'notify.push', true)
ON CONFLICT ("subject_type", "subject_ref", "module_code") DO NOTHING;
