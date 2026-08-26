import { useEffect, useState } from 'react'
import { fetchEmailLog, type EmailLogRow } from '../api/email'

/**
 * 발송 이력 — **무엇을 보냈는지**가 핵심이다.
 *
 * 「보냈다」만으로는 부족하다. 견적서만 보낸 건과 계약서까지 보낸 건이 섞이면
 * 「그 고객에게 계약서까지 보냈던가」를 사람 기억에 맡기게 된다.
 * 어느 판을 보냈는지 가리도록 **견적번호와 날짜**를 함께 적는다.
 */
export function EmailLog({ rows }: { rows: EmailLogRow[] | null }) {
  if (rows === null) return null
  if (rows.length === 0) return <div style={e.logEmpty}>아직 보낸 적이 없습니다.</div>
  return (
    <div style={e.logBox}>
      <div style={e.logTitle}>보낸 기록</div>
      {rows.map(r => (
        <div key={r.id} style={e.logRow}>
          <span style={r.withContract ? e.tagBoth : e.tagQuote}>
            {r.withContract ? '견적서+계약서' : '견적서만'}
          </span>
          <span style={e.logNo}>{r.quoteNo ?? '번호 없음'}</span>
          <span style={e.logDate}>{r.sentAt.slice(0, 16).replace('T', ' ')}</span>
          <span style={e.logTo} title={`${r.to} · 보낸 사람 ${r.sentBy}`}>{r.to}</span>
        </div>
      ))}
    </div>
  )
}


const e: Record<string, React.CSSProperties> = {
  logBox: { marginTop: 14, borderTop: '0.5px solid var(--line)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 5 },
  logTitle: { fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--muted)' },
  logEmpty: { marginTop: 14, borderTop: '0.5px solid var(--line)', paddingTop: 10, fontSize: 11, color: 'var(--muted)' },
  logRow: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--muted)' },
  /* 무엇을 보냈는지가 한눈에 갈려야 한다 — 계약서까지 보낸 건은 더 무겁게 */
  tagBoth: { fontWeight: 700, color: 'var(--dark)', background: 'var(--lime-bg)', border: '0.5px solid var(--lime)', borderRadius: 3, padding: '0 5px', whiteSpace: 'nowrap' },
  tagQuote: { fontWeight: 700, color: 'var(--muted)', background: 'var(--card)', border: '0.5px solid var(--line)', borderRadius: 3, padding: '0 5px', whiteSpace: 'nowrap' },
  logNo: { fontVariantNumeric: 'tabular-nums', color: 'var(--dark)', whiteSpace: 'nowrap' },
  logDate: { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  logTo: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
}

/** 스스로 불러오는 판 — 관리자 「고객정보」처럼 이력만 필요한 곳에서 쓴다. */
export function EmailLogFor({ quoteId }: { quoteId: number }) {
  const [rows, setRows] = useState<EmailLogRow[] | null>(null)
  useEffect(() => { fetchEmailLog(quoteId).then(setRows).catch(() => setRows([])) }, [quoteId])
  return <EmailLog rows={rows} />
}
