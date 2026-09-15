import { useEffect, useState } from 'react'
import { t, tf } from '../i18n'
import { fetchOrderChecklist, saveOrderChecklist, type OrderChecklist, type ChecklistScope } from '../api/checklists'
import { BTN } from '../styles/buttons'
import { rolesOf } from '@shared/types/index'
import { useAuth } from '../contexts/AuthContext'

/**
 * PDI 체크리스트 — **채워야 다음으로 넘어간다.**
 *
 * 서식(무엇을 확인하는가)은 관리자가 정하고, 여기서는 그 항목을 하나씩 판정한다.
 * 판정은 합격 / 불합격 둘뿐이다 — 「보류」를 두면 넘어갈 수 있다는 뜻이 되어 버린다.
 *
 * 불합격은 **끝이 아니다.** 고쳐서 다시 합격을 주면 되고, 그 과정이 항목별 이력으로
 * 남는다. 「한 번에 통과했다」와 「고쳐서 통과했다」는 다음 차를 만들 때 다른 이야기다.
 */
export function OrderChecklistPanel({ orderId, stepCode, stepLabel, onDone, scope = 'steps' }: {
  orderId: number
  /** 부가작업 단계면 `addon` — 관리자 전용 경로로 읽고 쓴다 */
  scope?: ChecklistScope
  stepCode: string
  stepLabel: string
  /** 제출까지 끝났다 — 바깥 단계 화면을 다시 읽게 한다 */
  onDone: () => void
}) {
  const { session } = useAuth()
  const [data, setData] = useState<OrderChecklist | null | 'loading'>('loading')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  /** 아직 저장하지 않은 메모 — 타자 칠 때마다 서버로 보내지 않는다 */
  const [memo, setMemo] = useState<Record<number, string>>({})

  async function load() {
    try { setData(await fetchOrderChecklist(orderId, stepCode, scope)) }
    catch (e) { setErr(e instanceof Error ? e.message : t('체크리스트를 불러오지 못했습니다')); setData(null) }
  }
  useEffect(() => { void load() }, [orderId, stepCode, scope])   // eslint-disable-line react-hooks/exhaustive-deps

  if (data === 'loading') return <div style={s.muted}>{t('불러오는 중…')}</div>
  // 서식이 아직 없는 단계 — 자리를 만들지 않는다(빈 표는 「없다」를 말해 주지 않는다)
  if (!data) return null

  const myRoles = rolesOf(session!.user)
  const canWrite = myRoles.includes(data.actor)
  const left = data.lines.filter(l => l.result !== 'pass').length

  /**
   * 합격·불합격 — **눌린 버튼을 다시 누르면 판정이 취소된다**(2026-09-15). 비고는 적어 둔 것을 함께 보낸다.
   */
  async function mark(lineId: number, current: 'pass' | 'fail' | null, pressed: 'pass' | 'fail') {
    await save({ id: lineId, result: current === pressed ? null : pressed, ...(memo[lineId] !== undefined ? { memo: memo[lineId] } : {}) })
  }
  /** 비고만 — 칸을 벗어날 때 저장한다(판정은 그대로) */
  async function saveMemo(lineId: number, before: string | null) {
    const v = memo[lineId]
    if (v === undefined || v.trim() === (before ?? '')) return
    await save({ id: lineId, memo: v })
  }
  async function save(line: { id: number; result?: 'pass' | 'fail' | null; memo?: string }) {
    setBusy(true); setErr('')
    try {
      await saveOrderChecklist(orderId, stepCode, [line], false, scope)
      await load()
    } catch (e) { setErr(e instanceof Error ? e.message : t('저장하지 못했습니다')) }
    finally { setBusy(false) }
  }

  async function submit() {
    setBusy(true); setErr('')
    try {
      await saveOrderChecklist(orderId, stepCode, [], true, scope)
      await load(); onDone()
    } catch (e) { setErr(e instanceof Error ? e.message : t('제출하지 못했습니다')) }
    finally { setBusy(false) }
  }

  return (
    <div style={s.root}>
      <div style={s.head}>
        <b>{tf('{0} 체크리스트', stepLabel)}</b>
        {data.submitted_at
          ? <span style={s.done}>{t('제출 완료')}</span>
          : <span style={s.left}>{tf('남은 항목 {0}개', left)}</span>}
        {!canWrite && <span style={s.muted}>{t('조회만 가능합니다')}</span>}
      </div>

      {/*
        **한 항목 = 세 줄**(2026-09-15 휴대폰 제보 — 좁은 칸에 비고·버튼이 겹쳐 항목 글자가 안 보였다).
          항목(구분)·내용 → 비고(한 줄 전체) → 합격 · 불합격(반반). 눌린 것을 다시 누르면 취소
        판정 이력 표시는 없앴다(지시).
      */}
      <div style={s.list}>
        {data.lines.map(l => {
          const failed = l.result === 'fail'
          const passed = l.result === 'pass'
          return (
            <div key={l.id} style={passed ? s.rowPass : failed ? s.rowFail : s.row}>
              <div style={s.top}>
                <div style={s.body}>
                  <div style={s.cat}><span style={s.seq}>{l.seq}</span>{l.category}</div>
                  <div style={s.content}>{l.content}</div>
                </div>
                {canWrite ? (
                  <input
                    style={s.memo} placeholder={t('비고')} maxLength={300} aria-label={tf('{0} 비고', l.content)}
                    defaultValue={l.memo ?? ''} disabled={busy}
                    onChange={e => setMemo(m => ({ ...m, [l.id]: e.target.value }))}
                    onBlur={() => void saveMemo(l.id, l.memo)}
                  />
                ) : (
                  <div style={s.readSide}>
                    <span style={passed ? s.tagPass : failed ? s.tagFail : s.muted}>
                      {passed ? t('합격') : failed ? t('불합격') : t('아직')}
                    </span>
                    {l.memo && <span style={s.muted}>{l.memo}</span>}
                  </div>
                )}
              </div>
              {canWrite && (
                <div style={s.buttons}>
                  <button type="button" style={passed ? s.passOn : s.choice} disabled={busy} aria-pressed={passed}
                    onClick={() => void mark(l.id, l.result as 'pass' | 'fail' | null, 'pass')}>{t('합격')}</button>
                  <button type="button" style={failed ? s.failOn : s.choice} disabled={busy} aria-pressed={failed}
                    onClick={() => void mark(l.id, l.result as 'pass' | 'fail' | null, 'fail')}>{t('불합격')}</button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {err && <div style={s.err}>{err}</div>}

      {canWrite && !data.submitted_at && (
        <div style={s.foot}>
          <button style={left === 0 && !busy ? BTN.primary : BTN.disabled} disabled={left > 0 || busy} onClick={() => void submit()}>
            {busy ? t('처리 중') : t('제출')}
          </button>
          <span style={s.muted}>
            {left > 0
              ? t('합격이 아닌 항목이 남아 있으면 제출할 수 없습니다')
              : t('제출하면 관리자에게 알림이 갑니다')}
          </span>
        </div>
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' },
  head: { display: 'flex', alignItems: 'baseline', gap: 'var(--sp-2)', fontSize: 'var(--fs-body)', flexWrap: 'wrap' },
  done: { color: 'var(--lime-ink)', fontSize: 'var(--fs-caption)' },
  left: { color: 'var(--warn)', fontSize: 'var(--fs-caption)' },
  list: { display: 'flex', flexDirection: 'column', gap: 6 },
  // ⚠️ 테두리는 한 줄(border)로만 — borderColor 만 덮었다 걷으면 React 가 그 값만 지워 색이 남는다
  row: {
    display: 'flex', flexDirection: 'column', gap: 8,
    padding: '10px 12px', border: 'var(--hairline)', borderRadius: 'var(--r-sm)', background: '#fff',
  },
  rowPass: {
    display: 'flex', flexDirection: 'column', gap: 8,
    padding: '10px 12px', border: '1px solid var(--lime)', borderRadius: 'var(--r-sm)', background: 'var(--lime-bg)',
  },
  rowFail: {
    display: 'flex', flexDirection: 'column', gap: 8,
    padding: '10px 12px', border: '1px solid var(--warn)', borderRadius: 'var(--r-sm)', background: 'var(--warnbg)',
  },
  // 항목·내용 위, 비고는 그 아래 한 줄 전체(2026-09-15 — 옆에 두면 좁아 쓰기 어렵다)
  top: { display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 8 },
  body: { minWidth: 0 },
  seq: { color: 'var(--muted)', fontVariantNumeric: 'tabular-nums', marginRight: 6 },
  cat: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', lineHeight: 1.4 },
  content: { fontSize: 'var(--fs-body)', color: 'var(--dark)', lineHeight: 1.45, wordBreak: 'keep-all', overflowWrap: 'anywhere' },
  memo: {
    width: '100%', minWidth: 0, boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 'var(--fs-input)',
    padding: '6px 8px', border: 'var(--hairline)', borderRadius: 'var(--r-sm)', background: '#fff',
  },
  readSide: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  // 아랫줄 — 합격·불합격 반반
  buttons: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 },
  choice: { ...BTN.smSecondary, width: '100%' },
  passOn: { ...BTN.smPrimary, width: '100%' },
  failOn: { ...BTN.smDanger, width: '100%' },
  tagPass: { color: 'var(--lime-ink)', fontSize: 'var(--fs-caption)' },
  tagFail: { color: 'var(--warn)', fontSize: 'var(--fs-caption)' },
  foot: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' },
  muted: { color: 'var(--muted)', fontSize: 'var(--fs-caption)' },
  err: { color: 'var(--warn)', fontSize: 'var(--fs-caption)' },
}
