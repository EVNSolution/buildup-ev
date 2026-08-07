/** 옵션DB(기준데이터) 관리자 CRUD + 변경이력 API — ADMIN 전용. */

export interface OptionDbTable {
  pk: string[]
  fields: string[]
  numeric: string[]
  rows: Record<string, unknown>[]
}

export interface OptionDbLog {
  id: number
  table_name: string
  row_key: string
  field: string
  old_value: string | null
  new_value: string | null
  action: string
  changed_by: string
  changed_at: string
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) {
    const b = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(b.error?.message ?? `조회 실패: ${res.status}`)
  }
  const body = await res.json() as { data: T }
  return body.data
}

export const OPTION_DB_TABLES = [
  { name: 'option_price',     label: '옵션 단가' },
  { name: 'subsidy_local',    label: '지방보조금 (지역)' },
  { name: 'subsidy_national', label: '국고보조금' },
  { name: 'tax_config',       label: '세율·부대비용' },
  { name: 'installment_rate', label: '할부 이율' },
] as const

export function fetchOptionDbTable(table: string, q?: string): Promise<OptionDbTable> {
  const qs = q ? `?q=${encodeURIComponent(q)}` : ''
  return get<OptionDbTable>(`/api/v1/option-db/${table}${qs}`)
}

/** 행 저장(단건·다건 일괄). 변경된 필드만 이력에 기록됨. */
export async function saveOptionDbRows(table: string, rows: Record<string, unknown>[]): Promise<{ rows: number; changed_fields: number }> {
  const res = await fetch(`/api/v1/option-db/${table}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(b.error?.message ?? `저장 실패: ${res.status}`)
  }
  const body = await res.json() as { data: { rows: number; changed_fields: number } }
  return body.data
}

export function fetchOptionDbLogs(params: { table?: string; row_key?: string; limit?: number } = {}): Promise<OptionDbLog[]> {
  const qs = new URLSearchParams()
  if (params.table) qs.set('table', params.table)
  if (params.row_key) qs.set('row_key', params.row_key)
  if (params.limit) qs.set('limit', String(params.limit))
  return get<OptionDbLog[]>(`/api/v1/option-db/logs${qs.toString() ? '?' + qs : ''}`)
}
