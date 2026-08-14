import { useState } from 'react'
import { cardStates } from '../../styles/optionCard'
import type { ApiOptionGroup } from '@shared/types/index'
import { valueUnitPrice } from '@shared/pricing/core'
import { fmtWonVat } from '../OptionRow'
// 트림 카드 사진 — 컨피규레이터 3D 자리에 쓰는 것과 같은 이미지.
// 트림은 사양 차이지 겉모습 차이가 아니라 두 카드 모두 같은 사진이면 된다.
import trimImg from '../../assets/stego-k-side.jpg'

interface Props {
  groups: ApiOptionGroup[]
  selections: Record<string, string>
  onSelect: (groupCode: string, valueCode: string) => void
  hiddenValueCodes: Set<string>
  optionPrices: Record<string, number>
}

/**
 * 트림별 주요 사양 — 카드의 「사양 보기」를 누르면 카드 아래로 펼쳐진다.
 *
 * 예전엔 커서를 올려야 뜨는 말풍선이었는데, 태블릿에는 커서가 없어 **볼 방법이 없었다**.
 * 게다가 트림은 고를 때 차이를 반드시 봐야 하는 정보라, 있으면 좋은 보조 설명이 아니라
 * 선택 근거다 — 화면에 펼쳐 두는 편이 맞다.
 *
 * `b: true` = 기본(Basic) 대비 플러스(Plus)에서 **추가된** 항목. 두 트림의 차이가
 * 무엇인지가 고를 때 궁금한 전부라, 그것만 굵게 보이게 한다.
 */
type Seg = { t: string; b?: boolean }
const TRIM_SPECS: Record<string, { title: string; lines: Seg[][] }> = {
  TRIM_BASIC: {
    title: '기본(Basic)',
    lines: [
      [{ t: '71.2kWh 대용량 배터리' }],
      [{ t: '스마트 크루즈 컨트롤' }],
      [{ t: '12.9인치 PBV 인포테인먼트' }],
      [{ t: '후방 카메라' }],
      [{ t: '열선시트' }],
    ],
  },
  TRIM_PLUS: {
    title: '플러스(Plus)',
    lines: [
      [{ t: '71.2kWh 대용량 배터리' }],
      [{ t: '스마트 크루즈 컨트롤, ' }, { t: '고속도로 주행 보조(HDA)', b: true }],
      [{ t: '후측방 충돌 경고/보조, 후방교차 충돌방지 보조, 안전 하차 경고', b: true }],
      [{ t: '12.9인치 PBV 인포테인먼트' }],
      [{ t: '서라운드 뷰', b: true }, { t: '/후방 카메라' }],
      [{ t: '열선시트, ' }, { t: '통풍시트, 열선 스티어링, 레인센서', b: true }],
      [{ t: '16인치 알로이 휠', b: true }],
    ],
  },
}

/**
 * 펼친 사양 — 카드 아래 한 줄 전체를 쓴다(좁은 카드 폭에 욱여넣지 않는다).
 * 닫는 버튼은 두지 않는다 — 펼친 그 자리의 「사양 보기 ▴」 가 곧 닫는 버튼이다.
 */
function SpecPanel({ spec }: { spec: { title: string; lines: Seg[][] } }) {
  return (
    <div style={tip.panel}>
      <div style={tip.head}>
        <span style={tip.title}>{spec.title} 주요 사양</span>
      </div>
      <ul style={tip.list}>
        {spec.lines.map((segs, i) => (
          <li key={i} style={tip.item}>
            {segs.map((s, j) => (
              <span key={j} style={s.b ? tip.strong : undefined}>{s.t}</span>
            ))}
          </li>
        ))}
      </ul>
      <div style={tip.foot}>주요 옵션만 표기하였습니다</div>
    </div>
  )
}

export function VehicleOptionsTab({ groups, selections, onSelect, hiddenValueCodes, optionPrices }: Props) {
  const price = (c: string) => optionPrices[c] ?? 0
  /** 지금 펼쳐 둔 사양(값 코드). 한 번에 하나만 펼친다 — 둘 다 열면 화면만 길어진다. */
  const [openSpec, setOpenSpec] = useState<string | null>(null)

  return (
    <div>
      <div style={styles.row}>
        <label style={styles.label}>차종</label>
        <select>
          <option>STEGO-K</option>
        </select>
      </div>

      {groups.map(group => {
        const values = group.values.filter(v => !hiddenValueCodes.has(v.code))
        const opened = values.find(v => v.code === openSpec)
        return (
          <div key={group.code} style={styles.row}>
            <label style={styles.label}>{group.name}</label>
            <div style={styles.cardGrid}>
              {values.map(v => {
                const selected = selections[group.code] === v.code
                const spec = TRIM_SPECS[v.code]
                const isOpen = openSpec === v.code
                return (
                  <div
                    key={v.code}
                    // 카드는 button 이 아니라 div 라 눌림 반응이 안 걸린다 — 공통 class 로 준다
                    className="pressable"
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected}
                    style={selected ? styles.cardOn : styles.card}
                    onClick={() => onSelect(group.code, v.code)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(group.code, v.code) } }}
                  >
                    <div style={styles.cardImg}>
                      <img src={trimImg} alt={v.name} style={styles.cardImgPic} />
                    </div>
                    <div style={styles.cardName}>{v.name}</div>
                    <div style={styles.cardDelta}>{fmtWonVat(valueUnitPrice(group.code, v.code, selections, price))}</div>
                    {/* 사양이 정의된 트림만 — 카드 선택과 섞이지 않게 클릭을 여기서 멈춘다 */}
                    {spec && (
                      <button
                        type="button"
                        style={isOpen ? styles.specBtnOn : styles.specBtn}
                        onClick={e => { e.stopPropagation(); setOpenSpec(isOpen ? null : v.code) }}
                      >
                        사양 보기 {isOpen ? '▴' : '▾'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
            {/* 펼친 사양은 카드 아래 한 줄 전체 — 카드 폭에 욱여넣으면 읽기 어렵다 */}
            {opened && TRIM_SPECS[opened.code] && (
              <SpecPanel spec={TRIM_SPECS[opened.code]!} />
            )}
          </div>
        )
      })}
    </div>
  )
}

const TRIM_CARD = cardStates('var(--sp-3)')

const cardBase = {
  flex: 1,
  minWidth: 0,
  boxSizing: 'border-box' as const,
  textAlign: 'center' as const,
}

const styles = {
  row: { marginBottom: 14 },
  label: { display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 7 },
  cardGrid: { display: 'flex', gap: 10, alignItems: 'stretch' },
  card: { ...cardBase, ...TRIM_CARD.base },
  cardOn: { ...cardBase, ...TRIM_CARD.on },
  cardImg: {
    height: 70,
    background: '#fff',
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden' as const,
    color: '#b3b9c0',
    fontSize: 13,
  },
  // 차량이 잘리면 안 되므로 칸 안에 통째로 담는다(contain)
  cardImgPic: { width: '100%', height: '100%', objectFit: 'contain' as const, display: 'block' },
  cardName: { fontWeight: 700, fontSize: 15, marginTop: 9, color: 'var(--dark)' },
  cardCode: { fontSize: 13, color: 'var(--muted)', marginTop: 2 },
  cardDelta: { fontSize: 13, color: 'var(--muted)', marginTop: 3, fontWeight: 600 },
  // 손가락으로 누르는 자리라 높이는 공통 토큰(터치에서 44px)을 따른다
  specBtn: {
    marginTop: 'var(--sp-2)', width: '100%', minHeight: 'var(--h-control-sm)',
    fontSize: 'var(--fs-label)', fontFamily: 'inherit',
    border: 'var(--hairline)', borderRadius: 'var(--r-sm)', background: '#fff',
    color: 'var(--muted)', cursor: 'pointer',
  },
  specBtnOn: {
    marginTop: 'var(--sp-2)', width: '100%', minHeight: 'var(--h-control-sm)',
    fontSize: 'var(--fs-label)', fontFamily: 'inherit',
    fontWeight: 'var(--fw-label)' as React.CSSProperties['fontWeight'],
    // 펼쳐진 상태 = 선택 상태 → 라임 테두리 + 옅은 라임 배경(선택 표시 전용 색)
    border: '0.5px solid var(--lime)', borderRadius: 'var(--r-sm)', background: 'var(--lime-bg)',
    color: 'var(--dark)', cursor: 'pointer',
  },
}

const tip: Record<string, React.CSSProperties> = {
  panel: {
    marginTop: 10, background: 'var(--card)', border: '0.5px solid var(--line)',
    borderRadius: 10, padding: '11px 13px',
  },
  head: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 },
  title: { fontWeight: 700, fontSize: 14, color: 'var(--dark)' },
  list: { margin: 0, paddingLeft: 17, display: 'flex', flexDirection: 'column', gap: 3 },
  item: { fontSize: 13, lineHeight: 1.55, color: 'var(--body)' },
  strong: { fontWeight: 700, color: 'var(--dark)' },
  foot: { fontSize: 13, color: 'var(--muted)', marginTop: 8, paddingTop: 6, borderTop: '0.5px solid var(--line)' },
}
