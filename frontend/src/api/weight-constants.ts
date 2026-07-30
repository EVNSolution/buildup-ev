export interface WeightConstant {
  key: string
  category: string
  value: number
  unit: string | null
  description: string | null
}

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`)
  }
  const json = await res.json() as { data: T }
  return json.data
}

export async function fetchWeightConstants(): Promise<WeightConstant[]> {
  return apiFetch('/api/v1/weight-constants')
}

export async function upsertWeightConstant(entry: WeightConstant): Promise<void> {
  await apiFetch('/api/v1/weight-constants', { method: 'POST', body: JSON.stringify(entry) })
}
