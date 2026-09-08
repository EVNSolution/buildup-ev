-- 특장사 공급단가 + 발주서 공급가 표.
--
-- 우리가 특장사에 **지급하는** 값이다(고객 견적가 `option_price` 와 다른 축).
-- 근거는 특장사별 기본거래계약서 [별첨1] 단가표.
--
-- ⚠️ **더하기만 한다.** 기존 표·컬럼·행은 건드리지 않는다(CLAUDE.md).
CREATE TABLE IF NOT EXISTS "maker_price" (
    "id"           SERIAL       NOT NULL,
    "maker_org_id" VARCHAR(30)  NOT NULL,
    "label"        VARCHAR(120) NOT NULL,
    "group_code"   VARCHAR(40),
    "value_code"   VARCHAR(40),
    "top_code"     VARCHAR(40),
    "section"      VARCHAR(10)  NOT NULL,
    -- MAKER = 특장사 작업(발주서에 실린다) / EVN = EV& 직접 추가작업(발주서에 실리지 않는다)
    "work_by"      VARCHAR(10)  NOT NULL,
    "unit"         VARCHAR(10)  NOT NULL DEFAULT 'EA',
    "qty"          INTEGER      NOT NULL DEFAULT 1,
    -- VAT 별도
    "unit_price"   INTEGER      NOT NULL,
    "sort_order"   INTEGER      NOT NULL DEFAULT 0,
    "active"       BOOLEAN      NOT NULL DEFAULT true,
    "memo"         VARCHAR(300),

    CONSTRAINT "maker_price_pkey" PRIMARY KEY ("id")
);

-- 같은 특장사·같은 선택·같은 탑에 단가는 하나뿐이다 — 여럿이면 어느 값이 맞는지 알 수 없다
CREATE UNIQUE INDEX IF NOT EXISTS "maker_price_org_group_value_top_key"
    ON "maker_price" ("maker_org_id", "group_code", "value_code", "top_code");

DO $$
BEGIN
    ALTER TABLE "maker_price"
        ADD CONSTRAINT "maker_price_maker_org_id_fkey"
        FOREIGN KEY ("maker_org_id") REFERENCES "org"("code")
        ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- 발주서에 실제로 실린 줄들 — 배정 시점 그대로 얼려 둔다.
-- 나중에 단가표를 고쳐도 이미 나간 발주서 금액은 따라 바뀌지 않아야 한다.
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "po_lines" JSONB;

-- 임시저장에도 금액표를 담는다 — 적는 사람과 배정하는 사람이 다를 수 있어서다
ALTER TABLE "po_draft" ADD COLUMN IF NOT EXISTS "po_lines" JSONB;
