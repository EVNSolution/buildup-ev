-- 알림함 — 계정마다 받은 알림을 쌓는다. 새 테이블 추가만.
CREATE TABLE IF NOT EXISTS "notification" (
    "id"         SERIAL NOT NULL,
    "user_email" VARCHAR(120) NOT NULL,
    "title"      VARCHAR(200) NOT NULL,
    "body"       VARCHAR(1000) NOT NULL,
    "url"        VARCHAR(500) NOT NULL,
    "tag"        VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at"    TIMESTAMP(3),
    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "notification_user_created_idx" ON "notification"("user_email", "created_at");
CREATE INDEX IF NOT EXISTS "notification_user_read_idx" ON "notification"("user_email", "read_at");

-- 기능모듈 「앱 알림」(notify.push)을 **끈다**(지시 2026-09-14) — 기능모듈은 메일 여부만 정한다.
-- 앱 알림은 이제 활성 계정 모두에게 가고, 푸시는 기기에서 허용했을 때만 뜬다(헤더 종 아이콘).
-- 행을 지우지 않는다 — active 만 내려 관리자 화면 토글에서 빠진다. 계정별 설정 행도 그대로 남는다.
UPDATE "feature_module" SET "active" = false WHERE "code" = 'notify.push';
