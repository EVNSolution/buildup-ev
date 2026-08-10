import { useState } from 'react'
import { PhoneInput } from './PhoneInput'
import { SubsidyForm, type SubsidyInputs } from './SubsidyInputs'
import type { CustomerInfo } from '@shared/types/index'

/**
 * 견적 저장 모달 — **견적서·계약서에 필요한 고객 정보를 전부 여기서** 받는다.
 *
 * 예전에는 영업페이지에 들어오자마자 「고객 정보 입력」 팝업이 떴다. 옵션만 둘러보려는
 * 경우에도 매번 막아서, 입력 시점을 실제로 필요한 저장 단계로 옮겼다.
 *
 * 「사업자 구분」이 **맨 위**에 있는 이유: 이 값에 따라 아래 입력란 구성이 바뀐다
 * (법인이면 「상호 + 대표이사」, 그 외에는 「성명」 한 칸). 먼저 고르지 않으면 되묻게 된다.
 *
 * 보조금 조건(지역·소상공인·화물운송·경유차)은 가격바 「보조금」 팝업에서도 고칠 수 있는
 * **같은 값**이다. 여기서는 저장 직전 확인·수정용으로 함께 보여준다.
 */
export interface QuoteSaveValues {
  subsidy: SubsidyInputs
  name: string
  ceo_name: string
  email: string
  phone: string
  address: string
  contract_party: string
  buyer_agent: string
  buyer_relation: string
  buyer_regno: string
  buyer_tel: string
}

export function emptyQuoteSaveValues(subsidy: SubsidyInputs): QuoteSaveValues {
  return {
    subsidy, name: '', ceo_name: '', email: '', phone: '', address: '',
    contract_party: '', buyer_agent: '', buyer_relation: '', buyer_regno: '', buyer_tel: '',
  }
}

/** 이전 입력값(다시 열었을 때 유지) → 폼 초기값. */
export function valuesFromCustomer(c: CustomerInfo | null, subsidy: SubsidyInputs): QuoteSaveValues {
  if (!c) return emptyQuoteSaveValues(subsidy)
  return {
    subsidy,
    name: c.name ?? '',
    ceo_name: c.ceo_name ?? '',
    email: c.email ?? '',
    phone: c.phone ?? '',
    address: c.address ?? '',
    contract_party: c.contract_party ?? '',
    buyer_agent: c.buyer_agent ?? '',
    buyer_relation: c.buyer_relation ?? '',
    buyer_regno: c.buyer_regno ?? '',
    buyer_tel: c.buyer_tel ?? '',
  }
}

interface Props {
  initial: QuoteSaveValues
  regions: string[]
  saving: boolean
  error: string
  onSave: (v: QuoteSaveValues) => void
  onClose: () => void
  /**
   * 'create' = 견적 저장 / 'edit' = 저장된 견적의 고객정보 수정.
   * 입력 구성이 완전히 같아 같은 폼을 쓴다 — 저장·수정 화면이 따로 놀면 한쪽만 낡는다.
   */
  mode?: 'create' | 'edit'
}

export function QuoteSaveModal({ initial, regions, saving, error, onSave, onClose, mode = 'create' }: Props) {
  const [v, setV] = useState<QuoteSaveValues>(initial)
  const set = <K extends keyof QuoteSaveValues>(k: K, val: QuoteSaveValues[K]) => setV(p => ({ ...p, [k]: val }))

  const isEdit = mode === 'edit'
  const isCorporate = v.subsidy.business_type === 'corporate'
  // 법인은 대표이사가 있어야 계약서 서명란이 채워진다(백엔드도 같은 이유로 렌더를 막는다).
  const missingCeo = isCorporate && !v.ceo_name.trim()
  const canSave = !!v.name.trim() && !missingCeo && !saving

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <h2 style={s.h2}>{isEdit ? '고객정보 수정' : '견적 저장'}</h2>
        <p style={s.desc}>
          {isEdit
            ? '고친 값은 견적서·계약서에 즉시 반영됩니다. 사업자 구분·지역을 바꾸면 보조금이 다시 계산됩니다.'
            : '견적서·계약서에 들어갈 정보입니다. 저장 후에도 견적 목록의 «고객정보» 에서 고칠 수 있습니다.'}
        </p>

        <div style={s.sectionTitle}>고객 정보</div>
        {/* 사업자 구분이 맨 위 — 아래 입력란 구성이 이 값에 따라 달라진다 */}
        <SubsidyForm value={v.subsidy} onChange={x => set('subsidy', x)} regions={regions} />

        <div style={s.row}>
          <label style={s.label}>{isCorporate ? '상호' : '성명'} <span style={s.req}>· 필수</span></label>
          <input style={s.field} type="text" value={v.name} onChange={e => set('name', e.target.value)} />
        </div>

        {isCorporate && (
          <div style={s.row}>
            <label style={s.label}>대표이사 <span style={s.req}>· 계약서 서명란</span></label>
            <input style={s.field} type="text" value={v.ceo_name} onChange={e => set('ceo_name', e.target.value)} />
            {missingCeo && (
              <div style={s.warn}>
                대표이사를 입력해야 저장할 수 있습니다 — 법인 계약서는 서명란 3곳이 대표이사 이름으로 채워집니다.
              </div>
            )}
          </div>
        )}

        <div style={s.row}>
          <label style={s.label}>휴대폰</label>
          <PhoneInput value={v.phone} onChange={x => set('phone', x)} boxStyle={s.field} />
        </div>
        <div style={s.row}>
          <label style={s.label}>이메일</label>
          <input style={s.field} type="email" value={v.email} onChange={e => set('email', e.target.value)} />
        </div>
        <div style={s.row}>
          <label style={s.label}>세부주소 <span style={s.req}>· 지역 뒤에 붙어 계약서 주소가 된다</span></label>
          <input style={s.field} type="text" value={v.address} onChange={e => set('address', e.target.value)} />
        </div>

        <div style={s.sectionTitle}>계약서 정보 <span style={s.optional}>(선택 — 비우면 계약서에 공란)</span></div>
        <div style={s.row}>
          <label style={s.label}>계약처</label>
          <input style={s.field} type="text" value={v.contract_party} onChange={e => set('contract_party', e.target.value)} />
        </div>
        <div style={s.row}>
          <label style={s.label}>{isCorporate ? '사업자번호' : '생년월일 / 사업자번호'}</label>
          <input style={s.field} type="text" value={v.buyer_regno} onChange={e => set('buyer_regno', e.target.value)} />
        </div>
        <div style={s.row}>
          <label style={s.label}>전화번호 <span style={s.req}>· 유선</span></label>
          <PhoneInput value={v.buyer_tel} onChange={x => set('buyer_tel', x)} boxStyle={s.field} />
        </div>
        <div style={s.row}>
          <label style={s.label}>대리인 <span style={s.req}>· 위임장 필수</span></label>
          <input style={s.field} type="text" value={v.buyer_agent} onChange={e => set('buyer_agent', e.target.value)} />
        </div>
        <div style={s.row}>
          <label style={s.label}>관계</label>
          <input style={s.field} type="text" value={v.buyer_relation} onChange={e => set('buyer_relation', e.target.value)} />
        </div>

        {error && <div style={s.error}>{error}</div>}

        <div style={s.btnRow}>
          <button style={{ ...s.btnOk, ...(canSave ? null : s.btnOff) }} onClick={() => canSave && onSave(v)} disabled={!canSave}>
            {saving ? '저장 중…' : isEdit ? '저장' : '견적 저장'}
          </button>
          <button style={s.btnCancel} onClick={onClose} disabled={saving}>취소</button>
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(20,20,20,.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
  },
  modal: {
    background: '#fff', borderRadius: 16, width: 440, maxWidth: '92vw', maxHeight: '90vh',
    overflowY: 'auto', padding: 22, boxShadow: '0 10px 40px rgba(0,0,0,.25)',
  },
  h2: { margin: '0 0 4px', fontSize: 18, color: 'var(--dark)' },
  desc: { margin: '0 0 16px', fontSize: 12.5, color: 'var(--muted)' },
  sectionTitle: {
    fontSize: 12, fontWeight: 700, color: 'var(--dark)',
    margin: '16px 0 10px', paddingBottom: 5, borderBottom: '1px solid var(--line)',
  },
  optional: { fontSize: 10.5, fontWeight: 400, color: '#b0b7c0' },
  row: { marginBottom: 12 },
  label: { display: 'block', fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 },
  req: { fontSize: 10.5, color: '#b0b7c0' },
  field: {
    width: '100%', boxSizing: 'border-box', height: 38, padding: '0 10px', fontSize: 13,
    fontFamily: 'inherit', color: 'var(--dark)', border: '1px solid var(--line)',
    borderRadius: 8, background: '#fff', outline: 'none',
  },
  warn: { fontSize: 11, color: '#c0392b', marginTop: 5 },
  error: { fontSize: 12, color: '#c0392b', marginTop: 12 },
  btnRow: { display: 'flex', gap: 8, marginTop: 18 },
  btnOk: {
    flex: 1, fontSize: 13.5, fontWeight: 700, padding: 12, borderRadius: 9,
    cursor: 'pointer', border: 'none', background: 'var(--lime)', color: 'var(--dark)',
  },
  btnOff: { opacity: .5, cursor: 'not-allowed' },
  btnCancel: {
    flex: 1, fontSize: 13.5, fontWeight: 700, padding: 12, borderRadius: 9,
    cursor: 'pointer', border: '1px solid var(--line)', background: '#fff', color: 'var(--muted)',
  },
}
