import { useEffect, useMemo, useState } from 'react'
import type { ApiOrderMakerDetail } from '@shared/types/index'
import { calcLoad } from '@buildup-ev/shared/load-calc'
import { fetchOrderDetail } from '../api/orders'
import { fetchModelSpec, type ModelSpec } from '../api/models'
import { useIsMobile } from '../hooks/useIsMobile'

// 기본값 출처: doc-templates/pv5-spec.json 하중계산_기준입력
const INPUT_DEFAULTS = {
  installWeight: 0, installDist: 0,
  removeWeight: 0,  removeDist: 0,
  cargoDist: 35,
  crewWeight: 130,  crewDist: 2995,
}

const ORDER_STATUS_SEQ = ['제작착수', '구조변경', '튜닝신청', '안전검사', '튜닝승인', '인도완료'] as const
const DOC_STATUS_LABEL: Record<string, string> = { pending: '준비중', done: '완료', na: '해당없음' }
const DOC_STATUS_STYLE: Record<string, React.CSSProperties> = {
  pending: { background: '#fff3e0', color: '#e65100' },
  done:    { background: '#e8f5e9', color: '#2e7d32' },
  na:      { background: '#f0f2f4', color: 'var(--muted)' },
}

function fmtDatetime(s: string | null) { return s ? s.slice(0, 16).replace('T', ' ') : '—' }
function fmtKg(n: number) { return n.toLocaleString() + ' kg' }
function fmtPct(n: number) { return n.toFixed(1) + ' %' }

interface LoadInputs {
  installWeight: number; installDist: number
  removeWeight: number;  removeDist: number
  cargoDist: number
  crewWeight: number;    crewDist: number
}

// ── 하중·법규 탭 ──────────────────────────────────────────────────────────────
function LoadCalcTab({ modelCode }: { modelCode: string }) {
  const [spec, setSpec] = useState<ModelSpec | null>(null)
  const [specErr, setSpecErr] = useState('')
  const [inputs, setInputs] = useState<LoadInputs>(INPUT_DEFAULTS)

  useEffect(() => {
    fetchModelSpec(modelCode)
      .then(setSpec)
      .catch(e => setSpecErr(e instanceof Error ? e.message : '제원 로드 실패'))
  }, [modelCode])

  // 적재량: 제작허용총중량 - (공차중량 + 정원중량), 50kg 단위 내림, 1000kg 상한 — 파생값(편집 불가)
  const cargoWeight = spec?.gvw_limit_kg != null
    ? Math.min(Math.floor(Math.max(0, spec.gvw_limit_kg - spec.curb_axle_front_kg - spec.curb_axle_rear_kg - inputs.crewWeight) / 50) * 50, 1000)
    : 0

  function set(k: keyof LoadInputs, v: string) {
    const n = Number(v)
    if (!isNaN(n)) setInputs(prev => ({ ...prev, [k]: n }))
  }

  const result = useMemo(() => {
    if (!spec) return null
    return calcLoad({
      wheelbase_mm:       spec.wheelbase_mm,
      curb_axle_front_kg: spec.curb_axle_front_kg,
      curb_axle_rear_kg:  spec.curb_axle_rear_kg,
      gvw_limit_kg:       spec.gvw_limit_kg ?? undefined,
      tire_front:         spec.tire_front,
      tire_rear:          spec.tire_rear,
      install_items: inputs.installWeight > 0 ? [{ weight_kg: inputs.installWeight, dist_to_rear_axle_mm: inputs.installDist }] : [],
      remove_items:  inputs.removeWeight  > 0 ? [{ weight_kg: inputs.removeWeight,  dist_to_rear_axle_mm: inputs.removeDist  }] : [],
      cargo: { weight_kg: cargoWeight, dist_to_rear_axle_mm: inputs.cargoDist },
      crew_items: inputs.crewWeight > 0 ? [{ weight_kg: inputs.crewWeight, dist_to_rear_axle_mm: inputs.crewDist }] : [],
    })
  }, [spec, inputs])

  const tireOk = result
    ? result.tire_load_rate.loaded_front_pct <= 100 && result.tire_load_rate.loaded_rear_pct <= 100
    : true

  if (specErr) return <div style={lc.err}>{specErr}</div>
  if (!spec)   return <div style={lc.muted}>제원 로딩 중…</div>

  return (
    <div style={lc.root}>
      <div style={lc.demoNote}>
        ⚠ 시연용 입력값 (추후 옵션별 BOM으로 자동화 예정){/* TODO: BOM 연동 후 삭제 */}
      </div>

      {/* 차종 제원 */}
      <div style={lc.card}>
        <div style={lc.cardTitle}>차종 제원 (자동 로드)</div>
        <div style={lc.specGrid}>
          <span style={lc.specLabel}>축간거리</span><span style={lc.specVal}>{spec.wheelbase_mm.toLocaleString()} mm</span>
          <span style={lc.specLabel}>공차 전축</span><span style={lc.specVal}>{fmtKg(spec.curb_axle_front_kg)}</span>
          <span style={lc.specLabel}>공차 후축</span><span style={lc.specVal}>{fmtKg(spec.curb_axle_rear_kg)}</span>
          <span style={lc.specLabel}>GVW 한계</span><span style={lc.specVal}>{spec.gvw_limit_kg != null ? fmtKg(spec.gvw_limit_kg) : '미설정'}</span>
          <span style={lc.specLabel}>최대적재량 (계산)</span>
          <span style={lc.specVal}>
            {spec.gvw_limit_kg != null
              ? fmtKg(Math.min(Math.floor(Math.max(0, spec.gvw_limit_kg - spec.curb_axle_front_kg - spec.curb_axle_rear_kg - inputs.crewWeight) / 50) * 50, 1000))
              : '—'}
          </span>
          <span style={lc.specLabel}>타이어 허용 (전/후)</span>
          <span style={lc.specVal}>{spec.tire_front.allowable_load_kg} × {spec.tire_front.wheels} / {spec.tire_rear.allowable_load_kg} × {spec.tire_rear.wheels} kg</span>
        </div>
      </div>

      {/* 입력 */}
      <div style={lc.card}>
        <div style={lc.cardTitle}>입력 (수정 시 즉시 재계산)</div>
        <div style={lc.inputGrid}>
          <label style={lc.iLabel}>설치중량 (kg)</label>
          <input style={lc.input} type="number" value={inputs.installWeight} onChange={e => set('installWeight', e.target.value)} />
          <label style={lc.iLabel}>설치 위치 — 후축까지 (mm)</label>
          <input style={lc.input} type="number" value={inputs.installDist} onChange={e => set('installDist', e.target.value)} />

          <label style={lc.iLabel}>탈거중량 (kg)</label>
          <input style={lc.input} type="number" value={inputs.removeWeight} onChange={e => set('removeWeight', e.target.value)} />
          <label style={lc.iLabel}>탈거 위치 — 후축까지 (mm)</label>
          <input style={lc.input} type="number" value={inputs.removeDist} onChange={e => set('removeDist', e.target.value)} />

          <label style={lc.iLabel}>적재량 (kg)</label>
          <span style={{ ...lc.input, display: 'flex', alignItems: 'center', background: '#f0f2f4', color: 'var(--text)', cursor: 'default' }}>
            {cargoWeight.toLocaleString()} kg
          </span>
          <label style={lc.iLabel}>하대옵셋트 — 후축까지 (mm)</label>
          <input style={lc.input} type="number" value={inputs.cargoDist} onChange={e => set('cargoDist', e.target.value)} />

          <label style={lc.iLabel}>정원 중량 (kg)</label>
          <input style={lc.input} type="number" value={inputs.crewWeight} onChange={e => set('crewWeight', e.target.value)} />
          <label style={lc.iLabel}>정원 위치 — 후축까지 (mm)</label>
          <input style={lc.input} type="number" value={inputs.crewDist} onChange={e => set('crewDist', e.target.value)} />
        </div>
      </div>

      {result && (
        <>
          {/* 계산 결과 */}
          <div style={lc.card}>
            <div style={lc.cardTitle}>계산 결과</div>
            <table style={lc.table}>
              <thead>
                <tr>
                  <th style={lc.th}></th>
                  <th style={lc.thR}>공차</th>
                  <th style={lc.thR}>적차</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={lc.td}>전축 하중</td>
                  <td style={lc.tdR}>{fmtKg(result.curb.front_kg)}</td>
                  <td style={lc.tdR}>{fmtKg(result.loaded.front_kg)}</td>
                </tr>
                <tr>
                  <td style={lc.td}>후축 하중</td>
                  <td style={lc.tdR}>{fmtKg(result.curb.rear_kg)}</td>
                  <td style={lc.tdR}>{fmtKg(result.loaded.rear_kg)}</td>
                </tr>
                <tr>
                  <td style={lc.td}>총중량</td>
                  <td style={lc.tdR}>{fmtKg(result.curb.front_kg + result.curb.rear_kg)}</td>
                  <td style={{ ...lc.tdR, fontWeight: 700 }}>{fmtKg(result.gvw_kg)}</td>
                </tr>
                <tr>
                  <td style={lc.td}>전축 타이어 부하율</td>
                  <td style={lc.tdR}>{fmtPct(result.tire_load_rate.curb_front_pct)}</td>
                  <td style={lc.tdR}>{fmtPct(result.tire_load_rate.loaded_front_pct)}</td>
                </tr>
                <tr>
                  <td style={lc.td}>후축 타이어 부하율</td>
                  <td style={lc.tdR}>{fmtPct(result.tire_load_rate.curb_rear_pct)}</td>
                  <td style={lc.tdR}>{fmtPct(result.tire_load_rate.loaded_rear_pct)}</td>
                </tr>
                <tr>
                  <td style={lc.td}>조향륜 하중분포율</td>
                  <td style={lc.tdR}>—</td>
                  <td style={lc.tdR}>{fmtPct(result.steering_axle_ratio_pct)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* 법규 검토 */}
          <div style={lc.card}>
            <div style={lc.cardTitle}>법규 검토 (하중 기반)</div>
            <div style={lc.legalGrid}>
              {/* ① 총중량 */}
              <div style={lc.legalRow}>
                <span style={lc.legalLabel}>① 총중량</span>
                <span style={lc.legalDetail}>
                  {fmtKg(result.gvw_kg)}
                  {spec.gvw_limit_kg != null ? ` ≤ ${fmtKg(spec.gvw_limit_kg)}` : ' (GVW 한계 미설정)'}
                </span>
                {spec.gvw_limit_kg != null ? (
                  <span style={result.legal.within_gvw ? lc.badgeOk : lc.badgeNg}>
                    {result.legal.within_gvw ? '적합 ✓' : '부적합 ✗'}
                  </span>
                ) : (
                  <span style={lc.badgeGray}>확인 불가</span>
                )}
              </div>

              {/* ② 축하중 */}
              <div style={lc.legalRow}>
                <span style={lc.legalLabel}>② 축하중</span>
                <span style={lc.legalDetail}>
                  전 {fmtPct(result.tire_load_rate.loaded_front_pct)} / 후 {fmtPct(result.tire_load_rate.loaded_rear_pct)} (≤ 100 %)
                </span>
                <span style={tireOk ? lc.badgeOk : lc.badgeNg}>
                  {tireOk ? '적합 ✓' : '부적합 ✗'}
                </span>
              </div>

              {/* ③ 치수 */}
              <div style={lc.legalRow}>
                <span style={lc.legalLabel}>③ 최대허용제원</span>
                <span style={{ ...lc.legalDetail, color: 'var(--muted)' }}>VIVAR 치수 연동 후 추가 예정</span>
                <span style={lc.badgeGray}>연동 전</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── 공유 OrderDetail 컴포넌트 ─────────────────────────────────────────────────
interface Props {
  orderId: number
  onBack: () => void
  backLabel?: string
}

export function OrderDetail({ orderId, onBack, backLabel = '← 배정 주문' }: Props) {
  const [detail, setDetail] = useState<ApiOrderMakerDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<'spec' | 'docs' | 'load'>('spec')
  const isMobile = useIsMobile()

  useEffect(() => {
    setLoading(true); setErr('')
    fetchOrderDetail(orderId)
      .then(setDetail)
      .catch(e => setErr(e instanceof Error ? e.message : '주문 상세 로드 실패'))
      .finally(() => setLoading(false))
  }, [orderId])

  if (loading) return <div style={det.loading}>로딩 중…</div>
  if (err)     return <div style={det.err}>{err}</div>
  if (!detail) return null

  const statusIdx = ORDER_STATUS_SEQ.indexOf(detail.status as typeof ORDER_STATUS_SEQ[number])

  return (
    <div style={{ ...det.root, maxWidth: isMobile ? '100%' : 720 }}>
      {/* 헤더 */}
      <div style={det.header}>
        <button style={det.backBtn} onClick={onBack}>{backLabel}</button>
        <div style={det.titleRow}>
          <span style={{ ...det.orderId, fontSize: isMobile ? 18 : 20 }}>주문 #{detail.id}</span>
          <span style={det.statusBadge}>{detail.status}</span>
          <span style={det.model}>{detail.model_code}</span>
        </div>
        <div style={det.metaRow}>
          <span>배정일 {fmtDatetime(detail.assigned_at)}</span>
          <span style={det.sep}>·</span>
          <span>생성 {fmtDatetime(detail.created_at)}</span>
          {detail.customer_name && (
            <><span style={det.sep}>·</span><span>고객 {detail.customer_name}</span></>
          )}
        </div>
      </div>

      {/* 진행 단계 */}
      <div style={{ ...det.progressSection, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
        {ORDER_STATUS_SEQ.map((s, i) => (
          <div key={s} style={{ ...det.stepItem, ...(isMobile ? { flex: '0 0 33%', marginBottom: 8 } : {}) }}>
            <div style={i <= statusIdx ? det.stepDotActive : det.stepDot} />
            <div style={i <= statusIdx ? det.stepLabelActive : det.stepLabel}>{s}</div>
          </div>
        ))}
      </div>

      {/* 탭 */}
      <div style={det.tabs}>
        <button style={tab === 'spec' ? det.tabActive : det.tabBtn} onClick={() => setTab('spec')}>사양</button>
        <button style={tab === 'docs' ? det.tabActive : det.tabBtn} onClick={() => setTab('docs')}>서류 ({detail.documents.length})</button>
        <button style={tab === 'load' ? det.tabActive : det.tabBtn} onClick={() => setTab('load')}>하중·법규</button>
      </div>

      {tab === 'spec' && (
        <div style={det.section}>
          {detail.options.length === 0 ? (
            <div style={det.empty}>옵션 정보 없음</div>
          ) : isMobile ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {detail.options.map((opt, i) => (
                <div key={i} style={detMob.row}>
                  <span style={detMob.label}>{opt.group_name}</span>
                  <span style={detMob.value}>{opt.value_name}</span>
                </div>
              ))}
            </div>
          ) : (
            <table style={det.table}>
              <thead>
                <tr>
                  <th style={det.th}>항목</th>
                  <th style={det.th}>선택</th>
                </tr>
              </thead>
              <tbody>
                {detail.options.map((opt, i) => (
                  <tr key={i}>
                    <td style={det.tdLabel}>{opt.group_name}</td>
                    <td style={det.tdValue}>{opt.value_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'docs' && (
        <div style={det.section}>
          {detail.documents.length === 0 ? (
            <div style={det.empty}>서류 준비 중</div>
          ) : isMobile ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {detail.documents.map(doc => (
                <div key={doc.id} style={detMob.row}>
                  <span style={detMob.label}>{doc.name}</span>
                  <span style={{ ...det.docBadge, ...DOC_STATUS_STYLE[doc.status] }}>
                    {DOC_STATUS_LABEL[doc.status] ?? doc.status}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <table style={det.table}>
              <thead>
                <tr>
                  <th style={det.th}>서류명</th>
                  <th style={det.th}>상태</th>
                </tr>
              </thead>
              <tbody>
                {detail.documents.map(doc => (
                  <tr key={doc.id}>
                    <td style={det.tdLabel}>{doc.name}</td>
                    <td style={det.tdValue}>
                      <span style={{ ...det.docBadge, ...DOC_STATUS_STYLE[doc.status] }}>
                        {DOC_STATUS_LABEL[doc.status] ?? doc.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'load' && (
        <div style={det.section}>
          <LoadCalcTab modelCode={detail.model_code} />
        </div>
      )}
    </div>
  )
}

// ── 스타일 ────────────────────────────────────────────────────────────────────
const det: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 },
  loading: { color: 'var(--muted)', fontSize: 14, padding: '40px 0' },
  err: { color: 'var(--warn)', fontSize: 13 },
  header: { display: 'flex', flexDirection: 'column', gap: 8 },
  backBtn: {
    alignSelf: 'flex-start', fontSize: 12, padding: '5px 12px',
    border: '1px solid var(--line)', borderRadius: 7, background: '#fff',
    cursor: 'pointer', color: 'var(--muted)', marginBottom: 4, minHeight: 44,
  },
  titleRow: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const },
  orderId: { fontSize: 20, fontWeight: 800, color: 'var(--dark)' },
  statusBadge: { fontSize: 12, fontWeight: 700, padding: '4px 12px', background: 'var(--lime)', color: 'var(--dark)', borderRadius: 14 },
  model: { fontSize: 14, color: 'var(--muted)', fontWeight: 600 },
  metaRow: { display: 'flex', gap: 6, fontSize: 12, color: 'var(--muted)', flexWrap: 'wrap' as const },
  sep: { color: 'var(--line)' },
  progressSection: { display: 'flex', alignItems: 'flex-start', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 16px', background: '#fff' },
  stepItem: { display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 },
  stepDot: { width: 10, height: 10, borderRadius: '50%', background: '#e0e3e8', marginBottom: 6 },
  stepDotActive: { width: 10, height: 10, borderRadius: '50%', background: 'var(--lime)', marginBottom: 6 },
  stepLabel: { fontSize: 9.5, color: '#b0b7c0', textAlign: 'center' as const },
  stepLabelActive: { fontSize: 9.5, color: 'var(--dark)', fontWeight: 700, textAlign: 'center' as const },
  tabs: { display: 'flex', gap: 4, borderBottom: '2px solid var(--line)', paddingBottom: 0 },
  tabBtn: { padding: '8px 18px', border: 'none', borderBottom: '2px solid transparent', background: 'transparent', cursor: 'pointer', fontSize: 13, color: 'var(--muted)', fontWeight: 600, marginBottom: -2, minHeight: 44 },
  tabActive: { padding: '8px 18px', border: 'none', borderBottom: '2px solid var(--dark)', background: 'transparent', cursor: 'pointer', fontSize: 13, color: 'var(--dark)', fontWeight: 700, marginBottom: -2, minHeight: 44 },
  section: { paddingTop: 4 },
  empty: { color: 'var(--muted)', fontSize: 13, padding: '24px 0', textAlign: 'center' as const },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  th: { textAlign: 'left' as const, padding: '8px 12px', borderBottom: '2px solid var(--line)', color: 'var(--muted)', fontWeight: 600, fontSize: 12 },
  tdLabel: { padding: '10px 12px', borderBottom: '1px solid var(--line)', color: 'var(--muted)', fontSize: 12, width: '40%' },
  tdValue: { padding: '10px 12px', borderBottom: '1px solid var(--line)', fontWeight: 600, color: 'var(--dark)' },
  docBadge: { fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 8 },
}

const detMob: Record<string, React.CSSProperties> = {
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--line)', gap: 12 },
  label: { fontSize: 12, color: 'var(--muted)', flexShrink: 0 },
  value: { fontSize: 13, fontWeight: 600, color: 'var(--dark)', textAlign: 'right' as const },
}

const lc: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 8 },
  err:  { color: 'var(--warn)', fontSize: 13 },
  muted: { color: 'var(--muted)', fontSize: 13 },
  demoNote: {
    fontSize: 11, color: '#e65100', background: '#fff3e0',
    border: '1px solid #ffcc80', borderRadius: 7, padding: '6px 10px',
  },
  card: { border: '1px solid var(--line)', borderRadius: 10, padding: '14px 16px', background: '#fff' },
  cardTitle: { fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 12 },
  specGrid: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '5px 16px', fontSize: 13 },
  specLabel: { color: 'var(--muted)', fontSize: 12 },
  specVal: { fontWeight: 600, color: 'var(--dark)' },
  inputGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', fontSize: 13 },
  iLabel: { display: 'block', fontSize: 11.5, color: 'var(--muted)', marginBottom: 3 },
  input: { width: '100%', boxSizing: 'border-box' as const, fontSize: 13, padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 7, fontVariantNumeric: 'tabular-nums' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  th:  { textAlign: 'left' as const,  padding: '7px 10px', borderBottom: '2px solid var(--line)', color: 'var(--muted)', fontWeight: 600, fontSize: 12 },
  thR: { textAlign: 'right' as const, padding: '7px 10px', borderBottom: '2px solid var(--line)', color: 'var(--muted)', fontWeight: 600, fontSize: 12 },
  td:  { padding: '9px 10px', borderBottom: '1px solid var(--line)', color: 'var(--muted)', fontSize: 12 },
  tdR: { padding: '9px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'var(--dark)' },
  legalGrid: { display: 'flex', flexDirection: 'column', gap: 10 },
  legalRow: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const },
  legalLabel: { fontSize: 12, fontWeight: 700, color: 'var(--dark)', minWidth: 100 },
  legalDetail: { flex: 1, fontSize: 12, color: 'var(--dark)' },
  badgeOk:   { fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 8, background: '#e8f5e9', color: '#2e7d32', whiteSpace: 'nowrap' as const },
  badgeNg:   { fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 8, background: '#fdecea', color: '#c62828', whiteSpace: 'nowrap' as const },
  badgeGray: { fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 8, background: '#f0f2f4', color: 'var(--muted)', whiteSpace: 'nowrap' as const },
}
