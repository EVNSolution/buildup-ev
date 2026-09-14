-- 부가작업(특장사 공장 출고 뒤 우리 쪽 작업) + 고객 인도 날짜 + 기능모듈 「부가작업 관리」.
-- 새 표·참조 데이터 추가만 한다. 기존 표·행은 건드리지 않는다.

CREATE TABLE IF NOT EXISTS "order_addon_step" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "status" VARCHAR(12) NOT NULL DEFAULT 'done',
    "done_at" TIMESTAMP(3),
    "done_by" VARCHAR(120),
    "done_on" DATE,
    "note" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_addon_step_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "order_addon" (
    "order_id" INTEGER NOT NULL,
    "customer_target_on" DATE,
    "target_set_by" VARCHAR(120),
    "target_set_at" TIMESTAMP(3),
    "customer_delivered_on" DATE,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_addon_pkey" PRIMARY KEY ("order_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "order_addon_step_unique" ON "order_addon_step"("order_id", "code");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_addon_step_order_id_fkey') THEN
    ALTER TABLE "order_addon_step" ADD CONSTRAINT "order_addon_step_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_addon_order_id_fkey') THEN
    ALTER TABLE "order_addon" ADD CONSTRAINT "order_addon_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- 기능모듈 — 부가작업 조회·진행·고객 인도 목표일. 관리자 역할 기본 켬(계정별로 끌 수 있다)
INSERT INTO "feature_module" ("code", "name", "surface", "sort_order", "active")
VALUES ('addon.manage', '부가작업 관리', '관리자', 12, true)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "access_control" ("subject_type", "subject_ref", "module_code", "enabled")
VALUES ('role', 'ADMIN', 'addon.manage', true)
ON CONFLICT ("subject_type", "subject_ref", "module_code") DO NOTHING;
