-- PDI 체크리스트 — **규칙은 코드, 서식은 데이터.**
--
-- 「채워야 다음 단계로 넘어간다」는 규칙이라 코드에 있고, 무엇을 확인하는지는
-- 현장에서 바뀌는 것이라 표로 둔다(관리자 화면에서 고친다).
--
-- ⚠️ 서식을 고쳐도 **이미 작성한 체크리스트는 바뀌지 않는다.** 작성할 때 그 시점의
--    항목을 주문에 사본으로 얼려 둔다 — 발주서 단가와 같은 원칙이다. 3개월 전에
--    합격 처리한 항목의 뜻이 소급해서 바뀌면 그 기록은 근거가 되지 못한다.
--
-- ⚠️ **더하기만** 한다(CLAUDE.md).

CREATE TABLE IF NOT EXISTS "checklist_item" (
    "id"         SERIAL       PRIMARY KEY,
    "step_code"  VARCHAR(40)  NOT NULL,
    "seq"        INTEGER      NOT NULL DEFAULT 0,
    "category"   VARCHAR(60)  NOT NULL,
    "content"    VARCHAR(300) NOT NULL,
    "active"     BOOLEAN      NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" VARCHAR(120)
);
CREATE INDEX IF NOT EXISTS "checklist_item_step_idx" ON "checklist_item"("step_code", "active", "seq");

CREATE TABLE IF NOT EXISTS "order_checklist" (
    "id"           SERIAL       PRIMARY KEY,
    "order_id"     INTEGER      NOT NULL,
    "step_code"    VARCHAR(40)  NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "submitted_by" VARCHAR(120),
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_checklist_order_id_fkey" FOREIGN KEY ("order_id")
        REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS "order_checklist_unique" ON "order_checklist"("order_id", "step_code");

CREATE TABLE IF NOT EXISTS "order_checklist_line" (
    "id"           SERIAL       PRIMARY KEY,
    "checklist_id" INTEGER      NOT NULL,
    "seq"          INTEGER      NOT NULL DEFAULT 0,
    "category"     VARCHAR(60)  NOT NULL,
    "content"      VARCHAR(300) NOT NULL,
    "result"       VARCHAR(4),
    "memo"         VARCHAR(300),
    "checked_at"   TIMESTAMP(3),
    "checked_by"   VARCHAR(120),
    CONSTRAINT "order_checklist_line_checklist_id_fkey" FOREIGN KEY ("checklist_id")
        REFERENCES "order_checklist"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX IF NOT EXISTS "order_checklist_line_idx" ON "order_checklist_line"("checklist_id", "seq");

-- 항목별 판정 이력 — 불합격 → 조치 → 재검이 남는다.
-- 결과 칸 하나만 두면 마지막 판정만 남아 「한 번에 통과」와 「고쳐서 통과」가 같아진다.
CREATE TABLE IF NOT EXISTS "order_checklist_line_log" (
    "id"      SERIAL       PRIMARY KEY,
    "line_id" INTEGER      NOT NULL,
    "result"  VARCHAR(4)   NOT NULL,
    "memo"    VARCHAR(300),
    "at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "by"      VARCHAR(120) NOT NULL,
    CONSTRAINT "order_checklist_line_log_line_id_fkey" FOREIGN KEY ("line_id")
        REFERENCES "order_checklist_line"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX IF NOT EXISTS "order_checklist_line_log_idx" ON "order_checklist_line_log"("line_id", "id");

-- 기능모듈 — 체크리스트 **서식**을 고치는 권한. 기본은 꺼 두고 계정별로 켠다.
INSERT INTO "feature_module" ("code","name","surface","sort_order","active")
VALUES ('checklist.manage','체크리스트 서식 관리','관리자',15,true)
ON CONFLICT ("code") DO NOTHING;
