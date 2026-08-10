import type { BusinessType, DieselStatusCode } from '@shared/types/index'
import { RegionPicker } from './RegionPicker'

/**
 * 보조금 산정에 필요한 입력만 모은 조각.
 *
 * 이 값들은 **화면 가격을 즉시 바꾼다** — 그래서 견적 저장 모달이 아니라
 * 가격바 「보조금」 블록을 눌러 그 자리에서 고치게 한다(등록·기타 상세 팝업과 같은 방식).
 *
 * ⚠️ 사업자 구분이 여기 들어있는 이유: 법인이면 지방보조금 0, 개인사업자+화물운송허가증이면
 *    택배업 보조금이 붙는다. 보조금 결과가 사업자 구분에 직접 걸려 있어 빼면 화면 금액이 틀린다.
 *    (같은 값을 견적 저장 모달 맨 위에서도 고른다 — 상태는 하나이고 두 화면이 같이 본다)
 */
/**
 * ⚠️ 세 값이 `null`/`''` 을 가질 수 있는 이유: **아직 답하지 않음**을 구분해야 한다.
 * 체크박스로 두면 '아니오'와 '아직 안 봄'이 똑같이 unchecked 라, 물어보지도 않은 조건이
 * 보조금 계산에 그대로 들어간다. 보조금은 금액이 크게 갈리는 값이라 명시적으로 받는다.
 * 계산에 넘길 때는 아직 답이 없으면 '아니오'로 본다(SalesPage 에서 `?? false`).
 */
export interface SubsidyInputs {
  business_type: BusinessType
  region_code: string
  is_small_business: boolean | null
  has_transport_license: boolean | null
  diesel_status: DieselStatusCode | ''
}

export const DEFAULT_SUBSIDY_INPUTS: SubsidyInputs = {
  business_type: 'individual',
  region_code: '',
  is_small_business: null,
  has_transport_license: null,
  diesel_status: '',
}

export const BUSINESS_TYPE_OPTIONS: { value: BusinessType; label: string }[] = [
  { value: 'individual', label: '개인사업자' },
  { value: 'corporate', label: '법인사업자' },
  { value: 'simplified', label: '간이과세자' },
  { value: 'consumer', label: '일반구매자' },
]

/**
 * 경유차 폐차여부 — 총견적서 '입력 시트' C5 선택지 그대로.
 * 국고보조금이 깎이는 것은 「유지」뿐이다(엑셀 D15). 「폐차」는 금액에 영향이 없어
 * 안내 문구로 그 사실을 밝힌다(영업이 폐차를 고르면 깎일 거라 오해하지 않도록).
 */
export const DIESEL_OPTIONS: { value: DieselStatusCode; label: string; note?: string }[] = [
  { value: 'none', label: '경유차없음' },
  { value: 'keep', label: '경유차 유지 후 전기차 전환', note: '국고 −50만' },
  { value: 'scrap', label: '경유차 폐차 후 전기차 전환', note: '보조금 변동 없음' },
]

/** 보조금 입력 폼(팝업·모달 공용). 라벨 폭이 좁은 팝업에서도 쓰도록 단일 열. */
export function SubsidyForm({ value, onChange, regions, compact, hideBusinessType, afterRegion, hideRequired }: {
  value: SubsidyInputs
  onChange: (v: SubsidyInputs) => void
  regions: string[]
  compact?: boolean
  /** 견적 저장 모달은 사업자 구분을 **맨 위**에 따로 두므로 여기선 감춘다(값은 같은 상태). */
  hideBusinessType?: boolean
  /** 지역 칸 **바로 아래**에 끼워 넣을 내용(세부주소 등). 주소는 지역과 붙어 있어야 읽힌다. */
  afterRegion?: React.ReactNode
  /**
   * 「· 필수」 표시를 감춘다. 가격바의 보조금 팝업은 **지금 값을 바꿔 보는 곳**이지
   * 저장 전에 채워야 할 목록이 아니다 — 거기서 필수라고 하면 겁만 준다.
   */
  hideRequired?: boolean
}) {
  const set = <K extends keyof SubsidyInputs>(k: K, v: SubsidyInputs[K]) => onChange({ ...value, [k]: v })
  const s = compact ? f.rowTight : f.row

  return (
    <>
      {!hideBusinessType && (
        <div style={s}>
          <label style={f.label}>사업자 구분</label>
          <select
            style={f.field}
            value={value.business_type}
            onChange={e => set('business_type', e.target.value as BusinessType)}
          >
            {BUSINESS_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      )}

      <div style={s}>
        <label style={f.label}>지역 <span style={f.req}>· 지방보조금 조회 기준</span></label>
        <RegionPicker regions={regions} value={value.region_code} onChange={v => set('region_code', v)} />
      </div>

      {afterRegion}

      <div style={s}>
        <label style={f.label}>경유차 폐차여부</label>
        <select
          style={f.field}
          value={value.diesel_status}
          onChange={e => set('diesel_status', e.target.value as DieselStatusCode)}
        >
          {/* 기본값을 '경유차없음' 으로 두면 물어보지도 않고 답한 셈이 된다 */}
          <option value="">선택하세요</option>
          {DIESEL_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}{o.note ? ` (${o.note})` : ''}</option>
          ))}
        </select>
      </div>

      <YesNo
        label="소상공인" hint="국고 30% 추가" tight={!!compact} hideRequired={!!hideRequired}
        value={value.is_small_business} onChange={v => set('is_small_business', v)}
      />
      <YesNo
        label="화물자동차 운송사업허가증" hint="개인사업자 국고 10% 추가" tight={!!compact} hideRequired={!!hideRequired}
        value={value.has_transport_license} onChange={v => set('has_transport_license', v)}
      />
    </>
  )
}

/**
 * 예 / 아니오 — 체크박스 대신 쓴다.
 * 체크박스는 '아니오'와 '아직 안 고름'이 구분되지 않아, 보조금처럼 금액이 갈리는
 * 조건에는 쓸 수 없다. 고르기 전에는 둘 다 눌리지 않은 상태로 남는다.
 */
function YesNo({ label, hint, value, onChange, tight, hideRequired }: {
  label: string
  hint?: string
  value: boolean | null
  onChange: (v: boolean) => void
  tight: boolean
  hideRequired?: boolean
}) {
  return (
    <div style={tight ? f.rowTight : f.row}>
      <label style={f.label}>
        {label}
        {hint ? <span style={f.hint}> · {hint}</span> : null}
        {hideRequired ? null
          : value === null ? <span style={f.needTag}> · 필수</span> : <span style={f.hint}> · 필수</span>}
      </label>
      <div style={f.yesNo}>
        <button type="button" style={value === true ? f.ynOn : f.ynOff} onClick={() => onChange(true)}>예</button>
        <button type="button" style={value === false ? f.ynOn : f.ynOff} onClick={() => onChange(false)}>아니오</button>
      </div>
    </div>
  )
}

const f: Record<string, React.CSSProperties> = {
  needTag: { fontSize: 14, color: '#c0392b', fontWeight: 700 },
  yesNo: { display: 'flex', gap: 6 },
  ynOff: {
    flex: 1, height: 36, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer',
    border: '1px solid var(--line)', borderRadius: 8, background: '#fff', color: 'var(--muted)',
  },
  ynOn: {
    flex: 1, height: 36, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer', fontWeight: 700,
    border: '1px solid var(--lime)', borderRadius: 8, background: '#f7fadf', color: 'var(--dark)',
  },
  row: { marginBottom: 8 },
  rowTight: { marginBottom: 9 },
  label: { display: 'block', fontSize: 14, color: 'var(--muted)', marginBottom: 5 },
  req: { fontSize: 14, color: '#b0b7c0' },
  hint: { fontSize: 14, color: '#b0b7c0' },
  field: {
    width: '100%', boxSizing: 'border-box', height: 36, padding: '0 9px', fontSize: 14,
    fontFamily: 'inherit', color: 'var(--dark)', border: '1px solid var(--line)',
    borderRadius: 8, background: '#fff', outline: 'none',
  },
  check: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 14, cursor: 'pointer', padding: '4px 0' },
  checkbox: { width: 15, height: 15, accentColor: 'var(--lime)' },
}
