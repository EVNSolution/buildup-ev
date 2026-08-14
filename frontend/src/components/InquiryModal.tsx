import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PhoneInput } from './PhoneInput'
import { SubsidyForm, type SubsidyInputs } from './SubsidyInputs'
import { submitInquiry } from '../api/public'
import { mapBizType } from '../lib/quoteCustomer'
import { BTN } from '../styles/buttons'

/**
 * 상담 신청 — 공개 화면(비로그인)에서 **고객 본인이** 자기 정보를 넣는 자리.
 *
 * 영업이 쓰는 「견적 저장」과 성격이 다르다:
 *   · 입력하는 사람이 정보주체 본인이다 → **동의 체크가 곧 법적 동의**다(제15조①1호)
 *   · 그래서 받는 항목을 최소로 둔다 — 연락에 필요한 것과 보조금 산정에 필요한 것뿐.
 *     생년월일·사업자번호·주소는 여기서 받지 않는다(계약 단계 항목이다).
 *
 * ⚠️ 동의를 받을 때는 **네 가지를 반드시 알려야 한다**(개인정보 보호법 제15조 제2항):
 *      ① 수집 항목  ② 이용 목적  ③ 보유·이용 기간  ④ 거부할 권리와 거부 시 불이익
 *    체크박스 한 줄만 두고 나머지를 방침 링크로 넘기면 고지 누락이 된다 —
 *    그래서 넷을 화면에 그대로 펼쳐 두고, 체크는 그 아래에 둔다.
 *
 * ⚠️ 항목·목적·기간은 **실제 동작과 같아야 한다**. 여기 적힌 항목은 이 폼이 서버로
 *    보내는 값과 일치한다(성명·휴대폰·이메일·지역·사업자 구분, 선택으로 남기실 말씀).
 *    보유 기간 문구는 처리방침 제4조와 같은 표현을 쓴다 — 둘이 갈리면 안 된다.
 */
const CONSENT_ITEMS: [string, string][] = [
  ['수집 항목', '성명, 휴대전화번호, 전자우편주소, 지역(시·군·구), 사업자 구분 · (선택) 남기실 말씀'],
  ['이용 목적', '상담 신청 접수, 견적 안내 및 상담 연락, 담당 영업사원 배정'],
  ['보유·이용 기간', '처리 목적 달성 시 또는 정보주체의 삭제 요청 시까지'],
]

const CONSENT_TEXT = '위 내용을 확인하였으며, 개인정보 수집·이용에 동의합니다.'
/** 거부할 권리와 그 불이익 — 동의받을 때 함께 알려야 하는 항목이다. */
const CONSENT_REFUSAL = '동의를 거부하실 수 있으며, 거부하시는 경우 상담 신청이 접수되지 않습니다.'
/** 처리방침 제3조⑤ — 만 14세 미만은 대상이 아니다. */
const CONSENT_AGE = '본 서비스는 만 14세 이상을 대상으로 합니다.'

interface Props {
  modelCode: string
  selections: Record<string, string>
  subsidy: SubsidyInputs
  onSubsidyChange: (v: SubsidyInputs) => void
  regions: string[]
  onClose: () => void
  onDone: (inquiryId: number) => void
}

export function InquiryModal({ modelCode, selections, subsidy, onSubsidyChange, regions, onClose, onDone }: Props) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [memo, setMemo] = useState('')
  const [agreed, setAgreed] = useState(false)
  /** 봇 잡이 — 화면에서 감춰 둔다. 사람은 비운 채로 보낸다. */
  const [website, setWebsite] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const filled = (v: string) => !!v.trim()
  const regionOk = subsidy.business_type === 'corporate' || !!subsidy.region_code
  const missing = [
    [filled(name), '성명'],
    [phone.replace(/\D/g, '').length >= 10, '휴대폰'],
    [/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()), '이메일'],
    // 보조금 조건은 **전부** 필수 — 하나라도 비면 화면에 보인 실구매가가 달라진다.
    // 「· 필수」라고 써 놓고 비운 채 보내지게 두면 그 표시가 거짓말이 된다.
    [regionOk, '지역'],
    [subsidy.diesel_status !== '', '경유차 폐차여부'],
    [subsidy.is_small_business !== null, '소상공인'],
    [subsidy.has_transport_license !== null, '화물자동차 운송사업허가증'],
  ].filter(([ok]) => !ok).map(([, k]) => k as string)

  const canSubmit = missing.length === 0 && agreed && !busy

  async function submit() {
    setBusy(true); setErr('')
    try {
      const { inquiry_id } = await submitInquiry({
        model_code: modelCode,
        selections,
        contact: { name: name.trim(), phone, email: email.trim(), memo: memo.trim() || undefined },
        subsidy: {
          region: subsidy.region_code,
          biz_type: mapBizType(subsidy.business_type),
          is_sosang: subsidy.is_small_business ?? false,
          has_transport_license: subsidy.has_transport_license ?? false,
          diesel_status: subsidy.diesel_status || 'none',
        },
        agreed,
        website,
      })
      onDone(inquiry_id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '상담 신청에 실패했습니다')
    } finally { setBusy(false) }
  }

  return (
    <div style={s.overlay}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <h2 style={s.h2}>상담 신청</h2>
        <p style={s.desc}>
          연락처를 남겨 주시면 확인 후 연락드립니다.
        </p>

        <div style={s.section}>연락처</div>
        <div style={s.row}>
          <label style={s.label}>성명 <span style={s.req}>· 필수</span></label>
          <input style={s.field} type="text" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div style={s.row}>
          <label style={s.label}>휴대폰 <span style={s.req}>· 필수</span></label>
          <PhoneInput value={phone} onChange={setPhone} />
        </div>
        <div style={s.row}>
          <label style={s.label}>이메일 <span style={s.req}>· 필수</span></label>
          <input style={s.field} type="email" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div style={s.row}>
          <label style={s.label}>남기실 말씀</label>
          <textarea style={s.memo} rows={2} value={memo} onChange={e => setMemo(e.target.value)} />
        </div>

        {/*
          보조금 조건 — 가격바 팝업과 **같은 폼**을 쓴다.
          여기서 고른 값이 곧 화면에 보이는 금액의 근거라, 신청 직전에 한 번 더 보여 준다.
        */}
        <div style={s.section}>보조금 조건</div>
        {/*
          여기서는 「· 필수」를 감추지 않는다 — 신청 전에 **채워야 하는 목록**이기 때문이다.
          (가격바 팝업만 감춘다. 거기는 지금 값을 바꿔 보는 자리다)
        */}
        <SubsidyForm value={subsidy} onChange={onSubsidyChange} regions={regions} compact />

        {/* 봇 잡이 — 사람 눈에 보이지 않는다 */}
        <input
          type="text" tabIndex={-1} autoComplete="off" value={website}
          onChange={e => setWebsite(e.target.value)}
          style={s.honeypot} aria-hidden
        />

        <div style={s.consentBox}>
          <div style={s.consentTitle}>개인정보 수집·이용 동의 <span style={s.req}>· 필수</span></div>
          <dl style={s.consentList}>
            {CONSENT_ITEMS.map(([k, v]) => (
              <div key={k} style={s.consentRow}>
                <dt style={s.consentKey}>{k}</dt>
                <dd style={s.consentVal}>{v}</dd>
              </div>
            ))}
          </dl>
          <label style={s.consentCheck}>
            <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} style={s.cbox} />
            <span>{CONSENT_TEXT}</span>
          </label>
          <div style={s.consentNote}>
            {CONSENT_REFUSAL} {CONSENT_AGE}{' '}
            <Link to="/privacy" target="_blank" style={s.link}>개인정보 처리방침</Link>
          </div>
        </div>

        {err && <div style={s.err}>{err}</div>}
        {!!missing.length && <div style={s.hint}>{missing.join(', ')} 을(를) 입력해 주세요.</div>}

        <div style={s.btnRow}>
          <button style={{ ...BTN.primary, flex: 1, ...(canSubmit ? null : s.btnOff) }} disabled={!canSubmit} onClick={submit}>
            {busy ? '보내는 중…' : '상담 신청'}
          </button>
          <button style={{ ...BTN.secondary, flex: 1 }} onClick={onClose} disabled={busy}>취소</button>
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--sp-4)',
  },
  modal: {
    background: '#fff', borderRadius: 'var(--r-md)', width: 'min(460px, 94vw)', maxHeight: '92vh',
    overflowY: 'auto', padding: 'var(--sp-5)', boxShadow: 'var(--shadow-2)',
  },
  h2: {
    fontSize: 'var(--fs-title)', fontWeight: 'var(--fw-title)' as React.CSSProperties['fontWeight'],
    letterSpacing: 'var(--ls-tight)', color: 'var(--dark)', margin: '0 0 var(--sp-2)',
  },
  desc: { fontSize: 'var(--fs-label)', color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 var(--sp-4)' },
  section: {
    fontSize: 'var(--fs-label)', fontWeight: 700, color: 'var(--dark)',
    borderBottom: 'var(--hairline)', paddingBottom: 6, margin: 'var(--sp-4) 0 var(--sp-3)',
  },
  row: { marginBottom: 'var(--sp-3)' },
  label: { display: 'block', fontSize: 'var(--fs-label)', color: 'var(--muted)', marginBottom: 'var(--sp-1)' },
  req: { color: 'var(--req)', fontWeight: 700 },
  field: {
    width: '100%', boxSizing: 'border-box', minHeight: 'var(--h-control)', padding: '0 var(--sp-3)',
    fontSize: 'var(--fs-body)', fontFamily: 'inherit', color: 'var(--dark)',
    border: 'var(--hairline)', borderRadius: 'var(--r-sm)', background: '#fff',
  },
  memo: {
    width: '100%', boxSizing: 'border-box', fontSize: 'var(--fs-body)', fontFamily: 'inherit',
    padding: 'var(--sp-2)', border: 'var(--hairline)', borderRadius: 'var(--r-sm)', resize: 'vertical',
  },
  honeypot: { position: 'absolute', left: -9999, width: 1, height: 1, opacity: 0 },
  // 동의 상자 — 알려야 할 넷(항목·목적·기간·거부권)을 한 덩어리로 묶어 둔다
  consentBox: {
    background: 'var(--card)', border: 'var(--hairline)', borderRadius: 'var(--r-sm)',
    padding: 'var(--sp-3)', margin: 'var(--sp-4) 0 var(--sp-3)',
  },
  consentTitle: { fontSize: 'var(--fs-label)', fontWeight: 700, color: 'var(--dark)', marginBottom: 'var(--sp-2)' },
  consentList: { margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' },
  consentRow: { display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-start' },
  consentKey: { flex: '0 0 82px', fontSize: 'var(--fs-caption)', color: 'var(--muted)', margin: 0 },
  consentVal: { flex: 1, fontSize: 'var(--fs-caption)', color: 'var(--body)', lineHeight: 1.55, margin: 0 },
  consentCheck: {
    display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-2)', cursor: 'pointer',
    fontSize: 'var(--fs-label)', fontWeight: 700, color: 'var(--dark)', lineHeight: 1.5,
    borderTop: 'var(--hairline)', marginTop: 'var(--sp-3)', paddingTop: 'var(--sp-3)',
  },
  consentNote: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', lineHeight: 1.55, marginTop: 6 },
  cbox: { width: 16, height: 16, accentColor: 'var(--lime)', flexShrink: 0, marginTop: 1 },
  link: { color: 'var(--dark)', textDecoration: 'underline' },
  err: { fontSize: 'var(--fs-label)', color: 'var(--warn)', marginBottom: 'var(--sp-2)' },
  hint: { fontSize: 'var(--fs-label)', color: 'var(--muted)', marginBottom: 'var(--sp-2)' },
  btnRow: { display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' },
  btnOff: { background: 'var(--card)', color: 'var(--muted)', border: 'var(--hairline)', cursor: 'not-allowed' },
}
