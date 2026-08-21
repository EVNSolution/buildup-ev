import { useEffect, useMemo, useState } from 'react'
import { useScreenRefresh } from '../contexts/RefreshContext'
import {
  fetchFileIndex, fetchOrderFiles,
  type ApiFileIndexRow, type ApiOrderFile, type FileGroup,
} from '../api/orderFiles'
import { fmtBytes } from '../lib/imageResize'
import { BTN } from '../styles/buttons'
import { DocLink } from './DocLink'

/**
 * 관리자 「파일」 — **주문 하나에 딸린 것을 전부 한자리에서 본다.**
 *
 * 파일은 네 군데에 흩어져 있다(단계 증빙 · 자동생성 PDF · 매매계약 서명본 · 튜닝 서명본).
 * 「그 건 사진 좀 다 주세요」는 자주 오는 부탁인데, 그때마다 네 화면을 오가야 했다.
 *
 * **올린 파일과 만들어 낸 파일을 가른다** — 자동생성 PDF 는 언제든 다시 만들 수 있지만
 * 현장에서 찍은 사진은 그때가 아니면 다시 못 얻는다. 챙겨야 할 것은 후자다.
 */
const GROUP_LABEL: Record<FileGroup, string> = {
  upload: '업로드',
  generated: '자동생성',
  signed: '서명본',
}

type Filter = 'all' | FileGroup

export function OrderFilesTab() {
  const [rows, setRows] = useState<ApiFileIndexRow[] | null>(null)
  const [err, setErr] = useState('')
  const [picked, setPicked] = useState<ApiFileIndexRow | null>(null)
  const [q, setQ] = useState('')

  function load() {
    fetchFileIndex()
      .then(setRows)
      .catch(e => setErr(e instanceof Error ? e.message : '파일 목록을 불러오지 못했습니다'))
  }
  useEffect(load, [])   // eslint-disable-line react-hooks/exhaustive-deps
  useScreenRefresh(load)

  // 고객 이름·견적번호·특장사 — 사람들이 실제로 기억하고 있는 것들로 찾는다
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase()
    if (!k || !rows) return rows ?? []
    return rows.filter(r =>
      [r.quote_no, r.customer_name, r.maker_org, String(r.order_id)]
        .some(v => (v ?? '').toLowerCase().includes(k)))
  }, [rows, q])

  if (err) return <div style={s.err}>{err}</div>
  if (!rows) return <div style={s.muted}>불러오는 중입니다.</div>

  if (picked) return <OrderFilePanel row={picked} onBack={() => setPicked(null)} />

  return (
    <div>
      <div style={s.searchRow}>
        <input
          style={s.search}
          type="search"
          placeholder="고객명 · 견적번호 · 특장사로 찾기"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <span style={s.count}>{shown.length}건</span>
      </div>

      {shown.length === 0 && <div style={s.muted}>해당하는 주문이 없습니다.</div>}

      <div style={s.list}>
        {shown.map(r => (
          <button key={r.order_id} style={s.card} onClick={() => setPicked(r)}>
            <span style={s.cardMain}>
              <span style={s.cardName}>{r.customer_name ?? '고객 미지정'}</span>
              <span style={s.cardSub}>
                {r.quote_no ?? `주문 ${r.order_id}`}
                {r.maker_org ? ` · ${r.maker_org}` : ''}
              </span>
            </span>
            <span style={s.cardNums}>
              {/* 사진이 안 올라온 건을 눈으로 찾을 수 있게 — 0 도 숨기지 않는다 */}
              <span style={r.uploads > 0 ? s.pill : s.pillZero}>업로드 {r.uploads}</span>
              <span style={s.pillMuted}>자동생성 {r.generated}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function OrderFilePanel({ row, onBack }: { row: ApiFileIndexRow; onBack: () => void }) {
  const [files, setFiles] = useState<ApiOrderFile[] | null>(null)
  const [err, setErr] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    setFiles(null)
    fetchOrderFiles(row.order_id)
      .then(setFiles)
      .catch(e => setErr(e instanceof Error ? e.message : '파일을 불러오지 못했습니다'))
  }, [row.order_id])

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, upload: 0, generated: 0, signed: 0 }
    for (const f of files ?? []) { c.all++; c[f.group]++ }
    return c
  }, [files])

  const shown = (files ?? []).filter(f => filter === 'all' || f.group === filter)

  return (
    <div>
      <button style={s.back} onClick={onBack}>← 파일</button>

      <div style={s.head}>
        <span style={s.headName}>{row.customer_name ?? '고객 미지정'}</span>
        <span style={s.headSub}>
          {row.quote_no ?? `주문 ${row.order_id}`}
          {row.maker_org ? ` · ${row.maker_org}` : ''}
        </span>
      </div>

      {err && <div style={s.err}>{err}</div>}
      {!files && !err && <div style={s.muted}>불러오는 중입니다.</div>}

      {files && (
        <>
          <div style={s.filters}>
            {(['all', 'upload', 'generated', 'signed'] as Filter[]).map(k => (
              <button
                key={k}
                style={filter === k ? s.chipOn : s.chip}
                onClick={() => setFilter(k)}
              >{k === 'all' ? '전체' : GROUP_LABEL[k]} {counts[k]}</button>
            ))}
          </div>

          {shown.length === 0 && <div style={s.muted}>해당하는 파일이 없습니다.</div>}

          <div style={s.scroller}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>구분</th>
                  <th style={s.th}>내용</th>
                  <th style={s.th}>파일</th>
                  <th style={s.th}>크기</th>
                  <th style={s.th}>등록자</th>
                  <th style={s.th}>등록일</th>
                  <th style={s.th}></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((f, i) => (
                  <tr key={`${f.url}-${i}`}>
                    <td style={s.td}>
                      <span style={f.group === 'upload' ? s.tagUp : s.tagGen}>{GROUP_LABEL[f.group]}</span>
                    </td>
                    <td style={s.td}>{f.label}</td>
                    <td style={s.td}>
                      <DocLink href={f.url} name={f.name ?? `${f.label}.pdf`} style={s.link}>
                        {f.name || '열기'}
                      </DocLink>
                    </td>
                    <td style={s.tdNum}>{f.size ? fmtBytes(f.size) : '—'}</td>
                    <td style={s.tdMuted}>{f.by ?? '자동'}</td>
                    <td style={s.tdNum}>{f.at.slice(0, 10)}</td>
                    <td style={s.tdNum}>
                      {/*
                        내려받기는 **열기와 따로** 둔다. 사진은 눌러서 확인하는 일이 잦고,
                        관청·특장사에 넘길 때는 받아 두어야 한다 — 둘은 다른 행동이다.
                      */}
                      <a href={f.download_url} style={s.dl}>받기</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  searchRow: { display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', marginBottom: 'var(--sp-3)' },
  search: {
    flex: 1, minWidth: 0, padding: '9px 12px', border: 'var(--hairline)', borderRadius: 8,
    fontSize: 'var(--fs-label)', color: 'var(--dark)', background: 'var(--bg)', minHeight: 40,
  },
  count: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', whiteSpace: 'nowrap' },

  list: { display: 'flex', flexDirection: 'column', gap: 6 },
  card: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-3)',
    width: '100%', padding: '11px 14px', border: 'var(--hairline)', borderRadius: 10,
    background: 'var(--bg)', cursor: 'pointer', textAlign: 'left', minHeight: 44, flexWrap: 'wrap',
  },
  cardMain: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
  cardName: { fontSize: 'var(--fs-label)', fontWeight: 700, color: 'var(--dark)' },
  cardSub: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  cardNums: { display: 'flex', gap: 6, flexShrink: 0 },
  pill: { fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--dark)', background: 'var(--lime-bg)', borderRadius: 999, padding: '2px 9px' },
  pillZero: { fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--req)', borderRadius: 999, padding: '2px 9px', border: 'var(--hairline)' },
  pillMuted: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', borderRadius: 999, padding: '2px 9px', border: 'var(--hairline)' },

  back: { ...BTN.row, marginBottom: 'var(--sp-3)' },
  head: { display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 'var(--sp-3)', borderBottom: 'var(--hairline)' },
  headName: { fontSize: 'var(--fs-title)', fontWeight: 700, color: 'var(--dark)' },
  headSub: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },

  filters: { display: 'flex', gap: 6, flexWrap: 'wrap', margin: 'var(--sp-3) 0' },
  chip: {
    fontSize: 'var(--fs-caption)', color: 'var(--muted)', background: 'transparent',
    border: 'var(--hairline)', borderRadius: 999, padding: '5px 12px', cursor: 'pointer', minHeight: 32,
  },
  chipOn: {
    fontSize: 'var(--fs-caption)', color: 'var(--bg)', background: 'var(--dark)',
    border: '1px solid var(--dark)', borderRadius: 999, padding: '5px 12px', cursor: 'pointer',
    fontWeight: 700, minHeight: 32,
  },

  scroller: { overflowX: 'auto' },
  table: { width: '100%', minWidth: 640, borderCollapse: 'collapse', fontSize: 'var(--fs-caption)' },
  th: {
    textAlign: 'left', padding: '6px 10px 6px 0', color: 'var(--muted)',
    fontWeight: 500, borderBottom: 'var(--hairline)', whiteSpace: 'nowrap',
  },
  td: { padding: '7px 10px 7px 0', borderBottom: 'var(--hairline)', color: 'var(--dark)', verticalAlign: 'top' },
  tdMuted: { padding: '7px 10px 7px 0', borderBottom: 'var(--hairline)', color: 'var(--muted)', whiteSpace: 'nowrap' },
  tdNum: { padding: '7px 10px 7px 0', borderBottom: 'var(--hairline)', color: 'var(--muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  tagUp: { fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--dark)' },
  tagGen: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  link: { color: 'var(--dark)', textDecoration: 'underline', wordBreak: 'break-all' },
  dl: { color: 'var(--dark)', textDecoration: 'underline', whiteSpace: 'nowrap' },

  muted: { fontSize: 'var(--fs-label)', color: 'var(--muted)', padding: 'var(--sp-3) 0' },
  err: { fontSize: 'var(--fs-label)', color: 'var(--warn)', padding: 'var(--sp-2) 0' },
}
