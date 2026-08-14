-- 주문 단계 진행 — 차량·특장·튜닝이 따로 돌고 중간에 합류하는 구조.
--
-- 예전에는 order.status 문자열 한 칸이라 「차는 아직인데 특장은 다 됐다」를 표현할 수 없었다.
-- 단계 정의(순서·선행조건·필수증빙)는 코드에 있고(shared/process/steps.ts) 여기엔 진행만 남긴다.
--
-- ⚠️ order.status 는 **지우지 않는다.** 기존 칸반·통계가 아직 그 값을 읽는다.
--    화면을 단계 중심으로 옮긴 뒤에 걷어낸다.
CREATE TABLE IF NOT EXISTS "order_step" (
  id          SERIAL PRIMARY KEY,
  order_id    INT         NOT NULL REFERENCES "order"(id) ON DELETE CASCADE,
  code        VARCHAR(40) NOT NULL,
  track       VARCHAR(10) NOT NULL,
  status      VARCHAR(12) NOT NULL DEFAULT 'pending',
  -- 약속한 날 (납기·검사예정일·인도일)
  planned_at  DATE,
  -- 이 단계에 들어온 시각 = 정체 일수의 기산점
  entered_at  TIMESTAMP(3),
  done_at     TIMESTAMP(3),
  done_by     VARCHAR(120),
  note        VARCHAR(300),
  CONSTRAINT order_step_unique UNIQUE (order_id, code)
);

CREATE INDEX IF NOT EXISTS order_step_order_idx  ON "order_step" (order_id);
-- 「정체된 것 모아 보기」(아침·저녁 알림)가 이 조합으로 훑는다
CREATE INDEX IF NOT EXISTS order_step_status_idx ON "order_step" (status, entered_at);

-- 증빙 파일 — 사진은 줄여서, 서류는 원본으로 저장한다(shared/process/steps.ts KEEP_ORIGINAL).
CREATE TABLE IF NOT EXISTS "order_file" (
  id            SERIAL      PRIMARY KEY,
  order_id      INT         NOT NULL REFERENCES "order"(id) ON DELETE CASCADE,
  step_code     VARCHAR(40) NOT NULL,
  kind          VARCHAR(30) NOT NULL,
  -- 릴리스 슬롯 **밖**에 저장한다(/opt/buildup-ev/shared/uploads). 슬롯 안에 두면 다음 배포에 사라진다.
  path          VARCHAR(300) NOT NULL,
  original_name VARCHAR(200),
  mime          VARCHAR(60),
  size_bytes    INT,
  -- 원본을 지킨 파일인지(서류) 줄인 것인지(사진)
  kept_original BOOLEAN     NOT NULL DEFAULT FALSE,
  uploaded_by   VARCHAR(120) NOT NULL,
  uploaded_at   TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_file_order_idx ON "order_file" (order_id, step_code);
