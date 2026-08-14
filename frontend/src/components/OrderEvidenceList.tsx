import { useEffect, useState } from 'react'
import { EVIDENCE_LABEL, STEP_BY_CODE, TRACK_LABEL, type EvidenceKind } from '@shared/process/steps'
import { fetchSteps, stepFileUrl, type ApiStepFile } from '../api/steps'
import { fmtBytes } from '../lib/imageResize'

/**
 * 올라온 증빙을 **한자리에 모아 본다** — 「서류」 탭.
 *
 * 단계 화면에서는 그 단계에 딸린 것만 보인다. 「그동안 올린 게 다 어디 있나」를 물으면
 * 17단계를 훑어야 했다 — 관리자와 특장사 둘 다 그 질문을 자주 한다(제출 서류를 챙길 때,
 * 나중에 분쟁이 생겼을 때). 그래서 단계와 무관하게 시간순으로 한 번 더 편다.
 *
 * **여는 권한은 서버가 정한다** — 목록도 파일도 주문 접근 권한을 통과한 사람만 받는다
 * (관리자 전체 · 특장사 자기 조직 · 영업 자기 견적).
 */
export function OrderEvidenceList({ orderId }: { orderId: number }) {
  const [files, setFiles] = useState<(ApiStepFile & { step_code: string })[] | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    fetchSteps(orderId)
      .then(res => {
        if (!alive) return
        const all = res.data.flatMap(s => s.files.map(f => ({ ...f, step_code: s.code })))
        // 올린 순서대로 — 나중에 되짚을 때는 시간순이 가장 찾기 쉽다
        all.sort((a, b) => a.uploaded_at.localeCompare(b.uploaded_at))
        setFiles(all)
      })
      .catch(e => { if (alive) setErr(e instanceof Error ? e.message : '증빙 목록을 불러오지 못했습니다') })
    return () => { alive = false }
  }, [orderId])

  if (err) return <div style={s.err}>{err}</div>
  if (!files) return <div style={s.muted}>불러오는 중…</div>
  if (files.length === 0) return <div style={s.muted}>올라온 증빙이 없습니다.</div>

  return (
    <div>
      <div style={s.head}>올라온 증빙 <span style={s.count}>{files.length}</span></div>
      <div style={s.scroller}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>단계</th>
              <th style={s.th}>종류</th>
              <th style={s.th}>파일</th>
              <th style={s.th}>크기</th>
              <th style={s.th}>올린 사람</th>
              <th style={s.th}>올린 때</th>
            </tr>
          </thead>
          <tbody>
            {files.map(f => {
              const def = STEP_BY_CODE[f.step_code]
              return (
                <tr key={f.id}>
                  <td style={s.td}>
                    {def?.label ?? f.step_code}
                    {def && <span style={s.track}> · {TRACK_LABEL[def.track]}</span>}
                  </td>
                  <td style={s.td}>
                    {EVIDENCE_LABEL[f.kind as EvidenceKind] ?? f.kind}
                    {/* 원본인지 줄인 것인지 — 나중에 화질을 따질 때 필요하다 */}
                    <span style={s.kept}>{f.kept_original ? ' · 원본' : ' · 축소본'}</span>
                  </td>
                  <td style={s.td}>
                    <a href={stepFileUrl(orderId, f.id)} target="_blank" rel="noreferrer" style={s.link}>
                      {f.name || `파일 ${f.id}`}
                    </a>
                  </td>
                  <td style={s.tdNum}>{f.size ? fmtBytes(f.size) : '—'}</td>
                  <td style={s.tdMuted}>{f.uploaded_by}</td>
                  <td style={s.tdNum}>{f.uploaded_at.slice(0, 10)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  head: {
    fontSize: 'var(--fs-label)', fontWeight: 700, color: 'var(--dark)',
    paddingBottom: 'var(--sp-2)', borderBottom: 'var(--hairline)', marginBottom: 'var(--sp-2)',
  },
  count: { fontWeight: 400, color: 'var(--muted)', marginLeft: 'var(--sp-1)' },
  scroller: { overflowX: 'auto' },
  table: { width: '100%', minWidth: 560, borderCollapse: 'collapse', fontSize: 'var(--fs-caption)' },
  th: {
    textAlign: 'left', padding: '6px 10px 6px 0', color: 'var(--muted)',
    fontWeight: 500, borderBottom: 'var(--hairline)', whiteSpace: 'nowrap',
  },
  td: { padding: '7px 10px 7px 0', borderBottom: 'var(--hairline)', color: 'var(--dark)', verticalAlign: 'top' },
  tdMuted: { padding: '7px 10px 7px 0', borderBottom: 'var(--hairline)', color: 'var(--muted)', whiteSpace: 'nowrap' },
  tdNum: { padding: '7px 10px 7px 0', borderBottom: 'var(--hairline)', color: 'var(--muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  track: { color: 'var(--muted)' },
  kept: { color: 'var(--muted)' },
  link: { color: 'var(--dark)', textDecoration: 'underline', wordBreak: 'break-all' },
  muted: { fontSize: 'var(--fs-label)', color: 'var(--muted)', padding: 'var(--sp-3) 0' },
  err: { fontSize: 'var(--fs-label)', color: 'var(--warn)', padding: 'var(--sp-2) 0' },
}
