import { useEffect, useState } from 'react'
import { t, tf } from '../i18n'
import {
  fetchChecklistSteps, fetchChecklistItems, saveChecklistItems, type ChecklistItem,
} from '../api/checklists'
import { BTN } from '../styles/buttons'

/**
 * 체크리스트 **서식** — 단계별로 무엇을 확인할지 정한다.
 *
 * 여기서 정하는 것은 **무엇을 보는가**뿐이다. 어느 단계에 붙는지, 누가 적는지,
 * 「채워야 넘어간다」는 규칙은 제품이 정한다 — 그것까지 데이터로 내리면
 * 검증할 곳이 흩어진다.
 *
 * ⚠️ 여기를 고쳐도 **이미 작성 중인 체크리스트는 바뀌지 않는다.** 작성을 시작할 때
 *    그 시점의 항목이 주문에 사본으로 얼린다 — 3개월 전에 합격 처리한 항목의 뜻이
 *    소급해서 바뀌면 그 기록은 근거가 되지 못한다.
 * ⚠️ 지운 줄은 **꺼질 뿐** 사라지지 않는다. 옛 기록이 무엇을 봤는지 되짚을 수 있어야 한다.
 */
type Row = { id?: number; category: string; content: string }

export function ChecklistTab() {
  const [steps, setSteps] = useState<{ code: string; label: string; actor: string }[]>([])
  const [step, setStep] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [off, setOff] = useState<ChecklistItem[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState('')

  useEffect(() => {
    fetchChecklistSteps()
      .then(list => { setSteps(list); setStep(p => p || list[0]?.code || '') })
      .catch(e => setErr(e instanceof Error ? e.message : t('단계 목록을 불러오지 못했습니다')))
  }, [])

  useEffect(() => {
    if (!step) return
    setErr(''); setSaved('')
    fetchChecklistItems(step)
      .then(items => {
        setRows(items.filter(i => i.active).map(i => ({ id: i.id, category: i.category, content: i.content })))
        setOff(items.filter(i => !i.active))
      })
      .catch(e => setErr(e instanceof Error ? e.message : t('서식을 불러오지 못했습니다')))
  }, [step])

  const actor = steps.find(x => x.code === step)?.actor
  const actorKo = actor === 'MAKER' ? t('특장사') : actor === 'ADMIN' ? t('관리자') : t('영업')

  function edit(i: number, patch: Partial<Row>) {
    setRows(r => r.map((x, k) => (k === i ? { ...x, ...patch } : x)))
  }
  function move(i: number, d: -1 | 1) {
    setRows(r => {
      const n = [...r]; const j = i + d
      if (j < 0 || j >= n.length) return r
      ;[n[i], n[j]] = [n[j]!, n[i]!]
      return n
    })
  }

  async function save() {
    setBusy(true); setErr(''); setSaved('')
    try {
      const items = await saveChecklistItems(step, rows.filter(r => r.content.trim() !== ''))
      setRows(items.filter(i => i.active).map(i => ({ id: i.id, category: i.category, content: i.content })))
      setOff(items.filter(i => !i.active))
      setSaved(t('저장했습니다'))
    } catch (e) { setErr(e instanceof Error ? e.message : t('저장하지 못했습니다')) }
    finally { setBusy(false) }
  }

  return (
    <div style={s.root}>
      <div style={s.bar}>
        <select style={s.pick} value={step} onChange={e => setStep(e.target.value)} aria-label={t('단계 고르기')}>
          {steps.map(o => <option key={o.code} value={o.code}>{t(o.label)}</option>)}
        </select>
        {actor && <span style={s.muted}>{tf('{0}가 적습니다', actorKo)}</span>}
        <div style={{ flex: 1 }} />
        <button style={BTN.secondary} disabled={busy} onClick={() => setRows(r => [...r, { category: '', content: '' }])}>
          {t('항목 추가')}
        </button>
        <button style={busy ? BTN.disabled : BTN.primary} disabled={busy} onClick={() => void save()}>
          {busy ? t('저장 중') : t('저장')}
        </button>
      </div>

      <p style={s.note}>
        {t('여기를 고쳐도 이미 작성 중인 체크리스트는 바뀌지 않습니다. 작성을 시작할 때의 항목이 그 주문에 남습니다.')}
      </p>

      <div style={s.head}>
        <span style={s.cSeq}>{t('순번')}</span>
        <span style={s.cCat}>{t('항목명(구분)')}</span>
        <span style={s.cCon}>{t('내용')}</span>
        <span style={s.cAct} />
      </div>

      {rows.length === 0 && <div style={s.empty}>{t('아직 항목이 없습니다. 항목이 없는 단계는 체크리스트 없이 넘어갑니다.')}</div>}

      {rows.map((r, i) => (
        <div key={r.id ?? `new-${i}`} style={s.row}>
          <span style={s.cSeq}>{i + 1}</span>
          <input style={{ ...s.input, ...s.cCat }} value={r.category} maxLength={60}
            placeholder={t('예) 외관')} onChange={e => edit(i, { category: e.target.value })} />
          <input style={{ ...s.input, ...s.cCon }} value={r.content} maxLength={300}
            placeholder={t('예) 적재함 도장 상태에 이상이 없는가')} onChange={e => edit(i, { content: e.target.value })} />
          <span style={s.cAct}>
            <button style={s.mini} disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('위로')}>↑</button>
            <button style={s.mini} disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label={t('아래로')}>↓</button>
            <button style={s.del} onClick={() => setRows(x => x.filter((_, k) => k !== i))}>{t('삭제')}</button>
          </span>
        </div>
      ))}

      {err && <div style={s.err}>{err}</div>}
      {saved && <div style={s.ok}>{saved}</div>}

      {/* 꺼진 항목 — 지운 것이 아니라 새 체크리스트에서 빠질 뿐이다 */}
      {off.length > 0 && (
        <div style={s.offBox}>
          <div style={s.muted}>{tf('쓰지 않는 항목 {0}개 — 지워지지 않고 남아 있습니다', off.length)}</div>
          {off.map(o => <div key={o.id} style={s.offRow}>{o.category} · {o.content}</div>)}
        </div>
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' },
  bar: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' },
  pick: { fontFamily: 'inherit', fontSize: 'var(--fs-body)' },
  note: { margin: 0, color: 'var(--muted)', fontSize: 'var(--fs-caption)' },
  head: {
    display: 'flex', gap: 'var(--sp-2)', padding: '0 var(--sp-2)',
    fontSize: 'var(--fs-caption)', color: 'var(--muted)',
  },
  row: { display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' },
  cSeq: { width: 34, flex: 'none', textAlign: 'center', fontVariantNumeric: 'tabular-nums' },
  cCat: { width: 150, flex: 'none' },
  cCon: { flex: 1, minWidth: 0 },
  cAct: { width: 130, flex: 'none', display: 'flex', gap: 4, justifyContent: 'flex-end' },
  input: {
    fontFamily: 'inherit', fontSize: 'var(--fs-label)', padding: '4px 8px',
    border: 'var(--hairline)', borderRadius: 'var(--r-sm)',
  },
  mini: {
    fontFamily: 'inherit', fontSize: 'var(--fs-caption)', width: 26, padding: '2px 0',
    border: 'var(--hairline)', borderRadius: 'var(--r-sm)', background: '#fff', cursor: 'pointer',
  },
  del: {
    fontFamily: 'inherit', fontSize: 'var(--fs-caption)', padding: '2px 8px',
    border: 'none', background: 'transparent', color: 'var(--warn)', cursor: 'pointer',
  },
  empty: { color: 'var(--muted)', fontSize: 'var(--fs-label)', padding: 'var(--sp-3) 0' },
  muted: { color: 'var(--muted)', fontSize: 'var(--fs-caption)' },
  err: { color: 'var(--warn)', fontSize: 'var(--fs-label)' },
  ok: { color: 'var(--lime-ink)', fontSize: 'var(--fs-label)' },
  offBox: {
    marginTop: 'var(--sp-3)', paddingTop: 'var(--sp-2)', borderTop: 'var(--hairline)',
    display: 'flex', flexDirection: 'column', gap: 2,
  },
  offRow: { color: 'var(--muted)', fontSize: 'var(--fs-caption)', textDecoration: 'line-through' },
}
