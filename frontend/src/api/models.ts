import type { ApiPricingBundle } from '@shared/types/index'

export async function fetchPricingBundle(modelCode: string): Promise<ApiPricingBundle> {
  const res = await fetch(`/api/v1/models/${modelCode}/pricing-bundle`, { credentials: 'include' })
  if (!res.ok) throw new Error(`pricing-bundle 로드 실패: ${res.status}`)
  const body = await res.json() as { data: ApiPricingBundle }
  return body.data
}

export interface ModelSpec {
  wheelbase_mm: number
  curb_axle_front_kg: number
  curb_axle_rear_kg: number
  gvw_limit_kg: number | null
  tire_front: { allowable_load_kg: number; wheels: number }
  tire_rear:  { allowable_load_kg: number; wheels: number }
}

export async function fetchModelSpec(modelCode: string): Promise<ModelSpec> {
  const res = await fetch(`/api/v1/models/${modelCode}/spec`, { credentials: 'include' })
  if (!res.ok) throw new Error(`차종 제원 로드 실패: ${res.status}`)
  const body = await res.json() as { data: ModelSpec }
  return body.data
}
