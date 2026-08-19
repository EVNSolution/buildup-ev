/**
 * 주문에 딸린 파일 목록 — 관리자 「파일」 화면이 읽는 곳.
 * 서버가 업로드본·자동생성본·서명본을 한 목록으로 펴서 내려준다.
 */

/** 파일이 어디서 왔나 — 화면의 가름막이 이 값으로 갈린다 */
export type FileGroup = 'upload' | 'generated' | 'signed'

export interface ApiOrderFile {
  group: FileGroup
  label: string
  name: string | null
  size: number | null
  /** ISO */
  at: string
  by: string | null
  url: string
  download_url: string
}

export interface ApiFileIndexRow {
  order_id: number
  quote_id: number
  quote_no: string | null
  customer_name: string | null
  maker_org: string | null
  created_at: string
  /** 사람이 올린 파일 수 */
  uploads: number
  /** 자동생성 서류 수 */
  generated: number
}

async function jsonOrThrow(res: Response, what: string) {
  if (res.ok) return res.json()
  const body = await res.json().catch(() => ({})) as { error?: { message?: string } }
  throw new Error(body.error?.message ?? `${what} 실패: ${res.status}`)
}

export async function fetchFileIndex(): Promise<ApiFileIndexRow[]> {
  const res = await fetch('/api/v1/orders/file-index', { credentials: 'include' })
  return (await jsonOrThrow(res, '파일 목록 조회') as { data: ApiFileIndexRow[] }).data
}

export async function fetchOrderFiles(orderId: number): Promise<ApiOrderFile[]> {
  const res = await fetch(`/api/v1/orders/${orderId}/file-index`, { credentials: 'include' })
  return (await jsonOrThrow(res, '주문 파일 조회') as { data: ApiOrderFile[] }).data
}
