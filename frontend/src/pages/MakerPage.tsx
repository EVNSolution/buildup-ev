import { useEffect, useState } from 'react'
import type { ApiOrder, ApiOrderMakerDetail } from '@shared/types/index'
import { fetchOrders, fetchOrderDetail } from '../api/orders'
import { useAuth } from '../contexts/AuthContext'
import { Header } from '../components/Header'
import { OrderKanbanBoard } from '../components/OrderKanbanBoard'
import { useIsMobile } from '../hooks/useIsMobile'

const ORDER_STATUS_SEQ = ['제작착수', '구조변경', '튜닝신청', '안전검사', '튜닝승인', '인도완료'] as const
const DOC_STATUS_LABEL: Record<string, string> = { pending: '준비중', done: '완료', na: '해당없음' }
const DOC_STATUS_STYLE: Record<string, React.CSSProperties> = {
  pending: { background: '#fff3e0', color: '#e65100' },
  done:    { background: '#e8f5e9', color: '#2e7d32' },
  na:      { background: '#f0f2f4', color: 'var(--muted)' },
}

function fmtDatetime(s: string | null) { return s ? s.slice(0, 16).replace('T', ' ') : '—' }

// ── 주문 상세 패널 ─────────────────────────────────────────────────────────
function OrderDetail({ orderId, onBack }: { orderId: number; onBack: () => void }) {
  const [detail, setDetail] = useState<ApiOrderMakerDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<'spec' | 'docs'>('spec')
  const isMobile = useIsMobile()

  useEffect(() => {
    setLoading(true); setErr('')
    fetchOrderDetail(orderId)
      .then(setDetail)
      .catch(e => setErr(e instanceof Error ? e.message : '주문 상세 로드 실패'))
      .finally(() => setLoading(false))
  }, [orderId])

  if (loading) return <div style={det.loading}>로딩 중…</div>
  if (err) return <div style={det.err}>{err}</div>
  if (!detail) return null

  const statusIdx = ORDER_STATUS_SEQ.indexOf(detail.status as typeof ORDER_STATUS_SEQ[number])

  return (
    <div style={{ ...det.root, maxWidth: isMobile ? '100%' : 720 }}>
      {/* 헤더 */}
      <div style={det.header}>
        <button style={det.backBtn} onClick={onBack}>← 배정 주문</button>
        <div style={det.titleRow}>
          <span style={{ ...det.orderId, fontSize: isMobile ? 18 : 20 }}>주문 #{detail.id}</span>
          <span style={det.statusBadge}>{detail.status}</span>
          <span style={det.model}>{detail.model_code}</span>
        </div>
        <div style={det.metaRow}>
          <span>배정일 {fmtDatetime(detail.assigned_at)}</span>
          <span style={det.sep}>·</span>
          <span>생성 {fmtDatetime(detail.created_at)}</span>
          {detail.customer_name && (
            <><span style={det.sep}>·</span><span>고객 {detail.customer_name}</span></>
          )}
        </div>
      </div>

      {/* 진행 단계 */}
      <div style={{ ...det.progressSection, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
        {ORDER_STATUS_SEQ.map((s, i) => (
          <div key={s} style={{ ...det.stepItem, ...(isMobile ? { flex: '0 0 33%', marginBottom: 8 } : {}) }}>
            <div style={i <= statusIdx ? det.stepDotActive : det.stepDot} />
            <div style={i <= statusIdx ? det.stepLabelActive : det.stepLabel}>{s}</div>
          </div>
        ))}
      </div>

      {/* 탭 */}
      <div style={det.tabs}>
        <button style={tab === 'spec' ? det.tabActive : det.tabBtn} onClick={() => setTab('spec')}>사양</button>
        <button style={tab === 'docs' ? det.tabActive : det.tabBtn} onClick={() => setTab('docs')}>서류 ({detail.documents.length})</button>
      </div>

      {tab === 'spec' && (
        <div style={det.section}>
          {detail.options.length === 0 ? (
            <div style={det.empty}>옵션 정보 없음</div>
          ) : isMobile ? (
            // 모바일: 라벨:값 카드 스타일
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {detail.options.map((opt, i) => (
                <div key={i} style={detMob.row}>
                  <span style={detMob.label}>{opt.group_name}</span>
                  <span style={detMob.value}>{opt.value_name}</span>
                </div>
              ))}
            </div>
          ) : (
            <table style={det.table}>
              <thead>
                <tr>
                  <th style={det.th}>항목</th>
                  <th style={det.th}>선택</th>
                </tr>
              </thead>
              <tbody>
                {detail.options.map((opt, i) => (
                  <tr key={i}>
                    <td style={det.tdLabel}>{opt.group_name}</td>
                    <td style={det.tdValue}>{opt.value_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'docs' && (
        <div style={det.section}>
          {detail.documents.length === 0 ? (
            <div style={det.empty}>서류 준비 중</div>
          ) : isMobile ? (
            // 모바일: 라벨:값 카드 스타일
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {detail.documents.map(doc => (
                <div key={doc.id} style={detMob.row}>
                  <span style={detMob.label}>{doc.name}</span>
                  <span style={{ ...det.docBadge, ...DOC_STATUS_STYLE[doc.status] }}>
                    {DOC_STATUS_LABEL[doc.status] ?? doc.status}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <table style={det.table}>
              <thead>
                <tr>
                  <th style={det.th}>서류명</th>
                  <th style={det.th}>상태</th>
                </tr>
              </thead>
              <tbody>
                {detail.documents.map(doc => (
                  <tr key={doc.id}>
                    <td style={det.tdLabel}>{doc.name}</td>
                    <td style={det.tdValue}>
                      <span style={{ ...det.docBadge, ...DOC_STATUS_STYLE[doc.status] }}>
                        {DOC_STATUS_LABEL[doc.status] ?? doc.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

// ── MakerPage ──────────────────────────────────────────────────────────────
export function MakerPage() {
  const { session } = useAuth()
  const isMobile = useIsMobile()
  const email = session?.user.email ?? ''

  const [orders, setOrders] = useState<ApiOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)

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
              <OrderKanbanBoard
                orders={orders}
                onRefresh={load}
                onError={setErr}
                onCardClick={setSelectedId}
              />
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
}

const det: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 },
  loading: { color: 'var(--muted)', fontSize: 14, padding: '40px 0' },
  err: { color: 'var(--warn)', fontSize: 13 },
  header: { display: 'flex', flexDirection: 'column', gap: 8 },
  backBtn: {
    alignSelf: 'flex-start', fontSize: 12, padding: '5px 12px',
    border: '1px solid var(--line)', borderRadius: 7, background: '#fff',
    cursor: 'pointer', color: 'var(--muted)', marginBottom: 4,
    minHeight: 44,
  },
  titleRow: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const },
  orderId: { fontSize: 20, fontWeight: 800, color: 'var(--dark)' },
  statusBadge: {
    fontSize: 12, fontWeight: 700, padding: '4px 12px',
    background: 'var(--lime)', color: 'var(--dark)', borderRadius: 14,
  },
  model: { fontSize: 14, color: 'var(--muted)', fontWeight: 600 },
  metaRow: { display: 'flex', gap: 6, fontSize: 12, color: 'var(--muted)', flexWrap: 'wrap' as const },
  sep: { color: 'var(--line)' },
  progressSection: {
    display: 'flex', alignItems: 'flex-start',
    border: '1px solid var(--line)', borderRadius: 10,
    padding: '12px 16px', background: '#fff',
  },
  stepItem: { display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 },
  stepDot: { width: 10, height: 10, borderRadius: '50%', background: '#e0e3e8', marginBottom: 6 },
  stepDotActive: { width: 10, height: 10, borderRadius: '50%', background: 'var(--lime)', marginBottom: 6 },
  stepLabel: { fontSize: 9.5, color: '#b0b7c0', textAlign: 'center' as const },
  stepLabelActive: { fontSize: 9.5, color: 'var(--dark)', fontWeight: 700, textAlign: 'center' as const },
  tabs: { display: 'flex', gap: 4, borderBottom: '2px solid var(--line)', paddingBottom: 0 },
  tabBtn: {
    padding: '8px 18px', border: 'none', borderBottom: '2px solid transparent',
    background: 'transparent', cursor: 'pointer', fontSize: 13, color: 'var(--muted)',
    fontWeight: 600, marginBottom: -2, minHeight: 44,
  },
  tabActive: {
    padding: '8px 18px', border: 'none', borderBottom: '2px solid var(--dark)',
    background: 'transparent', cursor: 'pointer', fontSize: 13, color: 'var(--dark)',
    fontWeight: 700, marginBottom: -2, minHeight: 44,
  },
  section: { paddingTop: 4 },
  empty: { color: 'var(--muted)', fontSize: 13, padding: '24px 0', textAlign: 'center' as const },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  th: {
    textAlign: 'left' as const, padding: '8px 12px',
    borderBottom: '2px solid var(--line)', color: 'var(--muted)', fontWeight: 600, fontSize: 12,
  },
  tdLabel: { padding: '10px 12px', borderBottom: '1px solid var(--line)', color: 'var(--muted)', fontSize: 12, width: '40%' },
  tdValue: { padding: '10px 12px', borderBottom: '1px solid var(--line)', fontWeight: 600, color: 'var(--dark)' },
  docBadge: { fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 8 },
}

// 모바일 상세 라벨:값 스타일
const detMob: Record<string, React.CSSProperties> = {
  row: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '10px 0', borderBottom: '1px solid var(--line)', gap: 12,
  },
  label: { fontSize: 12, color: 'var(--muted)', flexShrink: 0 },
  value: { fontSize: 13, fontWeight: 600, color: 'var(--dark)', textAlign: 'right' as const },
}
