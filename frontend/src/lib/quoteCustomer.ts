import type { ApiQuote, CustomerInfo } from '@shared/types/index'
import { toDieselStatus } from '@shared/pricing/core'
import type { QuoteSaveValues } from '../components/QuoteSaveModal'

/**
 * 고객정보 값 변환 — 컨피규레이터·견적 저장·견적 수정이 **같은 규칙**을 쓴다.
 *
 * 화면 표기('corporate')와 저장값('corporation')이 달라 한쪽에서만 바꾸면
 * 저장된 견적을 다시 열었을 때 사업자 구분이 개인으로 되돌아간다(실제 사고).
 */

/** 화면 표기 → 저장값 */
export function mapBizType(bt: CustomerInfo['business_type'] | undefined): 'individual' | 'corporation' | 'simplified' | 'consumer' {
  if (bt === 'corporate') return 'corporation'
  if (bt === 'simplified') return 'simplified'
  if (bt === 'consumer') return 'consumer'   // 일반구매자(비사업자) — 부가세 환급 불가
  return 'individual'
}

/** 프론트 표기('corporate') ← 저장값('corporation') 역매핑. mapBizType 의 반대. */
export function unmapBizType(v: unknown): CustomerInfo['business_type'] {
  if (v === 'corporation') return 'corporate'
  if (v === 'simplified') return 'simplified'
  if (v === 'consumer') return 'consumer'
  return 'individual'
}

/**
 * 이 견적이 **특장만 견적인가** — `inputs` 스냅샷에 남아 있다.
 *
 * 필수 입력 판정이 이 값에 걸린다(특장만이면 보조금 조건을 묻지 않는다).
 * 곳곳에서 `inputs['body_only']` 를 직접 파면 한 곳을 빠뜨렸을 때 그 화면만 막힌다.
 */
export function isBodyOnly(q: ApiQuote): boolean {
  return ((q.inputs ?? {}) as Record<string, unknown>)['body_only'] === true
}

/** 차량만 견적 — 특장을 장착하지 않고 차량만 판다. 특장만과 동시에 참일 수 없다. */
export function isVehicleOnly(q: ApiQuote): boolean {
  const inp = (q.inputs ?? {}) as Record<string, unknown>
  return inp['body_only'] !== true && inp['vehicle_only'] === true
}

/** 견적의 종류 — 목록·서류함에서 **열어 보지 않고** 가릴 수 있게 한다. */
export type QuoteKind = 'full' | 'body' | 'vehicle'

export function quoteKind(q: ApiQuote): QuoteKind {
  if (isBodyOnly(q)) return 'body'
  if (isVehicleOnly(q)) return 'vehicle'
  return 'full'
}

/**
 * 목록에 붙일 짧은 이름.
 *
 * 일반 견적(차량+특장)은 **아무것도 붙이지 않는다** — 대부분이 그것이라
 * 다 붙이면 표가 배지로 뒤덮여 정작 다른 건이 안 보인다.
 */
export const QUOTE_KIND_LABEL: Record<QuoteKind, string | null> = {
  full: null,
  body: '특장만',
  vehicle: '차량만',
}

/**
 * 저장된 견적 → 고객정보 수정 폼 초기값.
 * 고객 행(customer)과 견적 입력 스냅샷(inputs) 두 곳에 나뉘어 있어 여기서 합친다.
 */
export function customerEditValues(q: ApiQuote): QuoteSaveValues {
  const inp = (q.inputs ?? {}) as Record<string, unknown>
  const str = (k: string) => String(inp[k] ?? '')
  return {
    subsidy: {
      business_type: unmapBizType(inp['biz_type']),
      region_code: str('region'),
      is_small_business: inp['is_sosang'] === true,
      has_transport_license: inp['has_transport_license'] === true,
      // 옛 견적은 diesel_status 가 없고 boolean 만 있다 — '유지' 여부로 복원한다.
      diesel_status: toDieselStatus(inp['diesel_status'], inp['diesel_conversion']),
    },
    name: q.customer?.name ?? '',
    ceo_name: str('ceo_name'),
    email: q.customer?.email ?? '',
    phone: q.customer?.phone ?? '',
    address: q.customer?.address ?? '',
    address_detail: q.customer?.address_detail ?? '',
    contract_party: str('contract_party'),
    // 이미 고른 계약일이 있으면 그대로 — 없으면 폼이 오늘로 채운다
    contract_date: str('contract_date'),
    buyer_agent: str('buyer_agent'),
    buyer_relation: str('buyer_relation'),
    buyer_regno: str('buyer_regno'),
    buyer_tel: str('buyer_tel'),
    // 특장만 견적의 보유 차종 — inputs.vehicle_owned.model 에 저장된다
    owned_model: String(((inp['vehicle_owned'] ?? {}) as Record<string, unknown>)['model'] ?? ''),
  }
}

