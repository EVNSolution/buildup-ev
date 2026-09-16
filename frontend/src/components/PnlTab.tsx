import { useCallback, useEffect, useMemo, useState } from 'react'
import { t, tf } from '../i18n'
import { fetchPnl, savePnl, type PnlRow, type PnlPending, type PnlPatch } from '../api/pnl'
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

  const rows = view?.rows ?? []
  const total = useMemo(() => sumP(rows), [rows])

  return (
    <div style={s.root}>
      <MonthBar
        month={month} months={view?.months ?? []} busy={busy}
        onPick={ym => { setMonth(ym); load(ym) }}
      />
      {err && <div style={s.err}>{err}</div>}

      {/* ① 요약 — 그 달 전체 */}
      <SummaryBar total={total} isMobile={isMobile} />

      {/* ② 입력 필요 — 맨 위에 따로 둔다. 여기서 발행일을 적으면 그 달 표로 들어간다 */}
      <PendingBox pending={view?.pending ?? []} canEdit={canEdit} isMobile={isMobile} onWrite={write} />

      {/* ③ 그 달의 표 */}
      <section style={s.card}>
        <div style={s.cardHead}>
          <span style={s.cardTitle}>{month ? tf('{0}년 {1}월', Number(month.slice(0, 4)), Number(month.slice(5, 7))) : t('손익')}</span>
          <span style={s.cardCount}>{tf('{0}건', rows.length)}</span>
        </div>
        {rows.length === 0 ? (
          <div style={s.empty}>{t('이 달에 세금계산서가 발행된 건이 없습니다.')}</div>
        ) : isMobile ? (
          <div style={s.cards}>
            {rows.map(r => <RowCard key={r.quote_id} row={r} canEdit={canEdit} onWrite={write} />)}
          </div>
        ) : (
          <RowTable rows={rows} canEdit={canEdit} onWrite={write} />
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

function SummaryBar({ total, isMobile }: { total: ReturnType<typeof sumP>; isMobile: boolean }) {
  const tiles: { label: string; value: string; tone?: 'warn' | 'good' }[] = [
    { label: '발행 건수', value: tf('{0}건', total.count) },
    { label: '공급가액', value: won(total.supply_amount) },
    { label: 'VAT', value: won(total.vat) },
    { label: '공급대가', value: won(total.gross) },
    { label: '계약금', value: won(total.deposit) },
    { label: '캐피탈', value: won(total.capital) },
    // 아직 안 들어온 돈 — 음수가 정상이다
    { label: '입금 차액', value: won(total.pay_diff), tone: total.pay_diff < 0 ? 'warn' : undefined },
    { label: '원가', value: won(total.cost_total) },
    { label: '수익', value: `${won(total.profit)} · ${pct(total.margin)}`, tone: total.profit < 0 ? 'warn' : 'good' },
  ]
  return (
    <section style={s.card}>
      <div style={{ ...s.sumGrid, gridTemplateColumns: `repeat(${isMobile ? 2 : 5}, minmax(0, 1fr))` }}>
        {tiles.map(x => (
          <div key={x.label} style={s.sumCell}>
            <div style={s.sumLabel}>{t(x.label)}</div>
            <div style={x.tone === 'warn' ? s.sumValWarn : x.tone === 'good' ? s.sumValGood : s.sumVal}>{x.value}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ── 입력 필요 ─────────────────────────────────────────────────────────── */

function PendingBox({ pending, canEdit, isMobile, onWrite }: {
  pending: PnlPending[]; canEdit: boolean; isMobile: boolean
  onWrite: (quoteId: number, patch: PnlPatch) => Promise<PnlRow>
}) {
  const [open, setOpen] = useState(true)
  return (
    <section style={pending.length > 0 ? s.cardAlert : s.card}>
      <button type="button" style={s.cardHeadBtn} onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <span style={s.caret}>{open ? '▾' : '▸'}</span>
        <span style={s.cardTitle}>{t('입력 필요')}</span>
        <span style={pending.length > 0 ? s.cardCountWarn : s.cardCount}>{tf('{0}건', pending.length)}</span>
        <span style={s.muted}>{t('세금계산서 발행일을 적으면 그 달 표로 들어갑니다')}</span>
      </button>
      {open && (pending.length === 0 ? (
        <div style={s.empty}>{t('발행일을 적어야 할 건이 없습니다.')}</div>
      ) : (
        <div style={s.pendList}>
          {pending.map(p => (
            <PendingRow key={p.quote_id} item={p} canEdit={canEdit} isMobile={isMobile} onWrite={onWrite} />
          ))}
        </div>
      ))}
    </section>
  )
}

function PendingRow({ item, canEdit, isMobile, onWrite }: {
  item: PnlPending; canEdit: boolean; isMobile: boolean
  onWrite: (quoteId: number, patch: PnlPatch) => Promise<PnlRow>
}) {
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const save = async () => {
    if (!date || busy) return
    setBusy(true); setErr('')
    try { await onWrite(item.quote_id, { invoice_on: date }) }
    catch (e) { setErr(e instanceof Error ? e.message : t('저장하지 못했습니다')) }
    finally { setBusy(false) }
  }
  return (
    <div style={isMobile ? s.pendRowMobile : s.pendRow}>
      <span style={s.pendNo}>{item.quote_no ?? `#${item.quote_id}`}</span>
      <span style={s.pendName}>{item.customer ?? '—'}</span>
      <span style={s.pendSub}>{item.contracted_on ?? '—'}</span>
      <span style={s.pendAmount}>{item.supply_default === null ? '—' : won(item.supply_default)}</span>
      <DateField
        value={date} onChange={setDate} disabled={!canEdit || busy}
        ariaLabel={t('세금계산서 발행일')} style={s.dateInput}
      />
      <button type="button" style={date && canEdit && !busy ? BTN.smPrimary : BTN.disabled} disabled={!date || !canEdit || busy} onClick={save}>
        {t('저장')}
      </button>
      {err && <span style={s.err}>{err}</span>}
    </div>
  )
}

/* ── 적는 칸 ──────────────────────────────────────────────────────────── */

/** 금액 칸 — 세 자리마다 쉼표로 보여 주고 숫자로 돌려준다. 칸을 벗어날 때 저장한다 */
function MoneyCell({ value, disabled, label, onSave }: {
  value: number; disabled?: boolean; label: string; onSave: (v: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (value ? value.toLocaleString('ko-KR') : '')
  return (
    <input
      style={s.moneyInput} value={shown} disabled={disabled} inputMode="numeric" aria-label={label}
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
function DateCell({ value, disabled, label, onSave }: {
  value: string | null; disabled?: boolean; label: string; onSave: (v: string | null) => void
}) {
  return (
    <DateField
      value={value ?? ''} disabled={disabled} ariaLabel={label} style={s.dateInput} clearable
      onChange={v => { const next = v || null; if (next !== value) onSave(next) }}
    />
  )
}

function TextCell({ value, disabled, label, onSave, wide }: {
  value: string | null; disabled?: boolean; label: string; wide?: boolean; onSave: (v: string | null) => void
}) {
  return (
    <input
      style={wide ? s.textInputWide : s.textInput} defaultValue={value ?? ''} disabled={disabled}
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

function RowTable({ rows, canEdit, onWrite }: {
  rows: PnlRow[]; canEdit: boolean
  onWrite: (quoteId: number, patch: PnlPatch) => Promise<PnlRow>
}) {
  const total = sumP(rows)
  return (
    // 칸이 열셋이라 태블릿에서는 옆으로 민다 — 줄여서 읽을 수 없는 숫자를 만들지 않는다
    <div style={s.tableWrap}>
      <table style={s.table}>
        <thead>
          <tr>
            {['고객명', '사업자명', '발행일', '공급가액', 'VAT', '공급대가', '계약금', '캐피탈', '입금 차액', '입금일', '원가', '수익', '비고']
              .map(h => <th key={h} style={s.th}>{t(h)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => <TableRow key={r.quote_id} row={r} canEdit={canEdit} onWrite={onWrite} />)}
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
            <td style={s.tfNum} />
            <td style={s.tfNum}>{won(total.cost_total)}</td>
            <td style={total.profit < 0 ? s.tfNumWarn : s.tfNum}>{won(total.profit)}</td>
            <td style={s.tfNum} />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function TableRow({ row, canEdit, onWrite }: {
  row: PnlRow; canEdit: boolean
  onWrite: (quoteId: number, patch: PnlPatch) => Promise<PnlRow>
}) {
  const d = deriveP(row)
  const { put, mark, failed } = useRowWriter(row, onWrite)
  const [costOpen, setCostOpen] = useState(false)
  const ro = !canEdit
  return (
    <tr>
      <td style={s.td}>
        <span style={s.name}>{row.customer ?? '—'}</span>
        <span style={s.no}>{row.quote_no ?? `#${row.quote_id}`}{mark && <b style={failed ? s.markFail : s.mark}> {mark}</b>}</span>
      </td>
      <td style={s.td}><TextCell value={row.biz_name} disabled={ro} label={t('사업자명')} onSave={v => put({ biz_name: v })} /></td>
      <td style={s.td}><DateCell value={row.invoice_on} disabled={ro} label={t('세금계산서 발행일')} onSave={v => put({ invoice_on: v })} /></td>
      <td style={s.tdNum}><MoneyCell value={row.supply_amount} disabled={ro} label={t('공급가액')} onSave={v => put({ supply_amount: v })} /></td>
      <td style={s.tdCalc}>{won(d.vat)}</td>
      <td style={s.tdCalc}>{won(d.gross)}</td>
      <td style={s.tdNum}><MoneyCell value={row.deposit} disabled={ro} label={t('계약금')} onSave={v => put({ deposit: v })} /></td>
      <td style={s.tdNum}><MoneyCell value={row.capital} disabled={ro} label={t('캐피탈')} onSave={v => put({ capital: v })} /></td>
      <td style={d.pay_diff < 0 ? s.tdCalcWarn : s.tdCalc}>{won(d.pay_diff)}</td>
      <td style={s.td}>
        <div style={s.payRow}><span style={s.payTag}>{t('계약금')}</span>
          <DateCell value={row.deposit_paid_on} disabled={ro} label={t('계약금 입금일')} onSave={v => put({ deposit_paid_on: v })} /></div>
        <div style={s.payRow}><span style={s.payTag}>{t('캐피탈')}</span>
          <DateCell value={row.capital_paid_on} disabled={ro} label={t('캐피탈 입금일')} onSave={v => put({ capital_paid_on: v })} /></div>
      </td>
      <td style={s.tdNum}>
        <button type="button" style={s.costBtn} onClick={() => setCostOpen(true)}>{won(d.cost_total)} ✎</button>
        {costOpen && <CostModal row={row} canEdit={canEdit} onClose={() => setCostOpen(false)} onSave={put} />}
      </td>
      <td style={d.profit < 0 ? s.tdCalcWarn : s.tdCalcGood}>{won(d.profit)}</td>
      <td style={s.td}><TextCell value={row.memo} disabled={ro} label={t('비고')} wide onSave={v => put({ memo: v })} /></td>
    </tr>
  )
}

/* ── 휴대폰 카드 ──────────────────────────────────────────────────────── */

function RowCard({ row, canEdit, onWrite }: {
  row: PnlRow; canEdit: boolean
  onWrite: (quoteId: number, patch: PnlPatch) => Promise<PnlRow>
}) {
  const d = deriveP(row)
  const { put, mark, failed } = useRowWriter(row, onWrite)
  const [open, setOpen] = useState(false)
  const [costOpen, setCostOpen] = useState(false)
  const ro = !canEdit
  return (
    <div style={s.rowCard}>
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
          <Field label={t('사업자명')}><TextCell value={row.biz_name} disabled={ro} label={t('사업자명')} onSave={v => put({ biz_name: v })} /></Field>
          <Field label={t('세금계산서 발행일')}><DateCell value={row.invoice_on} disabled={ro} label={t('세금계산서 발행일')} onSave={v => put({ invoice_on: v })} /></Field>
          <Field label={t('공급가액')}><MoneyCell value={row.supply_amount} disabled={ro} label={t('공급가액')} onSave={v => put({ supply_amount: v })} /></Field>
          <Field label={t('VAT')}><span style={s.calc}>{won(d.vat)}</span></Field>
          <Field label={t('공급대가')}><span style={s.calc}>{won(d.gross)}</span></Field>
          <Field label={t('계약금')}><MoneyCell value={row.deposit} disabled={ro} label={t('계약금')} onSave={v => put({ deposit: v })} /></Field>
          <Field label={t('캐피탈')}><MoneyCell value={row.capital} disabled={ro} label={t('캐피탈')} onSave={v => put({ capital: v })} /></Field>
          <Field label={t('계약금 입금일')}><DateCell value={row.deposit_paid_on} disabled={ro} label={t('계약금 입금일')} onSave={v => put({ deposit_paid_on: v })} /></Field>
          <Field label={t('캐피탈 입금일')}><DateCell value={row.capital_paid_on} disabled={ro} label={t('캐피탈 입금일')} onSave={v => put({ capital_paid_on: v })} /></Field>
          <Field label={t('원가')}>
            <button type="button" style={s.costBtn} onClick={() => setCostOpen(true)}>{won(d.cost_total)} ✎</button>
          </Field>
          <Field label={t('비고')} wide><TextCell value={row.memo} disabled={ro} label={t('비고')} wide onSave={v => put({ memo: v })} /></Field>
        </div>
      )}
      {costOpen && <CostModal row={row} canEdit={canEdit} onClose={() => setCostOpen(false)} onSave={put} />}
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

/* ── 원가 ─────────────────────────────────────────────────────────────── */

/**
 * 원가 — **별도 시스템에서 불러올 자리**(아직 만드는 중). 그때까지는 손으로 적는다.
 * 넷으로 나눠 두는 이유는, 나중에 자동으로 채울 때 어느 칸에 무엇이 들어갈지 미리 정해 두기 위함이다.
 */
function CostModal({ row, canEdit, onClose, onSave }: {
  row: PnlRow; canEdit: boolean; onClose: () => void; onSave: (patch: PnlPatch) => void
}) {
  useEscapeClose(onClose)
  const d = deriveP(row)
  const parts: { key: keyof PnlPatch; label: string; value: number }[] = [
    { key: 'cost_outsourcing', label: '외주비', value: row.cost_outsourcing },
    { key: 'cost_supply', label: '사급비', value: row.cost_supply },
    { key: 'cost_internal', label: '내부비용', value: row.cost_internal },
    { key: 'cost_etc', label: '기타', value: row.cost_etc },
  ]
  return (
    <div style={s.overlay} onClick={ev => { if (ev.target === ev.currentTarget) onClose() }}>
      <div style={s.modal} role="dialog" aria-modal="true" aria-label={t('원가')}>
        <div style={s.modalHead}>
          <span style={s.cardTitle}>{tf('원가 · {0}', row.customer ?? String(row.quote_id))}</span>
          <button type="button" style={s.close} onClick={onClose} aria-label={t('닫기')}>✕</button>
        </div>
        <div style={s.modalBody}>
          {parts.map(p => (
            <Field key={String(p.key)} label={t(p.label)}>
              <MoneyCell value={p.value} disabled={!canEdit} label={t(p.label)} onSave={v => onSave({ [p.key]: v } as PnlPatch)} />
            </Field>
          ))}
          <Field label={t('원가 메모')} wide>
            <TextCell value={row.cost_memo} disabled={!canEdit} label={t('원가 메모')} wide onSave={v => onSave({ cost_memo: v })} />
          </Field>
          <div style={s.costSum}>
            <span>{t('총원가')} <b>{won(d.cost_total)}</b></span>
            <span>{t('수익')} <b style={d.profit < 0 ? s.markFail : undefined}>{won(d.profit)}</b> · {pct(d.margin)}</span>
          </div>
          <div style={s.note}>{t('원가는 별도 시스템과 이어질 자리입니다. 지금은 직접 적습니다.')}</div>
        </div>
      </div>
    </div>
  )
}

/* ── 모양 ─────────────────────────────────────────────────────────────── */

const cardBase: React.CSSProperties = {
  background: '#fff', border: 'var(--hairline)', borderRadius: 'var(--r-md)',
  padding: 'var(--sp-4)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', minWidth: 0,
}
const cellNum: React.CSSProperties = { fontVariantNumeric: 'tabular-nums', textAlign: 'right', whiteSpace: 'nowrap' }

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

  sumGrid: { display: 'grid', gap: 'var(--sp-3)' },
  sumCell: { minWidth: 0 },
  sumLabel: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', whiteSpace: 'nowrap' },
  sumVal: { fontSize: 18, fontWeight: 700, color: 'var(--dark)', ...cellNum, textAlign: 'left' },
  sumValWarn: { fontSize: 18, fontWeight: 700, color: 'var(--req)', ...cellNum, textAlign: 'left' },
  sumValGood: { fontSize: 18, fontWeight: 700, color: 'var(--dark)', ...cellNum, textAlign: 'left' },

  pendList: { display: 'flex', flexDirection: 'column', maxHeight: 260, overflowY: 'auto' },
  pendRow: { display: 'grid', gridTemplateColumns: '92px 1fr 90px 130px 150px 64px', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: 'var(--hairline)', fontSize: 'var(--fs-label)' },
  pendRowMobile: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: '8px 0', borderTop: 'var(--hairline)', fontSize: 'var(--fs-label)' },
  pendNo: { fontWeight: 700, color: 'var(--dark)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  pendName: { color: 'var(--body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  pendSub: { color: 'var(--muted)', fontSize: 'var(--fs-caption)', whiteSpace: 'nowrap' },
  pendAmount: { ...cellNum, color: 'var(--body)', fontSize: 'var(--fs-caption)' },

  tableWrap: { overflowX: 'auto' },
  table: { borderCollapse: 'collapse', width: '100%', minWidth: 1180 },
  th: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', fontWeight: 400, textAlign: 'left', padding: '6px 6px', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' },
  td: { padding: '5px 6px', borderBottom: 'var(--hairline)', fontSize: 'var(--fs-label)', verticalAlign: 'middle' },
  tdNum: { padding: '5px 6px', borderBottom: 'var(--hairline)', fontSize: 'var(--fs-label)', ...cellNum },
  tdCalc: { padding: '5px 6px', borderBottom: 'var(--hairline)', fontSize: 'var(--fs-label)', color: 'var(--muted)', ...cellNum },
  tdCalcWarn: { padding: '5px 6px', borderBottom: 'var(--hairline)', fontSize: 'var(--fs-label)', color: 'var(--req)', fontWeight: 700, ...cellNum },
  tdCalcGood: { padding: '5px 6px', borderBottom: 'var(--hairline)', fontSize: 'var(--fs-label)', color: 'var(--dark)', fontWeight: 700, ...cellNum },
  tfLabel: { padding: '8px 6px', borderTop: '1px solid var(--dark)', fontWeight: 700, color: 'var(--dark)', fontSize: 'var(--fs-label)' },
  tfNum: { padding: '8px 6px', borderTop: '1px solid var(--dark)', fontWeight: 700, color: 'var(--dark)', fontSize: 'var(--fs-label)', ...cellNum },
  tfNumWarn: { padding: '8px 6px', borderTop: '1px solid var(--dark)', fontWeight: 700, color: 'var(--req)', fontSize: 'var(--fs-label)', ...cellNum },

  name: { display: 'block', color: 'var(--dark)', fontWeight: 700, whiteSpace: 'nowrap' },
  no: { display: 'block', color: 'var(--muted)', fontSize: 'var(--fs-caption)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  mark: { color: 'var(--lime)' },
  markFail: { color: 'var(--req)' },

  moneyInput: { width: '100%', minWidth: 88, boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 'var(--fs-input)', padding: '5px 6px', border: 'var(--hairline)', borderRadius: 'var(--r-sm)', background: '#fff', textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  dateInput: { boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 'var(--fs-input)', padding: '4px 6px', border: 'var(--hairline)', borderRadius: 'var(--r-sm)', background: '#fff' },
  textInput: { width: '100%', minWidth: 90, boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 'var(--fs-input)', padding: '5px 6px', border: 'var(--hairline)', borderRadius: 'var(--r-sm)', background: '#fff' },
  textInputWide: { width: '100%', minWidth: 140, boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 'var(--fs-input)', padding: '5px 6px', border: 'var(--hairline)', borderRadius: 'var(--r-sm)', background: '#fff' },
  payRow: { display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 },
  payTag: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', width: 38, whiteSpace: 'nowrap' },
  costBtn: { border: 'var(--hairline)', background: '#fff', borderRadius: 'var(--r-sm)', padding: '5px 8px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'var(--fs-label)', color: 'var(--dark)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },

  cards: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' },
  rowCard: { border: 'var(--hairline)', borderRadius: 'var(--r-sm)', padding: 'var(--sp-2)', display: 'flex', flexDirection: 'column', gap: 6 },
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
  calc: { fontSize: 'var(--fs-label)', color: 'var(--body)', ...cellNum, textAlign: 'left', padding: '5px 0' },

  overlay: { position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--sp-4)' },
  modal: { background: '#fff', borderRadius: 12, width: 'min(520px, 96vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(22,24,15,.22)' },
  modalHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--sp-4)', borderBottom: 'var(--hairline)' },
  modalBody: { overflowY: 'auto', padding: 'var(--sp-4)', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 },
  close: { border: 'none', background: 'none', fontSize: 16, color: 'var(--muted)', cursor: 'pointer', width: 36, height: 36 },
  costSum: { gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', gap: 8, paddingTop: 8, borderTop: '1px solid var(--dark)', fontSize: 'var(--fs-label)', color: 'var(--dark)', flexWrap: 'wrap' },
  note: { gridColumn: '1 / -1', fontSize: 'var(--fs-caption)', color: 'var(--muted)', lineHeight: 1.6 },

  muted: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  empty: { fontSize: 'var(--fs-label)', color: 'var(--muted)', padding: '10px 0' },
  err: { fontSize: 'var(--fs-label)', color: 'var(--warn)' },
}
