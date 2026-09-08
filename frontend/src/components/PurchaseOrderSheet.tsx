import { useLayoutEffect, useRef, useState } from 'react'
import { t, tf } from '../i18n'
import type { ApiOrderOption } from '@shared/types/index'
import { toDateInput } from '@shared/schedule/businessDays'
import { DELIVERY_DUE_BUSINESS_DAYS } from '@shared/schedule/businessDays'
import { APPENDIX_REMARK } from '@shared/docs/appendix'
import { poTotal, type PoLine } from '@shared/docs/po-lines'

/**
 * 발주서 — **특장사가 보는 유일한 서류.**
 *
 * 계약서·견적서에는 고객 개인정보와 판매가가 들어 있어 특장사에게 가지 않는다(서버에서 막았다).
 * 특장사가 알아야 하는 것은 「누가 무엇을 언제까지 만들어 달라고 했는가」뿐이고, 그게 발주서다.
 *
 * ⚠️ **품목·수량·단가 칸은 두지 않는다.** 발주 품목은 견적 옵션과 1:1이 아니라 변환
 *    규칙과 특장사별 단가표가 필요하다(docs/process-redesign.md §4-3). 빈 칸을 띄워
 *    두면 「곧 채워지나」 하고 기다리게 되므로 아예 뺐다 — 표가 확정되면 그때 넣는다.
 *    지금 발주 내용은 **사양**이고, 이 주문만의 요청은 **비고**다.
 */
export function PurchaseOrderSheet({
  orderId, orderedAt, makerOrgName, modelCode, options, deliveryDue, remark, editable, poLines, poEditor,
  appendix, appendixEditable, appendixFooter,
}: {
  /**
   * 주문 번호 = 발주서의 문서번호.
   *
   * ⚠️ 배정 **전** 미리보기에는 아직 주문이 없어 `0` 이 들어온다. 그대로 찍으면
   *    「주문 #0」이 되어 **0번이라는 문서가 있는 것처럼** 읽힌다(제보).
   *    번호는 배정하는 순간 붙으므로, 그때까지는 없다고 말한다.
   */
  /**
   * 발주서 **공급가 표** — 특장사에 지급할 금액. 계약 단가 줄 + 관리자가 적은 줄.
   * 없으면 표 자체를 그리지 않는다 — 빈 표는 「0원짜리 발주」로 읽힌다.
   */
  poLines?: readonly PoLine[]
  /** 배정 화면에서 관리자가 표를 고칠 수 있게 넣는 편집기. 특장사 화면에서는 없다 */
  poEditor?: React.ReactNode
  orderId: number
  /** 발주일 = 배정일 */
  orderedAt: Date
  makerOrgName: string
  modelCode: string
  options: ApiOrderOption[]
  /** 고른 납기일 — 아직이면 '' */
  deliveryDue: string
  /** 이 주문만의 요청사항. 없으면 「특별 요청사항 없음」 */
  remark?: string
  /** 비고를 **적는** 자리(배정 팝업)면 입력칸을 여기 끼운다 */
  editable?: React.ReactNode
  /** 커스텀 요청사항 — 서류 **맨 아래** 칸. 길면 길어지는 대로 둔다 */
  appendix?: string
  /** 커스텀 요청사항을 **적는** 자리(배정 팝업)면 입력칸을 여기 끼운다 */
  appendixEditable?: React.ReactNode
  /** 그 칸 아래에 붙이는 것(수락 화면의 「확인했습니다」 체크) */
  appendixFooter?: React.ReactNode
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [height, setHeight] = useState(0)

  /**
   * **양식은 늘 `BASE_W` 폭으로 조판하고, 남는 폭에 맞춰 통째로 축소한다.**
   *
   * 폭에 따라 그냥 흘려보내면 좁은 화면에서 글이 접혀 표 머리글이 겹치고 값이 잘린다
   * (「Unit price」가 두 줄, 「Amount」와 「Notes」가 붙어 버렸다 — 제보).
   * 실제 종이를 멀리서 보는 것과 같아, 화면이 좁아져도 비율도 줄바꿈도 그대로다.
   *
   * `zoom` 이 아니라 `transform` 인 이유: iOS 는 입력칸의 **지정된** 글씨 크기로 초점 확대
   * 여부를 판단한다. `transform` 은 지정값을 건드리지 않으므로 16px 규칙이 그대로 살아 있다.
   *
   * ⚠️ 높이는 **재지 않고 따라간다.** 예전엔 A4 한 장(`BASE_H`)에 가두고 넘치면 세로로도
   *    줄여 담았다. 그래서 내용이 길수록 글씨가 작아졌고, 적을 수 있는 분량을 곳곳에서
   *    막아야 했다(비고 4줄 · 별지 30줄 · 커스텀은 아예 2페이지). 이제 아래로 이어진다.
   */
  useLayoutEffect(() => {
    const frame = wrapRef.current
    const sheet = sheetRef.current
    if (!frame || !sheet) return
    const measure = () => {
      const k = Math.min(1, frame.clientWidth / BASE_W)
      setScale(k)
      // 축소된 만큼만 자리를 차지한다 — `transform` 은 레이아웃 높이를 바꾸지 않는다
      setHeight(sheet.scrollHeight * k)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(frame)
    ro.observe(sheet)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={wrapRef} style={{ ...s.frame, height }}>
      <div ref={sheetRef} style={{ ...s.sheet, transform: `scale(${scale})` }}>
      <div style={s.title}>{t('발 주 서')}</div>

      {/*
        네 칸을 **한 격자**에 담는다. 줄마다 따로 두면 라벨 폭이 줄마다 달라져
        「문서번호」와 「발주사」가 어긋난다 — 라벨 폭을 52px 로 못 박아 맞춰 뒀는데,
        영어는 그 폭에 안 들어가 **두 줄로 접혔다**(Document / number).
        격자로 묶으면 열이 가장 긴 라벨에 맞춰 함께 늘어나, 어느 언어에서도 접히지 않는다.
      */}
      <div style={s.metaGrid}>
        <Meta label="문서번호" value={docNo(orderId)} />
        <Meta label="발주일" value={toDateInput(orderedAt)} />
        <Meta label="발주사" value="EV&Solution" />
        <Meta label="공급사" value={makerOrgName} />
      </div>

      <div style={s.section}>{t('사양')}</div>
      <table style={s.table}>
        <tbody>
          <tr>
            <td style={s.tdLabel}>{t('차종')}</td>
            <td style={s.tdValue}>{modelCode}</td>
          </tr>
          {options.map(o => (
            <tr key={o.group_code}>
              <td style={s.tdLabel}>{t(o.group_name)}</td>
              <td style={s.tdValue}>{t(o.value_name)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/*
        공급가 표 — 계약서 [별첨3] 발주서 양식이 요구하는 표다.
        `No. | 품목명 | 단위 | 발주수량 | 단가 | 공급가액 | 비고`, 기본형/추가옵션 두 구역.

        ⚠️ **VAT 별도**라고 반드시 적는다. 계약 단가표가 별도 기준이라, 안 적으면
           특장사와 우리가 서로 다른 금액을 말하게 된다.
        ⚠️ 줄이 하나도 없으면 표를 아예 그리지 않는다 — 빈 표는 「0원짜리 발주」로 읽힌다.
      */}
      {poEditor
        ? poEditor
        : poLines && poLines.length > 0 && <PoTable lines={poLines} />}

      {/*
        비고 — **이 주문만의 요청사항.** 관리자가 배정할 때 적고, 특장사는 수락 전에 읽는다.
        줄바꿈·띄어쓰기를 적은 그대로 보여준다(`pre-wrap`) — 「윗줄은 A, 아랫줄은 B」처럼
        줄로 뜻을 나눈 글이 한 줄로 붙으면 다른 말이 된다.
        쓰는 자리(배정 팝업)에서 4줄로 잘라 두므로 여기서 양식이 깨질 일은 없다.
      */}
      <div style={s.section}>{t('비고')}</div>
      {editable
        ? editable
        : remark?.trim()
          /*
           * 비고는 사람이 적은 글이라 **그대로** 보여 준다(옮기지 않는다).
           * 딱 하나, 커스텀 건의 고정 안내만 옮긴다 — 저 문장은 서버가 넣은 것이고
           * **아래 칸으로 가는 유일한 안내**라, 못 읽으면 그런 칸이 있는 줄도 모른다.
           */
          ? <div style={s.remark}>{remark.trim() === APPENDIX_REMARK ? t(APPENDIX_REMARK) : remark}</div>
          : <div style={s.remarkEmpty}>{t('특별 요청사항 없음')}</div>}

      <div style={s.section}>{t('특이사항')}</div>
      <ol style={s.notes}>
        <li>{t('본 발주서는 공급사의 견적서 수령 이후 발주사·공급사 간 기 협의한 사항에 따릅니다.')}</li>
        <li>
          {/* 숫자가 끼어 있어 그동안 옮겨지지 않은 채 1·3·4 항 사이에 혼자 한국어로 남아 있었다 */}
          {tf('납기일자: 발주일로부터 {0}일 이내 (영업일 기준)', DELIVERY_DUE_BUSINESS_DAYS)}
          {deliveryDue && <b style={s.due}>{tf(' — {0} 로 지정', deliveryDue)}</b>}
        </li>
        <li>{t('납품장소 및 검사방법: 당사 지정 장소 및 당사 검사기준에 의함. 사전 협의하여 진행함.')}</li>
        <li>{t('기타: 상기 사항 외에 발주사·공급사 간 협의에 따라 진행함.')}</li>
      </ol>

      {/*
        커스텀 요청사항 — **서류 맨 아래 칸.**

        예전엔 이걸 「별지」라는 2페이지로 뺐다. 발주서를 A4 한 장에 맞추느라 비고가 4줄뿐이라
        커스텀 내용을 담지 못했기 때문이다. 그런데 한 장에 맞추려다 보니 별지도 한 장을 넘기면
        안 됐고(30줄·40자), 결국 **분량 때문에 골치**가 됐다(제보).

        지금은 서류가 아래로 이어진다 — 길면 길어지는 대로 두고, 보는 사람은 스크롤한다.
        그러니 장을 나눌 이유가 없다. 적은 것이 있을 때만 나온다.
      */}
      {(appendixEditable || appendix?.trim()) && (
        <>
          <div style={s.section}>{t('커스텀 요청사항')}</div>
          {appendixEditable ?? <div style={s.appendix}>{appendix}</div>}
        </>
      )}
      {appendixFooter}
      </div>
    </div>
  )
}

/**
 * 서류의 **최대 폭**(px). 자리가 넓어도 이보다 키우지 않는다 —
 * 서류에는 실물 크기가 있어서, 남는다고 늘리면 화면을 가득 채운 이상한 종이가 된다(제보).
 */
const BASE_W = 560
/** 종이의 안쪽 여백(px) */
const PAGE_PAD = 16

/**
 * 공급가 표 — 계약서 [별첨3] 양식 그대로.
 *
 * 구역 제목(「기본형 사양」/「추가 옵션 사양」)은 줄이 있을 때만 나온다.
 * 빈 구역 제목만 떠 있으면 「여기 뭔가 빠졌나」로 읽힌다.
 */
export function PoTable({ lines }: { lines: readonly PoLine[] }) {
  const base = lines.filter(l => l.section === 'BASE')
  const opt  = lines.filter(l => l.section !== 'BASE')
  const total = poTotal(lines)
  let no = 0
  const row = (l: PoLine) => {
    no += 1
    return (
      <tr key={`${l.label}-${no}`}>
        <td style={po.tdNo}>{no}</td>
        <td style={po.td}>{l.label}</td>
        <td style={po.tdMid}>{l.unit}</td>
        <td style={po.tdNum}>{l.qty}</td>
        <td style={po.tdNum}>{l.unit_price.toLocaleString()}</td>
        <td style={po.tdNum}>{l.amount.toLocaleString()}</td>
        <td style={po.tdMemo}>{l.memo ?? ''}</td>
      </tr>
    )
  }
  const groupRow = (label: string) => (
    <tr><td style={po.tdGroup} colSpan={7}>{label}</td></tr>
  )
  return (
    <>
      {/* 합계를 표 위에 한 번 더 — 계약서 양식이 그렇다. 먼저 눈에 들어와야 하는 값이다 */}
      <div style={po.headBar}>
        <span>{t('공급가액')} <span style={po.vatNote}>({t('VAT 별도')})</span></span>
        <b>₩{total.toLocaleString()}</b>
      </div>
      <table style={po.table}>
        <thead>
          <tr>
            <th style={po.thNo}>No.</th>
            <th style={po.th}>{t('품목명')}</th>
            <th style={po.thMid}>{t('단위')}</th>
            <th style={po.thNum}>{t('발주수량')}</th>
            <th style={po.thNum}>{t('단가')}</th>
            <th style={po.thNum}>{t('공급가액')}</th>
            <th style={po.thMemo}>{t('비고')}</th>
          </tr>
        </thead>
        <tbody>
          {base.length > 0 && groupRow(t('기본형 사양'))}
          {base.map(row)}
          {opt.length > 0 && groupRow(t('추가 옵션 사양'))}
          {opt.map(row)}
          <tr>
            <td style={po.tdTotal} colSpan={5}>{t('합계')}</td>
            <td style={po.tdTotalNum}>{total.toLocaleString()}</td>
            <td style={po.tdMemo}>KRW</td>
          </tr>
        </tbody>
      </table>
    </>
  )
}

/** 아직 배정하지 않았으면 번호가 없다 — 「주문 #0」은 0번 문서가 있는 것처럼 읽힌다 */
function docNo(orderId: number): string {
  return orderId > 0 ? `${t('주문')} #${orderId}` : t('(배정 시 발급)')
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <>
      {/*
        라벨은 **보여 주기만 하는 글씨**라 여기서 옮긴다(값은 데이터라 그대로 둔다).
        호출부마다 `t()` 를 씌우지 않고 한 곳에서 처리한다 — 한 군데라도 빠지면
        같은 줄에서 「Document number」와 「발주일」이 나란히 서게 된다.

        감싸는 상자를 두지 않는다 — 라벨과 값이 **격자의 칸으로 직접** 들어가야
        줄이 달라도 같은 열에 선다.
      */}
      <span style={s.metaLabel}>{t(label)}</span>
      <span style={s.metaValue}>{value}</span>
    </>
  )
}

/*
 * 발주서 안의 글씨는 **한 값으로 묶는다**(`--fs-sheet`).
 * 값칸·표·비고·특이사항이 제각각 다른 크기였고, 거기에 비고 **입력칸**만 또 다른 크기라
 * 특장사가 받아 보는 발주서와 이질감이 컸다(사진 제보).
 * 입력칸도 이 값을 물려받아 **적을 때와 읽을 때가 같은 글씨**가 된다.
 */
/**
 * 공급가 표 — 서류 안의 표라 **선이 있어야** 표로 읽힌다(사양표는 선 없이 두 칸이라 다르다).
 * 숫자는 오른쪽 정렬 + `tabular-nums` — 자릿수가 흔들리면 금액을 눈으로 못 비빈다.
 */
const po: Record<string, React.CSSProperties> = {
  headBar: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
    marginTop: 'var(--sp-4)', padding: 'var(--sp-2) var(--sp-3)',
    border: '1px solid var(--line)', fontSize: 'var(--fs-sheet)',
    fontVariantNumeric: 'tabular-nums',
  },
  vatNote: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  table: {
    width: '100%', borderCollapse: 'collapse', marginTop: 'var(--sp-2)',
    fontSize: 'var(--fs-sheet)', tableLayout: 'fixed',
  },
  th:     { border: '1px solid var(--line)', padding: '3px 5px', fontWeight: 700, textAlign: 'left' },
  thNo:   { border: '1px solid var(--line)', padding: '3px 5px', fontWeight: 700, width: '7%' },
  thMid:  { border: '1px solid var(--line)', padding: '3px 5px', fontWeight: 700, width: '9%' },
  thNum:  { border: '1px solid var(--line)', padding: '3px 5px', fontWeight: 700, textAlign: 'right', width: '15%' },
  thMemo: { border: '1px solid var(--line)', padding: '3px 5px', fontWeight: 700, textAlign: 'left', width: '20%' },
  // 구역 제목 줄 — 계약서 양식의 「기본형 사양」/「추가 옵션 사양」
  tdGroup: {
    border: '1px solid var(--line)', padding: '3px 5px', textAlign: 'center',
    fontWeight: 700, background: 'var(--surface-2, #f6f6f6)',
  },
  td:     { border: '1px solid var(--line)', padding: '3px 5px', overflowWrap: 'anywhere' },
  tdNo:   { border: '1px solid var(--line)', padding: '3px 5px', textAlign: 'center' },
  tdMid:  { border: '1px solid var(--line)', padding: '3px 5px', textAlign: 'center' },
  tdNum:  { border: '1px solid var(--line)', padding: '3px 5px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  tdMemo: { border: '1px solid var(--line)', padding: '3px 5px', fontSize: 'var(--fs-caption)', color: 'var(--muted)', overflowWrap: 'anywhere' },
  tdTotal:    { border: '1px solid var(--line)', padding: '3px 5px', textAlign: 'center', fontWeight: 700 },
  tdTotalNum: { border: '1px solid var(--line)', padding: '3px 5px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
}

const s: Record<string, React.CSSProperties> = {
  // 서류처럼 보이게 — 화면 요소가 아니라 '받은 문서'로 읽혀야 한다
  /**
   * 발주서 — **A4 비율(210:297)을 지킨다.**
   *
   * 크기는 화면에 맞춰 줄었다 늘었다 해도 되지만, 비율이 달라지면 실제로 출력했을 때와
   * 다른 문서가 된다. 특장사가 받아 보는 것과 화면에서 보는 것이 같아야 한다.
   *
   * ⚠️ `aspect-ratio` 는 **선호 크기**다 — 내용이 그보다 길면 상자가 늘어난다.
   *    고정 높이로 두면 넘치는 글이 잘려 없는 것처럼 보인다. 비율은 지키되 잘리지는 않는다.
   */
  /**
   * 자리만 잡는 바깥틀 — **A4 비율의 빈 상자.** 폭은 화면에 맞춰 늘었다 줄었다 하고,
   * 높이는 `aspect-ratio` 가 따라온다. 실제 서류는 이 안에서 축소돼 얹힌다.
   */
  frame: {
    /*
     * 폭은 자리에 맞춰 줄지만 **기준 폭보다 커지지는 않는다.**
     *
     * 좁으면 축소해 담는 것이 목적이었는데, 넓은 자리(서류 탭)에 두니 1 배를 넘겨
     * 확대돼 화면을 가득 채웠다(제보 — 「서류탭에서 발주서가 너무 큼」).
     * 서류는 실물 크기가 있다 — 자리가 남는다고 키울 이유가 없다.
     */
    width: '100%', maxWidth: BASE_W,
    position: 'relative',
    // ⚠️ 세로 flex 안에서 남는 높이에 맞춰 눌리지 않게 — 높이는 내용이 정한다
    flexShrink: 0,
  },
  /**
   * 서류 본체 — **높이를 정하지 않는다.**
   *
   * 예전엔 A4 한 장(`BASE_W × BASE_H`)에 고정하고, 넘치면 통째로 축소해 담았다.
   * 그래서 내용이 길수록 글씨가 작아졌고, 적을 수 있는 분량을 곳곳에서 막아야 했다
   * (비고 4줄 · 별지 30줄 · 커스텀은 아예 2페이지로 분리). 결국 **분량이 계속 골칫거리**가 됐다.
   *
   * 지금은 아래로 이어진다. 길면 길어지는 대로 두고 보는 사람이 스크롤한다 —
   * 글씨 크기는 늘 같고, 잘리는 것도 없다.
   */
  sheet: {
    position: 'absolute', top: 0, left: 0,
    width: BASE_W, transformOrigin: 'top left',
    boxSizing: 'border-box',
    border: 'var(--hairline)', borderRadius: 'var(--r-sm)', background: '#fff',
    padding: PAGE_PAD,
  },
  title: {
    textAlign: 'center', fontSize: 15, fontWeight: 700, color: 'var(--dark)',
    letterSpacing: '.3em', paddingBottom: 'var(--sp-3)', borderBottom: '1px solid var(--line)',
  },
  /*
   * 표제부 — 라벨/값이 네 칸. 라벨 열은 **가장 긴 라벨에 맞춰**(max-content) 늘어나므로
   * 폭을 못 박지 않아도 되고, 그래서 어느 언어에서도 접히지 않는다.
   * 값 열(1fr)이 남는 폭을 나눠 가진다.
   */
  metaGrid: {
    display: 'grid', gridTemplateColumns: 'max-content 1fr max-content 1fr',
    columnGap: 'var(--sp-2)', rowGap: 'var(--sp-2)', alignItems: 'baseline',
    marginTop: 'var(--sp-3)',
  },
  // 라벨은 **접지 않는다** — 접히면 값과 높이가 어긋나 표제부가 들쭉날쭉해진다
  metaLabel: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', whiteSpace: 'nowrap' as const },
  /*
   * 값은 **잘리지 않고 접힌다.** 예전엔 `text-overflow: ellipsis` 로 「브레…」처럼 잘랐는데,
   * 서류에서 이름이 잘리면 어느 회사인지 알 수 없다. 높이 제약이 없어졌으니 접으면 된다.
   */
  metaValue: {
    fontSize: 'var(--fs-sheet)', color: 'var(--dark)', fontWeight: 600,
    minWidth: 0, overflowWrap: 'anywhere',
  },
  section: {
    fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--muted)',
    marginTop: 'var(--sp-4)', paddingBottom: 'var(--sp-1)', borderBottom: 'var(--hairline)',
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sheet)', marginTop: 'var(--sp-2)' },
  tdLabel: { padding: '5px 12px 5px 0', color: 'var(--muted)', width: 96, whiteSpace: 'nowrap', verticalAlign: 'top' },
  tdValue: { padding: '5px 0', color: 'var(--dark)' },
  /** 비고 본문 — 적은 그대로(줄바꿈·띄어쓰기 보존) */
  remark: {
    whiteSpace: 'pre-wrap' as const, fontSize: 'var(--fs-sheet)', lineHeight: 1.6,
    color: 'var(--dark)', padding: 'var(--sp-2) 0',
  },
  /** 커스텀 요청사항 본문 — 길면 길어지는 대로. 줄바꿈은 적은 그대로(pre-wrap) */
  appendix: {
    whiteSpace: 'pre-wrap' as const, wordBreak: 'keep-all' as const,
    fontSize: 'var(--fs-sheet)', lineHeight: 1.7, minHeight: 320,
  },
  remarkEmpty: { fontSize: 'var(--fs-sheet)', color: 'var(--muted)', padding: 'var(--sp-2) 0' },
  pending: {
    marginTop: 'var(--sp-2)', fontSize: 'var(--fs-caption)', color: 'var(--muted)',
    background: 'var(--card)', borderRadius: 'var(--r-sm)', padding: 'var(--sp-2) var(--sp-3)', lineHeight: 'var(--lh-body)',
  },
  notes: {
    margin: 'var(--sp-2) 0 0', paddingLeft: 18,
    fontSize: 'var(--fs-sheet)', color: 'var(--body)', lineHeight: 'var(--lh-body)',
    display: 'flex', flexDirection: 'column', gap: 3,
  },
  due: { color: 'var(--dark)' },
}
