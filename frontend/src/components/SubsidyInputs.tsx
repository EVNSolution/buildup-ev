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
export interface SubsidyInputs {
  business_type: BusinessType
  region_code: string
  is_small_business: boolean
  has_transport_license: boolean
  diesel_status: DieselStatusCode
}

export const DEFAULT_SUBSIDY_INPUTS: SubsidyInputs = {
  business_type: 'individual',
  region_code: '',
  is_small_business: false,
  has_transport_license: false,
  diesel_status: 'none',
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
export function SubsidyForm({ value, onChange, regions, compact }: {
  value: SubsidyInputs
  onChange: (v: SubsidyInputs) => void
  regions: string[]
  compact?: boolean
}) {
  const set = <K extends keyof SubsidyInputs>(k: K, v: SubsidyInputs[K]) => onChange({ ...value, [k]: v })
  const s = compact ? f.rowTight : f.row

  return (
    <>
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

      <div style={s}>
        <label style={f.label}>지역 <span style={f.req}>· 지방보조금 조회 기준</span></label>
        <RegionPicker regions={regions} value={value.region_code} onChange={v => set('region_code', v)} />
      </div>

      <div style={s}>
        <label style={f.label}>경유차 폐차여부</label>
        <select
          style={f.field}
          value={value.diesel_status}
          onChange={e => set('diesel_status', e.target.value as DieselStatusCode)}
        >
          {DIESEL_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}{o.note ? ` (${o.note})` : ''}</option>
          ))}
        </select>
      </div>

      <label style={f.check}>
        <input
          type="checkbox" style={f.checkbox}
          checked={value.is_small_business}
          onChange={e => set('is_small_business', e.target.checked)}
        />
        소상공인 <span style={f.hint}>국고 30% 추가</span>
      </label>
      <label style={f.check}>
        <input
          type="checkbox" style={f.checkbox}
          checked={value.has_transport_license}
          onChange={e => set('has_transport_license', e.target.checked)}
        />
        화물자동차 운송사업허가증 <span style={f.hint}>개인사업자 국고 10% 추가</span>
      </label>
    </>
  )
}

const f: Record<string, React.CSSProperties> = {
  row: { marginBottom: 12 },
  rowTight: { marginBottom: 9 },
  label: { display: 'block', fontSize: 11.5, color: 'var(--muted)', marginBottom: 5 },
  req: { fontSize: 10.5, color: '#b0b7c0' },
  hint: { fontSize: 10.5, color: '#b0b7c0' },
  field: {
    width: '100%', boxSizing: 'border-box', height: 36, padding: '0 9px', fontSize: 12.5,
    fontFamily: 'inherit', color: 'var(--dark)', border: '1px solid var(--line)',
    borderRadius: 8, background: '#fff', outline: 'none',
  },
  check: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, cursor: 'pointer', padding: '4px 0' },
  checkbox: { width: 15, height: 15, accentColor: 'var(--lime)' },
}
