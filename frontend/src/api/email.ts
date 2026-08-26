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

/** 지금까지 이 견적으로 무엇을 보냈나 — 메일 전달 팝업이 띄운다. */
export interface EmailLogRow {
  id: number
  /** 보낸 시점의 견적번호 — 어느 판을 보냈는지 가린다 */
  quoteNo: string | null
  to: string
  /** true = 견적서+계약서 · false = 견적서만 */
  withContract: boolean
  attachments: string
  sentBy: string
  sentAt: string
}

export async function fetchEmailLog(quoteId: number): Promise<EmailLogRow[]> {
  return apiFetch(`/api/v1/quotes/${quoteId}/email-log`)
}
