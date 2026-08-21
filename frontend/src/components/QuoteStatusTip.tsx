/**
 * 견적 상태 설명 — 목록의 상태 뱃지에 붙는 말풍선.
 *
 * ⚠️ **한 벌만 둔다.** 예전에는 영업 화면과 관리자 화면이 각자 복사본을 갖고 있었고,
 *    그러다 한쪽 설명글자만 12px 로 커져(다른 쪽은 9.5px) **영업 화면에서만 줄이 접혔다.**
 *    같은 것을 두 벌 두면 이런 식으로 조용히 갈린다.
 */
import { TIP_WIDTH } from './Tooltip'

export const QUOTE_STATUS_FLOW = [
  { key: 'draft',      label: '임시저장', desc: '작성 중인 견적' },
  { key: 'confirmed',  label: '견적완료', desc: '견적서 생성 완료' },
  { key: 'contracted', label: '계약완료', desc: '전자서명 완료' },
  { key: 'assigned',   label: '배정완료', desc: '관리자가 특장사 배정' },
  { key: 'ordered',    label: '주문진행', desc: '특장사 수락 · 제작 진행' },
  { key: 'completed',  label: '완료',     desc: '특장사 전 공정 완료' },
] as const

/** 이 설명창이 필요한 폭 — `<Tooltip maxWidth={QUOTE_TIP_WIDTH}>` 로 함께 넘긴다. */
export const QUOTE_TIP_WIDTH = TIP_WIDTH.wide

export function quoteStatusTip(status: string): React.ReactNode {
  return (
    <div>
      <div style={s.title}>견적 상태</div>
      {QUOTE_STATUS_FLOW.map((s2, i) => {
        const on = s2.key === status
        return (
          <div key={s2.key} style={on ? s.rowOn : s.row}>
            <span style={s.num}>{i + 1}</span>
            <span style={s.label}>{s2.label}</span>
            {/*
              「← 현재」는 **이름 바로 뒤**에 붙인다. 줄 끝에 두면 설명글이 접힐 때
              혼자 떨어져 나가, 어느 단계가 지금인지 읽기 어려워진다.
            */}
            {on && <span style={s.cur}>← 현재</span>}
            {/* 접힐 수 있는 것은 설명글 하나뿐이다 — 접혀도 줄이 무너지지 않는다 */}
            <span style={s.desc}>({s2.desc})</span>
          </div>
        )
      })}
      {status === 'expired' && <div style={s.expired}>만료/취소된 견적입니다</div>}
    </div>
  )
}

const rowBase: React.CSSProperties = {
  display: 'flex',
  // 글자 크기가 섞인 줄이라 가운데 정렬하면 설명글이 접혔을 때 번호가 허공에 뜬다
  alignItems: 'baseline',
  gap: 5,
  padding: '2px 0',
  fontSize: 11,
}

const s: Record<string, React.CSSProperties> = {
  title: { fontWeight: 700, marginBottom: 5, fontSize: 10.5, letterSpacing: 0.3 },
  row: { ...rowBase, fontWeight: 400, color: 'var(--line)' },
  rowOn: { ...rowBase, fontWeight: 700, color: 'var(--lime)' },
  num: { width: 16, textAlign: 'center', flexShrink: 0 },
  label: { flexShrink: 0 },
  cur: { fontSize: 9, color: 'var(--lime)', flexShrink: 0 },
  desc: { fontSize: 9.5, color: 'var(--muted)', marginLeft: 'var(--sp-1)', flex: 1, minWidth: 0 },
  expired: { fontSize: 10, color: 'var(--warn)', marginTop: 5 },
}
