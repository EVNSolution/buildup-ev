import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { t, tf } from '../../i18n'
import { fetchOrders } from '../../api/orders'
import { fetchQuotes } from '../../api/quotes'
import { fetchSalesStats, type SalesStat } from '../../api/stats'
import { fetchFolders, type ApiFolderRow } from '../../api/customerFolders'
import type { ApiOrder, ApiQuote } from '@shared/types/index'
import { buildDashboard } from '../../lib/orderDashboard'
import { DASH_STEPS } from '../../lib/salesFunnel'
import { shownDate } from '@shared/process/actual'
import { CustomerFolders } from '../CustomerFolders'
import { useEscapeClose } from '../../lib/escClose'
import { useIsMobile } from '../../hooks/useIsMobile'

/**
 * **관리자 첫 화면** — 자리(역할 프리셋)에 맞는 카드를 모아 둔 곳(2026-09-16 지시).
 *
 * 위젯처럼 자유롭게 옮기는 판은 아직 만들지 않는다. **무엇이 보이는가**가 먼저이고,
 * 어디에 두는가는 한 달 써 보고 정한다. 그래서 카드는 각자 자기 데이터를 불러오는 **독립된 조각**으로 둔다 —
 * 나중에 격자·배치 저장만 얹으면 그대로 위젯이 된다.
 *
 * 배치 규칙(2026-09-16 지시 — 「비어 보이지 않게」):
 *   · 성과·진행 현황·일정은 **한 줄을 통째로** 쓴다. 숫자 칸은 남는 폭을 나눠 가진다
 *   · 목록이 드는 카드(배정 요청·고객 검색)는 **칸 높이를 못 박고 목록만 구른다** —
 *     0건이든 100건이든 카드 크기가 변하면 그 아래가 들썩인다
 *
 * 지금은 **영업관리** 한 벌이다(PM·생산관리·경영관리는 다음).
 */
export function AdminDashboard({ onGo }: {
  /** 카드를 눌렀을 때 옮겨 갈 탭 — 대시보드는 요약만 보여 주고 일은 원래 화면에서 한다 */
  onGo: (tab: 'perf' | 'kanban') => void
}) {
  const isMobile = useIsMobile()
  const [orders, setOrders] = useState<ApiOrder[] | null>(null)
  const [contracted, setContracted] = useState<ApiQuote[] | null>(null)
  const [folders, setFolders] = useState<ApiFolderRow[] | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    Promise.all([
      fetchOrders({ board: 'admin' }),
      fetchQuotes({ status: 'contracted' }),
      fetchFolders().catch(() => [] as ApiFolderRow[]),
    ])
      .then(([o, q, f]) => { if (alive) { setOrders(o); setContracted(q); setFolders(f) } })
      .catch(e => { if (alive) setErr(e instanceof Error ? e.message : t('대시보드를 불러오지 못했습니다')) })
    return () => { alive = false }
  }, [])

  return (
    <div style={s.root}>
      {err && <div style={s.err}>{err}</div>}
      <div style={{ ...s.grid, gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))' }}>
        <PerfCard isMobile={isMobile} onGo={() => onGo('perf')} />
        <ProgressCard orders={orders} contracted={contracted} isMobile={isMobile} onGo={() => onGo('kanban')} />
        <AssignRequestCard contracted={contracted} />
        <CustomerSearchCard folders={folders} />
        <CalendarCard orders={orders} isMobile={isMobile} />
      </div>
    </div>
  )
}

/**
 * 이번 달의 시작일(YYYY-MM-DD).
 * ⚠️ `toISOString()` 을 거치면 안 된다 — UTC 로 바뀌며 한국 새벽에는 **지난달 말일**이 나온다.
 */
function monthStart(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

/**
 * 카드 한 장 — 제목 줄과 본문. 누를 수 있는 카드는 제목 오른쪽에 「열기」.
 *
 * ⚠️ **설명 문구를 달지 않는다**(2026-09-16 지시). 카드마다 한 줄씩 붙이면 제목 줄이
 *    문장으로 뒤덮여, 정작 봐야 할 숫자가 뒤로 밀린다. 설명이 필요할 만큼 헷갈리는 칸이면
 *    이름을 고칠 일이지 옆에 주석을 다는 일이 아니다.
 */
function Card({ title, extra, full, onGo, children }: {
  title: string
  /** 제목 오른쪽에 붙는 조작 — 지금은 성과 카드의 기간 토글뿐이다 */
  extra?: React.ReactNode
  /** 한 줄을 통째로 쓰는 카드 */
  full?: boolean
  onGo?: () => void
  children: React.ReactNode
}) {
  return (
    <section style={full ? s.cardFull : s.card}>
      <div style={s.cardHead}>
        <span style={s.cardTitle}>{title}</span>
        {extra}
        <span style={s.headGap} />
        {onGo && <button type="button" style={s.go} onClick={onGo}>{t('열기')} ›</button>}
      </div>
      {children}
    </section>
  )
}

/** 기간 — 이번 달과 전체를 오가며 본다 */
type Scope = 'month' | 'all'

const won = (n: number) => `₩${Math.round(n).toLocaleString('ko-KR')}`

/**
 * 영업 성과 — **상담고객 › 계약완료 › 주문진행 › 인도완료**(2026-09-16 지시).
 *
 * 계약 앞에 상담고객을 두는 이유는, 계약만 보면 **얼마나 많은 사람을 만났는지**가 사라지기 때문이다.
 * 상담고객은 **명**이고 나머지는 **건**이다 — 한 고객에게 견적을 다섯 번 내도 만난 사람은 하나다.
 *
 * 기간은 **이번 달 / 전체**를 오간다. 이번 달만 보면 「우리가 지금까지 판 것」이 안 보이고,
 * 전체만 보면 이번 달이 되고 있는지 알 수 없다 — 둘 다 필요하고, 한 번 부른 것은 들고 있다가 다시 쓴다.
 *
 * ⚠️ 이 카드가 **자기 것을 직접 부른다.** 기간을 바꾸면 다시 불러야 하는데, 부모가 들고 있으면
 *    부모가 기간을 알아야 한다 — 카드는 독립된 조각으로 둔다(파일 머리말 참조).
 */
function PerfCard({ isMobile, onGo }: { isMobile: boolean; onGo: () => void }) {
  const [scope, setScope] = useState<Scope>('month')
  const [shown, setShown] = useState<SalesStat | null>(null)
  /** 이미 부른 기간은 다시 부르지 않는다 — 토글을 오갈 때마다 기다리게 하지 않는다 */
  const cache = useRef(new Map<Scope, SalesStat>())

  useEffect(() => {
    const hit = cache.current.get(scope)
    if (hit) { setShown(hit); return }
    let alive = true
    setShown(null)
    fetchSalesStats(scope === 'month' ? { from: monthStart() } : {})
      .then(r => { cache.current.set(scope, r.total); if (alive) setShown(r.total) })
      .catch(() => { /* 카드 하나가 안 떠도 나머지는 보여야 한다 */ })
    return () => { alive = false }
  }, [scope])

  const sub = (key: string, st: SalesStat): string => {
    if (key === 'consult') return tf('견적 {0}건', st.reached.draft)
    if (key === 'contracted') return won(st.amount.contracted)
    if (key === 'completed') return won(st.amount.completed)
    return '\u00a0'
  }
  return (
    <Card
      title={t('영업 성과')} full onGo={onGo}
      extra={<ScopeToggle scope={scope} onChange={setScope} />}
    >
      {!shown ? <div style={s.muted}>{t('불러오는 중…')}</div> : (
        <div style={isMobile ? s.perfGridMobile : s.perfRow}>
          {DASH_STEPS.map((step, i) => (
            <Fragment key={step.key}>
              {i > 0 && !isMobile && <div style={s.perfArrow}>›</div>}
              <div style={s.perfCell}>
                <div style={s.numLabel}>{t(step.label)}</div>
                <div style={s.perfVal}>{step.get(shown)}<span style={s.unit}>{t(step.unit)}</span></div>
                <div style={s.numSub}>{sub(step.key, shown)}</div>
              </div>
            </Fragment>
          ))}
        </div>
      )}
    </Card>
  )
}

/** 기간 토글 — 두 칸짜리 스위치. 지금 보고 있는 쪽이 눌린 채로 남는다 */
function ScopeToggle({ scope, onChange }: { scope: Scope; onChange: (v: Scope) => void }) {
  const opts: [Scope, string][] = [['month', '이번 달'], ['all', '전체']]
  return (
    <span style={s.toggle} role="group" aria-label={t('기간')}>
      {opts.map(([key, label]) => (
        <button
          key={key} type="button" aria-pressed={scope === key}
          style={scope === key ? s.toggleOn : s.toggleOff}
          onClick={() => onChange(key)}
        >{t(label)}</button>
      ))}
    </span>
  )
}

/** 지금 어디까지 왔나 — 「주문 진행」 현황판의 요약 칸과 같은 셈(lib/orderDashboard) */
function ProgressCard({ orders, contracted, isMobile, onGo }: {
  orders: ApiOrder[] | null; contracted: ApiQuote[] | null; isMobile: boolean; onGo: () => void
}) {
  const dash = useMemo(
    () => (orders && contracted ? buildDashboard(orders, contracted, new Date(), true) : null),
    [orders, contracted],
  )
  const cells: { label: string; n: number; warn?: boolean }[] = dash ? [
    { label: '배정 대기', n: dash.assign.length },
    { label: '수락 대기', n: dash.pending.length },
    { label: '특장 진행', n: dash.active.length },
    { label: '부가작업', n: dash.addon.length },
    { label: '인도 완료', n: dash.done.length },
    { label: '납기일 경과', n: dash.late.length, warn: true },
  ] : []
  return (
    <Card title={t('주문 진행 현황')} full onGo={onGo}>
      {!dash ? <div style={s.muted}>{t('불러오는 중…')}</div> : (
        // 남는 폭을 여섯 칸이 똑같이 나눈다 — 오른쪽이 비면 「덜 그려졌나」로 읽힌다
        <div style={{ ...s.progressGrid, gridTemplateColumns: isMobile ? 'repeat(3, minmax(0, 1fr))' : 'repeat(6, minmax(0, 1fr))' }}>
          {cells.map(c => (
            <div key={c.label} style={s.progressCell}>
              <div style={s.numLabel}>{t(c.label)}</div>
              <div style={c.warn && c.n > 0 ? s.numValWarn : s.numVal}>{c.n}<span style={s.unit}>{t('건')}</span></div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

/**
 * 영업이 아직 「배정 요청」을 누르지 않은 건.
 *
 * **여기서 할 일은 없다** — 요청은 영업이 누르는 것이라, 관리자는 누구에게 전화할지만 알면 된다(2026-09-16 지시).
 * 그래서 「열기」도 없고, 대신 담당 영업을 나란히 적는다.
 * 칸 높이는 못 박고 목록만 구른다 — 0건일 때와 100건일 때 카드 크기가 달라지면 아래가 들썩인다.
 */
function AssignRequestCard({ contracted }: { contracted: ApiQuote[] | null }) {
  const waiting = (contracted ?? []).filter(q => !q.assign_requested_at)
  const days = (iso?: string | null) =>
    iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86400000)) : 0
  return (
    <Card title={t('배정 요청 대기')}>
      <div style={s.headline}>
        <span style={waiting.length > 0 ? s.numValWarn : s.numVal}>{waiting.length}<span style={s.unit}>{t('건')}</span></span>
      </div>
      <div style={s.pane}>
        {!contracted ? <div style={s.muted}>{t('불러오는 중…')}</div>
          : waiting.length === 0 ? <div style={s.muted}>{t('영업의 배정 요청을 기다리는 건이 없습니다.')}</div> : (
            <ul style={s.list}>
              {/* 오래 묵은 것부터 — 먼저 전화할 순서 */}
              {[...waiting].sort((a, b) => days(b.created_at) - days(a.created_at)).map(q => (
                <li key={q.id} style={s.listRow}>
                  <span style={s.listNo}>{q.quote_no ?? `#${q.id}`}</span>
                  <span style={s.listName}>{q.customer?.name ?? '—'}</span>
                  <span style={s.listOwner}>{q.sales_user_id ?? '—'}</span>
                  <span style={s.listSub}>{tf('{0}일째', days(q.created_at))}</span>
                </li>
              ))}
            </ul>
          )}
      </div>
    </Card>
  )
}

/**
 * 고객 이름으로 그 고객의 모든 것(견적·계약서·서명본·서류)을 한 팝업에서.
 *
 * 치는 동안 **DB 에 있는 고객이 아래로 뜨고 거기서 고른다**(2026-09-16 지시) —
 * 이름을 정확히 기억하지 못해도 되고, 없는 사람을 찾다 헛수고하지 않는다.
 */
function CustomerSearchCard({ folders }: { folders: ApiFolderRow[] | null }) {
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<ApiFolderRow | null>(null)
  const hits = useMemo(() => {
    const k = q.trim().toLowerCase()
    const rows = folders ?? []
    if (!k) return rows                       // 안 쳤으면 최근 순 그대로 — 빈 칸을 남기지 않는다
    return rows.filter(r => [r.name, r.phone, r.reg_no].some(v => (v ?? '').toLowerCase().includes(k)))
  }, [folders, q])

  return (
    <Card title={t('고객 검색')} extra={folders ? <span style={s.headCount}>{tf('{0}명', hits.length)}</span> : null}>
      <div style={s.headline}>
        <input
          style={s.search} value={q} maxLength={40} type="search"
          placeholder={t('고객명 · 연락처 · 생년월일/사업자번호')}
          aria-label={t('고객 검색')} onChange={e => setQ(e.target.value)}
        />
      </div>
      <div style={s.pane}>
        {!folders ? <div style={s.muted}>{t('불러오는 중…')}</div>
          : hits.length === 0 ? <div style={s.muted}>{t('해당하는 고객이 없습니다.')}</div> : (
            <ul style={s.list}>
              {hits.map(r => (
                <li key={r.key}>
                  <button type="button" style={s.hitRow} onClick={() => setPicked(r)}>
                    <span style={s.listName}>{r.name}</span>
                    <span style={s.listOwner}>{r.reg_no ?? r.phone ?? '—'}</span>
                    <span style={s.listSub}>{tf('{0}건', r.quotes)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
      </div>
      {picked && <FolderModal row={picked} onClose={() => setPicked(null)} />}
    </Card>
  )
}

function FolderModal({ row, onClose }: { row: ApiFolderRow; onClose: () => void }) {
  return (
    <Modal label={t('고객 검색')} title={row.name} onClose={onClose}>
      {/* 고객 서류함을 그대로 쓴다 — 두 화면이 다른 것을 보여 주면 안 된다 */}
      <CustomerFolders initialQuery={row.name} initialOpenKey={row.key} />
    </Modal>
  )
}

/** 팝업 한 벌 — 고객 서류함과 날짜별 일정이 같은 틀을 쓴다 */
function Modal({ label, title, onClose, children }: {
  label: string; title: string; onClose: () => void; children: React.ReactNode
}) {
  useEscapeClose(onClose)
  return (
    <div style={s.overlay} onClick={ev => { if (ev.target === ev.currentTarget) onClose() }}>
      <div style={s.modal} role="dialog" aria-modal="true" aria-label={label}>
        <div style={s.modalHead}>
          <span style={s.cardTitle}>{title}</span>
          <button type="button" style={s.close} onClick={onClose} aria-label={t('닫기')}>✕</button>
        </div>
        <div style={s.modalBody}>{children}</div>
      </div>
    </div>
  )
}

/* ── 달력 ─────────────────────────────────────────────────────────────── */

const CAL_KINDS = ['차량 도착', '납기', '고객 인도'] as const
type CalKind = (typeof CAL_KINDS)[number]
type DayMark = { kind: CalKind; orderId: number; name: string; done: boolean }

/**
 * 한 달 달력 — 날짜마다 **차량 도착 · 납기 · 고객 인도**를 찍는다.
 * 예정일은 흐리게, 실제로 끝난 날짜는 진하게(실제 날짜 규칙은 shared/process/actual 과 같다).
 *
 * 날짜를 누르면 그날 것을 **항목별로 갈라 고객명까지** 보여 준다(2026-09-16 지시) —
 * 「이 날 세 건」만으로는 누구에게 전화할지 알 수 없다.
 */
function CalendarCard({ orders, isMobile }: { orders: ApiOrder[] | null; isMobile: boolean }) {
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d })
  const [openDay, setOpenDay] = useState<string | null>(null)

  const marks = useMemo(() => {
    const m = new Map<string, DayMark[]>()
    const put = (day: string | null, mark: DayMark) => {
      if (!day) return
      const list = m.get(day); if (list) list.push(mark); else m.set(day, [mark])
    }
    for (const o of orders ?? []) {
      const name = o.quote.customer?.name ?? '—'
      const arrival = shownDate(o.car_arrival_planned_at, o.car_arrived_on)
      put(arrival.value, { kind: '차량 도착', orderId: o.id, name, done: !!o.car_arrived_on })
      const due = shownDate(o.delivery_due, o.shipped_on)
      put(due.value, { kind: '납기', orderId: o.id, name, done: !!o.shipped_on })
      const handover = shownDate(o.addon?.target_on, o.addon?.finished ? o.addon.delivered_on : null)
      put(handover.value, { kind: '고객 인도', orderId: o.id, name, done: !!o.addon?.finished })
    }
    return m
  }, [orders])

  const first = new Date(month)
  const pad = first.getDay()
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells: (number | null)[] = [...Array(pad).fill(null), ...Array.from({ length: last }, (_, i) => i + 1)]
  const key = (d: number) => `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const today = new Date().toISOString().slice(0, 10)
  const move = (n: number) => setMonth(m => new Date(m.getFullYear(), m.getMonth() + n, 1))

  return (
    <Card title={t('일정')} full>
      <div style={s.calHead}>
        <button type="button" style={s.calNav} onClick={() => move(-1)} aria-label={t('지난달')}>‹</button>
        <span style={s.calMonth}>{tf('{0}년 {1}월', month.getFullYear(), month.getMonth() + 1)}</span>
        <button type="button" style={s.calNav} onClick={() => move(1)} aria-label={t('다음달')}>›</button>
        <span style={s.legend}>
          <b style={s.dotArrival} /> {t('차량 도착')}
          <b style={s.dotDue} /> {t('납기')}
          <b style={s.dotHandover} /> {t('고객 인도')}
        </span>
      </div>
      <div style={s.calGrid}>
        {['일', '월', '화', '수', '목', '금', '토'].map(d => <div key={d} style={s.calDow}>{t(d)}</div>)}
        {cells.map((d, i) => {
          if (d === null) return <div key={`p${i}`} style={s.calEmpty} />
          const day = key(d)
          const list = marks.get(day) ?? []
          return (
            <button
              key={day} type="button" disabled={list.length === 0}
              style={day === today ? s.calDayToday : list.length > 0 ? s.calDay : s.calDayIdle}
              onClick={() => setOpenDay(day)}
              aria-label={tf('{0} 일정 {1}건', day, list.length)}
            >
              <div style={s.calNum}>{d}</div>
              {CAL_KINDS.map(kind => {
                const hit = list.filter(x => x.kind === kind)
                if (hit.length === 0) return null
                const done = hit.filter(x => x.done).length
                const dot = kind === '차량 도착' ? s.dotArrival : kind === '납기' ? s.dotDue : s.dotHandover
                return (
                  <div key={kind} style={done === hit.length ? s.calMarkDone : s.calMark}>
                    <b style={dot} />{hit.length}
                  </div>
                )
              })}
            </button>
          )
        })}
      </div>
      {openDay && (
        <DayModal day={openDay} list={marks.get(openDay) ?? []} isMobile={isMobile} onClose={() => setOpenDay(null)} />
      )}
    </Card>
  )
}

/**
 * 하루치 — **항목을 가로로, 고객명을 세로로** 내린다(2026-09-16 지시).
 * 끝난 것은 진하게 ✓ 를 붙인다. 예정과 끝난 것을 같은 줄에 섞어 두면 무엇이 남았는지 못 읽는다.
 */
function DayModal({ day, list, isMobile, onClose }: {
  day: string; list: DayMark[]; isMobile: boolean; onClose: () => void
}) {
  return (
    <Modal label={t('일정')} title={tf('{0} 일정', day)} onClose={onClose}>
      <div style={{ ...s.dayGrid, gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0, 1fr))' }}>
        {CAL_KINDS.map(kind => {
          const hit = list.filter(x => x.kind === kind)
          const dot = kind === '차량 도착' ? s.dotArrival : kind === '납기' ? s.dotDue : s.dotHandover
          return (
            <div key={kind} style={s.dayCol}>
              <div style={s.dayColHead}>
                <b style={dot} /> {t(kind)} <span style={s.dayCount}>{hit.length}</span>
              </div>
              {hit.length === 0 ? <div style={s.muted}>—</div> : (
                <ul style={s.list}>
                  {hit.map(m => (
                    <li key={`${m.kind}-${m.orderId}`} style={m.done ? s.dayRowDone : s.dayRow}>
                      <span style={s.listName}>{m.name}</span>
                      <span style={s.listSub}>{m.done ? `✓ ${t('완료')}` : t('예정')}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

const cardBase: React.CSSProperties = {
  background: '#fff', border: 'var(--hairline)', borderRadius: 'var(--r-md)',
  padding: 'var(--sp-4)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', minWidth: 0,
}
/** 목록이 드는 칸 — **높이를 못 박는다.** 0건이든 100건이든 카드 크기가 같아야 아래가 안 들썩인다 */
const paneBase: React.CSSProperties = {
  height: 208, overflowY: 'auto', borderTop: 'var(--hairline)', paddingTop: 4, minWidth: 0,
}

const s: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' },
  grid: { display: 'grid', gap: 'var(--sp-3)', alignItems: 'start' },
  card: cardBase,
  cardFull: { ...cardBase, gridColumn: '1 / -1' },
  cardHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--sp-2)', flexWrap: 'wrap' },
  cardTitle: { fontSize: 'var(--fs-section)', fontWeight: 'var(--fw-section)' as React.CSSProperties['fontWeight'], color: 'var(--dark)' },
  headGap: { marginRight: 'auto' },
  headCount: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' },
  toggle: { display: 'inline-flex', border: 'var(--hairline)', borderRadius: 999, overflow: 'hidden', background: '#fff' },
  toggleOn: { border: 'none', background: 'var(--dark)', color: '#fff', fontFamily: 'inherit', fontSize: 'var(--fs-caption)', padding: '3px 11px', cursor: 'pointer' },
  toggleOff: { border: 'none', background: 'none', color: 'var(--muted)', fontFamily: 'inherit', fontSize: 'var(--fs-caption)', padding: '3px 11px', cursor: 'pointer' },
  go: { border: 'none', background: 'none', color: 'var(--muted)', fontSize: 'var(--fs-caption)', cursor: 'pointer', fontFamily: 'inherit', padding: 0 },

  // 성과 — 한 줄을 가득 채우고 칸 사이에 꺾쇠를 둔다
  perfRow: { display: 'flex', alignItems: 'stretch', gap: 'var(--sp-2)' },
  perfGridMobile: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--sp-3)' },
  perfCell: { flex: 1, minWidth: 0 },
  perfArrow: { alignSelf: 'center', color: 'var(--muted)', fontSize: 20, lineHeight: 1 },
  perfVal: { fontSize: 30, fontWeight: 700, color: 'var(--dark)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 },

  progressGrid: { display: 'grid', gap: 'var(--sp-2)' },
  progressCell: { minWidth: 0 },

  numLabel: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  numVal: { fontSize: 26, fontWeight: 700, color: 'var(--dark)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 },
  numValWarn: { fontSize: 26, fontWeight: 700, color: 'var(--req)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 },
  numSub: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  // 단위(명·건)는 숫자보다 작게 — 없으면 「고객 3」과 「계약 3」이 같은 것으로 읽힌다
  unit: { fontSize: '0.5em', fontWeight: 400, color: 'var(--muted)', marginLeft: 2 },

  headline: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', minHeight: 36 },
  pane: paneBase,
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' },
  listRow: { display: 'flex', alignItems: 'baseline', gap: 8, padding: '5px 0', borderBottom: 'var(--hairline)', fontSize: 'var(--fs-label)' },
  listNo: { fontWeight: 700, color: 'var(--dark)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  listName: { flex: 1, minWidth: 0, color: 'var(--body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' },
  listOwner: { color: 'var(--muted)', fontSize: 'var(--fs-caption)', maxWidth: '40%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  listSub: { color: 'var(--muted)', fontSize: 'var(--fs-caption)', whiteSpace: 'nowrap' },
  hitRow: {
    display: 'flex', alignItems: 'baseline', gap: 8, padding: '6px 2px', width: '100%',
    border: 'none', borderBottom: 'var(--hairline)', background: 'none', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 'var(--fs-label)', textAlign: 'left',
  },
  search: {
    flex: 1, minWidth: 0, boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 'var(--fs-input)',
    padding: '7px 9px', border: 'var(--hairline)', borderRadius: 'var(--r-sm)', background: '#fff',
  },
  muted: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', lineHeight: 1.6 },
  err: { fontSize: 'var(--fs-label)', color: 'var(--warn)' },

  overlay: {
    position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--sp-4)',
  },
  modal: {
    background: '#fff', borderRadius: 12, width: 'min(900px, 96vw)', maxHeight: '90vh',
    display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(22,24,15,.22)',
  },
  modalHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--sp-4)', borderBottom: 'var(--hairline)' },
  modalBody: { overflowY: 'auto', padding: 'var(--sp-4)' },
  close: { border: 'none', background: 'none', fontSize: 16, color: 'var(--muted)', cursor: 'pointer', width: 36, height: 36 },

  dayGrid: { display: 'grid', gap: 'var(--sp-4)' },
  dayCol: { minWidth: 0 },
  dayColHead: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-label)', fontWeight: 700, color: 'var(--dark)', paddingBottom: 4, borderBottom: '1px solid var(--dark)' },
  dayCount: { marginLeft: 'auto', color: 'var(--muted)', fontWeight: 400, fontVariantNumeric: 'tabular-nums' },
  dayRow: { display: 'flex', alignItems: 'baseline', gap: 8, padding: '6px 0', borderBottom: 'var(--hairline)', fontSize: 'var(--fs-label)', color: 'var(--body)' },
  dayRowDone: { display: 'flex', alignItems: 'baseline', gap: 8, padding: '6px 0', borderBottom: 'var(--hairline)', fontSize: 'var(--fs-label)', color: 'var(--dark)', fontWeight: 700 },

  calHead: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' },
  calNav: { border: 'var(--hairline)', background: '#fff', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--dark)' },
  calMonth: { fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--dark)', fontVariantNumeric: 'tabular-nums' },
  legend: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-caption)', color: 'var(--muted)', flexWrap: 'wrap' },
  calGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 3 },
  calDow: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', textAlign: 'center', padding: '2px 0' },
  calEmpty: { minHeight: 56 },
  calDay: { minHeight: 56, border: 'var(--hairline)', borderRadius: 6, padding: '3px 4px', display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', alignItems: 'stretch' },
  calDayIdle: { minHeight: 56, border: 'var(--hairline)', borderRadius: 6, padding: '3px 4px', display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, background: '#fff', cursor: 'default', fontFamily: 'inherit', alignItems: 'stretch' },
  calDayToday: { minHeight: 56, border: '1px solid var(--dark)', borderRadius: 6, padding: '3px 4px', display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', alignItems: 'stretch' },
  calNum: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums', textAlign: 'left' },
  calMark: { display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' },
  calMarkDone: { display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--dark)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
  dotArrival: { width: 6, height: 6, borderRadius: 999, background: 'var(--dark)', display: 'inline-block' },
  dotDue: { width: 6, height: 6, borderRadius: 999, background: 'var(--lime)', display: 'inline-block' },
  dotHandover: { width: 6, height: 6, borderRadius: 999, background: 'var(--alert)', display: 'inline-block' },
}
