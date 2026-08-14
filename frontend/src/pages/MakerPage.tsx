import { useEffect, useState } from 'react'
import type { ApiOrder } from '@shared/types/index'
import { fetchOrders, acceptOrder } from '../api/orders'
import { useAuth } from '../contexts/AuthContext'
import { Header } from '../components/Header'
import { OrderDetail } from '../components/OrderDetail'
import { OrderKanbanBoard } from '../components/OrderKanbanBoard'
import { useIsMobile } from '../hooks/useIsMobile'
import { InboxPanel } from '../components/InboxPanel'

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

  function load() {
    setLoading(true); setErr('')
    fetchOrders({})
      .then(setOrders)
      .catch(e => setErr(e instanceof Error ? e.message : '주문 목록 로드 실패'))
      .finally(() => setLoading(false))
  }

  /*
   * 수락 — 예전에는 `window.confirm` 한 줄이라 **무엇을 받는지 모르고** 눌렀다.
   * 이제 목록의 「내용 보기」로 사양·서류를 펴 본 뒤 받는다(영업의 배정 문의와 같은 흐름).
   */
  async function handleAccept(orderId: number) {
    setAcceptingId(orderId); setErr('')
    try {
      await acceptOrder(orderId); load()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '주문 수락 실패')
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

  return (
    <div style={styles.root}>
      <Header />

      <div style={{ ...styles.body, padding: isMobile ? '14px 14px' : '20px 24px' }}>
        {selectedId !== null ? (
          <OrderDetail orderId={selectedId} onBack={() => setSelectedId(null)} makerView />
        ) : (
          <>
            <div style={{ ...styles.titleBar, flexWrap: 'wrap' }}>
              <h1 style={{ ...styles.h1, fontSize: isMobile ? 17 : 20 }}>특장사 작업 칸반</h1>
              <span style={styles.orgChip}>{session?.org.name ?? session?.org.code}</span>
            </div>
            {err && <div style={styles.errMsg}>{err}</div>}
            {loading ? (
              <div style={styles.loading}>로딩 중…</div>
            ) : orders.length === 0 ? (
              <div style={styles.empty}>배정된 주문이 없습니다.</div>
            ) : (
              <>
                <InboxPanel
                  title="수락 대기"
                  items={pending.map(o => ({
                    id: o.id,
                    no: `주문 #${o.id}`,
                    title: o.quote.customer?.name ?? '고객 미상',
                    sub: o.quote.model_code,
                    meta: '수락하면 제작 착수',
                  }))}
                  acceptLabel="주문 수락"
                  busyId={acceptingId}
                  onView={setSelectedId}
                  onAccept={handleAccept}
                />
                {active.length > 0 && (
                  <OrderKanbanBoard
                    orders={active}
                    onRefresh={load}
                    onError={setErr}
                    onCardClick={setSelectedId}
                  />
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
}
