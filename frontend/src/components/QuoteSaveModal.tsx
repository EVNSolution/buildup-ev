import { useEffect, useRef, useState } from 'react'
import { PhoneInput } from './PhoneInput'
import { SubsidyForm, BUSINESS_TYPE_OPTIONS, type SubsidyInputs } from './SubsidyInputs'
import { lookupCustomer, lookupWarpCustomer, type WarpVehicleInfo } from '../api/quotes'
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
  /**
   * 특장만 견적에서 고객이 보유한 **차종**. 계약서 단계에서만 받는다 —
   * 견적 단계에서는 금액만 보면 되고, 등록번호·차대번호는 계약 이후
   * 특장사가 자동차등록증을 보고 채운다.
   */
  owned_model: string
}

export function emptyQuoteSaveValues(subsidy: SubsidyInputs): QuoteSaveValues {
  return {
    subsidy, name: '', ceo_name: '', email: '', phone: '', address: '', address_detail: '',
    contract_party: '', buyer_agent: '', buyer_relation: '', buyer_regno: '', buyer_tel: '',
    owned_model: '',
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
    // 고객 마스터에는 없는 값(견적별). 호출부가 inputs 에서 채워 넣는다.
    owned_model: '',
  }
}

/**
 * 라벨 옆 표시 — **「· 필수」(빨강) 아니면 아무것도 없음**. 두 갈래뿐이다.
 *
 * 예전엔 「· 선택」(회색)과 「· 계약서 필수」(회색)가 더 있었다. 세 가지 회색 꼬리표가
 * 붙으니 정작 지금 채워야 할 칸이 어느 것인지 눈에 안 들어왔다 — 안 써도 되는 칸은
 * 아무 말도 하지 않는 편이 낫다.
 *
 * **단계마다 다시 계산한다.** 견적 단계에서 안 쓰던 칸(이메일·주소·생년월일)은 표시가
 * 없다가, 계약서 단계로 넘어오면 그때 「· 필수」가 새로 뜬다(`forContract`).
 * 채웠는지 여부로는 색을 바꾸지 않는다 — 필수는 늘 필수다.
 */
function Tag({ need }: { need?: boolean }) {
  if (!need) return null
  return <span style={s.tagOn}> · 필수</span>
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
  /**
   * create  견적 저장(견적서 기준 필수)
   * edit    고객정보 수정
   * contract 계약서 만들기 직전 확인 — 생년월일·주소·세부주소가 여기서 필수가 된다
   */
  mode?: 'create' | 'edit' | 'contract'
  /** 특장만 견적 — 계약서 단계에서 보유 차종을 함께 받는다 */
  bodyOnly?: boolean
}

/**
 * 입력칸 본문만 — 저장 팝업과 견적 수정 팝업의 「고객정보」 탭이 **같은 폼**을 쓴다.
 * 한쪽에만 칸을 더하면 다른 쪽에서 고칠 수 없는 값이 생긴다.
 */
export function QuoteCustomerForm({ v, setV, regions, forContract = false, bodyOnly = false }: {
  v: QuoteSaveValues
  setV: React.Dispatch<React.SetStateAction<QuoteSaveValues>>
  regions: string[]
  /** 계약서 단계 — 생년월일·주소·세부주소가 여기서 필수가 된다 */
  forContract?: boolean
  /**
   * 특장만 견적 — 계약서 단계에서 **보유 차종**을 받는다.
   * 견적 단계에서는 묻지 않는다(금액에 영향이 없고, 아직 정해지지 않았을 수 있다).
   */
  bodyOnly?: boolean
}) {
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

  const isCorporate = v.subsidy.business_type === 'corporate'
  // 법인 계약서 필수값은 **상호 + 대표이사** 둘이다.
  // 대표이사는 매수인 법인 줄에 인쇄되고, 대리인이 없으면 서명란에도 대표이사가 들어간다.
  // 대리인은 선택 — 법인도 대표이사가 직접 오는 경우가 더 흔하다.

  // ── WARP CRM 불러오기 — 명시적 버튼으로만 조회한다(자동 조회 아님) ──────────
  const [warpLoading, setWarpLoading] = useState(false)
  const [warpNotice, setWarpNotice] = useState('')
  /** WARP 에 등록된 차량 — **참고 표시 전용**. 저장 payload 에는 들어가지 않는다. */
  const [warpVehicles, setWarpVehicles] = useState<WarpVehicleInfo[]>([])
  // 이름 + 휴대폰(숫자 10자리)이 있어야 조회 키가 성립한다
  const canWarpLookup = !!v.name.trim() && digitsOf(v.phone).length >= 10

  /**
   * 이름+휴대폰 완전일치로 WARP CRM 고객을 찾아 **빈 칸만** 채운다.
   * 이름·휴대폰 자체는 매칭 키라 덮지 않는다. 실패·미매칭은 안내만 하고 입력을 막지 않는다.
   */
  async function tryWarpAutofill() {
    if (warpLoading || !canWarpLookup) return
    setWarpLoading(true)
    setWarpNotice('')
    setWarpVehicles([])
    try {
      const hit = await lookupWarpCustomer(v.name, v.phone)
      if (!hit) {
        setWarpNotice('CRM(WARP)에 일치하는 고객이 없습니다 — 이름·휴대폰이 등록된 값과 정확히 같아야 합니다.')
        return
      }
      const filled: string[] = []
      let regnoFilled = ''
      setV(prev => {
        const next = { ...prev }
        const fill = (k: 'email' | 'address' | 'address_detail' | 'buyer_tel' | 'ceo_name', val: string | null, label: string) => {
          if (val && !next[k].trim()) { next[k] = val; filled.push(label) }
        }
        fill('email', hit.email, '이메일')
        // 법인은 사업자번호만. 개인은 생년월일 우선, 없으면 개인사업자 번호.
        const regno = isCorporate ? hit.biz_regno : (hit.birth_regno ?? hit.biz_regno)
        if (regno && !next.buyer_regno.trim()) {
          next.buyer_regno = regno
          regnoFilled = regno
          filled.push(isCorporate ? '사업자번호' : '생년월일/사업자번호')
        }
        fill('address', hit.address, '주소')
        fill('address_detail', hit.address_detail, '세부주소')
        fill('buyer_tel', hit.tel, '유선번호')
        if (isCorporate) fill('ceo_name', hit.ceo_name, '대표이사')
        return next
      })
      setWarpVehicles(hit.vehicles)
      const dup = hit.match_count > 1 ? ` (동일 이름·휴대폰으로 ${hit.match_count}건 등록 — 가장 최근 것 기준)` : ''
      setWarpNotice(filled.length
        ? `CRM(WARP)에서 ${filled.join(', ')} 을(를) 불러와 빈 칸을 채웠습니다. 다르면 고쳐 주세요.${dup}`
        : `CRM(WARP)에서 고객을 찾았지만 새로 채울 빈 칸이 없습니다.${dup}`)
      // 생년월일/사업자번호가 채워졌으면 지난 견적 마스터도 이어서 조회한다(빈 칸만 채움)
      if (regnoFilled) void tryAutofill(v.name, regnoFilled)
    } finally {
      setWarpLoading(false)
    }
  }

  // 주소는 보조금 칸 안에 있었지만 **보조금과 무관한 값**이다(계약서에 들어간다).
  // 특장만 견적에서 보조금 칸을 감출 때도 이 블록은 남아야 해서 따로 뺐다.
  const addressBlock = (<>
            {/* 지역 바로 다음이 주소 — 두 칸으로 나눠 놓아야 팝업이 한 화면에 들어온다 */}
            <div style={s.row}>
              <label style={s.label}>주소<Tag need={forContract} /></label>
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
              <label style={s.label}>세부주소<Tag need={forContract} /></label>
              <input
                ref={addrRef}
                style={s.field} type="text" value={v.address_detail}
                placeholder="동·호수 등"
                onChange={e => set('address_detail', e.target.value)}
              />
            </div>
  </>)

  return (
    <>
        <div style={s.sectionTitle}>고객 정보</div>

        <div style={s.grid}>
        {/*
          맨 위 세 칸의 순서가 중요하다:
          사업자 구분(라벨이 바뀐다) → 성명(상호) → 생년월일(사업자번호).
          뒤의 두 값이 **고객 마스터를 찾는 키**라, 먼저 받아야 나머지를 자동으로 채울 수 있다.
        */}
        <div style={{ ...s.row, ...s.gridFull }}>
          <label style={s.label}>사업자 구분<Tag need /></label>
          <select
            style={s.field}
            value={v.subsidy.business_type}
            onChange={e => set('subsidy', { ...v.subsidy, business_type: e.target.value as BusinessType })}
          >
            {BUSINESS_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div style={s.row}>
          <label style={s.label}>{isCorporate ? '상호' : '성명'}<Tag need /></label>
          <input
            style={s.field} type="text" value={v.name}
            onChange={e => set('name', e.target.value)}
            onBlur={e => void tryAutofill(e.target.value, v.buyer_regno)}
          />
        </div>

        <div style={s.row}>
          <label style={s.label}>
            {isCorporate ? '사업자번호' : '생년월일 / 사업자번호'}
            <Tag need={forContract} />
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
            <label style={s.label}>대표이사<Tag need /></label>
            <input style={s.field} type="text" value={v.ceo_name} onChange={e => set('ceo_name', e.target.value)} />
          </div>
        )}

        <div style={s.row}>
          <label style={s.label}>
            휴대폰<Tag need />
            <Note>이름·휴대폰이 일치하면 CRM에서 불러올 수 있습니다</Note>
          </label>
          <div style={s.addrRow}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <PhoneInput value={v.phone} onChange={x => set('phone', x)} boxStyle={s.field} />
            </div>
            {/* WARP CRM 조회는 **버튼으로만** — 입력 도중 자동 조회로 값이 바뀌면 당황스럽다 */}
            <button
              type="button"
              style={{ ...s.addrBtn, ...(canWarpLookup && !warpLoading ? null : s.warpBtnOff) }}
              disabled={!canWarpLookup || warpLoading}
              onClick={() => void tryWarpAutofill()}
              title="이름 + 휴대폰 완전일치로 WARP CRM 고객정보를 불러와 빈 칸을 채웁니다"
            >
              {warpLoading ? '조회 중…' : 'CRM에서 불러오기'}
            </button>
          </div>
        </div>
        {warpNotice && <div style={s.autofill}>{warpNotice}</div>}
        {warpVehicles.length > 0 && (
          <div style={s.warpVehicleBox}>
            <b>CRM 등록 차량 (참고용 — 견적에 저장되지 않습니다)</b>
            {warpVehicles.map((veh, i) => (
              <div key={i}>
                {[veh.maker, veh.name, veh.plate_no, veh.year && `${veh.year}년식`,
                  veh.truck_types.length ? veh.truck_types.join('/') : null]
                  .filter(Boolean).join(' · ') || '상세 정보 없음'}
              </div>
            ))}
          </div>
        )}
        <div style={s.row}>
          <label style={s.label}>
            이메일<Tag need={forContract} />
            <Note>{forContract
              ? (isCorporate && !v.buyer_agent.trim() ? '법인 직인을 찍을 사람 · 전자서명용' : '전자서명을 위한 이메일')
              : '견적서·계약서를 메일로 받아 보시려면 입력을 권장합니다'}</Note>
          </label>
          <input style={s.field} type="email" value={v.email} onChange={e => set('email', e.target.value)} />
        </div>

        {/*
          특장만 견적에는 **보조금이 없다** — 차를 안 사니 EV 보조금 대상이 아니다.
          지역·소상공인·화물허가증·경유차는 금액에 아무 영향도 주지 않으므로 칸을 감춘다.
          답이 쓰이지 않는 질문을 남겨 두면 채우게 되고, 채우면 견적서에서 헷갈린다.
          **주소는 남긴다** — 계약서에 들어가는 값이라 보조금과 무관하다.
        */}
        <div style={s.sectionTitle}>{bodyOnly ? '주소' : '보조금 조건'}</div>
        <div style={s.grid}>
        {bodyOnly ? addressBlock : (
          /* 사업자 구분은 위에서 이미 받았다 — 같은 상태를 공유하므로 여기선 감춘다 */
          <SubsidyForm
            value={v.subsidy} onChange={x => set('subsidy', x)} regions={regions} hideBusinessType
            afterRegion={addressBlock}
          />
        )}
        </div>

        <div style={s.sectionTitle}>
          계약서 정보
          <span style={s.optional}> · 비우면 계약서에 공란</span>
        </div>
        <div style={s.grid}>
        <div style={s.row}>
          <label style={s.label}>계약처</label>
          <input style={s.field} type="text" value={v.contract_party} onChange={e => set('contract_party', e.target.value)} />
        </div>
        <div style={s.row}>
          <label style={s.label}>유선번호</label>
          <PhoneInput value={v.buyer_tel} onChange={x => set('buyer_tel', x)} boxStyle={s.field} />
        </div>
        <div style={s.row}>
          <label style={s.label}>
            대리인
            {v.buyer_agent.trim() ? <Note>위임장 필요</Note> : null}
          </label>
          <input style={s.field} type="text" value={v.buyer_agent} onChange={e => set('buyer_agent', e.target.value)} />
        </div>
        <div style={s.row}>
          <label style={s.label}>
            관계<Tag need={!!v.buyer_agent.trim()} />
          </label>
          <input style={s.field} type="text" value={v.buyer_relation} onChange={e => set('buyer_relation', e.target.value)} />
        </div>

        </div>

    </>
  )
}

/**
 * 필수 입력 — **견적서와 계약서가 요구하는 양이 다르다.**
 *
 * 견적서는 금액을 뽑는 서류다. 금액을 가르는 것(사업자 구분·지역·소상공인·화물운송·
 * 경유차)과 서류를 보낼 곳(휴대폰·이메일)만 있으면 나온다.
 * 계약서는 사람을 특정하는 서류라 생년월일(사업자번호)과 주소가 있어야 한다.
 *
 * 예전엔 둘을 한 벌로 묶어, 가볍게 금액만 뽑아 보려 해도 주소까지 받아야 했다.
 */
function missingBase(v: QuoteSaveValues, bodyOnly = false): string[] {
  const isCorporate = v.subsidy.business_type === 'corporate'
  const filled = (x: string) => !!x.trim()
  /*
   * 보조금 조건 — **특장만 견적에는 없다.** 차를 안 사니 EV보조금 대상이 아니라
   * 화면에서 칸을 통째로 감춰 두었는데, 필수 목록에는 그대로 남아 있었다.
   * 그래서 「사업자 구분·성명·휴대폰」을 다 채워도 저장 버튼이 열리지 않았다 —
   * 채울 수 없는 칸을 요구하니 **아무리 해도 저장되지 않는다**(실제 제보).
   *
   * ⚠️ 화면에 없는 값을 필수로 두면 이런 식으로 막힌다. 감추는 곳과 요구하는 곳은
   *    반드시 같은 조건을 봐야 한다.
   */
  const subsidyNeeded: [boolean, string][] = bodyOnly ? [] : [
    // 법인은 지방보조금 대상이 아니라 지역 칸 자체가 없다 — 필수에서도 뺀다
    [isCorporate || filled(v.subsidy.region_code), '지역'],
    [v.subsidy.diesel_status !== '', '경유차 폐차여부'],
    [v.subsidy.is_small_business !== null, '소상공인'],
    [v.subsidy.has_transport_license !== null, '화물자동차 운송사업허가증'],
  ]
  const required: [boolean, string][] = [
    [filled(v.name), isCorporate ? '상호' : '성명'],
    [!isCorporate || filled(v.ceo_name), '대표이사'],
    [filled(v.phone), '휴대폰'],
    ...subsidyNeeded,
    [!(v.buyer_agent.trim() && !v.buyer_relation.trim()), '관계'],
  ]
  return required.filter(([ok]) => !ok).map(([, label]) => label)
}

/*
 * ⚠️ 이메일은 **견적 단계 필수가 아니다.**
 *    견적서에 들어가는 값이 아니라 **보내는 수단**이고, 이메일을 안 주고 문자로 받길
 *    원하는 고객이 많다. 영업이 견적만 빠르게 만들어 파일·사진으로 건네는 길을 막지 않는다.
 *    대신 이메일이 없으면 **메일 발송 기능이 잠긴다**(화면에서 버튼 비활성 + 서버도 거절).
 */

/** 견적서를 만들기 위해 필요한 것 — 금액에 걸리는 값과 연락처 */
export function missingForQuote(v: QuoteSaveValues, bodyOnly = false): string[] {
  return missingBase(v, bodyOnly)
}

/** 계약서를 만들기 위해 추가로 필요한 것 — 사람을 특정하는 값 */
export function missingForContract(v: QuoteSaveValues, bodyOnly = false): string[] {
  const isCorporate = v.subsidy.business_type === 'corporate'
  const filled = (x: string) => !!x.trim()
  const regNoOk = filled(v.buyer_regno) && !regNoError(v.buyer_regno)
  const extra: [boolean, string][] = [
    // 계약 단계에서는 이메일이 필요하다 — 전자서명·서류 발송이 여기서 시작된다
    [filled(v.email), '이메일'],
    [regNoOk, isCorporate ? '사업자번호' : '생년월일'],
    [filled(v.address), '주소'],
    [filled(v.address_detail), '세부주소'],
  ]
  return [...missingBase(v, bodyOnly), ...extra.filter(([ok]) => !ok).map(([, label]) => label)]
}

/** 예전 이름 — 견적 기준. 남은 호출부가 다 옮겨지면 지운다. */
export const missingRequired = missingForQuote

export function QuoteSaveModal({ initial, regions, saving, error, onSave, onClose, mode = 'create', bodyOnly = false }: Props) {
  const [v, setV] = useState<QuoteSaveValues>(initial)
  const isEdit = mode === 'edit'
  // 계약서 단계에서는 사람을 특정하는 값(생년월일·주소)까지 있어야 한다
  const forContract = mode === 'contract'
  const missing = forContract ? missingForContract(v, bodyOnly) : missingForQuote(v, bodyOnly)
  const canSave = missing.length === 0 && !saving

  // 바깥을 눌러도 닫히지 않는다 — 입력 도중 실수로 눌러 전부 날아가던 문제.
  // 닫기는 '취소' 와 ✕ 로만.
  return (
    <div style={s.overlay}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <h2 style={s.h2}>{forContract ? '계약서 정보 확인' : isEdit ? '고객정보 수정' : '견적 저장'}</h2>
        <p style={s.desc}>
          {forContract
            ? '계약서에 그대로 들어갑니다. 견적서에 입력한 값은 이미 채워져 있습니다 — 확인하고 빈 칸만 채우세요.'
            : isEdit
            ? '고친 값은 견적서·계약서에 즉시 반영됩니다. 사업자 구분·지역을 바꾸면 보조금이 다시 계산됩니다.'
            : '저장 후에도 견적 목록의 「수정」에서 고칠 수 있습니다.'}
        </p>

        <QuoteCustomerForm v={v} setV={setV} regions={regions} forContract={forContract} bodyOnly={bodyOnly} />

        {error && <div style={s.error}>{error}</div>}

        {/*
          왜 아직 저장할 수 없는지 **이름으로** 적는다. 잠긴 버튼만 두면 무엇이 빈 건지
          알 수 없어, 다 채웠다고 생각하며 계속 누르게 된다(실제 제보).
        */}
        {!saving && missing.length > 0 && (
          <div style={s.needHint}>{missing.join(' · ')} 을(를) 입력해 주세요</div>
        )}

        <div style={s.btnRow}>
          <button style={{ ...s.btnOk, ...(canSave ? null : s.btnOff) }} onClick={() => canSave && onSave(v)} disabled={!canSave}>
            {saving ? '저장 중…' : forContract ? '확인 완료' : isEdit ? '저장' : '견적 저장'}
          </button>
          <button style={s.btnCancel} onClick={onClose} disabled={saving}>취소</button>
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  signNote: {
    background: 'var(--lime-bg)', border: '0.5px solid var(--lime)', color: 'var(--dark)',
    fontSize: 14, lineHeight: 1.6, padding: '9px 11px', borderRadius: 8, margin: '12px 0 4px',
  },
  overlay: {
    position: 'fixed', inset: 0, background: 'var(--scrim)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
  },
  modal: {
    // 예전엔 440px 한 열이라 화면을 넘겨 스크롤해야 했다. 두 열로 놓아 한 화면에 담는다.
    // 폭 760 = 가장 긴 라벨(「화물자동차 운송사업허가증 · 개인사업자 국고 10% 추가 · 필수」
    // 342px)이 한 열에 줄바꿈 없이 들어가는 값(342×2 + 열간격 16 + 좌우여백 48 = 748) + 여유.
    /* ⚠️ 흰 배경은 인라인으로 — 클래스에 얹었다가 팝업이 투명해진 적이 있다 */
    background: '#fff', borderRadius: 16, width: 760, maxWidth: '94vw', maxHeight: '92vh',
    overflowY: 'auto', padding: '18px 24px', boxShadow: '0 10px 40px rgba(0,0,0,.25)',
  },
  /**
   * 입력칸 두 열. 한 줄을 다 쓰는 칸은 gridColumn: '1 / -1'.
   * ⚠️ 폭이 좁으면 **한 열**로 내려간다 — 두 열을 고집하면 라벨이 세 줄로 접히고
   *    칸이 손가락으로 누르기 어려울 만큼 좁아진다(휴대폰 제보).
   */
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', columnGap: 16 },
  gridFull: { gridColumn: '1 / -1' },
  h2: { margin: '0 0 3px', fontSize: 17, color: 'var(--dark)' },
  desc: { margin: '0 0 10px', fontSize: 14, color: 'var(--muted)' },
  sectionTitle: {
    fontSize: 14, fontWeight: 700, color: 'var(--dark)',
    margin: '10px 0 7px', paddingBottom: 4, borderBottom: '0.5px solid var(--line)',
  },
  optional: { fontSize: 14, fontWeight: 400, color: 'var(--muted)' },
  row: { marginBottom: 8 },
  label: { display: 'block', fontSize: 14, color: 'var(--muted)', marginBottom: 4 },
  // 「· 필수」는 아직 안 채운 동안만 빨강 / 「· 선택」과 채운 필수는 회색
  tagOn: { fontSize: 14, color: 'var(--req)', fontWeight: 700 },
  tagOff: { fontSize: 14, color: 'var(--muted)', fontWeight: 400 },
  /** 지금은 없어도 되지만 계약서 단계에서 필요한 값 */
  tagLater: { fontSize: 14, color: 'var(--muted)', fontWeight: 700 },
  addrRow: { display: 'flex', gap: 6 },
  addrBtn: {
    flexShrink: 0, minHeight: 'var(--h-control)', padding: '0 12px', fontSize: 14, fontWeight: 700,
    border: '0.5px solid var(--line)', borderRadius: 8, background: 'var(--card)',
    color: 'var(--dark)', cursor: 'pointer', whiteSpace: 'nowrap',
  },
  field: {
    // 높이는 공통 토큰 — 옆 칸(전역 규칙을 쓰는 select·input)과 어긋나지 않게
    width: '100%', boxSizing: 'border-box', minHeight: 'var(--h-control)', padding: '0 10px', fontSize: 14,
    fontFamily: 'inherit', color: 'var(--dark)', border: '0.5px solid var(--line)',
    borderRadius: 8, background: '#fff', outline: 'none',
  },
  warn: { fontSize: 'var(--fs-body)', color: 'var(--warn)', marginTop: 'var(--sp-1)' },
  autofill: {
    fontSize: 14, color: 'var(--dark)', background: 'var(--lime-bg)',
    border: '0.5px solid var(--lime)', borderRadius: 8, padding: '8px 10px', marginBottom: 12,
  },
  warpBtnOff: { opacity: .5, cursor: 'not-allowed' },
  /** CRM 등록 차량 — 참고 표시 전용(저장 안 됨). 자동 기입 배너와 구분되게 회색 톤 */
  warpVehicleBox: {
    fontSize: 14, color: 'var(--dark)', background: 'var(--card)',
    border: '0.5px solid var(--line)', borderRadius: 8, padding: '8px 10px', marginBottom: 12,
    display: 'grid', gap: 2,
  },
  error: { fontSize: 'var(--fs-body)', color: 'var(--warn)', marginTop: 'var(--sp-3)' },
  needHint: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', marginTop: 'var(--sp-3)' },
  btnRow: { display: 'flex', gap: 8, marginTop: 14 },
  btnOk: {
    flex: 1, fontSize: 14, fontWeight: 700, minHeight: 'var(--h-control)', padding: '0 11px', borderRadius: 9,
    cursor: 'pointer', border: 'none', background: 'var(--lime)', color: 'var(--dark)',
  },
  btnOff: { opacity: .5, cursor: 'not-allowed' },
  btnCancel: {
    flex: 1, fontSize: 14, fontWeight: 700, minHeight: 'var(--h-control)', padding: '0 11px', borderRadius: 9,
    cursor: 'pointer', border: '0.5px solid var(--line)', background: '#fff', color: 'var(--muted)',
  },
}
