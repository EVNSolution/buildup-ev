import { useEffect, useMemo, useState } from 'react'
import {
  fetchFolders, fetchFolder, folderFileUrl,
  type ApiFolderRow, type ApiFolder,
} from '../api/customerFolders'
import { fmtBytes } from '../lib/imageResize'
import { BTN } from '../styles/buttons'
import { DocLink } from './DocLink'

/**
 * **고객 서류함** — 한 고객에게 지금까지 만들어 준 견적서·계약서를 한자리에서 본다.
 *
 * 견적 목록은 **건별·날짜순**이라, 같은 고객이 견적을 세 번 고치면 세 줄로 흩어진다.
 * 「이 사람한테 뭘 보냈더라」를 보려면 줄마다 열어 봐야 했다. 여기서는 고객 하나에
 * 폴더 하나고, **최근에 손댄 고객이 위**에 온다 — 그게 가장 잦은 질문이다.
 *
 * 폴더를 열면:
 *   · **서명 요청본이 맨 위에 고정된다** — 고객이 실제로 받아 서명한 정본이라,
 *     아래 이력에 섞이면 어느 것이 진짜인지 알 수 없다
 *   · 그 아래로 시간 역순. **내용이 같은 판은 한 줄만** 보인다(견적서는 열 때마다
 *     다시 만들어지므로, 그대로 늘어놓으면 무엇이 달라졌는지 읽을 수 없다)
 */
export function CustomerFolders({ mine }: {
  /**
   * 영업 화면에서 참으로 준다 — **겸직(영업+관리자) 계정이라도 남의 고객은 안 본다.**
   * 관리자 화면에서 전체를 보는 것과, 영업으로 일하는 화면에 남의 담당이 섞이는 것은 다른 일이다.
   */
  mine?: boolean
} = {}) {
  const [rows, setRows] = useState<ApiFolderRow[] | null>(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
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

  if (openKey !== null) {
    return <FolderView folderKey={openKey} mine={mine} onBack={() => setOpenKey(null)} />
  }

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
        {shown.map(r => (
          <button key={r.key} style={s.card} onClick={() => setOpenKey(r.key)}>
            <span style={s.cardMain}>
              <span style={s.cardName}>
                {r.name}
                {/* 같은 사람인데 고객 행이 여럿이면 알려 준다 — 합쳐서 보여 주고 있다는 뜻 */}
                {r.merged > 1 && <span style={s.mergedTag}> · {r.merged}건 합침</span>}
              </span>
              <span style={s.cardSub}>
                {r.reg_no ?? r.phone ?? '연락처 없음'} · 견적 {r.quotes}건
              </span>
            </span>
            <span style={s.cardAt}>{fmtWhen(r.last_activity)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function FolderView({ folderKey, mine, onBack }: { folderKey: number; mine?: boolean; onBack: () => void }) {
  const [res, setRes] = useState<ApiFolder | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    setRes(null)
    fetchFolder(folderKey, mine)
      .then(setRes)
      .catch(e => setErr(e instanceof Error ? e.message : '서류를 불러오지 못했습니다'))
  }, [folderKey, mine])

  if (err) return <><button style={s.back} onClick={onBack}>← 서류함</button><div style={s.err}>{err}</div></>
  if (!res) return <><button style={s.back} onClick={onBack}>← 서류함</button><div style={s.muted}>불러오는 중입니다.</div></>

  const pinned = res.data.filter(d => d.pinned)
  const rest = res.data.filter(d => !d.pinned)

  return (
    <div>
      <button style={s.back} onClick={onBack}>← 서류함</button>

      <div style={s.head}>
        <span style={s.headName}>{res.customer.name}</span>
        <span style={s.headSub}>
          {res.customer.reg_no ?? res.customer.phone ?? '연락처 없음'}
          {res.customer.merged > 1 ? ` · 고객 ${res.customer.merged}건 합쳐 봄` : ''}
        </span>
      </div>

      {res.data.length === 0 && <div style={s.muted}>아직 만들어진 서류가 없습니다.</div>}

      {/*
        서명 요청본 — 고객이 실제로 받아 본 정본이다. 아래 이력에 섞이면 어느 것이
        진짜인지 알 수 없어, 따로 떼어 맨 위에 둔다.
      */}
      {pinned.length > 0 && (
        <section style={s.pinBox}>
          <div style={s.pinTitle}>서명 요청 시점 정본</div>
          {pinned.map(d => <DocRow key={d.id} d={d} folderKey={folderKey} mine={mine} strong />)}
        </section>
      )}

      {rest.length > 0 && (
        <section>
          <div style={s.histTitle}>이전 내역 <span style={s.histHint}>· 내용이 바뀐 판만</span></div>
          {rest.map(d => <DocRow key={d.id} d={d} folderKey={folderKey} mine={mine} />)}
        </section>
      )}
    </div>
  )
}

function DocRow({ d, folderKey, mine, strong }: { d: ApiFolder['data'][number]; folderKey: number; mine?: boolean; strong?: boolean }) {
  return (
    <div style={s.doc}>
      <span style={strong ? s.docKindOn : s.docKind}>{d.kind}</span>
      <span style={s.docMeta}>
        {d.quoteNo ? `${d.quoteNo} · ` : ''}{fmtWhen(d.at)} · {fmtBytes(d.size)}
      </span>
      <span style={s.spacer} />
      <DocLink href={folderFileUrl(folderKey, d.id, false, mine)} name={`${d.kind}${d.quoteNo ? `_${d.quoteNo}` : ''}.pdf`} style={s.link}>열기</DocLink>
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
  cardAt: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', whiteSpace: 'nowrap', flexShrink: 0 },
  mergedTag: { fontSize: 'var(--fs-caption)', fontWeight: 400, color: 'var(--muted)' },

  back: { ...BTN.row, marginBottom: 'var(--sp-3)' },
  head: { display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 'var(--sp-3)', borderBottom: 'var(--hairline)' },
  headName: { fontSize: 'var(--fs-title)', fontWeight: 700, color: 'var(--dark)' },
  headSub: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },

  pinBox: {
    border: 'var(--hairline)', borderRadius: 10, background: 'var(--card)',
    padding: 'var(--sp-3)', margin: 'var(--sp-3) 0',
  },
  pinTitle: { fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--dark)', marginBottom: 4 },
  histTitle: { fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--muted)', margin: 'var(--sp-4) 0 4px' },
  histHint: { fontWeight: 400 },

  doc: {
    display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap',
    padding: '8px 0', borderBottom: 'var(--hairline)',
  },
  docKind: { fontSize: 'var(--fs-label)', color: 'var(--dark)' },
  docKindOn: { fontSize: 'var(--fs-label)', color: 'var(--dark)', fontWeight: 700 },
  docMeta: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  spacer: { flex: 1 },
  link: { fontSize: 'var(--fs-caption)', color: 'var(--dark)', textDecoration: 'underline', whiteSpace: 'nowrap' },

  muted: { fontSize: 'var(--fs-label)', color: 'var(--muted)', padding: 'var(--sp-3) 0' },
  err: { fontSize: 'var(--fs-label)', color: 'var(--warn)', padding: 'var(--sp-2) 0' },
}
