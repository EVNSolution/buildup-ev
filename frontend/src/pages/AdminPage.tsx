import { useEffect, useState } from 'react'
import type { FeatureModule, AccessControl, Role, ApiQuote, ApiOrder, Org, User } from '@shared/types/index'
import { fetchFeatureModules, fetchAccessControl, upsertAccessControl, fetchUsers, fetchOrgs, createUser, updateUser, resetUserPassword, deleteUser, cascadeDeleteUser } from '../api/auth'
import type { CreateUserInput } from '../api/auth'
import { fetchQuotes, confirmQuote, deleteQuote } from '../api/quotes'
import { fetchOrders, fetchMakerOrgs } from '../api/orders'
import { Header } from '../components/Header'
import { OrderKanbanBoard } from '../components/OrderKanbanBoard'
import { PdfModal } from '../components/PdfModal'
import { useAuth } from '../contexts/AuthContext'
import { useIsMobile } from '../hooks/useIsMobile'

const ROLES: Role[] = ['SALES', 'ADMIN', 'MAKER']
const ROLE_KO: Record<Role, string> = { SALES: '영업', ADMIN: '관리자', MAKER: '특장사' }
const ROLE_SURFACE: Record<Role, string> = { SALES: '영업', ADMIN: '관리자', MAKER: '특장사' }

function getModulesForRole(modules: FeatureModule[], role: Role): FeatureModule[] {
  const surface = ROLE_SURFACE[role]
  return modules
    .filter(m => m.surface.split(',').map(s => s.trim()).includes(surface))
    .sort((a, b) => a.sort_order - b.sort_order)
}
const QUOTE_STATUS_LABELS: Record<string, string> = {
  draft: '임시저장', confirmed: '확정', ordered: '주문', expired: '만료',
}
type TabKey = 'quotes' | 'kanban' | 'toggles' | 'accounts'

function fmtPrice(n: number) { return n ? `₩${n.toLocaleString()}` : '—' }
function fmtDate(s: string) { return s ? s.slice(0, 10) : '—' }


function isEnabled(ac: AccessControl[], type: 'role' | 'user', ref: string, code: string): boolean {
  const entry = ac.find(a => a.subject_type === type && a.subject_ref === ref && a.module_code === code)
  return entry?.enabled ?? false
}

// ── 특장사 확정 모달 ───────────────────────────────────────────────────────
interface ConfirmModalProps {
  quoteId: number; makerOrgs: Org[]; loading: boolean; error: string
  onConfirm: (makerOrgId: string) => void; onClose: () => void
}
function ConfirmModal({ quoteId, makerOrgs, loading, error, onConfirm, onClose }: ConfirmModalProps) {
  const [selected, setSelected] = useState('')
  return (
    <div style={modal.overlay} onClick={onClose}>
      <div style={modal.box} onClick={e => e.stopPropagation()}>
        <div style={modal.title}>견적 #{quoteId} 확정 — 특장사 배정</div>
        <div style={modal.desc}>배정할 특장사를 선택하세요. 선택 후 주문이 즉시 생성됩니다.</div>
        <select value={selected} onChange={e => setSelected(e.target.value)} style={modal.select}>
          <option value="">— 특장사 선택 (필수) —</option>
          {makerOrgs.map(o => <option key={o.code} value={o.code}>{o.name} ({o.code})</option>)}
        </select>
        {error && <div style={modal.error}>{error}</div>}
        <div style={modal.actions}>
          <button style={modal.cancelBtn} onClick={onClose} disabled={loading}>취소</button>
          <button style={!selected || loading ? modal.confirmBtnDisabled : modal.confirmBtn} disabled={!selected || loading} onClick={() => onConfirm(selected)}>
            {loading ? '처리 중…' : '확정 + 배정'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 계정 발급 모달 ─────────────────────────────────────────────────────────
interface CreateUserModalProps {
  orgs: Org[]
  onClose: () => void
}
function CreateUserModal({ orgs, onClose }: CreateUserModalProps) {
  const [form, setForm] = useState<CreateUserInput>({ email: '', name: '', role: 'SALES', org_code: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ user: User; temp_password: string } | null>(null)

  function setField(k: keyof CreateUserInput, v: string) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.email || !form.name || !form.role || !form.org_code) { setError('모든 항목을 입력해 주세요.'); return }
    setLoading(true); setError('')
    try {
      const res = await createUser(form)
      setResult(res)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '계정 발급 실패')
    } finally {
      setLoading(false)
    }
  }

  if (result) {
    return (
      <div style={modal.overlay} onClick={onClose}>
        <div style={modal.box} onClick={e => e.stopPropagation()}>
          <div style={modal.title}>계정 발급 완료</div>
          <div style={modal.desc}>{result.user.email} ({result.user.role}) 계정이 생성되었습니다.</div>
          <div style={acc.tempPwBox}>
            <div style={acc.tempPwLabel}>임시 비밀번호 (1회만 표시)</div>
            <div style={acc.tempPw}>{result.temp_password}</div>
            <div style={acc.tempPwNote}>이 비밀번호를 안전하게 당사자에게 전달하세요. 다시 조회할 수 없습니다.</div>
          </div>
          <div style={modal.actions}>
            <button style={modal.confirmBtn} onClick={onClose}>확인</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={modal.overlay} onClick={onClose}>
      <div style={{ ...modal.box, width: 460 }} onClick={e => e.stopPropagation()}>
        <div style={modal.title}>계정 발급</div>
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={acc.label}>이메일</label>
            <input type="email" value={form.email} onChange={e => setField('email', e.target.value)} style={acc.input} placeholder="user@example.com" disabled={loading} />
          </div>
          <div>
            <label style={acc.label}>이름</label>
            <input type="text" value={form.name} onChange={e => setField('name', e.target.value)} style={acc.input} placeholder="홍길동" disabled={loading} />
          </div>
          <div>
            <label style={acc.label}>역할</label>
            <select value={form.role} onChange={e => setField('role', e.target.value)} style={acc.input} disabled={loading}>
              {ROLES.map(r => <option key={r} value={r}>{ROLE_KO[r]} ({r})</option>)}
            </select>
          </div>
          <div>
            <label style={acc.label}>소속 조직</label>
            <select value={form.org_code} onChange={e => setField('org_code', e.target.value)} style={acc.input} disabled={loading}>
              <option value="">— 조직 선택 —</option>
              {orgs.map(o => <option key={o.code} value={o.code}>{o.name} ({o.code})</option>)}
            </select>
          </div>
          {error && <div style={modal.error}>{error}</div>}
          <div style={modal.actions}>
            <button type="button" style={modal.cancelBtn} onClick={onClose} disabled={loading}>취소</button>
            <button type="submit" style={loading ? modal.confirmBtnDisabled : modal.confirmBtn} disabled={loading}>{loading ? '발급 중…' : '발급'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── 계정 관리 탭 ──────────────────────────────────────────────────────────
function AccountsTab() {
  const { session } = useAuth()
  const myEmail = session?.user.email ?? ''
  const isMaster = session?.user.is_master ?? false
  const isMobile = useIsMobile()

  const [users, setUsers] = useState<User[]>([])
  const [orgs, setOrgs] = useState<Org[]>([])
  const [modules, setModules] = useState<FeatureModule[]>([])
  const [ac, setAc] = useState<AccessControl[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null)
  const [resetting, setResetting] = useState<string | null>(null)
  const [resetResult, setResetResult] = useState<{ email: string; temp_password: string } | null>(null)
  const [togglingStatus, setTogglingStatus] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [cascadeDeleting, setCascadeDeleting] = useState<string | null>(null)

  function loadAll() {
    setLoading(true); setErr('')
    Promise.all([fetchUsers(), fetchOrgs(), fetchFeatureModules(), fetchAccessControl()])
      .then(([u, o, m, a]) => { setUsers(u); setOrgs(o); setModules(m); setAc(a) })
      .catch(e => setErr(e instanceof Error ? e.message : '로드 실패'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadAll() }, [])

  async function handleResetPw(email: string) {
    setResetting(email)
    try {
      const res = await resetUserPassword(email)
      setResetResult({ email, temp_password: res.temp_password })
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '비밀번호 재설정 실패')
    } finally {
      setResetting(null)
    }
  }

  async function handleToggleStatus(user: User) {
    const newStatus = user.status === 'active' ? 'suspended' : 'active'
    setTogglingStatus(user.email)
    try {
      await updateUser(user.email, { status: newStatus })
      setUsers(prev => prev.map(u => u.email === user.email ? { ...u, status: newStatus } : u))
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '상태 변경 실패')
    } finally {
      setTogglingStatus(null)
    }
  }

  async function handleDelete(email: string) {
    if (!window.confirm('정말 삭제하시겠습니까? 되돌릴 수 없습니다.')) return
    setDeleting(email)
    setErr('')
    try {
      await deleteUser(email)
      setUsers(prev => prev.filter(u => u.email !== email))
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '삭제 실패')
    } finally {
      setDeleting(null)
    }
  }

  async function handleCascadeDelete(email: string) {
    if (!window.confirm(
      `[완전 삭제] ${email}\n\n이 계정과 연결된 모든 견적·주문·서류가 함께 삭제됩니다.\n되돌릴 수 없습니다.\n\n정말 삭제하시겠습니까?`
    )) return
    setCascadeDeleting(email); setErr('')
    try {
      await cascadeDeleteUser(email)
      setUsers(prev => prev.filter(u => u.email !== email))
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '완전 삭제 실패')
    } finally {
      setCascadeDeleting(null)
    }
  }

  async function handleUserModuleToggle(email: string, code: string, current: boolean) {
    const entry: Omit<AccessControl, 'id'> = { subject_type: 'user', subject_ref: email, module_code: code, enabled: !current }
    try {
      await upsertAccessControl(entry)
      setAc(prev => {
        const idx = prev.findIndex(a => a.subject_type === 'user' && a.subject_ref === email && a.module_code === code)
        if (idx >= 0) return prev.map((a, i) => i === idx ? entry : a)
        return [...prev, entry]
      })
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '모듈 토글 실패')
    }
  }

  const STATUS_LABEL: Record<string, string> = { active: '활성', invited: '초대됨', suspended: '정지' }
  const STATUS_STYLE: Record<string, React.CSSProperties> = {
    active: { background: 'var(--lime)', color: 'var(--dark)' },
    invited: { background: '#e3f2fd', color: '#1565c0' },
    suspended: { background: '#fdecea', color: '#c62828' },
  }
  const adminCount = users.filter(u => u.role === 'ADMIN').length
  const isDeleteDisabled = (u: User) => u.email === myEmail || (u.role === 'ADMIN' && adminCount <= 1)

  function renderModuleExpand(user: User) {
    return (
      <div style={acc.expandCell}>
        <div style={acc.expandHeader}>
          {user.is_master ? '마스터 — 8개 모듈 전체' : `계정 모듈 override — ${ROLE_KO[user.role]} 역할 기준`}
        </div>
        <div style={acc.moduleGrid}>
          {(user.is_master ? modules : getModulesForRole(modules, user.role)).map(mod => {
            const roleEnabled = isEnabled(ac, 'role', user.role, mod.code)
            const userOverride = ac.find(a => a.subject_type === 'user' && a.subject_ref === user.email && a.module_code === mod.code)
            const effective = userOverride !== undefined ? userOverride.enabled : roleEnabled
            const hasOverride = userOverride !== undefined
            return (
              <div key={mod.code} style={acc.moduleItem}>
                <div style={acc.modName}>{mod.name}</div>
                <div style={acc.modCode}>{mod.code}</div>
                <div style={acc.modMeta}>
                  {hasOverride
                    ? <span style={acc.overrideTag}>override</span>
                    : <span style={acc.roleTag}>역할기본</span>
                  }
                </div>
                <button
                  style={effective ? acc.toggleOn : acc.toggleOff}
                  onClick={() => handleUserModuleToggle(user.email, mod.code, effective)}
                >
                  {effective ? 'ON' : 'OFF'}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  function renderActionButtons(user: User) {
    const btnH = isMobile ? { minHeight: 44 } : {}
    if (user.is_master) {
      return isMaster ? (
        <button
          style={{ ...acc.actionBtn, ...btnH }}
          onClick={() => handleResetPw(user.email)}
          disabled={resetting === user.email}
        >
          {resetting === user.email ? '…' : '비번재설정'}
        </button>
      ) : null
    }
    return (
      <>
        <button
          style={{ ...acc.actionBtn, ...btnH }}
          onClick={() => setExpandedEmail(expandedEmail === user.email ? null : user.email)}
        >
          {expandedEmail === user.email ? '▲ 모듈' : '▼ 모듈'}
        </button>
        <button
          style={{ ...acc.actionBtn, ...btnH }}
          onClick={() => handleResetPw(user.email)}
          disabled={resetting === user.email}
        >
          {resetting === user.email ? '…' : '비번재설정'}
        </button>
        <button
          style={{ ...(user.status === 'active' ? acc.suspendBtn : acc.activateBtn), ...btnH }}
          onClick={() => handleToggleStatus(user)}
          disabled={togglingStatus === user.email}
        >
          {user.status === 'active' ? '정지' : '활성화'}
        </button>
        <button
          style={{ ...(isDeleteDisabled(user) ? acc.deleteBtnDisabled : acc.deleteBtn), ...btnH }}
          onClick={() => handleDelete(user.email)}
          disabled={isDeleteDisabled(user) || deleting === user.email}
          title={
            user.email === myEmail ? '본인 계정은 삭제할 수 없습니다' :
            (user.role === 'ADMIN' && adminCount <= 1) ? '마지막 관리자 계정은 삭제할 수 없습니다' :
            '계정 삭제'
          }
        >
          {deleting === user.email ? '…' : '삭제'}
        </button>
        {isMaster && (
          <button
            style={{ ...(isDeleteDisabled(user) ? acc.deleteBtnDisabled : acc.cascadeDeleteBtn), ...btnH }}
            onClick={() => handleCascadeDelete(user.email)}
            disabled={isDeleteDisabled(user) || cascadeDeleting === user.email}
            title="연결된 견적·주문·서류 포함 완전 삭제 (마스터 전용)"
          >
            {cascadeDeleting === user.email ? '…' : '완전삭제'}
          </button>
        )}
      </>
    )
  }

  if (loading) return <div style={styles.content}><div style={{ color: 'var(--muted)', fontSize: 13 }}>로딩 중…</div></div>

  return (
    <div style={styles.content}>
      {err && <div style={{ color: 'var(--warn)', fontSize: 13, marginBottom: 12 }}>{err}</div>}

      {resetResult && (
        <div style={acc.resetResultBox}>
          <span style={acc.resetResultLabel}>{resetResult.email} 임시 비밀번호 (1회만 표시):</span>
          <span style={acc.tempPw}>{resetResult.temp_password}</span>
          <button style={acc.dismissBtn} onClick={() => setResetResult(null)}>확인</button>
        </div>
      )}

      <div style={acc.toolbar}>
        <span style={acc.count}>{users.length}명</span>
        <button style={{ ...acc.createBtn, minHeight: isMobile ? 44 : undefined }} onClick={() => setShowCreate(true)}>+ 계정 발급</button>
      </div>

      {isMobile ? (
        // ── 모바일: 카드 리스트 ──
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {users.map(user => (
            <div key={user.email} style={accMob.card}>
              <div style={accMob.cardTop}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={accMob.name}>{user.name}</span>
                  {user.is_master && <span style={acc.masterBadge}>마스터</span>}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={acc.roleBadge}>{ROLE_KO[user.role]}</span>
                  <span style={{ ...acc.statusBadge, ...STATUS_STYLE[user.status] }}>
                    {STATUS_LABEL[user.status] ?? user.status}
                  </span>
                </div>
              </div>
              <div style={accMob.row}>
                <span style={accMob.label}>이메일</span>
                <span style={accMob.value}>{user.email}</span>
              </div>
              <div style={accMob.row}>
                <span style={accMob.label}>조직</span>
                <span style={accMob.value}>{user.org_code}</span>
              </div>
              <div style={accMob.actions}>
                {renderActionButtons(user)}
              </div>
              {expandedEmail === user.email && renderModuleExpand(user)}
            </div>
          ))}
        </div>
      ) : (
        // ── 데스크톱: 표 ──
        <div style={acc.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.thModule}>이메일</th>
                <th style={styles.thModule}>이름</th>
                <th style={styles.thRole}>역할</th>
                <th style={styles.thModule}>조직</th>
                <th style={styles.thRole}>상태</th>
                <th style={styles.thModule}>액션</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <>
                  <tr key={user.email}>
                    <td style={styles.tdModule}>{user.email}</td>
                    <td style={styles.tdModule}>{user.name}</td>
                    <td style={styles.tdToggle}>
                      <span style={acc.roleBadge}>{ROLE_KO[user.role]}</span>
                      {user.is_master && <span style={acc.masterBadge}>마스터</span>}
                    </td>
                    <td style={styles.tdModule}>{user.org_code}</td>
                    <td style={styles.tdToggle}>
                      <span style={{ ...acc.statusBadge, ...STATUS_STYLE[user.status] }}>
                        {STATUS_LABEL[user.status] ?? user.status}
                      </span>
                    </td>
                    <td style={styles.tdModule}>
                      <div style={acc.actions}>
                        {renderActionButtons(user)}
                      </div>
                    </td>
                  </tr>
                  {expandedEmail === user.email && (
                    <tr key={`${user.email}-expand`}>
                      <td colSpan={6} style={{ padding: 0 }}>
                        {renderModuleExpand(user)}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && <CreateUserModal orgs={orgs} onClose={() => { setShowCreate(false); loadAll() }} />}
    </div>
  )
}

// ── 견적 목록 탭 ──────────────────────────────────────────────────────────
function QuotesTab() {
  const { session } = useAuth()
  const isMaster = session?.user.is_master ?? false
  const isMobile = useIsMobile()

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
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [pdfQuote, setPdfQuote] = useState<{ id: number; customerName?: string } | null>(null)

  function load() {
    setLoading(true); setErr('')
    fetchQuotes({ status: filterStatus || undefined, from: filterFrom || undefined, to: filterTo || undefined })
      .then(setQuotes)
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleOpenConfirm(id: number) {
    setConfirmingId(id); setConfirmError(''); setMakerOrgsLoading(true)
    fetchMakerOrgs().then(setMakerOrgs).catch(() => setMakerOrgs([])).finally(() => setMakerOrgsLoading(false))
  }

  async function handleConfirm(makerOrgId: string) {
    if (!confirmingId) return
    setConfirmLoading(true); setConfirmError('')
    try {
      await confirmQuote(confirmingId, makerOrgId)
      setConfirmingId(null); load()
    } catch (e: unknown) {
      setConfirmError(e instanceof Error ? e.message : '확정 실패')
    } finally {
      setConfirmLoading(false)
    }
  }

  async function handleDelete(id: number, status: string) {
    if (status === 'confirmed') {
      if (!window.confirm(`견적 #${id}\n\n확정 견적과 연결된 주문·서류가 함께 삭제됩니다.\n되돌릴 수 없습니다.\n\n정말 삭제하시겠습니까?`)) return
    } else {
      if (!window.confirm(`견적 #${id}을(를) 삭제하시겠습니까? 되돌릴 수 없습니다.`)) return
    }
    setDeletingId(id); setErr('')
    try {
      await deleteQuote(id)
      setQuotes(prev => prev.filter(q => q.id !== id))
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '삭제 실패')
    } finally {
      setDeletingId(null)
    }
  }

  function statusBadgeStyle(status: string) {
    if (status === 'draft') return qt.badgeDraft
    if (status === 'confirmed') return qt.badgeConfirmed
    return qt.badgeOther
  }

  return (
    <div>
      <div style={{ ...qt.filterBar, flexWrap: 'wrap' }}>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...qt.select, ...(isMobile ? { flex: 1, minHeight: 44 } : {}) }}>
          <option value="">전체 상태</option>
          <option value="draft">임시저장</option>
          <option value="confirmed">확정</option>
          <option value="ordered">주문</option>
          <option value="expired">만료</option>
        </select>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} style={{ ...qt.dateInput, ...(isMobile ? { minHeight: 44 } : {}) }} />
          <span style={qt.dateSep}>~</span>
          <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} style={{ ...qt.dateInput, ...(isMobile ? { minHeight: 44 } : {}) }} />
        </div>
        <button onClick={load} style={{ ...qt.searchBtn, ...(isMobile ? { flex: 1, minHeight: 44 } : {}) }}>조회</button>
      </div>

      {err && <div style={qt.errMsg}>{err}</div>}

      {loading ? (
        <div style={qt.loading}>로딩 중…</div>
      ) : quotes.length === 0 ? (
        <div style={qt.empty}>견적이 없습니다.</div>
      ) : isMobile ? (
        // ── 모바일: 카드 리스트 ──
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {quotes.map(q => (
            <div key={q.id} style={qtMob.card}>
              <div style={qtMob.cardTop}>
                <span style={qtMob.name}>{q.customer?.name ?? '—'}</span>
                <span style={statusBadgeStyle(q.status)}>{QUOTE_STATUS_LABELS[q.status] ?? q.status}</span>
              </div>
              <div style={qtMob.rows}>
                <div style={qtMob.row}>
                  <span style={qtMob.label}># · 특장사</span>
                  <span>#{q.id} · {q.order?.maker_org?.name ?? '—'}</span>
                </div>
                <div style={qtMob.row}>
                  <span style={qtMob.label}>영업</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{q.sales_user_id ?? '—'}</span>
                </div>
                <div style={qtMob.row}>
                  <span style={qtMob.label}>실구매가</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtPrice(q.final_price)}</span>
                </div>
                <div style={qtMob.row}>
                  <span style={qtMob.label}>일시</span>
                  <span>{fmtDate(q.created_at)}</span>
                </div>
              </div>
              <div style={qtMob.actions}>
                <button
                  style={{ ...qt.pdfBtn, flex: 1, minHeight: 44 }}
                  onClick={() => setPdfQuote({ id: q.id, customerName: q.customer?.name ?? undefined })}
                >견적서</button>
                {q.status === 'draft' && (
                  <button style={{ ...qt.confirmBtn, flex: 1, minHeight: 44 }} onClick={() => handleOpenConfirm(q.id)}>확정</button>
                )}
                {(q.status === 'draft' || (q.status === 'confirmed' && isMaster)) && (
                  <button
                    style={{ ...(deletingId === q.id ? qt.deleteBtnDisabled : (q.status === 'confirmed' ? qt.deleteBtnStrong : qt.deleteBtn)), flex: 1, minHeight: 44 }}
                    disabled={deletingId === q.id}
                    onClick={() => handleDelete(q.id, q.status)}
                  >{deletingId === q.id ? '…' : '삭제'}</button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        // ── 데스크톱: 표 ──
        <div style={qt.tableWrap}>
          <table style={qt.table}>
            <thead>
              <tr>
                <th style={qt.th}>#</th>
                <th style={qt.th}>고객</th>
                <th style={qt.th}>영업</th>
                <th style={qt.th}>실구매가</th>
                <th style={qt.th}>상태</th>
                <th style={qt.th}>특장사</th>
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
                    <span style={statusBadgeStyle(q.status)}>
                      {QUOTE_STATUS_LABELS[q.status] ?? q.status}
                    </span>
                  </td>
                  <td style={qt.tdMuted}>{q.order?.maker_org?.name ?? '—'}</td>
                  <td style={qt.tdMuted}>{fmtDate(q.created_at)}</td>
                  <td style={qt.td}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        style={qt.pdfBtn}
                        onClick={() => setPdfQuote({ id: q.id, customerName: q.customer?.name ?? undefined })}
                      >견적서</button>
                      {q.status === 'draft' && (
                        <button style={qt.confirmBtn} onClick={() => handleOpenConfirm(q.id)}>확정</button>
                      )}
                      {(q.status === 'draft' || (q.status === 'confirmed' && isMaster)) && (
                        <button
                          style={deletingId === q.id ? qt.deleteBtnDisabled : (q.status === 'confirmed' ? qt.deleteBtnStrong : qt.deleteBtn)}
                          disabled={deletingId === q.id}
                          onClick={() => handleDelete(q.id, q.status)}
                          title={q.status === 'confirmed' ? '확정 견적 삭제 — 연결 주문·서류도 함께 삭제됩니다' : '견적 삭제'}
                        >
                          {deletingId === q.id ? '…' : '삭제'}
                        </button>
                      )}
                    </div>
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
      {pdfQuote && (
        <PdfModal
          quoteId={pdfQuote.id}
          customerName={pdfQuote.customerName}
          onClose={() => setPdfQuote(null)}
        />
      )}
    </div>
  )
}

// ── 주문 칸반 탭 ──────────────────────────────────────────────────────────
function KanbanTab() {
  const { session } = useAuth()
  const canControl = session?.user.is_master ?? false

  const [orders, setOrders] = useState<ApiOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  function load() {
    setLoading(true); setErr('')
    fetchOrders({}).then(setOrders).catch(e => setErr(e.message)).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div style={{ color: 'var(--muted)', fontSize: 13, padding: '24px 0' }}>로딩 중…</div>

  return (
    <div>
      {err && <div style={{ color: 'var(--warn)', fontSize: 13, marginBottom: 10 }}>{err}</div>}
      {!canControl && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>조회 전용 — 상태 변경은 배정 특장사만 가능합니다.</div>}
      <OrderKanbanBoard orders={orders} onRefresh={load} onError={setErr} readOnly={!canControl} />
    </div>
  )
}

// ── AdminPage ────────────────────────────────────────────────────────────
export function AdminPage() {
  const isMobile = useIsMobile()
  const [modules, setModules] = useState<FeatureModule[]>([])
  const [ac, setAc] = useState<AccessControl[]>([])
  const [activeTab, setActiveTab] = useState<TabKey>('quotes')
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
    const entry: Omit<AccessControl, 'id'> = { subject_type: 'role', subject_ref: role, module_code: code, enabled: !current }
    await upsertAccessControl(entry)
    setAc(prev => {
      const idx = prev.findIndex(a => a.subject_type === 'role' && a.subject_ref === role && a.module_code === code)
      if (idx >= 0) return prev.map((a, i) => i === idx ? entry : a)
      return [...prev, entry]
    })
    setSaving(null)
  }

  const TABS: { key: TabKey; label: string }[] = [
    { key: 'quotes',   label: '견적 목록' },
    { key: 'kanban',   label: '주문 칸반' },
    { key: 'toggles',  label: '기능모듈' },
    { key: 'accounts', label: '계정 관리' },
  ]

  return (
    <div style={styles.root}>
      <Header />

      <div style={{ ...styles.body, padding: isMobile ? '14px 14px' : '20px 24px' }}>
        <div style={{ ...styles.titleBar, flexDirection: isMobile ? 'column' : undefined, alignItems: isMobile ? 'flex-start' : 'center', gap: isMobile ? 8 : 16 }}>
          <h1 style={{ ...styles.h1, fontSize: isMobile ? 17 : 20 }}>관리자 대시보드</h1>
          <div style={{ ...styles.tabs, flexWrap: 'wrap', gap: isMobile ? 6 : 4, width: isMobile ? '100%' : undefined }}>
            {TABS.map(t => (
              <button
                key={t.key}
                style={{
                  ...(activeTab === t.key ? styles.tabOn : styles.tab),
                  ...(isMobile ? { flex: '1 0 45%', minHeight: 44, fontSize: 14, textAlign: 'center' } : {}),
                }}
                onClick={() => setActiveTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {activeTab === 'quotes' && <QuotesTab />}
        {activeTab === 'kanban' && <KanbanTab />}

        {activeTab === 'toggles' && (
          <div style={styles.content}>
            {ROLES.map(role => {
              const roleMods = getModulesForRole(modules, role)
              return (
                <div key={role} style={styles.surfaceGroup}>
                  <div style={styles.surfaceLabel}>{ROLE_KO[role]} ({role})</div>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.thModule}>모듈</th>
                        <th style={styles.thRole}>{ROLE_KO[role]} 기본값</th>
                      </tr>
                    </thead>
                    <tbody>
                      {roleMods.map(mod => {
                        const enabled = isEnabled(ac, 'role', role, mod.code)
                        const key = `${role}:${mod.code}`
                        return (
                          <tr key={mod.code}>
                            <td style={styles.tdModule}>
                              <div style={styles.modName}>{mod.name}</div>
                              <div style={styles.modCode}>{mod.code}</div>
                            </td>
                            <td style={styles.tdToggle}>
                              <button
                                style={enabled ? styles.toggleOn : styles.toggleOff}
                                onClick={() => handleRoleToggle(role, mod.code, enabled)}
                                disabled={saving === key}
                              >
                                {enabled ? 'ON' : 'OFF'}
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            })}
          </div>
        )}

        {activeTab === 'accounts' && <AccountsTab />}
      </div>
    </div>
  )
}

// ── 스타일 ────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  root: { height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  body: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px' },
  titleBar: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' },
  h1: { margin: 0, fontSize: 20, color: 'var(--dark)' },
  tabs: { display: 'flex', gap: 4 },
  tab: { padding: '6px 14px', border: '1px solid var(--line)', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 13, color: 'var(--muted)' },
  tabOn: { padding: '6px 14px', border: '1px solid var(--dark)', borderRadius: 8, background: 'var(--dark)', cursor: 'pointer', fontSize: 13, color: '#fff', fontWeight: 600 },
  content: {},
  surfaceGroup: { marginBottom: 28 },
  surfaceLabel: { fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 8 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  thModule: { textAlign: 'left' as const, padding: '8px 12px', borderBottom: '2px solid var(--line)', color: 'var(--muted)', fontWeight: 600, fontSize: 12 },
  thRole: { textAlign: 'center' as const, padding: '8px 12px', borderBottom: '2px solid var(--line)', color: 'var(--muted)', fontWeight: 600, fontSize: 12, width: 80 },
  tdModule: { padding: '10px 12px', borderBottom: '1px solid var(--line)' },
  tdToggle: { textAlign: 'center' as const, padding: '10px 12px', borderBottom: '1px solid var(--line)' },
  modName: { fontSize: 13, color: 'var(--dark)' },
  modCode: { fontSize: 11, color: 'var(--muted)', marginTop: 2 },
  toggleOn: { padding: '4px 12px', border: 'none', borderRadius: 6, cursor: 'pointer', background: 'var(--lime)', color: 'var(--dark)', fontWeight: 700, fontSize: 12 },
  toggleOff: { padding: '4px 12px', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer', background: '#fff', color: 'var(--muted)', fontWeight: 600, fontSize: 12 },
}

const qt: Record<string, React.CSSProperties> = {
  filterBar: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' },
  select: { fontSize: 13, padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 8 },
  dateInput: { fontSize: 13, padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 8 },
  dateSep: { color: 'var(--muted)', fontSize: 13 },
  searchBtn: { padding: '7px 16px', border: 'none', borderRadius: 8, cursor: 'pointer', background: 'var(--dark)', color: '#fff', fontWeight: 700, fontSize: 13 },
  errMsg: { color: 'var(--warn)', fontSize: 13, marginBottom: 10 },
  loading: { color: 'var(--muted)', fontSize: 13, padding: '24px 0' },
  empty: { color: 'var(--muted)', fontSize: 13, padding: '24px 0', textAlign: 'center' as const },
  tableWrap: { overflowX: 'auto' as const },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  th: { textAlign: 'left' as const, padding: '9px 12px', borderBottom: '2px solid var(--line)', color: 'var(--muted)', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' as const },
  td: { padding: '10px 12px', borderBottom: '1px solid var(--line)', verticalAlign: 'middle' as const },
  tdMuted: { padding: '10px 12px', borderBottom: '1px solid var(--line)', color: 'var(--muted)', fontSize: 12 },
  tdNum: { padding: '10px 12px', borderBottom: '1px solid var(--line)', fontVariantNumeric: 'tabular-nums' as const, textAlign: 'right' as const },
  badgeDraft: { fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 8, background: '#f0f2f4', color: 'var(--muted)' },
  badgeConfirmed: { fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 8, background: 'var(--lime)', color: 'var(--dark)' },
  badgeOther: { fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 8, background: '#e3f2fd', color: '#1565c0' },
  pdfBtn: { padding: '5px 12px', border: '1px solid var(--line)', borderRadius: 7, cursor: 'pointer', background: '#f7f8f3', color: 'var(--dark)', fontWeight: 700, fontSize: 12 },
  confirmBtn: { padding: '5px 12px', border: 'none', borderRadius: 7, cursor: 'pointer', background: 'var(--dark)', color: '#fff', fontWeight: 700, fontSize: 12 },
  deleteBtn: { padding: '5px 12px', border: 'none', borderRadius: 7, cursor: 'pointer', background: '#b71c1c', color: '#fff', fontWeight: 700, fontSize: 12 },
  deleteBtnStrong: { padding: '5px 12px', border: '2px solid #b71c1c', borderRadius: 7, cursor: 'pointer', background: '#fff', color: '#b71c1c', fontWeight: 700, fontSize: 12 },
  deleteBtnDisabled: { padding: '5px 12px', border: 'none', borderRadius: 7, cursor: 'not-allowed', background: '#e0e0e0', color: '#9e9e9e', fontWeight: 700, fontSize: 12 },
}

// 모바일 견적 카드 스타일
const qtMob: Record<string, React.CSSProperties> = {
  card: { border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px', background: '#fff', display: 'flex', flexDirection: 'column', gap: 10 },
  cardTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' as const },
  name: { fontSize: 15, fontWeight: 700, color: 'var(--dark)' },
  rows: { display: 'flex', flexDirection: 'column', gap: 6 },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 13 },
  label: { color: 'var(--muted)', fontSize: 12, flexShrink: 0, marginRight: 8 },
  actions: { display: 'flex', gap: 8, flexWrap: 'wrap' as const },
}

const modal: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  box: { background: '#fff', borderRadius: 14, padding: '28px 32px', width: 400, maxWidth: '90vw', display: 'flex', flexDirection: 'column', gap: 16 },
  title: { fontSize: 16, fontWeight: 700, color: 'var(--dark)' },
  desc: { fontSize: 13, color: 'var(--muted)' },
  select: { fontSize: 14, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 9, width: '100%' },
  error: { fontSize: 12, color: 'var(--warn)', background: 'var(--warnbg)', border: '1px solid #f0c9ad', padding: '7px 10px', borderRadius: 7 },
  actions: { display: 'flex', gap: 10, justifyContent: 'flex-end' },
  cancelBtn: { padding: '9px 18px', border: '1px solid var(--line)', borderRadius: 9, background: '#fff', cursor: 'pointer', fontSize: 13, color: 'var(--muted)' },
  confirmBtn: { padding: '9px 20px', border: 'none', borderRadius: 9, background: 'var(--dark)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
  confirmBtnDisabled: { padding: '9px 20px', border: 'none', borderRadius: 9, background: '#f0f2f4', color: '#b0b7c0', fontWeight: 700, fontSize: 13, cursor: 'not-allowed' },
}

const acc: Record<string, React.CSSProperties> = {
  toolbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  count: { fontSize: 13, color: 'var(--muted)' },
  createBtn: { padding: '7px 16px', border: 'none', borderRadius: 8, cursor: 'pointer', background: 'var(--dark)', color: '#fff', fontWeight: 700, fontSize: 13 },
  tableWrap: { overflowX: 'auto' as const },
  label: { display: 'block', fontSize: 11.5, color: 'var(--muted)', marginBottom: 5 },
  input: { width: '100%', boxSizing: 'border-box' as const, fontSize: 13, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8 },
  roleBadge: { fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 8, background: 'var(--lime)', color: 'var(--dark)' },
  masterBadge: { fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: '#1a1a1a', color: '#c8d200', marginLeft: 4 },
  statusBadge: { fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 8 },
  actions: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' as const },
  actionBtn: { padding: '4px 10px', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer', background: '#fff', fontSize: 12, color: 'var(--dark)' },
  suspendBtn: { padding: '4px 10px', border: 'none', borderRadius: 6, cursor: 'pointer', background: '#fdecea', color: '#c62828', fontSize: 12, fontWeight: 600 },
  activateBtn: { padding: '4px 10px', border: 'none', borderRadius: 6, cursor: 'pointer', background: '#e8f5e9', color: '#2e7d32', fontSize: 12, fontWeight: 600 },
  deleteBtn: { padding: '4px 10px', border: 'none', borderRadius: 6, cursor: 'pointer', background: '#b71c1c', color: '#fff', fontSize: 12, fontWeight: 600 },
  deleteBtnDisabled: { padding: '4px 10px', border: 'none', borderRadius: 6, cursor: 'not-allowed', background: '#e0e0e0', color: '#9e9e9e', fontSize: 12, fontWeight: 600 },
  cascadeDeleteBtn: { padding: '4px 10px', border: '2px solid #b71c1c', borderRadius: 6, cursor: 'pointer', background: '#fff', color: '#b71c1c', fontSize: 12, fontWeight: 700 },
  expandCell: { padding: '12px 16px', background: '#f8f9fa', borderBottom: '1px solid var(--line)' },
  expandHeader: { fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 10 },
  moduleGrid: { display: 'flex', flexWrap: 'wrap' as const, gap: 8 },
  moduleItem: { background: '#fff', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 12px', minWidth: 140, display: 'flex', flexDirection: 'column', gap: 3 },
  modName: { fontSize: 12, fontWeight: 600, color: 'var(--dark)' },
  modCode: { fontSize: 10, color: 'var(--muted)' },
  modMeta: { marginBottom: 4 },
  overrideTag: { fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 6, background: '#fff3e0', color: '#e65100' },
  roleTag: { fontSize: 10, color: 'var(--muted)', padding: '1px 0' },
  toggleOn: { padding: '3px 10px', border: 'none', borderRadius: 5, cursor: 'pointer', background: 'var(--lime)', color: 'var(--dark)', fontWeight: 700, fontSize: 11 },
  toggleOff: { padding: '3px 10px', border: '1px solid var(--line)', borderRadius: 5, cursor: 'pointer', background: '#fff', color: 'var(--muted)', fontWeight: 600, fontSize: 11 },
  tempPwBox: { background: '#f8f9fa', border: '1px solid var(--line)', borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 },
  tempPwLabel: { fontSize: 11, fontWeight: 700, color: 'var(--muted)' },
  tempPw: { fontSize: 15, fontWeight: 700, color: 'var(--dark)', fontFamily: 'monospace', letterSpacing: 1 },
  tempPwNote: { fontSize: 11, color: 'var(--warn)' },
  resetResultBox: { display: 'flex', alignItems: 'center', gap: 12, background: '#fff3e0', border: '1px solid #ffcc80', borderRadius: 10, padding: '10px 14px', marginBottom: 14, flexWrap: 'wrap' as const },
  resetResultLabel: { fontSize: 12, color: '#e65100' },
  dismissBtn: { padding: '4px 12px', border: 'none', borderRadius: 6, cursor: 'pointer', background: '#e65100', color: '#fff', fontWeight: 700, fontSize: 12 },
}

// 모바일 계정 카드 스타일
const accMob: Record<string, React.CSSProperties> = {
  card: { border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px', background: '#fff', display: 'flex', flexDirection: 'column', gap: 10 },
  cardTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' as const },
  name: { fontSize: 15, fontWeight: 700, color: 'var(--dark)' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 13 },
  label: { color: 'var(--muted)', fontSize: 12, flexShrink: 0, marginRight: 8 },
  value: { fontSize: 12, color: 'var(--body)', textAlign: 'right' as const, wordBreak: 'break-all' as const },
  actions: { display: 'flex', gap: 8, flexWrap: 'wrap' as const },
}
