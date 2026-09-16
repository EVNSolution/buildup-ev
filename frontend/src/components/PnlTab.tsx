import { useCallback, useEffect, useMemo, useState } from 'react'
import { t, tf } from '../i18n'
import { fetchPnl, savePnl, voidPnl, unvoidPnl, type PnlRow, type PnlPending, type PnlPatch } from '../api/pnl'
import { deriveP, sumP, monthOf } from '@shared/finance/pnl'
import { usePermission } from './PermGate'
import { useIsMobile } from '../hooks/useIsMobile'
import { useEscapeClose } from '../lib/escClose'
import { BTN } from '../styles/buttons'
import { DateField } from './ui/DateField'

/**
 * **차량 판매건별 손익** — 경영관리가 월 단위로 적고 보는 표(2026-09-16 지시).
 *
 * 지금 쓰는 엑셀(차량판매_손익_양식)을 그대로 옮겼다. 달을 가르는 기준은 **세금계산서 발행일**이고,
 * 발행일을 적는 순간 그 달 표로 들어간다.
 *
 * 화면은 세 덩이다.
 *   ① **요약** — 「주문 진행」 탭처럼 맨 위에 그 달 전체를 한 줄로
 *   ② **입력 필요** — 발행일을 아직 안 적은 건. 여기서 날짜를 적으면 해당 달로 들어간다
 *   ③ **그 달의 표** — 적으면서 보는 자리
 *
 * 적는 방식은 **칸을 벗어나면 저장**이다(줄마다 따로). 「저장」 버튼을 누르게 하면
 * 스무 줄을 고칠 때 스무 번을 눌러야 하고, 안 누른 줄이 생긴다.
 *
 * ⚠️ VAT·공급대가·입금 차액·수익은 **적지 않는다** — 엑셀과 같은 식으로 그때그때 낸다
 *    (shared/finance/pnl). 화면과 서버가 같은 함수를 쓴다.
 */
export function PnlTab() {
  const isMobile = useIsMobile()
  const canEdit = usePermission('pnl.manage')
  const [view, setView] = useState<Awaited<ReturnType<typeof fetchPnl>> | null>(null)
  const [month, setMonth] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback((ym?: string) => {
    setBusy(true); setErr('')
    fetchPnl(ym)
      .then(v => { setView(v); setMonth(v.month) })
      .catch(e => setErr(e instanceof Error ? e.message : t('손익을 불러오지 못했습니다')))
      .finally(() => setBusy(false))
  }, [])
  useEffect(() => { load() }, [load])

  /** 한 줄을 적는다. 저장된 줄이 이 달에 안 맞으면(발행일을 바꿨다) 다시 불러 자리를 옮긴다 */
  const write = useCallback(async (quoteId: number, patch: PnlPatch) => {
    const saved = await savePnl(quoteId, patch)
    const stillHere = saved.invoice_on && month && monthOf(saved.invoice_on) === month
    if (!stillHere) { load(month ?? undefined); return saved }
    setView(v => v && ({
      ...v,
      rows: v.rows.some(r => r.quote_id === quoteId)
        ? v.rows.map(r => (r.quote_id === quoteId ? saved : r))
        : [...v.rows, saved],
      pending: v.pending.filter(p => p.quote_id !== quoteId),
    }))
    return saved
  }, [month, load])

  /**
   * 「입력 필요」에서 한 건을 **다 적어** 내려보낸다 — 적은 발행일의 달로 화면을 옮겨
   * 방금 내려간 줄이 눈에 보이게 한다(지시: 저장하면 밑으로 내려보내는 방식).
   */
  const file = useCallback(async (quoteId: number, patch: PnlPatch) => {
    const saved = await savePnl(quoteId, patch)
    const ym = saved.invoice_on ? monthOf(saved.invoice_on) : month
    setMonth(ym ?? null)
    load(ym ?? undefined)
    return saved
  }, [month, load])

  /** 줄 하나가 바뀌면 그 줄만 갈아 끼운다(삭제·되돌리기도 같은 길) */
  const replace = useCallback((saved: PnlRow) => {
    setView(v => v && ({ ...v, rows: v.rows.map(r => (r.quote_id === saved.quote_id ? saved : r)) }))
  }, [])

  /**
   * **임시저장** — 적은 것을 붙잡아 두되 줄은 「입력 필요」에 그대로 남는다.
   * 화면도 옮기지 않는다(발행일이 없으면 들어갈 달이 없고, 있어도 아직 등록한 것이 아니다).
   */
  const draft = useCallback(async (quoteId: number, patch: PnlPatch) => {
    const saved = await savePnl(quoteId, patch)
    setView(v => v && ({
      ...v,
      // 적어 둔 값이 목록에도 비치게 한다 — 다시 펴면 그 값으로 열린다
      pending: v.pending.map(p => (p.quote_id === quoteId
        ? {
          ...p, supply_default: saved.supply_amount, deposit_default: saved.deposit,
          draft: {
            biz_name: saved.biz_name, capital: saved.capital, cost: saved.cost, memo: saved.memo,
            deposit_paid_on: saved.deposit_paid_on, capital_paid_on: saved.capital_paid_on,
          },
        }
        : p)),
    }))
    return saved
  }, [])

  const rows = view?.rows ?? []
  // **삭제된 줄은 합계에서 뺀다.** 표에는 회색으로 남지만 그 달 숫자는 아니다
  const alive = useMemo(() => rows.filter(r => !r.voided_at), [rows])
  const total = useMemo(() => sumP(alive), [alive])
  const voided = rows.length - alive.length

  return (
    <div style={s.root}>
      <MonthBar
        month={month} months={view?.months ?? []} busy={busy}
        onPick={ym => { setMonth(ym); load(ym) }}
      />
      {err && <div style={s.err}>{err}</div>}

      {/* ① 요약 — 그 달 전체 */}
      <SummaryBar total={total} />

      {/* ② 입력 필요 — 맨 위에 따로 둔다. 여기서 발행일을 적으면 그 달 표로 들어간다 */}
      <PendingBox pending={view?.pending ?? []} canEdit={canEdit} isMobile={isMobile} onFile={file} onDraft={draft} />

      {/* ③ 그 달의 표 */}
      <section style={s.card}>
        <div style={s.cardHead}>
          <span style={s.cardTitle}>{month ? tf('{0}년 {1}월', Number(month.slice(0, 4)), Number(month.slice(5, 7))) : t('손익')}</span>
          <span style={s.cardCount}>{tf('{0}건', alive.length)}</span>
          {voided > 0 && <span style={s.voidCount}>{tf('삭제 {0}건', voided)}</span>}
        </div>
        {rows.length === 0 ? (
          <div style={s.empty}>{t('이 달에 세금계산서가 발행된 건이 없습니다.')}</div>
        ) : isMobile ? (
          <div style={s.cards}>
            {rows.map(r => <RowCard key={r.quote_id} row={r} canEdit={canEdit} onWrite={write} onVoid={replace} />)}
          </div>
        ) : (
          <RowTable rows={rows} canEdit={canEdit} onWrite={write} onVoid={replace} />
        )}
      </section>
    </div>
  )
}

/* ── 달 고르개 ─────────────────────────────────────────────────────────── */

function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number) as [number, number]
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function MonthBar({ month, months, busy, onPick }: {
  month: string | null; months: string[]; busy: boolean; onPick: (ym: string) => void
}) {
  if (!month) return <div style={s.monthBar}><span style={s.muted}>{t('불러오는 중…')}</span></div>
  const label = tf('{0}년 {1}월', Number(month.slice(0, 4)), Number(month.slice(5, 7)))
  return (
    <div style={s.monthBar}>
      <button type="button" style={s.navBtn} onClick={() => onPick(shiftMonth(month, -1))} aria-label={t('지난달')}>‹</button>
      <span style={s.monthLabel}>{label}</span>
      <button type="button" style={s.navBtn} onClick={() => onPick(shiftMonth(month, 1))} aria-label={t('다음달')}>›</button>
      {/* 줄이 있는 달만 — 빈 달을 하나씩 넘겨 가며 찾지 않아도 된다 */}
      {months.length > 0 && (
        <select style={s.monthSelect} value={months.includes(month) ? month : ''} onChange={e => e.target.value && onPick(e.target.value)}>
          <option value="">{t('기록이 있는 달')}</option>
          {months.map(m => (
            <option key={m} value={m}>{tf('{0}년 {1}월', Number(m.slice(0, 4)), Number(m.slice(5, 7)))}</option>
          ))}
        </select>
      )}
      {busy && <span style={s.muted}>{t('불러오는 중…')}</span>}
    </div>
  )
}

/* ── 요약 ─────────────────────────────────────────────────────────────── */

const won = (n: number) => `₩${Math.round(n).toLocaleString('ko-KR')}`
const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`)

/**
 * 그 달 요약 — **열 칸**(2026-09-16 지시).
 *
 * 수익과 수익률을 한 칸에 「금액 · %」로 붙여 놨더니 긴 글자가 되어 눈에 안 들어왔다.
 * 갈라서 각자 한 칸씩 주고, **숫자만** 브랜드 라임으로 키운다 — 이 표를 보는 이유가 그 둘이다.
 * 색은 컨피규레이터의 **실구매가와 같은 값**(`--lime-ink`)이다. 칸을 칠하지 않는다 —
 * 칸을 칠하면 덩어리가 되어 옆 칸들과 무게가 뒤집힌다(가격바가 배경을 걷은 것과 같은 이유).
 * ⚠️ 이 색은 흰 바탕에서 대비가 낮아 **큰 글씨 전용**이다. 그래서 이 둘만 22px 로 키운다.
 * 손실이면 빨강으로 뒤집는다(라임으로 물든 손실만큼 위험한 것이 없다).
 */
function SummaryBar({ total }: { total: ReturnType<typeof sumP> }) {
  const loss = total.profit < 0
  const tiles: { label: string; value: string; tone?: 'warn' | 'profit' | 'loss' }[] = [
    { label: '발행 건수', value: tf('{0}건', total.count) },
    { label: '공급가액', value: won(total.supply_amount) },
    { label: 'VAT', value: won(total.vat) },
    { label: '공급대가', value: won(total.gross) },
    { label: '계약금', value: won(total.deposit) },
    { label: '캐피탈', value: won(total.capital) },
    // 아직 안 들어온 돈 — 음수가 정상이다
    { label: '입금 차액', value: won(total.pay_diff), tone: total.pay_diff < 0 ? 'warn' : undefined },
    { label: '원가', value: won(total.cost) },
    { label: '수익', value: won(total.profit), tone: loss ? 'loss' : 'profit' },
    { label: '수익률', value: pct(total.margin), tone: loss ? 'loss' : 'profit' },
  ]
  return (
    <section style={s.card}>
      {/*
        칸 수를 못 박지 않는다 — 다섯으로 고정했더니 좁은 화면에서 칸이 131px 이 되어
        22px 짜리 수익 금액(143px)이 옆 칸을 침범했다(제보). 폭에 맞춰 칸 수가 준다.
      */}
      <div style={s.sumGrid}>
        {tiles.map(x => (
          <div key={x.label} style={s.sumCell}>
            <div style={s.sumLabel}>{t(x.label)}</div>
            <div style={x.tone === 'warn' ? s.sumValWarn : x.tone === 'profit' ? s.sumValProfit : x.tone === 'loss' ? s.sumValLoss : s.sumVal}>{x.value}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ── 입력 필요 ─────────────────────────────────────────────────────────── */

function PendingBox({ pending, canEdit, isMobile, onFile, onDraft }: {
  pending: PnlPending[]; canEdit: boolean; isMobile: boolean
  onFile: (quoteId: number, patch: PnlPatch) => Promise<PnlRow>
  onDraft: (quoteId: number, patch: PnlPatch) => Promise<PnlRow>
}) {
  const [open, setOpen] = useState(true)
  /** 한 번에 한 건만 편다 — 스무 건이 동시에 펴지면 그 아래 표가 화면 밖으로 밀린다 */
  const [editing, setEditing] = useState<number | null>(null)
  /*
   * ⚠️ **편 줄이 목록에서 사라진 뒤에는 접은 것으로 본다**(제보: 한 번 저장하면 다시 안 열렸다).
   *    저장하면 그 건은 「입력 필요」에서 빠지는데 `editing` 은 그 번호를 들고 있었다. 그러면
   *    「그 건만 보여 주는」 규칙에 걸려 **목록이 통째로 비고**, 누를 줄조차 없어진다.
   *    지우는 것을 잊지 않게 여기서도 한 번 더 본다 — 저장 쪽에서 비우는 것과 이중으로 막는다.
   */
  const live = editing !== null && pending.some(p => p.quote_id === editing) ? editing : null
  return (
    <section style={pending.length > 0 ? s.cardAlert : s.card}>
      <button type="button" style={s.cardHeadBtn} onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <span style={s.caret}>{open ? '▾' : '▸'}</span>
        <span style={s.cardTitle}>{t('입력 필요')}</span>
        <span style={pending.length > 0 ? s.cardCountWarn : s.cardCount}>{tf('{0}건', pending.length)}</span>
      </button>
      {open && (pending.length === 0 ? (
        <div style={s.empty}>{t('발행일을 적어야 할 건이 없습니다.')}</div>
      ) : (
        /*
         * 적는 중에는 **그 건만** 남긴다. 밀린 건이 백 줄이면 목록이 화면을 다 먹어
         * 적다가 어디를 보고 있는지 잃는다. 닫힌 목록은 높이를 묶고 구른다.
         */
        <div style={live === null ? s.pendList : s.pendListOne}>
          {(live === null ? pending : pending.filter(p => p.quote_id === live)).map(p => (
            <PendingRow
              key={p.quote_id} item={p} canEdit={canEdit} isMobile={isMobile}
              open={live === p.quote_id}
              onToggle={() => setEditing(v => (v === p.quote_id ? null : p.quote_id))}
              // 저장이 끝나면 목록으로 돌아온다 — 다음 건을 바로 고를 수 있어야 한다
              onFile={async (id, patch) => { const r = await onFile(id, patch); setEditing(null); return r }}
              onDraft={onDraft}
            />
          ))}
        </div>
      ))}
    </section>
  )
}

/** 새 줄에 적을 것 전부 — 표의 칸과 하나씩 짝이 맞는다 */
interface Draft {
  invoice_on: string
  /** 사업자명 — 적을 수도, 안 적을 수도 있다 */
  biz_name: string
  capital: number
  deposit_paid_on: string
  capital_paid_on: string
  cost: number
  memo: string
}

/**
 * 「입력 필요」 한 줄 — 펴면 **그 건의 모든 칸**이 나온다(2026-09-16 지시).
 *
 * 아래 월별 표는 **보는 자리**다. 주문이 쌓이면 새로 들어온 줄을 표에서 하나씩 찾아
 * 열고 적는 일이 힘들어진다 — 새 건은 여기서 다 적고 저장해 내려보낸다.
 *
 * 발행일이 없으면 내려갈 달이 정해지지 않으므로 그때만 저장을 막는다. 나머지는 나중에 채워도 된다.
 */
function PendingRow({ item, canEdit, isMobile, open, onToggle, onFile, onDraft }: {
  item: PnlPending; canEdit: boolean; isMobile: boolean
  open: boolean; onToggle: () => void
  onFile: (quoteId: number, patch: PnlPatch) => Promise<PnlRow>
  onDraft: (quoteId: number, patch: PnlPatch) => Promise<PnlRow>
}) {
  // 임시저장해 둔 것이 있으면 **그대로 열린다** — 적어 두고 다시 못 보면 임시저장이 뜻이 없다
  const [d, setD] = useState<Draft>(() => ({
    invoice_on: '',
    biz_name: item.draft?.biz_name ?? '',
    capital: item.draft?.capital ?? 0,
    deposit_paid_on: item.draft?.deposit_paid_on ?? '',
    capital_paid_on: item.draft?.capital_paid_on ?? '',
    cost: item.draft?.cost ?? 0,
    memo: item.draft?.memo ?? '',
  }))
  /** 계약서에서 오는 값 — 보여만 준다 */
  const fixed = { supply_amount: item.supply_default ?? 0, deposit: item.deposit_default }
  const [busy, setBusy] = useState<'draft' | 'file' | null>(null)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { setSaved(false); setD(x => ({ ...x, [k]: v })) }
  const calc = deriveP({ ...fixed, capital: d.capital, cost: d.cost })

  /**
   * **임시저장**과 **등록**은 적는 내용이 같고 발행일만 다르다.
   *   · 임시저장 — 발행일이 없어도 된다. 적은 것을 붙잡아 두고 **여기 그대로 남는다**
   *   · 등록     — 발행일이 있어야 한다. 아래 그 달 표로 내려간다
   */
  const write = async (mode: 'draft' | 'file') => {
    if (busy) return
    if (mode === 'file' && !d.invoice_on) return
    setBusy(mode); setErr('')
    try {
      const patch = {
        invoice_on: d.invoice_on || null,
        biz_name: d.biz_name.trim() || null,
        capital: d.capital,
        deposit_paid_on: d.deposit_paid_on || null,
        capital_paid_on: d.capital_paid_on || null,
        cost: d.cost,
        memo: d.memo.trim() || null,
      }
      if (mode === 'file') { await onFile(item.quote_id, patch); return }
      // 임시저장 — 줄은 「입력 필요」에 남는다. 화면을 옮기지 않는다
      await onDraft(item.quote_id, patch)
      setSaved(true); setBusy(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('저장하지 못했습니다'))
      setBusy(null)
    }
  }

  return (
    <div style={open ? s.pendItemOpen : s.pendItem}>
      <button type="button" style={s.pendHead} onClick={onToggle} aria-expanded={open}>
        <span style={s.caret}>{open ? '▾' : '▸'}</span>
        <span style={s.pendNo}>{item.quote_no ?? `#${item.quote_id}`}</span>
        <span style={s.pendName}>{item.customer ?? '—'}</span>
        {/* 특장사가 수락한 날 — 이 순서(오래된 것 먼저)가 곧 처리 순서다 */}
        <span style={s.pendSub}>{tf('수락 {0}', item.accepted_on ?? '—')}</span>
        <span style={s.pendAmount}>{item.supply_default === null ? '—' : won(item.supply_default)}</span>
        {!open && <span style={s.pendCta}>{t('입력')}</span>}
      </button>

      {open && (
        <>
          <div style={{ ...s.entryGrid, gridTemplateColumns: `repeat(${isMobile ? 2 : 4}, minmax(0, 1fr))` }}>
            <Field label={t('세금계산서 발행일')}>
              <DateField value={d.invoice_on} onChange={v => set('invoice_on', v)} disabled={!canEdit || !!busy}
                ariaLabel={t('세금계산서 발행일')} style={s.dateInput} clearable />
            </Field>
            {/* 계약서에서 오는 값 — 보여만 준다(고쳐야 하는 예외가 생기면 그때 다시 본다) */}
            <Field label={t('고객명')}><span style={s.calcText}>{item.customer ?? '—'}</span></Field>
            {/* 사업자명은 따로 적는다 — 적는 건도 있고 안 적는 건도 있다 */}
            <Field label={t('사업자명')}>
              <input style={s.textInput} value={d.biz_name} maxLength={120} disabled={!canEdit || !!busy}
                aria-label={t('사업자명')} onChange={e => set('biz_name', e.target.value)} />
            </Field>
            <Field label={t('공급가액')}><span style={s.calc}>{won(fixed.supply_amount)}</span></Field>
            <Field label={t('VAT')}><span style={s.calc}>{won(calc.vat)}</span></Field>

            <Field label={t('공급대가')}><span style={s.calcStrong}>{won(calc.gross)}</span></Field>
            <Field label={t('계약금')}><span style={s.calc}>{won(fixed.deposit)}</span></Field>
            <Field label={t('캐피탈')}>
              <MoneyField value={d.capital} disabled={!canEdit || !!busy} label={t('캐피탈')} onChange={v => set('capital', v)} />
            </Field>
            <Field label={t('입금 차액')}>
              <span style={calc.pay_diff < 0 ? s.calcWarn : s.calc}>{won(calc.pay_diff)}</span>
            </Field>

            <Field label={t('계약금 입금일')}>
              <DateField value={d.deposit_paid_on} onChange={v => set('deposit_paid_on', v)} disabled={!canEdit || !!busy}
                ariaLabel={t('계약금 입금일')} style={s.dateInput} clearable />
            </Field>
            <Field label={t('캐피탈 입금일')}>
              <DateField value={d.capital_paid_on} onChange={v => set('capital_paid_on', v)} disabled={!canEdit || !!busy}
                ariaLabel={t('캐피탈 입금일')} style={s.dateInput} clearable />
            </Field>
            {/* 원가는 **한 칸**이다 — 별도 시스템이 하나로 내려 줄 자리고, 그때까지는 손으로 적는다 */}
            <Field label={t('원가')}>
              <MoneyField value={d.cost} disabled={!canEdit || !!busy} label={t('원가')} onChange={v => set('cost', v)} />
            </Field>
            {/*
              수익과 수익률을 한 칸에 「금액 · %」로 붙이면 **휴대폰에서 칸을 삐져나간다**(제보).
              금액만으로도 자릿수가 길다 — 갈라서 각자 한 칸씩 준다.
            */}
            <Field label={t('수익')}>
              <span style={calc.profit < 0 ? s.calcWarn : s.calcStrong}>{won(calc.profit)}</span>
            </Field>
            <Field label={t('수익률')}>
              <span style={calc.profit < 0 ? s.calcWarn : s.calcStrong}>{pct(calc.margin)}</span>
            </Field>

            <Field label={t('비고')} wide>
              <input style={s.textInputWide} value={d.memo} maxLength={500} disabled={!canEdit || !!busy}
                aria-label={t('비고')} onChange={e => set('memo', e.target.value)} />
            </Field>
          </div>
          <div style={s.entryFoot}>
            {err && <span style={s.err}>{err}</span>}
            {saved && !err && <span style={s.savedNote}>{t('임시저장했습니다')}</span>}
            {/* 발행일이 없으면 들어갈 달이 정해지지 않는다 — 등록만 막는다(임시저장은 된다) */}
            {!d.invoice_on && <span style={s.muted}>{t('세금계산서 발행일을 입력해야 등록 가능합니다')}</span>}
            <button
              type="button" style={canEdit && !busy ? BTN.smSecondary : BTN.disabled}
              disabled={!canEdit || !!busy} onClick={() => void write('draft')}
            >{busy === 'draft' ? t('저장 중…') : t('임시저장')}</button>
            <button
              type="button" style={d.invoice_on && canEdit && !busy ? BTN.smPrimary : BTN.disabled}
              disabled={!d.invoice_on || !canEdit || !!busy} onClick={() => void write('file')}
            >{busy === 'file' ? t('등록 중…') : t('등록')}</button>
          </div>
        </>
      )}
    </div>
  )
}

/* ── 적는 칸 ──────────────────────────────────────────────────────────── */

/**
 * 금액 칸(입력 중) — 치는 대로 값이 올라간다. 「입력 필요」의 셈(VAT·공급대가·수익)이
 * 타자에 맞춰 따라와야 다 적고 나서 맞는지 확인할 수 있다.
 */
function MoneyField({ value, disabled, label, onChange }: {
  value: number; disabled?: boolean; label: string; onChange: (v: number) => void
}) {
  return (
    <input
      style={s.moneyInput} value={value ? value.toLocaleString('ko-KR') : ''} disabled={disabled}
      inputMode="numeric" aria-label={label}
      onChange={e => onChange(Number(e.target.value.replace(/[^0-9]/g, '') || 0))}
    />
  )
}

/** 금액 칸 — 세 자리마다 쉼표로 보여 주고 숫자로 돌려준다. 칸을 벗어날 때 저장한다 */
function MoneyCell({ value, disabled, label, dense, onSave }: {
  value: number; disabled?: boolean; label: string; dense?: boolean; onSave: (v: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (value ? value.toLocaleString('ko-KR') : '')
  return (
    <input
      style={{ ...(dense ? s.moneyCell : s.moneyInput), ...(disabled ? OFF : {}) }}
      value={shown} disabled={disabled} inputMode="numeric" aria-label={label}
      onChange={e => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
      onBlur={() => {
        if (draft === null) return
        const next = Number(draft || 0)
        setDraft(null)
        if (next !== value) onSave(next)
      }}
    />
  )
}

/**
 * 날짜 칸 — **앱 한 벌(DateField)** 을 쓴다. 브라우저 기본 달력은 위치를 못 바꿔
 * 화면 아래쪽 줄에서 잘린다(ui-compact 검사가 이걸 지킨다).
 * 날짜는 고르는 순간이 곧 확정이라 **고르면 바로 저장**한다.
 */
function DateCell({ value, disabled, label, dense, onSave }: {
  value: string | null; disabled?: boolean; label: string; dense?: boolean; onSave: (v: string | null) => void
}) {
  return (
    <DateField
      value={value ?? ''} disabled={disabled} ariaLabel={label} clearable
      style={{ ...(dense ? s.dateCell : s.dateInput), ...(disabled ? OFF : {}) }}
      onChange={v => { const next = v || null; if (next !== value) onSave(next) }}
    />
  )
}

function TextCell({ value, disabled, label, onSave, wide, dense }: {
  value: string | null; disabled?: boolean; label: string; wide?: boolean; dense?: boolean; onSave: (v: string | null) => void
}) {
  return (
    <input
      style={{ ...(dense ? (wide ? s.textCellWide : s.textCell) : (wide ? s.textInputWide : s.textInput)), ...(disabled ? OFF : {}) }}
      defaultValue={value ?? ''} disabled={disabled}
      maxLength={label === '비고' ? 500 : 120} aria-label={label}
      onBlur={e => {
        const next = e.target.value.trim() || null
        if (next !== value) onSave(next)
      }}
    />
  )
}

/** 줄 하나를 적는 손잡이 — 표와 카드가 같은 것을 쓴다 */
function useRowWriter(row: PnlRow, onWrite: (quoteId: number, patch: PnlPatch) => Promise<PnlRow>) {
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'fail'>('idle')
  const put = (patch: PnlPatch) => {
    setState('saving')
    onWrite(row.quote_id, patch)
      .then(() => { setState('done'); setTimeout(() => setState(x => (x === 'done' ? 'idle' : x)), 1200) })
      .catch(() => setState('fail'))
  }
  const mark = state === 'saving' ? '…' : state === 'done' ? '✓' : state === 'fail' ? '!' : ''
  return { put, mark, failed: state === 'fail' }
}

/* ── PC·태블릿 표 ─────────────────────────────────────────────────────── */

/**
 * PC·태블릿 표 — **한 줄에 한 칸씩, 줄마다 높이가 같게**(2026-09-16 지시).
 *
 * 처음엔 폭을 줄이려고 값을 위아래로 쌓았다(고객명 아래 사업자명, 공급가액 아래 VAT·공급대가).
 * 그러자 칸마다 높이가 달라지고 숫자가 세로로 몰려 읽기 어려워졌다(제보) — 표를 보는 뜻이 사라진다.
 *
 * 그래서 **쌓지 않는다.** 칸은 하나씩 옆으로 늘어놓고, 다 넣으면 폭이 남으니
 * 화면이 좁을 때는 **표만** 옆으로 민다(페이지가 아니라 표에 스크롤이 붙는다).
 *
 * 계약서에서 오는 값(고객명·공급가액·VAT·공급대가·계약금)은 **글자**이고, 적는 칸은 **입력**이다.
 * 둘이 섞이므로 글자 쪽도 입력과 **같은 높이**를 차지하게 해 줄을 맞춘다(`tdCalc`).
 */
const COLS: { w: number | string; head: string; num?: boolean }[] = [
  // 견적번호는 빼 두었다 — 옆에 붙이면 고객명이 잘린다(제보). 번호로 찾을 일은 견적 목록에서 한다
  { w: 132, head: '고객명' },
  { w: 132, head: '사업자명' },
  { w: 112, head: '발행일' },
  { w: 108, head: '공급가액', num: true },
  { w: 100, head: 'VAT', num: true },
  { w: 112, head: '공급대가', num: true },
  { w: 92, head: '계약금', num: true },
  { w: 108, head: '캐피탈', num: true },
  { w: 108, head: '입금 차액', num: true },
  { w: 112, head: '계약금 입금일' },
  { w: 112, head: '캐피탈 입금일' },
  { w: 108, head: '원가', num: true },
  { w: 108, head: '수익', num: true },
  { w: 'auto', head: '비고' },
  { w: 40, head: '' },
]
/** 비고를 뺀 폭의 합 + 비고 최소폭 — 이보다 좁아지면 표만 옆으로 민다 */
const TABLE_MIN = COLS.reduce<number>((n, c) => n + (typeof c.w === 'number' ? c.w : 0), 0) + 180

function RowTable({ rows, canEdit, onWrite, onVoid }: {
  rows: PnlRow[]; canEdit: boolean
  onWrite: (quoteId: number, patch: PnlPatch) => Promise<PnlRow>
  onVoid: (saved: PnlRow) => void
}) {
  const total = sumP(rows.filter(r => !r.voided_at))
  return (
    <div style={s.tableWrap}>
      <table style={{ ...s.table, minWidth: TABLE_MIN }}>
        <colgroup>{COLS.map(c => <col key={c.head} style={{ width: typeof c.w === 'number' ? `${c.w}px` : c.w }} />)}</colgroup>
        <thead>
          <tr>{COLS.map(c => <th key={c.head} style={c.num ? s.thNum : s.th}>{t(c.head)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map(r => <TableRow key={r.quote_id} row={r} canEdit={canEdit} onWrite={onWrite} onVoid={onVoid} />)}
        </tbody>
        <tfoot>
          <tr>
            <td style={s.tfLabel} colSpan={3}>{t('합계')}</td>
            <td style={s.tfNum}>{won(total.supply_amount)}</td>
            <td style={s.tfNum}>{won(total.vat)}</td>
            <td style={s.tfNum}>{won(total.gross)}</td>
            <td style={s.tfNum}>{won(total.deposit)}</td>
            <td style={s.tfNum}>{won(total.capital)}</td>
            <td style={total.pay_diff < 0 ? s.tfNumWarn : s.tfNum}>{won(total.pay_diff)}</td>
            <td style={s.tfNum} colSpan={2} />
            <td style={s.tfNum}>{won(total.cost)}</td>
            <td style={total.profit < 0 ? s.tfNumWarn : s.tfNum}>{won(total.profit)}</td>
            <td style={s.tfNum} colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function TableRow({ row, canEdit, onWrite, onVoid }: {
  row: PnlRow; canEdit: boolean
  onWrite: (quoteId: number, patch: PnlPatch) => Promise<PnlRow>
  onVoid: (saved: PnlRow) => void
}) {
  const d = deriveP(row)
  const { put, mark, failed } = useRowWriter(row, onWrite)
  const [ask, setAsk] = useState(false)
  const dead = !!row.voided_at
  const ro = !canEdit || dead
  return (
    <>
      {/* 삭제된 줄은 **회색**이고, 그 위에 반투명 레이어가 덮여 사유가 적힌다(아래 VoidLayer) */}
      <tr style={dead ? s.trDead : undefined}>
        {/* 계약서에서 오는 고객명 — 글자다. 저장 표시(✓)만 뒤에 붙는다 */}
        <td style={s.td}>
          <div style={s.nameRow}>
            <span style={s.name}>{row.customer ?? '—'}</span>
            {mark && <span style={failed ? s.markFail : s.mark}>{mark}</span>}
          </div>
        </td>
        <td style={s.td}>
          <TextCell value={row.biz_name} disabled={ro} label={t('사업자명')} dense onSave={v => put({ biz_name: v })} />
        </td>
        <td style={s.td}>
          <DateCell value={row.invoice_on} disabled={ro} label={t('세금계산서 발행일')} dense onSave={v => put({ invoice_on: v })} />
        </td>
        <td style={s.tdCalcStrong}>{won(row.supply_amount)}</td>
        <td style={s.tdCalc}>{won(d.vat)}</td>
        <td style={s.tdCalcStrong}>{won(d.gross)}</td>
        <td style={s.tdCalc}>{won(row.deposit)}</td>
        <td style={s.td}>
          <MoneyCell value={row.capital} disabled={ro} label={t('캐피탈')} dense onSave={v => put({ capital: v })} />
        </td>
        <td style={d.pay_diff < 0 ? s.tdCalcWarn : s.tdCalc}>{won(d.pay_diff)}</td>
        <td style={s.td}>
          <DateCell value={row.deposit_paid_on} disabled={ro} label={t('계약금 입금일')} dense onSave={v => put({ deposit_paid_on: v })} />
        </td>
        <td style={s.td}>
          <DateCell value={row.capital_paid_on} disabled={ro} label={t('캐피탈 입금일')} dense onSave={v => put({ capital_paid_on: v })} />
        </td>
        <td style={s.td}>
          <MoneyCell value={row.cost} disabled={ro} label={t('원가')} dense onSave={v => put({ cost: v })} />
        </td>
        <td style={d.profit < 0 ? s.tdCalcWarn : s.tdCalcGood}>{won(d.profit)}</td>
        <td style={s.td}><TextCell value={row.memo} disabled={ro} label={t('비고')} wide dense onSave={v => put({ memo: v })} /></td>
        <td style={s.tdAct}>
          {canEdit && !dead && (
            <button type="button" style={s.delBtn} aria-label={t('삭제')} title={t('삭제')} onClick={() => setAsk(true)}>✕</button>
          )}
          {/*
            회색 줄 **위에** 덮는다 — 줄을 지우지 않고 왜 뺐는지 그 자리에 적는다(지시).
            줄(`<tr>`)을 기준 삼아 그 **한 줄을 통째로** 덮는다. 칸 안에 넣지만 칸에 갇히지 않는다 —
            기준이 줄이라 왼쪽 끝부터 오른쪽 끝까지 닿는다.
          */}
          {dead && (
            <div style={s.voidLayer}>
              <span style={s.voidTag}>{t('삭제됨')}</span>
              <span style={s.voidReason}>{row.void_reason ?? '—'}</span>
              <span style={s.voidWho}>{row.voided_by ?? ''}</span>
              {canEdit && (
                <button type="button" style={s.undoBtn} onClick={() => { void unvoidPnl(row.quote_id).then(onVoid) }}>
                  {t('되돌리기')}
                </button>
              )}
            </div>
          )}
        </td>
      </tr>
      {ask && (
        <VoidModal
          row={row}
          onClose={() => setAsk(false)}
          onDone={saved => { setAsk(false); onVoid(saved) }}
        />
      )}
    </>
  )
}

/**
 * 삭제 확인 — **사유 없이는 못 지운다.** 몇 달 뒤에 왜 뺐는지 물으면 답할 수 있어야 한다.
 * 줄은 지워지지 않는다는 것을 창에서도 말해 준다(지운 줄 알고 놀라지 않게).
 */
function VoidCard({ row, onClose, onDone }: {
  row: PnlRow; onClose: () => void; onDone: (saved: PnlRow) => void
}) {
  useEscapeClose(onClose)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const go = async () => {
    if (!reason.trim() || busy) return
    setBusy(true); setErr('')
    try { onDone(await voidPnl(row.quote_id, reason.trim())) }
    catch (e) { setErr(e instanceof Error ? e.message : t('저장하지 못했습니다')); setBusy(false) }
  }
  return (
    <div style={s.overlay} onClick={ev => { if (ev.target === ev.currentTarget) onClose() }}>
      <div style={s.modal} role="dialog" aria-modal="true" aria-label={t('삭제')}>
        <div style={s.modalHead}>
          <span style={s.cardTitle}>{tf('{0} 손익 삭제', row.customer ?? String(row.quote_id))}</span>
          <button type="button" style={s.close} onClick={onClose} aria-label={t('닫기')}>✕</button>
        </div>
        <div style={s.voidBody}>
          <div style={s.muted}>{t('줄은 지워지지 않습니다. 회색으로 남고 합계에서만 빠지며, 사유가 그 줄 위에 적힙니다.')}</div>
          <label style={s.fieldLabel} htmlFor={`void-${row.quote_id}`}>{t('삭제 사유')}</label>
          <input
            id={`void-${row.quote_id}`} style={s.textInputWide} value={reason} maxLength={300} disabled={busy}
            autoFocus onChange={e => setReason(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void go() }}
          />
          {err && <span style={s.err}>{err}</span>}
          <div style={s.entryFoot}>
            <button type="button" style={BTN.smSecondary} onClick={onClose} disabled={busy}>{t('취소')}</button>
            <button type="button" style={reason.trim() && !busy ? BTN.smDanger : BTN.disabled}
              disabled={!reason.trim() || busy} onClick={go}>{t('삭제')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 표 안에서는 같은 창을 줄 하나에 담아 띄운다(표 구조를 깨지 않게) */
function VoidModal(p: { row: PnlRow; onClose: () => void; onDone: (saved: PnlRow) => void }) {
  return (
    <tr>
      <td colSpan={COLS.length} style={s.tdModalHost}><VoidCard {...p} /></td>
    </tr>
  )
}

/* ── 휴대폰 카드 ──────────────────────────────────────────────────────── */

function RowCard({ row, canEdit, onWrite, onVoid }: {
  row: PnlRow; canEdit: boolean
  onWrite: (quoteId: number, patch: PnlPatch) => Promise<PnlRow>
  onVoid: (saved: PnlRow) => void
}) {
  const d = deriveP(row)
  const { put, mark, failed } = useRowWriter(row, onWrite)
  const [open, setOpen] = useState(false)
  const [ask, setAsk] = useState(false)
  const dead = !!row.voided_at
  const ro = !canEdit || dead
  return (
    <div style={dead ? s.rowCardDead : s.rowCard}>
      {/* 삭제된 줄 — 카드 맨 위에 사유를 얹는다(표의 반투명 레이어와 같은 뜻) */}
      {dead && (
        <div style={s.voidBar}>
          <span style={s.voidTag}>{t('삭제됨')}</span>
          <span style={s.voidReason}>{row.void_reason ?? '—'}</span>
          {canEdit && (
            <button type="button" style={s.undoBtn} onClick={() => { void unvoidPnl(row.quote_id).then(onVoid) }}>
              {t('되돌리기')}
            </button>
          )}
        </div>
      )}
      <button type="button" style={s.rowCardHead} onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <span style={s.caret}>{open ? '▾' : '▸'}</span>
        <span style={s.name}>{row.customer ?? '—'}</span>
        <span style={s.no}>{row.invoice_on ?? '—'}{mark && <b style={failed ? s.markFail : s.mark}> {mark}</b>}</span>
        <span style={s.cardAmount}>{won(d.gross)}</span>
      </button>
      {/* 접힌 채로도 「얼마 남았나」는 보여야 한다 — 그게 이 표를 보는 이유다 */}
      <div style={s.rowCardSum}>
        <span style={d.pay_diff < 0 ? s.chipWarn : s.chip}>{t('입금 차액')} {won(d.pay_diff)}</span>
        <span style={d.profit < 0 ? s.chipWarn : s.chipGood}>{t('수익')} {won(d.profit)}</span>
      </div>
      {open && (
        <div style={s.fields}>
          <Field label={t('세금계산서 발행일')}><DateCell value={row.invoice_on} disabled={ro} label={t('세금계산서 발행일')} onSave={v => put({ invoice_on: v })} /></Field>
          <Field label={t('사업자명')}><TextCell value={row.biz_name} disabled={ro} label={t('사업자명')} onSave={v => put({ biz_name: v })} /></Field>
          {/* 계약서에서 오는 값 — 보여만 준다 */}
          <Field label={t('공급가액')}><span style={s.calcPlain}>{won(row.supply_amount)}</span></Field>
          <Field label={t('VAT')}><span style={s.calcPlain}>{won(d.vat)}</span></Field>
          <Field label={t('공급대가')}><span style={s.calcPlainStrong}>{won(d.gross)}</span></Field>
          <Field label={t('계약금')}><span style={s.calcPlain}>{won(row.deposit)}</span></Field>
          <Field label={t('캐피탈')}><MoneyCell value={row.capital} disabled={ro} label={t('캐피탈')} onSave={v => put({ capital: v })} /></Field>
          <Field label={t('계약금 입금일')}><DateCell value={row.deposit_paid_on} disabled={ro} label={t('계약금 입금일')} onSave={v => put({ deposit_paid_on: v })} /></Field>
          <Field label={t('캐피탈 입금일')}><DateCell value={row.capital_paid_on} disabled={ro} label={t('캐피탈 입금일')} onSave={v => put({ capital_paid_on: v })} /></Field>
          <Field label={t('원가')}>
            <MoneyCell value={row.cost} disabled={ro} label={t('원가')} onSave={v => put({ cost: v })} />
          </Field>
          <Field label={t('수익')}>
            <span style={d.profit < 0 ? s.calcPlainWarn : s.calcPlainStrong}>{won(d.profit)}</span>
          </Field>
          <Field label={t('비고')} wide><TextCell value={row.memo} disabled={ro} label={t('비고')} wide onSave={v => put({ memo: v })} /></Field>
          {canEdit && !dead && (
            <div style={s.cardFoot}>
              <button type="button" style={BTN.smDanger} onClick={() => setAsk(true)}>{t('삭제')}</button>
            </div>
          )}
        </div>
      )}
      {ask && <VoidCard row={row} onClose={() => setAsk(false)} onDone={saved => { setAsk(false); onVoid(saved) }} />}
    </div>
  )
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div style={wide ? s.fieldWide : s.field}>
      <span style={s.fieldLabel}>{label}</span>
      {children}
    </div>
  )
}

/* ── 모양 ─────────────────────────────────────────────────────────────── */

const cardBase: React.CSSProperties = {
  background: '#fff', border: 'var(--hairline)', borderRadius: 'var(--r-md)',
  padding: 'var(--sp-4)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', minWidth: 0,
}
const cellNum: React.CSSProperties = { fontVariantNumeric: 'tabular-nums', textAlign: 'right', whiteSpace: 'nowrap' }
/**
 * 표에서 **글자로만 보여 주는 숫자** — 적는 칸(28px)과 같은 높이를 차지해야 줄이 맞는다.
 * 안쪽 여백도 입력칸(7px)과 맞춘다 — 안 맞추면 숫자 오른쪽 끝이 칸마다 어긋난다.
 */
const tdText: React.CSSProperties = {
  padding: '5px 7px', borderBottom: 'var(--hairline)',
  fontSize: 'var(--fs-label)', height: 'var(--h-control-sm)', ...cellNum,
}

/**
 * **적는 칸은 한 벌이다.** 높이도 글자 크기도 앱 기준 토큰(`--h-control`·`--fs-input`)을 쓴다.
 *
 * 손으로 padding 을 주면 입력칸·날짜칸·버튼이 저마다 1~4px 씩 어긋나고, 칸이 열몇 개인 표에서는
 * 그 어긋남이 줄마다 쌓여 눈에 띈다(제보). 계산해서 보여만 주는 값도 **같은 높이**를 차지하게
 * 두어야 줄이 맞는다 — 테두리만 투명하게 한다.
 */
const CONTROL: React.CSSProperties = {
  boxSizing: 'border-box', width: '100%', minWidth: 0,
  // ⚠️ minHeight 도 같이 준다 — DateField 의 방아쇠가 `minHeight: --h-control` 을 들고 있어
  //    height 만 주면 그 칸만 8px 더 커진다(실제로 표에서 그랬다)
  height: 'var(--h-control)', minHeight: 'var(--h-control)',
  fontFamily: 'inherit', fontSize: 'var(--fs-input)',
  color: 'var(--body)', padding: '0 10px',
  border: 'var(--hairline)', borderRadius: 'var(--r-sm)', background: '#fff',
}
/** 표 안 — 칸이 열셋이라 한 단계 촘촘하게(`--h-control-sm`·`--fs-label`). 휴대폰에서는 표를 안 쓴다 */
const CELL: React.CSSProperties = {
  ...CONTROL, height: 'var(--h-control-sm)', minHeight: 'var(--h-control-sm)',
  fontSize: 'var(--fs-label)', padding: '0 7px',
}
/** 못 적는 칸 — 테두리는 그대로 두고 흐리게. 적을 수 있는 칸처럼 보이면 눌러 보다가 헛수고한다 */
const OFF: React.CSSProperties = { background: 'var(--soft, #F7F7F4)', color: 'var(--muted)', cursor: 'default' }

/**
 * 계산해서 보여만 주는 값 — 적는 칸과 **같은 자리**를 차지한다.
 *
 * ⚠️ **표에서는 테두리가 없다.** 열 몇 칸이 전부 네모가 되면 표가 격자로 뒤덮인다.
 *    「입력 필요」 폼에서는 반대다 — 아래 `readOnlyBoxed` 를 쓴다.
 */
const readOnly = (base: React.CSSProperties): React.CSSProperties => ({
  ...base, border: '1px solid transparent', background: 'none',
  /*
   * ⚠️ flex 로 오른쪽에 붙이지 않는다. `justify-content: flex-end` 는 값이 칸보다 길면
   *    **왼쪽으로 새어 나가** 카드 밖까지 나간다(휴대폰에서 실제로 그랬다).
   *    글줄로 두고 오른쪽 정렬하면, 넘칠 때도 칸 안에 머문다.
   */
  display: 'block', textAlign: 'right', lineHeight: base.height as string,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
})

/**
 * 「입력 필요」 폼의 **자동 기입 칸** — 테두리를 두르되 **속은 채우지 않는다**(2026-09-16 지시).
 *
 * 테두리가 없으면 적는 칸들 사이에서 글자만 떠 있어 정돈되지 않아 보였다(제보).
 * 속을 채우지 않는 이유는, 채우면 「비활성」처럼 보여 **값이 없는 칸**과 헷갈리기 때문이다.
 * 테두리만으로 「칸은 칸인데 손대는 칸은 아니다」가 읽힌다.
 */
const readOnlyBoxed = (base: React.CSSProperties): React.CSSProperties => ({
  ...readOnly(base), border: 'var(--hairline)',
})


const s: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' },
  card: cardBase,
  cardAlert: { ...cardBase, borderLeft: '3px solid var(--req)' },
  cardHead: { display: 'flex', alignItems: 'baseline', gap: 'var(--sp-2)' },
  cardHeadBtn: {
    display: 'flex', alignItems: 'baseline', gap: 'var(--sp-2)', flexWrap: 'wrap',
    border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
  },
  cardTitle: { fontSize: 'var(--fs-section)', fontWeight: 'var(--fw-section)' as React.CSSProperties['fontWeight'], color: 'var(--dark)' },
  cardCount: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' },
  cardCountWarn: { fontSize: 'var(--fs-caption)', color: 'var(--req)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
  caret: { color: 'var(--muted)', fontSize: 11 },

  monthBar: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' },
  navBtn: { border: 'var(--hairline)', background: '#fff', borderRadius: 6, width: 30, height: 30, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--dark)' },
  monthLabel: { fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--dark)', fontVariantNumeric: 'tabular-nums', minWidth: 110, textAlign: 'center' },
  // 줄이 바뀌어도 폭을 다 먹지 않게 — 고르개가 화면 한 줄을 차지하면 달 이동 단추가 멀어진다
  monthSelect: { flex: '0 0 auto', maxWidth: 200, fontFamily: 'inherit', fontSize: 'var(--fs-input)', padding: '5px 8px', border: 'var(--hairline)', borderRadius: 'var(--r-sm)', background: '#fff' },

  sumGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(152px, 1fr))', gap: 'var(--sp-3)' },
  sumCell: { minWidth: 0 },
  sumLabel: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', whiteSpace: 'nowrap' },
  sumVal: { fontSize: 18, fontWeight: 700, color: 'var(--dark)', ...cellNum, textAlign: 'left' },
  sumValWarn: { fontSize: 18, fontWeight: 700, color: 'var(--req)', ...cellNum, textAlign: 'left' },
  // 결론 숫자 — 컨피규레이터의 실구매가와 같은 색·같은 크기. 칸은 칠하지 않는다
  sumValProfit: { fontSize: 22, fontWeight: 700, color: 'var(--lime-ink)', letterSpacing: '-0.01em', ...cellNum, textAlign: 'left' },
  sumValLoss: { fontSize: 22, fontWeight: 700, color: 'var(--req)', letterSpacing: '-0.01em', ...cellNum, textAlign: 'left' },

  // 밀린 건이 백 줄이어도 아래 표가 화면 밖으로 밀리지 않게 높이를 묶는다
  pendList: { display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 320, overflowY: 'auto' },
  // 적는 중에는 그 건만 — 묶을 높이가 없다(폼이 잘리면 안 된다)
  pendListOne: { display: 'flex', flexDirection: 'column', gap: 2 },
  pendItem: { borderTop: 'var(--hairline)' },
  pendItemOpen: { borderTop: 'var(--hairline)', background: 'var(--soft, #FAFAF7)', borderRadius: 'var(--r-sm)', padding: '2px 6px 8px' },
  pendHead: { display: 'flex', alignItems: 'baseline', gap: 8, width: '100%', border: 'none', background: 'none', padding: '7px 0', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'var(--fs-label)', textAlign: 'left', flexWrap: 'wrap' },
  /*
   * **버튼은 줄마다 같은 자리에 선다.** 앞 글자 길이에 따라 좌우로 흔들리면 줄을 훑을 때
   * 눈이 계속 옮겨 다닌다(제보). 오른쪽 끝에 붙여 세로로 한 줄이 되게 한다.
   * ⚠️ 앞으로 목록 줄에 붙는 단추도 이렇게 한다 — 자리를 내용이 정하게 두지 않는다.
   */
  pendCta: { marginLeft: 'auto', flexShrink: 0, fontSize: 'var(--fs-caption)', color: 'var(--dark)', border: 'var(--hairline)', borderRadius: 999, padding: '1px 10px', whiteSpace: 'nowrap' },
  entryGrid: { display: 'grid', gap: 8, padding: '6px 0 8px' },
  entryFoot: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap', paddingTop: 6, borderTop: 'var(--hairline)' },
  pendNo: { fontWeight: 700, color: 'var(--dark)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  pendName: { color: 'var(--body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  pendSub: { color: 'var(--muted)', fontSize: 'var(--fs-caption)', whiteSpace: 'nowrap' },
  pendAmount: { ...cellNum, color: 'var(--body)', fontSize: 'var(--fs-caption)', minWidth: 118 },

  tableWrap: { overflowX: 'auto' },
  // 폭을 못 박는다 — 숫자 칸은 잘리지 않을 만큼, 남는 폭은 비고가 먹는다
  table: { borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed', minWidth: 900 },
  th: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', fontWeight: 400, textAlign: 'left', padding: '6px 7px', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' },
  thNum: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', fontWeight: 400, textAlign: 'right', padding: '6px 7px', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' },
  tfSub: { display: 'block', fontSize: 'var(--fs-caption)', color: 'var(--muted)', fontWeight: 400 },
  tfSubStrong: { display: 'block', fontSize: 'var(--fs-caption)', color: 'var(--dark)', fontWeight: 700 },
  td: { padding: '5px 5px', borderBottom: 'var(--hairline)', fontSize: 'var(--fs-label)', verticalAlign: 'middle', height: 'var(--h-control-sm)' },
  tdCalc: { ...tdText, color: 'var(--muted)' },
  tdCalcStrong: { ...tdText, color: 'var(--dark)', fontWeight: 700 },
  tdCalcWarn: { ...tdText, color: 'var(--req)', fontWeight: 700 },
  // ⚠️ 표의 수익은 **검정**이다 — 라임은 흰 바탕 대비가 낮아 본문 크기에서 흐려 보인다(가격바 주석)
  tdCalcGood: { ...tdText, color: 'var(--dark)', fontWeight: 700 },
  tfLabel: { padding: '8px 6px', borderTop: '1px solid var(--dark)', fontWeight: 700, color: 'var(--dark)', fontSize: 'var(--fs-label)' },
  tfNum: { padding: '8px 6px', borderTop: '1px solid var(--dark)', fontWeight: 700, color: 'var(--dark)', fontSize: 'var(--fs-label)', ...cellNum },
  tfNumWarn: { padding: '8px 6px', borderTop: '1px solid var(--dark)', fontWeight: 700, color: 'var(--req)', fontSize: 'var(--fs-label)', ...cellNum },

  nameRow: { display: 'flex', alignItems: 'baseline', gap: 5, minWidth: 0, padding: '0 2px' },
  name: { color: 'var(--dark)', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: 1 },
  no: { color: 'var(--muted)', fontSize: 'var(--fs-caption)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', flexShrink: 0, fontWeight: 400 },
  mark: { color: 'var(--lime-ink)', flexShrink: 0, fontWeight: 700 },
  markFail: { color: 'var(--req)' },

  // ── 폼(입력 필요 · 휴대폰 카드 · 원가 창) ──
  moneyInput: { ...CONTROL, textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  textInput: CONTROL,
  textInputWide: CONTROL,
  dateInput: { ...CONTROL, minWidth: 0, justifyContent: 'space-between' },
  costBtn: { ...CONTROL, cursor: 'pointer', color: 'var(--dark)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  calc: { ...readOnlyBoxed(CONTROL), color: 'var(--body)' },
  /** 글자로 보여 주는 값(고객명 등) — 숫자가 아니라 왼쪽에 붙인다 */
  // 휴대폰 카드(= 월별 표의 휴대폰 모습)는 테두리를 두르지 않는다 — 폼만 두른다(지시)
  calcPlain: { ...readOnly(CONTROL), color: 'var(--body)' },
  calcPlainStrong: { ...readOnly(CONTROL), color: 'var(--dark)', fontWeight: 700 },
  calcPlainWarn: { ...readOnly(CONTROL), color: 'var(--req)', fontWeight: 700 },
  calcText: { ...readOnlyBoxed(CONTROL), color: 'var(--dark)', fontWeight: 700, textAlign: 'left' },
  calcStrong: { ...readOnlyBoxed(CONTROL), color: 'var(--dark)', fontWeight: 700 },
  calcWarn: { ...readOnlyBoxed(CONTROL), color: 'var(--req)', fontWeight: 700 },

  // ── 표(PC·태블릿) — 칸이 열셋이라 한 단계 촘촘하게 ──
  moneyCell: { ...CELL, textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  textCell: CELL,
  textCellWide: CELL,
  dateCell: { ...CELL, minWidth: 0, justifyContent: 'space-between' },
  costCell: { ...CELL, cursor: 'pointer', color: 'var(--dark)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  payRow: { display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 },
  payTag: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', width: 38, whiteSpace: 'nowrap' },

  cards: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' },
  rowCard: { border: 'var(--hairline)', borderRadius: 'var(--r-sm)', padding: 'var(--sp-2)', display: 'flex', flexDirection: 'column', gap: 6 },
  // 삭제된 카드 — 표의 회색 줄과 같은 뜻이다
  rowCardDead: { border: '1px solid var(--req)', borderRadius: 'var(--r-sm)', padding: 'var(--sp-2)', display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--soft, #FAFAF7)', color: 'var(--muted)' },
  voidBar: { display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 6, borderBottom: 'var(--hairline)' },
  cardFoot: { gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', paddingTop: 4 },
  rowCardHead: { display: 'flex', alignItems: 'baseline', gap: 6, border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%' },
  rowCardSum: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  cardAmount: { marginLeft: 'auto', ...cellNum, fontWeight: 700, color: 'var(--dark)', fontSize: 'var(--fs-label)' },
  chip: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', border: 'var(--hairline)', borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' },
  chipWarn: { fontSize: 'var(--fs-caption)', color: 'var(--req)', border: '1px solid var(--req)', borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' },
  chipGood: { fontSize: 'var(--fs-caption)', color: 'var(--dark)', border: '1px solid var(--dark)', borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' },
  fields: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, paddingTop: 6, borderTop: 'var(--hairline)' },
  field: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 },
  fieldWide: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, gridColumn: '1 / -1' },
  fieldLabel: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },

  overlay: { position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--sp-4)' },
  modal: { background: '#fff', borderRadius: 12, width: 'min(520px, 96vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(22,24,15,.22)' },
  modalHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--sp-4)', borderBottom: 'var(--hairline)' },
  modalBody: { overflowY: 'auto', padding: 'var(--sp-4)', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 },
  close: { border: 'none', background: 'none', fontSize: 16, color: 'var(--muted)', cursor: 'pointer', width: 36, height: 36 },
  costSum: { gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', gap: 8, paddingTop: 8, borderTop: '1px solid var(--dark)', fontSize: 'var(--fs-label)', color: 'var(--dark)', flexWrap: 'wrap' },
  note: { gridColumn: '1 / -1', fontSize: 'var(--fs-caption)', color: 'var(--muted)', lineHeight: 1.6 },

  // ── 삭제된 줄 ──
  // 회색으로 남긴다 — 지운 것이 아니라 「뺀 것」이고, 무엇이 있었는지는 그대로 보여야 한다
  // 줄을 기준으로 삼아야 레이어가 줄 전체를 덮는다
  trDead: { color: 'var(--muted)', position: 'relative' },
  tdAct: { padding: '5px 2px', borderBottom: 'var(--hairline)', textAlign: 'center' },
  delBtn: {
    border: 'none', background: 'none', color: 'var(--muted)', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 13, width: 28, height: 'var(--h-control-sm)', borderRadius: 'var(--r-sm)',
  },
  voidLayer: {
    position: 'absolute', inset: 0, zIndex: 1,
    display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px',
    // 반투명 — 아래 회색 줄이 비쳐 보이되 사유는 또렷하게 읽힌다
    background: 'rgba(255,255,255,.88)',
    borderTop: '1px solid var(--req)', borderBottom: '1px solid var(--req)',
    fontSize: 'var(--fs-label)', color: 'var(--dark)', textAlign: 'left',
  },
  voidTag: {
    flexShrink: 0, fontSize: 'var(--fs-caption)', fontWeight: 700, color: '#fff',
    background: 'var(--req)', borderRadius: 4, padding: '1px 7px', whiteSpace: 'nowrap',
  },
  voidReason: { flex: '0 1 auto', minWidth: 0, maxWidth: 460, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  voidWho: { flexShrink: 1, minWidth: 0, fontSize: 'var(--fs-caption)', color: 'var(--muted)', whiteSpace: 'nowrap', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' },
  undoBtn: {
    flexShrink: 0, border: 'var(--hairline)', background: '#fff', borderRadius: 'var(--r-sm)',
    padding: '0 9px', height: 'var(--h-control-sm)', cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 'var(--fs-caption)', color: 'var(--dark)', whiteSpace: 'nowrap',
  },
  voidCount: { fontSize: 'var(--fs-caption)', color: 'var(--req)', whiteSpace: 'nowrap' },
  tdModalHost: { padding: 0, border: 'none', height: 0 },
  voidBody: { padding: 'var(--sp-4)', display: 'flex', flexDirection: 'column', gap: 8 },

  muted: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  empty: { fontSize: 'var(--fs-label)', color: 'var(--muted)', padding: '10px 0' },
  err: { fontSize: 'var(--fs-label)', color: 'var(--warn)' },
  savedNote: { fontSize: 'var(--fs-caption)', color: 'var(--lime-ink)', fontWeight: 700 },
}
