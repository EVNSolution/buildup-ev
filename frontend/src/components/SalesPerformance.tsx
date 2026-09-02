import { useEffect, useState } from 'react'
import { useScreenRefresh } from '../contexts/RefreshContext'
import {
  fetchSalesStats, fetchAttention, FUNNEL,
  type SalesStat, type AttentionItem, type FunnelStage,
} from '../api/stats'
import { BTN } from '../styles/buttons'
import { useIsMobile } from '../hooks/useIsMobile'

/**
 * 영업 성과 — 영업의 「마이페이지」와 관리자의 「영업 성과」가 **같은 화면**을 쓴다.
 *
 * 다른 점은 범위뿐이다: 영업은 본인 것만(서버가 강제), 관리자는 전체·계정별.
 * 화면을 둘로 나누면 한쪽만 낡는다.
 *
 * 위에서부터 「지금 붙어야 할 건 → 깔때기 → 금액·속도」 순인 이유:
 * 성과 숫자를 보러 왔더라도 **오늘 할 일**이 먼저 눈에 들어와야 쓸모가 있다.
 */
const STAGE_KO: Record<FunnelStage, string> = {
  draft: '임시저장', confirmed: '견적완료', contracted: '계약완료',
  assigned: '배정완료', ordered: '주문진행', completed: '완료',
}

const KIND_KO: Record<AttentionItem['kind'], { label: string; why: string; tone: 'warn' | 'info' }> = {
  sign_pending:  { label: '서명 미완료', why: '서명 요청 후 미완료 상태입니다', tone: 'warn' },
  not_requested: { label: '서명 요청 필요', why: '견적서 생성 후 서명 요청 이력이 없습니다', tone: 'warn' },
  draft_stale:   { label: '견적서 미생성', why: '임시저장 상태로 견적서가 생성되지 않았습니다', tone: 'info' },
}

const won = (n: number) => '₩' + Math.round(n).toLocaleString('ko-KR')
/** 전환율 — 앞 단계가 0이면 비율이 없다(0%로 쓰면 '실패'로 읽힌다) */
const rate = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null)

interface Props {
  /** 관리자만 계정 필터를 쓴다. 영업은 서버가 본인으로 강제하므로 넘기지 않는다. */
  showUserFilter?: boolean
  /** 관리자 화면에서 고를 수 있는 영업 계정 목록 */
  userOptions?: string[]
}

export function SalesPerformance({ showUserFilter, userOptions = [] }: Props) {
  const isMobile = useIsMobile()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [user, setUser] = useState('')
  const [stats, setStats] = useState<SalesStat[] | null>(null)
  const [attention, setAttention] = useState<AttentionItem[] | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)

  function load() {
    setLoading(true); setErr('')
    Promise.all([
      fetchSalesStats({ from: from || undefined, to: to || undefined, salesUser: user || undefined }),
      fetchAttention(user || undefined),
    ])
      .then(([s, a]) => { setStats(s); setAttention(a) })
      .catch(e => setErr(e instanceof Error ? e.message : '조회 실패'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  useScreenRefresh(load)

  // 여러 계정을 합친 값 — 관리자가 전체를 볼 때 맨 위에 둔다
  const total = stats?.reduce((acc, s) => {
    FUNNEL.forEach(k => { acc.reached[k] += s.reached[k] })
    acc.amount.confirmed += s.amount.confirmed
    acc.amount.contracted += s.amount.contracted
    acc.amount.completed += s.amount.completed
    acc.activity.quotes += s.activity.quotes
    return acc
  }, {
    reached: { draft: 0, confirmed: 0, contracted: 0, assigned: 0, ordered: 0, completed: 0 } as Record<FunnelStage, number>,
    amount: { confirmed: 0, contracted: 0, completed: 0 },
    activity: { quotes: 0 },
  })

  return (
    <div>
      <div style={s.bar}>
        <input type="date" style={s.date} value={from} onChange={e => setFrom(e.target.value)} />
        <span style={s.sep}>~</span>
        <input type="date" style={s.date} value={to} onChange={e => setTo(e.target.value)} />
        {showUserFilter && (
          <select style={s.select} value={user} onChange={e => setUser(e.target.value)}>
            <option value="">전체</option>
            {userOptions.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        )}
        <button style={BTN.barPrimary} onClick={load}>조회</button>
        <span style={s.hint}>기준일: 견적 생성일</span>
      </div>

      {err && <div style={s.err}>{err}</div>}
      {loading && <div style={s.empty}>조회 중입니다…</div>}

      {!loading && attention && (
        <section style={s.section}>
          <div style={s.h}>
            처리 필요 견적 <span style={s.count}>{attention.length}</span>
          </div>
          {attention.length === 0 ? (
            <div style={s.ok}>처리가 필요한 견적이 없습니다.</div>
          ) : isMobile ? (
            /*
              휴대폰 — 표를 옆으로 밀어 보게 하지 않는다.
              여기가 「오늘 붙어야 할 건」이라 화면에 들어오는 것이 전부인데,
              5칸짜리 표는 390px 에서 절반이 화면 밖으로 나간다(실측 ~630px 필요).
              한 건을 세 줄로 편다 — 사유·경과일 / 사유설명 / 번호·고객·금액.
            */
            <div>
              {attention.map(a => (
                <div key={`${a.quote_id}-${a.kind}`} style={s.item}>
                  <div style={s.itemTop}>
                    <span style={KIND_KO[a.kind].tone === 'warn' ? s.tagWarn : s.tagInfo}>{KIND_KO[a.kind].label}</span>
                    <span style={s.itemDays}>{a.days}일</span>
                  </div>
                  <div style={s.why}>{KIND_KO[a.kind].why}</div>
                  <div style={s.itemBottom}>
                    <span style={s.itemNo}>{a.quote_no ?? `#${a.quote_id}`}</span>
                    <span style={s.itemCustomer}>{a.customer ?? '—'}</span>
                    <span style={s.itemPrice}>{a.final_price ? won(a.final_price) : '—'}</span>
                  </div>
                  {showUserFilter && <div style={s.itemOwner}>담당 {a.sales_user_id ?? '—'}</div>}
                </div>
              ))}
            </div>
          ) : (
            <div style={s.tableWrap}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>사유</th><th style={s.th}>경과일</th><th style={s.th}>견적번호</th>
                    <th style={s.th}>고객</th><th style={s.th}>실구매가(기타 포함)</th>
                    {showUserFilter && <th style={s.th}>담당</th>}
                  </tr>
                </thead>
                <tbody>
                  {attention.map(a => (
                    <tr key={`${a.quote_id}-${a.kind}`}>
                      <td style={s.td}>
                        <span style={KIND_KO[a.kind].tone === 'warn' ? s.tagWarn : s.tagInfo}>{KIND_KO[a.kind].label}</span>
                        <div style={s.why}>{KIND_KO[a.kind].why}</div>
                      </td>
                      <td style={{ ...s.td, fontWeight: 700 }}>{a.days}일</td>
                      <td style={s.td}>{a.quote_no ?? `#${a.quote_id}`}</td>
                      <td style={s.td}>{a.customer ?? '—'}</td>
                      <td style={s.tdNum}>{a.final_price ? won(a.final_price) : '—'}</td>
                      {showUserFilter && <td style={s.tdMuted}>{a.sales_user_id ?? '—'}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {!loading && stats && (
        <>
          {total && stats.length > 1 && (
            <section style={s.section}>
              <div style={s.h}>전체 집계</div>
              <Funnel reached={total.reached} />
              <div style={s.groups}>
                <MetricGroup title="금액">
                  <Metric label="견적완료" value={won(total.amount.confirmed)} />
                  <Metric label="계약완료" value={won(total.amount.contracted)} />
                  <Metric label="인도완료" value={won(total.amount.completed)} strong />
                </MetricGroup>
              </div>
            </section>
          )}

          {stats.length === 0 && <div style={s.empty}>해당 기간에 생성된 견적이 없습니다.</div>}

          {stats.map(st => (
            <section key={st.sales_user_id} style={s.section}>
              <div style={s.h}>{st.sales_user_id} <span style={s.count}>견적 {st.activity.quotes}건</span></div>
              <Funnel reached={st.reached} />

              <div style={s.groups}>
                <MetricGroup title="금액">
                  <Metric label="견적완료" value={won(st.amount.confirmed)} />
                  <Metric label="계약완료" value={won(st.amount.contracted)} />
                  <Metric label="인도완료" value={won(st.amount.completed)} strong />
                </MetricGroup>

                <MetricGroup title="활동">
                  <Metric label="메일 발송" value={`${st.activity.emailed}건`} />
                  <Metric label="서명 요청" value={`${st.activity.sign_requested}건`} />
                  <Metric
                    label="서명 완료율" value={signRate(st)}
                    note={`이메일 ${st.signing.email_done}/${st.signing.email_sent} · 알림톡 ${st.signing.kakao_done}/${st.signing.kakao_sent}`}
                  />
                  <Metric
                    label="견적당 수정"
                    value={st.edits_per_quote === null ? '—' : `${st.edits_per_quote}회`}
                    note="견적 1건당 평균"
                  />
                </MetricGroup>

                <MetricGroup title="소요">
                  <Lead label="견적완료" v={st.lead.to_confirmed} />
                  <Lead label="계약완료" v={st.lead.to_contracted} />
                  <Lead label="인도완료" v={st.lead.to_completed} />
                </MetricGroup>
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  )
}

function signRate(st: SalesStat): string {
  const sent = st.signing.email_sent + st.signing.kakao_sent
  const done = st.signing.email_done + st.signing.kakao_done
  return sent ? `${Math.round((done / sent) * 100)}%` : '—'
}

/** 깔때기 — 단계별 도달 수와 **앞 단계 대비** 전환율 */
function Funnel({ reached }: { reached: Record<FunnelStage, number> }) {
  return (
    <div style={s.funnel}>
      {FUNNEL.map((stage, i) => {
        const prev = i > 0 ? reached[FUNNEL[i - 1]!] : 0
        const r = i > 0 ? rate(reached[stage], prev) : null
        return (
          <div key={stage} style={s.stepWrap}>
            {i > 0 && (
              <div style={s.arrow}>
                <div style={s.arrowMark}>›</div>
                {/* funnel-rate — 아주 좁은 화면에서는 globals.css 가 이 줄을 감춘다(단계 이름이 먼저다) */}
                <div className="funnel-rate" style={r !== null && r < 50 ? s.rateLow : s.rate}>{r === null ? '—' : `${r}%`}</div>
              </div>
            )}
            <div style={s.step}>
              <div style={s.stepName}>{STAGE_KO[stage]}</div>
              <div style={s.stepNum}>{reached[stage]}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * 지표 한 줄 — **칸을 채우지 않는다.**
 *
 * 예전엔 지표마다 회색 카드였다. 열몇 개가 깔리면 화면이 덩어리로 가득 차
 * 어디를 봐야 할지 알 수 없었다(실제 제보: "정신없다").
 * 이제 라벨(좌) · 값(우) 한 줄이고, 줄 사이는 헤어라인 하나로만 나눈다.
 * 강조는 배경이 아니라 **글자 굵기**로 한다.
 */
function Metric({ label, value, note, strong }: { label: string; value: string; note?: string; strong?: boolean }) {
  return (
    <div style={s.metric}>
      <div style={s.metricHead}>
        <span style={s.metricLabel}>{label}</span>
        <span style={strong ? s.metricValStrong : s.metricVal}>{value}</span>
      </div>
      {note && <div style={s.metricNote}>{note}</div>}
    </div>
  )
}

/** 지표 묶음 — 성격이 같은 것끼리(금액·활동·소요) 모아 제목을 얹는다. */
function MetricGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={s.group}>
      <div style={s.groupTitle}>{title}</div>
      {children}
    </div>
  )
}

/** 소요일 — 표본 수를 함께 보여준다. 1건 평균과 20건 평균은 무게가 다르다. */
function Lead({ label, v }: { label: string; v: { days: number | null; n: number } }) {
  return (
    <Metric
      label={label}
      value={v.days === null ? '—' : `${v.days}일`}
      note={v.n ? `표본 ${v.n}건` : '산출 불가'}
    />
  )
}

const s: Record<string, React.CSSProperties> = {
  bar: { display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' },
  // 모양·높이는 globals.css 가 정한다 — 여기서는 **줄어드는 방식만** 정한다
  date: { flex: '0 1 auto', minWidth: 0 },
  // 계정 선택(관리자) — 늘어나지 않고, 좁아지면 다른 칸과 함께 줄어든다
  select: { flex: '0 1 220px', minWidth: 0, maxWidth: '100%' },
  sep: { color: 'var(--muted)' },
  hint: { fontSize: 12.5, color: 'var(--muted)' },
  section: { marginBottom: 26 },
  h: { fontSize: 15, fontWeight: 700, color: 'var(--dark)', marginBottom: 10, paddingBottom: 6, borderBottom: '0.5px solid var(--line)' },
  count: { fontSize: 13, fontWeight: 400, color: 'var(--muted)', marginLeft: 6 },
  empty: { padding: 20, color: 'var(--muted)', fontSize: 14 },
  ok: { padding: '12px 14px', background: 'var(--lime-bg)', border: '0.5px solid var(--lime)', color: 'var(--dark)', borderRadius: 8, fontSize: 14 },
  err: { padding: '10px 12px', background: 'var(--warnbg)', border: '0.5px solid var(--warn)', color: 'var(--warn)', borderRadius: 8, fontSize: 14, marginBottom: 12 },

  /*
   * 깔때기 — **한 줄을 지킨다**. 예전엔 칸 폭을 못 박고(84px) 남으면 접히게 두어,
   * 좁은 화면에서 「배정완료 › 주문진행 › 완료」가 둘째 줄로 내려갔다. 그러면 흐름이
   * 두 갈래처럼 보인다(실제 제보) — 순서대로 읽히는 것이 이 그림의 전부다.
   * 그래서 칸은 남는 폭을 나눠 갖고, 글자는 칸 폭(cqi)에 맞춰 스스로 줄어든다.
   */
  funnel: {
    display: 'flex', alignItems: 'stretch', flexWrap: 'nowrap', gap: 2, marginBottom: 12,
    width: '100%', containerType: 'inline-size' as const,
  },
  stepWrap: { display: 'flex', alignItems: 'stretch', flex: '1 1 0', minWidth: 0 },
  /*
   * 단계 칸 — **배경을 채우지 않는다.** 회색 상자 여섯 개가 늘어서면 흐름이 아니라
   * 덩어리로 읽힌다. 숫자와 이름만 두고, 사이의 화살표가 흐름을 만든다.
   */
  // 좌우 여백 없음 — 320px 에서는 4px 씩만 있어도 「견적완료」가 잘린다(실측). 사이는 gap 이 만든다
  step: { padding: 'var(--sp-2) 0', textAlign: 'center', flex: '1 1 0', minWidth: 0 },
  // 6칸이라 한 칸이 대략 컨테이너의 1/8~1/6 — 그 폭 안에서 네 글자가 접히지 않는 크기로 묶는다
  stepName: { fontSize: 'clamp(9px, 1.9cqi, 13px)', color: 'var(--muted)', whiteSpace: 'nowrap' as const },
  stepNum: { fontSize: 'clamp(13px, 3.1cqi, 20px)', fontWeight: 700, color: 'var(--dark)', marginTop: 2 },
  arrow: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: '0 2px', flexShrink: 0,
  },
  arrowMark: { fontSize: 'clamp(11px, 2.4cqi, 16px)', color: 'var(--muted)', lineHeight: 1 },
  rate: { fontSize: 'clamp(9px, 1.9cqi, 12.5px)', color: 'var(--muted)', fontWeight: 700, whiteSpace: 'nowrap' as const },
  // 낮은 전환율은 **경고**다 — 아직 안 채운 칸(--req)과 뜻이 다르다
  rateLow: { fontSize: 'clamp(9px, 1.9cqi, 12.5px)', color: 'var(--warn)', fontWeight: 700, whiteSpace: 'nowrap' as const },

  /*
   * 지표 묶음 — 넓으면 여러 열, 좁으면 한 열. **칸을 채우지 않는다**(배경·테두리 없음).
   * 열 사이는 여백으로만 나눈다 — 선을 그으면 표처럼 보여 읽는 순서가 흐려진다.
   */
  groups: {
    // 220px — 태블릿(768) 에서도 세 묶음이 한 줄에 들어가는 최소값(260 이면 2+1 로 어긋난다)
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 'var(--sp-5)', marginTop: 'var(--sp-4)',
  },
  /*
   * 한 묶음의 폭은 **420px 에서 멈춘다**. 라벨(좌)–값(우) 사이가 벌어질수록
   * 어느 값이 어느 라벨의 것인지 눈으로 잇기 어려워진다 — 넓은 화면에서는
   * 칸을 늘리는 대신 왼쪽에 모아 둔다.
   */
  group: { minWidth: 0, maxWidth: 420 },
  groupTitle: {
    fontSize: 'var(--fs-caption)', color: 'var(--muted)', fontWeight: 'var(--fw-label)' as React.CSSProperties['fontWeight'],
    letterSpacing: 'var(--ls-tight)', paddingBottom: 'var(--sp-2)', borderBottom: 'var(--hairline)',
  },
  /** 지표 한 줄 — 줄 사이는 헤어라인 하나. 마지막 줄에도 선을 남겨 묶음의 끝을 만든다 */
  metric: { padding: 'var(--sp-3) 0', borderBottom: 'var(--hairline)' },
  metricHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--sp-3)' },
  metricLabel: { fontSize: 'var(--fs-label)', color: 'var(--muted)', whiteSpace: 'nowrap' as const },
  metricVal: {
    fontSize: 'var(--fs-section)', color: 'var(--dark)',
    fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const,
  },
  // 강조는 **배경이 아니라 굵기**로 — 칸을 채우면 다시 블록이 된다
  metricValStrong: {
    fontSize: 'var(--fs-section)', color: 'var(--dark)', fontWeight: 700,
    fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const,
  },
  metricNote: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', marginTop: 2, lineHeight: 'var(--lh-body)' },

  /* 휴대폰용 한 건 — 칸을 채우지 않고 줄로만 나눈다(표 스타일과 같은 원칙) */
  item: { padding: 'var(--sp-3) 0', borderBottom: 'var(--hairline)' },
  itemTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-2)' },
  itemDays: { fontSize: 'var(--fs-label)', fontWeight: 700, color: 'var(--dark)', whiteSpace: 'nowrap' as const },
  itemBottom: {
    display: 'flex', alignItems: 'baseline', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)',
  },
  itemNo: { fontSize: 'var(--fs-label)', color: 'var(--dark)', fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const },
  // 고객명만 길어질 수 있다 — 여기서만 줄이고 번호·금액은 온전히 남긴다
  itemCustomer: { flex: 1, minWidth: 0, fontSize: 'var(--fs-label)', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  itemPrice: { fontSize: 'var(--fs-label)', color: 'var(--dark)', fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const },
  itemOwner: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', marginTop: 2 },

  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', minWidth: 'max-content', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid var(--line)', color: 'var(--muted)', fontSize: 12.5, whiteSpace: 'nowrap' },
  td: { padding: '9px 12px', borderBottom: '0.5px solid var(--line)', whiteSpace: 'nowrap' },
  tdMuted: { padding: '9px 12px', borderBottom: '0.5px solid var(--line)', color: 'var(--muted)', whiteSpace: 'nowrap' },
  tdNum: { padding: '9px 12px', borderBottom: '0.5px solid var(--line)', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  why: { fontSize: 12, color: 'var(--muted)', marginTop: 3 },
  tagWarn: { fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: 'var(--warnbg)', color: 'var(--warn)', display: 'inline-block', whiteSpace: 'nowrap' },
  tagInfo: { fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: 'var(--card)', color: 'var(--muted)', display: 'inline-block', whiteSpace: 'nowrap' },
}
