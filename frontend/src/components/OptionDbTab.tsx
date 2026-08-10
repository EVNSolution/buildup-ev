import { useEffect, useState } from 'react'
import {
  OPTION_DB_TABLES, fetchOptionDbTable, saveOptionDbRows, fetchOptionDbLogs,
  type OptionDbTable, type OptionDbLog,
} from '../api/option-db'

/**
 * 옵션DB(기준데이터) 관리 — ADMIN 전용.
 * 총견적서 '옵션DB' 시트에 해당하는 값들을 여기서만 수정한다(단가·보조금·세율·이율).
 * 수정 시 변경 필드별로 이전값→새값·수정자·수정일시가 기록되며 [변경 이력]에서 확인.
 */
export function OptionDbTab() {
  const [table, setTable] = useState<string>(OPTION_DB_TABLES[0].name)
  const [q, setQ] = useState('')
  const [data, setData] = useState<OptionDbTable | null>(null)
  const [edits, setEdits] = useState<Record<string, Record<string, unknown>>>({})
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [logs, setLogs] = useState<OptionDbLog[] | null>(null)

  const keyOf = (row: Record<string, unknown>, pk: string[]) => pk.map((f) => String(row[f] ?? '')).join('|')

  // ── 단가 표시 단위 ────────────────────────────────────────────────────────
  // 총견적서 '옵션DB' 시트는 전부 **VAT 포함**으로 관리한다. DB 는 공급가로 저장하므로
  // (계산·견적서가 전부 공급가 기준) 화면에서만 ×1.1 해 보여주고, 저장 시 되돌린다.
  // → 엑셀 숫자를 그대로 옮겨 적을 수 있고, 계산 로직은 한 줄도 바뀌지 않는다.
  const VAT_FIELDS: Record<string, string[]> = {
    option_price: ['supply_price'],
  }
  const isVatField = (f: string) => (VAT_FIELDS[table] ?? []).includes(f)
  const toVat = (supply: number) => Math.round(supply * 1.1)
  const toSupply = (vat: number) => Math.round(vat / 1.1)

  // ── 구분(섹션) ────────────────────────────────────────────────────────────
  // 엑셀 옵션DB 시트의 구분과 동일하게 나눈다. 한 덩어리로 모여 있으면 찾기 어렵다.
  const SECTIONS: { label: string; prefixes: string[] }[] = [
    { label: '차량 옵션 (트림)',        prefixes: ['TRIM'] },
    { label: '특장 옵션 (적재함 사양)', prefixes: ['TOP'] },
    { label: '특장 옵션 (도어 종류)',   prefixes: ['DOPT'] },
    { label: '특장 옵션 (도어 추가)',   prefixes: ['DADD'] },
    { label: '스포일러',                prefixes: ['SPL', 'SPOILER'] },
    { label: '특장 옵션 (기타)',        prefixes: ['TEMP', 'PART'] },
    { label: '부가 상품',               prefixes: ['BLACKBOX', 'TINT', 'DECAL', 'SUPPLYKIT'] },
  ]
  const sectionOf = (row: Record<string, unknown>): string => {
    const pfx = String(row['value_code'] ?? '').split('_')[0]
    return SECTIONS.find((s) => s.prefixes.includes(pfx))?.label ?? '기타'
  }
  // ── 코드 → 사람이 읽는 이름 ──────────────────────────────────────────────
  // 옵션 단가는 `DOPT_REEFER_LOW_SLIDE` 같은 복합코드다. 무슨 조합인지 코드를 알아야
  // 읽히므로, DB 구조를 모르는 관리자가 고칠 수 없었다. 조각을 한글로 풀어 함께 보여준다.
  const PART_KO: Record<string, string> = {
    // 적재함 형태
    REEFER: '냉동', DRY: '내장',
    // 탑 높이
    LOW: '저상', STD: '표준',
    // 도어 종류
    SWING: '여닫이', SLIDE: '슬라이딩', EVSLIDE: '냉동/냉장 미닫이',
    COUPANG: '미닫이', FOLD: '양문미닫이',
    // 격벽 종류
    NET: '그물망', MOVE: '이동식',
    // 트림
    BASIC: '기본(Basic)', PLUS: '플러스(Plus)',
    // 단독 옵션
    O: '있음', X: '없음',
  }
  /** 접두어 → 무엇의 가격인지 */
  const PREFIX_KO: Record<string, string> = {
    TRIM: '트림', TOP: '탑', DOPT: '도어 종류', DADD: '도어 추가',
    SPL: '스포일러', PART: '격벽', TEMP: '온도기록계',
    BLACKBOX: '블랙박스', TINT: '썬팅', DECAL: '데칼', SUPPLYKIT: '지급품 키트',
  }
  /** 열 제목도 코드 대신 한글로 — 관리자가 무슨 칸인지 알 수 있어야 한다. */
  const COL_KO: Record<string, string> = {
    model_code: '차종', value_code: '옵션 코드', supply_price: '단가', memo: '메모',
    region: '지역', year: '연도', amount: '금액', extra: '추가', remaining_quota: '잔여물량',
    as_of: '기준일', active: '적용', param_key: '항목', value: '값', unit: '단위',
    months: '개월수', rate: '이율', label: '표기',
  }

  /** `DOPT_REEFER_LOW_SLIDE` → '도어 종류 · 냉동 / 저상 / 슬라이딩' */
  function humanize(code: string): string {
    const [prefix, ...rest] = code.split('_')
    const head = PREFIX_KO[prefix ?? ''] ?? prefix ?? ''
    if (!rest.length) return head
    const parts = rest.map((r) => PART_KO[r] ?? r)
    return `${head} · ${parts.join(' / ')}`
  }

  /** 섹션 순서를 유지한 채 행을 묶는다. option_price 에만 적용. */
  function grouped(rows: Record<string, unknown>[]): { label: string; rows: Record<string, unknown>[] }[] {
    if (table !== 'option_price') return [{ label: '', rows }]
    const order = [...SECTIONS.map((s) => s.label), '기타']
    const map = new Map<string, Record<string, unknown>[]>()
    for (const r of rows) {
      const k = sectionOf(r)
      map.set(k, [...(map.get(k) ?? []), r])
    }
    return order.filter((l) => map.has(l)).map((l) => ({ label: l, rows: map.get(l)! }))
  }

  function load(t = table, query = q) {
    setLoading(true); setErr(''); setMsg(''); setEdits({})
    fetchOptionDbTable(t, query.trim() || undefined)
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : '로드 실패'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load(table, '') /* 테이블 변경 시 검색 초기화 */ }, [table])

  function edit(rowKey: string, field: string, value: unknown) {
    setEdits((prev) => ({ ...prev, [rowKey]: { ...(prev[rowKey] ?? {}), [field]: value } }))
  }

  async function save() {
    if (!data || Object.keys(edits).length === 0) return
    setLoading(true); setErr(''); setMsg('')
    try {
      const rows = data.rows
        .filter((r) => edits[keyOf(r, data.pk)])
        .map((r) => {
          const k = keyOf(r, data.pk)
          const base: Record<string, unknown> = {}
          for (const f of data.pk) base[f] = r[f]
          for (const f of data.fields) base[f] = r[f]
          const merged = { ...base, ...edits[k] }
          // 화면에 입력한 값은 VAT 포함 → 저장은 공급가로 되돌린다(편집한 칸만)
          for (const f of Object.keys(edits[k] ?? {})) {
            if (isVatField(f)) merged[f] = toSupply(Number(merged[f]) || 0)
          }
          return merged
        })
      const res = await saveOptionDbRows(table, rows)
      setMsg(`${res.rows}행 저장 · ${res.changed_fields}개 필드 변경(이력 기록됨)`)
      load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '저장 실패')
      setLoading(false)
    }
  }

  function openLogs(rowKey?: string) {
    fetchOptionDbLogs({ table, row_key: rowKey, limit: 200 })
      .then(setLogs)
      .catch((e) => setErr(e instanceof Error ? e.message : '이력 조회 실패'))
  }

  const dirty = Object.keys(edits).length
  const searchable = table === 'subsidy_local' || table === 'option_price'

  return (
    <div style={s.root}>
      <div style={s.bar}>
        <select style={s.select} value={table} onChange={(e) => { setQ(''); setTable(e.target.value) }}>
          {OPTION_DB_TABLES.map((t) => <option key={t.name} value={t.name}>{t.label}</option>)}
        </select>
        {searchable && (
          <>
            <input
              style={s.search}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') load() }}
            />
            <button style={s.btn} onClick={() => load()}>검색</button>
          </>
        )}
        <div style={{ flex: 1 }} />
        <button style={s.btn} onClick={() => openLogs()}>변경 이력</button>
        <button style={dirty ? s.primary : s.btnDisabled} onClick={save} disabled={!dirty || loading}>
          {loading ? '처리 중…' : dirty ? `저장 (${dirty}행)` : '저장'}
        </button>
      </div>

      {msg && <div style={s.ok}>✓ {msg}</div>}
      {err && <div style={s.err}>{err}</div>}
      {loading && !data && <div style={s.empty}>로딩 중…</div>}

      {data && (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                {data.pk.map((f) => <th key={f} style={s.th}>{COL_KO[f] ?? f}</th>)}
                {data.fields.map((f) => (
                  <th key={f} style={s.th}>
                    {isVatField(f) ? '단가 (VAT 포함)' : COL_KO[f] ?? f}
                  </th>
                ))}
                <th style={s.th}></th>
              </tr>
            </thead>
            {grouped(data.rows).map((sec) => (
            <tbody key={sec.label || 'all'}>
              {sec.label && (
                <tr>
                  <td colSpan={data.pk.length + data.fields.length + 1} style={s.sectionRow}>
                    {sec.label} <span style={s.sectionCount}>{sec.rows.length}</span>
                  </td>
                </tr>
              )}
              {sec.rows.map((r) => {
                const k = keyOf(r, data.pk)
                const e = edits[k] ?? {}
                return (
                  <tr key={k} style={edits[k] ? s.trDirty : undefined}>
                    {data.pk.map((f) => (
                      <td key={f} style={s.tdKey}>
                        {String(r[f] ?? '')}
                        {table === 'option_price' && f === 'value_code' && (
                          <div style={s.human}>{humanize(String(r[f] ?? ''))}</div>
                        )}
                      </td>
                    ))}
                    {data.fields.map((f) => (
                      <td key={f} style={s.td}>
                        {typeof r[f] === 'boolean' ? (
                          <input
                            type="checkbox"
                            checked={Boolean(f in e ? e[f] : r[f])}
                            onChange={(ev) => edit(k, f, ev.target.checked)}
                          />
                        ) : (
                          <>
                            <input
                              style={s.input}
                              type={data.numeric.includes(f) ? 'number' : 'text'}
                              value={String((f in e ? e[f] : (isVatField(f) ? toVat(Number(r[f]) || 0) : r[f])) ?? '')}
                              onChange={(ev) => edit(k, f, ev.target.value)}
                            />
                            {isVatField(f) && (
                              <div style={s.sub}>
                                공급가 {toSupply(Number(f in e ? e[f] : toVat(Number(r[f]) || 0)) || 0).toLocaleString('ko-KR')}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                    ))}
                    <td style={s.td}>
                      <button style={s.linkBtn} title="이 항목의 변경 이력" onClick={() => openLogs(k)}>이력</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            ))}
          </table>
          {data.rows.length === 0 && <div style={s.empty}>표시할 행이 없습니다.</div>}
          <div style={s.count}>{data.rows.length}행</div>
        </div>
      )}

      {logs && (
        <div style={s.overlay} onClick={(ev) => { if (ev.target === ev.currentTarget) setLogs(null) }}>
          <div style={s.modal}>
            <div style={s.modalHead}>
              <span style={s.modalTitle}>변경 이력 — {OPTION_DB_TABLES.find((t) => t.name === table)?.label}</span>
              <button style={s.btn} onClick={() => setLogs(null)}>✕</button>
            </div>
            <div style={s.logWrap}>
              {logs.length === 0 ? <div style={s.empty}>기록이 없습니다.</div> : (
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>일시</th><th style={s.th}>대상</th><th style={s.th}>항목</th>
                      <th style={s.th}>이전값</th><th style={s.th}>새값</th><th style={s.th}>수정자</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((l) => (
                      <tr key={l.id}>
                        <td style={s.tdSm}>{l.changed_at.replace('T', ' ').slice(0, 16)}</td>
                        <td style={s.tdSm}>{l.row_key}</td>
                        <td style={s.tdSm}>{l.field}</td>
                        <td style={{ ...s.tdSm, color: '#a12d2d' }}>{l.old_value ?? '—'}</td>
                        <td style={{ ...s.tdSm, color: '#2e7d32', fontWeight: 700 }}>{l.new_value ?? '—'}</td>
                        <td style={s.tdSm}>{l.changed_by}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  human: { fontSize: 12, color: 'var(--muted)', marginTop: 2, fontWeight: 400 },
  sectionRow: { background: '#eef2e6', color: '#42502a', fontWeight: 700, fontSize: 14, padding: '7px 10px', borderTop: '2px solid #d5e0bf' },
  sectionCount: { fontSize: 12, color: '#7b8a5e', fontWeight: 400, marginLeft: 6 },
  sub: { fontSize: 11, color: 'var(--muted)', marginTop: 2 },
  root: { padding: 16 },
  bar: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' },
  select: { padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 7, fontSize: 13 },
  search: { padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 7, fontSize: 13, width: 200 },
  btn: { padding: '7px 12px', border: '1px solid var(--line)', borderRadius: 7, background: '#fff', cursor: 'pointer', fontSize: 12.5 },
  btnDisabled: { padding: '7px 12px', border: '1px solid var(--line)', borderRadius: 7, background: '#f0f2f4', color: '#b0b7c0', fontSize: 12.5, cursor: 'not-allowed' },
  primary: { padding: '7px 14px', border: 'none', borderRadius: 7, background: 'var(--dark)', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' },
  linkBtn: { padding: '2px 8px', border: '1px solid var(--line)', borderRadius: 6, background: '#f7f8f3', cursor: 'pointer', fontSize: 11 },
  ok: { background: '#e8f5e9', color: '#2e7d32', fontSize: 12.5, padding: '8px 12px', borderRadius: 8, marginBottom: 10 },
  err: { background: '#fdecec', border: '1px solid #f0b8b8', color: '#a12d2d', fontSize: 12.5, padding: '8px 12px', borderRadius: 8, marginBottom: 10 },
  empty: { padding: 20, color: 'var(--muted)', fontSize: 13 },
  tableWrap: { overflowX: 'auto', border: '1px solid var(--line)', borderRadius: 8 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
  th: { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--line)', color: 'var(--muted)', fontSize: 11.5, whiteSpace: 'nowrap' },
  td: { padding: '4px 8px', borderBottom: '1px solid #f0f2f4' },
  tdKey: { padding: '4px 10px', borderBottom: '1px solid #f0f2f4', fontWeight: 600, whiteSpace: 'nowrap' },
  tdSm: { padding: '5px 10px', borderBottom: '1px solid #f0f2f4', fontSize: 11.5, whiteSpace: 'nowrap' },
  trDirty: { background: '#fffbe6' },
  input: { width: '100%', minWidth: 90, padding: '5px 7px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12.5 },
  count: { padding: '6px 10px', color: 'var(--muted)', fontSize: 11.5 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 },
  modal: { width: 'min(900px, 94vw)', maxHeight: '80vh', background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 20px 60px rgba(0,0,0,0.35)', display: 'flex', flexDirection: 'column' },
  modalHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitle: { fontSize: 15, fontWeight: 700 },
  logWrap: { overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8 },
}
