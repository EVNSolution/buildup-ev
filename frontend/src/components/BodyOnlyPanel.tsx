import { BTN } from '../styles/buttons'

/**
 * **특장만 견적** — 고객이 차를 이미 갖고 있어 특장만 장착한다.
 *
 * 차량을 우리가 팔지 않으므로 차량가·탁송료·구매혜택·EV보조금·차량 등록비가 전부 빠진다.
 * 보유 차량의 **차종**은 계약서 생성 단계에서 받는다 — 견적 단계에서는 금액만 보면 되고,
 * 등록번호·차대번호는 계약 이후 특장사가 자동차등록증을 보고 채운다.
 */

/**
 * 고를 수 있는 보유 차종.
 *
 * ⚠️ 우리 특장은 **PV5 오픈베드**에 장착하도록 설계돼 있다 — 다른 차에는 올릴 수 없다.
 * 그래서 직접 입력이 아니라 **고르게** 한다. 손으로 적으면 「포터」 같은 값이 들어와
 * 견적서·구조변경 서류가 틀린 차를 가리키게 된다.
 *
 * 가격은 넣지 않는다 — 고객이 이미 산 차라 우리 판매가와 무관하다.
 */
export const OWNED_MODELS = [
  '오픈베드 베이직 스탠다드',
  '오픈베드 베이직 롱레인지',
  '오픈베드 플러스 스탠다드',
  '오픈베드 플러스 롱레인지',
] as const

/**
 * 냉동기는 주행 중에도 **차량 전원**으로 돌아간다 — V2L 포트가 없으면 설치 자체가 불가능하다.
 *
 * 우리가 파는 차(기본·플러스)는 모두 V2L 이 있어 확인할 것이 없다.
 * **고객 차에 장착할 때만** 물어야 한다.
 */
export const V2L_NOTICE = '냉동 사양은 차량에서 전원을 받습니다 — 고객 차량에 사용 가능한 V2L 포트가 있어야 설치할 수 있습니다.'
export const V2L_CONFIRM = 'V2L 모듈이 있어야 냉동기 설치가 가능합니다. 고객 차량에 사용 가능한 V2L 포트가 있음을 확인했습니다.'

/**
 * 「특장만」을 고르는 카드 — 트림 카드 아래에 둔다.
 *
 * 트림 옵션값으로 만들지 않았다. 그러면 옵션DB·단가표에 「차를 안 산다」는 항목이 생겨
 * 가격 조립이 그걸 알아야 한다. 차량 구매 여부는 **가격 항목이 아니라 견적의 성격**이다.
 */
export function BodyOnlyToggle({ on, onToggle, disabled }: {
  on: boolean; onToggle: (v: boolean) => void
  /** 차량만 견적을 고른 상태 — 둘은 동시에 될 수 없다 */
  disabled?: boolean
}) {
  return (
    <button
      style={disabled ? { ...BTN.rowDisabled, width: '100%' }
        : on ? { ...BTN.rowPrimary, width: '100%' } : { ...BTN.row, width: '100%' }}
      disabled={disabled}
      onClick={() => onToggle(!on)}
    >{on ? '✓ 특장만 견적' : '특장만 견적'}</button>
  )
}

/**
 * **차량만 견적** — 특장을 장착하지 않고 차량만 판다. [[BodyOnlyToggle]] 의 거울상이다.
 *
 * 특장만과 **동시에 고를 수 없다.** 둘 다 켜면 팔 것이 아무것도 남지 않는다 —
 * 한쪽을 켜면 다른 쪽 버튼이 눌리지 않게 막는다.
 */
export function VehicleOnlyToggle({ on, onToggle, disabled }: {
  on: boolean; onToggle: (v: boolean) => void
  /** 특장만 견적을 고른 상태 */
  disabled?: boolean
}) {
  return (
    <button
      style={disabled ? { ...BTN.rowDisabled, width: '100%' }
        : on ? { ...BTN.rowPrimary, width: '100%' } : { ...BTN.row, width: '100%' }}
      disabled={disabled}
      onClick={() => onToggle(!on)}
    >{on ? '✓ 차량만 견적' : '차량만 견적'}</button>
  )
}

/**
 * 특장만을 **골랐을 때만** 뜨는 안내. 평소에는 보이지 않는다 —
 * 차량을 사는 대부분의 견적에는 해당 없는 이야기라, 늘 띄워 두면 읽지 않게 된다.
 *
 * 여기서는 **알리기만** 한다. 실제 확인(체크)은 특장 탭에서 냉동을 고르는 그 자리에서 받는다.
 */
export function BodyOnlyNotice({ model, onModelChange }: {
  /** 보유 차종 — **임시저장 단계**에서 받는다. 어떤 차에 장착하는지는 견적의 전제다. */
  model: string
  /**
   * 없으면 **안내만** 하고 보유 차종은 묻지 않는다 — 공개 창구가 그렇다.
   * 거기서 받는 값은 상담 연락처뿐이고, 어떤 차인지는 영업이 임시저장할 때 채운다.
   */
  onModelChange?: (v: string) => void
}) {
  return (
    <div style={s.box}>
      <div style={s.title}>특장만 견적</div>
      <div style={s.desc}>고객이 보유한 차량에 특장만 제작·장착합니다.</div>
      <ul style={s.list}>
        <li><b>PV5 오픈베드</b> 차량에만 장착할 수 있습니다.</li>
        <li>{V2L_NOTICE}</li>
      </ul>
      {onModelChange && (
        <label style={s.field}>
          <span style={s.fieldLabel}>보유 차종<span style={s.req}> · 필수</span></span>
          <select style={s.input} value={model} onChange={e => onModelChange(e.target.value)}>
            <option value="">선택하세요</option>
            {OWNED_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
      )}
      <div style={s.hint}>계약서 생성 시 차량등록증과 차량 정보 입력이 필요합니다.</div>
    </div>
  )
}

/**
 * 냉동을 고르는 자리에 붙는 확인 — **특장만 견적일 때만** 뜬다.
 *
 * 확인 전에는 견적을 저장할 수 없다. 설치가 불가능한 견적이 고객에게 나가면 되돌릴 수 없다.
 */
export function V2lConfirm({ confirmed, onChange }: {
  confirmed: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div style={confirmed ? s.confirmOk : s.confirmNeed}>
      <label style={s.check}>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={e => onChange(e.target.checked)}
          style={{ marginTop: 2, flexShrink: 0 }}
        />
        <span>{V2L_CONFIRM}</span>
      </label>
      {!confirmed && <div style={s.blockHint}>확인해야 냉동 사양으로 견적을 저장할 수 있습니다.</div>}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  box: {
    border: 'var(--hairline)', borderRadius: 10, padding: 'var(--sp-4)', marginTop: 'var(--sp-3)',
    background: 'var(--bg-soft, #f7f7f5)',
  },
  title: { fontSize: 'var(--fs-label)', fontWeight: 700, marginBottom: 'var(--sp-1)' },
  desc: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', lineHeight: 1.55 },
  list: {
    margin: 'var(--sp-3) 0 0', paddingLeft: '1.1em',
    fontSize: 'var(--fs-caption)', lineHeight: 1.6,
  },
  hint: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', marginTop: 'var(--sp-3)' },
  field: { display: 'block', marginTop: 'var(--sp-4)' },
  fieldLabel: { display: 'block', fontSize: 'var(--fs-caption)', color: 'var(--muted)', marginBottom: 4 },
  req: { color: 'var(--req)', fontWeight: 700 },
  input: {
    width: '100%', padding: 'var(--sp-2) var(--sp-3)', borderRadius: 6,
    border: 'var(--hairline)', fontSize: 'var(--fs-label)', fontFamily: 'inherit',
  },
  confirmNeed: {
    // 아래 간격이 좁아 다음 블록과 붙어 보였다 — 옵션 행 사이와 같은 간격으로 맞춘다
    borderRadius: 8, padding: 'var(--sp-3)', margin: 'var(--sp-3) 0 var(--sp-5)',
    background: 'rgba(214,69,69,.06)', border: '1px solid var(--req)',
  },
  confirmOk: {
    borderRadius: 8, padding: 'var(--sp-3)', margin: 'var(--sp-3) 0 var(--sp-5)',
    background: 'rgba(200,210,0,.10)', border: 'var(--hairline)',
  },
  check: {
    display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-start',
    fontSize: 'var(--fs-caption)', lineHeight: 1.55, cursor: 'pointer',
  },
  blockHint: { fontSize: 'var(--fs-caption)', color: 'var(--req)', marginTop: 'var(--sp-2)', fontWeight: 600 },
}
