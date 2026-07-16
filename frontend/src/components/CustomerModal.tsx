import { useEffect, useState } from 'react'
import type { CustomerInfo } from '@shared/types/index'
import { fetchRegions } from '../api/quotes'

interface Props {
  onComplete: (info: CustomerInfo) => void
  onSkip: () => void
}

export function CustomerModal({ onComplete, onSkip }: Props) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [businessType, setBusinessType] = useState<CustomerInfo['business_type']>('individual')
  const [regions, setRegions] = useState<string[]>([])
  const [region, setRegion] = useState('')
  const [isSmallBiz, setIsSmallBiz] = useState(false)
  const [hasTransportLicense, setHasTransportLicense] = useState(false)
  const [isDieselConversion, setIsDieselConversion] = useState(false)

  useEffect(() => {
    fetchRegions().then(list => {
      setRegions(list)
      if (list.length > 0) setRegion(list[0]!)
    })
  }, [])

  function handleComplete() {
    onComplete({
      name: name || '고객',
      email: email || undefined,
      phone: phone || undefined,
      business_type: businessType,
      region_code: region,
      is_small_business: isSmallBiz,
      has_transport_license: hasTransportLicense,
      is_diesel_conversion: isDieselConversion,
    })
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <h2 style={styles.h2}>고객 정보 입력</h2>
        <p style={styles.desc}>
          견적·보조금 산정을 위해 먼저 입력해 주세요. 건너뛰면 보조금 미반영 참고 견적만 확인할 수 있습니다.
        </p>

        <div style={styles.row}>
          <label style={styles.label}>고객명</label>
          <input
            type="text"
            placeholder="예: 범석환"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>

        <div style={styles.row}>
          <label style={styles.label}>이메일 <span style={styles.optional}>(선택 · 견적서 발송 시 사용)</span></label>
          <input
            type="email"
            placeholder="customer@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
        </div>

        <div style={styles.row}>
          <label style={styles.label}>연락처 <span style={styles.optional}>(선택)</span></label>
          <input
            type="tel"
            placeholder="010-0000-0000"
            value={phone}
            onChange={e => setPhone(e.target.value)}
          />
        </div>

        <div style={styles.row}>
          <label style={styles.label}>사업자 구분</label>
          <select value={businessType} onChange={e => setBusinessType(e.target.value as CustomerInfo['business_type'])}>
            <option value="individual">개인사업자</option>
            <option value="corporate">법인사업자</option>
            <option value="simplified">간이과세자</option>
          </select>
        </div>

        <div style={styles.row}>
          <label style={styles.label}>지역 (보조금 산정)</label>
          <select value={region} onChange={e => setRegion(e.target.value)} disabled={regions.length === 0}>
            {regions.length === 0
              ? <option>지역 목록 로딩 중…</option>
              : regions.map(r => <option key={r} value={r}>{r}</option>)
            }
          </select>
        </div>

        <label style={styles.check}>
          <input type="checkbox" checked={isSmallBiz} onChange={e => setIsSmallBiz(e.target.checked)} style={styles.checkbox} />
          소상공인 (국고 30% 추가 할인)
        </label>
        <label style={styles.check}>
          <input type="checkbox" checked={hasTransportLicense} onChange={e => setHasTransportLicense(e.target.checked)} style={styles.checkbox} />
          화물자동차 운송사업허가증 (개인사업자 택배 국고 10% 추가)
        </label>
        <label style={styles.check}>
          <input type="checkbox" checked={isDieselConversion} onChange={e => setIsDieselConversion(e.target.checked)} style={styles.checkbox} />
          경유차 유지 후 전기차 전환 (법인 −50만)
        </label>

        <div style={styles.btnRow}>
          <button style={styles.btnOk} onClick={handleComplete} disabled={regions.length === 0 || !region}>입력 완료</button>
          <button style={styles.btnSkip} onClick={onSkip}>건너뛰기 (보기만)</button>
        </div>
      </div>
    </div>
  )
}

const styles = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(20,20,20,.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  modal: {
    background: '#fff',
    borderRadius: 16,
    width: 420,
    maxWidth: '92vw',
    maxHeight: '90vh',
    overflowY: 'auto' as const,
    padding: 22,
    boxShadow: '0 10px 40px rgba(0,0,0,.25)',
  },
  h2: { margin: '0 0 4px', fontSize: 18, color: 'var(--dark)' },
  desc: { margin: '0 0 16px', fontSize: 12.5, color: 'var(--muted)' },
  row: { marginBottom: 12 },
  label: { display: 'block', fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 },
  optional: { fontSize: 10.5, color: '#b0b7c0' },
  check: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    cursor: 'pointer',
    padding: '5px 0',
  } as React.CSSProperties,
  checkbox: { width: 16, height: 16, accentColor: 'var(--lime)' } as React.CSSProperties,
  btnRow: { display: 'flex', gap: 8, marginTop: 18 },
  btnOk: {
    flex: 1, fontSize: 13.5, fontWeight: 700, padding: 12, borderRadius: 9,
    cursor: 'pointer', border: 'none', background: 'var(--lime)', color: 'var(--dark)',
  } as React.CSSProperties,
  btnSkip: {
    flex: 1, fontSize: 13.5, fontWeight: 700, padding: 12, borderRadius: 9,
    cursor: 'pointer', border: '1px solid var(--line)', background: '#fff', color: 'var(--muted)',
  } as React.CSSProperties,
}
