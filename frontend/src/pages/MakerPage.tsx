import { useAuth } from '../contexts/AuthContext'
import { Header } from '../components/Header'

const ORDER_STATUSES = ['제작착수', '구조변경', '튜닝신청', '안전검사', '튜닝승인', '인도완료'] as const

type DocStatus = 'pending' | 'done' | 'na'

interface MockOrder {
  order_id: string
  customer_name: string
  model: string
  status: typeof ORDER_STATUSES[number]
  maker_org_id: string
  assigned_at: string
  docs: { name: string; status: DocStatus }[]
}

const DOC_STATUS_LABEL: Record<DocStatus, string> = { pending: '대기', done: '완료', na: '—' }
const DOC_STATUS_COLOR: Record<DocStatus, string> = { pending: '#B3471F', done: '#2e7d32', na: 'var(--muted)' }

// mock 데이터 — maker_org_id = ORG_MAKER1 격리
const MOCK_ORDERS: MockOrder[] = [
  {
    order_id: 'ORD-2026-001', customer_name: '범석환', model: 'PV5 오픈베드',
    status: '제작착수', maker_org_id: 'ORG_MAKER1', assigned_at: '2026-06-20',
    docs: [
      { name: '작업지시서',    status: 'done' },
      { name: '세부설계도',    status: 'pending' },
      { name: '하중계산서',    status: 'pending' },
      { name: '예비변경허가서', status: 'na' },
    ],
  },
  {
    order_id: 'ORD-2026-002', customer_name: '김영철', model: 'PV5 오픈베드',
    status: '구조변경', maker_org_id: 'ORG_MAKER1', assigned_at: '2026-06-21',
    docs: [
      { name: '작업지시서',    status: 'done' },
      { name: '세부설계도',    status: 'done' },
      { name: '하중계산서',    status: 'done' },
      { name: '예비변경허가서', status: 'pending' },
    ],
  },
]

export function MakerPage() {
  const { session } = useAuth()
  const orgCode = session?.org.code ?? ''

  // org 격리: maker_org_id = 자기 org만
  const orders = MOCK_ORDERS.filter(o => o.maker_org_id === orgCode)

  return (
    <div style={styles.root}>
      <Header />

      <div style={styles.body}>
        <div style={styles.titleBar}>
          <h1 style={styles.h1}>특장사 대시보드</h1>
          <span style={styles.orgChip}>{session?.org.name ?? orgCode}</span>
        </div>

        {orders.length === 0 ? (
          <div style={styles.empty}>배정된 주문이 없습니다.</div>
        ) : (
          <div style={styles.orderList}>
            {orders.map(order => (
              <OrderCard key={order.order_id} order={order} />
            ))}
          </div>
        )}

        <div style={styles.todoNote}>
          서류 자동생성 · 실데이터 연동 — TODO (실 API 연결 후 구현)
        </div>
      </div>
    </div>
  )
}

function OrderCard({ order }: { order: MockOrder }) {
  const pendingCount = order.docs.filter(d => d.status === 'pending').length

  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <div>
          <div style={styles.orderId}>{order.order_id}</div>
          <div style={styles.orderCustomer}>{order.customer_name} · {order.model}</div>
        </div>
        <div style={styles.cardRight}>
          <span style={styles.statusBadge}>{order.status}</span>
          <div style={styles.assignedAt}>배정일 {order.assigned_at}</div>
        </div>
      </div>

      <div style={styles.docSection}>
        <div style={styles.docLabel}>필수 서류</div>
        <div style={styles.docGrid}>
          {order.docs.map(doc => (
            <div key={doc.name} style={styles.docItem}>
              <span style={{ color: DOC_STATUS_COLOR[doc.status], fontSize: 11, fontWeight: 600 }}>
                {DOC_STATUS_LABEL[doc.status]}
              </span>
              <span style={styles.docName}>{doc.name}</span>
            </div>
          ))}
        </div>
        {pendingCount > 0 && (
          <div style={styles.pendingWarn}>⚠ 미완료 {pendingCount}건</div>
        )}
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
  docSection: {},
  docLabel: { fontSize: 11.5, color: 'var(--muted)', marginBottom: 8 },
  docGrid: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  docItem: {
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '5px 10px', background: 'var(--card)',
    borderRadius: 8, fontSize: 12,
  },
  docName: { color: 'var(--dark)' },
  pendingWarn: { marginTop: 8, fontSize: 12, color: 'var(--warn)' },
  cardActions: { display: 'flex', gap: 8 },
  actionBtn: {
    fontSize: 12, padding: '7px 14px', border: '1px solid var(--line)',
    borderRadius: 8, background: '#fff', color: 'var(--muted)', cursor: 'not-allowed',
  },
  todoNote: {
    marginTop: 24, padding: '10px 14px', background: 'var(--card)',
    borderRadius: 8, fontSize: 12, color: 'var(--muted)',
  },
}
