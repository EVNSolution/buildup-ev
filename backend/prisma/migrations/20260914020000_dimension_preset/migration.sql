-- 튜닝 후 치수 프리셋 — 사양(특장형태 × 탑크기)별. 새 테이블 추가만.
CREATE TABLE IF NOT EXISTS "dimension_preset" (
    "model_code"   VARCHAR(40) NOT NULL,
    "body_type"    VARCHAR(30) NOT NULL,
    "top_size"     VARCHAR(30) NOT NULL,
    "car_length"   INTEGER,
    "car_width"    INTEGER,
    "car_height"   INTEGER,
    "outer_length" INTEGER,
    "outer_width"  INTEGER,
    "outer_height" INTEGER,
    "inner_length" INTEGER,
    "inner_width"  INTEGER,
    "inner_height" INTEGER,
    "offset"       INTEGER,
    "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dimension_preset_pkey" PRIMARY KEY ("model_code", "body_type", "top_size")
);

-- 2026-09-14 전달받은 값(프리셋 표). 내장은 외측이 냉동과 같고 내측만 장·폭 +60, 고 +50
-- (판넬 냉동 60T → 내장 30T, 바닥판 60T → 40T). 하대옵셋트는 아직 받지 않아 비워 둔다.
-- 이미 있으면 건드리지 않는다 — 관리자가 고친 값을 덮어쓰지 않는다.
INSERT INTO "dimension_preset"
  ("model_code","body_type","top_size","car_length","car_width","car_height","outer_length","outer_width","outer_height","inner_length","inner_width","inner_height","offset")
VALUES
  ('PV5_OPENBED','BODY_REEFER','TOP_STD', 5040,1910,2400, 2590,1910,1590, 2420,1790,1480, NULL),
  ('PV5_OPENBED','BODY_REEFER','TOP_LOW', 5040,1910,2100, 2590,1910,1290, 2420,1790,1180, NULL),
  ('PV5_OPENBED','BODY_DRY',   'TOP_STD', 5040,1910,2400, 2590,1910,1590, 2480,1850,1530, NULL),
  ('PV5_OPENBED','BODY_DRY',   'TOP_LOW', 5040,1910,2100, 2590,1910,1290, 2480,1850,1230, NULL)
ON CONFLICT ("model_code","body_type","top_size") DO NOTHING;
