/**
 * 차량 판매건별 손익 — 경영관리 화면이 읽고 적는다.
 * 권한은 서버가 정한다(`pnl.view` 로 보고 `pnl.manage` 로 적는다).
 */
export interface PnlRow {
  quote_id: number
  quote_no: string | null
  customer: string | null
  sales_user_id: string | null
  maker_org: string | null
  invoice_on: string | null
  supply_amount: number
  deposit: number
  capital: number
  deposit_paid_on: string | null
  capital_paid_on: string | null
  /** 원가 — **한 칸이다.** 별도 시스템이 하나로 내려 줄 자리(구성 중) */
  cost: number
  /** 'manual' = 손으로 적었다 / 'system' = 원가 시스템이 채웠다 */
  cost_source: string
  memo: string | null
  updated_by: string | null
  /** 삭제된 줄 — 표에 회색으로 남고 합계에서 빠진다 */
  voided_at: string | null
  voided_by: string | null
  void_reason: string | null
}

/** 아직 세금계산서 발행일을 안 적은 건 — 화면 맨 위 「입력 필요」 */
export interface PnlPending {
  quote_id: number
  quote_no: string | null
  customer: string | null
  /** 특장사가 **수락한** 날 — 이때부터 「입력 필요」에 선다 */
  accepted_on: string | null
  supply_default: number | null
  deposit_default: number
}

export interface PnlView {
  month: string
  rows: PnlRow[]
  pending: PnlPending[]
  /** 줄이 있는 달들 — 달 고르개가 「있는 달」을 함께 보여 준다 */
  months: string[]
}

/**
 * 적을 수 있는 칸 — 안 보낸 칸은 그대로 둔다(부분 저장).
 * ⚠️ **공급가액·계약금은 없다** — 계약서에서 가져와 굳힌 값이라 고치지 않는다(서버도 받지 않는다).
 */
export type PnlPatch = Partial<Pick<PnlRow,
  'invoice_on' | 'capital' | 'deposit_paid_on' | 'capital_paid_on' | 'cost' | 'memo'
>>

async function jsonOf<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const b = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(b.error?.message ?? `요청 실패: ${res.status}`)
  }
  return (await res.json() as { data: T }).data
}

export function fetchPnl(month?: string): Promise<PnlView> {
  const qs = month ? `?month=${encodeURIComponent(month)}` : ''
  return fetch(`/api/v1/pnl${qs}`, { credentials: 'include' }).then(jsonOf<PnlView>)
}

/** 삭제 — 줄은 남고 회색이 된다. 사유는 반드시 적는다(서버가 강제) */
export function voidPnl(quoteId: number, reason: string): Promise<PnlRow> {
  return fetch(`/api/v1/pnl/${quoteId}/void`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
  }).then(jsonOf<PnlRow>)
}

/** 되돌리기 */
export function unvoidPnl(quoteId: number): Promise<PnlRow> {
  return fetch(`/api/v1/pnl/${quoteId}/unvoid`, { method: 'POST', credentials: 'include' }).then(jsonOf<PnlRow>)
}

export function savePnl(quoteId: number, patch: PnlPatch): Promise<PnlRow> {
  return fetch(`/api/v1/pnl/${quoteId}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).then(jsonOf<PnlRow>)
}
