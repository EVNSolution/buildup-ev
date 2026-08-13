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
 * ⚠️ 동의 문구는 **아직 확정 전이다**(아래 CONSENT_TEXT). 자리만 잡아 두었다.
 *    공개 전에 문구를 확정해 넣고, 처리방침(/privacy) 링크를 노출해야 한다.
 */
const CONSENT_TEXT = '[문구 확정 전] 개인정보 수집·이용에 동의합니다.'

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
    [regionOk, '지역'],
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
          지금 고르신 사양과 금액이 그대로 담당자에게 전달됩니다. 연락처를 남겨 주시면 확인 후 연락드립니다.
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
          <label style={s.label}>남기실 말씀 <span style={s.opt}>· 선택</span></label>
          <textarea style={s.memo} rows={2} value={memo} onChange={e => setMemo(e.target.value)} />
        </div>

        {/*
          보조금 조건 — 가격바 팝업과 **같은 폼**을 쓴다.
          여기서 고른 값이 곧 화면에 보이는 금액의 근거라, 신청 직전에 한 번 더 보여 준다.
        */}
        <div style={s.section}>보조금 조건</div>
        <SubsidyForm value={subsidy} onChange={onSubsidyChange} regions={regions} compact hideRequired />

        {/* 봇 잡이 — 사람 눈에 보이지 않는다 */}
        <input
          type="text" tabIndex={-1} autoComplete="off" value={website}
          onChange={e => setWebsite(e.target.value)}
          style={s.honeypot} aria-hidden
        />

        <label style={s.consent}>
          <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} style={s.cbox} />
          <span>
            {CONSENT_TEXT}{' '}
            <Link to="/privacy" target="_blank" style={s.link}>개인정보 처리방침</Link>
          </span>
        </label>

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
  h2: { fontSize: 'var(--fs-title)', fontWeight: 700, color: 'var(--dark)', margin: '0 0 var(--sp-2)' },
  desc: { fontSize: 'var(--fs-label)', color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 var(--sp-4)' },
  section: {
    fontSize: 'var(--fs-label)', fontWeight: 700, color: 'var(--dark)',
    borderBottom: 'var(--hairline)', paddingBottom: 6, margin: 'var(--sp-4) 0 var(--sp-3)',
  },
  row: { marginBottom: 'var(--sp-3)' },
  label: { display: 'block', fontSize: 'var(--fs-label)', color: 'var(--muted)', marginBottom: 5 },
  req: { color: '#c0392b', fontWeight: 700 },
  opt: { color: '#b0b7c0' },
  field: {
    width: '100%', boxSizing: 'border-box', minHeight: 'var(--h-control)', padding: '0 10px',
    fontSize: 'var(--fs-body)', fontFamily: 'inherit', color: 'var(--dark)',
    border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', background: '#fff',
  },
  memo: {
    width: '100%', boxSizing: 'border-box', fontSize: 'var(--fs-body)', fontFamily: 'inherit',
    padding: 8, border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', resize: 'vertical',
  },
  honeypot: { position: 'absolute', left: -9999, width: 1, height: 1, opacity: 0 },
  consent: {
    display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer',
    fontSize: 'var(--fs-label)', color: 'var(--body)', lineHeight: 1.5,
    background: 'var(--card)', borderRadius: 'var(--r-sm)', padding: 'var(--sp-3)',
    margin: 'var(--sp-4) 0 var(--sp-3)',
  },
  cbox: { width: 16, height: 16, accentColor: 'var(--lime)', flexShrink: 0, marginTop: 1 },
  link: { color: 'var(--dark)', textDecoration: 'underline' },
  err: { fontSize: 'var(--fs-label)', color: 'var(--warn)', marginBottom: 'var(--sp-2)' },
  hint: { fontSize: 'var(--fs-label)', color: 'var(--muted)', marginBottom: 'var(--sp-2)' },
  btnRow: { display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' },
  btnOff: { background: 'var(--card)', color: 'var(--muted)', border: 'var(--hairline)', cursor: 'not-allowed' },
}
