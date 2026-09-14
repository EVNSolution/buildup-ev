import type { ApiOrder } from '@shared/types/index'
import { TRACK_LABEL, TRACKS, type Track } from '@shared/process/steps'
import { ADDON_TRACK_LABEL, ADDON_TRACKS, type AddonTrack } from '@shared/process/addon'
import { dueInfo } from '@shared/process/due'
import { t, tf } from '../i18n'
import { daysFrom, type Dashboard, type DashSelection, type TileKey, type WaitingItem } from '../lib/orderDashboard'
import { BTN } from '../styles/buttons'
import { useIsMobile } from '../hooks/useIsMobile'

/**
 * **주문 현황판** — 관리자 「주문 진행」 탭 맨 위(2026-09-14 기획).
 *
 * 글은 최대한 적게: 숫자와 짧은 이름만. 칸이나 단계를 누르면 **바로 아래에** 그 주문 목록이 펼쳐지고,
 * 거기서 주문을 연다. 배정 대기에서는 그 자리에서 제작 배정까지 한다 — 제조운영이 한 화면에서
 * 배정부터 조회·관리까지 끝낼 수 있게.
 *
 * ⚠️ 한 주문이 여러 트랙에 동시에 걸린다(차량은 번호판, 특장은 제작 중). 줄마다 한 번씩 세므로
 *    줄끼리 더하면 주문 수보다 크다 — 한 줄 안에서는 겹치지 않는다(lib/orderDashboard).
 */

type IconName = 'hourglass' | 'inbox' | 'progress' | 'check' | 'alert' | 'truck' | 'tool' | 'file' | 'flag'

/** 선 아이콘 — 알림 종과 같은 모양새(이모지는 기기마다 달라 쓰지 않는다) */
function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const p = {
    hourglass: <><path d="M6 3h12M6 21h12" /><path d="M7 3c0 5 10 5 10 9s-10 4-10 9" /><path d="M17 3c0 5-10 5-10 9s10 4 10 9" /></>,
    inbox: <><path d="M4 13h4l2 3h4l2-3h4" /><path d="M4 13l2-8h12l2 8v6H4z" /></>,
    progress: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
    check: <><circle cx="12" cy="12" r="8" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></>,
    alert: <><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17h.01" /></>,
    truck: <><path d="M3 6h11v10H3z" /><path d="M14 10h4l3 3v3h-7" /><circle cx="7" cy="18" r="1.8" /><circle cx="17" cy="18" r="1.8" /></>,
    tool: <><path d="M14.5 5.5a4 4 0 0 0-5 5L4 16l4 4 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z" /></>,
    file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 13h6M9 17h4" /></>,
    flag: <><path d="M5 21V4" /><path d="M5 4h12l-2 4 2 4H5" /></>,
  }[name]
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"
      stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{p}</svg>
  )
}

/*
 * 칸 순서 = 주문이 흐르는 순서(2026-09-14): 배정 대기 → 수락 대기 → 특장 진행 → 부가작업 → 인도 완료(고객 인도).
 * 「부가작업」은 관리자 + addon.manage 일 때만(응답에 부가작업이 실렸을 때) 보인다.
 */
const TILES: { key: TileKey; label: string; icon: IconName }[] = [
  { key: 'assign', label: '배정 대기', icon: 'hourglass' },
  { key: 'pending', label: '수락 대기', icon: 'inbox' },
  { key: 'active', label: '특장 진행', icon: 'progress' },
  { key: 'addon', label: '부가작업', icon: 'tool' },
  { key: 'done', label: '인도 완료', icon: 'check' },
  { key: 'late', label: '납기일 경과', icon: 'alert' },
]
const TRACK_ICON: Record<Track, IconName> = { vehicle: 'truck', body: 'tool', tuning: 'file', merged: 'flag' }
const ADDON_ICON: Record<AddonTrack, IconName> = { prep: 'truck', work: 'tool', handover: 'flag' }

/** 트랙 줄 한 벌 — 특장사 단계(차량·특장·튜닝·출고) 또는 부가작업(작업 전·작업 중·고객 인도) */
type LaneRow = { key: string; label: string; icon: IconName; chips: { code: string; label: string; orders: ApiOrder[]; late: number }[] }

export function OrderDashboard({
  dash, selected, onSelect, makers, maker, onMaker,
}: {
  dash: Dashboard
  selected: DashSelection | null
  onSelect: (s: DashSelection | null) => void
  /** 특장사 거르기 칩 — 둘 이상일 때만 띄운다 */
  makers: { code: string; name: string }[]
  maker: string | null
  onMaker: (code: string | null) => void
}) {
  /*
   * **휴대폰** — 두 가지를 바꾼다(2026-09-14 로컬 확인 후 지시).
   *   · 요약 칸 5개가 3+2 로 줄바꿈되며 오른쪽 아래가 비었다 → 네 칸을 한 줄에, 「납기일 경과」는 아래 긴 줄 하나로
   *   · 트랙 칩이 화면 밖으로 잘려 밀 수 있는지 안 보였다 → 트랙 이름을 위로 올리고 칩은 **줄바꿈**해 전부 보이게
   */
  // 기준은 **헤더와 같은 768px**(useIsMobile 기본값). 600 으로 두었더니 601~768 폭에서 헤더는 휴대폰 모양인데
  // 현황판은 PC 모양이라 요약 칸이 4+1 로 줄바꿈되며 빈자리가 다시 생겼다(실측 611px)
  const narrow = useIsMobile()
  /*
   * **트랙 현황판은 「진행 중」을 눌렀을 때만 편다**(2026-09-14 지시). 배정 대기·수락 대기·인도 완료는
   * 단계가 없어 트랙이 필요 없다 — 늘 펴 두면 화면만 차지해 정작 목록이 밀려난다.
   * 단계 칩을 고른 동안에도 펴 두고, 「진행 중」 칸도 고른 채로 보인다(칩은 진행 중 안의 한 칸이다).
   */
  const stepGroup = selected?.kind === 'step' ? selected.group : null
  /** 펼칠 트랙 한 벌 — 특장 진행이면 특장사 단계, 부가작업이면 부가작업 단계, 아니면 없음 */
  const laneGroup: 'maker' | 'addon' | null =
    stepGroup ?? (selected?.kind === 'tile' && selected.key === 'active' ? 'maker'
      : selected?.kind === 'tile' && selected.key === 'addon' ? 'addon' : null)
  const isTile = (k: TileKey) =>
    (selected?.kind === 'tile' && selected.key === k) || (k === 'active' && stepGroup === 'maker') || (k === 'addon' && stepGroup === 'addon')
  const isStep = (group: 'maker' | 'addon', tr: string, code: string) =>
    selected?.kind === 'step' && selected.group === group && selected.track === tr && selected.code === code
  const count: Record<TileKey, number> = {
    assign: dash.assign.length, pending: dash.pending.length, active: dash.active.length,
    addon: dash.addon.length, done: dash.done.length, late: dash.late.length,
  }
  const tiles = TILES.filter(tile => (tile.key !== 'addon' || dash.addonEnabled) && !(narrow && tile.key === 'late'))
  const laneRows: LaneRow[] = laneGroup === 'maker'
    ? TRACKS.map(tr => ({ key: tr, label: TRACK_LABEL[tr], icon: TRACK_ICON[tr], chips: dash.lanes[tr] }))
    : laneGroup === 'addon'
      ? ADDON_TRACKS.map(tr => ({ key: tr, label: ADDON_TRACK_LABEL[tr], icon: ADDON_ICON[tr], chips: dash.addonLanes[tr] }))
      : []
  const pickStep = (group: 'maker' | 'addon', track: string, code: string, on: boolean) => {
    // 같은 칩을 다시 누르면 칩만 풀고 **그 칸 전체**로 돌아간다(트랙은 편 채로)
    if (on) { onSelect({ kind: 'tile', key: group === 'maker' ? 'active' : 'addon' }); return }
    onSelect(group === 'maker'
      ? { kind: 'step', group, track: track as Track, code }
      : { kind: 'step', group, track: track as AddonTrack, code })
  }
  // 같은 것을 다시 누르면 접는다 — 펼친 목록을 닫는 길이 하나 더 있어야 한다
  const pick = (s: DashSelection, on: boolean) => onSelect(on ? null : s)

  return (
    <div style={s.root}>
      {makers.length > 1 && (
        <div style={s.makerRow} role="group" aria-label={t('특장사')}>
          <button type="button" style={maker === null ? s.makerOn : s.maker} onClick={() => onMaker(null)}>{t('전체')}</button>
          {makers.map(m => (
            <button key={m.code} type="button" style={maker === m.code ? s.makerOn : s.maker} onClick={() => onMaker(m.code)}>{m.name}</button>
          ))}
        </div>
      )}

      <div style={narrow ? { ...s.tilesNarrow, gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` } : s.tiles}>
        {tiles.map(tile => {
          const n = count[tile.key]
          const on = isTile(tile.key)
          const warn = tile.key === 'late' && n > 0
          return (
            <button
              key={tile.key}
              type="button"
              aria-pressed={on}
              onClick={() => pick({ kind: 'tile', key: tile.key }, on)}
              style={{ ...(narrow ? s.tileNarrow : s.tile), ...(warn ? s.tileWarn : {}), ...(on ? s.tileOn : {}) }}
            >
              <span style={{ ...(narrow ? s.tileLabelNarrow : s.tileLabel), ...(warn ? { color: 'var(--req)' } : {}) }}>
                {/* 휴대폰 칸은 좁아 아이콘을 뺀다 — 네 글자 이름과 숫자만 */}
                {!narrow && <Icon name={tile.icon} size={17} />}{t(tile.label)}
              </span>
              <span style={{ ...(narrow ? s.tileNumNarrow : s.tileNum), ...(n === 0 ? { color: 'var(--muted)' } : {}), ...(warn ? { color: 'var(--req)' } : {}) }}>{n}</span>
            </button>
          )
        })}
      </div>

      {narrow && (() => {
        // 휴대폰의 「납기일 경과」 — 칸 대신 긴 줄 하나. 0 건이면 흐리게
        const n = count.late
        const on = isTile('late')
        return (
          <button
            type="button"
            aria-pressed={on}
            onClick={() => pick({ kind: 'tile', key: 'late' }, on)}
            style={{ ...s.lateBar, ...(n > 0 ? s.lateBarWarn : {}), ...(on ? s.tileOn : {}) }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="alert" size={17} />{t('납기일 경과')}</span>
            <span style={s.lateBarNum}>{n}</span>
          </button>
        )
      })()}

      {laneRows.length > 0 && <div style={s.lanes}>
        {laneRows.map((row, i) => (
          <div key={row.key} style={{ ...(narrow ? s.laneNarrow : s.lane), ...(i === laneRows.length - 1 ? { borderBottom: 'none' } : {}) }}>
            <span style={s.laneName}><Icon name={row.icon} size={18} />{t(row.label)}</span>
            <div style={narrow ? s.chipsWrap : s.chips}>
              {row.chips.map(chip => {
                const n = chip.orders.length
                const on = isStep(laneGroup!, row.key, chip.code)
                return (
                  <button
                    key={chip.code}
                    type="button"
                    aria-pressed={on}
                    aria-label={tf('{0} {1}건', t(chip.label), n) + (chip.late > 0 ? ` · ${t('지연 있음')}` : '')}
                    onClick={() => pickStep(laneGroup!, row.key, chip.code, on)}
                    style={{
                      ...s.chip,
                      ...(n === 0 ? s.chipZero : {}),
                      ...(chip.late > 0 ? s.chipLate : {}),
                      ...(on ? s.chipOn : {}),
                    }}
                  >
                    {/* 지연 점은 **맨 앞** — 글자와 겹치지 않는 자리 */}
                    {chip.late > 0 && <span style={s.lateDot} aria-hidden="true" />}
                    <span>{t(chip.label)}</span>
                    <span style={on ? s.chipNumOn : s.chipNum}>{n}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>}
    </div>
  )
}

/**
 * 고른 칸의 **주문 목록** — 한 줄에 번호 · 고객 · 특장사 · 납기 · 며칠째만.
 * 누르면 그 주문을 연다. 배정 대기 줄은 그 자리에서 「제작 배정」.
 */
export function DashboardList({
  title, orders, waiting, track, addonTrack, addonMode = false, makerName, onOpen, onAssign, onRejectedOpen, onClose,
}: {
  title: string
  orders?: ApiOrder[]
  waiting?: WaitingItem[]
  /** 단계 칩에서 열었으면 그 트랙 — 「며칠째」를 그 단계가 열린 날부터 센다 */
  track?: Track
  /** 부가작업 단계 칩에서 열었으면 그 트랙 */
  addonTrack?: AddonTrack
  /** 부가작업 목록 — 납기 대신 **고객 인도 목표일**, 며칠째는 공장 출고(또는 그 단계가 열린 날)부터 */
  addonMode?: boolean
  makerName: (code: string | null | undefined) => string
  onOpen: (o: ApiOrder) => void
  /** 배정 권한이 없으면 넘기지 않는다 — 버튼째 감춘다 */
  onAssign?: (quoteId: number) => void
  onRejectedOpen: (o: ApiOrder) => void
  onClose: () => void
}) {
  const n = waiting ? waiting.length : orders?.length ?? 0
  return (
    <div style={s.list}>
      <div style={s.listHead}>
        <span style={s.listTitle}>{title} <span style={s.listCount}>{tf('{0}건', n)}</span></span>
        <button type="button" style={s.close} onClick={onClose} aria-label={t('목록 닫기')}>✕</button>
      </div>
      {n === 0 && <div style={s.empty}>{t('해당하는 주문이 없습니다.')}</div>}

      {waiting?.map(w => (
        <div key={w.quote.id} style={s.row}>
          <span style={s.rowNo}>{w.quote.quote_no ?? `#${w.quote.id}`}</span>
          <span style={s.rowMain}>
            <span style={s.rowName}>{w.quote.customer?.name ?? '—'}</span>
            {w.rejected && (
              <button type="button" style={s.rejectTag} onClick={() => onRejectedOpen(w.rejected!)}
                title={w.rejected.reject_reason ?? ''}>
                {tf('{0} 거부', makerName(w.rejected.rejected_by_org))}
              </button>
            )}
          </span>
          <span style={s.rowSub}>{tf('{0}일째', daysFrom(w.quote.contract?.completed_at ?? w.quote.created_at) ?? 0)}</span>
          {onAssign
            ? <button type="button" style={BTN.rowPrimary} onClick={() => onAssign(w.quote.id)}>{t('제작 배정')}</button>
            : <span />}
        </div>
      ))}

      {orders?.map(o => {
        if (addonMode) {
          const target = dueInfo(o.addon?.target_on)
          const since = addonTrack ? o.addon?.lanes?.[addonTrack]?.since : o.addon?.factory_done_at
          const late = target.state === 'overdue' && !o.addon?.finished
          return (
            <button key={o.id} type="button" style={s.rowBtn} onClick={() => onOpen(o)}>
              <span style={s.rowNo}>#{o.id}</span>
              <span style={s.rowMain}>
                <span style={s.rowName}>{o.quote.customer?.name ?? '—'}</span>
                <span style={s.rowMaker}>{makerName(o.maker_org_id)}</span>
              </span>
              <span style={{ ...s.rowSub, ...(late ? { color: 'var(--req)', fontWeight: 700 } : {}) }}>
                {o.addon?.finished && o.addon.delivered_on
                  ? tf('인도 {0}', o.addon.delivered_on.slice(5))
                  : o.addon?.target_on
                    ? (target.days < 0 ? tf('목표 +{0}일', -target.days) : target.days === 0 ? t('목표 오늘') : tf('목표 D-{0}', target.days))
                    : t('목표 미정')}
              </span>
              <span style={s.rowDays}>{tf('{0}일째', daysFrom(since) ?? 0)}</span>
            </button>
          )
        }
        const due = dueInfo(o.delivery_due)
        const since = track ? o.steps?.lanes?.[track]?.since : (o.accepted_at ?? o.assigned_at ?? o.created_at)
        // 그 단계의 약속일을 넘겼거나, 주문 납기가 지났으면 빨갛게
        const late = (track ? !!o.steps?.lanes?.[track]?.late : false) || due.state === 'overdue'
        return (
          <button key={o.id} type="button" style={s.rowBtn} onClick={() => onOpen(o)}>
            <span style={s.rowNo}>#{o.id}</span>
            <span style={s.rowMain}>
              <span style={s.rowName}>{o.quote.customer?.name ?? '—'}</span>
              <span style={s.rowMaker}>{makerName(o.maker_org_id)}</span>
            </span>
            <span style={{ ...s.rowSub, ...(late ? { color: 'var(--req)', fontWeight: 700 } : {}) }}>
              {o.delivery_due
                ? (due.days < 0 ? tf('납기 +{0}일', -due.days) : due.days === 0 ? t('납기 오늘') : `D-${due.days}`)
                : '—'}
            </span>
            <span style={s.rowDays}>{tf('{0}일째', daysFrom(since) ?? 0)}</span>
          </button>
        )
      })}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', marginBottom: 'var(--sp-3)' },
  makerRow: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  maker: {
    fontFamily: 'inherit', fontSize: 'var(--fs-label)', padding: '6px 12px', minHeight: 36,
    border: 'var(--hairline)', borderRadius: 999, background: '#fff', color: 'var(--body)', cursor: 'pointer',
  },
  makerOn: {
    fontFamily: 'inherit', fontSize: 'var(--fs-label)', padding: '6px 12px', minHeight: 36, fontWeight: 700,
    border: '1px solid var(--dark)', borderRadius: 999, background: 'var(--dark)', color: '#fff', cursor: 'pointer',
  },
  tiles: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))', gap: 8 },
  tile: {
    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4, textAlign: 'left',
    background: 'var(--card)', border: '2px solid transparent', borderRadius: 'var(--r-md)',
    padding: '10px 12px', cursor: 'pointer', fontFamily: 'inherit', minWidth: 0,
  },
  // ⚠️ 테두리는 **늘 한 줄로**(border) 준다. borderColor 만 덮었다 걷으면 React 가 그 값만 지워
  //    기본색(검정)으로 돌아간다 — 고르지 않은 칸에 검은 테두리가 남았다(실측).
  tileOn: { border: '2px solid var(--dark)', background: '#fff' },
  // 휴대폰 — 네 칸 한 줄
  tilesNarrow: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 },
  tileNarrow: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, textAlign: 'center',
    background: 'var(--card)', border: '2px solid transparent', borderRadius: 'var(--r-md)',
    padding: '8px 2px', cursor: 'pointer', fontFamily: 'inherit', minWidth: 0,
  },
  tileLabelNarrow: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' },
  tileNumNarrow: { fontSize: 24, fontWeight: 700, color: 'var(--dark)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.15 },
  lateBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
    background: 'var(--card)', border: '2px solid transparent', borderRadius: 'var(--r-md)',
    padding: '8px 14px', minHeight: 44, cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 'var(--fs-label)', color: 'var(--muted)', marginTop: -4,
  },
  lateBarWarn: { background: 'rgba(192,57,43,.08)', color: 'var(--req)', fontWeight: 700 },
  lateBarNum: { fontSize: 20, fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
  tileWarn: { background: 'rgba(192,57,43,.08)' },
  tileLabel: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-label)', color: 'var(--muted)', whiteSpace: 'nowrap' },
  tileNum: { fontSize: 26, fontWeight: 700, color: 'var(--dark)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 },
  lanes: { border: 'var(--hairline)', borderRadius: 'var(--r-md)', padding: '2px 12px', background: '#fff' },
  lane: {
    display: 'grid', gridTemplateColumns: '72px minmax(0, 1fr)', alignItems: 'center', gap: 8,
    padding: '8px 0', borderBottom: 'var(--hairline)',
  },
  laneName: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-label)', color: 'var(--muted)', fontWeight: 600 },
  // 칩이 넘치면 **가로로 민다** — 줄바꿈하면 트랙 줄 높이가 제각각이 된다
  chips: { display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 },
  // 휴대폰 — 트랙 이름을 위에, 칩은 줄바꿈해 **전부 보이게**(가로로 밀면 잘린 칩이 있는지 모른다)
  laneNarrow: { display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 0', borderBottom: 'var(--hairline)' },
  chipsWrap: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  chip: {
    flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 6,
    fontFamily: 'inherit', fontSize: 'var(--fs-label)', color: 'var(--dark)', whiteSpace: 'nowrap',
    border: '1px solid var(--line)', borderRadius: 999, background: '#fff', padding: '5px 10px', minHeight: 36, cursor: 'pointer',
  },
  chipZero: { color: 'var(--muted)', background: 'var(--card)', border: '1px solid transparent' },
  chipLate: { border: '1px solid var(--req)' },
  chipOn: { background: 'var(--dark)', color: '#fff', border: '1px solid var(--dark)' },
  chipNum: { fontWeight: 700, fontVariantNumeric: 'tabular-nums', minWidth: 14, textAlign: 'center' },
  chipNumOn: { fontWeight: 700, fontVariantNumeric: 'tabular-nums', minWidth: 14, textAlign: 'center', color: '#fff' },
  lateDot: { width: 7, height: 7, borderRadius: 999, background: 'var(--req)', flexShrink: 0 },
  list: { border: 'var(--hairline)', borderRadius: 'var(--r-md)', background: '#fff', padding: '4px 12px 8px', marginBottom: 'var(--sp-4)' },
  listHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' },
  listTitle: { fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--dark)' },
  listCount: { fontSize: 'var(--fs-label)', fontWeight: 500, color: 'var(--muted)', marginLeft: 4 },
  close: {
    fontFamily: 'inherit', fontSize: 16, width: 36, height: 36, border: 'none', background: 'transparent',
    color: 'var(--muted)', cursor: 'pointer', borderRadius: 999,
  },
  empty: { color: 'var(--muted)', fontSize: 'var(--fs-label)', padding: '12px 0' },
  row: {
    display: 'grid', gridTemplateColumns: 'minmax(70px, auto) minmax(0, 1fr) auto auto', alignItems: 'center', gap: 10,
    padding: '10px 0', borderTop: 'var(--hairline)',
  },
  rowBtn: {
    display: 'grid', gridTemplateColumns: '52px minmax(0, 1fr) auto 48px', alignItems: 'center', gap: 10,
    padding: '11px 0', width: '100%', textAlign: 'left',
    // 버튼 기본 테두리를 지운 **다음에** 윗줄만 — 순서가 바뀌면 윗줄이 굵은 검은 선이 된다(실측)
    border: 'none', borderTop: 'var(--hairline)',
    background: 'transparent', cursor: 'pointer', fontFamily: 'inherit',
  },
  rowNo: { fontSize: 'var(--fs-label)', fontWeight: 700, color: 'var(--dark)', fontVariantNumeric: 'tabular-nums' },
  rowMain: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
  rowName: { fontSize: 'var(--fs-body)', color: 'var(--dark)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rowMaker: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', whiteSpace: 'nowrap' },
  rowSub: { fontSize: 'var(--fs-label)', color: 'var(--muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  rowDays: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', textAlign: 'right', whiteSpace: 'nowrap' },
  rejectTag: {
    fontFamily: 'inherit', fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--req)',
    background: 'rgba(192,57,43,.08)', border: 'none', borderRadius: 999, padding: '3px 8px', cursor: 'pointer', whiteSpace: 'nowrap',
  },
}
