import type { ApiOptionGroup } from '@shared/types/index'
import { valueUnitPrice } from '@shared/pricing/core'
import { fmtWonVat } from '../OptionRow'
import { Tooltip } from '../Tooltip'
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
 * 트림별 주요 사양 — 카드에 마우스를 올리면 뜬다.
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

function SpecTip({ spec }: { spec: { title: string; lines: Seg[][] } }) {
  return (
    <div>
      <div style={tip.title}>{spec.title}</div>
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
  return (
    <div>
      <div style={styles.row}>
        <label style={styles.label}>차종</label>
        <select>
          <option>STEGO-K</option>
        </select>
      </div>

      {groups.map(group => (
        <div key={group.code} style={styles.row}>
          <label style={styles.label}>{group.name}</label>
          <div style={styles.cardGrid}>
            {group.values.filter(v => !hiddenValueCodes.has(v.code)).map(v => {
              const selected = selections[group.code] === v.code
              const spec = TRIM_SPECS[v.code]
              const card = (
                <div
                  style={selected ? styles.cardOn : styles.card}
                  onClick={() => onSelect(group.code, v.code)}
                >
                  <div style={styles.cardImg}>
                    <img src={trimImg} alt={v.name} style={styles.cardImgPic} />
                  </div>
                  <div style={styles.cardName}>{v.name}</div>
                  <div style={styles.cardDelta}>{fmtWonVat(valueUnitPrice(group.code, v.code, selections, price))}</div>
                </div>
              )
              // 사양이 정의된 트림만 설명을 띄운다
              return spec ? (
                <Tooltip
                  key={v.code}
                  text={<SpecTip spec={spec} />}
                  placement="below"
                  maxWidth={320}
                  minWidth={260}
                  wrapperStyle={styles.tipWrap}
                >
                  {card}
                </Tooltip>
              ) : (
                <div key={v.code} style={styles.tipWrap}>{card}</div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

const cardBase = {
  width: '100%',
  boxSizing: 'border-box' as const,
  border: '1.5px solid var(--line)',
  borderRadius: 12,
  padding: 11,
  cursor: 'pointer',
  textAlign: 'center' as const,
  transition: '.12s',
}

const styles = {
  row: { marginBottom: 14 },
  label: { display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 7 },
  cardGrid: { display: 'flex', gap: 10 },
  // Tooltip 이 감싸는 span 이 카드 대신 flex 항목이 된다 — 늘어나게 해줘야 폭이 유지된다
  tipWrap: { display: 'flex', flex: 1, minWidth: 0 },
  card: cardBase,
  cardOn: {
    ...cardBase,
    borderColor: 'var(--lime)',
    boxShadow: '0 0 0 2px rgba(200,210,0,.25)',
  },
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
}

const tip: Record<string, React.CSSProperties> = {
  title: { fontWeight: 700, fontSize: 12, marginBottom: 5, color: '#c8d200' },
  list: { margin: 0, paddingLeft: 15, display: 'flex', flexDirection: 'column', gap: 2 },
  item: { fontSize: 11.5, lineHeight: 1.5 },
  strong: { fontWeight: 700 },
  foot: { fontSize: 10.5, color: '#9aa0a8', marginTop: 7, paddingTop: 5, borderTop: '1px solid rgba(255,255,255,.15)' },
}
