import { useEffect, useMemo, useState } from 'react'
import { t, tf } from '../../i18n'
import { fetchOrders } from '../../api/orders'
import { fetchQuotes } from '../../api/quotes'
import { fetchSalesStats, type SalesStat } from '../../api/stats'
import type { ApiOrder, ApiQuote } from '@shared/types/index'
import { buildDashboard } from '../../lib/orderDashboard'
import { shownDate } from '@shared/process/actual'
import { CustomerFolders } from '../CustomerFolders'
import { useEscapeClose } from '../../lib/escClose'
import { BTN } from '../../styles/buttons'

/**
 * **관리자 첫 화면** — 자리(역할 프리셋)에 맞는 카드를 모아 둔 곳(2026-09-16 지시).
 *
 * 위젯처럼 자유롭게 옮기는 판은 아직 만들지 않는다. **무엇이 보이는가**가 먼저이고,
 * 어디에 두는가는 한 달 써 보고 정한다. 그래서 카드는 각자 자기 데이터를 불러오는 **독립된 조각**으로 둔다 —
 * 나중에 격자·배치 저장만 얹으면 그대로 위젯이 된다.
 *
 * 지금은 **영업관리** 한 벌이다(PM·생산관리·경영관리는 다음).
 */
export function AdminDashboard({ onGo }: {
  /** 카드를 눌렀을 때 옮겨 갈 탭 — 대시보드는 요약만 보여 주고 일은 원래 화면에서 한다 */
  onGo: (tab: 'perf' | 'kanban' | 'quotes') => void
}) {
  const [orders, setOrders] = useState<ApiOrder[] | null>(null)
  const [contracted, setContracted] = useState<ApiQuote[] | null>(null)
  const [stats, setStats] = useState<SalesStat[] | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    const from = new Date(); from.setDate(1)
    Promise.all([
      fetchOrders({ board: 'admin' }),
      fetchQuotes({ status: 'contracted' }),
      fetchSalesStats({ from: from.toISOString().slice(0, 10) }).catch(() => [] as SalesStat[]),
    ])
      .then(([o, q, s]) => { if (alive) { setOrders(o); setContracted(q); setStats(s) } })
      .catch(e => { if (alive) setErr(e instanceof Error ? e.message : t('대시보드를 불러오지 못했습니다')) })
    return () => { alive = false }
  }, [])

  return (
    <div style={s.root}>
      {err && <div style={s.err}>{err}</div>}
      <div style={s.grid}>
        <PerfCard stats={stats} onGo={() => onGo('perf')} />
        <ProgressCard orders={orders} contracted={contracted} onGo={() => onGo('kanban')} />
        <AssignRequestCard contracted={contracted} onGo={() => onGo('quotes')} />
        <CustomerSearchCard />
        <CalendarCard orders={orders} />
      </div>
    </div>
  )
}

/** 카드 한 장 — 제목 줄과 본문. 누를 수 있는 카드는 제목 오른쪽에 「열기」 */
function Card({ title, wide, onGo, children }: {
  title: string; wide?: boolean; onGo?: () => void; children: React.ReactNode
}) {
  return (
    <section style={wide ? s.cardWide : s.card}>
      <div style={s.cardHead}>
        <span style={s.cardTitle}>{title}</span>
        {onGo && <button type="button" style={s.go} onClick={onGo}>{t('열기')} ›</button>}
      </div>
      {children}
    </section>
  )
}

const won = (n: number) => `₩${Math.round(n).toLocaleString('ko-KR')}`

/** 이번 달 성과 — 계약·인도 건수와 금액. 자세한 것은 「영업 성과」 탭이 갖는다 */
function PerfCard({ stats, onGo }: { stats: SalesStat[] | null; onGo: () => void }) {
  const sum = useMemo(() => {
    const z = { contracted: 0, completed: 0, contractedAmt: 0, completedAmt: 0, ordered: 0 }
    for (const r of stats ?? []) {
      z.contracted += r.reached.contracted; z.completed += r.reached.completed
      z.ordered += r.reached.ordered
      z.contractedAmt += r.amount.contracted; z.completedAmt += r.amount.completed
    }
    return z
  }, [stats])
  return (
    <Card title={t('이번 달 영업 성과')} onGo={onGo}>
      {!stats ? <div style={s.muted}>{t('불러오는 중…')}</div> : (
        <div style={s.numRow}>
          <Num label={t('계약')} n={sum.contracted} sub={won(sum.contractedAmt)} />
          <Num label={t('주문 진행')} n={sum.ordered} />
          <Num label={t('인도 완료')} n={sum.completed} sub={won(sum.completedAmt)} />
        </div>
      )}
    </Card>
  )
}

function Num({ label, n, sub, tone }: { label: string; n: number; sub?: string; tone?: 'warn' }) {
  return (
    <div style={s.num}>
      <div style={s.numLabel}>{label}</div>
      <div style={tone === 'warn' && n > 0 ? s.numValWarn : s.numVal}>{n}</div>
      {sub && <div style={s.numSub}>{sub}</div>}
    </div>
  )
}

/** 지금 어디까지 왔나 — 「주문 진행」 현황판의 요약 칸과 같은 셈(lib/orderDashboard) */
function ProgressCard({ orders, contracted, onGo }: {
  orders: ApiOrder[] | null; contracted: ApiQuote[] | null; onGo: () => void
}) {
  const dash = useMemo(
    () => (orders && contracted ? buildDashboard(orders, contracted, new Date(), true) : null),
    [orders, contracted],
  )
  return (
    <Card title={t('주문 진행 현황')} wide onGo={onGo}>
      {!dash ? <div style={s.muted}>{t('불러오는 중…')}</div> : (
        <div style={s.numRow}>
          <Num label={t('배정 대기')} n={dash.assign.length} />
          <Num label={t('수락 대기')} n={dash.pending.length} />
          <Num label={t('특장 진행')} n={dash.active.length} />
          <Num label={t('부가작업')} n={dash.addon.length} />
          <Num label={t('인도 완료')} n={dash.done.length} />
          <Num label={t('납기일 경과')} n={dash.late.length} tone="warn" />
        </div>
      )}
    </Card>
  )
}

/** 영업이 아직 「배정 요청」을 누르지 않은 건 — 관리자가 재촉할 자리 */
function AssignRequestCard({ contracted, onGo }: { contracted: ApiQuote[] | null; onGo: () => void }) {
  const waiting = (contracted ?? []).filter(q => !q.assign_requested_at)
  const days = (iso?: string | null) =>
    iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86400000)) : 0
  return (
    <Card title={t('배정 요청 대기')} onGo={onGo}>
      {!contracted ? <div style={s.muted}>{t('불러오는 중…')}</div> : waiting.length === 0 ? (
        <div style={s.muted}>{t('영업의 배정 요청을 기다리는 건이 없습니다.')}</div>
      ) : (
        <>
          <div style={s.numRow}><Num label={t('요청 대기')} n={waiting.length} tone="warn" /></div>
          <ul style={s.list}>
            {waiting.slice(0, 5).map(q => (
              <li key={q.id} style={s.listRow}>
                <span style={s.listNo}>{q.quote_no ?? `#${q.id}`}</span>
                <span style={s.listName}>{q.customer?.name ?? '—'}</span>
                <span style={s.listSub}>{tf('{0}일째', days(q.created_at))}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}

/** 고객 이름으로 그 고객의 모든 것(견적·계약서·서명본·서류)을 한 팝업에서 */
function CustomerSearchCard() {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  return (
    <Card title={t('고객 검색')}>
      <form
        style={s.searchRow}
        onSubmit={e => { e.preventDefault(); if (q.trim()) setOpen(true) }}
      >
        <input
          style={s.search} value={q} maxLength={40} placeholder={t('고객 이름')}
          aria-label={t('고객 이름')} onChange={e => setQ(e.target.value)}
        />
        <button type="submit" style={q.trim() ? BTN.smPrimary : BTN.disabled} disabled={!q.trim()}>{t('검색')}</button>
      </form>
      <div style={s.muted}>{t('견적·계약서·서명본·발주서와 배정 뒤 쌓인 서류를 한자리에서 봅니다.')}</div>
      {open && <FolderModal query={q.trim()} onClose={() => setOpen(false)} />}
    </Card>
  )
}

function FolderModal({ query, onClose }: { query: string; onClose: () => void }) {
  useEscapeClose(onClose)
  return (
    <div style={s.overlay} onClick={ev => { if (ev.target === ev.currentTarget) onClose() }}>
      <div style={s.modal} role="dialog" aria-modal="true" aria-label={t('고객 검색')}>
        <div style={s.modalHead}>
          <span style={s.cardTitle}>{tf('고객 검색 · {0}', query)}</span>
          <button type="button" style={s.close} onClick={onClose} aria-label={t('닫기')}>✕</button>
        </div>
        <div style={s.modalBody}>
          {/* 고객 서류함을 그대로 쓴다 — 두 화면이 다른 것을 보여 주면 안 된다 */}
          <CustomerFolders initialQuery={query} />
        </div>
      </div>
    </div>
  )
}

/* ── 달력 ─────────────────────────────────────────────────────────────── */

type DayMark = { kind: '차량 도착' | '납기' | '고객 인도'; orderId: number; done: boolean }

/**
 * 한 달 달력 — 날짜마다 **차량 도착 · 납기 · 고객 인도**를 찍는다.
 * 예정일은 흐리게, 실제로 끝난 날짜는 진하게(실제 날짜 규칙은 shared/process/actual 과 같다).
 * 눌러서 들어가는 곳은 없다 — 「언제 무엇이 몰리나」를 보는 자리다.
 */
function CalendarCard({ orders }: { orders: ApiOrder[] | null }) {
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d })

  const marks = useMemo(() => {
    const m = new Map<string, DayMark[]>()
    const put = (day: string | null, mark: DayMark) => {
      if (!day) return
      const list = m.get(day); if (list) list.push(mark); else m.set(day, [mark])
    }
    for (const o of orders ?? []) {
      const arrival = shownDate(o.car_arrival_planned_at, o.car_arrived_on)
      put(arrival.value, { kind: '차량 도착', orderId: o.id, done: arrival.tone !== 'planned' && arrival.tone !== 'none' })
      const due = shownDate(o.delivery_due, o.shipped_on)
      put(due.value, { kind: '납기', orderId: o.id, done: !!o.shipped_on })
      const handover = shownDate(o.addon?.target_on, o.addon?.finished ? o.addon.delivered_on : null)
      put(handover.value, { kind: '고객 인도', orderId: o.id, done: !!o.addon?.finished })
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
    <Card title={t('일정')} wide>
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
          const count = (kind: DayMark['kind']) => list.filter(x => x.kind === kind)
          return (
            <div key={day} style={day === today ? s.calDayToday : s.calDay}>
              <div style={s.calNum}>{d}</div>
              {(['차량 도착', '납기', '고객 인도'] as const).map(kind => {
                const hit = count(kind)
                if (hit.length === 0) return null
                const done = hit.filter(x => x.done).length
                const dot = kind === '차량 도착' ? s.dotArrival : kind === '납기' ? s.dotDue : s.dotHandover
                return (
                  <div key={kind} style={done === hit.length ? s.calMarkDone : s.calMark}>
                    <b style={dot} />{hit.length}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

const cardBase: React.CSSProperties = {
  background: '#fff', border: 'var(--hairline)', borderRadius: 'var(--r-md)',
  padding: 'var(--sp-4)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', minWidth: 0,
}

const s: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' },
  // 화면 폭에 맞춰 칸이 늘고 준다 — 격자 배치는 나중에(지금은 무엇이 보이는가가 먼저)
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--sp-3)', alignItems: 'start' },
  card: cardBase,
  cardWide: { ...cardBase, gridColumn: 'span 2', minWidth: 0 },
  cardHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--sp-2)' },
  cardTitle: { fontSize: 'var(--fs-section)', fontWeight: 'var(--fw-section)' as React.CSSProperties['fontWeight'], color: 'var(--dark)' },
  go: { border: 'none', background: 'none', color: 'var(--muted)', fontSize: 'var(--fs-caption)', cursor: 'pointer', fontFamily: 'inherit', padding: 0 },
  numRow: { display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-4)' },
  num: { minWidth: 64 },
  numLabel: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', whiteSpace: 'nowrap' },
  numVal: { fontSize: 26, fontWeight: 700, color: 'var(--dark)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 },
  numValWarn: { fontSize: 26, fontWeight: 700, color: 'var(--req)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 },
  numSub: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' },
  listRow: { display: 'flex', alignItems: 'baseline', gap: 8, padding: '5px 0', borderTop: 'var(--hairline)', fontSize: 'var(--fs-label)' },
  listNo: { fontWeight: 700, color: 'var(--dark)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  listName: { flex: 1, minWidth: 0, color: 'var(--body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  listSub: { color: 'var(--muted)', fontSize: 'var(--fs-caption)', whiteSpace: 'nowrap' },
  searchRow: { display: 'flex', gap: 6 },
  search: {
    flex: 1, minWidth: 0, boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 'var(--fs-input)',
    padding: '6px 8px', border: 'var(--hairline)', borderRadius: 'var(--r-sm)', background: '#fff',
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
  calHead: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' },
  calNav: { border: 'var(--hairline)', background: '#fff', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--dark)' },
  calMonth: { fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--dark)', fontVariantNumeric: 'tabular-nums' },
  legend: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-caption)', color: 'var(--muted)', flexWrap: 'wrap' },
  calGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 3 },
  calDow: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', textAlign: 'center', padding: '2px 0' },
  calEmpty: { minHeight: 56 },
  calDay: { minHeight: 56, border: 'var(--hairline)', borderRadius: 6, padding: '3px 4px', display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 },
  calDayToday: { minHeight: 56, border: '1px solid var(--dark)', borderRadius: 6, padding: '3px 4px', display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 },
  calNum: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' },
  calMark: { display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' },
  calMarkDone: { display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--dark)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
  dotArrival: { width: 6, height: 6, borderRadius: 999, background: 'var(--dark)', display: 'inline-block' },
  dotDue: { width: 6, height: 6, borderRadius: 999, background: 'var(--lime)', display: 'inline-block' },
  dotHandover: { width: 6, height: 6, borderRadius: 999, background: 'var(--alert)', display: 'inline-block' },
}
