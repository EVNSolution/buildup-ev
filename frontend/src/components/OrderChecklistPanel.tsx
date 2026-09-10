import { useEffect, useState } from 'react'
import { t, tf } from '../i18n'
import { fetchOrderChecklist, saveOrderChecklist, type OrderChecklist } from '../api/checklists'
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
export function OrderChecklistPanel({ orderId, stepCode, stepLabel, onDone }: {
  orderId: number
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
    try { setData(await fetchOrderChecklist(orderId, stepCode)) }
    catch (e) { setErr(e instanceof Error ? e.message : t('체크리스트를 불러오지 못했습니다')); setData(null) }
  }
  useEffect(() => { void load() }, [orderId, stepCode])

  if (data === 'loading') return <div style={s.muted}>{t('불러오는 중…')}</div>
  // 서식이 아직 없는 단계 — 자리를 만들지 않는다(빈 표는 「없다」를 말해 주지 않는다)
  if (!data) return null

  const myRoles = rolesOf(session!.user)
  const canWrite = myRoles.includes(data.actor)
  const left = data.lines.filter(l => l.result !== 'pass').length

  async function mark(lineId: number, result: 'pass' | 'fail') {
    setBusy(true); setErr('')
    try {
      await saveOrderChecklist(orderId, stepCode, [{ id: lineId, result, memo: memo[lineId] ?? '' }])
      await load()
    } catch (e) { setErr(e instanceof Error ? e.message : t('저장하지 못했습니다')) }
    finally { setBusy(false) }
  }

  async function submit() {
    setBusy(true); setErr('')
    try {
      await saveOrderChecklist(orderId, stepCode, [], true)
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

      <div style={s.list}>
        {data.lines.map(l => {
          const failed = l.result === 'fail'
          return (
            <div key={l.id} style={l.result === 'pass' ? s.rowPass : failed ? s.rowFail : s.row}>
              <div style={s.seq}>{l.seq}</div>
              <div style={s.body}>
                <div style={s.cat}>{l.category}</div>
                <div style={s.content}>{l.content}</div>
                {/* 재검 이력 — 두 번 이상 봤을 때만 보여 준다(한 번에 통과한 줄은 조용히) */}
                {l.logs.length > 1 && (
                  <div style={s.logs}>
                    {l.logs.map((g, i) => (
                      <span key={i} style={g.result === 'fail' ? s.logFail : s.logPass}>
                        {g.result === 'fail' ? t('불합격') : t('합격')}
                        {g.memo ? ` · ${g.memo}` : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {canWrite ? (
                <div style={s.actions}>
                  <input
                    style={s.memo} placeholder={t('비고')} maxLength={300}
                    defaultValue={l.memo ?? ''} disabled={busy}
                    onChange={e => setMemo(m => ({ ...m, [l.id]: e.target.value }))}
                  />
                  <button style={l.result === 'pass' ? s.passOn : BTN.smSecondary} disabled={busy}
                    onClick={() => void mark(l.id, 'pass')}>{t('합격')}</button>
                  <button style={failed ? s.failOn : BTN.smSecondary} disabled={busy}
                    onClick={() => void mark(l.id, 'fail')}>{t('불합격')}</button>
                </div>
              ) : (
                <div style={s.actions}>
                  <span style={l.result === 'pass' ? s.tagPass : failed ? s.tagFail : s.muted}>
                    {l.result === 'pass' ? t('합격') : failed ? t('불합격') : t('아직')}
                  </span>
                  {l.memo && <span style={s.muted}>{l.memo}</span>}
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
  list: { display: 'flex', flexDirection: 'column', gap: 4 },
  row: {
    display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-start',
    padding: 'var(--sp-2)', border: 'var(--hairline)', borderRadius: 'var(--r-sm)', background: '#fff',
  },
  get rowPass() { return { ...this['row'], borderColor: 'var(--lime)', background: 'var(--lime-bg)' } as React.CSSProperties },
  get rowFail() { return { ...this['row'], borderColor: 'var(--warn)', background: 'var(--warnbg)' } as React.CSSProperties },
  seq: { width: 20, color: 'var(--muted)', fontSize: 'var(--fs-caption)', fontVariantNumeric: 'tabular-nums' },
  body: { flex: 1, minWidth: 0 },
  cat: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  content: { fontSize: 'var(--fs-label)', color: 'var(--dark)' },
  logs: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 3 },
  logPass: { fontSize: 'var(--fs-caption)', color: 'var(--lime-ink)' },
  logFail: { fontSize: 'var(--fs-caption)', color: 'var(--warn)' },
  actions: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  memo: {
    fontFamily: 'inherit', fontSize: 'var(--fs-caption)', padding: '2px 6px', width: 140,
    border: 'var(--hairline)', borderRadius: 'var(--r-sm)',
  },
  get passOn() { return { ...BTN['smPrimary'] } as React.CSSProperties },
  get failOn() { return { ...BTN['smDanger'] } as React.CSSProperties },
  tagPass: { color: 'var(--lime-ink)', fontSize: 'var(--fs-caption)' },
  tagFail: { color: 'var(--warn)', fontSize: 'var(--fs-caption)' },
  foot: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' },
  muted: { color: 'var(--muted)', fontSize: 'var(--fs-caption)' },
  err: { color: 'var(--warn)', fontSize: 'var(--fs-caption)' },
}
