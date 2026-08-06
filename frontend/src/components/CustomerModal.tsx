import { useEffect, useRef, useState } from 'react'
import type { CustomerInfo } from '@shared/types/index'
import { fetchRegions } from '../api/quotes'

interface Props {
  onComplete: (info: CustomerInfo) => void
  onSkip: () => void
  /** 이미 입력한 고객정보 — 다시 열었을 때 기존 값이 남아있게 한다. */
  initial?: CustomerInfo | null
}

export function CustomerModal({ onComplete, onSkip, initial }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [businessType, setBusinessType] = useState<CustomerInfo['business_type']>(initial?.business_type ?? 'individual')
  const [regions, setRegions] = useState<string[]>([])
  const [region, setRegion] = useState(initial?.region_code ?? '')
  const [isSmallBiz, setIsSmallBiz] = useState(initial?.is_small_business ?? false)
  const [hasTransportLicense, setHasTransportLicense] = useState(initial?.has_transport_license ?? false)
  const [isDieselConversion, setIsDieselConversion] = useState(initial?.is_diesel_conversion ?? false)

  useEffect(() => {
    fetchRegions().then(list => {
      setRegions(list)
      // 기존 선택 지역이 있으면 유지, 없을 때만 첫 항목
      setRegion(prev => (prev && list.includes(prev) ? prev : (list[0] ?? '')))
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
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>

        <div style={styles.row}>
          <label style={styles.label}>이메일 <span style={styles.optional}>(선택 · 견적서 발송 시 사용)</span></label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
        </div>

        <div style={styles.row}>
          <label style={styles.label}>연락처 <span style={styles.optional}>(선택)</span></label>
          <input
            type="tel"
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
            <option value="consumer">일반구매자 (부가세 환급 불가)</option>
          </select>
        </div>

        <div style={styles.row}>
          <label style={styles.label}>지역 (보조금 산정)</label>
          <RegionPicker regions={regions} value={region} onChange={setRegion} />
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


/** 지역 검색 선택 — 161개 목록이라 입력으로 좁혀서 고른다. 목록에 있는 값만 선택됨. */
function RegionPicker({ regions, value, onChange }: {
  regions: string[]
  value: string
  onChange: (v: string) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  // 바깥 클릭 시 닫기
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const q = query.trim().replace(/\s+/g, '')
  const list = q
    ? regions.filter(r => r.replace(/\s+/g, '').includes(q)).slice(0, 50)
    : regions.slice(0, 50)

  function pick(r: string) {
    onChange(r)
    setQuery('')
    setOpen(false)
  }

  if (regions.length === 0) {
    return <input style={rp.input} value="지역 목록 로딩 중…" disabled readOnly />
  }

  return (
    <div ref={boxRef} style={rp.wrap}>
      <input
        style={rp.input}
        value={open ? query : value}
        onFocus={() => { setOpen(true); setQuery(''); setActive(0) }}
        onChange={e => { setQuery(e.target.value); setOpen(true); setActive(0) }}
        onKeyDown={e => {
          if (!open) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, list.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)) }
          else if (e.key === 'Enter') { e.preventDefault(); if (list[active]) pick(list[active]) }
          else if (e.key === 'Escape') { setOpen(false) }
        }}
      />
      {open && (
        <div style={rp.list}>
          {list.length === 0
            ? <div style={rp.empty}>검색 결과가 없습니다</div>
            : list.map((r, i) => (
              <div
                key={r}
                style={i === active ? rp.itemOn : rp.item}
                onMouseEnter={() => setActive(i)}
                onMouseDown={e => { e.preventDefault(); pick(r) }}
              >
                {r}
              </div>
            ))
          }
          {!q && regions.length > list.length && (
            <div style={rp.more}>… 전체 {regions.length}개 — 검색어를 입력하세요</div>
          )}
        </div>
      )}
    </div>
  )
}

const rp: Record<string, React.CSSProperties> = {
  wrap: { position: 'relative' },
  input: { width: '100%', boxSizing: 'border-box', padding: '7px 9px', border: '1px solid var(--line)', borderRadius: 7, fontSize: 13 },
  list: {
    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, marginTop: 3,
    background: '#fff', border: '1px solid var(--line)', borderRadius: 8,
    maxHeight: 210, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,.14)',
  },
  item: { padding: '7px 10px', fontSize: 13, cursor: 'pointer' },
  itemOn: { padding: '7px 10px', fontSize: 13, cursor: 'pointer', background: '#f2f6e8' },
  empty: { padding: '10px', fontSize: 12.5, color: 'var(--muted)' },
  more: { padding: '6px 10px', fontSize: 11, color: 'var(--muted)', borderTop: '1px solid var(--line)' },
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
