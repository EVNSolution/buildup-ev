import type { ApiPricingBundle } from '@shared/types/index'

/**
 * 공개(비로그인) API 클라이언트 — `/api/v1/public/*`
 *
 * 로그인 화면이 쓰는 api/models·api/quotes 와 **엔드포인트를 나눠 둔다**.
 * 화면이 실수로 잠긴 API 를 부르면 401/403 으로 바로 드러나고,
 * 잠긴 API 에 필드가 늘어도 공개 화면으로 새어 나가지 않는다.
 *
 * ⚠️ 쿠키를 보내지 않는다(credentials 기본값). 공개 화면은 세션과 무관하게 돈다.
 */
async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    const b = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(b.error?.message ?? `요청 실패: ${res.status}`)
  }
  return (await res.json() as { data: T }).data
}

export function fetchPublicPricingBundle(modelCode: string, year?: number): Promise<ApiPricingBundle> {
  const q = year ? `?year=${year}` : ''
  return get<ApiPricingBundle>(`/api/v1/public/models/${modelCode}/pricing-bundle${q}`)
}

export function fetchPublicRegions(): Promise<string[]> {
  return get<string[]>('/api/v1/public/regions')
}

export async function fetchPublicLocalSubsidy(region: string, year: number): Promise<number> {
  const d = await get<{ amount: number; extra: number | null } | null>(
    `/api/v1/public/subsidy/local?region=${encodeURIComponent(region)}&year=${year}`,
  )
  return d ? d.amount + (d.extra ?? 0) : 0
}

/** 상담 신청(접수) — 성공하면 접수번호만 돌아온다. */
export interface InquiryInput {
  model_code: string
  selections: Record<string, string>
  contact: { name: string; phone: string; email: string; memo?: string }
  subsidy: {
    region: string
    biz_type: string
    is_sosang?: boolean
    has_transport_license?: boolean
    diesel_status?: string
  }
  agreed: boolean
  /** 특장만 견적 — 차량 금액·보조금이 전부 빠진다(금액은 서버가 다시 계산한다) */
  body_only?: boolean
  /** 특장만일 때 고객이 고른 보유 차종 */
  vehicle_owned?: { model: string }
  /** 봇 잡이 — 화면에서 감춘 칸. 사람은 비워 둔 채로 보낸다. */
  website?: string
}

export async function submitInquiry(input: InquiryInput): Promise<{ inquiry_id: number }> {
  const res = await fetch('/api/v1/public/inquiries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await res.json().catch(() => ({})) as { data?: { inquiry_id: number }; error?: { message?: string } }
  if (!res.ok) throw new Error(body.error?.message ?? `상담 신청에 실패했습니다 (${res.status})`)
  return body.data!
}
