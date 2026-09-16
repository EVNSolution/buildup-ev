import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { t, tf } from '../../i18n'
import { fetchOrders } from '../../api/orders'
import { fetchQuotes } from '../../api/quotes'
import { fetchSalesStats, type SalesStat } from '../../api/stats'
import { fetchFolders, type ApiFolderRow } from '../../api/customerFolders'
import { fetchPnlSummary, type PnlSummary, type PnlTotals } from '../../api/pnl'
import type { ApiOrder, ApiQuote } from '@shared/types/index'
import { buildDashboard } from '../../lib/orderDashboard'
import { DASH_STEPS } from '../../lib/salesFunnel'
import { shownDate } from '@shared/process/actual'
import { dueInfo } from '@shared/process/due'
import { CustomerFolders } from '../CustomerFolders'
import { useEscapeClose } from '../../lib/escClose'
import { useIsMobile } from '../../hooks/useIsMobile'
import { usePermission } from '../PermGate'
import { useAuth } from '../../contexts/AuthContext'

/**
 * **관리자 첫 화면(마이페이지)** — 자리(역할 프리셋)마다 다른 카드 묶음(2026-09-16 지시).
 *
 * 위젯처럼 자유롭게 옮기는 판은 아직 만들지 않는다. **무엇이 보이는가**가 먼저이고,
 * 어디에 두는가는 한 달 써 보고 정한다. 그래서 카드는 각자 자기 데이터를 불러오는 **독립된 조각**으로 둔다 —
 * 나중에 격자·배치 저장만 얹으면 그대로 위젯이 된다.
 *
 * ── 누가 어느 마이페이지를 보는가(2026-09-16 지시) ──────────────────────────
 *   · **마스터** — 전부 본다. 위에서 골라 가며 본다(자리마다 무엇이 보이는지 확인해야 하니까)
 *   · **그 외** — 프리셋이 **지정된 경우에만**, 그 자리의 마이페이지 하나
 *   · 프리셋 미지정이면 마이페이지 자체가 없다 — 탭도 안 뜬다(AdminPage 가 `dashboardsFor` 로 가린다)
 *
 * 카드마다 권한을 한 번 더 본다. 프리셋 구성은 기능모듈 화면에서 고칠 수 있어,
 * 「자리에 딸린 카드」와 **실제로 가진 권한**이 갈릴 수 있기 때문이다.
 *
 * 배치 규칙(「비어 보이지 않게」):
 *   · 성과·진행 현황·일정은 **한 줄을 통째로** 쓴다. 숫자 칸은 남는 폭을 나눠 가진다
 *   · 목록이 드는 카드는 **칸 높이를 못 박고 목록만 구른다** — 0건이든 100건이든 카드 크기가 같아야 아래가 안 들썩인다
 */
type CardKey = 'perf' | 'progress' | 'assignRequest' | 'assignQueue' | 'late' | 'customer' | 'calendar' | 'pnl'

export interface DashboardDef {
  /** 역할 프리셋 코드(shared/rbac/presets) */
  code: string
  label: string
  cards: CardKey[]
}

/**
 * 자리별 카드 묶음.
 *
 * ⚠️ PM 은 아직 없다 — 자리는 있지만 마이페이지를 안 만들었다. 빈 판을 띄우느니 탭을 안 보이는 편이 낫다.
 */
export const DASHBOARDS: DashboardDef[] = [
  // 영업을 굴린다 — 성과와 고객, 그리고 영업이 요청을 안 눌러 멈춘 건
  { code: 'sales_mgr', label: '영업관리', cards: ['perf', 'progress', 'assignRequest', 'customer', 'calendar'] },
  // 제작을 굴린다 — 지금 배정할 건과 납기가 급한 건. 성과·고객은 이 자리의 일이 아니다
  { code: 'prod_mgr', label: '생산관리', cards: ['progress', 'assignQueue', 'late', 'calendar'] },
  // 숫자를 본다 — 성과와 손익. 손대는 카드(배정·고객 서류)는 넣지 않는다.
  // 손익만은 **직접 적는 자리**라(세금계산서 발행일·입금·원가) 할 일 수를 앞에 둔다
  { code: 'exec', label: '경영관리', cards: ['perf', 'pnl', 'progress', 'calendar'] },
]

/** 이 계정이 볼 수 있는 마이페이지들 — 마스터는 전부, 나머지는 지정된 프리셋 하나(없으면 빈 목록) */
export function dashboardsFor(user: { is_master?: boolean; admin_preset?: string | null } | undefined): DashboardDef[] {
  if (!user) return []
  if (user.is_master) return DASHBOARDS
  return DASHBOARDS.filter(d => d.code === user.admin_preset)
}

export function AdminDashboard({ onGo }: {
  /** 카드를 눌렀을 때 옮겨 갈 탭 — 대시보드는 요약만 보여 주고 일은 원래 화면에서 한다 */
  onGo: (tab: 'perf' | 'kanban' | 'pnl') => void
}) {
  const isMobile = useIsMobile()
  const { session } = useAuth()
  const boards = dashboardsFor(session?.user)
  const [pick, setPick] = useState(0)
  const board = boards[Math.min(pick, Math.max(0, boards.length - 1))]

  const [orders, setOrders] = useState<ApiOrder[] | null>(null)
  const [contracted, setContracted] = useState<ApiQuote[] | null>(null)
  const [folders, setFolders] = useState<ApiFolderRow[] | null>(null)
  const [err, setErr] = useState('')

  // 카드마다 권한을 한 번 더 본다 — 훅은 조건 없이 늘 부른다(호출 순서가 바뀌면 안 된다)
  const canPerf = usePermission('stats.own')
  const canOrders = usePermission('order.view')
  const canAssign = usePermission('order.confirm')
  const canCustomer = usePermission('customer.view')
  const canPnl = usePermission('pnl.view')
  const shows = (key: CardKey): boolean => {
    if (!board?.cards.includes(key)) return false
    if (key === 'perf') return canPerf
    if (key === 'pnl') return canPnl
    if (key === 'customer') return canCustomer
    if (key === 'assignRequest' || key === 'assignQueue') return canAssign
    return canOrders
  }

  // 쓰지 않을 데이터는 부르지 않는다 — 경영관리에게 고객 서류함을 부르면 권한 밖을 두드리는 꼴이다
  const needOrders = (['progress', 'calendar', 'assignQueue', 'late'] as CardKey[]).some(shows)
  const needContracted = needOrders || shows('assignRequest')
  const needFolders = shows('customer')

  useEffect(() => {
    let alive = true
    Promise.all([
      needOrders ? fetchOrders({ board: 'admin' }) : Promise.resolve([] as ApiOrder[]),
      needContracted ? fetchQuotes({ status: 'contracted' }) : Promise.resolve([] as ApiQuote[]),
      needFolders ? fetchFolders().catch(() => [] as ApiFolderRow[]) : Promise.resolve([] as ApiFolderRow[]),
    ])
      .then(([o, q, f]) => { if (alive) { setOrders(o); setContracted(q); setFolders(f) } })
      .catch(e => { if (alive) setErr(e instanceof Error ? e.message : t('대시보드를 불러오지 못했습니다')) })
    return () => { alive = false }
  }, [needOrders, needContracted, needFolders])

  if (!board) return null

  return (
    <div style={s.root}>
      {/* 마스터만 여럿을 갖는다 — 하나뿐이면 고를 것이 없으니 줄을 안 그린다 */}
      {boards.length > 1 && (
        <div style={s.boardBar} role="group" aria-label={t('마이페이지')}>
          {boards.map((b, i) => (
            <button
              key={b.code} type="button" aria-pressed={i === pick}
              style={i === pick ? s.toggleOn : s.toggleOff}
              onClick={() => setPick(i)}
            >{t(b.label)}</button>
          ))}
        </div>
      )}
      {err && <div style={s.err}>{err}</div>}
      <div style={{ ...s.grid, gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))' }}>
        {/*
          ⚠️ **열쇠를 못 박는다.** 판(영업관리·생산관리·경영관리)마다 카드 묶음이 달라, 열쇠가 없으면
             React 가 자리로 짝을 맞춘다 — 같은 카드인데 자리가 달라졌다는 이유로 **다시 만들어져**
             빈 채로 떴다가 채워진다. 판을 바꿀 때 화면이 일그러지던 원인이다(제보).
        */}
        {shows('perf') && <PerfCard key="perf" isMobile={isMobile} onGo={() => onGo('perf')} />}
        {shows('pnl') && <PnlCard key="pnl" isMobile={isMobile} onGo={() => onGo('pnl')} />}
        {shows('progress') && <ProgressCard key="progress" orders={orders} contracted={contracted} isMobile={isMobile} onGo={() => onGo('kanban')} />}
        {shows('assignQueue') && <AssignQueueCard key="assignQueue" orders={orders} contracted={contracted} onGo={() => onGo('kanban')} />}
        {shows('assignRequest') && <AssignRequestCard key="assignRequest" contracted={contracted} />}
        {shows('late') && <LateCard key="late" orders={orders} contracted={contracted} onGo={() => onGo('kanban')} />}
        {shows('customer') && <CustomerSearchCard key="customer" folders={folders} />}
        {shows('calendar') && <CalendarCard key="calendar" orders={orders} isMobile={isMobile} />}
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
 * 값이 오기 전의 **자리표** — 이름은 그대로 두고 숫자만 「—」로 둔다.
 *
 * 높이를 숫자로 짐작해 맞추면(minHeight) 화면 폭마다 어긋난다 — 휴대폰에서는 칸이 접혀 키가 달라진다.
 * **같은 뼈대를 그리는 것**만이 어느 폭에서든 정확히 같은 자리를 차지한다.
 * 그래야 값이 들어올 때 카드가 커지지 않고, 아래 카드들이 밀려 올라갔다 내려오지 않는다(제보).
 */
const skeleton = (tiles: Tile[]): Tile[] =>
  tiles.map(x => ({ ...x, n: 0, unit: '', text: '—', warn: false, profit: false, sub: x.sub === undefined ? undefined : '\u00a0' }))

/** 빈 값 — 자리표를 그릴 때만 쓴다(숫자는 어차피 「—」로 덮인다) */
const BLANK_SALES = {
  sales_user_id: '', reached: {}, customers: {}, amount: { confirmed: 0, contracted: 0, completed: 0 },
  activity: { quotes: 0, emailed: 0, sign_requested: 0, edits: 0 },
} as unknown as SalesStat
const BLANK_TOTALS = { count: 0, supply_amount: 0, vat: 0, gross: 0, deposit: 0, capital: 0, pay_diff: 0, cost: 0, profit: 0, margin: null } as PnlTotals
const BLANK_DASH = { assign: [], pending: [], active: [], addon: [], done: [], late: [] } as unknown as ReturnType<typeof buildDashboard>

/**
 * 카드 한 장 — 제목 줄과 본문. 누를 수 있는 카드는 제목 오른쪽에 「열기」.
 *
 * ⚠️ **설명 문구를 달지 않는다**(2026-09-16 지시). 카드마다 한 줄씩 붙이면 제목 줄이
 *    문장으로 뒤덮여, 정작 봐야 할 숫자가 뒤로 밀린다. 설명이 필요할 만큼 헷갈리는 칸이면
 *    이름을 고칠 일이지 옆에 주석을 다는 일이 아니다.
 */
function Card({ title, extra, full, onGo, children }: {
  title: string
  /**
   * 카드의 조작·곁수치(기간 토글·건수) — **오른쪽 끝, 「열기」 바로 왼쪽**에 붙는다.
   *
   * ⚠️ 제목 옆에 두면 **카드마다 자리가 달라진다** — 「영업 성과」와 「손익」은 제목 길이가 달라
   *    토글이 좌우로 어긋나 보였다(제보). 오른쪽에 붙이면 제목이 몇 글자든 늘 같은 자리다.
   *    앞으로 붙는 카드도 이 자리를 쓴다.
   */
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
        <span style={s.headGap} />
        {extra}
        {onGo && <button type="button" style={s.go} onClick={onGo}>{t('열기')} ›</button>}
      </div>
      {children}
    </section>
  )
}

/** 기간 — 이번 달과 전체를 오가며 본다 */
type Scope = 'month' | 'all'

const won = (n: number) => `₩${Math.round(n).toLocaleString('ko-KR')}`


/** 칸 하나 — 이름 · 큰 숫자 · (있으면) 아래 한 줄 */
interface Tile {
  key: string
  label: string
  n: number
  /** 명 · 건 */
  unit: string
  /** 숫자 대신 적을 글자(금액·비율처럼 수로 못 적는 것). 있으면 이쪽을 쓴다 */
  text?: string
  /** 결론 숫자 — 브랜드 라임으로 키운다(컨피규레이터 실구매가와 같은 색) */
  profit?: boolean
  /** 숫자 아래 한 줄(금액·건수). 자리를 비워도 줄 높이는 지킨다 */
  sub?: string
  warn?: boolean
  /**
   * 앞 칸과 이 칸 사이에 무엇을 둘지.
   *   arrow   = 이어지는 단계(상담 → 계약 → 주문 → 인도)
   *   divider = 성격이 다른 칸(납기일 경과는 「다음 단계」가 아니라 경보다)
   */
  sep?: 'arrow' | 'divider'
}

/**
 * 칸을 한 줄로 늘어놓는다 — **꺾쇠는 칸과 칸 사이 정가운데, 숫자 줄 높이에 맞춘다.**
 *
 * 예전에는 flex 로 늘어놓고 꺾쇠를 `alignSelf: center` 로 뒀다. 그러면 꺾쇠가
 * 「이름 + 숫자 + 아래 줄」 전체의 한가운데에 서서, 정작 맞춰야 할 **숫자 줄과 어긋났다**(제보).
 * 그래서 격자로 바꾸고 줄(이름/숫자/아래)과 칸을 좌표로 못 박는다 — 꺾쇠는 숫자 줄에만 놓인다.
 */
function TileRow({ tiles, isMobile, mobileCols, big, small }: {
  tiles: Tile[]; isMobile: boolean; mobileCols: number
  /** 첫 카드(영업 성과) — 한 단계 크게 */
  big?: boolean
  /** 금액이 섞인 줄 — **한 단계 작게.** 자릿수가 길어 큰 글씨로는 칸끼리 붙어 읽힌다(제보) */
  small?: boolean
}) {
  // ⚠️ 칸 변수를 t 로 두지 말 것 — 번역 함수 t() 를 가려 그 블록만 한국어가 남는다
  // 글자로 적는 칸(금액·비율)은 셀 수가 없다 — 경고는 「0보다 큰가」가 아니라 **경고로 표시했는가**로 본다
  const numStyle = (x: Tile) => {
    const base = x.warn && (x.text !== undefined || x.n > 0) ? s.numValWarn
      : x.profit ? (big ? s.perfValProfit : s.numValProfit)
        : big ? s.perfVal : s.numVal
    return small ? { ...base, ...s.smNum } : base
  }
  const value = (x: Tile) => (x.text !== undefined
    ? <span style={small ? s.tileTextSm : s.tileText}>{x.text}</span>
    : <>{x.n}<span style={s.unit}>{t(x.unit)}</span></>)

  if (isMobile) {
    return (
      <div style={{ ...s.tilesMobile, gridTemplateColumns: `repeat(${mobileCols}, minmax(0, 1fr))` }}>
        {tiles.map(x => (
          <div key={x.key} style={s.tileCell}>
            <div style={s.numLabel}>{t(x.label)}</div>
            <div style={numStyle(x)}>{value(x)}</div>
            {x.sub !== undefined && <div style={s.numSub}>{x.sub}</div>}
          </div>
        ))}
      </div>
    )
  }
  // '1fr auto 1fr auto …' — 홀수 칸이 내용, 짝수 칸이 칸 사이
  const cols = tiles.map(() => '1fr').join(' auto ')
  return (
    <div style={{ ...s.tilesRow, gridTemplateColumns: cols }}>
      {tiles.map((x, i) => (
        <Fragment key={x.key}>
          {i > 0 && x.sep === 'arrow' && <div style={{ ...s.sepArrow, gridColumn: i * 2 }}>›</div>}
          {i > 0 && x.sep === 'divider' && <div style={{ ...s.sepLine, gridColumn: i * 2 }} />}
          {/* 가운데 정렬이라야 꺾쇠가 **두 숫자의 정확히 한가운데**에 선다 — 왼쪽으로 붙이면
              칸마다 글자 너비가 달라 꺾쇠가 뒷 숫자에 딸려 붙은 것처럼 보인다(제보) */}
          <div style={{ ...s.numLabel, ...s.mid, gridColumn: i * 2 + 1, gridRow: 1 }}>{t(x.label)}</div>
          <div style={{ ...numStyle(x), ...s.mid, gridColumn: i * 2 + 1, gridRow: 2 }}>{value(x)}</div>
          <div style={{ ...s.numSub, ...s.mid, gridColumn: i * 2 + 1, gridRow: 3 }}>{x.sub ?? ''}</div>
        </Fragment>
      ))}
    </div>
  )
}

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
  const [busy, setBusy] = useState(false)
  /** 이미 부른 기간은 다시 부르지 않는다 — 토글을 오갈 때마다 기다리게 하지 않는다 */
  const cache = useRef(new Map<Scope, SalesStat>())

  useEffect(() => {
    const hit = cache.current.get(scope)
    if (hit) { setShown(hit); return }
    let alive = true
    /*
     * ⚠️ **앞의 숫자를 지우지 않는다**(제보: 토글을 누르면 화면이 순간 일그러진다).
     *    지우면 카드 속이 「불러오는 중」 한 줄로 줄었다가 도로 커지는데, 그 한 번의 들썩임에
     *    아래 카드들이 통째로 밀려 올라갔다 내려온다. 새 숫자가 올 때까지 옛 숫자를 그대로 두면
     *    **높이가 변하지 않아** 아무것도 움직이지 않는다.
     */
    setBusy(true)
    fetchSalesStats(scope === 'month' ? { from: monthStart() } : {})
      .then(r => { cache.current.set(scope, r.total); if (alive) setShown(r.total) })
      .catch(() => { /* 카드 하나가 안 떠도 나머지는 보여야 한다 */ })
      .finally(() => { if (alive) setBusy(false) })
    return () => { alive = false }
  }, [scope])

  const sub = (key: string, st: SalesStat): string => {
    if (key === 'consult') return tf('견적 {0}건', st.reached.draft)
    if (key === 'contracted') return won(st.amount.contracted)
    if (key === 'completed') return won(st.amount.completed)
    return ''
  }
  const make = (st: SalesStat): Tile[] => DASH_STEPS.map((step, i) => ({
    key: step.key, label: step.label, unit: step.unit,
    n: step.get(st), sub: sub(step.key, st),
    // 깔때기의 끝 — **인도 완료가 결론**이다. 손익의 수익과 같은 색으로 둔다(2026-09-16 지시)
    ...(step.key === 'completed' ? { profit: true } : {}),
    ...(i > 0 ? { sep: 'arrow' as const } : {}),
  }))
  // 값이 오기 전에도 같은 뼈대를 그린다 — 카드 키가 안 변하니 아래가 들썩이지 않는다
  const tiles = shown ? make(shown) : skeleton(make(BLANK_SALES))
  return (
    <Card
      title={t('영업 성과')} full onGo={onGo}
      extra={<ScopeToggle scope={scope} onChange={setScope} />}
    >
      {/* 바꾸는 중에도 자리를 지킨다 — aria-busy 로만 알리고 눈에 보이는 것은 그대로 둔다 */}
      <div aria-busy={busy}>
        <TileRow tiles={tiles} isMobile={isMobile} mobileCols={2} big />
      </div>
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

/**
 * **손익** — 경영관리가 매일 먼저 보는 자리(2026-09-16 지시). 영업 성과처럼 **이번 달/전체**를 오간다.
 *
 * 앞에 「입력 필요」를 둔다. 손익표는 보는 표이기 전에 **적는 표**라, 적지 않은 건이 몇인지가
 * 먼저 눈에 들어와야 한다 — 발행일을 안 적으면 그 달 숫자 자체가 거짓이 된다.
 * 입력 필요는 달과 상관없다(아직 어느 달에도 안 들어간 건이다) — 토글을 눌러도 그대로다.
 *
 * 이번 달과 전체를 **한 번에 받아** 두고 화면에서만 바꾼다 — 누를 때마다 기다리지 않게.
 * 삭제한 줄은 빼고 센다. 셈은 손익 탭과 같은 함수라 두 화면 숫자가 갈릴 수 없다.
 */
function PnlCard({ isMobile, onGo }: { isMobile: boolean; onGo: () => void }) {
  const [scope, setScope] = useState<Scope>('month')
  const [sum, setSum] = useState<PnlSummary | null>(null)
  useEffect(() => {
    let alive = true
    fetchPnlSummary().then(v => { if (alive) setSum(v) }).catch(() => { /* 카드 하나가 안 떠도 나머지는 보여야 한다 */ })
    return () => { alive = false }
  }, [])

  const total: PnlTotals | null = sum ? (scope === 'month' ? sum.month_total : sum.all_total) : null
  const loss = !!total && total.profit < 0
  const make = (v: PnlTotals): Tile[] => [
    { key: 'todo', label: '입력 필요', n: sum?.pending ?? 0, unit: '건', warn: true },
    { key: 'count', label: '발행', n: v.count, unit: '건', sep: 'divider' },
    { key: 'gross', label: '공급대가', n: 0, unit: '', text: won(v.gross) },
    { key: 'cost', label: '원가', n: 0, unit: '', text: won(v.cost) },
    { key: 'profit', label: '수익', n: 0, unit: '', text: won(v.profit), profit: !loss, warn: loss, sep: 'arrow' },
    { key: 'margin', label: '수익률', n: 0, unit: '', text: v.margin === null ? '—' : `${(v.margin * 100).toFixed(1)}%`, profit: !loss, warn: loss },
  ]
  const tiles = total ? make(total) : skeleton(make(BLANK_TOTALS))

  return (
    <Card title={t('손익')} full onGo={onGo} extra={<ScopeToggle scope={scope} onChange={setScope} />}>
      <TileRow tiles={tiles} isMobile={isMobile} mobileCols={2} small />
    </Card>
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
  /*
   * 앞 다섯은 **이어지는 단계**라 꺾쇠로 잇는다.
   * 「납기일 경과」는 다음 단계가 아니라 **어디에 있든 늦은 건**이라, 꺾쇠 대신 세로선으로 끊는다 —
   * 꺾쇠로 이으면 인도 완료 다음에 납기일 경과가 오는 것처럼 읽힌다.
   */
  const make = (d: NonNullable<typeof dash>): Tile[] => ([
    { key: 'assign', label: '배정 대기', n: d.assign.length },
    { key: 'pending', label: '수락 대기', n: d.pending.length, sep: 'arrow' },
    { key: 'active', label: '특장 진행', n: d.active.length, sep: 'arrow' },
    { key: 'addon', label: '부가 작업', n: d.addon.length, sep: 'arrow' },
    // 여기서도 끝이 결론이다 — 영업 성과·손익과 같은 색
    { key: 'done', label: '인도 완료', n: d.done.length, sep: 'arrow', profit: true },
    { key: 'late', label: '납기일 경과', n: d.late.length, warn: true, sep: 'divider' },
  ] as Omit<Tile, 'unit'>[]).map(x => ({ ...x, unit: '건' }))
  const tiles = dash ? make(dash) : skeleton(make(BLANK_DASH))
  return (
    <Card title={t('주문 진행 현황')} full onGo={onGo}>
      <TileRow tiles={tiles} isMobile={isMobile} mobileCols={3} />
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
 * **배정 대기** — 영업이 요청했고 특장사를 아직 정하지 않은 건. 생산관리가 지금 손댈 자리다.
 *
 * 배정 요청 대기(영업이 아직 안 누른 건)와 헷갈리면 안 된다. 그쪽은 **기다리는** 자리이고
 * 이쪽은 **누르는** 자리다 — 그래서 여기에는 「열기」가 있다.
 */
function AssignQueueCard({ orders, contracted, onGo }: {
  orders: ApiOrder[] | null; contracted: ApiQuote[] | null; onGo: () => void
}) {
  const dash = useMemo(
    () => (orders && contracted ? buildDashboard(orders, contracted, new Date(), true) : null),
    [orders, contracted],
  )
  const days = (iso?: string | null) =>
    iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86400000)) : 0
  const rows = [...(dash?.assign ?? [])].sort(
    (a, b) => days(b.quote.assign_requested_at) - days(a.quote.assign_requested_at),
  )
  return (
    <Card title={t('배정 대기')} onGo={onGo}>
      <div style={s.headline}>
        <span style={rows.length > 0 ? s.numValWarn : s.numVal}>{rows.length}<span style={s.unit}>{t('건')}</span></span>
      </div>
      <div style={s.pane}>
        {!dash ? <div style={s.muted}>{t('불러오는 중…')}</div>
          : rows.length === 0 ? <div style={s.muted}>{t('배정할 건이 없습니다.')}</div> : (
            <ul style={s.list}>
              {rows.map(r => (
                <li key={r.quote.id} style={s.listRow}>
                  <span style={s.listNo}>{r.quote.quote_no ?? `#${r.quote.id}`}</span>
                  <span style={s.listName}>{r.quote.customer?.name ?? '—'}</span>
                  {/* 거부돼 돌아온 건은 「다시 배정」이라 먼저 눈에 들어와야 한다 */}
                  {r.rejected && <span style={s.tagWarn}>{t('거부됨')}</span>}
                  <span style={s.listSub}>{tf('{0}일째', days(r.quote.assign_requested_at))}</span>
                </li>
              ))}
            </ul>
          )}
      </div>
    </Card>
  )
}

/**
 * **납기 경과·임박** — 늦었거나 곧 늦을 건. 생산관리가 매일 먼저 보는 자리다.
 * 늦은 것을 위에, 임박한 것을 아래에 둔다(먼저 손대야 할 순서).
 */
function LateCard({ orders, contracted, onGo }: {
  orders: ApiOrder[] | null; contracted: ApiQuote[] | null; onGo: () => void
}) {
  const now = new Date()
  const dash = useMemo(
    () => (orders && contracted ? buildDashboard(orders, contracted, now, true) : null),
    [orders, contracted],   // eslint-disable-line react-hooks/exhaustive-deps
  )
  const rows = useMemo(() => {
    if (!dash) return []
    const seen = new Set<number>()
    const out: { o: ApiOrder; days: number }[] = []
    // ① 이미 늦은 것 — 현황판의 「납기일 경과」와 같은 셈을 쓴다(두 화면이 갈리면 안 된다)
    for (const o of dash.late) {
      if (seen.has(o.id)) continue
      seen.add(o.id)
      out.push({ o, days: dueInfo(o.delivery_due, now).days })
    }
    // ② 곧 늦을 것 — 진행 중이면서 납기가 코앞
    for (const o of dash.active) {
      if (seen.has(o.id)) continue
      const d = dueInfo(o.delivery_due, now)
      if (d.state !== 'soon') continue
      seen.add(o.id)
      out.push({ o, days: d.days })
    }
    return out.sort((a, b) => a.days - b.days)
  }, [dash])   // eslint-disable-line react-hooks/exhaustive-deps

  const lateCount = rows.filter(r => r.days < 0).length
  return (
    <Card title={t('납기 경과 · 임박')} onGo={onGo}>
      <div style={s.headline}>
        <span style={lateCount > 0 ? s.numValWarn : s.numVal}>{rows.length}<span style={s.unit}>{t('건')}</span></span>
      </div>
      <div style={s.pane}>
        {!dash ? <div style={s.muted}>{t('불러오는 중…')}</div>
          : rows.length === 0 ? <div style={s.muted}>{t('납기가 급한 건이 없습니다.')}</div> : (
            <ul style={s.list}>
              {rows.map(({ o, days }) => (
                <li key={o.id} style={s.listRow}>
                  <span style={s.listName}>{o.quote.customer?.name ?? '—'}</span>
                  <span style={s.listOwner}>{o.maker_org?.name ?? '—'}</span>
                  <span style={days < 0 ? s.listLate : s.listSub}>
                    {days < 0 ? tf('{0}일 경과', -days) : days === 0 ? t('오늘') : tf('{0}일 남음', days)}
                  </span>
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

/**
 * 달력 한 칸 — **PC 에서 글자가 너무 작았다**(제보). 휴대폰에서는 칸이 좁아 작아도 읽히지만,
 * 넓은 화면에서는 같은 크기가 먼지처럼 보인다. 칸을 키우고 글자도 앱의 라벨 크기(`--fs-label`)로 올린다.
 * 그 크기는 휴대폰에서 더 커지므로(토큰이 기기별로 다르다) 따로 가르지 않아도 된다.
 */
const CAL_H = 74
const calCell: React.CSSProperties = {
  minHeight: CAL_H, border: 'var(--hairline)', borderRadius: 6, padding: '5px 6px',
  display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0,
  background: '#fff', fontFamily: 'inherit', alignItems: 'stretch',
}

/** 토글 한 칸 — `flex: 1 1 0` 이라야 글자 수와 상관없이 **정확히 반**이다(basis 를 0 으로 둔다) */
const toggleSeg: React.CSSProperties = {
  flex: '1 1 0', minWidth: 0, border: 'none', cursor: 'pointer',
  fontFamily: 'inherit', fontSize: 'var(--fs-caption)', padding: '4px 0',
  textAlign: 'center', whiteSpace: 'nowrap',
}

const cardBase: React.CSSProperties = {
  background: '#fff', border: 'var(--hairline)', borderRadius: 'var(--r-md)',
  padding: 'var(--sp-4)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', minWidth: 0,
}
/**
 * 목록이 드는 칸 — **높이를 못 박는다.** 0건이든 100건이든 카드 크기가 같아야 아래가 안 들썩인다.
 * 높이는 네 줄 남짓(2026-09-16 지시로 절반으로 줄였다) — 훑는 자리지 여기서 일하는 자리가 아니다.
 */
const paneBase: React.CSSProperties = {
  height: 104, overflowY: 'auto', borderTop: 'var(--hairline)', paddingTop: 4, minWidth: 0,
}

const s: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' },
  grid: { display: 'grid', gap: 'var(--sp-3)', alignItems: 'start' },
  card: cardBase,
  cardFull: { ...cardBase, gridColumn: '1 / -1' },
  cardHead: { display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' },
  cardTitle: { fontSize: 'var(--fs-section)', fontWeight: 'var(--fw-section)' as React.CSSProperties['fontWeight'], color: 'var(--dark)' },
  // 제목과 오른쪽 묶음(토글·곁수치·열기) 사이를 벌린다 — 오른쪽은 늘 같은 자리에 선다
  headGap: { flex: 1, minWidth: 0 },
  headCount: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' },
  /**
   * 기간 토글 — **칸을 정확히 반으로 가른다.**
   * 글자 수에 맞춰 넓이를 잡으면(「이번 달」 3자 · 「전체」 2자) 가르는 선이 가운데가 아니게 되고,
   * 카드마다 토글 모양이 달라 보인다(제보). 넓이를 못 박고 두 칸이 똑같이 나눠 갖는다.
   */
  toggle: { display: 'inline-flex', width: 132, flexShrink: 0, border: 'var(--hairline)', borderRadius: 999, overflow: 'hidden', background: '#fff' },
  toggleOn: { ...toggleSeg, background: 'var(--dark)', color: '#fff' },
  toggleOff: { ...toggleSeg, background: 'none', color: 'var(--muted)' },
  go: { border: 'none', background: 'none', color: 'var(--muted)', fontSize: 'var(--fs-caption)', cursor: 'pointer', fontFamily: 'inherit', padding: 0 },

  // 한 줄을 가득 채운다. 줄(이름/숫자/아래)을 격자로 못 박아야 꺾쇠가 **숫자 줄**에 선다
  tilesRow: { display: 'grid', gridTemplateRows: 'auto auto auto', columnGap: 'var(--sp-3)', alignItems: 'center' },
  tilesMobile: { display: 'grid', gap: 'var(--sp-3)' },
  tileCell: { minWidth: 0 },
  mid: { textAlign: 'center' },
  sepArrow: { gridRow: 2, alignSelf: 'center', justifySelf: 'center', color: 'var(--muted)', fontSize: 20, lineHeight: 1 },
  sepLine: { gridRow: '1 / 4', justifySelf: 'center', width: 1, background: 'var(--line)', alignSelf: 'stretch' },
  perfVal: { fontSize: 30, fontWeight: 700, color: 'var(--dark)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 },

  numLabel: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  numVal: { fontSize: 26, fontWeight: 700, color: 'var(--dark)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 },
  numValWarn: { fontSize: 26, fontWeight: 700, color: 'var(--req)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 },
  // 결론 숫자 — 컨피규레이터 실구매가와 같은 색. 흰 바탕 대비가 낮아 **큰 글씨 전용**이다
  numValProfit: { fontSize: 26, fontWeight: 700, color: 'var(--lime-ink)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 },
  perfValProfit: { fontSize: 30, fontWeight: 700, color: 'var(--lime-ink)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 },
  // 금액은 자릿수가 길다 — 숫자 칸보다 한 단계 작게 잡아야 옆 칸을 안 밀친다
  tileText: { fontSize: '0.72em', fontWeight: 700, whiteSpace: 'nowrap' },
  // 금액이 섞인 줄 전체를 한 단계 줄인다 — 큰 글씨로는 칸끼리 붙어 어느 숫자가 어느 이름인지 안 보인다
  smNum: { fontSize: 19 },
  tileTextSm: { fontSize: 17, fontWeight: 700, whiteSpace: 'nowrap' },
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
  listLate: { color: 'var(--req)', fontSize: 'var(--fs-caption)', fontWeight: 700, whiteSpace: 'nowrap' },
  tagWarn: { color: 'var(--req)', fontSize: 'var(--fs-caption)', border: '1px solid var(--req)', borderRadius: 4, padding: '0 4px', whiteSpace: 'nowrap' },
  // 마이페이지 고르개도 같은 규칙 — 칸을 똑같이 나눈다
  boardBar: { display: 'inline-flex', width: 264, border: 'var(--hairline)', borderRadius: 999, overflow: 'hidden', background: '#fff', alignSelf: 'flex-start' },
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
  calGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 },
  calDow: { fontSize: 'var(--fs-label)', color: 'var(--muted)', textAlign: 'center', padding: '3px 0' },
  calEmpty: { minHeight: CAL_H },
  calDay: { ...calCell, cursor: 'pointer' },
  calDayIdle: { ...calCell, cursor: 'default' },
  calDayToday: { ...calCell, border: '1px solid var(--dark)', cursor: 'pointer' },
  calNum: { fontSize: 'var(--fs-label)', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums', textAlign: 'left' },
  calMark: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-label)', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' },
  calMarkDone: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-label)', color: 'var(--dark)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
  dotArrival: { width: 8, height: 8, borderRadius: 999, flexShrink: 0, background: 'var(--dark)', display: 'inline-block' },
  dotDue: { width: 8, height: 8, borderRadius: 999, flexShrink: 0, background: 'var(--lime)', display: 'inline-block' },
  dotHandover: { width: 8, height: 8, borderRadius: 999, flexShrink: 0, background: 'var(--alert)', display: 'inline-block' },
}
