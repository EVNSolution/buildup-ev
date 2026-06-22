import { useEffect, useState } from 'react'
import type { ApiOrder } from '@shared/types/index'
import { fetchOrders } from '../api/orders'
import { useAuth } from '../contexts/AuthContext'
import { Header } from '../components/Header'

const ORDER_STATUSES = ['제작착수', '구조변경', '튜닝신청', '안전검사', '튜닝승인', '인도완료'] as const

function fmtDate(s: string | null) {
  return s ? s.slice(0, 10) : '—'
}

export function MakerPage() {
  const { session } = useAuth()
  const email = session?.user.email ?? ''

  const [orders, setOrders] = useState<ApiOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!email) return
    setLoading(true)
    fetchOrders({}, email)
      .then(setOrders)
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }, [email])

  return (
    <div style={styles.root}>
      <Header />

      <div style={styles.body}>
        <div style={styles.titleBar}>
          <h1 style={styles.h1}>특장사 대시보드</h1>
          <span style={styles.orgChip}>{session?.org.name ?? session?.org.code}</span>
        </div>

        {err && <div style={styles.errMsg}>{err}</div>}
        {loading ? (
          <div style={styles.loading}>로딩 중…</div>
        ) : orders.length === 0 ? (
          <div style={styles.empty}>배정된 주문이 없습니다.</div>
        ) : (
          <div style={styles.orderList}>
            {orders.map(order => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function OrderCard({ order }: { order: ApiOrder }) {
  const statusIdx = ORDER_STATUSES.indexOf(order.status as typeof ORDER_STATUSES[number])

  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <div>
          <div style={styles.orderId}>주문 #{order.id}</div>
          <div style={styles.orderCustomer}>
            {order.quote.customer?.name ?? '고객없음'} · {order.quote.model_code}
          </div>
        </div>
        <div style={styles.cardRight}>
          <span style={styles.statusBadge}>{order.status}</span>
          <div style={styles.assignedAt}>배정일 {fmtDate(order.assigned_at)}</div>
        </div>
      </div>

      <div style={styles.progressSection}>
        <div style={styles.progressLabel}>진행 단계</div>
        <div style={styles.progressSteps}>
          {ORDER_STATUSES.map((s, i) => (
            <div key={s} style={styles.stepItem}>
              <div style={i <= statusIdx ? styles.stepDotActive : styles.stepDot} />
              <div style={i <= statusIdx ? styles.stepLabelActive : styles.stepLabel}>{s}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={styles.cardActions}>
        <button style={styles.actionBtn} disabled>서류 생성 (TODO)</button>
        <button style={styles.actionBtn} disabled>튜닝 신청 (TODO)</button>
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
  orderList: { display: 'flex', flexDirection: 'column', gap: 16 },
  card: {
    border: '1px solid var(--line)', borderRadius: 12, padding: '16px 18px',
    background: '#fff', display: 'flex', flexDirection: 'column', gap: 14,
  },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  orderId: { fontSize: 12, color: 'var(--muted)', marginBottom: 3 },
  orderCustomer: { fontSize: 15, fontWeight: 700, color: 'var(--dark)' },
  cardRight: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 },
  statusBadge: {
    fontSize: 12, fontWeight: 700, padding: '3px 10px',
    background: 'var(--lime)', color: 'var(--dark)', borderRadius: 12,
  },
  assignedAt: { fontSize: 11, color: 'var(--muted)' },
  progressSection: {},
  progressLabel: { fontSize: 11.5, color: 'var(--muted)', marginBottom: 8 },
  progressSteps: { display: 'flex', gap: 0, alignItems: 'flex-start' },
  stepItem: { display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 },
  stepDot: {
    width: 10, height: 10, borderRadius: '50%',
    background: '#e0e3e8', marginBottom: 5,
  },
  stepDotActive: {
    width: 10, height: 10, borderRadius: '50%',
    background: 'var(--lime)', marginBottom: 5,
  },
  stepLabel: { fontSize: 9.5, color: '#b0b7c0', textAlign: 'center' },
  stepLabelActive: { fontSize: 9.5, color: 'var(--dark)', fontWeight: 700, textAlign: 'center' },
  cardActions: { display: 'flex', gap: 8 },
  actionBtn: {
    fontSize: 12, padding: '7px 14px', border: '1px solid var(--line)',
    borderRadius: 8, background: '#fff', color: 'var(--muted)', cursor: 'not-allowed',
  },
}
