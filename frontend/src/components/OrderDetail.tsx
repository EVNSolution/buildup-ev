import { useEffect, useMemo, useState, Fragment } from 'react'
import type { ApiOrderMakerDetail, OrderVehicleInfo } from '@shared/types/index'
import { calcBom } from '@buildup-ev/shared/bom'
import { calcLoad } from '@buildup-ev/shared/load-calc'
import { fetchOrderDetail } from '../api/orders'
import { fetchModelSpec, type ModelSpec } from '../api/models'
import { saveVehicleInfo } from '../api/orders'
import { useAuth } from '../contexts/AuthContext'
import { useIsMobile } from '../hooks/useIsMobile'

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

// ── 하중·법규 탭 (자동 BOM 연동) ─────────────────────────────────────────────

function LoadCalcTab({
  modelCode,
  options,
}: {
  modelCode: string
  options: { group_code: string; value_code: string }[]
}) {
  const [spec, setSpec] = useState<ModelSpec | null>(null)
  const [specErr, setSpecErr] = useState('')

  useEffect(() => {
    fetchModelSpec(modelCode)
      .then(setSpec)
      .catch(e => setSpecErr(e instanceof Error ? e.message : '제원 로드 실패'))
  }, [modelCode])

  // 옵션 → selections
  const selections = useMemo<Record<string, string>>(() => {
    const s: Record<string, string> = {}
    for (const o of options) s[o.group_code] = o.value_code
    return s
  }, [options])

  // BOM 자동 산출
  const bom = useMemo(() => calcBom(selections), [selections])

  // 하중 계산
  const result = useMemo(() => {
    if (!spec || !bom) return null
    return calcLoad({
      wheelbase_mm:       spec.wheelbase_mm,
      curb_axle_front_kg: spec.curb_axle_front_kg,
      curb_axle_rear_kg:  spec.curb_axle_rear_kg,
      gvw_limit_kg:       spec.gvw_limit_kg ?? undefined,
      tire_front:         spec.tire_front,
      tire_rear:          spec.tire_rear,
      remove_items:  bom.remove_weight_items,
      install_items: bom.install_weight_items,
      // 정원 130kg @CG_x 1100 → 후축까지 1895mm
      crew_items: [{ weight_kg: 130, dist_to_rear_axle_mm: 2995 - 1100 }],
      // 적재 @CG_x 2400 → 후축까지 595mm
      cargo: { weight_kg: bom.max_payload_kg, dist_to_rear_axle_mm: 2995 - 2400 },
    })
  }, [spec, bom])

  const tireOk = result
    ? result.tire_load_rate.loaded_front_pct <= 100 && result.tire_load_rate.loaded_rear_pct <= 100
    : true

  if (specErr) return <div style={lc.err}>{specErr}</div>
  if (!spec)   return <div style={lc.muted}>제원 로딩 중…</div>
  if (!bom)    return <div style={lc.muted}>탑 옵션(BODYTYPE·TOP·DOORTYPE)을 선택하면 자동 계산됩니다.</div>

  return (
    <div style={lc.root}>
      {/* BOM 항목 */}
      <div style={lc.card}>
        <div style={lc.cardTitle}>탈거 / 설치 항목 (BOM 자동 산출)</div>
        <table style={lc.table}>
          <thead>
            <tr>
              <th style={{ ...lc.th, textAlign: 'left' }}>항목</th>
              <th style={lc.thR}>중량 (kg)</th>
              <th style={lc.thR}>CG_x 전축기준 (mm)</th>
            </tr>
          </thead>
          <tbody>
            <tr><td colSpan={3} style={{ ...lc.td, fontWeight: 700, background: '#f9f9f9' }}>탈거</td></tr>
            {bom.remove_items.map((i, idx) => (
              <tr key={`r${idx}`}>
                <td style={lc.td}>{i.label}</td>
                <td style={lc.tdR}>{i.weight_kg}</td>
                <td style={lc.tdR}>{i.cg_x_mm}</td>
              </tr>
            ))}
            <tr><td colSpan={3} style={{ ...lc.td, fontWeight: 700, background: '#f9f9f9' }}>설치</td></tr>
            {bom.install_items.map((i, idx) => (
              <tr key={`i${idx}`}>
                <td style={lc.td}>{i.label}</td>
                <td style={lc.tdR}>{i.weight_kg}</td>
                <td style={lc.tdR}>{i.cg_x_mm}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {bom.extra_option_labels.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
            하중 제외 옵션: {bom.extra_option_labels.join(', ')}
          </div>
        )}
        <div style={{ ...lc.specGrid, marginTop: 10, fontSize: 12 }}>
          <span style={lc.specLabel}>차량중량 후</span>
          <span style={lc.specVal}>{Math.round(bom.curb_weight_after_kg * 10) / 10} kg</span>
          <span style={lc.specLabel}>최대적재량 후</span>
          <span style={lc.specVal}>{bom.max_payload_kg} kg</span>
        </div>
      </div>

      {result && (
        <>
          {/* 계산 결과 */}
          <div style={lc.card}>
            <div style={lc.cardTitle}>하중 분포 계산 결과</div>
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
            <div style={lc.cardTitle}>법규 검토 (하중 기준)</div>
            <div style={lc.legalGrid}>
              <div style={lc.legalRow}>
                <span style={lc.legalLabel}>① 총중량</span>
                <span style={lc.legalDetail}>
                  {fmtKg(result.gvw_kg)}
                  {spec.gvw_limit_kg != null ? ` ≤ ${fmtKg(spec.gvw_limit_kg)}` : ''}
                </span>
                {spec.gvw_limit_kg != null ? (
                  <span style={result.legal.within_gvw ? lc.badgeOk : lc.badgeNg}>
                    {result.legal.within_gvw ? '적합 ✓' : '부적합 ✗'}
                  </span>
                ) : <span style={lc.badgeGray}>확인 불가</span>}
              </div>
              <div style={lc.legalRow}>
                <span style={lc.legalLabel}>② 타이어 부하율</span>
                <span style={lc.legalDetail}>
                  전 {fmtPct(result.tire_load_rate.loaded_front_pct)} / 후 {fmtPct(result.tire_load_rate.loaded_rear_pct)} (≤ 100 %)
                </span>
                <span style={tireOk ? lc.badgeOk : lc.badgeNg}>
                  {tireOk ? '적합 ✓' : '부적합 ✗'}
                </span>
              </div>
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

// ── 서류 탭 (PDF 다운로드 + 차량정보 입력) ────────────────────────────────────

function DocsTab({
  orderId,
  documents,
  vehicleInfo: initInfo,
  options,
}: {
  orderId: number
  documents: ApiOrderMakerDetail['documents']
  vehicleInfo?: OrderVehicleInfo | null
  options: ApiOrderMakerDetail['options']
}) {
  const [info, setInfo] = useState<OrderVehicleInfo>(initInfo ?? {})
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  // BOM 사전 체크 — BODYTYPE·TOP·DOORTYPE 미선택 시 PDF 버튼 비활성
  const bomOk = useMemo(() => {
    const sel: Record<string, string> = {}
    for (const o of options) sel[o.group_code] = o.value_code
    return calcBom(sel) !== null
  }, [options])

  function setField<K extends keyof OrderVehicleInfo>(k: K, v: string) {
    setInfo(prev => ({ ...prev, [k]: v }))
    setSaveMsg('')
  }

  async function handleSave() {
    setSaving(true); setSaveMsg('')
    try {
      await saveVehicleInfo(orderId, info)
      setSaveMsg('저장됨 ✓')
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  const pdfUrl = (type: string) => `/api/v1/orders/${orderId}/docs/${type}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 8 }}>
      {/* 서류 상태 */}
      {documents.length > 0 && (
        <div style={det.card}>
          <div style={det.cardTitle}>서류 상태</div>
          {documents.map(doc => (
            <div key={doc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <span style={{ fontSize: 13 }}>{doc.name}</span>
              <span style={{ ...det.docBadge, ...DOC_STATUS_STYLE[doc.status] }}>
                {DOC_STATUS_LABEL[doc.status] ?? doc.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 차량정보 입력 */}
      <div style={det.card}>
        <div style={det.cardTitle}>차량정보 입력 (서류 바인딩)</div>
        <div style={det.infoGrid}>
          {([
            ['제원관리번호', '제원관리번호'],
            ['등록번호',     '등록번호'],
            ['차대번호',     '차대번호'],
            ['형식코드',     '형식코드'],
            ['모델연도',     '모델연도'],
            ['소유자성명',   '소유자성명'],
            ['소유자주소',   '소유자주소'],
            ['최초등록일',   '최초등록일 (예: 2025-01-15)'],
          ] as [keyof OrderVehicleInfo, string][]).map(([k, placeholder]) => (
            <Fragment key={k}>
              <label style={det.infoLabel}>{k}</label>
              <input
                style={det.infoInput}
                type="text"
                placeholder={placeholder}
                value={String(info[k] ?? '')}
                onChange={e => setField(k, e.target.value)}
              />
            </Fragment>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <button style={det.saveBtn} onClick={handleSave} disabled={saving}>
            {saving ? '저장 중…' : '차량정보 저장'}
          </button>
          {saveMsg && (
            <span style={{ fontSize: 12, color: saveMsg.includes('✓') ? '#2e7d32' : '#c62828' }}>
              {saveMsg}
            </span>
          )}
        </div>
      </div>

      {/* PDF 생성 버튼 */}
      <div style={det.card}>
        <div style={det.cardTitle}>서류 자동 생성 (PDF)</div>
        {!bomOk && (
          <div style={det.bomWarn}>
            차체형식(탑 종류·높이·도어)이 선택되지 않아 서류를 생성할 수 없습니다.
            영업 화면에서 BODYTYPE·TOP·DOORTYPE 옵션을 모두 선택한 뒤 다시 시도해 주세요.
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, opacity: bomOk ? 1 : 0.4, pointerEvents: bomOk ? 'auto' : 'none' }}>
          {[
            { label: '주요제원대비표',  type: 'spec-table',  desc: '별지 제33호의2서식 — 튜닝 전·후 제원 비교', ready: true },
            { label: '하중계산서',      type: 'load-calc',   desc: '탈거/설치 BOM · 하중분포 · 법규판정', ready: true },
            { label: '작업지시서',      type: 'work-order',  desc: '선택 사양 · 작업 내역 (특장사 수령용)', ready: false },
          ].map(({ label, type, desc, ready }) => (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' as const }}>
              {ready ? (
                <a
                  href={pdfUrl(type)}
                  target="_blank"
                  rel="noreferrer"
                  style={det.pdfBtn}
                >
                  {label} PDF →
                </a>
              ) : (
                <span style={{ ...det.pdfBtn, opacity: 0.45, cursor: 'not-allowed' }} aria-disabled="true">
                  {label} (준비 중)
                </span>
              )}
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{desc}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 10 }}>
          ※ 차량정보(등록번호 등)를 먼저 저장하면 서류에 자동 반영됩니다.
        </div>
      </div>
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
  const { session } = useAuth()
  const [detail, setDetail] = useState<ApiOrderMakerDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<'spec' | 'docs' | 'load'>('spec')
  const isMobile = useIsMobile()

  const role = session?.user.role ?? 'SALES'
  const canViewLoadDocs = role === 'ADMIN' || role === 'MAKER'

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
        <button style={tab === 'spec' ? det.tabActive : det.tabBtn} onClick={() => setTab('spec')}>
          사양
        </button>
        {canViewLoadDocs && (
          <>
            <button style={tab === 'docs' ? det.tabActive : det.tabBtn} onClick={() => setTab('docs')}>
              서류 ({detail.documents.length})
            </button>
            <button style={tab === 'load' ? det.tabActive : det.tabBtn} onClick={() => setTab('load')}>
              하중·법규
            </button>
          </>
        )}
      </div>

      {/* 사양 탭 */}
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

      {/* 서류 탭 */}
      {tab === 'docs' && canViewLoadDocs && (
        <div style={det.section}>
          <DocsTab
            orderId={detail.id}
            documents={detail.documents}
            vehicleInfo={detail.vehicle_info}
            options={detail.options}
          />
        </div>
      )}

      {/* 하중·법규 탭 */}
      {tab === 'load' && canViewLoadDocs && (
        <div style={det.section}>
          <LoadCalcTab modelCode={detail.model_code} options={detail.options} />
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
  orderId: { fontWeight: 800, color: 'var(--dark)' },
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
  card: { border: '1px solid var(--line)', borderRadius: 10, padding: '14px 16px', background: '#fff' },
  cardTitle: { fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 12 },
  infoGrid: { display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px 12px', alignItems: 'center' },
  infoLabel: { fontSize: 12, color: 'var(--muted)', fontWeight: 600 },
  infoInput: { width: '100%', boxSizing: 'border-box' as const, fontSize: 13, padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 7 },
  saveBtn: {
    fontSize: 13, padding: '8px 18px', borderRadius: 8,
    background: 'var(--lime)', border: 'none', cursor: 'pointer',
    fontWeight: 700, color: 'var(--dark)', minHeight: 40,
  },
  pdfBtn: {
    display: 'inline-block', padding: '8px 16px', borderRadius: 8,
    background: '#1a1a1a', color: '#fff', textDecoration: 'none',
    fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' as const,
  },
  bomWarn: {
    fontSize: 12, color: '#92400e', background: '#fffbeb',
    border: '1px solid #fde68a', borderRadius: 8,
    padding: '10px 14px', marginBottom: 12, lineHeight: 1.6,
  },
}

const detMob: Record<string, React.CSSProperties> = {
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--line)', gap: 12 },
  label: { fontSize: 12, color: 'var(--muted)', flexShrink: 0 },
  value: { fontSize: 13, fontWeight: 600, color: 'var(--dark)', textAlign: 'right' as const },
}

const lc: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 8 },
  err:  { color: 'var(--warn)', fontSize: 13 },
  muted: { color: 'var(--muted)', fontSize: 13, padding: '16px 0' },
  card: { border: '1px solid var(--line)', borderRadius: 10, padding: '14px 16px', background: '#fff' },
  cardTitle: { fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 12 },
  specGrid: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '5px 16px', fontSize: 13 },
  specLabel: { color: 'var(--muted)', fontSize: 12 },
  specVal: { fontWeight: 600, color: 'var(--dark)' },
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

