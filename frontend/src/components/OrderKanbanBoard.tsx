import { useState } from 'react'
import type { ApiOrder } from '@shared/types/index'
import { updateOrderStatus } from '../api/orders'
import { useIsMobile } from '../hooks/useIsMobile'
import { Tooltip } from './Tooltip'

const ORDER_STATUS_SEQ = ['제작착수', '구조변경', '튜닝신청', '안전검사', '튜닝승인', '인도완료'] as const
type OrderStatus = typeof ORDER_STATUS_SEQ[number]

function fmtDate(s: string | null) { return s ? s.slice(0, 10) : '—' }

interface Props {
  orders: ApiOrder[]
  onRefresh: () => void
  onError: (msg: string) => void
  onCardClick?: (orderId: number) => void
  readOnly?: boolean
}

export function OrderKanbanBoard({ orders, onRefresh, onError, onCardClick, readOnly = false }: Props) {
  const [movingId, setMovingId] = useState<number | null>(null)
  const isMobile = useIsMobile()

  async function handleMove(order: ApiOrder, direction: 'next' | 'prev') {
    const idx = ORDER_STATUS_SEQ.indexOf(order.status as OrderStatus)
    if (idx < 0) return
    const newIdx = direction === 'next' ? idx + 1 : idx - 1
    if (newIdx < 0 || newIdx >= ORDER_STATUS_SEQ.length) return
    const newStatus = ORDER_STATUS_SEQ[newIdx]!

    if (direction === 'prev') {
      if (!window.confirm(`주문 #${order.id}을(를) '${newStatus}'(으)로 되돌리시겠습니까?`)) return
    }

    setMovingId(order.id)
    try {
      await updateOrderStatus(order.id, newStatus)
      onRefresh()
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : '상태 변경 실패')
    } finally {
      setMovingId(null)
    }
  }

  const byStatus = ORDER_STATUS_SEQ.reduce<Record<string, ApiOrder[]>>((acc, s) => {
    acc[s] = orders.filter(o => o.status === s)
    return acc
  }, {} as Record<string, ApiOrder[]>)

  const colWidth = isMobile ? 170 : 160

  return (
    <div style={{ ...kb.board, WebkitOverflowScrolling: 'touch' as unknown as undefined }}>
      {ORDER_STATUS_SEQ.map((status, colIdx) => (
        <div key={status} style={{ ...kb.column, minWidth: colWidth, flex: `0 0 ${colWidth}px` }}>
          <div style={kb.colHeader}>
            <Tooltip
              text={
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 5, fontSize: 10.5, letterSpacing: 0.3 }}>진행 단계 (6단계)</div>
                  {ORDER_STATUS_SEQ.map((s, i) => (
                    <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '2px 0', fontWeight: s === status ? 700 : 400, color: s === status ? '#c8d200' : '#ccc', fontSize: 11 }}>
                      <span style={{ width: 16, textAlign: 'center', flexShrink: 0 }}>{i + 1}</span>
                      <span>{s}</span>
                      {s === status && <span style={{ fontSize: 9, color: '#c8d200' }}>← 현재</span>}
                    </div>
                  ))}
                </div>
              }
            >
              <span style={kb.colTitle}>{status}</span>
            </Tooltip>
            <span style={kb.colCount}>{byStatus[status]?.length ?? 0}</span>
          </div>
          <div style={kb.cards}>
            {(byStatus[status] ?? []).map(order => {
              const idx = ORDER_STATUS_SEQ.indexOf(order.status as OrderStatus)
              const isFirst = idx === 0
              const isLast  = idx === ORDER_STATUS_SEQ.length - 1
              const busy    = movingId === order.id
              return (
                <div
                  key={order.id}
                  style={{ ...kb.card, cursor: onCardClick ? 'pointer' : 'default' }}
                  onClick={e => { if ((e.target as HTMLElement).tagName !== 'BUTTON') onCardClick?.(order.id) }}
                >
                  <div style={kb.cardId}>주문 #{order.id}</div>
                  <div style={kb.cardCustomer}>{order.quote.customer?.name ?? '고객없음'}</div>
                  <div style={kb.cardModel}>{order.quote.model_code}</div>
                  <div style={kb.cardMeta}>{order.maker_org?.name ?? '특장사없음'}</div>
                  {order.assigned_at && <div style={kb.cardDate}>배정 {fmtDate(order.assigned_at)}</div>}
                  {!readOnly && (
                    <div style={kb.btnRow}>
                      {!isFirst && (
                        <button
                          style={{
                            ...(busy ? kb.revBtnDisabled : kb.revBtn),
                            ...(isMobile ? { minHeight: 44, fontSize: 12 } : {}),
                          }}
                          disabled={busy}
                          onClick={() => handleMove(order, 'prev')}
                          title={`← ${ORDER_STATUS_SEQ[colIdx - 1]}`}
                        >
                          {busy ? '…' : '← 되돌리기'}
                        </button>
                      )}
                      {!isLast && (
                        <button
                          style={{
                            ...(busy ? kb.advBtnDisabled : kb.advBtn),
                            ...(isMobile ? { minHeight: 44, fontSize: 12 } : {}),
                          }}
                          disabled={busy}
                          onClick={() => handleMove(order, 'next')}
                        >
                          {busy ? '처리 중…' : '다음 단계 →'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

const kb: Record<string, React.CSSProperties> = {
  board: { display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8, alignItems: 'flex-start' },
  column: { minWidth: 160, flex: '0 0 160px', display: 'flex', flexDirection: 'column', gap: 8 },
  colHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '6px 10px', background: 'var(--card)', borderRadius: 8,
    border: '1px solid var(--line)',
  },
  colTitle: { fontSize: 12, fontWeight: 700, color: 'var(--dark)' },
  colCount: {
    fontSize: 11, fontWeight: 700, background: 'var(--lime)', color: 'var(--dark)',
    borderRadius: 10, padding: '1px 7px', minWidth: 20, textAlign: 'center',
  },
  cards: { display: 'flex', flexDirection: 'column', gap: 8 },
  card: {
    border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px',
    background: '#fff', display: 'flex', flexDirection: 'column', gap: 5,
  },
  cardId: { fontSize: 10, color: 'var(--muted)' },
  cardCustomer: { fontSize: 13, fontWeight: 700, color: 'var(--dark)' },
  cardModel: { fontSize: 11, color: 'var(--muted)' },
  cardMeta: { fontSize: 11, color: 'var(--muted)' },
  cardDate: { fontSize: 10, color: 'var(--muted)' },
  btnRow: { display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' as const },
  advBtn: {
    flex: 1, fontSize: 11, padding: '5px 0', border: 'none', borderRadius: 6,
    background: 'var(--lime)', color: 'var(--dark)', cursor: 'pointer', fontWeight: 700,
  },
  advBtnDisabled: {
    flex: 1, fontSize: 11, padding: '5px 0', border: 'none', borderRadius: 6,
    background: 'var(--card)', color: 'var(--muted)', cursor: 'not-allowed',
  },
  revBtn: {
    flex: 1, fontSize: 11, padding: '5px 0', border: '1px solid var(--line)', borderRadius: 6,
    background: '#fff', color: 'var(--muted)', cursor: 'pointer',
  },
  revBtnDisabled: {
    flex: 1, fontSize: 11, padding: '5px 0', border: '1px solid var(--line)', borderRadius: 6,
    background: 'var(--card)', color: 'var(--muted)', cursor: 'not-allowed',
  },
}
