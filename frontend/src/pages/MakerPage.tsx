import { useEffect, useState } from 'react'
import type { ApiOrder } from '@shared/types/index'
import { fetchOrders, acceptOrder } from '../api/orders'
import { useAuth } from '../contexts/AuthContext'
import { Header } from '../components/Header'
import { OrderDetail } from '../components/OrderDetail'
import { OrderKanbanBoard } from '../components/OrderKanbanBoard'
import { useIsMobile } from '../hooks/useIsMobile'

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

  async function handleAccept(orderId: number) {
    if (!window.confirm(`주문 #${orderId}을(를) 수락하시겠습니까?\n수락하면 제작 착수 상태가 됩니다.`)) return
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
          <OrderDetail orderId={selectedId} onBack={() => setSelectedId(null)} />
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
                {pending.length > 0 && (
                  <div style={styles.pendingBox}>
                    <div style={styles.pendingTitle}>수락 대기 ({pending.length})</div>
                    <div style={styles.pendingGrid}>
                      {pending.map(o => (
                        <div key={o.id} style={styles.pendingCard}>
                          <div style={styles.pendingId}>주문 #{o.id}</div>
                          <div style={styles.pendingName}>{o.quote.customer?.name ?? '고객 미상'} · {o.quote.model_code}</div>
                          <button
                            style={acceptingId === o.id ? styles.acceptBtnDisabled : styles.acceptBtn}
                            disabled={acceptingId === o.id}
                            onClick={() => handleAccept(o.id)}
                          >
                            {acceptingId === o.id ? '처리 중…' : '주문 수락 (제작 착수)'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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
    border: '1px solid var(--line)', borderRadius: 20, color: 'var(--muted)',
  },
  errMsg: { color: 'var(--warn)', fontSize: 13, marginBottom: 12 },
  loading: { color: 'var(--muted)', fontSize: 14, padding: '40px 0', textAlign: 'center' },
  empty: { color: 'var(--muted)', fontSize: 14, padding: '40px 0', textAlign: 'center' },
  pendingBox: { marginBottom: 20, padding: 14, background: '#fffdf3', border: '1px solid #f0d98a', borderRadius: 12 },
  pendingTitle: { fontSize: 13, fontWeight: 700, color: '#8a6d1a', marginBottom: 10 },
  pendingGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 },
  pendingCard: { background: '#fff', border: '1px solid var(--line)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 },
  pendingId: { fontSize: 12, color: 'var(--muted)', fontWeight: 600 },
  pendingName: { fontSize: 13, color: 'var(--dark)' },
  acceptBtn: { marginTop: 4, padding: '9px 10px', border: 'none', borderRadius: 8, background: 'var(--dark)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  acceptBtnDisabled: { marginTop: 4, padding: '9px 10px', border: 'none', borderRadius: 8, background: '#f0f2f4', color: '#b0b7c0', fontSize: 13, fontWeight: 700, cursor: 'not-allowed' },
}
