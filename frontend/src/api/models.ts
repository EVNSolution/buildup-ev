import type { ApiPricingBundle } from '@shared/types/index'

export async function fetchPricingBundle(modelCode: string): Promise<ApiPricingBundle> {
  const res = await fetch(`/api/v1/models/${modelCode}/pricing-bundle`, { credentials: 'include' })
  if (!res.ok) throw new Error(`pricing-bundle 로드 실패: ${res.status}`)
  const body = await res.json() as { data: ApiPricingBundle }
  return body.data
}
