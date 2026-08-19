import { BTN } from '../styles/buttons'

/**
 * **특장만 견적** — 고객이 차를 이미 갖고 있어 특장만 얹는다.
 *
 * 차량을 우리가 팔지 않으므로 차량가·탁송료·구매혜택·EV보조금·차량 등록비가 전부 빠진다.
 * 보유 차량의 **차종**은 계약서 생성 단계에서 받는다 — 견적 단계에서는 금액만 보면 되고,
 * 등록번호·차대번호는 계약 이후 특장사가 자동차등록증을 보고 채운다.
 */

/** ⚠️ 우리 특장은 **PV5 오픈베드**에 얹도록 설계돼 있다. 다른 차에는 올릴 수 없다. */
export const OWNED_MODEL_PLACEHOLDER = '예: PV5 오픈베드 플러스 롱레인지'

/**
 * 냉동기는 주행 중에도 **차량 전원**으로 돌아간다 — V2L 포트가 없으면 설치 자체가 불가능하다.
 *
 * 우리가 파는 차(기본·플러스)는 모두 V2L 이 있어 확인할 것이 없다.
 * **고객 차에 얹을 때만** 물어야 한다.
 */
export const V2L_NOTICE = '냉동 사양은 차량에서 전원을 받습니다 — 고객 차량에 사용 가능한 V2L 포트가 있어야 설치할 수 있습니다.'
export const V2L_CONFIRM = 'V2L 모듈이 있어야 냉동기 설치가 가능합니다. 고객 차량에 사용 가능한 V2L 포트가 있음을 확인했습니다.'

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

/**
 * 특장만을 **골랐을 때만** 뜨는 안내. 평소에는 보이지 않는다 —
 * 차량을 사는 대부분의 견적에는 해당 없는 이야기라, 늘 띄워 두면 읽지 않게 된다.
 *
 * 여기서는 **알리기만** 한다. 실제 확인(체크)은 특장 탭에서 냉동을 고르는 그 자리에서 받는다.
 */
export function BodyOnlyNotice() {
  return (
    <div style={s.box}>
      <div style={s.title}>특장만 견적</div>
      <div style={s.desc}>
        고객이 보유한 차량에 특장만 제작·장착합니다. 차량 가격·탁송료·EV보조금·차량 등록비가
        견적에서 빠집니다.
      </div>
      <ul style={s.list}>
        <li><b>PV5 오픈베드</b> 차량에만 얹을 수 있습니다.</li>
        <li>{V2L_NOTICE}</li>
      </ul>
      <div style={s.hint}>보유 차량의 차종은 계약서 생성 단계에서 입력합니다.</div>
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
  confirmNeed: {
    borderRadius: 8, padding: 'var(--sp-3)', marginTop: 'var(--sp-3)',
    background: 'rgba(214,69,69,.06)', border: '1px solid var(--req)',
  },
  confirmOk: {
    borderRadius: 8, padding: 'var(--sp-3)', marginTop: 'var(--sp-3)',
    background: 'rgba(200,210,0,.10)', border: 'var(--hairline)',
  },
  check: {
    display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-start',
    fontSize: 'var(--fs-caption)', lineHeight: 1.55, cursor: 'pointer',
  },
  blockHint: { fontSize: 'var(--fs-caption)', color: 'var(--req)', marginTop: 'var(--sp-2)', fontWeight: 600 },
}
