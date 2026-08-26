import type { PricingOk, QuoteResult } from '@shared/pricing/core'
import type { QuotePriceExtras } from '@shared/pricing/quote-request'
import type { ApiQuote } from '@shared/types/index'

export interface SaveQuoteRequest extends Partial<QuotePriceExtras> {
  model_code: string
  year?: number
  selections: Record<string, string>
  memo?: string                     // 메모/안내문
  /** 특장만 견적 — 고객이 차를 이미 갖고 있다(차량 금액·보조금이 전부 빠진다) */
  body_only?: boolean
  /** 차량만 견적 — 특장을 얹지 않는다 */
  vehicle_only?: boolean
  /** 특장만일 때 고객이 적어 주는 보유 차량 정보 */
  vehicle_owned?: Record<string, string>
  // 금액을 바꾸는 입력(프로모션·지방보조금 토글)은 shared 가 이름의 단일 소스다.
  // 여기서 직접 나열하면 shared 에 항목이 늘어도 눈치채지 못한다 — 그러다 #182 가 났다.
  customer?: {
    name?: string
    ceo_name?: string               // 대표이사 — 법인사업자일 때만(계약서 서명블록)
    email?: string
    phone?: string
    biz_type: 'individual' | 'corporation' | 'simplified' | 'consumer'
    is_sosang: boolean
    region?: string
    address?: string
    address_detail?: string
    has_transport_license?: boolean
    /** 경유차 폐차여부 — 'none'|'keep'|'scrap'. 국고가 깎이는 건 'keep'뿐(엑셀 D15). */
    diesel_status?: 'none' | 'keep' | 'scrap'
    /** @deprecated diesel_status 로 대체 — 옛 클라이언트 호환용 */
    diesel_conversion?: boolean
    has_biz_plate?: boolean
    tax_exempt_type?: string
    // 계약서 전용 입력(견적 저장 단계에서 함께 받는다). 비우면 계약서에 공란.
    contract_party?: string
    buyer_agent?: string
    buyer_relation?: string
    buyer_regno?: string
    buyer_tel?: string
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

export async function fetchQuotes(params: {
  status?: string; from?: string; to?: string; view?: 'active' | 'hidden'
  /**
   * `'mine'` — **영업 화면에서 부를 때 붙인다.** 겸직(영업+관리자) 계정이라도
   * 남의 담당 견적은 보지 않는다. 좁히기만 하므로 붙여서 권한이 넓어지는 일은 없다.
   */
  scope?: 'mine'
}): Promise<ApiQuote[]> {
  const q = new URLSearchParams()
  if (params.scope) q.set('scope', params.scope)
  if (params.status) q.set('status', params.status)
  if (params.from) q.set('from', params.from)
  if (params.to) q.set('to', params.to)
  // 「숨김」은 숨긴 것만 — 진행 중인 것과 섞지 않는다
  if (params.view === 'hidden') q.set('view', 'hidden')
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

/** 견적에 연결된 고객정보 수정 — 견적서·계약서에 즉시 반영된다(새 고객이 생기지 않음). */
export async function saveQuoteCustomer(
  quoteId: number,
  patch: { name?: string; phone?: string; email?: string; address?: string; address_detail?: string; reg_no?: string; ceo_name?: string; tel?: string },
): Promise<void> {
  const res = await fetch(`/api/v1/quotes/${quoteId}/customer`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    const b = await res.json().catch(() => null) as { error?: { message?: string } } | null
    throw new Error(b?.error?.message ?? `고객정보 저장 실패: ${res.status}`)
  }
}

/**
 * 고객 마스터 자동 기입용 조회 결과.
 * ⚠️ 이메일은 없다 — 견적마다 받는 담당자가 달라져 매번 새로 입력받는다.
 */
export interface CustomerMasterHit {
  id: number
  name: string
  ceo_name: string | null
  phone: string | null
  tel: string | null
  address: string | null
  reg_no: string | null
}

/**
 * 성명(상호) + 생년월일(사업자번호) **완전일치** 1건 조회. 없으면 null.
 * 서버가 두 값을 모두 요구한다 — 부분검색·목록 조회는 없다(남의 고객정보 노출 방지).
 */
export async function lookupCustomer(name: string, regNo: string): Promise<CustomerMasterHit | null> {
  if (!name.trim() || !regNo.trim()) return null
  const q = new URLSearchParams({ name: name.trim(), reg_no: regNo.trim() })
  const res = await fetch(`/api/v1/customers/lookup?${q}`, { credentials: 'include' })
  if (!res.ok) return null              // 조회 실패는 자동 기입을 건너뛸 뿐, 입력을 막지 않는다
  const body = await res.json() as { data: CustomerMasterHit | null }
  return body.data
}

// ── WARP CRM 연동 자동 기입 ────────────────────────────────────────────────

/** WARP CRM 차량 참고 정보 — 화면 표시 전용, 견적에 저장하지 않는다. */
export interface WarpVehicleInfo {
  maker: string | null
  name: string | null
  plate_no: string | null
  year: string | null
  truck_types: string[]
}

/** WARP CRM 조회 결과 — 백엔드 프록시(/customers/warp-lookup)가 변환해서 준다. */
export interface WarpAutofillHit {
  /** WARP 에 등록된 고객명 — 안내 표시용. 폼의 성명은 매칭 키라 덮지 않는다. */
  name: string
  email: string | null
  birth_regno: string | null      // YYYY-MM-DD (8자리 검증 완료) 또는 null
  biz_regno: string | null        // 000-00-00000 (10자리 검증 완료) 또는 null
  ceo_name: string | null         // B2B 고객일 때 대표이사 후보
  address: string | null
  address_detail: string | null
  tel: string | null
  match_count: number             // 2 이상이면 동일 이름+전화 중복 등록(최신 1건 기준)
  vehicles: WarpVehicleInfo[]
}

/**
 * 이름 + 휴대폰 **완전일치**로 WARP CRM 고객 1건 조회. 없거나 실패하면 null.
 * API 키는 백엔드에만 있다 — 브라우저는 WARP 를 직접 부르지 않는다.
 */
export async function lookupWarpCustomer(name: string, phone: string): Promise<WarpAutofillHit | null> {
  if (!name.trim() || !phone.trim()) return null
  const q = new URLSearchParams({ name: name.trim(), phone: phone.trim() })
  try {
    const res = await fetch(`/api/v1/customers/warp-lookup?${q}`, { credentials: 'include' })
    if (!res.ok) return null          // 조회 실패는 자동 기입을 건너뛸 뿐, 입력을 막지 않는다
    const body = await res.json() as { data: WarpAutofillHit | null }
    return body.data
  } catch {
    return null
  }
}


/** 견적 수정 이력 한 줄 */
export interface QuoteChange {
  id: number
  section: 'options' | 'customer' | 'inputs'
  field: string
  old_value: string | null
  new_value: string | null
  changed_by: string
  changed_at: string
}

/** 저장된 견적의 옵션 변경 — 금액도 함께 다시 계산된다. */
export async function saveQuoteSelections(
  quoteId: number, selections: Record<string, string>,
): Promise<{ changed: number; final_price: number }> {
  const res = await fetch(`/api/v1/quotes/${quoteId}/selections`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selections }),
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(b.error?.message ?? `옵션 저장 실패: ${res.status}`)
  }
  const body = await res.json() as { data: { changed: number; final_price: number } }
  return body.data
}

/** 이 견적에서 무엇이 언제 바뀌었는지(최근 순). */
export async function fetchQuoteHistory(quoteId: number): Promise<QuoteChange[]> {
  const res = await fetch(`/api/v1/quotes/${quoteId}/history`, { credentials: 'include' })
  if (!res.ok) {
    const b = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(b.error?.message ?? `이력 조회 실패: ${res.status}`)
  }
  const body = await res.json() as { data: QuoteChange[] }
  return body.data
}


/** 같은 고객·같은 옵션으로 새 견적을 만든다(새 번호·임시저장부터). */
export async function duplicateQuote(quoteId: number): Promise<{ id: number; quote_no: string | null }> {
  const res = await fetch(`/api/v1/quotes/${quoteId}/duplicate`, { method: 'POST', credentials: 'include' })
  if (!res.ok) {
    const b = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(b.error?.message ?? `견적 복제 실패: ${res.status}`)
  }
  const body = await res.json() as { data: { id: number; quote_no: string | null } }
  return body.data
}

/**
 * 공개 문의를 영업사원에게 배정한다(관리자).
 * 배정되는 순간 견적번호가 처음 발급되고, 그 영업의 「내 견적」에 나타난다.
 */
/** 담당 영업이 배정된 공개 문의를 받는다(특장사의 주문 수락과 같은 자리). */
export async function acceptSalesQuote(quoteId: number): Promise<void> {
  const res = await fetch(`/api/v1/quotes/${quoteId}/accept-sales`, {
    method: 'PATCH',
    credentials: 'include',
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(body.error?.message ?? `수락 실패: ${res.status}`)
  }
}

export async function assignSalesQuote(quoteId: number, salesUserId: string): Promise<{ quote_no: string }> {
  const res = await fetch(`/api/v1/quotes/${quoteId}/assign-sales`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sales_user_id: salesUserId }),
  })
  const body = await res.json().catch(() => ({})) as { data?: { quote_no: string }; error?: { message?: string } }
  if (!res.ok) throw new Error(body.error?.message ?? `배정 실패: ${res.status}`)
  return body.data!
}

/** 견적 숨기기 / 다시 보이기 — 지우지 않고 화면에서만 감춘다(임시저장만 가능). */
export async function setQuoteHidden(id: number, hidden: boolean): Promise<void> {
  const res = await fetch(`/api/v1/quotes/${id}/hidden`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hidden }),
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(b?.error?.message ?? `숨김 처리 실패: ${res.status}`)
  }
}
