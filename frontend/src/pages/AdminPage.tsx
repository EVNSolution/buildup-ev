import { useEffect, useState } from 'react'
import type { FeatureModule, AccessControl, Role, ApiQuote, ApiOrder, Org } from '@shared/types/index'
import { fetchFeatureModules, fetchAccessControl, upsertAccessControl } from '../api/auth'
import { fetchQuotes, confirmQuote } from '../api/quotes'
import { fetchOrders, updateOrderStatus, fetchMakerOrgs } from '../api/orders'
import { Header } from '../components/Header'
import { useAuth } from '../contexts/AuthContext'

const ROLES: Role[] = ['SALES', 'ADMIN', 'MAKER']
const ROLE_KO: Record<Role, string> = { SALES: '영업', ADMIN: '관리자', MAKER: '특장사' }
const QUOTE_STATUS_LABELS: Record<string, string> = {
  draft: '임시저장', confirmed: '확정', ordered: '주문', expired: '만료',
}
const ORDER_STATUS_SEQ = ['제작착수', '구조변경', '튜닝신청', '안전검사', '튜닝승인', '인도완료'] as const
type TabKey = 'quotes' | 'kanban' | 'toggles' | 'override'

function fmtPrice(n: number) {
  return n ? `₩${n.toLocaleString()}` : '—'
}
function fmtDate(s: string) {
  return s ? s.slice(0, 10) : '—'
}

function getSurfaces(modules: FeatureModule[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const m of modules) {
    for (const s of m.surface.split(',').map(x => x.trim())) {
      if (!seen.has(s)) { seen.add(s); result.push(s) }
    }
  }
  return result
}

function isEnabled(ac: AccessControl[], type: 'role' | 'user', ref: string, code: string): boolean {
  const entry = ac.find(a => a.subject_type === type && a.subject_ref === ref && a.module_code === code)
  return entry?.enabled ?? false
}

// ── 특장사 확정 모달 ───────────────────────────────────────────────────────
interface ConfirmModalProps {
  quoteId: number
  makerOrgs: Org[]
  loading: boolean
  error: string
  onConfirm: (makerOrgId: string) => void
  onClose: () => void
}

function ConfirmModal({ quoteId, makerOrgs, loading, error, onConfirm, onClose }: ConfirmModalProps) {
  const [selected, setSelected] = useState('')

  return (
    <div style={modal.overlay} onClick={onClose}>
      <div style={modal.box} onClick={e => e.stopPropagation()}>
        <div style={modal.title}>견적 #{quoteId} 확정 — 특장사 배정</div>
        <div style={modal.desc}>배정할 특장사를 선택하세요. 선택 후 주문이 즉시 생성됩니다.</div>

        <select
          value={selected}
          onChange={e => setSelected(e.target.value)}
          style={modal.select}
        >
          <option value="">— 특장사 선택 (필수) —</option>
          {makerOrgs.map(o => (
            <option key={o.code} value={o.code}>{o.name} ({o.code})</option>
          ))}
        </select>

        {error && <div style={modal.error}>{error}</div>}

        <div style={modal.actions}>
          <button style={modal.cancelBtn} onClick={onClose} disabled={loading}>취소</button>
          <button
            style={!selected || loading ? modal.confirmBtnDisabled : modal.confirmBtn}
            disabled={!selected || loading}
            onClick={() => onConfirm(selected)}
          >
            {loading ? '처리 중…' : '확정 + 배정'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 견적 목록 탭 ──────────────────────────────────────────────────────────
interface QuotesTabProps {
  email: string
}

function QuotesTab({ email }: QuotesTabProps) {
  const [quotes, setQuotes] = useState<ApiQuote[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')

  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  const [makerOrgs, setMakerOrgs] = useState<Org[]>([])
  const [confirmLoading, setConfirmLoading] = useState(false)
  const [confirmError, setConfirmError] = useState('')
  const [makerOrgsLoading, setMakerOrgsLoading] = useState(false)

  function load() {
    setLoading(true)
    setErr('')
    fetchQuotes({ status: filterStatus || undefined, from: filterFrom || undefined, to: filterTo || undefined }, email)
      .then(setQuotes)
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleOpenConfirm(id: number) {
    setConfirmingId(id)
    setConfirmError('')
    setMakerOrgsLoading(true)
    fetchMakerOrgs(email)
      .then(setMakerOrgs)
      .catch(() => setMakerOrgs([]))
      .finally(() => setMakerOrgsLoading(false))
  }

  async function handleConfirm(makerOrgId: string) {
    if (!confirmingId) return
    setConfirmLoading(true)
    setConfirmError('')
    try {
      await confirmQuote(confirmingId, makerOrgId, email)
      setConfirmingId(null)
      load()
    } catch (e: unknown) {
      setConfirmError(e instanceof Error ? e.message : '확정 실패')
    } finally {
      setConfirmLoading(false)
    }
  }

  return (
    <div>
      <div style={qt.filterBar}>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={qt.select}>
          <option value="">전체 상태</option>
          <option value="draft">임시저장</option>
          <option value="confirmed">확정</option>
          <option value="ordered">주문</option>
          <option value="expired">만료</option>
        </select>
        <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} style={qt.dateInput} />
        <span style={qt.dateSep}>~</span>
        <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} style={qt.dateInput} />
        <button onClick={load} style={qt.searchBtn}>조회</button>
      </div>

      {err && <div style={qt.errMsg}>{err}</div>}
      {loading ? (
        <div style={qt.loading}>로딩 중…</div>
      ) : quotes.length === 0 ? (
        <div style={qt.empty}>견적이 없습니다.</div>
      ) : (
        <div style={qt.tableWrap}>
          <table style={qt.table}>
            <thead>
              <tr>
                <th style={qt.th}>#</th>
                <th style={qt.th}>고객</th>
                <th style={qt.th}>영업</th>
                <th style={qt.th}>실구매가</th>
                <th style={qt.th}>상태</th>
                <th style={qt.th}>일시</th>
                <th style={qt.th}>액션</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map(q => (
                <tr key={q.id}>
                  <td style={qt.td}>{q.id}</td>
                  <td style={qt.td}>{q.customer?.name ?? '—'}</td>
                  <td style={qt.tdMuted}>{q.sales_user_id ?? '—'}</td>
                  <td style={qt.tdNum}>{fmtPrice(q.final_price)}</td>
                  <td style={qt.td}>
                    <span style={q.status === 'draft' ? qt.badgeDraft : q.status === 'confirmed' ? qt.badgeConfirmed : qt.badgeOther}>
                      {QUOTE_STATUS_LABELS[q.status] ?? q.status}
                    </span>
                  </td>
                  <td style={qt.tdMuted}>{fmtDate(q.created_at)}</td>
                  <td style={qt.td}>
                    {q.status === 'draft' && (
                      <button style={qt.confirmBtn} onClick={() => handleOpenConfirm(q.id)}>
                        확정
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmingId !== null && (
        <ConfirmModal
          quoteId={confirmingId}
          makerOrgs={makerOrgs}
          loading={confirmLoading || makerOrgsLoading}
          error={confirmError}
          onConfirm={handleConfirm}
          onClose={() => { setConfirmingId(null); setConfirmError('') }}
        />
      )}
    </div>
  )
}

// ── 주문 칸반 탭 ──────────────────────────────────────────────────────────
interface KanbanTabProps {
  email: string
}

function KanbanTab({ email }: KanbanTabProps) {
  const [orders, setOrders] = useState<ApiOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [movingId, setMovingId] = useState<number | null>(null)

  function load() {
    setLoading(true)
    setErr('')
    fetchOrders({}, email)
      .then(setOrders)
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAdvance(order: ApiOrder) {
    const idx = ORDER_STATUS_SEQ.indexOf(order.status as typeof ORDER_STATUS_SEQ[number])
    if (idx < 0 || idx >= ORDER_STATUS_SEQ.length - 1) return
    const nextStatus = ORDER_STATUS_SEQ[idx + 1]!
    setMovingId(order.id)
    try {
      await updateOrderStatus(order.id, nextStatus, email)
      await load()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '상태 변경 실패')
    } finally {
      setMovingId(null)
    }
  }

  const ordersByStatus = ORDER_STATUS_SEQ.reduce<Record<string, ApiOrder[]>>((acc, s) => {
    acc[s] = orders.filter(o => o.status === s)
    return acc
  }, {} as Record<string, ApiOrder[]>)

  if (loading) return <div style={kb.loading}>로딩 중…</div>

  return (
    <div>
      {err && <div style={kb.errMsg}>{err}</div>}
      <div style={kb.board}>
        {ORDER_STATUS_SEQ.map(status => (
          <div key={status} style={kb.column}>
            <div style={kb.colHeader}>
              <span style={kb.colTitle}>{status}</span>
              <span style={kb.colCount}>{ordersByStatus[status]?.length ?? 0}</span>
            </div>
            <div style={kb.cards}>
              {(ordersByStatus[status] ?? []).map(order => {
                const isLast = ORDER_STATUS_SEQ.indexOf(status as typeof ORDER_STATUS_SEQ[number]) === ORDER_STATUS_SEQ.length - 1
                return (
                  <div key={order.id} style={kb.card}>
                    <div style={kb.cardId}>주문 #{order.id}</div>
                    <div style={kb.cardCustomer}>
                      {order.quote.customer?.name ?? '고객없음'}
                    </div>
                    <div style={kb.cardModel}>{order.quote.model_code}</div>
                    <div style={kb.cardMeta}>
                      {order.maker_org?.name ?? '특장사없음'}
                    </div>
                    {order.assigned_at && (
                      <div style={kb.cardDate}>배정 {fmtDate(order.assigned_at)}</div>
                    )}
                    {!isLast && (
                      <button
                        style={movingId === order.id ? kb.advBtnDisabled : kb.advBtn}
                        disabled={movingId === order.id}
                        onClick={() => handleAdvance(order)}
                      >
                        {movingId === order.id ? '처리 중…' : '다음 단계 →'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── AdminPage ────────────────────────────────────────────────────────────
export function AdminPage() {
  const { session } = useAuth()
  const email = session?.user.email ?? ''

  const [modules, setModules] = useState<FeatureModule[]>([])
  const [ac, setAc] = useState<AccessControl[]>([])
  const [activeTab, setActiveTab] = useState<TabKey>('quotes')
  const [overrideEmail, setOverrideEmail] = useState('')
  const [overrideCode, setOverrideCode] = useState('')
  const [overrideEnabled, setOverrideEnabled] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([fetchFeatureModules(), fetchAccessControl()]).then(([mods, ctrl]) => {
      setModules(mods)
      setAc(ctrl)
    })
  }, [])

  async function handleRoleToggle(role: Role, code: string, current: boolean) {
    const key = `${role}:${code}`
    setSaving(key)
    const entry: AccessControl = { subject_type: 'role', subject_ref: role, module_code: code, enabled: !current }
    await upsertAccessControl(entry)
    setAc(prev => {
      const idx = prev.findIndex(a => a.subject_type === 'role' && a.subject_ref === role && a.module_code === code)
      if (idx >= 0) return prev.map((a, i) => i === idx ? entry : a)
      return [...prev, entry]
    })
    setSaving(null)
  }

  async function handleOverrideSave(e: React.FormEvent) {
    e.preventDefault()
    if (!overrideEmail || !overrideCode) return
    const entry: AccessControl = {
      subject_type: 'user', subject_ref: overrideEmail,
      module_code: overrideCode, enabled: overrideEnabled,
    }
    setSaving('override')
    await upsertAccessControl(entry)
    setAc(prev => {
      const idx = prev.findIndex(a => a.subject_type === 'user' && a.subject_ref === overrideEmail && a.module_code === overrideCode)
      if (idx >= 0) return prev.map((a, i) => i === idx ? entry : a)
      return [...prev, entry]
    })
    setSaving(null)
    setOverrideEmail('')
    setOverrideCode('')
  }

  const surfaces = getSurfaces(modules)

  const TABS: { key: TabKey; label: string }[] = [
    { key: 'quotes',   label: '견적 목록' },
    { key: 'kanban',   label: '주문 칸반' },
    { key: 'toggles',  label: '기능모듈 토글' },
    { key: 'override', label: '계정 Override' },
  ]

  return (
    <div style={styles.root}>
      <Header />

      <div style={styles.body}>
        <div style={styles.titleBar}>
          <h1 style={styles.h1}>관리자 대시보드</h1>
          <div style={styles.tabs}>
            {TABS.map(t => (
              <button key={t.key} style={activeTab === t.key ? styles.tabOn : styles.tab} onClick={() => setActiveTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {activeTab === 'quotes' && <QuotesTab email={email} />}
        {activeTab === 'kanban' && <KanbanTab email={email} />}

        {activeTab === 'toggles' && (
          <div style={styles.content}>
            {surfaces.map(surface => {
              const surfaceMods = modules.filter(m => m.surface.split(',').map(s => s.trim()).includes(surface))
              return (
                <div key={surface} style={styles.surfaceGroup}>
                  <div style={styles.surfaceLabel}>{surface}</div>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.thModule}>모듈</th>
                        {ROLES.map(r => <th key={r} style={styles.thRole}>{ROLE_KO[r]}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {surfaceMods.map(mod => (
                        <tr key={mod.code}>
                          <td style={styles.tdModule}>
                            <div style={styles.modName}>{mod.name}</div>
                            <div style={styles.modCode}>{mod.code}</div>
                          </td>
                          {ROLES.map(role => {
                            const enabled = isEnabled(ac, 'role', role, mod.code)
                            const key = `${role}:${mod.code}`
                            return (
                              <td key={role} style={styles.tdToggle}>
                                <button
                                  style={enabled ? styles.toggleOn : styles.toggleOff}
                                  onClick={() => handleRoleToggle(role, mod.code, enabled)}
                                  disabled={saving === key}
                                >
                                  {enabled ? 'ON' : 'OFF'}
                                </button>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })}
          </div>
        )}

        {activeTab === 'override' && (
          <div style={styles.content}>
            <p style={styles.overrideDesc}>계정 단위 권한 override. 역할 기본값보다 우선 적용됩니다.</p>
            <form onSubmit={handleOverrideSave} style={styles.overrideForm}>
              <div style={styles.overrideRow}>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>이메일</label>
                  <input type="text" value={overrideEmail} onChange={e => setOverrideEmail(e.target.value)} placeholder="user@example.com" style={styles.inputField} />
                </div>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>모듈 코드</label>
                  <select value={overrideCode} onChange={e => setOverrideCode(e.target.value)} style={styles.inputField}>
                    <option value="">선택</option>
                    {modules.map(m => <option key={m.code} value={m.code}>{m.name} ({m.code})</option>)}
                  </select>
                </div>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>활성</label>
                  <select value={overrideEnabled ? 'Y' : 'N'} onChange={e => setOverrideEnabled(e.target.value === 'Y')} style={styles.inputField}>
                    <option value="Y">ON</option>
                    <option value="N">OFF</option>
                  </select>
                </div>
                <button type="submit" style={styles.saveBtn} disabled={saving === 'override'}>저장</button>
              </div>
            </form>

            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.thModule}>이메일</th>
                  <th style={styles.thModule}>모듈</th>
                  <th style={styles.thRole}>활성</th>
                  <th style={styles.thModule}>메모</th>
                </tr>
              </thead>
              <tbody>
                {ac.filter(a => a.subject_type === 'user').map((a, i) => (
                  <tr key={i}>
                    <td style={styles.tdModule}>{a.subject_ref}</td>
                    <td style={styles.tdModule}><span style={styles.modCode}>{a.module_code}</span></td>
                    <td style={styles.tdToggle}>
                      <span style={a.enabled ? styles.toggleOn : styles.toggleOff}>{a.enabled ? 'ON' : 'OFF'}</span>
                    </td>
                    <td style={styles.tdModule}><span style={styles.modCode}>{a.memo ?? ''}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── 스타일: 기존 ────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  root: { height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  body: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px' },
  titleBar: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' },
  h1: { margin: 0, fontSize: 20, color: 'var(--dark)' },
  tabs: { display: 'flex', gap: 4 },
  tab: {
    padding: '6px 14px', border: '1px solid var(--line)', borderRadius: 8,
    background: '#fff', cursor: 'pointer', fontSize: 13, color: 'var(--muted)',
  },
  tabOn: {
    padding: '6px 14px', border: '1px solid var(--dark)', borderRadius: 8,
    background: 'var(--dark)', cursor: 'pointer', fontSize: 13, color: '#fff', fontWeight: 600,
  },
  content: {},
  surfaceGroup: { marginBottom: 28 },
  surfaceLabel: {
    fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase',
    letterSpacing: 1, marginBottom: 8,
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  thModule: { textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid var(--line)', color: 'var(--muted)', fontWeight: 600, fontSize: 12 },
  thRole: { textAlign: 'center', padding: '8px 12px', borderBottom: '2px solid var(--line)', color: 'var(--muted)', fontWeight: 600, fontSize: 12, width: 80 },
  tdModule: { padding: '10px 12px', borderBottom: '1px solid var(--line)' },
  tdToggle: { textAlign: 'center', padding: '10px 12px', borderBottom: '1px solid var(--line)' },
  modName: { fontSize: 13, color: 'var(--dark)' },
  modCode: { fontSize: 11, color: 'var(--muted)', marginTop: 2 },
  toggleOn: {
    padding: '4px 12px', border: 'none', borderRadius: 6, cursor: 'pointer',
    background: 'var(--lime)', color: 'var(--dark)', fontWeight: 700, fontSize: 12,
  },
  toggleOff: {
    padding: '4px 12px', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer',
    background: '#fff', color: 'var(--muted)', fontWeight: 600, fontSize: 12,
  },
  overrideDesc: { fontSize: 13, color: 'var(--muted)', marginBottom: 16 },
  overrideForm: { marginBottom: 24 },
  overrideRow: { display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' },
  fieldGroup: { display: 'flex', flexDirection: 'column', gap: 5, flex: 1, minWidth: 160 },
  label: { fontSize: 11.5, color: 'var(--muted)' },
  inputField: { fontSize: 13, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8 },
  saveBtn: {
    padding: '8px 16px', border: 'none', borderRadius: 8, cursor: 'pointer',
    background: 'var(--dark)', color: '#fff', fontWeight: 700, fontSize: 13, alignSelf: 'flex-end',
  },
}

// ── 스타일: 견적 목록 탭 ──────────────────────────────────────────────────
const qt: Record<string, React.CSSProperties> = {
  filterBar: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' },
  select: { fontSize: 13, padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 8 },
  dateInput: { fontSize: 13, padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 8 },
  dateSep: { color: 'var(--muted)', fontSize: 13 },
  searchBtn: {
    padding: '7px 16px', border: 'none', borderRadius: 8, cursor: 'pointer',
    background: 'var(--dark)', color: '#fff', fontWeight: 700, fontSize: 13,
  },
  errMsg: { color: 'var(--warn)', fontSize: 13, marginBottom: 10 },
  loading: { color: 'var(--muted)', fontSize: 13, padding: '24px 0' },
  empty: { color: 'var(--muted)', fontSize: 13, padding: '24px 0', textAlign: 'center' },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    textAlign: 'left', padding: '9px 12px', borderBottom: '2px solid var(--line)',
    color: 'var(--muted)', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap',
  },
  td: { padding: '10px 12px', borderBottom: '1px solid var(--line)', verticalAlign: 'middle' },
  tdMuted: { padding: '10px 12px', borderBottom: '1px solid var(--line)', color: 'var(--muted)', fontSize: 12 },
  tdNum: { padding: '10px 12px', borderBottom: '1px solid var(--line)', fontVariantNumeric: 'tabular-nums' as const, textAlign: 'right' },
  badgeDraft: {
    fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 8,
    background: '#f0f2f4', color: 'var(--muted)',
  },
  badgeConfirmed: {
    fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 8,
    background: 'var(--lime)', color: 'var(--dark)',
  },
  badgeOther: {
    fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 8,
    background: '#e3f2fd', color: '#1565c0',
  },
  confirmBtn: {
    padding: '5px 12px', border: 'none', borderRadius: 7, cursor: 'pointer',
    background: 'var(--dark)', color: '#fff', fontWeight: 700, fontSize: 12,
  },
}

// ── 스타일: 칸반 탭 ──────────────────────────────────────────────────────
const kb: Record<string, React.CSSProperties> = {
  loading: { color: 'var(--muted)', fontSize: 13, padding: '24px 0' },
  errMsg: { color: 'var(--warn)', fontSize: 13, marginBottom: 10 },
  board: { display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 12, alignItems: 'flex-start' },
  column: {
    flexShrink: 0, width: 200, border: '1px solid var(--line)',
    borderRadius: 10, background: 'var(--card)', overflow: 'hidden',
  },
  colHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 12px', borderBottom: '1px solid var(--line)', background: '#fff',
  },
  colTitle: { fontSize: 12, fontWeight: 700, color: 'var(--dark)' },
  colCount: {
    fontSize: 11, fontWeight: 700, padding: '2px 7px',
    background: 'var(--lime)', borderRadius: 10, color: 'var(--dark)',
  },
  cards: { display: 'flex', flexDirection: 'column', gap: 8, padding: 10, minHeight: 80 },
  card: {
    background: '#fff', border: '1px solid var(--line)', borderRadius: 8,
    padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 5,
  },
  cardId: { fontSize: 11, color: 'var(--muted)' },
  cardCustomer: { fontSize: 13, fontWeight: 700, color: 'var(--dark)' },
  cardModel: { fontSize: 11, color: 'var(--muted)' },
  cardMeta: { fontSize: 11, color: '#1565c0' },
  cardDate: { fontSize: 10, color: 'var(--muted)' },
  advBtn: {
    marginTop: 4, padding: '5px 10px', border: 'none', borderRadius: 6, cursor: 'pointer',
    background: 'var(--dark)', color: '#fff', fontWeight: 700, fontSize: 11,
  },
  advBtnDisabled: {
    marginTop: 4, padding: '5px 10px', border: 'none', borderRadius: 6, cursor: 'not-allowed',
    background: '#f0f2f4', color: 'var(--muted)', fontWeight: 700, fontSize: 11,
  },
}

// ── 스타일: 확정 모달 ─────────────────────────────────────────────────────
const modal: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  box: {
    background: '#fff', borderRadius: 14, padding: '28px 32px',
    width: 400, maxWidth: '90vw', display: 'flex', flexDirection: 'column', gap: 16,
  },
  title: { fontSize: 16, fontWeight: 700, color: 'var(--dark)' },
  desc: { fontSize: 13, color: 'var(--muted)' },
  select: {
    fontSize: 14, padding: '10px 12px', border: '1px solid var(--line)',
    borderRadius: 9, width: '100%',
  },
  error: {
    fontSize: 12, color: 'var(--warn)', background: 'var(--warnbg)',
    border: '1px solid #f0c9ad', padding: '7px 10px', borderRadius: 7,
  },
  actions: { display: 'flex', gap: 10, justifyContent: 'flex-end' },
  cancelBtn: {
    padding: '9px 18px', border: '1px solid var(--line)', borderRadius: 9,
    background: '#fff', cursor: 'pointer', fontSize: 13, color: 'var(--muted)',
  },
  confirmBtn: {
    padding: '9px 20px', border: 'none', borderRadius: 9,
    background: 'var(--dark)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer',
  },
  confirmBtnDisabled: {
    padding: '9px 20px', border: 'none', borderRadius: 9,
    background: '#f0f2f4', color: '#b0b7c0', fontWeight: 700, fontSize: 13, cursor: 'not-allowed',
  },
}
