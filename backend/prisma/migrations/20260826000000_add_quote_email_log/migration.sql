-- 메일로 무엇을 보냈는지 남기는 표 — 견적서만인지, 계약서까지인지.
--
-- ⚠️ **더하기만 한다.** 기존 표·열을 건드리지 않는다.
CREATE TABLE IF NOT EXISTS "quote_email_log" (
  "id"            SERIAL       PRIMARY KEY,
  "quote_id"      INTEGER      NOT NULL,
  "quote_no"      VARCHAR(30),
  "to_email"      VARCHAR(200) NOT NULL,
  "with_contract" BOOLEAN      NOT NULL DEFAULT false,
  "attachments"   VARCHAR(500) NOT NULL,
  "sent_by"       VARCHAR(120) NOT NULL,
  "sent_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quote_email_log_quote_id_fkey"
    FOREIGN KEY ("quote_id") REFERENCES "quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "quote_email_log_quote_id_idx" ON "quote_email_log"("quote_id");
