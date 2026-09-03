import { useEffect, useState } from 'react'
import type { ApiOrder } from '@shared/types/index'
import { fetchOrders, acceptOrder, rejectOrder } from '../api/orders'
import { useAuth } from '../contexts/AuthContext'
import { Header } from '../components/Header'
import { OrderDetail } from '../components/OrderDetail'
import { useOrderDeepLink, type OrderDeepLink } from '../lib/deepLink'
import { OrderStepsBoard } from '../components/OrderStepsBoard'
import { useIsMobile } from '../hooks/useIsMobile'
import { useScreenRefresh } from '../contexts/RefreshContext'
import { RefreshButton } from '../components/RefreshButton'
import { AcceptOrderModal } from '../components/AcceptOrderModal'
import { isAcceptOverdue, daysSince } from '@shared/schedule/businessDays'

// ── MakerPage ──────────────────────────────────────────────────────────────
export function MakerPage() {
  const { session } = useAuth()
  const isMobile = useIsMobile()
  const email = session?.user.email ?? ''

  const [orders, setOrders] = useState<ApiOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  /*
   * **알림을 누르고 들어온 경우** — `/?order=19&tab=chat` 를 읽어 그 주문을 대화 탭으로
   * 편다. 주소는 한 번 읽고 지운다 — 안 지우면 목록으로 돌아가도 계속 다시 열린다.
   */
  const [deepLink, setDeepLink] = useState<OrderDeepLink | null>(null)
  useOrderDeepLink(link => { setDeepLink(link); setSelectedId(link.orderId) })
  const [acceptingId, setAcceptingId] = useState<number | null>(null)
  /** 수락 팝업을 띄운 주문 — 납기일을 받아야 수락이 완료된다 */
  const [acceptTarget, setAcceptTarget] = useState<ApiOrder | null>(null)
  const [acceptErr, setAcceptErr] = useState('')

  function load() {
    setLoading(true); setErr('')
    fetchOrders({})
      .then(setOrders)
      .catch(e => setErr(e instanceof Error ? e.message : '주문 목록 로드 실패'))
      .finally(() => setLoading(false))
  }

  /*
   * 수락 — 예전에는 `window.confirm` 한 줄이라 **무엇을 받는지 모르고** 눌렀다.
   * 이제 목록의 「내용 보기」로 사양·서류를 펴 본 뒤, 납기일을 적어 넣고 받는다.
   */
  async function handleAccept(orderId: number, deliveryDue: string) {
    setAcceptingId(orderId); setAcceptErr('')
    try {
      await acceptOrder(orderId, deliveryDue)
      setAcceptTarget(null)
      load()
    } catch (e: unknown) {
      setAcceptErr(e instanceof Error ? e.message : '주문 수락 실패')
    } finally {
      setAcceptingId(null)
    }
  }

  /**
   * 거부 — **못 받겠다고 알린다.**
   * 배정이 풀려 다른 특장사에 다시 맡길 수 있게 된다. 계약은 그대로다.
   */
  async function handleReject(orderId: number, reason: string) {
    setAcceptingId(orderId); setAcceptErr('')
    try {
      await rejectOrder(orderId, reason)
      setAcceptTarget(null)
      load()
    } catch (e: unknown) {
      setAcceptErr(e instanceof Error ? e.message : '주문 거부 실패')
    } finally {
      setAcceptingId(null)
    }
  }

  // 배정(수락 대기) vs 주문(제작 진행)
  const pending = orders.filter(o => o.quote.status === 'assigned')
  const active  = orders.filter(o => o.quote.status !== 'assigned')

  useEffect(() => {
    if (!email) return
    load()
  }, [email]) // eslint-disable-line react-hooks/exhaustive-deps
  // 앱으로 돌아오면 저절로 다시 불러온다 + 헤더 새로고침 버튼이 이걸 부른다
  useScreenRefresh(load)

  return (
    <div style={styles.root}>
      {acceptTarget && (
        <AcceptOrderModal
          orderId={acceptTarget.id}
          makerOrgName={session?.org.name ?? session?.org.code ?? ''}
          orderedAt={acceptTarget.assigned_at ?? acceptTarget.created_at}
          busy={acceptingId === acceptTarget.id}
          error={acceptErr}
          onAccept={due => handleAccept(acceptTarget.id, due)}
          onReject={reason => handleReject(acceptTarget.id, reason)}
          onClose={() => setAcceptTarget(null)}
        />
      )}
      <Header />

      {/*
        헤더 바로 아래 한 줄 — 영업·관리 화면과 같은 구조다.
        「특장사 작업」이라는 제목은 없앴다. 어느 화면인지는 헤더의 역할 배지가 이미 말해 주고,
        제목 한 줄이 좁은 화면에서 내용을 그만큼 밀어냈다.
        이 화면은 탭이 없어 왼쪽에 소속을 두고, 오른쪽 자리는 다른 화면과 똑같이 새로고침이 쓴다.
      */}
      <div style={styles.tabBar}>
        <div style={styles.barLeft}>
          <span style={styles.orgChip}>{session?.org.name ?? session?.org.code}</span>
        </div>
        <div style={styles.barRight}><RefreshButton /></div>
      </div>

      <div style={{ ...styles.body, padding: isMobile ? '14px 14px' : '20px 24px' }}>
        {selectedId !== null ? (
          <OrderDetail
            orderId={selectedId}
            onBack={() => setSelectedId(null)}
            makerView
            /* 알림을 눌러 들어온 그 주문일 때만 대화 탭으로 연다 */
            initialTab={deepLink?.chat && deepLink.orderId === selectedId ? 'chat' : undefined}
            initialChatStep={deepLink?.orderId === selectedId ? deepLink?.step : undefined}
          />
        ) : (
          <>
            {err && <div style={styles.errMsg}>{err}</div>}
            {loading ? (
              <div style={styles.loading}>로딩 중…</div>
            ) : orders.length === 0 ? (
              <div style={styles.empty}>배정된 주문이 없습니다.</div>
            ) : (
              <>
                {/*
                  수락 대기도 **진행 중과 같은 줄 모양**을 쓴다. 두 목록이 위아래로
                  붙어 있는데 생김새가 다르면 다른 종류의 것으로 읽힌다.
                  수락 버튼은 두지 않는다 — 줄을 누르면 발주서가 뜨고 거기서 수락·거부를 고른다.
                  버튼이 따로 있으면 **내용을 안 보고 수락하는 길**이 남는다.
                */}
                {pending.length > 0 && (
                  <>
                    <div style={styles.boardTitle}>수락 대기 ({pending.length})</div>
                    <OrderStepsBoard
                      orders={pending}
                      mode="pending"
                      lateInfo={o => {
                        const from = new Date(o.assigned_at ?? o.created_at)
                        return { days: daysSince(from, new Date()), late: isAcceptOverdue(from, new Date()) }
                      }}
                      onCardClick={id => { setAcceptErr(''); setAcceptTarget(pending.find(o => o.id === id) ?? null) }}
                    />
                  </>
                )}
                {active.length > 0 && (
                  <>
                    <div style={styles.boardTitle}>진행 중 ({active.length})</div>
                    <OrderStepsBoard orders={active} onCardClick={setSelectedId} />
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  root: { height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  body: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px' },
  // 영업·관리 화면과 같은 자리·같은 높이의 한 줄
  tabBar: { flexShrink: 0, display: 'flex', alignItems: 'stretch', background: '#fff' },
  barLeft: { display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, padding: '0 var(--sp-4)', minHeight: 'var(--h-control)' },
  barRight: { display: 'flex', alignItems: 'center', flexShrink: 0, paddingRight: 'var(--sp-3)' },
  orgChip: {
    fontSize: 12, padding: '3px 10px', background: 'var(--card)',
    border: '0.5px solid var(--line)', borderRadius: 20, color: 'var(--muted)',
  },
  errMsg: { color: 'var(--warn)', fontSize: 13, marginBottom: 12 },
  loading: { color: 'var(--muted)', fontSize: 14, padding: '40px 0', textAlign: 'center' },
  empty: { color: 'var(--muted)', fontSize: 14, padding: '40px 0', textAlign: 'center' },
  boardTitle: {
    fontSize: 'var(--fs-section)', fontWeight: 700, color: 'var(--dark)',
    letterSpacing: 'var(--ls-tight)', paddingBottom: 'var(--sp-2)', borderBottom: 'var(--hairline)',
    marginBottom: 'var(--sp-1)',
  },
}
