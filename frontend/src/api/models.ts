import type { ApiPricingBundle } from '@shared/types/index'

export async function fetchPricingBundle(modelCode: string, email: string): Promise<ApiPricingBundle> {
  const res = await fetch(`/api/v1/models/${modelCode}/pricing-bundle`, {
    headers: { 'X-User': email },
  })
  if (!res.ok) throw new Error(`pricing-bundle 로드 실패: ${res.status}`)
  const body = await res.json()
  return body.data as ApiPricingBundle
}
