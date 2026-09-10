import { useEffect, useState } from 'react'
import { t, tf } from '../i18n'
import {
  fetchHolidayYear, importHolidayYear, saveHolidayYear,
  type HolidayRow, type HolidayDraft,
} from '../lib/holidays'
import { BTN } from '../styles/buttons'

/**
 * 공휴일 — **영업일 계산의 달력.**
 *
 * 납기 한도는 「배정일로부터 20영업일」이라 연휴가 빠지지 않으면 고를 수 있는 날짜가
 * 실제보다 적어진다. 그래서 이 표가 정본이고, 여기서 고치면 **다음 계산부터** 반영된다.
 *
 * ⚠️ 해가 바뀌면 **여기서** 넣는다. 배포를 기다릴 일이 아니다 — 임시공휴일은 예고 없이
 *    생기고, 대체공휴일도 해마다 다르다.
 * ⚠️ 「불러오기」는 **초안**이다. 무료 공개 소스는 한국 공휴일을 틀리게 주는 일이 있다
 *    (2026년에 두 소스 모두 제헌절을 공휴일로 넣었다 — 2008년에 빠진 날이다).
 *    받아 온 것을 눈으로 확인하고 저장한다.
 */
const KO_DAY = ['일', '월', '화', '수', '목', '금', '토']
const weekday = (day: string) => KO_DAY[new Date(`${day}T00:00:00`).getDay()] ?? ''

type Row = { day: string; name: string; memo: string | null; source: string }

export function HolidayTab() {
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)
  const [rows, setRows] = useState<Row[]>([])
  const [off, setOff] = useState<HolidayRow[]>([])
  const [draft, setDraft] = useState<{ rows: HolidayDraft[]; note: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  function load(y: number) {
    setErr(''); setMsg(''); setDraft(null)
    fetchHolidayYear(y)
      .then(list => {
        setRows(list.filter(h => h.active).map(h => ({ day: h.day, name: h.name, memo: h.memo, source: h.source })))
        setOff(list.filter(h => !h.active))
      })
      .catch(e => setErr(e instanceof Error ? e.message : t('공휴일을 불러오지 못했습니다')))
  }
  useEffect(() => { load(year) }, [year])

  const sorted = [...rows].sort((a, b) => a.day.localeCompare(b.day))

  async function pull() {
    setBusy(true); setErr(''); setMsg('')
    try { setDraft(await importHolidayYear(year)) }
    catch (e) { setErr(e instanceof Error ? e.message : t('공휴일을 받아 오지 못했습니다')) }
    finally { setBusy(false) }
  }

  function take(d: HolidayDraft) {
    setRows(r => (r.some(x => x.day === d.day) ? r : [...r, { day: d.day, name: d.name, memo: null, source: 'api' }]))
  }

  async function save() {
    setBusy(true); setErr(''); setMsg('')
    try {
      const r = await saveHolidayYear(year, sorted)
      setMsg(tf('{0}일을 저장했습니다', r.saved))
      load(year)
    } catch (e) { setErr(e instanceof Error ? e.message : t('저장하지 못했습니다')) }
    finally { setBusy(false) }
  }

  return (
    <div style={s.root}>
      <div style={s.bar}>
        <select style={s.pick} value={year} onChange={e => setYear(Number(e.target.value))} aria-label={t('연도 고르기')}>
          {[thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map(y => (
            <option key={y} value={y}>{tf('{0}년', y)}</option>
          ))}
        </select>
        <span style={s.muted}>{tf('쉬는 날 {0}일', sorted.length)}</span>
        <div style={{ flex: 1 }} />
        <button style={BTN.secondary} disabled={busy} onClick={() => void pull()}>{t('불러오기')}</button>
        <button style={BTN.secondary} disabled={busy}
          onClick={() => setRows(r => [...r, { day: `${year}-01-01`, name: '', memo: null, source: 'manual' }])}>
          {t('직접 추가')}
        </button>
        <button style={busy ? BTN.disabled : BTN.primary} disabled={busy} onClick={() => void save()}>
          {busy ? t('저장 중') : t('저장')}
        </button>
      </div>

      <p style={s.note}>{t('여기서 고치면 다음 납기 계산부터 반영됩니다. 해가 바뀌면 여기서 넣으면 되고, 배포는 필요 없습니다.')}</p>

      {draft && (
        <div style={s.draft}>
          <div style={s.draftHead}>
            <b>{tf('{0}년 초안', year)}</b>
            <span style={s.warn}>{draft.note}</span>
          </div>
          <div style={s.chips}>
            {draft.rows.map(d => {
              const taken = rows.some(x => x.day === d.day)
              return (
                <button key={d.day} style={taken ? s.chipOn : s.chip} disabled={taken} onClick={() => take(d)}>
                  {d.day.slice(5)} {d.name}{taken ? ' ✓' : ''}
                </button>
              )
            })}
          </div>
          <div style={s.muted}>{t('눌러서 아래 표에 넣습니다. 넣은 뒤 저장해야 반영됩니다.')}</div>
        </div>
      )}

      <div style={s.head}>
        <span style={s.cDay}>{t('날짜')}</span>
        <span style={s.cWd}>{t('요일')}</span>
        <span style={s.cName}>{t('이름')}</span>
        <span style={s.cMemo}>{t('비고')}</span>
        <span style={s.cAct} />
      </div>

      {sorted.length === 0 && <div style={s.empty}>{t('이 해에는 등록된 공휴일이 없습니다. 주말만 빼고 계산됩니다.')}</div>}

      {sorted.map(r => (
        <div key={r.day} style={s.row}>
          <input style={{ ...s.input, ...s.cDay }} type="date" value={r.day}
            onChange={e => setRows(x => x.map(v => (v.day === r.day ? { ...v, day: e.target.value } : v)))} />
          <span style={{ ...s.cWd, ...(weekday(r.day) === '일' || weekday(r.day) === '토' ? s.weekend : null) }}>
            {t(weekday(r.day))}
          </span>
          <input style={{ ...s.input, ...s.cName }} value={r.name} maxLength={60} placeholder={t('예) 설날')}
            onChange={e => setRows(x => x.map(v => (v.day === r.day ? { ...v, name: e.target.value } : v)))} />
          <input style={{ ...s.input, ...s.cMemo }} value={r.memo ?? ''} maxLength={200} placeholder={t('선택')}
            onChange={e => setRows(x => x.map(v => (v.day === r.day ? { ...v, memo: e.target.value } : v)))} />
          <span style={s.cAct}>
            <button style={s.del} onClick={() => setRows(x => x.filter(v => v.day !== r.day))}>{t('빼기')}</button>
          </span>
        </div>
      ))}

      {err && <div style={s.err}>{err}</div>}
      {msg && <div style={s.ok}>{msg}</div>}

      {off.length > 0 && (
        <div style={s.offBox}>
          <div style={s.muted}>{tf('쉬지 않는 날로 정한 것 {0}일 — 지워지지 않고 남아 있습니다', off.length)}</div>
          {off.map(o => <div key={o.day} style={s.offRow}>{o.day} · {o.name}</div>)}
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
  draft: {
    border: 'var(--hairline)', borderRadius: 'var(--r-sm)', padding: 'var(--sp-2)',
    display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--card)',
  },
  draftHead: { display: 'flex', gap: 'var(--sp-2)', alignItems: 'baseline', flexWrap: 'wrap' },
  warn: { color: 'var(--warn)', fontSize: 'var(--fs-caption)' },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 4 },
  chip: {
    fontFamily: 'inherit', fontSize: 'var(--fs-caption)', padding: '2px 8px',
    border: 'var(--hairline)', borderRadius: 999, background: '#fff', cursor: 'pointer',
  },
  get chipOn() {
    return { ...this['chip'], background: 'var(--lime-bg)', borderColor: 'var(--lime)', cursor: 'default' } as React.CSSProperties
  },
  head: {
    display: 'flex', gap: 'var(--sp-2)', padding: '0 var(--sp-1)',
    fontSize: 'var(--fs-caption)', color: 'var(--muted)',
  },
  row: { display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' },
  cDay: { width: 140, flex: 'none' },
  cWd: { width: 28, flex: 'none', textAlign: 'center', fontSize: 'var(--fs-caption)' },
  weekend: { color: 'var(--muted)' },
  cName: { width: 200, flex: 'none' },
  cMemo: { flex: 1, minWidth: 0 },
  cAct: { width: 60, flex: 'none', textAlign: 'right' },
  input: {
    fontFamily: 'inherit', fontSize: 'var(--fs-label)', padding: '4px 8px',
    border: 'var(--hairline)', borderRadius: 'var(--r-sm)',
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
