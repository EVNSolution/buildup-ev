import { useEffect, useState } from 'react'
import type { ApiOrder } from '@shared/types/index'
import { fetchOrders } from '../api/orders'
import { useAuth } from '../contexts/AuthContext'
import { Header } from '../components/Header'
import { OrderKanbanBoard } from '../components/OrderKanbanBoard'

export function MakerPage() {
  const { session } = useAuth()
  const email = session?.user.email ?? ''

  const [orders, setOrders] = useState<ApiOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  function load() {
    setLoading(true); setErr('')
    fetchOrders({})
      .then(setOrders)
      .catch(e => setErr(e instanceof Error ? e.message : '주문 목록 로드 실패'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!email) return
    load()
  }, [email]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={styles.root}>
      <Header />

      <div style={styles.body}>
        <div style={styles.titleBar}>
          <h1 style={styles.h1}>특장사 작업 칸반</h1>
          <span style={styles.orgChip}>{session?.org.name ?? session?.org.code}</span>
        </div>

        {err && <div style={styles.errMsg}>{err}</div>}
        {loading ? (
          <div style={styles.loading}>로딩 중…</div>
        ) : orders.length === 0 ? (
          <div style={styles.empty}>배정된 주문이 없습니다.</div>
        ) : (
          <OrderKanbanBoard orders={orders} onRefresh={load} onError={setErr} />
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
}
