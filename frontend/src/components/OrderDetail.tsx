import { useEffect, useMemo, useRef, useState, Fragment } from 'react'
import { openPdf } from '../lib/openPdf'
import type { ApiOrderMakerDetail, OrderVehicleInfo } from '@shared/types/index'
import { calcBom } from '@buildup-ev/shared/bom'
import { calcLoad } from '@buildup-ev/shared/load-calc'
import { fetchOrderDetail } from '../api/orders'
import { fetchModelSpec, type ModelSpec } from '../api/models'
import { saveVehicleInfo } from '../api/orders'
import { useAuth } from '../contexts/AuthContext'
import { rolesOf } from '@shared/types/index'
import { useIsMobile } from '../hooks/useIsMobile'
import { PdfModal } from './PdfModal'
import { OrderStepsPanel } from './OrderStepsPanel'
import { OrderChatTab } from './OrderChatTab'
import { PurchaseOrderSheet } from './PurchaseOrderSheet'
import { OrderRemoveModal } from './OrderRemoveModal'
import { safeLeft, safeRight, safeScrollBottom } from '../styles/safeArea'
import { fetchUnread } from '../api/stepComments'
import { useChatPoll, CHAT_POLL_IDLE_MS } from '../lib/chatPoll'
import { OrderEvidenceList } from './OrderEvidenceList'
import { usePermission } from './PermGate'

const DOC_STATUS_LABEL: Record<string, string> = { pending: '준비중', done: '완료', na: '해당없음' }
const DOC_STATUS_STYLE: Record<string, React.CSSProperties> = {
  pending: { background: 'var(--warnbg)', color: 'var(--warn)' },
  done:    { background: 'var(--lime-bg)', color: 'var(--dark)' },
  na:      { background: 'var(--card)', color: 'var(--muted)' },
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
            <tr><td colSpan={3} style={{ ...lc.td, fontWeight: 700, background: 'var(--card)' }}>탈거</td></tr>
            {bom.remove_items.map((i, idx) => (
              <tr key={`r${idx}`}>
                <td style={lc.td}>{i.label}</td>
                <td style={lc.tdR}>{i.weight_kg}</td>
                <td style={lc.tdR}>{i.cg_x_mm}</td>
              </tr>
            ))}
            <tr><td colSpan={3} style={{ ...lc.td, fontWeight: 700, background: 'var(--card)' }}>설치</td></tr>
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
  canViewContract,
  canViewStructDocs,
}: {
  orderId: number
  documents: ApiOrderMakerDetail['documents']
  vehicleInfo?: OrderVehicleInfo | null
  options: ApiOrderMakerDetail['options']
  /** 계약서(영업·관리자) 노출 여부 */
  canViewContract: boolean
  /** 구조변경 서류(관리자·특장사) 노출 여부 */
  canViewStructDocs: boolean
}) {
  const [info, setInfo] = useState<OrderVehicleInfo>(initInfo ?? {})
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [docPreview, setDocPreview] = useState<{ url: string; title: string } | null>(null)

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
            <div key={doc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '0.5px solid var(--line)' }}>
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
            <span style={{ fontSize: 12, color: saveMsg.includes('✓') ? 'var(--dark)' : 'var(--warn)' }}>
              {saveMsg}
            </span>
          )}
        </div>
      </div>

      {/* PDF 생성 버튼 */}
      <div style={det.card}>
        <div style={det.cardTitle}>서류 자동 생성 (PDF)</div>
        {canViewStructDocs && !bomOk && (
          <div style={det.bomWarn}>
            차체형식(탑 종류·높이·도어)이 선택되지 않아 서류를 생성할 수 없습니다.
            영업 화면에서 BODYTYPE·TOP·DOORTYPE 옵션을 모두 선택한 뒤 다시 시도해 주세요.
          </div>
        )}
        {canViewStructDocs && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, opacity: bomOk ? 1 : 0.4, pointerEvents: bomOk ? 'auto' : 'none' }}>
          {[
            { label: '주요제원대비표',  type: 'spec-table',  desc: '별지 제33호의2서식 — 튜닝 전·후 제원 비교', ready: true },
            { label: '하중계산서',      type: 'load-calc',   desc: '탈거/설치 BOM · 하중분포 · 법규판정', ready: true },
            { label: '작업지시서',      type: 'work-order',  desc: '선택 사양 · 작업 내역 (특장사 수령용)', ready: false },
          ].map(({ label, type, desc, ready }) => (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' as const }}>
              {ready ? (
                <button
                  type="button"
                  onClick={() => setDocPreview({ url: pdfUrl(type), title: label })}
                  style={det.pdfBtn}
                >
                  {label} 미리보기
                </button>
              ) : (
                <span style={{ ...det.pdfBtn, opacity: 0.45, cursor: 'not-allowed' }} aria-disabled="true">
                  {label} (준비 중)
                </span>
              )}
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{desc}</span>
            </div>
          ))}
        </div>
        )}
        {canViewStructDocs && (
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 10 }}>
          ※ 차량정보(등록번호 등)를 먼저 저장하면 서류에 자동 반영됩니다.
        </div>
        )}

        {/* 계약서는 BOM(차체형식) 없이도 생성 가능 — 영업·관리자만 */}
        {canViewContract && (
          <div style={{ borderTop: canViewStructDocs ? 'var(--hairline)' : undefined, marginTop: canViewStructDocs ? 12 : 0, paddingTop: canViewStructDocs ? 12 : 0, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' as const }}>
            <button
              type="button"
              onClick={() => openPdf(pdfUrl('contract'), '계약서.pdf')}
              style={det.pdfBtn}
            >
              특장 매매계약서 미리보기
            </button>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>계약정보·매수인·특장사양·금액 자동 기입 (서명란은 수기)</span>
          </div>
        )}
      </div>
      {docPreview && (
        <PdfModal
          previewUrl={docPreview.url}
          downloadUrl={docPreview.url}
          title={docPreview.title}
          onClose={() => setDocPreview(null)}
        />
      )}
    </div>
  )
}

// ── 공유 OrderDetail 컴포넌트 ─────────────────────────────────────────────────

interface Props {
  orderId: number
  onBack: () => void
  backLabel?: string
  /** 넘기면 제목 줄에 「주문 삭제」가 뜬다. 권한이 없으면 넘기지 않는다 */
  onRemove?: () => void
  /**
   * 특장사 화면 여부. true 면 계약서 영역을 **role 과 무관하게** 렌더하지 않는다.
   * 특장사가 볼 수 있는 서류는 구조변경 관련 서류뿐 — 관리자 계정으로 특장사
   * 화면을 열어도 계약서가 보이면 안 되므로 role 게이트만으로는 부족하다.
   */
  makerView?: boolean
  /**
   * 처음 열 탭. 푸시 알림을 눌러 들어오면 `'chat'` 으로 열린다 —
   * 알림이 말하는 내용이 거기 있는데 단계 탭부터 보여 주면 다시 찾아야 한다.
   */
  initialTab?: 'steps' | 'spec' | 'docs' | 'load' | 'chat'
  /** 대화 탭에서 미리 골라 둘 단계 코드(알림이 온 그 단계) */
  initialChatStep?: string
}

export function OrderDetail({ orderId, onBack, backLabel = '← 배정 주문', makerView = false, onRemove, initialTab, initialChatStep }: Props) {
  // 기능모듈 「주문 상태 변경」 — 계정별로 켜고 끌 수 있다
  const canChangeSteps = usePermission('order.control')
  const { session } = useAuth()
  const [detail, setDetail] = useState<ApiOrderMakerDetail | null>(null)
  /** 삭제 확인 팝업 — 바로 지우지 않는다 */
  const [removing, setRemoving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  // 기본은 「단계」 — 이 화면에 오는 이유가 다음에 할 일을 아는 것이다
  const [tab, setTab] = useState<'steps' | 'spec' | 'docs' | 'load' | 'chat'>(initialTab ?? 'steps')

  /*
   * **안 읽은 대화가 있으면 「대화」 탭 전체를 칠한다.**
   *
   * 빨간 점만으로는 다른 탭을 보고 있을 때 눈에 안 들어온다 — 윈도우 작업표시줄이
   * 새 알림을 버튼째 물들이는 것과 같은 방식으로, 탭 자체를 주황으로 채운다.
   *
   * 대화 탭에 들어가 있는 동안은 켜지 않는다 — 지금 읽고 있는 것을 「안 읽음」이라고
   * 말하는 셈이 된다.
   */
  const [unreadChat, setUnreadChat] = useState(0)
  const loadUnread = () => {
    fetchUnread(orderId)
      .then(u => setUnreadChat(Object.values(u).reduce((a, n) => a + n, 0)))
      .catch(() => { /* 표시가 안 켜질 뿐이다 */ })
  }
  useChatPoll(
    () => {
      // 대화 탭에 있는 동안은 묻지 않는다 — 지금 읽고 있는 것을 「안 읽음」이라 할 수 없다
      if (tab === 'chat') return
      loadUnread()
    },
    () => CHAT_POLL_IDLE_MS,
    [orderId],
  )
  useEffect(() => {
    // 처음 열 때 한 번, 그리고 대화 탭에 들어가면 바로 끈다
    if (tab === 'chat') { setUnreadChat(0); return }
    loadUnread()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, tab])

  /*
   * **주문 번호와 탭은 붙박이, 아래 내용만 스크롤된다.**
   *
   * 목록이 길어지면 지금 어느 주문의 무슨 탭을 보고 있는지 잃는다. 남은 화면 높이를
   * 재서 그만큼만 차지하게 하고, 그 안에서만 스크롤시킨다.
   * `100vh` 를 쓰지 않는 이유: 모바일 주소창이 접혔다 펴지며 실제 높이가 달라지는데
   * `vh` 는 그걸 안 따라간다. `innerHeight` 는 따라간다.
   */
  const rootRef = useRef<HTMLDivElement>(null)
  /*
   * 높이는 **부모를 채워서** 얻는다 — 여기서 뷰포트를 다시 재지 않는다.
   *
   * 예전엔 `visualViewport` 로 직접 쟀는데, 그 값(실제 보이는 높이)과
   * `getBoundingClientRect().top`(레이아웃 뷰포트 기준)은 아이폰에서 **좌표계가 다르다.**
   * 둘을 섞어 계산한 높이가 화면보다 커지면서 바깥 칸이 넘쳐 스크롤이 생겼고,
   * 손가락으로 당기면 화면이 통째로 출렁였다(사진 제보).
   * 뷰포트를 재는 곳은 이제 `useAppHeight` 한 곳뿐이고, 여기는 따라 늘어나기만 한다.
   */
  const isMobile = useIsMobile()

  const role = session?.user.role ?? 'SALES'
  const canViewLoadDocs = role === 'ADMIN' || role === 'MAKER'   // 구조변경 서류(하중·제원)
  const canViewContract = !makerView && (role === 'ADMIN' || role === 'SALES')  // 계약서(영업 업무)
  const canViewDocsTab = canViewLoadDocs || canViewContract

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

  return (
    <div
      ref={rootRef}
      style={{ ...det.root, maxWidth: isMobile ? '100%' : 720 }}
    >
      {/* 헤더 */}
      <div style={det.header}>
        <button style={det.backBtn} onClick={onBack}>{backLabel}</button>
        <div style={det.titleRow}>
          <span style={{ ...det.orderId, fontSize: isMobile ? 18 : 20 }}>주문 #{detail.id}</span>
          <span style={det.model}>{detail.model_code}</span>
          {/*
            주문 삭제 — **권한이 있는 관리자에게만** 보인다. 특장사에게는 자리 자체가 없다.
            바로 지우지 않는다: 눌러도 팝업이 먼저 뜨고 사유를 적어야 지워진다.
          */}
          {onRemove && (
            <button style={det.removeBtn} onClick={() => setRemoving(true)}>주문 삭제</button>
          )}
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

      {/*
        옛 6단계 진행 띠를 걷어냈다. 그 6단계는 확정된 적이 없고, 차량·특장이 따로 도는
        지금은 한 주문이 동시에 여러 곳에 있어 한 줄로 그릴 수 없다.
        진행은 아래 「단계」 탭이 네 갈래로 보여준다.
      */}

      {/* 탭 */}
      <div style={det.tabs}>
        {/*
          「단계」가 맨 앞이자 기본이다 — 이 화면에 오는 이유는 **다음에 뭘 해야 하는지**
          알기 위해서다. 사양·서류·하중은 그 다음에 찾아보는 배경 정보다.
        */}
        <button style={tab === 'steps' ? det.tabActive : det.tabBtn} onClick={() => setTab('steps')}>
          단계
        </button>
        <button style={tab === 'spec' ? det.tabActive : det.tabBtn} onClick={() => setTab('spec')}>
          사양
        </button>
        {canViewDocsTab && (
          <>
            <button style={tab === 'docs' ? det.tabActive : det.tabBtn} onClick={() => setTab('docs')}>
              서류 ({detail.documents.length})
            </button>
            {canViewLoadDocs && (
              <button style={tab === 'load' ? det.tabActive : det.tabBtn} onClick={() => setTab('load')}>
                하중·법규
              </button>
            )}
          </>
        )}
        {/*
          대화 — **목록 제일 끝.** 단계별 창이 그 단계에 집중하는 자리라면,
          여기는 오간 이야기를 시간순으로 한 줄로 읽는 자리다.
        */}
        <button
          style={
            tab === 'chat' ? det.tabActive
            : unreadChat > 0 ? det.tabAlert
            : det.tabBtn
          }
          onClick={() => setTab('chat')}
          aria-label={unreadChat > 0 ? '대화 — 안 읽은 글 있음' : '대화'}
        >
          대화
        </button>
      </div>

      {/*
        여기서부터가 **스크롤되는 영역**이다. 위(주문 번호·탭)는 늘 붙어 있어야
        어느 주문의 무슨 탭을 보고 있는지 잃지 않는다 — 목록이 길어지면 특히 그렇다.
        대화 탭은 스스로 높이를 채우므로 이 상자가 넘치지 않는다.
      */}
      <div style={tab === 'chat' ? det.bodyFixed : det.body}>

      {tab === 'chat' && (
        <OrderChatTab
          orderId={detail.id}
          canWrite={rolesOf(session!.user).some(r => r === 'ADMIN' || r === 'MAKER')}
          initialStep={initialChatStep}
        />
      )}

      {tab === 'steps' && (
        <div style={det.section}>
          {/*
            단계를 **바꾸는** 권한이 없으면 완료·등록·삭제 버튼을 아예 두지 않는다.
            눌러 보고 403 을 받게 하는 것은 안내가 아니다 — 기능모듈 「주문 상태 변경」
            (order.control)이 꺼진 계정에는 조회만 보인다. 서버도 같은 권한으로 막는다.
          */}
          <OrderStepsPanel
            orderId={detail.id}
            canEdit={canChangeSteps}
            /* 여기서 대화를 읽어 0 이 되면 「대화」 탭 강조도 그 자리에서 꺼진다 */
            onUnreadChange={setUnreadChat}
          />
        </div>
      )}

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

          {/*
            비고 — 배정할 때 적힌 **이 주문만의 요청사항.** 사양의 마지막 줄에 둔다:
            무엇을 만들지 다 읽은 뒤에 「단, 이 건은」을 읽는 순서가 맞다.
            줄바꿈·띄어쓰기는 적은 그대로 보여준다.
          */}
          <div style={det.remarkHead}>비고</div>
          {detail.remark?.trim()
            ? <div style={det.remarkBody}>{detail.remark}</div>
            : <div style={det.remarkNone}>특별 요청사항 없음</div>}
        </div>
      )}

      {/* 서류 탭 */}
      {tab === 'docs' && canViewDocsTab && (
        <div style={det.section}>
          {/*
            발주서 — **수락하고 나면 다시 볼 방법이 없었다**(수락 팝업에서만 보였다).
            납기·비고를 나중에 확인할 일이 잦으므로 서류 탭 맨 위에 그대로 둔다.
          */}
          <div style={det.poHead}>발주서</div>
          <PurchaseOrderSheet
            orderId={detail.id}
            orderedAt={new Date(detail.assigned_at ?? detail.created_at)}
            makerOrgName={detail.maker_org_name ?? ''}
            modelCode={detail.model_code}
            options={detail.options}
            deliveryDue={detail.delivery_due?.slice(0, 10) ?? ''}
            remark={detail.remark ?? ''}
          />
          <div style={det.poGap} />
          <DocsTab
            orderId={detail.id}
            documents={detail.documents}
            vehicleInfo={detail.vehicle_info}
            options={detail.options}
            canViewContract={canViewContract}
            canViewStructDocs={canViewLoadDocs}
          />
        
          {/*
            자동 생성 서류(위)와 **사람이 올린 증빙**(아래)을 한 탭에서 본다.
            관리자와 특장사 모두 「그동안 올린 게 다 어디 있나」를 여기서 답한다.
          */}
          <div style={{ marginTop: 'var(--sp-5)' }}>
            <OrderEvidenceList orderId={detail.id} />
          </div>
        </div>
      )}

      {/* 하중·법규 탭 */}
      {tab === 'load' && canViewLoadDocs && (
        <div style={det.section}>
          <LoadCalcTab modelCode={detail.model_code} options={detail.options} />
        </div>
      )}

      </div>

      {removing && onRemove && (
        <OrderRemoveModal
          orderId={detail.id}
          onClose={() => setRemoving(false)}
          onDone={() => { setRemoving(false); onRemove() }}
        />
      )}
    </div>
  )
}

// ── 스타일 ────────────────────────────────────────────────────────────────────

const det: Record<string, React.CSSProperties> = {
  /**
   * 주문 번호·탭은 붙박이, 아래만 스크롤. 높이는 화면을 재서 정한다(아래 useEffect) —
   * `vh` 는 모바일 주소창이 접혔다 펴질 때 따라가지 못한다.
   */
  /** 부모(각 화면의 본문 칸)를 그대로 채운다 — 넘치지 않으므로 바깥이 스크롤되지 않는다 */
  /**
   * 부모(각 화면의 본문 칸)를 그대로 채운다 — 넘치지 않으므로 바깥이 스크롤되지 않는다.
   *
   * 좌우 여백은 **여기 한 곳**에서 준다. 예전엔 스크롤 칸(body)에만 줘서 헤더 줄만
   * 12px, 본문은 19px 로 어긋났다 — 「주문 삭제」가 화면 끝에 붙어 잘려 보인다.
   */
  root: {
    display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720,
    height: '100%', minHeight: 0,
    paddingLeft: safeLeft('var(--sp-2)'),
    paddingRight: safeRight('var(--sp-2)'),
    boxSizing: 'border-box',
  },
  /** 탭 내용 — 여기만 스크롤된다 */
  /**
   * 탭 내용 — 여기만 스크롤된다.
   *
   * 좌우로 벌린다: 예전엔 여백이 12px 뿐이라 오른쪽 끝 버튼(대화·업로드)이
   * 실기기에서 잘려 보였다(사진 제보). 가로 안전영역까지 더해 둔다.
   * 바닥은 **살짝만** — 고정된 바가 없는 화면이라 내용을 꽉 채우고 곡률만 피한다.
   */
  body: {
    flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden',
    // 끝까지 당겨도 바깥으로 넘기지 않는다 — 넘기면 화면 전체가 출렁인다
    overscrollBehavior: 'contain',
    // 좌우는 root 가 준다(헤더·탭과 같은 선). 여기는 바닥만 살짝
    paddingBottom: safeScrollBottom(),
  },
  /** 대화 탭은 자기가 높이를 채운다 — 이중 스크롤이 생기지 않게 넘김을 막는다 */
  bodyFixed: { flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  loading: { color: 'var(--muted)', fontSize: 14, padding: '40px 0' },
  err: { color: 'var(--warn)', fontSize: 13 },
  header: { display: 'flex', flexDirection: 'column', gap: 8 },
  backBtn: {
    alignSelf: 'flex-start', fontSize: 12, padding: '5px 12px',
    border: '0.5px solid var(--line)', borderRadius: 7, background: '#fff',
    cursor: 'pointer', color: 'var(--muted)', marginBottom: 4, minHeight: 44,
  },
  titleRow: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const },
  orderId: { fontWeight: 800, color: 'var(--dark)' },
  statusBadge: { fontSize: 12, fontWeight: 700, padding: '4px 12px', background: 'var(--lime)', color: 'var(--dark)', borderRadius: 14 },
  model: { fontSize: 14, color: 'var(--muted)', fontWeight: 600 },
  metaRow: { display: 'flex', gap: 6, fontSize: 12, color: 'var(--muted)', flexWrap: 'wrap' as const },
  sep: { color: 'var(--line)' },
  progressSection: { display: 'flex', alignItems: 'flex-start', border: '0.5px solid var(--line)', borderRadius: 10, padding: '12px 16px', background: '#fff' },
  stepItem: { display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 },
  stepDot: { width: 10, height: 10, borderRadius: '50%', background: 'var(--line)', marginBottom: 6 },
  stepDotActive: { width: 10, height: 10, borderRadius: '50%', background: 'var(--lime)', marginBottom: 6 },
  stepLabel: { fontSize: 9.5, color: 'var(--muted)', textAlign: 'center' as const },
  stepLabelActive: { fontSize: 9.5, color: 'var(--dark)', fontWeight: 700, textAlign: 'center' as const },
  tabs: { display: 'flex', gap: 4, borderBottom: '2px solid var(--line)', paddingBottom: 0 },
  tabBtn: { padding: '8px 18px', border: 'none', borderBottom: '2px solid transparent', background: 'transparent', cursor: 'pointer', fontSize: 13, color: 'var(--muted)', fontWeight: 600, marginBottom: -2, minHeight: 44 },
  tabActive: { padding: '8px 18px', border: 'none', borderBottom: '2px solid var(--dark)', background: 'transparent', cursor: 'pointer', fontSize: 13, color: 'var(--dark)', fontWeight: 700, marginBottom: -2, minHeight: 44 },
  /**
   * 안 읽은 대화가 있는 탭 — **버튼째 주황으로 채운다.**
   *
   * 점 하나로는 다른 탭을 보고 있을 때 눈에 안 들어온다. 윈도우 작업표시줄이 새 알림을
   * 버튼째 물들이는 것과 같은 방식이다. 크기·자리는 다른 탭과 똑같이 둔다 —
   * 색만 달라야 줄이 흔들리지 않는다.
   */
  tabAlert: {
    padding: '8px 18px', border: 'none', borderBottom: '2px solid var(--alert)',
    /*
     * 아래가 제일 진하고 위로 갈수록 투명해진다 — 밑줄에서 색이 배어 오르는 모양.
     * 통째로 칠하고 모서리를 둥글게 하면 그 탭만 다른 부품처럼 튀어 보인다(제보).
     * 글자는 본래 색 그대로 둔다 — 흰 글자로 바꾸면 옅어지는 위쪽에서 읽히지 않는다.
     */
    background: 'linear-gradient(to top, var(--alert-fade), transparent)',
    cursor: 'pointer', fontSize: 13,
    color: 'var(--dark)', fontWeight: 700, marginBottom: -2, minHeight: 44,
  },
  section: { paddingTop: 4 },
  /** 삭제는 되돌리기 어렵다 — 경고색 테두리로만, 채우지 않는다 */
  /**
   * 주문 삭제 — 제목 줄 오른쪽.
   *
   * ⚠️ 높이를 **숫자로 못 박지 않는다.** 예전엔 `minHeight: 32` 였는데, 손가락 기기에서는
   *    글자가 커져 32px 안에 안 들어가 **아래가 잘려 보였다**(사진 제보).
   *    앱의 작은 버튼 규격(`--h-control-sm`)을 쓰면 손가락 기기에서 44px 로 자란다 —
   *    같은 줄의 다른 버튼과도 크기가 맞고, 44×44 터치 기준도 지킨다.
   *    글자는 `inline-flex` 로 가운데 세운다 — 여백으로 맞추면 글꼴이 커질 때 또 잘린다.
   */
  removeBtn: {
    marginLeft: 'auto', flexShrink: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    border: '0.5px solid var(--warn)', background: '#fff', color: 'var(--warn)',
    borderRadius: 7, padding: '0 12px', fontSize: 'var(--fs-caption)',
    cursor: 'pointer', fontFamily: 'inherit',
    minHeight: 'max(32px, var(--h-control-sm))',
  },
  remarkHead: { fontSize: 'var(--fs-label)', fontWeight: 700, color: 'var(--dark)', marginTop: 'var(--sp-5)', marginBottom: 'var(--sp-2)' },
  remarkBody: {
    whiteSpace: 'pre-wrap' as const, fontSize: 'var(--fs-body)', lineHeight: 1.6,
    background: 'var(--card)', borderRadius: 8, padding: 'var(--sp-3)', color: 'var(--dark)',
  },
  remarkNone: { fontSize: 'var(--fs-body)', color: 'var(--muted)' },
  poHead: { fontSize: 'var(--fs-label)', fontWeight: 700, color: 'var(--dark)', marginBottom: 'var(--sp-2)' },
  poGap: { height: 'var(--sp-6)' },
  empty: { color: 'var(--muted)', fontSize: 13, padding: '24px 0', textAlign: 'center' as const },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  th: { textAlign: 'left' as const, padding: '8px 12px', borderBottom: '2px solid var(--line)', color: 'var(--muted)', fontWeight: 600, fontSize: 12 },
  tdLabel: { padding: '10px 12px', borderBottom: '0.5px solid var(--line)', color: 'var(--muted)', fontSize: 12, width: '40%' },
  tdValue: { padding: '10px 12px', borderBottom: '0.5px solid var(--line)', fontWeight: 600, color: 'var(--dark)' },
  docBadge: { fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 8 },
  card: { border: '0.5px solid var(--line)', borderRadius: 10, padding: '14px 16px', background: '#fff' },
  cardTitle: { fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 12 },
  infoGrid: { display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px 12px', alignItems: 'center' },
  infoLabel: { fontSize: 12, color: 'var(--muted)', fontWeight: 600 },
  infoInput: { width: '100%', boxSizing: 'border-box' as const, fontSize: 13, padding: '7px 10px', border: '0.5px solid var(--line)', borderRadius: 7 },
  saveBtn: {
    fontSize: 13, padding: '8px 18px', borderRadius: 8,
    background: 'var(--lime)', border: 'none', cursor: 'pointer',
    fontWeight: 700, color: 'var(--dark)', minHeight: 40,
  },
  pdfBtn: {
    display: 'inline-block', padding: '8px 16px', borderRadius: 8, border: 'none',
    background: 'var(--dark)', color: '#fff', textDecoration: 'none', cursor: 'pointer',
    fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' as const, fontFamily: 'inherit',
  },
  bomWarn: {
    fontSize: 12, color: 'var(--warn)', background: 'var(--warnbg)',
    border: '0.5px solid var(--warn)', borderRadius: 8,
    padding: '10px 14px', marginBottom: 12, lineHeight: 1.6,
  },
}

const detMob: Record<string, React.CSSProperties> = {
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '0.5px solid var(--line)', gap: 12 },
  label: { fontSize: 12, color: 'var(--muted)', flexShrink: 0 },
  value: { fontSize: 13, fontWeight: 600, color: 'var(--dark)', textAlign: 'right' as const },
}

const lc: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 8 },
  err:  { color: 'var(--warn)', fontSize: 13 },
  muted: { color: 'var(--muted)', fontSize: 13, padding: '16px 0' },
  card: { border: '0.5px solid var(--line)', borderRadius: 10, padding: '14px 16px', background: '#fff' },
  cardTitle: { fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 12 },
  specGrid: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '5px 16px', fontSize: 13 },
  specLabel: { color: 'var(--muted)', fontSize: 12 },
  specVal: { fontWeight: 600, color: 'var(--dark)' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  th:  { textAlign: 'left' as const,  padding: '7px 10px', borderBottom: '2px solid var(--line)', color: 'var(--muted)', fontWeight: 600, fontSize: 12 },
  thR: { textAlign: 'right' as const, padding: '7px 10px', borderBottom: '2px solid var(--line)', color: 'var(--muted)', fontWeight: 600, fontSize: 12 },
  td:  { padding: '9px 10px', borderBottom: '0.5px solid var(--line)', color: 'var(--muted)', fontSize: 12 },
  tdR: { padding: '9px 10px', borderBottom: '0.5px solid var(--line)', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'var(--dark)' },
  legalGrid: { display: 'flex', flexDirection: 'column', gap: 10 },
  legalRow: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const },
  legalLabel: { fontSize: 12, fontWeight: 700, color: 'var(--dark)', minWidth: 100 },
  legalDetail: { flex: 1, fontSize: 12, color: 'var(--dark)' },
  badgeOk:   { fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 8, background: 'var(--lime-bg)', color: 'var(--dark)', whiteSpace: 'nowrap' as const },
  badgeNg:   { fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 8, background: 'var(--warnbg)', color: 'var(--warn)', whiteSpace: 'nowrap' as const },
  badgeGray: { fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 8, background: 'var(--card)', color: 'var(--muted)', whiteSpace: 'nowrap' as const },
}

