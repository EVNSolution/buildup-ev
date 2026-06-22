import type { QuoteCalculateRequest, QuoteResult } from '@shared/types/index'

// TODO: POST /quotes/calculate 실연결

/**
 * Mock 응답 — 회귀 기준: 범석환(남양주, 소상공인) 케이스 실구매가 = ₩46,471,818
 */
const MOCK_RESULT_WITH_SUBSIDY: QuoteResult = {
  supply_price: 46_000_000,        // placeholder
  vat: 4_600_000,                  // placeholder
  vehicle_price: 50_600_000,       // placeholder
  subsidy_national: 0,             // placeholder — DB 확정 후
  subsidy_local: 0,                // placeholder
  subsidy_small_biz: 0,            // placeholder
  total_subsidy: 0,                // placeholder
  subsidy_applied_price: 51_270_000,
  vat_refund: 6_333_636,
  vat_refund_price: 44_936_364,
  registration_fee: 1_535_455,
  final_price: 46_471_818,         // ← 회귀 검증값
}

const MOCK_RESULT_NO_SUBSIDY: QuoteResult = {
  ...MOCK_RESULT_WITH_SUBSIDY,
  subsidy_national: 0,
  subsidy_local: 0,
  subsidy_small_biz: 0,
  total_subsidy: 0,
  subsidy_applied_price: 0,
  final_price: 0, // 보조금 미적용 시 실구매가 미제공
}

export async function calculateQuote(req: QuoteCalculateRequest): Promise<QuoteResult> {
  // TODO: return fetch('/api/quotes/calculate', { method:'POST', body:JSON.stringify(req) }).then(r=>r.json())
  await new Promise(r => setTimeout(r, 300)) // mock latency
  return req.customer ? MOCK_RESULT_WITH_SUBSIDY : MOCK_RESULT_NO_SUBSIDY
}
