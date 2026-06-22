import type { PricingOk } from '@shared/pricing/core'

export interface SaveQuoteRequest {
  model_code: string
  year?: number
  selections: Record<string, string>
  customer?: {
    biz_type: 'individual' | 'corporation' | 'simplified'
    is_sosang: boolean
    region?: string
    scrap_diesel?: boolean
  }
}

export async function saveQuote(
  req: SaveQuoteRequest,
  email: string,
): Promise<{ quote_id: number; pricing: PricingOk }> {
  const res = await fetch('/api/v1/quotes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User': email },
    body: JSON.stringify(req),
  })
  if (res.status === 422) {
    const body = await res.json()
    throw new Error(body.error?.message ?? '내장탑 가격 미정(TBD)')
  }
  if (!res.ok) throw new Error(`견적 저장 실패: ${res.status}`)
  const body = await res.json()
  return body.data
}

export async function fetchLocalSubsidy(region: string, year: number, email: string): Promise<number> {
  if (!region) return 0
  const url = `/api/v1/subsidy/local?region=${encodeURIComponent(region)}&year=${year}`
  const res = await fetch(url, { headers: { 'X-User': email } })
  if (!res.ok) return 0
  const body = await res.json()
  return body.data?.amount ?? 0
}
