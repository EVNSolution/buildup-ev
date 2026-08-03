export interface EmailResult { to: string; attachments: string[] }

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

export interface SendQuoteEmailOpts {
  to?: string
  cc?: string
  message?: string
  include_contract?: boolean
}

/** 견적서(+계약서) PDF 를 고객 이메일로 발송. to 비우면 서버가 등록된 고객 이메일 사용. */
export async function sendQuoteEmail(quoteId: number, opts: SendQuoteEmailOpts): Promise<EmailResult> {
  return apiFetch(`/api/v1/quotes/${quoteId}/email`, { method: 'POST', body: JSON.stringify(opts) })
}
