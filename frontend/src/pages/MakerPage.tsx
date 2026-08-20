import { useEffect, useState } from 'react'
import type { ApiOrder } from '@shared/types/index'
import { fetchOrders, acceptOrder } from '../api/orders'
import { useAuth } from '../contexts/AuthContext'
import { Header } from '../components/Header'
import { OrderDetail } from '../components/OrderDetail'
import { OrderStepsBoard } from '../components/OrderStepsBoard'
import { useIsMobile } from '../hooks/useIsMobile'
import { useScreenRefresh } from '../contexts/RefreshContext'
import { InboxPanel } from '../components/InboxPanel'
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
          onClose={() => setAcceptTarget(null)}
        />
      )}
      <Header />

      <div style={{ ...styles.body, padding: isMobile ? '14px 14px' : '20px 24px' }}>
        {selectedId !== null ? (
          <OrderDetail orderId={selectedId} onBack={() => setSelectedId(null)} makerView />
        ) : (
          <>
            <div style={{ ...styles.titleBar, flexWrap: 'wrap' }}>
              <h1 style={{ ...styles.h1, fontSize: isMobile ? 17 : 20 }}>특장사 작업</h1>
              <span style={styles.orgChip}>{session?.org.name ?? session?.org.code}</span>
            </div>
            {err && <div style={styles.errMsg}>{err}</div>}
            {loading ? (
              <div style={styles.loading}>로딩 중…</div>
            ) : orders.length === 0 ? (
              <div style={styles.empty}>배정된 주문이 없습니다.</div>
            ) : (
              <>
                {/*
                  「내용 보기」를 따로 두지 않는다 — 수락 팝업이 발주서를 통째로 보여준다.
                  버튼이 둘이면 내용을 안 보고 수락하는 길이 남고, 본 사람도 수락하려면
                  목록으로 되돌아와야 했다.
                */}
                <InboxPanel
                  title="수락 대기"
                  items={pending.map(o => {
                    const from = new Date(o.assigned_at ?? o.created_at)
                    const late = isAcceptOverdue(from, new Date())
                    return {
                      id: o.id,
                      no: `주문 #${o.id}`,
                      title: o.quote.customer?.name ?? '고객 미상',
                      sub: o.quote.model_code,
                      meta: `발주 ${(o.assigned_at ?? o.created_at).slice(0, 10)}`,
                      urgent: late,
                      urgentNote: late ? `발주 후 ${daysSince(from, new Date())}일째` : undefined,
                    }
                  })}
                  acceptLabel="주문 수락"
                  busyId={acceptingId}
                  onAccept={id => { setAcceptErr(''); setAcceptTarget(pending.find(o => o.id === id) ?? null) }}
                />
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
  titleBar: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 },
  h1: { margin: 0, fontSize: 20, color: 'var(--dark)' },
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
