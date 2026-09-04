-- 납기 알림을 **하루에 한 번만** 보내기 위한 발송 기록 (추가 전용).
--
-- 백엔드가 blue/green 두 슬롯으로 잠깐 함께 도는 순간이 있어, 같은 알림이 두 번 갈 수 있다.
-- (order_id, kind, sent_on) 을 유일하게 두면 **DB 가 두 번째를 거절**한다 —
-- 코드로 막으려 들면 두 프로세스 사이의 경합을 못 막는다.
CREATE TABLE IF NOT EXISTS "order_due_notice" (
  "id"       SERIAL PRIMARY KEY,
  "order_id" INTEGER NOT NULL,
  -- soon(3일 전) · today(당일) · overdue(경과)
  "kind"     VARCHAR(10) NOT NULL,
  -- 보낸 날(현지 날짜). 경과 알림은 날마다 한 번씩 다시 간다
  "sent_on"  DATE NOT NULL,
  "sent_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_due_notice_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "order_due_notice_once"
  ON "order_due_notice" ("order_id", "kind", "sent_on");
