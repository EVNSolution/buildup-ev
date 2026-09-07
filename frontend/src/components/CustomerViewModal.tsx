import type { ApiQuote } from '@shared/types/index'
import { t } from '../i18n'
import { EmailLogFor } from './EmailLog'
import { useEscapeClose } from '../lib/escClose'

// ── 고객정보 조회 (읽기 전용) ─────────────────────────────────────────────
//
// 관리자는 견적을 **고치지 않는다**. 계약서·견적서에 어떤 값이 들어갔는지 확인만 하면 되므로
// 영업의 「수정」 폼을 그대로 쓰지 않고, 같은 항목을 읽기 전용으로 보여준다.
// 값은 견적 저장 시 함께 굳어진 입력 스냅샷(quote.inputs)과 고객 마스터에서 그대로 읽는다.
const BIZ_KO: Record<string, string> = {
  individual: '개인사업자', corporate: '법인사업자', simplified: '간이과세자', personal: '개인',
}
const DIESEL_KO: Record<string, string> = {
  none: '경유차 없음', keep: '경유차 유지 후 전기차 전환', scrap: '경유차 폐차 후 전기차 전환',
}

export interface ViewGroup { title: string; rows: [string, string][] }

/**
 * 견적 한 건의 값을 **읽기 전용 묶음**으로 편다.
 *
 * 관리자의 「고객정보」 팝업과 영업의 「배정 문의 수락」 팝업이 같은 것을 본다 —
 * 따로 만들면 한쪽에만 항목이 늘어난다(실제로 사업자 구분이 한쪽에만 있었다).
 */
export function customerViewGroups(quote: ApiQuote): ViewGroup[] {
  const inp = (quote.inputs ?? {}) as Record<string, unknown>
  /** 견적 입력값 한 칸 — 빈 값은 빈 글자로. (이름이 `t` 였는데 번역 함수와 겹쳐 바꿨다) */
  const val = (k: string) => { const v = inp[k]; return v == null || v === '' ? '' : String(v) }
  const isCorp = val('biz_type') === 'corporate'
  const yn = (k: string) => (inp[k] === true ? '예' : '아니오')

  return [
    {
      title: '고객',
      rows: [
        [isCorp ? '상호' : '성명', quote.customer?.name ?? ''],
        ...(isCorp ? [['대표이사', val('ceo_name')] as [string, string]] : []),
        ['사업자 구분', BIZ_KO[val('biz_type')] ?? val('biz_type')],
        ['연락처', quote.customer?.phone ?? ''],
        ['이메일', quote.customer?.email ?? ''],
        ['세부주소', quote.customer?.address ?? ''],
      ],
    },
    {
      title: '보조금 조건',
      rows: [
        ['지역', val('region')],
        ['소상공인', yn('is_sosang')],
        ['화물운송 허가', yn('has_transport_license')],
        ['경유차', DIESEL_KO[val('diesel_status')] ?? val('diesel_status')],
      ],
    },
    {
      title: '계약서 정보',
      rows: [
        ['계약 당사자', val('contract_party')],
        [isCorp ? '사업자번호' : '생년월일', val('buyer_regno')],
        ['유선번호', val('buyer_tel')],
        ['대리인', val('buyer_agent')],
        ['관계', val('buyer_relation')],
      ],
    },
    {
      title: '결제 조건',
      rows: [
        ['선수금 비율', val('down_payment_rate') ? `${Math.round(Number(val('down_payment_rate')) * 100)}%` : ''],
        ['할부 개월', val('installment_months') === '0' ? '일시불' : (val('installment_months') ? `${val('installment_months')}개월` : '')],
        ['메모', val('memo')],
      ],
    },
  ]
}

export function CustomerViewModal({ quote, onClose }: { quote: ApiQuote; onClose: () => void }) {
  // Esc 로도 닫힌다 — 바깥 클릭과 닫기 버튼은 둘 다 마우스가 필요한 길이다
  useEscapeClose(onClose)
  const groups = customerViewGroups(quote)
  return (
    <div style={modal.overlay} onClick={onClose}>
      <div style={{ ...modal.box, width: 520, maxHeight: '82vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={modal.title}>고객 정보 — {quote.quote_no ?? `#${quote.id}`}</div>
        <div style={modal.desc}>{t('조회 전용입니다. 값을 고치려면 영업 견적 목록의 「수정」을 이용하세요.')}</div>
        {groups.map(g => (
          <div key={g.title}>
            <div style={cv.groupTitle}>{g.title}</div>
            <table style={cv.table}>
              <tbody>
                {g.rows.map(([label, value]) => (
                  <tr key={label}>
                    <td style={cv.tdLabel}>{label}</td>
                    <td style={value ? cv.tdValue : cv.tdEmpty}>{value || '입력 없음'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {/*
          메일로 무엇을 보냈는지 — 관리자는 **조회만** 한다(발송은 영업 업무).
          목록에 열을 더하지 않고 여기서 본다.
        */}
        <EmailLogFor quoteId={quote.id} />

        <div style={modal.actions}>
          <button style={modal.confirmBtn} onClick={onClose}>{t('닫기')}</button>
        </div>
      </div>
    </div>
  )
}

const cv: Record<string, React.CSSProperties> = {
  groupTitle: { fontSize: 12, fontWeight: 700, color: 'var(--muted)', margin: '4px 0 6px' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  tdLabel: { padding: '6px 10px 6px 0', color: 'var(--muted)', width: 110, verticalAlign: 'top', whiteSpace: 'nowrap' },
  tdValue: { padding: '6px 0', color: 'var(--dark)', wordBreak: 'break-all' },
  tdEmpty: { padding: '6px 0', color: 'var(--muted)' },
}

const modal: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'var(--scrim)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  box: { background: '#fff', borderRadius: 14, padding: '28px 32px', width: 400, maxWidth: '90vw', display: 'flex', flexDirection: 'column', gap: 16 },
  title: { fontSize: 16, fontWeight: 700, color: 'var(--dark)' },
  desc: { fontSize: 13, color: 'var(--muted)' },
  actions: { display: 'flex', gap: 10, justifyContent: 'flex-end' },
  confirmBtn: { padding: '9px 20px', border: 'none', borderRadius: 9, background: 'var(--dark)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' },
}
