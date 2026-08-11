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
    buyer_agent: str('buyer_agent'),
    buyer_relation: str('buyer_relation'),
    buyer_regno: str('buyer_regno'),
    buyer_tel: str('buyer_tel'),
  }
}

