-- 발주서 임시저장 — 배정 전에 적어 둔 발주서 내용.
--
-- 발주서를 적는 사람과 배정을 누르는 사람이 다를 수 있다. 예전엔 배정 팝업을 닫으면
-- 적던 것이 전부 날아가서, 한 사람이 앉은자리에서 다 끝내야 했다.
--
-- ⚠️ **더하기만 한다.** 기존 표·컬럼은 건드리지 않는다(CLAUDE.md).
--    `quote` 에 컬럼을 더하지 않고 새 표로 둔 이유: 운영 DB 에 그 컬럼이 없으면
--    Prisma 가 `quote` 를 읽는 **모든** 기능을 P2022 로 죽인다(2026-08-18 사고).
--    새 표는 없더라도 이 기능만 멈춘다.
CREATE TABLE IF NOT EXISTS "po_draft" (
    "quote_id"     INTEGER      NOT NULL,
    "maker_org_id" VARCHAR(30),
    "remark"       VARCHAR(500),
    "custom_badge" BOOLEAN      NOT NULL DEFAULT false,
    "appendix"     TEXT,
    "saved_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "saved_by"     VARCHAR(120) NOT NULL,
    "consumed_at"  TIMESTAMP(3),

    -- 견적 하나에 초안 하나 — 여럿이 적으면 무엇이 최신인지 알 수 없다
    CONSTRAINT "po_draft_pkey" PRIMARY KEY ("quote_id")
);

DO $$
BEGIN
    ALTER TABLE "po_draft"
        ADD CONSTRAINT "po_draft_quote_id_fkey"
        FOREIGN KEY ("quote_id") REFERENCES "quote"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
