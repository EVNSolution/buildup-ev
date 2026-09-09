import { useEffect, useState } from 'react'
import { fetchMakerPrices, saveMakerPrice, type MakerPriceRowApi } from '../api/quotes'
import { fetchMakerOrgs } from '../api/orders'
import type { Org } from '@shared/types/index'
import { t, tf } from '../i18n'

/**
 * **특장사 공급단가** — 우리가 특장사에 지급하는 값. 고객 견적가와 다른 축이다.
 *
 * 근거는 특장사별 기본거래계약서 [별첨1] 단가표다. 계약이 정한 값이라 발주서에서는
 * 고칠 수 없고, 고치는 자리는 **여기 하나**다.
 *
 * ⚠️ **행을 만들거나 지우지 않는다.** 옵션마다 행이 하나씩 미리 있고, 여기서는 값만 고친다.
 *    아무 코드로나 행을 만들 수 있으면 어느 선택에도 걸리지 않는 유령 줄이 쌓이고,
 *    「이 옵션은 누가 하기로 했더라」를 표에서 답할 수 없게 된다.
 *
 * 분류가 셋인 이유:
 *   · **특장사** — 발주서에 실린다. 단가가 있으면 자동 기입, 없으면 배정 때 금액만 적는다.
 *   · **EV& 직접** — 인도받아 우리가 한다. 실리지 않는다(안 시킨 일의 대금을 청구받지 않는다).
 *   · **해당 없음** — 「없음」처럼 아무 일도 아닌 값, 기본형에 포함된 사양.
 *     EV& 직접과 결과는 같지만 **뜻이 다르다** — 나중에 「이거 누가 하기로 했더라」를 여기서 답한다.
 */
export function MakerPriceTab() {
  const [orgs, setOrgs] = useState<Org[]>([])
  const [orgId, setOrgId] = useState('')
  const [rows, setRows] = useState<MakerPriceRowApi[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [savedId, setSavedId] = useState<number | null>(null)

  useEffect(() => {
    fetchMakerOrgs()
      .then(list => { setOrgs(list); if (list[0]) setOrgId(list[0].code) })
      .catch(e => setErr(e instanceof Error ? e.message : t('특장사 목록을 불러오지 못했습니다')))
  }, [])

  useEffect(() => {
    if (!orgId) return
    let alive = true
    setLoading(true); setErr('')
    fetchMakerPrices(orgId)
      .then(r => { if (alive) setRows(r) })
      .catch(e => { if (alive) setErr(e instanceof Error ? e.message : t('단가표를 불러오지 못했습니다')) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [orgId])

  /*
   * 고친 값은 **그 자리에서** 저장한다. 「저장」 버튼을 따로 두면 고쳐 놓고 안 누른 채
   * 화면을 떠나는 일이 생기고, 그러면 발주서에 옛 단가가 나간다.
   */
  async function patch(id: number, p: Parameters<typeof saveMakerPrice>[1]) {
    setRows(prev => prev.map(r => (r.id === id ? { ...r, ...p } as MakerPriceRowApi : r)))
    try {
      await saveMakerPrice(id, p)
      setSavedId(id)
      setTimeout(() => setSavedId(cur => (cur === id ? null : cur)), 1500)
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('단가를 고치지 못했습니다'))
      // 서버가 거절했으면 화면도 되돌린다 — 안 그러면 저장된 줄 안다
      if (orgId) fetchMakerPrices(orgId).then(setRows).catch(() => {})
    }
  }

  const needPrice = rows.filter(r => r.work_by === 'MAKER' && r.unit_price == null && r.active)

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <label style={s.field}>
          <span style={s.fieldLabel}>{t('특장사')}</span>
          <select style={s.select} value={orgId} onChange={e => setOrgId(e.target.value)}>
            {orgs.map(o => <option key={o.code} value={o.code}>{o.name}</option>)}
          </select>
        </label>
        <p style={s.desc}>
          {t('우리가 특장사에 지급하는 단가입니다. 고객 견적가와 다릅니다.')}
        </p>
      </div>

      {err && <div style={s.err}>{err}</div>}
      {loading && <div style={s.muted}>{t('불러오는 중…')}</div>}

      {/*
        단가가 빈 항목을 먼저 말한다 — 표가 길어 어느 줄이 비었는지 찾다 놓친다.
        빈 채로 두는 것 자체는 막지 않는다(계약에 없으면 발주서에서 그때 적는다).
      */}
      {needPrice.length > 0 && (
        <div style={s.note}>
          {tf('계약 단가가 없는 항목 {0}개는 배정할 때마다 금액을 적어야 합니다: {1}',
            needPrice.length, needPrice.map(r => r.label).join(' · '))}
        </div>
      )}

      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>{t('옵션')}</th>
              <th style={s.th}>{t('품목명')}</th>
              <th style={s.thMid}>{t('탑크기')}</th>
              <th style={s.thMid}>{t('분류')}</th>
              <th style={s.thMid}>{t('단위')}</th>
              <th style={s.thNum}>{t('수량')}</th>
              <th style={s.thNum}>{t('단가')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const maker = r.work_by === 'MAKER'
              return (
                <tr key={r.id} style={savedId === r.id ? s.trSaved : undefined}>
                  <td style={s.td}>
                    <div style={s.optName}>{r.option_name ?? r.value_code}</div>
                    <div style={s.optGroup}>{r.group_name ?? r.group_code}</div>
                  </td>
                  <td style={s.td}>
                    <input
                      style={s.input} value={r.label} maxLength={120}
                      onChange={e => setRows(prev => prev.map(x => x.id === r.id ? { ...x, label: e.target.value } : x))}
                      onBlur={e => patch(r.id, { label: e.target.value })}
                    />
                  </td>
                  <td style={s.tdMid}>{r.top_code ? (r.top_code === 'TOP_LOW' ? t('저상') : t('표준')) : t('공통')}</td>
                  <td style={s.tdMid}>
                    <select style={s.select} value={r.work_by} onChange={e => patch(r.id, { work_by: e.target.value })}>
                      <option value="MAKER">{t('특장사')}</option>
                      <option value="EVN">{t('EV& 직접')}</option>
                      <option value="NONE">{t('해당 없음')}</option>
                    </select>
                  </td>
                  <td style={s.tdMid}>
                    <input
                      style={{ ...s.input, width: 56 }} value={r.unit} maxLength={10} disabled={!maker}
                      onChange={e => setRows(prev => prev.map(x => x.id === r.id ? { ...x, unit: e.target.value } : x))}
                      onBlur={e => patch(r.id, { unit: e.target.value })}
                    />
                  </td>
                  <td style={s.tdNum}>
                    <input
                      style={{ ...s.input, width: 56, textAlign: 'right' }} type="number" min={1}
                      value={r.qty} disabled={!maker}
                      onChange={e => setRows(prev => prev.map(x => x.id === r.id ? { ...x, qty: Math.max(1, Math.trunc(Number(e.target.value) || 1)) } : x))}
                      onBlur={e => patch(r.id, { qty: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })}
                    />
                  </td>
                  <td style={s.tdNum}>
                    {/*
                      비울 수 있다 — 계약에 값이 없다는 뜻이다.
                      0 으로 채워 두면 「무상으로 해 주기로 했다」가 되어 특장사에게 그대로 나간다.
                    */}
                    <input
                      style={{ ...s.input, width: 110, textAlign: 'right' }}
                      type="number" min={0} disabled={!maker}
                      value={r.unit_price ?? ''}
                      placeholder={maker ? t('계약 미책정') : ''}
                      onChange={e => setRows(prev => prev.map(x => x.id === r.id
                        ? { ...x, unit_price: e.target.value === '' ? null : Math.max(0, Math.trunc(Number(e.target.value) || 0)) } : x))}
                      onBlur={e => patch(r.id, { unit_price: e.target.value === '' ? null : Math.max(0, Math.trunc(Number(e.target.value) || 0)) })}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p style={s.foot}>
        {t('항목은 옵션에 맞춰 미리 만들어져 있습니다. 여기서는 값만 고칩니다.')}
      </p>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', minWidth: 0 },
  head: { display: 'flex', alignItems: 'center', gap: 'var(--sp-4)', flexWrap: 'wrap' },
  field: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' },
  fieldLabel: { fontSize: 'var(--fs-label)', color: 'var(--muted)', flexShrink: 0 },
  desc: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', margin: 0 },
  /*
   * 고르는 칸은 **글자가 다 보여야** 한다. 좁으면 「특장사」가 「사」로 잘려
   * 무엇이 골라져 있는지 알 수 없다(실측 — 표를 좁은 화면에서 밀어 봤다).
   */
  select: {
    font: 'inherit', fontSize: 'var(--fs-label)', padding: '4px 6px',
    border: 'var(--hairline)', borderRadius: 4, background: '#fff',
    minWidth: 96,
  },
  input: {
    width: '100%', minWidth: 0, boxSizing: 'border-box', font: 'inherit',
    fontSize: 'var(--fs-label)', padding: '4px 6px',
    border: 'var(--hairline)', borderRadius: 4,
  },
  err: { fontSize: 'var(--fs-caption)', color: 'var(--req)' },
  muted: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  note: {
    fontSize: 'var(--fs-caption)', color: 'var(--body)', lineHeight: 1.6,
    border: 'var(--hairline)', borderRadius: 6, padding: 'var(--sp-3)',
  },
  // 표가 넓다 — 화면을 밀지 않고 **표 안에서** 가로로 넘긴다
  tableWrap: { overflowX: 'auto', minWidth: 0 },
  // 칸이 눌리지 않는 폭 — 좁은 화면에서는 표 안에서 가로로 넘긴다
  table: { borderCollapse: 'collapse', fontSize: 'var(--fs-label)', minWidth: 900 },
  th: { border: 'var(--hairline)', padding: '5px 7px', textAlign: 'left', fontWeight: 700, whiteSpace: 'nowrap' },
  thMid: { border: 'var(--hairline)', padding: '5px 7px', textAlign: 'center', fontWeight: 700, whiteSpace: 'nowrap' },
  thNum: { border: 'var(--hairline)', padding: '5px 7px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' },
  td: { border: 'var(--hairline)', padding: '4px 7px' },
  tdMid: { border: 'var(--hairline)', padding: '4px 7px', textAlign: 'center', whiteSpace: 'nowrap' },
  tdNum: { border: 'var(--hairline)', padding: '4px 7px', textAlign: 'right' },
  /* 저장된 줄을 잠깐 표시 — 그 자리에서 저장되므로 「됐나」를 묻지 않게 한다 */
  trSaved: { background: 'var(--surface-2, #f3f8f3)' },
  optName: { fontWeight: 600, color: 'var(--dark)' },
  optGroup: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  foot: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', margin: 0 },
}
