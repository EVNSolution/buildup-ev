/**
 * 고객 서류함 — 견적서·계약서를 고객별로 모아 본다.
 * 범위는 서버가 정한다(관리자 전체 · 영업은 자기 견적의 고객만).
 */

export interface ApiFolderRow {
  /** 폴더 열쇠 = 그룹에서 가장 작은 고객번호 */
  key: number
  name: string
  reg_no: string | null
  phone: string | null
  /** 한 사람인데 고객 행이 여럿이면 그 수 */
  merged: number
  quotes: number
  /** ISO — 최근 변경 순으로 정렬돼 온다 */
  last_activity: string
}

export interface ApiFolderDoc {
  id: string
  kind: string
  quoteNo: string | null
  at: string
  size: number
  /** 서명 요청 시점에 굳힌 정본 — 목록 맨 위에 고정된다 */
  pinned: boolean
}

export interface ApiFolder {
  data: ApiFolderDoc[]
  customer: { key: number; name: string; reg_no: string | null; phone: string | null; merged: number }
}

async function jsonOrThrow(res: Response, what: string) {
  if (res.ok) return res.json()
  const body = await res.json().catch(() => ({})) as { error?: { message?: string } }
  throw new Error(body.error?.message ?? `${what} 실패: ${res.status}`)
}

/**
 * `mine` — **영업 화면에서 부를 때 참으로 준다.** 겸직(영업+관리자) 계정이라도
 * 남의 담당 고객은 보지 않는다. 좁히기만 하므로 권한이 넓어지는 일은 없다.
 */
const mineQ = (mine?: boolean) => (mine ? '?scope=mine' : '')

export async function fetchFolders(mine?: boolean): Promise<ApiFolderRow[]> {
  const res = await fetch(`/api/v1/customer-folders${mineQ(mine)}`, { credentials: 'include' })
  return (await jsonOrThrow(res, '서류함 조회') as { data: ApiFolderRow[] }).data
}

export async function fetchFolder(key: number, mine?: boolean): Promise<ApiFolder> {
  const res = await fetch(`/api/v1/customer-folders/${key}${mineQ(mine)}`, { credentials: 'include' })
  return await jsonOrThrow(res, '서류함 조회') as ApiFolder
}

export function folderFileUrl(key: number, docId: string, download = false, mine?: boolean): string {
  const qs = [mine ? 'scope=mine' : '', download ? 'dl=1' : ''].filter(Boolean).join('&')
  return `/api/v1/customer-folders/${key}/file/${docId}${qs ? '?' + qs : ''}`
}
