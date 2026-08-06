import type { PricingOk, QuoteResult } from '@shared/pricing/core'
import type { ApiQuote } from '@shared/types/index'

export interface SaveQuoteRequest {
  model_code: string
  year?: number
  selections: Record<string, string>
  memo?: string                     // 메모/안내문
  promotion_zeroed?: string[]       // 재량할인: 0원 처리 특장옵션 그룹코드
  local_subsidy_off?: boolean       // 지방보조금 미적용(예산 소진 — 이 견적에만)
  customer?: {
    name?: string
    email?: string
    phone?: string
    biz_type: 'individual' | 'corporation' | 'simplified' | 'consumer'
    is_sosang: boolean
    region?: string
    address?: string
    has_transport_license?: boolean
    diesel_conversion?: boolean
    has_biz_plate?: boolean
    tax_exempt_type?: string
  }
}

export async function saveQuote(req: SaveQuoteRequest): Promise<{ quote_id: number; pricing: PricingOk }> {
  const res = await fetch('/api/v1/quotes', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (res.status === 422) {
    const body = await res.json() as { error?: { message?: string } }
    throw new Error(body.error?.message ?? '내장탑 가격 미정(TBD)')
  }
  if (!res.ok) throw new Error(`견적 저장 실패: ${res.status}`)
  const body = await res.json() as { data: { quote_id: number; pricing: PricingOk } }
  return body.data
}

export async function fetchQuotes(params: { status?: string; from?: string; to?: string }): Promise<ApiQuote[]> {
  const q = new URLSearchParams()
  if (params.status) q.set('status', params.status)
  if (params.from) q.set('from', params.from)
  if (params.to) q.set('to', params.to)
  const url = `/api/v1/quotes${q.toString() ? '?' + q.toString() : ''}`
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error(`견적 목록 로드 실패: ${res.status}`)
  const body = await res.json() as { data: ApiQuote[] }
  return body.data
}

/** 확정 (임시저장→확정) */
export async function confirmQuote(quoteId: number): Promise<void> {
  const res = await fetch(`/api/v1/quotes/${quoteId}/confirm`, {
    method: 'PATCH',
    credentials: 'include',
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(body.error?.message ?? `확정 실패: ${res.status}`)
  }
}

/** 배정 (확정→배정, 특장사 선정 + 주문 생성) */
export async function assignQuote(quoteId: number, makerOrgId: string): Promise<void> {
  const res = await fetch(`/api/v1/quotes/${quoteId}/assign`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maker_org_id: makerOrgId }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(body.error?.message ?? `배정 실패: ${res.status}`)
  }
}

export async function deleteQuote(id: number): Promise<void> {
  const res = await fetch(`/api/v1/quotes/${id}`, { method: 'DELETE', credentials: 'include' })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(body.error?.message ?? `삭제 실패: ${res.status}`)
  }
}

// ── 총견적서(확정 팝업·재출력) ────────────────────────────────────────────

export interface InstallmentRateOption { months: number; rate: number; label: string | null }

export async function fetchInstallmentRates(): Promise<InstallmentRateOption[]> {
  const res = await fetch('/api/v1/quotes/installment-rates', { credentials: 'include' })
  if (!res.ok) return []
  const body = await res.json() as { data: InstallmentRateOption[] }
  return body.data
}

/** 총견적서 입력 부분저장(임시저장). 허용필드만 병합됨. */
export async function saveQuoteInputs(quoteId: number, patch: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/api/v1/quotes/${quoteId}/inputs`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(b.error?.message ?? `입력 저장 실패: ${res.status}`)
  }
}

export interface TotalQuoteResult { quote_id: number; customer_name: string | null; memo: string; total: QuoteResult }

/** 저장된 입력으로 총견적서 재계산. */
export async function fetchTotalQuote(quoteId: number): Promise<TotalQuoteResult> {
  const res = await fetch(`/api/v1/quotes/${quoteId}/total`, { credentials: 'include' })
  if (!res.ok) throw new Error(`총견적 재계산 실패: ${res.status}`)
  const body = await res.json() as { data: TotalQuoteResult }
  return body.data
}

export async function fetchRegions(): Promise<string[]> {
  const res = await fetch('/api/v1/regions', { credentials: 'include' })
  if (!res.ok) return []
  const body = await res.json() as { data: string[] }
  return body.data
}

export async function fetchLocalSubsidy(region: string, year: number): Promise<number> {
  if (!region) return 0
  const url = `/api/v1/subsidy/local?region=${encodeURIComponent(region)}&year=${year}`
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) return 0
  const body = await res.json() as { data?: { amount?: number } }
  return body.data?.amount ?? 0
}
