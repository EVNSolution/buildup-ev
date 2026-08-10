import { useEffect, useRef, useState } from 'react'
import { PhoneInput } from './PhoneInput'
import { SubsidyForm, BUSINESS_TYPE_OPTIONS, type SubsidyInputs } from './SubsidyInputs'
import { lookupCustomer } from '../api/quotes'
import { preloadPostcode, searchAddress } from '../lib/postcode'
import type { BusinessType, CustomerInfo } from '@shared/types/index'

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
  address_detail: string
  contract_party: string
  buyer_agent: string
  buyer_relation: string
  buyer_regno: string
  buyer_tel: string
}

export function emptyQuoteSaveValues(subsidy: SubsidyInputs): QuoteSaveValues {
  return {
    subsidy, name: '', ceo_name: '', email: '', phone: '', address: '', address_detail: '',
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
    address_detail: c.address_detail ?? '',
    contract_party: c.contract_party ?? '',
    buyer_agent: c.buyer_agent ?? '',
    buyer_relation: c.buyer_relation ?? '',
    buyer_regno: c.buyer_regno ?? '',
    buyer_tel: c.buyer_tel ?? '',
  }
}

/**
 * 라벨 옆 표시 — 「제목 · 필수」 / 「제목 · 선택」.
 *
 * 가운데 점으로 띄워야 제목의 일부처럼 읽히지 않는다.
 * 필수는 **비어 있는 동안만 빨강**이고, 채우면 회색으로 가라앉는다 — 남은 할 일만
 * 눈에 띄게 하려는 것.
 */
function Tag({ need, done }: { need?: boolean; done?: boolean }) {
  if (!need) return <span style={s.tagOff}> · 선택</span>
  return <span style={done ? s.tagOff : s.tagOn}> · 필수</span>
}

/** 라벨 옆 회색 안내(무슨 값을 적어야 하는지). */
function Note({ children }: { children: React.ReactNode }) {
  return <span style={s.tagOff}> · {children}</span>
}

// ── 생년월일 / 사업자번호 ───────────────────────────────────────────────────
// 개인은 생년월일 8자리, 사업자는 사업자번호 10자리. 둘 다 숫자만 받고 칸을 벗어날 때
// 형식을 맞춰 준다 — 하이픈을 어디에 넣을지 사람이 고민할 필요가 없다.
const digitsOf = (v: string) => v.replace(/\D/g, '')

/** 8자리 → YYYY-MM-DD · 10자리 → 000-00-00000 · 그 외는 손대지 않는다. */
export function formatRegNo(raw: string): string {
  const d = digitsOf(raw)
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`
  return raw
}

/** 비어 있지 않은데 8자리도 10자리도 아니면 알려준다. */
export function regNoError(raw: string): string | null {
  const d = digitsOf(raw)
  if (!d) return null
  if (d.length === 8 || d.length === 10) return null
  return `숫자 ${d.length}자리 — 생년월일 8자리 또는 사업자번호 10자리로 입력하세요`
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

  /** 자동 기입으로 채워진 항목 — 무엇이 저절로 들어갔는지 화면에 드러낸다. */
  const [autofilled, setAutofilled] = useState<string[]>([])
  /** 같은 키로 반복 조회하지 않도록 마지막 조회 키를 기억한다. */
  const lastKey = useRef('')
  /** 주소 검색창을 못 띄웠을 때(네트워크 등) — 직접 입력으로 계속할 수 있게 알린다. */
  const [addrErr, setAddrErr] = useState('')
  const addrRef = useRef<HTMLInputElement>(null)

  // 주소 검색창은 누른 그 순간 열려야 브라우저가 막지 않는다 — 미리 받아둔다
  useEffect(() => { preloadPostcode() }, [])

  async function pickAddress() {
    setAddrErr('')
    try {
      await searchAddress((address) => {
        // 검색으로 채우는 건 도로명주소까지. 동·호수는 아래 세부주소 칸에 적는다.
        set('address', address)
        setTimeout(() => addrRef.current?.focus(), 0)
      })
    } catch (e) {
      setAddrErr(e instanceof Error ? e.message : '주소 검색을 불러오지 못했습니다')
    }
  }

  /**
   * 성명(상호)+생년월일(사업자번호)이 모두 채워지면 지난 고객정보를 불러와
   * **빈 칸만** 채운다. 이미 적은 값은 절대 덮어쓰지 않는다.
   */
  async function tryAutofill(name: string, regNo: string) {
    const key = `${name.trim()}|${regNo.trim()}`
    if (!name.trim() || !regNo.trim() || key === lastKey.current) return
    lastKey.current = key
    const hit = await lookupCustomer(name, regNo)
    if (!hit) { setAutofilled([]); return }

    const filled: string[] = []
    setV(prev => {
      const next = { ...prev }
      // ⚠️ 이메일은 채우지 않는다 — 견적마다 받는 담당자가 달라, 지난 값을 끌어오면
      //    엉뚱한 사람에게 견적서가 나간다.
      const fill = (k: 'ceo_name' | 'phone' | 'address' | 'buyer_tel', val: string | null, label: string) => {
        if (val && !next[k].trim()) { next[k] = val; filled.push(label) }
      }
      fill('ceo_name', hit.ceo_name, '대표이사')
      fill('phone', hit.phone, '휴대폰')
      fill('address', hit.address, '세부주소')
      fill('buyer_tel', hit.tel, '전화번호')
      return next
    })
    setAutofilled(filled)
  }

  const isEdit = mode === 'edit'
  const isCorporate = v.subsidy.business_type === 'corporate'
  // 법인 계약서 필수값은 **상호 + 대표이사** 둘이다.
  // 대표이사는 매수인 법인 줄에 인쇄되고, 대리인이 없으면 서명란에도 대표이사가 들어간다.
  // 대리인은 선택 — 법인도 대표이사가 직접 오는 경우가 더 흔하다.
  // 백엔드도 같은 기준으로 렌더를 막으므로(missingCorporateFields) 화면에서 미리 잡는다.
  const missingCeo = isCorporate && !v.ceo_name.trim()
  // 대리인이 있으면 관계를 받아야 한다 — 위임 관계가 계약서에 남아야 하기 때문.
  const missingRelation = !!v.buyer_agent.trim() && !v.buyer_relation.trim()

  /**
   * 저장에 반드시 필요한 값들.
   * 견적서·계약서·전자서명·보조금 계산이 전부 이 값들에 걸려 있어, 비면 나중에
   * 서류를 다시 만들거나 보조금이 틀린다. 그래서 저장 단계에서 한 번에 받는다.
   */
  const filled = (x: string) => !!x.trim()
  const regNoOk = filled(v.buyer_regno) && !regNoError(v.buyer_regno)
  const required: [boolean, string][] = [
    [filled(v.name), isCorporate ? '상호' : '성명'],
    [!missingCeo, '대표이사'],
    [regNoOk, isCorporate ? '사업자번호' : '생년월일'],
    [filled(v.phone), '휴대폰'],
    [filled(v.email), '이메일'],
    [filled(v.subsidy.region_code), '지역'],
    [filled(v.address), '주소'],
    [filled(v.address_detail), '세부주소'],
    [v.subsidy.diesel_status !== '', '경유차 폐차여부'],
    [v.subsidy.is_small_business !== null, '소상공인'],
    [v.subsidy.has_transport_license !== null, '화물자동차 운송사업허가증'],
    [!missingRelation, '관계'],
  ]
  const missing = required.filter(([ok]) => !ok).map(([, label]) => label)
  const canSave = missing.length === 0 && !saving

  // 바깥을 눌러도 닫히지 않는다 — 입력 도중 실수로 눌러 전부 날아가던 문제.
  // 닫기는 '취소' 와 ✕ 로만.
  return (
    <div style={s.overlay}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <h2 style={s.h2}>{isEdit ? '고객정보 수정' : '견적 저장'}</h2>
        <p style={s.desc}>
          {isEdit
            ? '고친 값은 견적서·계약서에 즉시 반영됩니다. 사업자 구분·지역을 바꾸면 보조금이 다시 계산됩니다.'
            : '저장 후에도 견적 목록의 고객정보에서 수정할 수 있습니다.'}
        </p>

        <div style={s.sectionTitle}>고객 정보</div>

        <div style={s.grid}>
        {/*
          맨 위 세 칸의 순서가 중요하다:
          사업자 구분(라벨이 바뀐다) → 성명(상호) → 생년월일(사업자번호).
          뒤의 두 값이 **고객 마스터를 찾는 키**라, 먼저 받아야 나머지를 자동으로 채울 수 있다.
        */}
        <div style={{ ...s.row, ...s.gridFull }}>
          <label style={s.label}>사업자 구분</label>
          <select
            style={s.field}
            value={v.subsidy.business_type}
            onChange={e => set('subsidy', { ...v.subsidy, business_type: e.target.value as BusinessType })}
          >
            {BUSINESS_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div style={s.row}>
          <label style={s.label}>{isCorporate ? '상호' : '성명'}<Tag need done={!!v.name.trim()} /></label>
          <input
            style={s.field} type="text" value={v.name}
            onChange={e => set('name', e.target.value)}
            onBlur={e => void tryAutofill(e.target.value, v.buyer_regno)}
          />
        </div>

        <div style={s.row}>
          <label style={s.label}>
            {isCorporate ? '사업자번호' : '생년월일 / 사업자번호'}
            <Tag need done={regNoOk} />
          </label>
          <input
            style={s.field} type="text" value={v.buyer_regno}
            inputMode="numeric"
            placeholder="숫자만 입력"
            onChange={e => set('buyer_regno', e.target.value)}
            onBlur={e => {
              // 칸을 벗어날 때 형식을 맞춘다 — 입력 중에 하이픈이 끼어들면 지우기가 성가시다
              const formatted = formatRegNo(e.target.value)
              if (formatted !== v.buyer_regno) set('buyer_regno', formatted)
              void tryAutofill(v.name, formatted)
            }}
          />
          {regNoError(v.buyer_regno) && <div style={s.warn}>{regNoError(v.buyer_regno)}</div>}
        </div>

        </div>

        {autofilled.length > 0 && (
          <div style={s.autofill}>
            지난 견적의 고객정보에서 <b>{autofilled.join(', ')}</b> 을(를) 불러와 빈 칸을 채웠습니다.
            다르면 고쳐 주세요.
          </div>
        )}

        {isCorporate && (
          <div style={s.row}>
            <label style={s.label}>대표이사<Tag need done={!!v.ceo_name.trim()} /></label>
            <input style={s.field} type="text" value={v.ceo_name} onChange={e => set('ceo_name', e.target.value)} />
            {missingCeo && (
              <div style={s.warn}>
                대표이사를 입력해야 저장할 수 있습니다</div>
            )}
          </div>
        )}

        <div style={s.row}>
          <label style={s.label}>휴대폰<Tag need done={filled(v.phone)} /></label>
          <PhoneInput value={v.phone} onChange={x => set('phone', x)} boxStyle={s.field} />
        </div>
        <div style={s.row}>
          <label style={s.label}>
            이메일<Tag need done={filled(v.email)} />
            <Note>{isCorporate && !v.buyer_agent.trim()
              ? '법인 직인을 찍을 사람 · 전자서명용'
              : '전자서명을 위한 이메일'}</Note>
          </label>
          <input style={s.field} type="email" value={v.email} onChange={e => set('email', e.target.value)} />
        </div>

        <div style={s.sectionTitle}>보조금 조건</div>
        <div style={s.grid}>
        {/* 사업자 구분은 위에서 이미 받았다 — 같은 상태를 공유하므로 여기선 감춘다 */}
        <SubsidyForm
          value={v.subsidy} onChange={x => set('subsidy', x)} regions={regions} hideBusinessType
          afterRegion={<>
            {/* 지역 바로 다음이 주소 — 두 칸으로 나눠 놓아야 팝업이 한 화면에 들어온다 */}
            <div style={s.row}>
              <label style={s.label}>주소<Tag need done={filled(v.address)} /></label>
              <div style={s.addrRow}>
                <input
                  style={{ ...s.field, flex: 1, minWidth: 0 }} type="text" value={v.address}
                  onChange={e => set('address', e.target.value)}
                />
                <button type="button" style={s.addrBtn} onClick={() => void pickAddress()}>검색</button>
              </div>
              {addrErr && <div style={s.warn}>{addrErr} — 직접 입력해 주세요</div>}
            </div>
            <div style={s.row}>
              <label style={s.label}>세부주소<Tag need done={filled(v.address_detail)} /></label>
              <input
                ref={addrRef}
                style={s.field} type="text" value={v.address_detail}
                placeholder="동·호수 등"
                onChange={e => set('address_detail', e.target.value)}
              />
            </div>
          </>}
        />

        </div>

        <div style={s.sectionTitle}>
          계약서 정보
          <span style={s.optional}> · 비우면 계약서에 공란</span>
        </div>
        <div style={s.grid}>
        <div style={s.row}>
          <label style={s.label}>계약처<Tag /></label>
          <input style={s.field} type="text" value={v.contract_party} onChange={e => set('contract_party', e.target.value)} />
        </div>
        <div style={s.row}>
          <label style={s.label}>유선번호<Tag /></label>
          <PhoneInput value={v.buyer_tel} onChange={x => set('buyer_tel', x)} boxStyle={s.field} />
        </div>
        <div style={s.row}>
          <label style={s.label}>
            대리인<Tag />
            {v.buyer_agent.trim() ? <Note>위임장 필요</Note> : null}
          </label>
          <input style={s.field} type="text" value={v.buyer_agent} onChange={e => set('buyer_agent', e.target.value)} />
        </div>
        <div style={s.row}>
          <label style={s.label}>
            관계<Tag need={!!v.buyer_agent.trim()} done={!!v.buyer_relation.trim()} />
          </label>
          <input style={s.field} type="text" value={v.buyer_relation} onChange={e => set('buyer_relation', e.target.value)} />
          {missingRelation && (
            <div style={s.warnBox}>대리인을 입력하면 관계도 입력해야 저장할 수 있습니다</div>
          )}
        </div>

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
  warnBox: { color: '#c0392b', fontSize: 14, marginTop: 4, lineHeight: 1.5 },
  signNote: {
    background: '#eef2e6', border: '1px solid #d5e0bf', color: '#42502a',
    fontSize: 14, lineHeight: 1.6, padding: '9px 11px', borderRadius: 8, margin: '12px 0 4px',
  },
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(20,20,20,.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
  },
  modal: {
    // 예전엔 440px 한 열이라 화면을 넘겨 스크롤해야 했다. 두 열로 놓아 한 화면에 담는다.
    // 폭 760 = 가장 긴 라벨(「화물자동차 운송사업허가증 · 개인사업자 국고 10% 추가 · 필수」
    // 342px)이 한 열에 줄바꿈 없이 들어가는 값(342×2 + 열간격 16 + 좌우여백 48 = 748) + 여유.
    background: '#fff', borderRadius: 16, width: 760, maxWidth: '94vw', maxHeight: '96vh',
    overflowY: 'auto', padding: '18px 24px', boxShadow: '0 10px 40px rgba(0,0,0,.25)',
  },
  /** 입력칸 두 열. 한 줄을 다 쓰는 칸은 gridColumn: '1 / -1'. */
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16 },
  gridFull: { gridColumn: '1 / -1' },
  h2: { margin: '0 0 3px', fontSize: 17, color: 'var(--dark)' },
  desc: { margin: '0 0 10px', fontSize: 14, color: 'var(--muted)' },
  sectionTitle: {
    fontSize: 14, fontWeight: 700, color: 'var(--dark)',
    margin: '10px 0 7px', paddingBottom: 4, borderBottom: '1px solid var(--line)',
  },
  optional: { fontSize: 14, fontWeight: 400, color: '#b0b7c0' },
  row: { marginBottom: 8 },
  label: { display: 'block', fontSize: 14, color: 'var(--muted)', marginBottom: 4 },
  // 「· 필수」는 아직 안 채운 동안만 빨강 / 「· 선택」과 채운 필수는 회색
  tagOn: { fontSize: 14, color: '#c0392b', fontWeight: 700 },
  tagOff: { fontSize: 14, color: '#b0b7c0', fontWeight: 400 },
  addrRow: { display: 'flex', gap: 6 },
  addrBtn: {
    flexShrink: 0, height: 36, padding: '0 12px', fontSize: 14, fontWeight: 700,
    border: '1px solid var(--line)', borderRadius: 8, background: '#f7f8f3',
    color: 'var(--dark)', cursor: 'pointer', whiteSpace: 'nowrap',
  },
  field: {
    width: '100%', boxSizing: 'border-box', height: 36, padding: '0 10px', fontSize: 14,
    fontFamily: 'inherit', color: 'var(--dark)', border: '1px solid var(--line)',
    borderRadius: 8, background: '#fff', outline: 'none',
  },
  warn: { fontSize: 14, color: '#c0392b', marginTop: 5 },
  autofill: {
    fontSize: 14, color: 'var(--dark)', background: '#f2f6e8',
    border: '1px solid #dce8c2', borderRadius: 8, padding: '8px 10px', marginBottom: 12,
  },
  error: { fontSize: 14, color: '#c0392b', marginTop: 12 },
  btnRow: { display: 'flex', gap: 8, marginTop: 14 },
  btnOk: {
    flex: 1, fontSize: 14, fontWeight: 700, padding: 11, borderRadius: 9,
    cursor: 'pointer', border: 'none', background: 'var(--lime)', color: 'var(--dark)',
  },
  btnOff: { opacity: .5, cursor: 'not-allowed' },
  btnCancel: {
    flex: 1, fontSize: 14, fontWeight: 700, padding: 11, borderRadius: 9,
    cursor: 'pointer', border: '1px solid var(--line)', background: '#fff', color: 'var(--muted)',
  },
}
