import { Fragment, useEffect, useState } from 'react'
import { QuoteKindTag } from '../components/QuoteKindTag'
import { openPdf } from '../lib/openPdf'
import type { FeatureModule, AccessControl, Role, ApiQuote, ApiOrder, Org, User } from '@shared/types/index'
import { rolesOf } from '@shared/types/index'
import { fetchFeatureModules, fetchAccessControl, upsertAccessControl, fetchUsers, fetchOrgs, createUser, updateUser, resetUserPassword, deleteUser } from '../api/auth'
import type { CreateUserInput } from '../api/auth'
import { fetchQuotes, assignQuote, assignSalesQuote, setQuoteHidden, fetchOrderPreview } from '../api/quotes'
import { PurchaseOrderSheet } from '../components/PurchaseOrderSheet'
import { clampMemo, MEMO_MAX_LINES, MEMO_LIMIT_HINT } from '@shared/docs/memo'
import { fetchCustomers, setCustomerHidden, type AdminCustomer } from '../api/customers'
import { Segmented } from '../components/ui/Segmented'
import { useScreenRefresh, RefreshOn } from '../contexts/RefreshContext'
import { fetchOrders, fetchMakerOrgs } from '../api/orders'
import { Header } from '../components/Header'
import { OrderDetail } from '../components/OrderDetail'
import { useOrderDeepLink, type OrderDeepLink } from '../lib/deepLink'
import { OrderFilesTab } from '../components/OrderFilesTab'
import { CustomerFolders } from '../components/CustomerFolders'
import { OrderStepsBoard } from '../components/OrderStepsBoard'
import { OptionDbTab } from '../components/OptionDbTab'
import { CustomerViewModal } from '../components/CustomerViewModal'
import { SalesPerformance } from '../components/SalesPerformance'
import { BTN } from '../styles/buttons'
import { Tabs } from '../components/ui/Tabs'
import { RefreshButton } from '../components/RefreshButton'
import { Badge, type BadgeTone } from '../components/ui/Badge'
import { EmptyState } from '../components/ui/EmptyState'
import { Tooltip } from '../components/Tooltip'
import { quoteStatusTip, QUOTE_TIP_WIDTH } from '../components/QuoteStatusTip'
import { usePermission } from '../components/PermGate'
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

/** 겸직 계정 — 가진 역할들의 모듈을 합쳐서 본다(같은 모듈이 두 번 나오지 않게 코드로 묶는다). */
function getModulesForRoles(modules: FeatureModule[], roles: Role[]): FeatureModule[] {
  const seen = new Map<string, FeatureModule>()
  for (const r of roles) for (const m of getModulesForRole(modules, r)) seen.set(m.code, m)
  return [...seen.values()].sort((a, b) => a.sort_order - b.sort_order)
}
const QUOTE_STATUS_LABELS: Record<string, string> = {
  draft: '임시저장', confirmed: '견적완료', contracted: '계약완료',
  assigned: '배정완료', ordered: '주문진행', completed: '완료', expired: '만료',
}


/**
 * 기능모듈 설명 — **DB 의 feature_module 코드와 짝이 맞아야 한다.**
 * 예전에는 존재하지 않는 코드(kanban.*·admin.*·document.generate)를 적어 두고
 * 정작 실재하는 여러 모듈에는 설명이 없었다 — 켜고 끄는 사람이 무엇을 켜는지 알 수 없다.
 */
const MODULE_DESC: Record<string, string> = {
  'quote.create': '견적 작성 및 저장',
  'quote.edit': '견적 수정·복제',
  'quote.delete': '견적 삭제',
  'quote.confirm': '견적서 확정·생성',
  'order.confirm': '주문 전환 및 특장사 배정',
  'order.view': '주문 진행 조회',
  'order.control': '주문 단계 완료·증빙 등록 (끄면 조회만)',
  'doc.view': '구조변경 서류 조회',
  'doc.send.email': '견적서·계약서 메일 발송',
  'doc.send.sign': '전자서명 발송',
  'account.manage': '계정 발급 및 권한 관리',
  'basedata.manage': '옵션DB·무게상수 관리',
  'stats.own': '내 실적 조회',
  'stats.all': '전체 실적 조회',
}
type TabKey = 'quotes' | 'customers' | 'perf' | 'kanban' | 'files' | 'toggles' | 'accounts' | 'weights' | 'optiondb'

function fmtPrice(n: number) { return n ? `₩${n.toLocaleString()}` : '—' }
function fmtDate(s: string) { return s ? s.slice(0, 10) : '—' }


function isEnabled(ac: AccessControl[], type: 'role' | 'user', ref: string, code: string): boolean {
  const entry = ac.find(a => a.subject_type === type && a.subject_ref === ref && a.module_code === code)
  return entry?.enabled ?? false
}

// ── 특장사 확정 모달 ───────────────────────────────────────────────────────
/**
 * 제작 배정 — **발주서를 보고, 이 주문만의 요청을 적고, 맡긴다.**
 *
 * 예전에는 특장사만 고르고 끝이었다. 그러면 무엇을 발주하는지 모른 채 넘기게 되고,
 * 「이 건은 이렇게 해 주세요」를 전할 자리가 없어 전화·카톡으로 새어 나갔다.
 *
 * 여기서 보는 발주서는 **특장사가 수락할 때 보는 것과 같다**(같은 컴포넌트·같은 사양).
 */
interface ConfirmModalProps {
  quoteId: number; makerOrgs: Org[]; loading: boolean; error: string
  onConfirm: (makerOrgId: string, remark: string, customBadge: boolean) => void; onClose: () => void
}
function ConfirmModal({ quoteId, makerOrgs, loading, error, onConfirm, onClose }: ConfirmModalProps) {
  const [selected, setSelected] = useState('')
  const [remark, setRemark] = useState('')
  /**
   * 「커스텀」 배지 — 특장사 주문 목록에 붙는다. **여기서 정한다.**
   * 예전엔 비고에 뭐라도 적히면 자동으로 붙었다. 납기 안내처럼 커스텀과 무관한 메모에도
   * 배지가 달려, 특장사가 「무엇이 다른 주문인지」를 배지로 판단할 수 없었다.
   */
  const [customBadge, setCustomBadge] = useState(false)
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof fetchOrderPreview>> | null>(null)
  const [loadErr, setLoadErr] = useState('')

  useEffect(() => {
    let alive = true
    fetchOrderPreview(quoteId)
      .then(d => { if (alive) setPreview(d) })
      .catch(e => { if (alive) setLoadErr(e instanceof Error ? e.message : '발주 내용을 불러오지 못했습니다') })
    return () => { alive = false }
  }, [quoteId])

  const makerName = makerOrgs.find(o => o.code === selected)?.name ?? ''

  return (
    <div style={modal.overlay} onClick={onClose}>
      <div style={{ ...modal.box, ...modal.boxWide }} onClick={e => e.stopPropagation()}>
        <div style={modal.title}>견적 #{quoteId} — 제작 배정</div>

        <div style={modal.scroll}>
          <label style={modal.label}>특장사<span style={modal.req}> · 필수</span></label>
          <select value={selected} onChange={e => setSelected(e.target.value)} style={modal.select}>
            <option value="">선택하세요</option>
            {makerOrgs.map(o => <option key={o.code} value={o.code}>{o.name} ({o.code})</option>)}
          </select>

          {/*
            영업이 남긴 메모 — **읽기만** 한다. 고치는 자리는 견적 수정이지 배정이 아니다.
            비어 있으면 칸 자체를 띄우지 않는다(빈 상자는 「뭘 적어야 하나」로 읽힌다).
          */}
          {preview?.sales_memo.trim() && (
            <>
              <label style={modal.label}>영업 메모 <span style={modal.readonly}>· 읽기 전용</span></label>
              <div style={modal.memo}>{preview.sales_memo}</div>
            </>
          )}

          <label style={modal.checkRow}>
            <input type="checkbox" checked={customBadge} onChange={e => setCustomBadge(e.target.checked)} />
            <span>「커스텀」 표시</span>
            <span style={modal.readonly}>· 특장사 주문 목록에 배지로 뜹니다</span>
          </label>

          {loadErr && <div style={modal.error}>{loadErr}</div>}

          {preview && (
            <>
              <label style={modal.label}>발주서 <span style={modal.readonly}>· 특장사가 보는 그대로</span></label>
              <PurchaseOrderSheet
                orderId={0}
                orderedAt={new Date()}
                makerOrgName={makerName || '(특장사 선택 전)'}
                modelCode={preview.model_code}
                options={preview.options}
                deliveryDue=""
                remark={remark}
                editable={
                  <textarea
                    style={modal.remarkInput}
                    rows={MEMO_MAX_LINES}
                    placeholder={`이 주문만의 요청사항 (${MEMO_LIMIT_HINT})`}
                    value={remark}
                    onChange={e => setRemark(clampMemo(e.target.value))}
                  />
                }
              />
            </>
          )}
        </div>

        {error && <div style={modal.error}>{error}</div>}
        <div style={modal.actions}>
          <button style={modal.cancelBtn} onClick={onClose} disabled={loading}>취소</button>
          <button
            style={!selected || loading ? modal.confirmBtnDisabled : modal.confirmBtn}
            disabled={!selected || loading}
            onClick={() => onConfirm(selected, remark, customBadge)}
          >{loading ? '처리 중…' : '제작 배정'}</button>
        </div>
      </div>
    </div>
  )
}

/**
 * 관리자가 **지금 손대야 하는 행** — 목록에서 한 줄 통째로 라임으로 띄운다.
 *
 * 두 가지뿐이다:
 *   · 공개 창구로 들어온 문의 — 담당 영업을 지정해야 진행된다(이때 견적번호가 발급된다)
 *   · 계약완료 — 제작할 특장사를 지정해야 한다
 *
 * 둘 다 「누가 받을지 정해 주기 전까지는 아무도 손대지 않는 상태」다. 관리자가 이 목록에서
 * 가장 먼저 찾아야 하는 것이 그 둘이라, 같은 표시를 준다(무엇을 배정할지는 액션 버튼이 말한다).
 */
function needsAssign(q: ApiQuote): boolean {
  return q.source === 'public' || q.status === 'contracted'
}

// ── 영업 배정 모달(공개 문의) ──────────────────────────────────────────────
//
// 공개 화면에서 들어온 문의는 주인이 없다. 관리자가 담당 영업을 지정하는 순간
// **견적번호가 처음 발급되고** 그 영업의 「내 견적」에 나타난다.
interface AssignSalesModalProps {
  quoteId: number; users: User[]; loading: boolean; error: string
  onConfirm: (email: string) => void; onClose: () => void
}
function AssignSalesModal({ quoteId, users, loading, error, onConfirm, onClose }: AssignSalesModalProps) {
  const [selected, setSelected] = useState('')
  // 영업 역할이 있는 활성 계정만 — 특장사 계정에 배정하면 열지도 못한다(서버도 막는다)
  const candidates = users.filter(u => u.status === 'active' && u.active && rolesOf(u).includes('SALES'))
  return (
    <div style={modal.overlay} onClick={onClose}>
      <div style={modal.box} onClick={e => e.stopPropagation()}>
        <div style={modal.title}>문의 #{quoteId} — 영업 배정</div>
        <div style={modal.desc}>담당 영업사원을 지정하면 견적번호가 발급되고, 해당 영업의 「내 견적」에 나타납니다.</div>
        <label style={modal.label}>담당 영업<span style={modal.req}> · 필수</span></label>
        <select value={selected} onChange={e => setSelected(e.target.value)} style={modal.select}>
          <option value="">선택하세요</option>
          {candidates.map(u => <option key={u.email} value={u.email}>{u.name} ({u.email})</option>)}
        </select>
        {error && <div style={modal.error}>{error}</div>}
        <div style={modal.actions}>
          <button style={modal.cancelBtn} onClick={onClose} disabled={loading}>취소</button>
          <button style={!selected || loading ? modal.confirmBtnDisabled : modal.confirmBtn} disabled={!selected || loading} onClick={() => onConfirm(selected)}>
            {loading ? '처리 중…' : '영업 배정'}
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
  /** 겸직 — 발급할 때부터 여러 화면을 쓰는 계정이 있다(관리자가 영업까지 등) */
  const [extraRoles, setExtraRoles] = useState<Role[]>([])
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
      const res = await createUser({ ...form, extra_roles: extraRoles.filter(r => r !== form.role) })
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
            <label style={acc.label}>이메일<span style={acc.req}> · 필수</span></label>
            <input type="email" value={form.email} onChange={e => setField('email', e.target.value)} style={acc.input} placeholder="user@example.com" disabled={loading} />
          </div>
          <div>
            <label style={acc.label}>이름<span style={acc.req}> · 필수</span></label>
            <input type="text" value={form.name} onChange={e => setField('name', e.target.value)} style={acc.input} placeholder="홍길동" disabled={loading} />
          </div>
          <div>
            <label style={acc.label}>역할<span style={acc.req}> · 필수</span></label>
            <select value={form.role} onChange={e => setField('role', e.target.value)} style={acc.input} disabled={loading}>
              {ROLES.map(r => <option key={r} value={r}>{ROLE_KO[r]} ({r})</option>)}
            </select>
          </div>
          <div>
            <label style={acc.label}>겸직 역할</label>
            <div style={acc.roleRow}>
              {ROLES.filter(r => r !== form.role).map(r => {
                const on = extraRoles.includes(r)
                return (
                  <button
                    key={r}
                    type="button"
                    style={on ? acc.roleChipOn : acc.roleChipOff}
                    onClick={() => setExtraRoles(prev => on ? prev.filter(x => x !== r) : [...prev, r])}
                    disabled={loading}
                  >
                    {ROLE_KO[r]}
                  </button>
                )
              })}
            </div>
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
  /** 재설정 확인을 기다리는 계정(눌렀지만 아직 실행 전) */
  const [resetConfirm, setResetConfirm] = useState<User | null>(null)
  const [resetResult, setResetResult] = useState<{ email: string; temp_password: string } | null>(null)
  const [togglingStatus, setTogglingStatus] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [roleSaving, setRoleSaving] = useState<string | null>(null)

  function loadAll() {
    setLoading(true); setErr('')
    Promise.all([fetchUsers(), fetchOrgs(), fetchFeatureModules(), fetchAccessControl()])
      .then(([u, o, m, a]) => { setUsers(u); setOrgs(o); setModules(m); setAc(a) })
      .catch(e => setErr(e instanceof Error ? e.message : '로드 실패'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadAll() }, [])
  useScreenRefresh(loadAll)

  /*
   * 비밀번호 재설정 — **되돌릴 수 없는 동작**이다.
   * 누르는 즉시 그 사람의 기존 비밀번호가 무효가 되고, 임시 비밀번호는 이 화면에서
   * 한 번만 보인다(다시 조회할 수 없다). 옆 버튼을 잘못 눌러 남의 로그인을 끊는 일이
   * 없도록 **확인 단계를 한 번 둔다**(디자인 시스템 1-6 되돌릴 수 없는 동작).
   */
  async function handleResetPw(email: string) {
    setResetConfirm(null)
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


  /**
   * 겸직 역할 켜고 끄기 — 주 역할은 건드리지 않는다(그건 계정의 소속을 바꾸는 일이라 따로 둔다).
   * 서버가 목록을 통째로 받아 주 역할을 빼고 저장하므로, 여기서도 통째로 보낸다.
   */
  async function handleToggleExtraRole(user: User, role: Role) {
    if (role === user.role) return
    const cur = user.extra_roles ?? []
    const next = cur.includes(role) ? cur.filter(r => r !== role) : [...cur, role]
    setRoleSaving(user.email)
    setErr('')
    try {
      const saved = await updateUser(user.email, { extra_roles: next })
      setUsers(prev => prev.map(u => u.email === user.email ? { ...u, extra_roles: saved.extra_roles ?? next } : u))
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '역할 변경 실패')
    } finally {
      setRoleSaving(null)
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
    invited: { background: 'var(--card)', color: 'var(--dark)' },
    suspended: { background: 'var(--warnbg)', color: 'var(--warn)' },
  }
  const adminCount = users.filter(u => u.role === 'ADMIN').length
  const isDeleteDisabled = (u: User) => u.email === myEmail || (u.role === 'ADMIN' && adminCount <= 1)

  function renderModuleExpand(user: User) {
    const myRoles = rolesOf(user)
    return (
      <div style={acc.expandCell}>
        {/*
          역할 — 한 계정이 여러 화면을 쓸 수 있다(관리자가 영업까지, 관리자가 특장까지).
          계정을 하나 더 만들면 견적·주문이 다른 사람 것으로 쌓이므로 역할을 더한다.
        */}
        {!user.is_master && (
          <>
            <div style={acc.expandHeader}>역할 — 주 역할 + 겸직 (여러 화면을 한 계정으로)</div>
            <div style={acc.roleRow}>
              {ROLES.map(r => {
                const isPrimary = r === user.role
                const on = myRoles.includes(r)
                return (
                  <button
                    key={r}
                    style={{ ...(on ? acc.roleChipOn : acc.roleChipOff), ...(isPrimary ? acc.roleChipPrimary : null) }}
                    onClick={() => handleToggleExtraRole(user, r)}
                    disabled={isPrimary || roleSaving === user.email}
                    title={isPrimary ? '주 역할 — 로그인 후 첫 화면 기준이라 여기서 끄지 않는다' : '겸직 역할 켜기/끄기'}
                  >
                    {ROLE_KO[r]}{isPrimary ? ' · 주' : ''}
                  </button>
                )
              })}
            </div>
          </>
        )}
        <div style={acc.expandHeader}>
          {user.is_master ? '마스터 — 전체 모듈' : `계정 모듈 override — ${myRoles.map(r => ROLE_KO[r]).join(' + ')} 기준`}
        </div>
        <div style={acc.moduleGrid}>
          {(user.is_master ? modules : getModulesForRoles(modules, myRoles)).map(mod => {
            // 겸직이면 역할 중 하나라도 켜 두었으면 켜진 것 — 서버 판정(mergePermissions)과 같다
            const roleEnabled = myRoles.some(r => isEnabled(ac, 'role', r, mod.code))
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
    // 높이는 BTN(--h-control-sm)이 정한다 — 손가락 기기에서 이미 50px 로 커진다.
    // 여기서 44 를 덧씌우면 오히려 기준보다 작아진다(zoom .88 → 39px).
    if (user.is_master) {
      return isMaster ? (
        <button
          style={{ ...BTN.row }}
          onClick={() => setResetConfirm(user)}
          disabled={resetting === user.email}
        >
          {resetting === user.email ? '…' : '비번재설정'}
        </button>
      ) : null
    }
    return (
      <>
        <button
          style={{ ...BTN.row }}
          onClick={() => setExpandedEmail(expandedEmail === user.email ? null : user.email)}
        >
          {expandedEmail === user.email ? '▲ 모듈' : '▼ 모듈'}
        </button>
        <button
          style={{ ...BTN.row }}
          onClick={() => setResetConfirm(user)}
          disabled={resetting === user.email}
        >
          {resetting === user.email ? '…' : '비번재설정'}
        </button>
        <button
          style={{ ...(user.status === 'active' ? BTN.rowDanger : BTN.rowPrimary) }}
          onClick={() => handleToggleStatus(user)}
          disabled={togglingStatus === user.email}
        >
          {user.status === 'active' ? '정지' : '활성화'}
        </button>
        <button
          style={{ ...(isDeleteDisabled(user) ? BTN.rowDisabled : BTN.rowDanger) }}
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
        {/*
          「완전삭제」를 없앴다 — 그 영업의 **견적·주문·서류를 통째로** 지웠고, 계약 상태를
          보지도 않아 서명이 끝난 계약까지 사라졌다. 계정을 못 쓰게 하려면 「정지」를 쓴다.
        */}
      </>
    )
  }

  if (loading) return <div style={styles.content}><div style={{ color: 'var(--muted)', fontSize: 13 }}>로딩 중…</div></div>

  return (
    <div style={styles.content}>
      {err && <div style={{ color: 'var(--warn)', fontSize: 13, marginBottom: 12 }}>{err}</div>}

      {/*
        확인 단계 — 되돌릴 수 없는 동작이라 버튼 하나를 더 거치게 한다.
        무엇이 일어나는지(기존 비밀번호 무효 · 임시 비밀번호는 1회만 표시)를 눌러야 할
        사람이 읽고 결정하도록 그 자리에 적는다.
      */}
      {resetConfirm && (
        <div style={modal.overlay} onClick={() => setResetConfirm(null)}>
          <div style={modal.box} onClick={e => e.stopPropagation()}>
            <div style={modal.title}>비밀번호 재설정 — {resetConfirm.name}</div>
            <div style={modal.desc}>
              <b>{resetConfirm.email}</b> 의 비밀번호를 임시 비밀번호로 바꿉니다.
              <br />· 지금 쓰던 비밀번호는 <b>즉시 사용할 수 없게</b> 됩니다.
              <br />· 임시 비밀번호는 <b>이 화면에서 한 번만</b> 보이며 다시 조회할 수 없습니다.
              <br />· 당사자에게 직접 전달해야 합니다.
            </div>
            <div style={modal.actions}>
              <button style={modal.cancelBtn} onClick={() => setResetConfirm(null)}>취소</button>
              <button style={modal.confirmBtn} onClick={() => handleResetPw(resetConfirm.email)}>
                재설정
              </button>
            </div>
          </div>
        </div>
      )}

      {resetResult && (
        <div style={acc.resetResultBox}>
          <span style={acc.resetResultLabel}>{resetResult.email} 임시 비밀번호 (1회만 표시):</span>
          <span style={acc.tempPw}>{resetResult.temp_password}</span>
          <button style={BTN.barPrimary} onClick={() => setResetResult(null)}>확인</button>
        </div>
      )}

      <div style={acc.toolbar}>
        <span style={acc.count}>{users.length}명</span>
        {/* 높이는 BTN 이 정한다 — 여기서 minHeight 를 덮으면(undefined) 값이 지워져 납작해진다 */}
        <button style={BTN.barPrimary} onClick={() => setShowCreate(true)}>+ 계정 발급</button>
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
                  {rolesOf(user).map(r => (
                    <span key={r} style={r === user.role ? acc.roleBadge : acc.roleBadgeExtra}>{ROLE_KO[r]}</span>
                  ))}
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
                // 조각(<>)에 key 가 없으면 React 가 목록 경고를 낸다 — 조각 쪽에 key 를 준다
                <Fragment key={user.email}>
                  <tr>
                    <td style={styles.tdModule}>{user.email}</td>
                    <td style={styles.tdModule}>{user.name}</td>
                    <td style={styles.tdToggle}>
                      {/* 겸직이면 가진 역할을 모두 보여준다 — 하나만 보이면 왜 다른 화면이 열리는지 알 수 없다 */}
                      {rolesOf(user).map(r => (
                        <span key={r} style={r === user.role ? acc.roleBadge : acc.roleBadgeExtra}>{ROLE_KO[r]}</span>
                      ))}
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
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && <CreateUserModal orgs={orgs} onClose={() => { setShowCreate(false); loadAll() }} />}
    </div>
  )
}

// ── 발송 현황 배지 ────────────────────────────────────────────────────────
//
// 채널이 둘이고 성격이 다르다:
//   참고용 메일 = 서류 전달(되돌리기 쉬움) / 전자서명 = 법적 서명 요청(이력이 남음)
// 관리자는 '보냈는지 · 서명 요청했는지 · 서명 끝났는지' 세 가지를 한눈에 봐야 한다.
const SIGN_DONE = 'COMPLETED'
const SIGN_DEAD = ['REJECTED', 'CANCELED']

function fmtWhen(v?: string | null): string {
  if (!v) return ''
  const d = new Date(v)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function SendStatus({ quote }: { quote: ApiQuote }) {
  const mailed = !!quote.docs_emailed_at
  const c = quote.contract ?? null
  const signSent = !!c?.sent_at
  const signDone = c?.status === SIGN_DONE
  const signDead = !!c && SIGN_DEAD.includes(c.status)

  // 아직 안 한 것은 '대기', 한 것은 '완료', 거절·취소는 '경고'
  const chip = (on: boolean, label: string, tip: string, tone: 'ok' | 'warn' | 'off' = 'ok') => (
    <Tooltip text={tip} placement="below">
      <Badge tone={on ? (tone === 'warn' ? 'warn' : 'done') : 'wait'}>{label}</Badge>
    </Tooltip>
  )

  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'nowrap' }}>
      {chip(mailed, '메일',
        mailed ? `참고용 메일 발송 ${fmtWhen(quote.docs_emailed_at)}${quote.docs_emailed_to ? ` → ${quote.docs_emailed_to}` : ''}` : '참고용 메일 미발송')}
      {chip(signSent, '서명요청',
        signSent ? `전자서명 요청 ${fmtWhen(c?.sent_at)}` : '전자서명 미요청')}
      {signDead
        ? chip(true, c!.status === 'REJECTED' ? '서명거절' : '서명취소', `전자서명 ${c!.status}`, 'warn')
        : chip(signDone, '서명완료', signDone ? `전자서명 완료 ${fmtWhen(c?.completed_at)}` : '전자서명 미완료')}
    </div>
  )
}

// ── 영업 성과 탭 ──────────────────────────────────────────────────────────
// 영업의 「마이페이지」와 **같은 화면**을 쓴다 — 관리자는 계정 필터가 더 붙을 뿐이다.
// 화면을 둘로 나누면 한쪽만 낡는다.
function PerfTab() {
  // 전체 실적을 볼 권한이 없으면 계정 필터를 숨긴다 — 서버도 본인 것만 내려준다
  const canSeeAll = usePermission('stats.all')
  const [users, setUsers] = useState<string[]>([])
  useEffect(() => {
    fetchUsers()
      .then(us => setUsers(us.filter(u => u.role === 'SALES' || u.role === 'ADMIN').map(u => u.email)))
      .catch(() => setUsers([]))
  }, [])
  return <SalesPerformance showUserFilter={canSeeAll} userOptions={users} />
}


// ── 고객 정리 탭 ──────────────────────────────────────────────────────────
/**
 * 테스트로 만들어진 고객을 **숨기는** 화면. 지우지 않는다.
 *
 * 숨기면 견적 화면과 **WARP 「buildup에서 불러오기」 목록에서 빠진다.**
 * 그게 이 화면의 목적이다 — CRM 쪽에 테스트 데이터가 넘어가지 않게 한다.
 *
 * ⚠️ **WARP 에 이미 연결된 고객은 숨길 수 없다.** 숨기면 export 에서 빠져
 *    그쪽에서 사라진 것처럼 보인다(서버도 막는다).
 */
function CustomersTab() {
  const [rows, setRows] = useState<AdminCustomer[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  /** 보기 — 「사용 중」과 「숨김」을 **섞지 않는다.** 정리 작업은 숨긴 것만 따로 보는 게 편하다 */
  const [view, setView] = useState<'active' | 'hidden'>('active')
  const [busy, setBusy] = useState<number | null>(null)

  function load() {
    setLoading(true)
    fetchCustomers(view)
      .then(setRows)
      .catch(e => setErr(e instanceof Error ? e.message : '고객 목록을 불러오지 못했습니다'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [view])   // eslint-disable-line react-hooks/exhaustive-deps
  useScreenRefresh(load)

  async function toggle(c: AdminCustomer) {
    const hiding = !c.hidden_at
    // 견적이 함께 숨겨지는 건 놀랄 일이라 미리 알린다
    if (hiding && c._count.quotes > 0) {
      if (!window.confirm(`${c.name} 고객을 숨깁니다.\n\n이 고객의 견적 ${c._count.quotes}건도 함께 숨겨집니다.\n지우는 것이 아니라 화면에서만 감추며, 언제든 되돌릴 수 있습니다.`)) return
    }
    setBusy(c.id); setErr('')
    try {
      const r = await setCustomerHidden(c.id, hiding)
      load()
      if (hiding && r.quotes_affected > 0) setNote(`${c.name} · 견적 ${r.quotes_affected}건도 함께 숨겼습니다`)
      else if (!hiding && r.quotes_affected > 0) setNote(`${c.name} · 함께 숨겼던 견적 ${r.quotes_affected}건을 되돌렸습니다`)
      else setNote('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : '처리 실패')
    } finally { setBusy(null) }
  }

  return (
    <div>
      <div style={{ ...qt.filterBar, flexWrap: 'wrap' }}>
        <Segmented
          items={[{ value: 'active', label: '사용 중' }, { value: 'hidden', label: '숨김' }]}
          value={view}
          onChange={setView}
          size="sm"
        />
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--muted)' }}>
          {view === 'hidden' ? `숨긴 고객 ${rows.length}명` : `${rows.length}명`}
        </span>
      </div>
      {err && <div style={{ color: 'var(--req)', fontSize: 'var(--fs-caption)', marginBottom: 'var(--sp-3)' }}>{err}</div>}
      {note && <div style={{ color: 'var(--muted)', fontSize: 'var(--fs-caption)', marginBottom: 'var(--sp-3)' }}>{note}</div>}
      {loading ? <div style={{ padding: 'var(--sp-5)', color: 'var(--muted)' }}>불러오는 중…</div> : (
        <div style={qt.tableWrap}>
          <table style={qt.table}>
            <thead>
              <tr>
                <th style={qt.th}>고객</th>
                <th style={qt.th}>연락처</th>
                <th style={qt.th}>생년월일·사업자</th>
                <th style={qt.th}>견적</th>
                <th style={qt.th}>발송</th>
                <th style={qt.th}>WARP</th>
                <th style={qt.th}>등록</th>
                <th style={qt.th}>액션</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id} style={c.hidden_at ? { opacity: 0.5 } : undefined}>
                  <td style={qt.td}>
                    {c.name}
                    {c.hidden_at && <span style={{ color: 'var(--muted)', fontSize: 'var(--fs-caption)' }}> · 숨김</span>}
                  </td>
                  <td style={qt.td}>{c.phone ?? '—'}</td>
                  <td style={qt.td}>{c.reg_no ?? '—'}</td>
                  <td style={qt.tdNum}>{c._count.quotes}</td>
                  <td style={qt.tdNum}>{c.contract_quotes || '—'}</td>
                  <td style={qt.td}>{c.warp_customer_id ? '연결됨' : '—'}</td>
                  <td style={qt.td}>{c.created_at.slice(0, 10)}</td>
                  <td style={qt.td}>
                    {(() => {
                      // 숨길 수 없는 이유를 버튼 자리에서 바로 알려 준다
                      const blocked = !c.hidden_at
                        ? (c.warp_customer_id ? 'WARP 에 연결된 고객은 숨길 수 없습니다'
                          : c.contract_quotes > 0 ? `계약서가 발송된 견적 ${c.contract_quotes}건이 있어 숨길 수 없습니다` : '')
                        : ''
                      const off = busy === c.id || !!blocked
                      return (
                        <button
                          style={off ? BTN.rowDisabled : BTN.row}
                          disabled={off}
                          title={blocked || (c.hidden_at
                            ? '고객과 함께 숨긴 견적을 되돌립니다'
                            : '고객과 그 견적을 화면에서만 감춥니다. 지우지 않습니다')}
                          onClick={() => toggle(c)}
                        >{busy === c.id ? '…' : (c.hidden_at ? '다시 보이기' : '고객 숨기기')}</button>
                      )
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── 견적 목록 탭 ──────────────────────────────────────────────────────────
/**
 * 견적 목록 위에 **보기 전환**을 하나 얹는다.
 *
 * 견적 목록은 건별·날짜순이라 「이 고객한테 지금까지 뭘 보냈나」에 답하지 못한다.
 * 같은 자리에서 고객별 서류함으로 건너갈 수 있게 둔다 — 탭을 새로 만들면
 * 최상단이 길어지고, 두 화면이 사실상 같은 질문에 답한다는 것이 안 보인다.
 */
type QuotesView = 'list' | 'folders'

function QuotesWithFolders() {
  const [view, setView] = useState<QuotesView>('list')
  return (
    <div>
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <Segmented
          items={[
            { value: 'list' as const, label: '견적 목록' },
            { value: 'folders' as const, label: '고객 서류함' },
          ]}
          value={view}
          onChange={setView}
          size="sm"
        />
      </div>
      {view === 'list' ? <QuotesTab /> : <CustomerFolders />}
    </div>
  )
}

function QuotesTab() {
  // 견적 삭제를 없애면서 is_master 분기가 사라졌다 — 마스터만 할 수 있는 일이 이 탭엔 없다
  const isMobile = useIsMobile()
  /** 보기 — 「진행 중」과 「숨김」을 섞지 않는다. 정리는 숨긴 것만 따로 보는 게 편하다 */
  const [view, setView] = useState<'active' | 'hidden'>('active')
  const [hidingId, setHidingId] = useState<number | null>(null)

  const [quotes, setQuotes] = useState<ApiQuote[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  // 공개 문의 → 영업 배정
  const [assignSalesId, setAssignSalesId] = useState<number | null>(null)
  const [salesUsers, setSalesUsers] = useState<User[]>([])
  const [assignSalesBusy, setAssignSalesBusy] = useState(false)
  const [assignSalesErr, setAssignSalesErr] = useState('')
  const [makerOrgs, setMakerOrgs] = useState<Org[]>([])
  const [confirmLoading, setConfirmLoading] = useState(false)
  const [confirmError, setConfirmError] = useState('')
  const [makerOrgsLoading, setMakerOrgsLoading] = useState(false)
  const [viewing, setViewing] = useState<ApiQuote | null>(null)
  /*
   * 서면계약(서명본) 등록은 **영업 화면으로 옮겼다** — 견적서·계약서 흐름은 전부
   * 영업이 실행하고, 관리자 화면은 조회만 한다. 그 버튼이 쓰던 `order.confirm` 판정도
   * 함께 걷어냈다(제작 배정은 서버가 같은 권한으로 최종 판정한다).
   */

  function load() {
    setLoading(true); setErr('')
    fetchQuotes({ status: filterStatus || undefined, from: filterFrom || undefined, to: filterTo || undefined, view })
      .then(setQuotes)
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }

  // 보기를 바꾸면 다시 읽는다(조회 조건이 바뀐다)
  useEffect(() => { load() }, [view]) // eslint-disable-line react-hooks/exhaustive-deps
  // 앱으로 돌아오면 저절로 · 헤더 버튼으로도
  useScreenRefresh(load)

  function handleOpenConfirm(id: number) {
    setConfirmingId(id); setConfirmError(''); setMakerOrgsLoading(true)
    fetchMakerOrgs().then(setMakerOrgs).catch(() => setMakerOrgs([])).finally(() => setMakerOrgsLoading(false))
  }

  /*
   * 견적 확정(임시저장→견적확정)은 **영업의 업무**다 — 관리자 화면에는 두지 않는다.
   *
   * CLAUDE.md 주문흐름: 견적확정/주문전환(영업) → **관리자 검증** → 특장사 제작.
   * 관리자가 여기서도 확정할 수 있으면 「누가 확정했는지」가 흐려지고, 관리자의 관문이
   * 앞으로 당겨져 검증 단계가 사라진다. 관리자의 관문은 다음 단계인 **제작 배정**이다.
   */

  // 제작 배정 (계약완료→배정) — 특장사 선택 모달
  async function handleAssign(makerOrgId: string, remark: string, customBadge: boolean) {
    if (!confirmingId) return
    setConfirmLoading(true); setConfirmError('')
    try {
      await assignQuote(confirmingId, makerOrgId, remark, customBadge)
      setConfirmingId(null); load()
    } catch (e: unknown) {
      setConfirmError(e instanceof Error ? e.message : '배정 실패')
    } finally {
      setConfirmLoading(false)
    }
  }

  async function handleOpenAssignSales(id: number) {
    setAssignSalesId(id); setAssignSalesErr('')
    // 후보 목록은 열 때 한 번만 받는다(목록을 그릴 때마다 부를 이유가 없다)
    if (salesUsers.length === 0) {
      try { setSalesUsers(await fetchUsers()) } catch { setSalesUsers([]) }
    }
  }

  async function handleAssignSales(email: string) {
    if (assignSalesId === null) return
    setAssignSalesBusy(true); setAssignSalesErr('')
    try {
      const r = await assignSalesQuote(assignSalesId, email)
      setAssignSalesId(null)
      load()
      window.alert(`견적번호 ${r.quote_no} 로 배정했습니다.`)
    } catch (e: unknown) {
      setAssignSalesErr(e instanceof Error ? e.message : '배정 실패')
    } finally { setAssignSalesBusy(false) }
  }

  /*
   * 견적 삭제를 없앴다 — 이 라우트는 견적만이 아니라 **연결된 계약(purchase_contract)과
   * 서명본 PDF, 주문·서류까지 연쇄로 지웠다.** 서명이 끝난 계약은 거래의 증거다.
   * 잘못 만든 견적은 지우지 않고 상태로 관리한다(만료·취소). 서버도 405 로 거절한다.
   */

  /** 숨기기 / 다시 보이기 — 임시저장만 가능(서버가 막는다) */
  async function handleHide(id: number, hidden: boolean) {
    setHidingId(id); setErr('')
    try {
      await setQuoteHidden(id, hidden)
      load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '숨김 처리 실패')
    } finally { setHidingId(null) }
  }

  /** 견적 상태 → 뱃지 뜻 넷 중 하나(진행중·완료·대기·경고). 상태별로 색을 새로 만들지 않는다 */
  function statusTone(status: string): BadgeTone {
    if (status === 'draft') return 'wait'
    // 계약완료·완료는 '끝난 단계' 라 한눈에 구분되어야 한다
    if (status === 'contracted' || status === 'completed') return 'done'
    return 'progress'
  }

  return (
    <div>
      <div style={{ ...qt.filterBar, flexWrap: 'wrap' }}>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...qt.select, ...(isMobile ? { flex: 1 } : {}) }}>
          <option value="">전체 상태</option>
          <option value="draft">임시저장</option>
          <option value="confirmed">견적완료</option>
          <option value="contracted">계약완료</option>
          <option value="assigned">배정완료</option>
          <option value="ordered">주문진행</option>
          <option value="completed">완료</option>
          <option value="expired">만료</option>
        </select>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} style={{ ...qt.dateInput }} />
          <span style={qt.dateSep}>~</span>
          <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} style={{ ...qt.dateInput }} />
        </div>
        <Segmented
          items={[{ value: 'active', label: '진행 중' }, { value: 'hidden', label: '숨김' }]}
          value={view}
          onChange={setView}
          size="sm"
        />
        <button onClick={load} style={{ ...BTN.barPrimary, ...(isMobile ? { flex: 1 } : {}) }}>조회</button>
      </div>

      {err && <div style={qt.errMsg}>{err}</div>}

      {loading ? (
        <div style={qt.loading}>로딩 중…</div>
      ) : quotes.length === 0 ? (
        <EmptyState title="조건에 맞는 견적이 없습니다" description="기간이나 상태 조건을 바꿔 다시 조회해 보세요." />
      ) : isMobile ? (
        // ── 모바일: 카드 리스트 ──
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {quotes.map(q => {
            /* 서명이 끝난 건은 숨길 일이 없다 — 그 자리를 제작 배정이 쓴다 */
            const signed = q.contract?.status === 'COMPLETED'
            return (
            <div key={q.id} style={needsAssign(q) ? qtMob.cardPublic : qtMob.card}>
              <div style={qtMob.cardTop}>
                <span style={qtMob.name}>{q.customer?.name ?? '—'}<QuoteKindTag quote={q} /></span>
                <Tooltip text={quoteStatusTip(q.status)} maxWidth={QUOTE_TIP_WIDTH} placement="below">
                  <Badge tone={statusTone(q.status)}>{QUOTE_STATUS_LABELS[q.status] ?? q.status}</Badge>
                </Tooltip>
              </div>
              <div style={qtMob.rows}>
                <div style={qtMob.row}>
                  <span style={qtMob.label}># · 특장사</span>
                  <span>{q.quote_no ?? `#${q.id}`} · {q.order?.maker_org?.name ?? '—'}</span>
                </div>
                <div style={qtMob.row}>
                  <span style={qtMob.label}>영업</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {q.sales_user_id ?? '—'}
                    {q.source === 'public' && q.sales_user_id && !q.sales_accepted_at && (
                      <span style={qt.waitAccept}> · 수락 대기</span>
                    )}
                  </span>
                </div>
                <div style={qtMob.row}>
                  <span style={qtMob.label}>실구매가(기타 포함)</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtPrice(q.final_price)}</span>
                </div>
                <div style={qtMob.row}>
                  <span style={qtMob.label}>일시</span>
                  <span>{fmtDate(q.created_at)}</span>
                </div>
                <div style={qtMob.row}>
                  <span style={qtMob.label}>발송현황</span>
                  <SendStatus quote={q} />
                </div>
              </div>
              <div style={qtMob.actions}>
                <button
                  style={{ ...BTN.row, width: '100%' }}
                  onClick={() => setViewing(q)}
                >고객정보</button>
                <button
                  style={{ ...BTN.row, width: '100%' }}
                  onClick={() => openPdf(`/api/v1/quotes/${q.id}/pdf`, `견적서_${q.customer?.name ?? q.id}.pdf`)}
                >견적서</button>
                <button
                  style={{ ...(q.status === 'draft' ? BTN.rowMuted : BTN.row), width: '100%' }}
                  disabled={q.status === 'draft'}
                  onClick={() => openPdf(`/api/v1/quotes/${q.id}/contract-pdf`, `계약서_${q.customer?.name ?? q.id}.pdf`)}
                >계약서</button>
                {q.contract?.status === 'COMPLETED' && (
                  <button
                    style={{ ...BTN.rowPrimary, width: '100%' }}
                    onClick={() => openPdf(`/api/v1/quotes/${q.id}/contract/signed`, `계약서_서명본_${q.customer?.name ?? q.id}.pdf`)}
                  >{q.contract?.signing_method === 'PAPER' ? '계약서 스캔본' : '서명본'}</button>
                )}
                {/* 공개 문의(주인 없음) — 영업을 지정해야 진행된다. 이때 견적번호가 처음 발급된다 */}
                {q.source === 'public' && !q.sales_user_id && (
                  <button style={{ ...BTN.rowPrimary, width: '100%' }} onClick={() => handleOpenAssignSales(q.id)}>영업 배정</button>
                )}
                {/* 데스크톱과 같은 규칙 — 서명이 끝나면 숨기기 자리를 제작 배정이 쓴다 */}
                {!signed && (
                  <button
                    style={{ ...(hidingId === q.id ? BTN.rowDisabled : BTN.row), width: '100%' }}
                    disabled={hidingId === q.id}
                    onClick={() => handleHide(q.id, !q.hidden_at)}
                  >{hidingId === q.id ? '…' : (q.hidden_at ? '다시 보이기' : '견적 숨기기')}</button>
                )}
                {q.status === 'contracted' && (
                  <button style={{ ...qt.assignBtn, width: '100%' }} onClick={() => handleOpenConfirm(q.id)}>제작 배정</button>
                )}
              </div>
            </div>
            )
          })}
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
                <th style={qt.th}>실구매가(기타 포함)</th>
                <th style={qt.th}>상태</th>
                <th style={qt.th}>특장사</th>
                <th style={qt.th}>발송현황</th>
                <th style={qt.th}>일시</th>
                <th style={qt.th}>액션</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map(q => {
                /* 서명이 끝난 건은 숨길 일이 없다 — 그 자리를 제작 배정이 쓴다 */
                const signed = q.contract?.status === 'COMPLETED'
                return (
                <tr key={q.id} style={needsAssign(q) ? qt.rowPublic : undefined}>
                  <td style={needsAssign(q) ? qt.tdPublicFirst : qt.td}>{q.quote_no ?? `#${q.id}`}<QuoteKindTag quote={q} /></td>
                  <td style={qt.td}>{q.customer?.name ?? '—'}</td>
                  <td style={qt.tdEmail} title={q.sales_user_id ?? ''}>
                    {q.sales_user_id ?? '—'}
                    {/* 배정만 해 놓고 영업이 아직 받지 않은 건 — 관리자가 되짚어야 하는 상태다 */}
                    {q.source === 'public' && q.sales_user_id && !q.sales_accepted_at && (
                      <span style={qt.waitAccept}> · 수락 대기</span>
                    )}
                  </td>
                  <td style={qt.tdNum}>{fmtPrice(q.final_price)}</td>
                  <td style={qt.td}>
                    <Tooltip text={quoteStatusTip(q.status)} maxWidth={QUOTE_TIP_WIDTH} placement="below">
                      <Badge tone={statusTone(q.status)}>
                        {QUOTE_STATUS_LABELS[q.status] ?? q.status}
                      </Badge>
                    </Tooltip>
                  </td>
                  <td style={qt.tdMuted}>{q.order?.maker_org?.name ?? '—'}</td>
                  <td style={qt.td}><SendStatus quote={q} /></td>
                  <td style={qt.tdMuted}>{fmtDate(q.created_at)}</td>
                  <td style={qt.td}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'nowrap' }}>
                      <button
                        style={BTN.row}
                        title="고객·계약 정보 조회 (수정 불가)"
                        onClick={() => setViewing(q)}
                      >고객정보</button>
                      <button
                        style={BTN.row}
                        onClick={() => openPdf(`/api/v1/quotes/${q.id}/pdf`, `견적서_${q.customer?.name ?? q.id}.pdf`)}
                      >견적서</button>
                      {/* 계약서는 견적 확정(생성) 후에만 의미가 있다 — 발송은 영업 업무라 관리자엔 두지 않는다 */}
                      <button
                        style={q.status === 'draft' ? BTN.rowMuted : BTN.row}
                        disabled={q.status === 'draft'}
                        title={q.status === 'draft' ? '견적서 생성 후 계약서를 볼 수 있습니다' : '특장 매매계약서 미리보기'}
                        onClick={() => openPdf(`/api/v1/quotes/${q.id}/contract-pdf`, `계약서_${q.customer?.name ?? q.id}.pdf`)}
                      >계약서</button>
                      {/* 서명이 끝난 계약만 — 도장·서명이 찍힌 정본(시스템 보관본) */}
                      {q.contract?.status === 'COMPLETED' && (
                        <button
                          style={BTN.rowPrimary}
                          title="고객이 서명·날인한 계약서 정본 (시스템 보관본)"
                          onClick={() => openPdf(`/api/v1/quotes/${q.id}/contract/signed`, `계약서_서명본_${q.customer?.name ?? q.id}.pdf`)}
                        >{q.contract?.signing_method === 'PAPER' ? '스캔본' : '서명본'}</button>
                      )}
                      {q.source === 'public' && !q.sales_user_id && (
                        <button style={BTN.rowPrimary} onClick={() => handleOpenAssignSales(q.id)}>영업 배정</button>
                      )}
                      {/*
                        서명이 끝난 건은 **숨길 일이 없다**(서버도 막는다). 그 자리를 비워 두는 대신
                        **제작 배정**이 쓴다 — 버튼 개수가 늘지 않아 줄이 밀리지 않는다.
                      */}
                      {!signed && (
                        <button
                          style={hidingId === q.id ? BTN.rowDisabled : BTN.row}
                          disabled={hidingId === q.id}
                          title={q.hidden_at ? '다시 보이게 합니다' : '이 견적만 화면에서 감춥니다. 지우지 않습니다'}
                          onClick={() => handleHide(q.id, !q.hidden_at)}
                        >{hidingId === q.id ? '…' : (q.hidden_at ? '다시 보이기' : '견적 숨기기')}</button>
                      )}
                      {q.status === 'contracted' && (
                        <button style={qt.assignBtn} onClick={() => handleOpenConfirm(q.id)}>제작 배정</button>
                      )}
                    </div>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {viewing && <CustomerViewModal quote={viewing} onClose={() => setViewing(null)} />}

      {assignSalesId !== null && (
        <AssignSalesModal
          quoteId={assignSalesId}
          users={salesUsers}
          loading={assignSalesBusy}
          error={assignSalesErr}
          onConfirm={handleAssignSales}
          onClose={() => { setAssignSalesId(null); setAssignSalesErr('') }}
        />
      )}

      {confirmingId !== null && (
        <ConfirmModal
          quoteId={confirmingId}
          makerOrgs={makerOrgs}
          loading={confirmLoading || makerOrgsLoading}
          error={confirmError}
          onConfirm={handleAssign}
          onClose={() => { setConfirmingId(null); setConfirmError('') }}
        />
      )}
      
      
    </div>
  )
}

// ── 주문 칸반 탭 ──────────────────────────────────────────────────────────
function KanbanTab({ deepLink }: { deepLink?: OrderDeepLink | null }) {
  const { session } = useAuth()
  const canControl = session?.user.is_master ?? false
  /** 주문을 치울 수 있는가 — 기능모듈로 **계정별**로 켠다. 관리자라고 다 되지 않는다. */
  const canRemove = usePermission('order.remove')

  const [orders, setOrders] = useState<ApiOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  /*
   * 알림을 눌러 들어왔으면 그 주문을 **바로 편다.** 목록에서 다시 찾게 하면
   * 알림을 누른 의미가 없다.
   */
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(deepLink?.orderId ?? null)

  function load() {
    setLoading(true); setErr('')
    fetchOrders({}).then(setOrders).catch(e => setErr(e.message)).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // 앱으로 돌아오면 저절로 · 헤더 버튼으로도
  useScreenRefresh(load)

  if (loading) return <div style={{ color: 'var(--muted)', fontSize: 13, padding: '24px 0' }}>로딩 중…</div>

  if (selectedOrderId !== null) {
    /*
     * 보드 카드마다 버튼을 흩뿌리지 않고 **열어 본 자리**에 둔다 — 되돌리기 어려운 조작은
     * 한 건을 들여다보는 자리에 있어야 잘못 누르지 않는다.
     *
     * ⚠️ 상태로 막지 않는다. 예전엔 수락 대기·진행중일 때만 버튼을 띄웠는데, 그러면
     *    잘못 들어간 건이 인도 완료로 넘어간 순간 **버튼이 사라져 아무 설명도 없이**
     *    치울 수 없었다(실제 제보). 판정은 서버가 권한으로 한다.
     */
    return (
      <OrderDetail
        orderId={selectedOrderId}
        onBack={() => setSelectedOrderId(null)}
        backLabel="← 주문 진행"
        /* 알림을 눌러 들어온 그 주문일 때만 대화 탭으로 연다 */
        initialTab={deepLink?.chat && deepLink.orderId === selectedOrderId ? 'chat' : undefined}
        initialChatStep={deepLink?.orderId === selectedOrderId ? deepLink?.step : undefined}
        /*
         * 삭제 버튼은 **제목 줄 오른쪽**에 둔다. 예전엔 화면 맨 아래에 있어
         * 되돌리기 어려운 조작인데도 스크롤 끝에서 마주쳤다.
         * 권한이 없으면 아예 넘기지 않는다 — 특장사에게는 이 자리가 비어 있다.
         */
        onRemove={canRemove
          ? () => { setSelectedOrderId(null); load() }
          : undefined}
      />
    )
  }

  return (
    <div>
      {err && <div style={{ color: 'var(--warn)', fontSize: 13, marginBottom: 10 }}>{err}</div>}
      {!canControl && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>조회 전용 — 상태 변경은 배정 특장사만 가능합니다.</div>}
      <OrderStepsBoard orders={orders} onCardClick={setSelectedOrderId} />
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

  function loadModules() {
    return Promise.all([fetchFeatureModules(), fetchAccessControl()]).then(([mods, ctrl]) => {
      setModules(mods)
      setAc(ctrl)
    })
  }
  useEffect(() => { void loadModules() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

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

  /*
   * **알림을 누르고 들어온 경우** — `/?order=19&tab=chat` 를 읽어 「주문 진행」 탭을
   * 펴고 그 주문을 연다. 주소는 한 번 읽고 지운다(useOrderDeepLink) — 안 지우면
   * 목록으로 돌아가 새로고침할 때마다 같은 주문이 다시 열린다.
   */
  const [deepLink, setDeepLink] = useState<OrderDeepLink | null>(null)
  useOrderDeepLink(link => { setDeepLink(link); setActiveTab('kanban') })

  // 탭마다 필요한 권한 — 없으면 **버튼째** 감춘다.
  // 눌러서 「권한이 없습니다」를 보게 두면 왜 있는 버튼인지 알 수 없다.
  const perm = {
    stats: usePermission('stats.own'),
    orders: usePermission('order.view'),
    accounts: usePermission('account.manage'),
    basedata: usePermission('basedata.manage'),
  }
  const TABS: { key: TabKey; label: string; show: boolean }[] = ([
    { key: 'quotes',   label: '견적 목록', show: true },
    { key: 'customers', label: '고객',    show: true },
    { key: 'perf',     label: '영업 성과', show: perm.stats },
    { key: 'kanban',   label: '주문 진행', show: perm.orders },
    { key: 'files',    label: '파일',      show: perm.orders },
    { key: 'toggles',  label: '기능모듈',  show: perm.accounts },
    { key: 'accounts', label: '계정 관리', show: perm.accounts },
    { key: 'weights',  label: '무게상수',  show: perm.basedata },
    { key: 'optiondb', label: '옵션DB',    show: perm.basedata },
  ] as const).filter(t => t.show)

  // 보고 있던 탭이 감춰지면(권한이 도중에 꺼지면) 첫 탭으로 되돌린다.
  // TABS 는 매 렌더 새 배열이라 그대로 의존성에 두면 매번 다시 도는 셈이 된다 — 키 문자열로 본다.
  const visibleKeys = TABS.map(t => t.key).join(',')
  useEffect(() => {
    const keys = visibleKeys.split(',') as TabKey[]
    if (!keys.includes(activeTab)) setActiveTab(keys[0] ?? 'quotes')
  }, [visibleKeys, activeTab])

  return (
    <div style={styles.root}>
      <Header />

      {/*
        탭 줄은 **헤더 바로 아래 한 줄을 통째로** 쓴다 — 영업 화면과 같은 구조다.
        예전엔 위에 「관리자 대시보드」 제목이 있었는데, 어느 화면인지는 헤더의 역할 배지가
        이미 말해 준다. 제목 한 줄이 좁은 화면에서 내용을 그만큼 밀어냈다.
        권한 없는 탭은 TABS 에서 이미 빠져 있다(숨김).
      */}
      <div style={styles.tabBar}>
        <Tabs items={TABS} value={activeTab} onChange={setActiveTab} trailing={<RefreshButton />} />
      </div>

      <div style={{ ...styles.body, padding: isMobile ? '14px 14px' : '20px 24px' }}>

        {activeTab === 'quotes' && <QuotesWithFolders />}
        {activeTab === 'customers' && <CustomersTab />}
        {activeTab === 'perf' && <PerfTab />}
        {activeTab === 'kanban' && <KanbanTab deepLink={deepLink} />}

        {/* 주문에 딸린 사진·서류를 한자리에서 — 업로드본과 자동생성본을 갈라 본다 */}
        {activeTab === 'files' && <OrderFilesTab />}

        {activeTab === 'toggles' && (
          <div style={styles.content}>
            <RefreshOn load={loadModules} />
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
                              {MODULE_DESC[mod.code] ? (
                                <Tooltip text={MODULE_DESC[mod.code]!} placement="below">
                                  <div style={styles.modName}>{mod.name}</div>
                                </Tooltip>
                              ) : (
                                <div style={styles.modName}>{mod.name}</div>
                              )}
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
        {/* 무게상수도 옵션DB와 같은 화면을 쓴다 — 편집·이력·되돌리기가 전부 동일하게 동작 */}
        {activeTab === 'weights' && (
          <OptionDbTab
            only={['weight_constant']}
            note={<>하중계산서·제원대비표 자동생성에 쓰이는 계산 상수입니다. 값을 수정하면 <b>다음 서류생성부터 재계산</b>에 반영됩니다.</>}
          />
        )}
        {activeTab === 'optiondb' && <OptionDbTab only={['option_price', 'subsidy_local', 'subsidy_national', 'tax_config', 'installment_rate']} />}
      </div>
    </div>
  )
}

// ── 스타일 ────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  root: { height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  body: {
    flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px',
    /*
     * 끝까지 스크롤한 뒤 더 당겨도 **바깥으로 넘기지 않는다.** 아이폰은 안쪽 칸이 끝에
     * 닿으면 그 힘을 바깥으로 넘겨 화면 전체를 출렁이게 한다 — 채팅하다 손가락이
     * 미끄러지면 화면이 통째로 움직인다(사진 제보).
     */
    overscrollBehavior: 'contain' as const,
  },
  h1: {
    margin: 0, marginBottom: 'var(--sp-3)',
    fontSize: 'var(--fs-title)',
    fontWeight: 'var(--fw-title)' as React.CSSProperties['fontWeight'],
    letterSpacing: 'var(--ls-tight)',
    color: 'var(--dark)',
  },
  // 본문 좌우 여백만큼 밖으로 빼 밑줄이 화면 끝까지 이어지게 한다
  // 영업 화면과 같은 자리·같은 모양 — 헤더 바로 아래 한 줄을 통째로 쓴다
  tabBar: { flexShrink: 0, display: 'flex', background: '#fff' },
  tab: { padding: '6px 14px', border: '0.5px solid var(--line)', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 13, color: 'var(--muted)' },
  tabOn: { padding: '6px 14px', border: '0.5px solid var(--dark)', borderRadius: 8, background: 'var(--dark)', cursor: 'pointer', fontSize: 13, color: '#fff', fontWeight: 600 },
  content: {},
  surfaceGroup: { marginBottom: 28 },
  surfaceLabel: { fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 8 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  thModule: { textAlign: 'left' as const, padding: '8px 12px', borderBottom: '2px solid var(--line)', color: 'var(--muted)', fontWeight: 600, fontSize: 12 },
  thRole: { textAlign: 'center' as const, padding: '8px 12px', borderBottom: '2px solid var(--line)', color: 'var(--muted)', fontWeight: 600, fontSize: 12, width: 80 },
  tdModule: { padding: '10px 12px', borderBottom: '0.5px solid var(--line)' },
  tdToggle: { textAlign: 'center' as const, padding: '10px 12px', borderBottom: '0.5px solid var(--line)' },
  modName: { fontSize: 13, color: 'var(--dark)' },
  modCode: { fontSize: 11, color: 'var(--muted)', marginTop: 2 },
  // 높이·폭은 표 안 버튼과 같은 값으로 — 한 화면에서 버튼 크기가 갈리지 않게
  toggleOn: { ...BTN.smPrimary, background: 'var(--lime)', color: 'var(--dark)', border: 'none', fontWeight: 700 },
  toggleOff: { ...BTN.smSecondary, color: 'var(--muted)' },
}

const qt: Record<string, React.CSSProperties> = {
  /**
   * 제작 배정 — 다른 버튼과 **같은 크기·같은 줄**이다. 크게 만들거나 아래로 내렸더니
   * 목록이 그 버튼으로 뒤덮이고 행 높이가 들쭉날쭉해졌다(둘 다 되돌렸다).
   *
   * 대신 **글자를 브랜드 라임으로** 두어 검정 버튼(서명본·스캔본)과도 한눈에 갈린다.
   * 라임은 흰 바탕에서 흐리지만 검은 바탕에서는 또렷하다.
   */
  assignBtn: { ...BTN.rowPrimary, color: 'var(--lime)', fontWeight: 700 },
  filterBar: { display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' },
  // 모양·높이는 globals.css — 여기서는 줄어드는 방식만 (인라인으로 덮으면 옆 버튼과 높이가 어긋난다)
  // 늘어나지는 않고(0) 좁아지면 줄어든다(1) — grow 를 주면 넓은 화면에서 「전체 상태」 하나가 1182px 를 차지한다(실측)
  select: { flex: '0 1 160px', minWidth: 0, maxWidth: '100%' },
  dateInput: { flex: '0 1 auto', minWidth: 0 },
  dateSep: { color: 'var(--muted)', fontSize: 13 },
  searchBtn: { padding: '7px 16px', border: 'none', borderRadius: 8, cursor: 'pointer', background: 'var(--dark)', color: '#fff', fontWeight: 700, fontSize: 13 },
  errMsg: { color: 'var(--warn)', fontSize: 13, marginBottom: 10 },
  loading: { color: 'var(--muted)', fontSize: 13, padding: '24px 0' },
  empty: { color: 'var(--muted)', fontSize: 13, padding: '24px 0', textAlign: 'center' as const },
  /*
   * 공개 창구에서 들어온 문의 — **한 줄을 통째로** 라임으로 띄운다.
   *
   * 관리자가 이 목록에서 가장 먼저 찾아야 하는 것이 「주인 없는 새 문의」다.
   * 원색(--lime)으로 칠하면 글자가 읽히지 않아, 선택 표시에 쓰는 옅은 라임(--lime-bg)을
   * 깔고 왼쪽 모서리에만 원색 띠를 세운다 — 스크롤 중에도 왼쪽 끝만 보면 찾을 수 있다.
   */
  rowPublic: { background: 'var(--lime-bg)' },
  tdPublicFirst: {
    padding: '10px 12px', borderBottom: '0.5px solid var(--line)', verticalAlign: 'middle' as const,
    whiteSpace: 'nowrap' as const, boxShadow: 'inset 3px 0 0 0 var(--lime)',
  },
  tableWrap: { overflowX: 'auto' as const },
  // 폭이 모자라면 칸을 **줄여서 글자를 접지 말고** 가로로 넘겨 스크롤한다.
  table: { width: '100%', minWidth: 'max-content' as const, borderCollapse: 'collapse' as const, fontSize: 13 },
  th: { textAlign: 'left' as const, padding: '9px 12px', borderBottom: '2px solid var(--line)', color: 'var(--muted)', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' as const },
  td: { padding: '10px 12px', borderBottom: '0.5px solid var(--line)', verticalAlign: 'middle' as const, whiteSpace: 'nowrap' as const },
  tdMuted: { padding: '10px 12px', borderBottom: '0.5px solid var(--line)', color: 'var(--muted)', fontSize: 12, whiteSpace: 'nowrap' as const },
  // 영업 이메일은 길어질 수 있다 — 표 전체를 밀어내지 않게 여기서만 줄임표로 자른다
  waitAccept: { color: 'var(--req)', fontWeight: 700 },
  tdEmail: { padding: '10px 12px', borderBottom: '0.5px solid var(--line)', color: 'var(--muted)', fontSize: 12, whiteSpace: 'nowrap' as const, maxWidth: 210, overflow: 'hidden' as const, textOverflow: 'ellipsis' as const },
  tdNum: { padding: '10px 12px', borderBottom: '0.5px solid var(--line)', fontVariantNumeric: 'tabular-nums' as const, textAlign: 'right' as const, whiteSpace: 'nowrap' as const },
  // 표 안 버튼 — 영업 화면 목록과 **같은 크기**(BTN.sm*). 색만 역할에 맞게 얹는다
  pdfBtn: BTN.smSecondary,
  sendBtn: BTN.smSecondary,
  confirmBtn: BTN.smPrimary,
  deleteBtn: BTN.smDanger,
  deleteBtnStrong: BTN.smDanger,
  deleteBtnDisabled: BTN.smDisabled,
}

// 모바일 견적 카드 스타일
const qtMob: Record<string, React.CSSProperties> = {
  card: { border: '0.5px solid var(--line)', borderRadius: 12, padding: '14px 16px', background: '#fff', display: 'flex', flexDirection: 'column', gap: 10 },
  // 공개 창구 문의 — 표의 라임 강조를 카드에도 똑같이(왼쪽 띠 + 옅은 라임)
  cardPublic: {
    border: '0.5px solid var(--lime)', borderLeft: '3px solid var(--lime)', borderRadius: 12,
    padding: '14px 16px', background: 'var(--lime-bg)', display: 'flex', flexDirection: 'column', gap: 10,
  },
  cardTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' as const },
  name: { fontSize: 15, fontWeight: 700, color: 'var(--dark)' },
  rows: { display: 'flex', flexDirection: 'column', gap: 6 },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 13 },
  label: { color: 'var(--muted)', fontSize: 12, flexShrink: 0, marginRight: 8 },
  // 세 칸 격자 — flex 로 늘리면 마지막 줄에 하나만 남았을 때 그 버튼만 줄 전체가 된다
  actions: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 },
}

const modal: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'var(--scrim)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  box: { background: '#fff', borderRadius: 14, padding: '28px 32px', width: 400, maxWidth: '90vw', display: 'flex', flexDirection: 'column', gap: 16 },
  title: { fontSize: 16, fontWeight: 700, color: 'var(--dark)' },
  desc: { fontSize: 13, color: 'var(--muted)' },
  // 「필수」는 목록 안 안내문이 아니라 **라벨 옆 빨간 글씨** — 앱 전체가 같은 규칙이다
  label: { fontSize: 'var(--fs-label)', color: 'var(--muted)', marginBottom: 'calc(var(--sp-2) * -1)' },
  /** 체크 한 줄 — 라벨과 설명을 한 줄에. 줄 전체가 누름 영역이다(label 로 감싼다) */
  checkRow: {
    display: 'flex', alignItems: 'center', gap: 'var(--sp-2)',
    marginTop: 'var(--sp-3)', fontSize: 'var(--fs-label)', cursor: 'pointer',
  },
  req: { color: 'var(--req)', fontWeight: 700 },
  select: { fontSize: 14, padding: '10px 12px', border: '0.5px solid var(--line)', borderRadius: 9, width: '100%' },
  error: { fontSize: 12, color: 'var(--warn)', background: 'var(--warnbg)', border: '0.5px solid var(--warn)', padding: '7px 10px', borderRadius: 7 },
  file: { width: '100%', fontSize: 'var(--fs-label)', color: 'var(--dark)', padding: 'var(--sp-2) 0' },
  hint: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', marginTop: 'var(--sp-1)' },
  actions: { display: 'flex', gap: 10, justifyContent: 'flex-end' },
  // 나란히 서는 버튼은 **같은 크기** — 공통 BTN 을 쓰고 최소폭만 맞춘다
  cancelBtn: { ...BTN.secondary, minWidth: 108, color: 'var(--muted)' },
  confirmBtn: { ...BTN.primary, minWidth: 108 },
  confirmBtnDisabled: { ...BTN.disabled, minWidth: 108 },
}

const acc: Record<string, React.CSSProperties> = {
  toolbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  count: { fontSize: 13, color: 'var(--muted)' },
  createBtn: { padding: '7px 16px', border: 'none', borderRadius: 8, cursor: 'pointer', background: 'var(--dark)', color: '#fff', fontWeight: 700, fontSize: 13 },
  tableWrap: { overflowX: 'auto' as const },
  label: { display: 'block', fontSize: 11.5, color: 'var(--muted)', marginBottom: 5 },
  req: { color: 'var(--req)', fontWeight: 700 },
  input: { width: '100%', boxSizing: 'border-box' as const, fontSize: 13, padding: '8px 10px', border: '0.5px solid var(--line)', borderRadius: 8 },
  roleBadge: { fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 8, background: 'var(--lime)', color: 'var(--dark)' },
  // 겸직은 주 역할보다 한 단 여리게 — 어느 것이 이 계정의 자리인지 한눈에 갈린다
  roleBadgeExtra: {
    fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 8, marginLeft: 4,
    background: 'var(--lime-bg)', color: 'var(--dark)', border: '0.5px solid var(--lime)',
  },
  roleRow: { display: 'flex', gap: 6, flexWrap: 'wrap' as const, marginBottom: 12 },
  // 폭을 못 박는다 — 「영업」·「관리자 · 주」처럼 글자 수가 달라도 칩 크기는 같아야 한다
  roleChipOff: {
    minHeight: 'var(--h-control)', width: 108, padding: '0 var(--sp-3)', borderRadius: 'var(--r-pill)',
    border: '0.5px solid var(--line)', background: '#fff', color: 'var(--muted)',
    fontSize: 'var(--fs-label)', fontFamily: 'inherit', cursor: 'pointer',
  },
  roleChipOn: {
    minHeight: 'var(--h-control)', width: 108, padding: '0 var(--sp-3)', borderRadius: 'var(--r-pill)',
    border: '0.5px solid var(--lime)', background: 'var(--lime-bg)', color: 'var(--dark)',
    fontSize: 'var(--fs-label)', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
  },
  // 주 역할은 끌 수 없다 — 눌리지 않는다는 것을 커서로도 알린다
  roleChipPrimary: { cursor: 'default', background: 'var(--lime)', borderColor: 'var(--lime)' },
  masterBadge: { fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: 'var(--dark)', color: 'var(--lime)', marginLeft: 4 },
  statusBadge: { fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 8 },
  actions: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' as const },
  actionBtn: { padding: '4px 10px', border: '0.5px solid var(--line)', borderRadius: 6, cursor: 'pointer', background: '#fff', fontSize: 12, color: 'var(--dark)' },
  suspendBtn: { padding: '4px 10px', border: 'none', borderRadius: 6, cursor: 'pointer', background: 'var(--warnbg)', color: 'var(--warn)', fontSize: 'var(--fs-caption)', fontWeight: 600 },
  activateBtn: { padding: '4px 10px', border: 'none', borderRadius: 6, cursor: 'pointer', background: 'var(--lime-bg)', color: 'var(--dark)', fontSize: 12, fontWeight: 600 },
  deleteBtn: { padding: '4px 10px', border: 'none', borderRadius: 6, cursor: 'pointer', background: 'var(--warn)', color: '#fff', fontSize: 12, fontWeight: 600 },
  deleteBtnDisabled: { padding: '4px 10px', border: 'none', borderRadius: 6, cursor: 'not-allowed', background: 'var(--line)', color: 'var(--muted)', fontSize: 12, fontWeight: 600 },
  cascadeDeleteBtn: { padding: '4px 10px', border: '2px solid var(--warn)', borderRadius: 6, cursor: 'pointer', background: '#fff', color: 'var(--warn)', fontSize: 12, fontWeight: 700 },
  expandCell: { padding: 'var(--sp-3) var(--sp-4)', background: 'var(--card)', borderBottom: '0.5px solid var(--line)' },
  expandHeader: { fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 10 },
  moduleGrid: { display: 'flex', flexWrap: 'wrap' as const, gap: 8 },
  moduleItem: { background: '#fff', border: '0.5px solid var(--line)', borderRadius: 8, padding: '8px 12px', minWidth: 140, display: 'flex', flexDirection: 'column', gap: 3 },
  modName: { fontSize: 12, fontWeight: 600, color: 'var(--dark)' },
  modCode: { fontSize: 10, color: 'var(--muted)' },
  modMeta: { marginBottom: 4 },
  overrideTag: { fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 6, background: 'var(--warnbg)', color: 'var(--warn)' },
  roleTag: { fontSize: 10, color: 'var(--muted)', padding: '1px 0' },
  toggleOn: { ...BTN.smPrimary, background: 'var(--lime)', color: 'var(--dark)', border: 'none', fontWeight: 700 },
  toggleOff: { ...BTN.smSecondary, color: 'var(--muted)' },
  tempPwBox: { background: 'var(--card)', border: '0.5px solid var(--line)', borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 },
  tempPwLabel: { fontSize: 11, fontWeight: 700, color: 'var(--muted)' },
  tempPw: { fontSize: 15, fontWeight: 700, color: 'var(--dark)', fontFamily: 'monospace', letterSpacing: 1 },
  tempPwNote: { fontSize: 11, color: 'var(--warn)' },
  resetResultBox: { display: 'flex', alignItems: 'center', gap: 12, background: 'var(--warnbg)', border: '0.5px solid var(--warn)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, flexWrap: 'wrap' as const },
  resetResultLabel: { fontSize: 12, color: 'var(--warn)' },
  dismissBtn: { padding: '4px 12px', border: 'none', borderRadius: 6, cursor: 'pointer', background: 'var(--warn)', color: '#fff', fontWeight: 700, fontSize: 12 },
}

// 모바일 계정 카드 스타일
const accMob: Record<string, React.CSSProperties> = {
  card: { border: '0.5px solid var(--line)', borderRadius: 12, padding: '14px 16px', background: '#fff', display: 'flex', flexDirection: 'column', gap: 10 },
  cardTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' as const },
  name: { fontSize: 15, fontWeight: 700, color: 'var(--dark)' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 13 },
  label: { color: 'var(--muted)', fontSize: 12, flexShrink: 0, marginRight: 8 },
  value: { fontSize: 12, color: 'var(--body)', textAlign: 'right' as const, wordBreak: 'break-all' as const },
  // 세 칸 격자 — flex 로 늘리면 마지막 줄에 하나만 남았을 때 그 버튼만 줄 전체가 된다
  actions: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 },
}
