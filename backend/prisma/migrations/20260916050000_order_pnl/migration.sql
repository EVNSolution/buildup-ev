-- **차량 판매건별 손익**(2026-09-16 지시) — 경영관리가 월 단위로 적고 보는 표.
-- 지금 쓰는 엑셀(차량판매_손익_양식.xlsx)을 그대로 옮긴다. 기준 달은 **세금계산서 발행일**이다.
--
-- ⚠️ 새 표만 더한다. 기존 표·칸은 건드리지 않는다.
-- ⚠️ VAT·공급대가·입금 차액은 **적지 않는다** — 엑셀과 같은 식으로 그때그때 낸다.
--    적어 두면 공급가액을 고쳤을 때 둘이 어긋나고, 어느 쪽이 맞는지 알 수 없어진다.
CREATE TABLE IF NOT EXISTS "order_pnl" (
  "id"                SERIAL PRIMARY KEY,
  -- 판매 한 건 = 견적 하나. 한 건에 손익 줄은 하나뿐이다
  "quote_id"          INTEGER NOT NULL UNIQUE,
  -- 세금계산서 발행일 — **이 날짜가 몇 월 표에 들어갈지를 정한다.** 비어 있으면 「입력 필요」에 남는다
  "invoice_on"        DATE,
  -- 사업자명 — 고객명과 다를 수 있다(개인 이름으로 계약하고 상호로 발행). 처음엔 고객명으로 채운다
  "biz_name"          VARCHAR(120),
  -- 공급가액(VAT 별도) — 계약서상 특장가격에서 처음 값을 채우고, 그 뒤로는 적힌 값이 정본이다
  "supply_amount"     BIGINT  NOT NULL DEFAULT 0,
  -- 계약금 — 시스템에 등록된 특장 계약금으로 채우되 고칠 수 있다
  "deposit"           BIGINT  NOT NULL DEFAULT 0,
  -- 캐피탈 — 경영관리가 직접 적는다
  "capital"           BIGINT  NOT NULL DEFAULT 0,
  -- 입금일 — 계약금과 캐피탈을 따로 적는다
  "deposit_paid_on"   DATE,
  "capital_paid_on"   DATE,
  -- 원가 — **별도 시스템에서 불러올 자리다**(구성 중). 그때까지는 손으로 적는다.
  -- 어디서 온 값인지 남겨 두어야, 나중에 자동으로 채울 때 손으로 적은 값을 함부로 덮지 않는다
  "cost_outsourcing"  BIGINT  NOT NULL DEFAULT 0,
  "cost_supply"       BIGINT  NOT NULL DEFAULT 0,
  "cost_internal"     BIGINT  NOT NULL DEFAULT 0,
  "cost_etc"          BIGINT  NOT NULL DEFAULT 0,
  "cost_source"       VARCHAR(20) NOT NULL DEFAULT 'manual',
  "cost_memo"         VARCHAR(500),
  -- 비고 — 엑셀의 「비고 (사업자등록증 확인 필요)」 칸
  "memo"              VARCHAR(500),
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by"        VARCHAR(120),
  CONSTRAINT "order_pnl_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- 월별 조회가 이 표의 거의 전부다
CREATE INDEX IF NOT EXISTS "order_pnl_invoice_on_idx" ON "order_pnl"("invoice_on");
