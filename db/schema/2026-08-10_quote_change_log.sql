-- 견적 수정 이력 표 — 배포 시 프로덕션에 먼저 만들어야 한다.
-- (배포는 코드만 올린다. 스키마는 운영자가 명시적으로 반영한다)
CREATE TABLE IF NOT EXISTS quote_change_log (
  id          SERIAL PRIMARY KEY,
  quote_id    INTEGER NOT NULL REFERENCES quote(id) ON DELETE CASCADE,
  section     VARCHAR(20)  NOT NULL,
  field       VARCHAR(60)  NOT NULL,
  old_value   VARCHAR(300),
  new_value   VARCHAR(300),
  changed_by  VARCHAR(120) NOT NULL,
  changed_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS quote_change_log_quote_id_changed_at_idx
  ON quote_change_log (quote_id, changed_at);
