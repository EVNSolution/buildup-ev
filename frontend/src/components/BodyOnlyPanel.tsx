import { BTN } from '../styles/buttons'

/** 특장만 견적일 때 고객이 적어 주는 보유 차량 정보. 우리가 아는 제원이 아니다. */
export interface OwnedVehicle {
  car_name: string
  type_name: string
  plate_no: string
  vin: string
}

export const EMPTY_OWNED_VEHICLE: OwnedVehicle = { car_name: '', type_name: '', plate_no: '', vin: '' }

/** 냉동 특장은 주행 중에도 냉동기를 돌려야 해서 차량에 V2L(외부 전원) 포트가 있어야 한다. */
export const V2L_NOTICE = '냉동 사양은 차량에서 전원을 받아야 합니다 — 사용 가능한 V2L 포트가 있는 차량에만 설치할 수 있습니다.'
export const V2L_CONFIRM = 'V2L 모듈이 있어야 냉동기 설치가 가능합니다. 고객 차량에 사용 가능한 V2L 포트가 있음을 확인했습니다.'

/**
 * **특장만 견적** — 고객이 차를 이미 갖고 있어 특장만 얹는다.
 *
 * 차량을 우리가 팔지 않으므로 차량가·탁송료·구매혜택·EV보조금·차량 등록비가 전부 빠진다.
 * 대신 **어떤 차에 얹는지**를 알아야 한다 — 구조변경 서류와 튜닝 승인 신청서가 그 값을 쓴다.
 * 우리가 아는 제원이 아니라 고객이 알려 주는 값이라, 직접 입력받는다.
 */
export function BodyOnlyPanel({ value, onChange }: {
  value: OwnedVehicle
  onChange: (v: OwnedVehicle) => void
}) {
  const set = <K extends keyof OwnedVehicle>(k: K, v: string) => onChange({ ...value, [k]: v })
  return (
    <div style={s.box}>
      <div style={s.title}>고객 보유 차량</div>
      <div style={s.desc}>
        차량은 견적에서 빠집니다. 구조변경·튜닝 승인 서류에 들어갈 정보라 아는 만큼 적어 주세요.
      </div>
      <div style={s.grid}>
        <Field label="차명" placeholder="예: 포터 II 일렉트릭" value={value.car_name} onChange={v => set('car_name', v)} />
        <Field label="형식" placeholder="자동차등록증의 형식" value={value.type_name} onChange={v => set('type_name', v)} />
        <Field label="자동차등록번호" placeholder="예: 12가3456" value={value.plate_no} onChange={v => set('plate_no', v)} />
        <Field label="차대번호" placeholder="자동차등록증의 차대번호" value={value.vin} onChange={v => set('vin', v)} />
      </div>
    </div>
  )
}

function Field({ label, placeholder, value, onChange }: {
  label: string; placeholder: string; value: string; onChange: (v: string) => void
}) {
  return (
    <label style={s.field}>
      <span style={s.label}>{label}</span>
      <input style={s.input} type="text" placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />
    </label>
  )
}

/**
 * 「특장만」을 고르는 카드 — 트림 카드 아래에 둔다.
 *
 * 트림 옵션값으로 만들지 않았다. 그러면 옵션DB·단가표에 「차를 안 산다」는 항목이 생겨
 * 가격 조립이 그걸 알아야 한다. 차량 구매 여부는 **가격 항목이 아니라 견적의 성격**이다.
 */
export function BodyOnlyToggle({ on, onToggle }: { on: boolean; onToggle: (v: boolean) => void }) {
  return (
    <button
      style={on ? { ...BTN.rowPrimary, width: '100%' } : { ...BTN.row, width: '100%' }}
      onClick={() => onToggle(!on)}
    >{on ? '✓ 특장만 견적 (차량 구매 안 함)' : '특장만 견적 (차량 구매 안 함)'}</button>
  )
}

const s: Record<string, React.CSSProperties> = {
  box: { border: 'var(--hairline)', borderRadius: 10, padding: 'var(--sp-4)', marginTop: 'var(--sp-3)' },
  title: { fontSize: 'var(--fs-label)', fontWeight: 700, marginBottom: 'var(--sp-1)' },
  desc: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', marginBottom: 'var(--sp-3)', lineHeight: 1.5 },
  grid: { display: 'grid', gap: 'var(--sp-3)' },
  field: { display: 'block' },
  label: { display: 'block', fontSize: 'var(--fs-caption)', color: 'var(--muted)', marginBottom: 4 },
  input: {
    width: '100%', padding: 'var(--sp-2) var(--sp-3)', borderRadius: 6,
    border: 'var(--hairline)', fontSize: 'var(--fs-label)', fontFamily: 'inherit',
  },
  notice: {
    fontSize: 'var(--fs-caption)', color: 'var(--warn, #a15c00)', lineHeight: 1.55,
    background: 'rgba(255,180,0,.08)', borderRadius: 8, padding: 'var(--sp-3)',
  },
  confirmNeed: {
    borderRadius: 8, padding: 'var(--sp-3)',
    background: 'rgba(214,69,69,.06)', border: '1px solid var(--req)',
  },
  confirmOk: {
    borderRadius: 8, padding: 'var(--sp-3)',
    background: 'rgba(200,210,0,.10)', border: 'var(--hairline)',
  },
  check: {
    display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-start',
    fontSize: 'var(--fs-caption)', lineHeight: 1.55, cursor: 'pointer',
  },
  blockHint: { fontSize: 'var(--fs-caption)', color: 'var(--req)', marginTop: 'var(--sp-2)', fontWeight: 600 },
}

/**
 * 냉동 사양의 V2L 안내.
 *
 * 냉동기는 주행 중에도 차량 전원으로 돌아간다 — **V2L 포트가 없으면 설치 자체가 불가능하다.**
 *
 * 두 경우를 나눈다.
 *  · 차량을 우리가 판다 → **안내만.** 어떤 트림에 V2L 이 있는지는 제원에 없어 우리가 단정할 수 없다
 *  · 고객 차에 얹는다   → **확인을 받는다.** 우리가 모르는 차라, 영업이 직접 보고 확인해야 한다
 *
 * 확인 전에는 견적을 저장할 수 없다(SalesPage 가 막는다). 설치가 불가능한 견적을
 * 고객에게 내보내면 나중에 되돌릴 수 없다.
 */
export function V2lNotice({ bodyOnly, reeferSelected, confirmed, onConfirmedChange }: {
  bodyOnly: boolean
  reeferSelected: boolean
  confirmed: boolean
  onConfirmedChange?: (v: boolean) => void
}) {
  if (!reeferSelected) return null
  if (!bodyOnly) return <div style={s.notice}>⚠ {V2L_NOTICE}</div>
  return (
    <div style={confirmed ? s.confirmOk : s.confirmNeed}>
      <label style={s.check}>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={e => onConfirmedChange?.(e.target.checked)}
          style={{ marginTop: 2, flexShrink: 0 }}
        />
        <span>{V2L_CONFIRM}</span>
      </label>
      {!confirmed && <div style={s.blockHint}>확인해야 냉동 사양으로 견적을 저장할 수 있습니다.</div>}
    </div>
  )
}
