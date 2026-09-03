-- 단계별 대화 · 읽음 표시 · 웹 푸시 구독
-- ⚠️ 전부 새 테이블이다. 기존 테이블·데이터는 건드리지 않는다.

CREATE TABLE IF NOT EXISTS "order_step_comment" (
  "id"          SERIAL PRIMARY KEY,
  "order_id"    INTEGER NOT NULL,
  "step_code"   VARCHAR(40) NOT NULL,
  "author"      VARCHAR(120) NOT NULL,
  "author_role" VARCHAR(10) NOT NULL,
  "author_name" VARCHAR(80),
  "body"        VARCHAR(2000) NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_step_comment_order_fk"
    FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX IF NOT EXISTS "order_step_comment_thread_idx"
  ON "order_step_comment" ("order_id", "step_code", "id");

CREATE TABLE IF NOT EXISTS "order_step_read" (
  "id"           SERIAL PRIMARY KEY,
  "user_email"   VARCHAR(120) NOT NULL,
  "order_id"     INTEGER NOT NULL,
  "step_code"    VARCHAR(40) NOT NULL,
  "last_read_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "order_step_read_order_fk"
    FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS "order_step_read_unique"
  ON "order_step_read" ("user_email", "order_id", "step_code");
CREATE INDEX IF NOT EXISTS "order_step_read_user_idx"
  ON "order_step_read" ("user_email", "order_id");

CREATE TABLE IF NOT EXISTS "push_subscription" (
  "id"         SERIAL PRIMARY KEY,
  "user_email" VARCHAR(120) NOT NULL,
  "endpoint"   VARCHAR(500) NOT NULL,
  "p256dh"     VARCHAR(200) NOT NULL,
  "auth"       VARCHAR(100) NOT NULL,
  "user_agent" VARCHAR(300),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_ok_at" TIMESTAMP(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "push_subscription_endpoint_key"
  ON "push_subscription" ("endpoint");
CREATE INDEX IF NOT EXISTS "push_subscription_user_idx"
  ON "push_subscription" ("user_email");
