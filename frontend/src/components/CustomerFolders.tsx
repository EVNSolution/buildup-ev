import { useEffect, useMemo, useState } from 'react'
import {
  fetchFolders, fetchFolder, folderFileUrl,
  type ApiFolderRow, type ApiFolder, type ApiFolderQuote, type ApiFolderDoc,
} from '../api/customerFolders'
import { DocLink } from './DocLink'

/**
 * **고객 서류함** — 한 고객에게 만들어 준 견적서·계약서를 견적별로 모아 본다.
 *
 * 파일 이름만 늘어놓으면 「26-9087 견적서」가 셋 있을 때 무엇이 다른지 알 수 없다.
 * 그래서 **견적 단위로 묶고, 각 건에 고른 사양을 함께 적는다** — 고객과 통화하며
 * 「그 냉동 저상 건」을 짚을 수 있어야 한다.
 *
 * ⚠️ **팝업도 화면 전환도 없다.** 고객을 누르면 그 자리에서 아래로 펼쳐진다.
 *    서류를 확인하는 일은 목록을 훑는 일과 이어져 있어, 화면이 바뀌면 돌아올 때
 *    어디를 보고 있었는지 잃는다.
 */
const STATUS_KO: Record<string, string> = {
  draft: '임시저장', confirmed: '견적완료', contracted: '계약완료',
  assigned: '배정완료', ordered: '주문진행', completed: '완료', expired: '만료',
}

export function CustomerFolders({ mine }: {
  /**
   * 영업 화면에서 참으로 준다 — 겸직(영업+관리자) 계정이라도 남의 고객은 안 본다.
   */
  mine?: boolean
} = {}) {
  const [rows, setRows] = useState<ApiFolderRow[] | null>(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  /** 펼쳐 둔 고객 — 하나만 연다. 여럿 열면 화면이 길어져 훑는 뜻이 사라진다 */
  const [openKey, setOpenKey] = useState<number | null>(null)

  useEffect(() => {
    fetchFolders(mine)
      .then(setRows)
      .catch(e => setErr(e instanceof Error ? e.message : '서류함을 불러오지 못했습니다'))
  }, [mine])

  // 사람들이 실제로 기억하는 것들 — 이름·연락처·생년월일(사업자번호)
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase()
    if (!k || !rows) return rows ?? []
    return rows.filter(r =>
      [r.name, r.phone, r.reg_no].some(v => (v ?? '').toLowerCase().includes(k)))
  }, [rows, q])

  if (err) return <div style={s.err}>{err}</div>
  if (!rows) return <div style={s.muted}>불러오는 중입니다.</div>

  return (
    <div>
      <div style={s.searchRow}>
        <input
          style={s.search}
          type="search"
          placeholder="고객명 · 연락처 · 생년월일/사업자번호로 찾기"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <span style={s.count}>{shown.length}명</span>
      </div>

      {shown.length === 0 && <div style={s.muted}>해당하는 고객이 없습니다.</div>}

      <div style={s.list}>
        {shown.map(r => {
          const open = openKey === r.key
          return (
            <div key={r.key} style={open ? s.itemOpen : s.item}>
              <button
                style={s.card}
                aria-expanded={open}
                onClick={() => setOpenKey(open ? null : r.key)}
              >
                <span style={open ? s.caretOpen : s.caret}>▸</span>
                <span style={s.cardMain}>
                  <span style={s.cardName}>
                    {r.name}
                    {r.merged > 1 && <span style={s.mergedTag}> · {r.merged}건 합침</span>}
                  </span>
                  <span style={s.cardSub}>
                    {r.reg_no ?? r.phone ?? '연락처 없음'} · 견적 {r.quotes}건
                  </span>
                </span>
                <span style={s.cardAt}>{fmtWhen(r.last_activity)}</span>
              </button>
              {open && <FolderBody folderKey={r.key} mine={mine} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function FolderBody({ folderKey, mine }: { folderKey: number; mine?: boolean }) {
  const [res, setRes] = useState<ApiFolder | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    setRes(null); setErr('')
    fetchFolder(folderKey, mine)
      .then(setRes)
      .catch(e => setErr(e instanceof Error ? e.message : '서류를 불러오지 못했습니다'))
  }, [folderKey, mine])

  if (err) return <div style={s.body}><div style={s.err}>{err}</div></div>
  if (!res) return <div style={s.body}><div style={s.muted}>불러오는 중입니다.</div></div>

  /*
   * **최종본**을 맨 위에 고정한다 — 서류가 굳은(서명 요청까지 간) 건 중 가장 최근.
   * 그런 건이 없으면 가장 최근 견적을 올린다. 「실제로 고객에게 나간 판이 무엇인가」가
   * 먼저 읽혀야, 아래 이력을 훑을 때 기준이 생긴다.
   */
  const frozen = res.quotes.filter(x => x.frozenAt)
  const top = frozen[0] ?? res.quotes[0] ?? null
  const rest = res.quotes.filter(x => x !== top)

  return (
    <div style={s.body}>
      {res.quotes.length === 0 && <div style={s.muted}>아직 만들어진 견적이 없습니다.</div>}

      {top && (
        <section style={s.topBox}>
          <div style={s.topTag}>{top.frozenAt ? '최종본 · 서명 요청 시점' : '최근 견적'}</div>
          <QuoteCard q={top} folderKey={folderKey} mine={mine} />
        </section>
      )}

      {rest.length > 0 && (
        <section style={s.histBox}>
          <div style={s.histTitle}>이전 견적 {rest.length}건</div>
          <div style={s.histList}>
            {rest.map(x => <QuoteCard key={x.id} q={x} folderKey={folderKey} mine={mine} />)}
          </div>
        </section>
      )}

      {res.orphanDocs.length > 0 && (
        <section style={s.histBox}>
          {/* 견적번호로 이을 수 없는 서류 — 버리지 않고 여기 모은다 */}
          <div style={s.histTitle}>견적에 묶이지 않은 서류</div>
          <div style={s.docs}>
            {withVersions(res.orphanDocs).map(({ d, ver, total }, i) => (
              <DocRow key={`${d.id}-${i}`} d={d} ver={ver} total={total} folderKey={folderKey} mine={mine} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function QuoteCard({ q, folderKey, mine }: { q: ApiFolderQuote; folderKey: number; mine?: boolean }) {
  return (
    <div style={s.quote}>
      <div style={s.qHead}>
        <span style={s.qNo}>{q.quoteNo ?? `#${q.id}`}</span>
        <span style={s.qStatus}>{STATUS_KO[q.status] ?? q.status}</span>
        <span style={s.spacer} />
        {q.finalPrice != null && <span style={s.qPrice}>{fmtPrice(q.finalPrice)}</span>}
        <span style={s.qDate}>{q.createdAt.slice(0, 10)}</span>
      </div>

      {/* 고른 사양 — 이게 있어야 「어느 건인지」 알아본다 */}
      {q.options.length > 0 && (
        <div style={s.chips}>
          {q.options.map(o => <span key={o.group} style={s.chip}>{o.label}</span>)}
        </div>
      )}

      {q.docs.length > 0
        ? <div style={s.docs}>
            {withVersions(q.docs).map(({ d, ver, total }, i) => (
              <DocRow key={`${d.id}-${i}`} d={d} ver={ver} total={total} folderKey={folderKey} mine={mine} />
            ))}
          </div>
        : <div style={s.noDocs}>아직 만들어진 서류가 없습니다.</div>}
    </div>
  )
}


/**
 * 한 견적 안에서 **같은 종류가 여러 판**일 때 번호를 붙인다.
 *
 * 저장할 때마다 그 시점 견적서가 쌓이므로 「견적서」가 여러 줄이 된다.
 * 날짜만으로는 몇 번째 판인지 세어야 알 수 있어서, 오래된 것부터 1판으로 센다.
 * 한 판뿐이면 번호를 붙이지 않는다 — 없는 구분을 만들 필요가 없다.
 */
function withVersions(docs: ApiFolderDoc[]): { d: ApiFolderDoc; ver: number; total: number }[] {
  const total = new Map<string, number>()
  for (const d of docs) total.set(d.kind, (total.get(d.kind) ?? 0) + 1)
  // 목록은 최신이 위 — 번호는 오래된 쪽이 1이라 뒤에서부터 센다
  const seen = new Map<string, number>()
  return [...docs].reverse().map(d => {
    const n = (seen.get(d.kind) ?? 0) + 1
    seen.set(d.kind, n)
    return { d, ver: n, total: total.get(d.kind) ?? 1 }
  }).reverse()
}

function DocRow({ d, ver, total, folderKey, mine }: { d: ApiFolderDoc; ver: number; total: number; folderKey: number; mine?: boolean }) {
  return (
    <div style={s.doc}>
      <span style={d.pinned ? s.docKindOn : s.docKind}>
        {d.kind}
        {/* 판이 하나뿐이면 번호를 붙이지 않는다 — 없는 구분을 만들 필요가 없다 */}
        {total > 1 && <span style={s.ver}> · {ver}판</span>}
      </span>
      <span style={s.docMeta}>{fmtWhen(d.at)}</span>
      <span style={s.spacer} />
      <DocLink
        href={folderFileUrl(folderKey, d.id, false, mine)}
        name={`${d.kind}${d.quoteNo ? `_${d.quoteNo}` : ''}.pdf`}
        style={s.link}
      >열기</DocLink>
      {/* 확인과 챙김은 다른 행동이라 따로 둔다 */}
      <a href={folderFileUrl(folderKey, d.id, true, mine)} style={s.link}>받기</a>
    </div>
  )
}

/** 「오늘 14:20」처럼 — 날짜만 적으면 오늘 것도 어제 것도 똑같아 보인다. */
function fmtWhen(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return sameDay ? `오늘 ${hhmm}` : `${iso.slice(0, 10)} ${hhmm}`
}

const fmtPrice = (n: number) => `₩${n.toLocaleString('ko-KR')}`

const s: Record<string, React.CSSProperties> = {
  searchRow: { display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', marginBottom: 'var(--sp-3)' },
  search: {
    flex: 1, minWidth: 0, padding: '9px 12px', border: 'var(--hairline)', borderRadius: 8,
    fontSize: 'var(--fs-label)', color: 'var(--dark)', background: 'var(--bg)', minHeight: 40,
  },
  count: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', whiteSpace: 'nowrap' },

  list: { display: 'flex', flexDirection: 'column', gap: 6 },
  item: { border: 'var(--hairline)', borderRadius: 10, background: 'var(--bg)' },
  // 펼친 고객은 테두리를 진하게 — 어디를 열어 두었는지 스크롤 중에도 잃지 않는다
  itemOpen: { border: '1px solid var(--dark)', borderRadius: 10, background: 'var(--bg)' },
  card: {
    display: 'flex', alignItems: 'center', gap: 'var(--sp-3)',
    width: '100%', padding: '11px 14px', border: 'none', borderRadius: 10,
    background: 'transparent', cursor: 'pointer', textAlign: 'left', minHeight: 44, flexWrap: 'wrap',
  },
  caret: { color: 'var(--muted)', fontSize: 11, flexShrink: 0, transition: 'transform 120ms ease' },
  caretOpen: { color: 'var(--dark)', fontSize: 11, flexShrink: 0, transform: 'rotate(90deg)' },
  cardMain: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 },
  cardName: { fontSize: 'var(--fs-label)', fontWeight: 700, color: 'var(--dark)' },
  cardSub: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  cardAt: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', whiteSpace: 'nowrap', flexShrink: 0 },
  mergedTag: { fontSize: 'var(--fs-caption)', fontWeight: 400, color: 'var(--muted)' },

  body: {
    padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)',
  },
  topBox: {
    border: 'var(--hairline)', borderLeft: '3px solid var(--lime)', borderRadius: 8,
    background: 'var(--card)', padding: 'var(--sp-3)',
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  topTag: { fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--dark)' },
  histBox: { display: 'flex', flexDirection: 'column', gap: 6 },
  histTitle: { fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--muted)' },
  histList: { display: 'flex', flexDirection: 'column', gap: 6 },

  quote: {
    display: 'flex', flexDirection: 'column', gap: 6,
    padding: 'var(--sp-2) 0', borderTop: 'var(--hairline)',
  },
  qHead: { display: 'flex', alignItems: 'baseline', gap: 'var(--sp-2)', flexWrap: 'wrap' },
  qNo: { fontSize: 'var(--fs-label)', fontWeight: 700, color: 'var(--dark)', fontVariantNumeric: 'tabular-nums' },
  qStatus: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  qPrice: { fontSize: 'var(--fs-caption)', color: 'var(--dark)', fontVariantNumeric: 'tabular-nums' },
  qDate: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' },

  chips: { display: 'flex', flexWrap: 'wrap', gap: 4 },
  chip: {
    fontSize: 'var(--fs-caption)', color: 'var(--dark)', background: 'var(--lime-bg)',
    borderRadius: 999, padding: '1px 9px',
  },

  docs: { display: 'flex', flexDirection: 'column' },
  noDocs: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  doc: {
    display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap',
    padding: '5px 0',
  },
  docKind: { fontSize: 'var(--fs-caption)', color: 'var(--dark)' },
  docKindOn: { fontSize: 'var(--fs-caption)', color: 'var(--dark)', fontWeight: 700 },
  docMeta: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  ver: { color: 'var(--muted)', fontWeight: 400 },
  spacer: { flex: 1 },
  link: { fontSize: 'var(--fs-caption)', color: 'var(--dark)', textDecoration: 'underline', whiteSpace: 'nowrap' },

  muted: { fontSize: 'var(--fs-label)', color: 'var(--muted)', padding: 'var(--sp-3) 0' },
  err: { fontSize: 'var(--fs-label)', color: 'var(--warn)', padding: 'var(--sp-2) 0' },
}
