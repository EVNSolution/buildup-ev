import { useEffect, useMemo, useState } from 'react'
import { openPdf, reservePdfTab, openPdfIn, closeReservedTab } from '../lib/openPdf'
import { computeHidden, computeDisabledGroups, sanitizeSelections } from '../lib/optionRules'
import { buildLiveTotal } from '../lib/liveQuote'
import { mapBizType, customerEditValues } from '../lib/quoteCustomer'
import type { CustomerInfo, ApiPricingBundle, ApiQuote, ApiOrder } from '@shared/types/index'
import type { PricingResult, PricingOk } from '@shared/pricing/core'
import { calcPrice, assembleOptionSum, TAKBAE_RATE, DIESEL_CONVERSION_SUBSIDY } from '@shared/pricing/core'
import type { QuoteResult } from '@shared/pricing/core'
import { quotePriceExtras } from '@shared/pricing/quote-request'
import { fetchPricingBundle } from '../api/models'
import { saveQuote, fetchLocalSubsidy, fetchQuotes, fetchRegions, duplicateQuote, saveQuoteCustomer, saveQuoteInputs, acceptSalesQuote } from '../api/quotes'
import type { SaveQuoteRequest } from '../api/quotes'
import { fetchOrders } from '../api/orders'
import { BTN } from '../styles/buttons'
import stegoSide from '../assets/stego-k-side.jpg'
import { Header } from '../components/Header'
import { PriceBar } from '../components/PriceBar'
import { OptionPanel } from '../components/OptionPanel'
import { offValueCode } from '../components/OptionToggle'
import { QuoteSaveModal, valuesFromCustomer, missingForContract, type QuoteSaveValues } from '../components/QuoteSaveModal'
import { DEFAULT_SUBSIDY_INPUTS, type SubsidyInputs } from '../components/SubsidyInputs'
import { ContractPanel } from '../components/ContractPanel'
import { QuoteEditModal } from '../components/QuoteEditModal'
import { SalesPerformance } from '../components/SalesPerformance'
import { CustomerViewModal } from '../components/CustomerViewModal'
import { EmailSendModal } from '../components/EmailSendModal'
import { ConfirmQuoteModal } from '../components/ConfirmQuoteModal'
import { InboxPanel } from '../components/InboxPanel'
import { QuoteAcceptModal } from '../components/QuoteAcceptModal'
import { Tooltip } from '../components/Tooltip'
import { Tabs } from '../components/ui/Tabs'
import { Segmented } from '../components/ui/Segmented'
import { Badge, type BadgeTone } from '../components/ui/Badge'
import { EmptyState } from '../components/ui/EmptyState'
import { useIsCompact } from '../hooks/useIsCompact'
import { useIsPhone } from '../hooks/useIsPhone'
import { usePermission } from '../components/PermGate'
import { useAuth } from '../contexts/AuthContext'


// option_rule 해석(감춤·잠금·정리)은 lib/optionRules.ts 로 옮겼다 — 수정 팝업과 공용.

// ── 내 견적·주문 뷰 ────────────────────────────────────────────────────────
const QUOTE_STATUS_KO: Record<string, string> = {
  draft: '임시저장', confirmed: '견적확정', contracted: '계약완료',
  assigned: '배정완료', ordered: '주문진행', completed: '완료', expired: '만료',
}

const QUOTE_STATUS_FLOW = [
  { key: 'draft',      label: '임시저장', desc: '작성 중인 견적' },
  { key: 'confirmed',  label: '견적확정', desc: '견적서 생성 완료' },
  { key: 'contracted', label: '계약완료', desc: '전자서명 완료' },
  { key: 'assigned',   label: '배정완료', desc: '관리자가 특장사 배정' },
  { key: 'ordered',    label: '주문진행', desc: '특장사 수락 · 제작 진행' },
  { key: 'completed',  label: '완료',     desc: '특장사 전 공정 완료' },
] as const

function quoteStatusTip(status: string): React.ReactNode {
  return (
    <div>
      <div style={{ fontWeight: 700, marginBottom: 5, fontSize: 10.5, letterSpacing: 0.3 }}>견적 상태</div>
      {QUOTE_STATUS_FLOW.map((s, i) => (
        <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '2px 0', fontWeight: s.key === status ? 700 : 400, color: s.key === status ? 'var(--lime)' : 'var(--line)', fontSize: 11 }}>
          <span style={{ width: 16, textAlign: 'center', flexShrink: 0 }}>{i + 1}</span>
          <span>{s.label}</span>
          <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--muted)', marginLeft: 'var(--sp-1)' }}>({s.desc})</span>
          {s.key === status && <span style={{ fontSize: 9, color: 'var(--lime)', marginLeft: 2 }}>← 현재</span>}
        </div>
      ))}
      {status === 'expired' && <div style={{ fontSize: 10, color: 'var(--warn)', marginTop: 5 }}>만료/취소된 견적입니다</div>}
    </div>
  )
}


// 전자서명 진행 상태 — 팝업을 열지 않아도 목록에서 바로 보이게 한다.
const CONTRACT_LABEL: Record<string, string> = {
  DRAFT: '발송 실패', SENT: '서명 대기', VIEWED: '열람', SIGNING: '서명 중',
  COMPLETED: '서명 완료', REJECTED: '거절', CANCELED: '취소',
}
// 계약 상태 → 뱃지 뜻 4가지. 상태마다 색을 새로 만들면 색이 아무 뜻도 갖지 못한다.
const CONTRACT_TONE: Record<string, BadgeTone> = {
  COMPLETED: 'done',
  REJECTED:  'warn',
  CANCELED:  'warn',
}

function ContractBadge({ c }: { c?: { status: string; sent_at: string | null; completed_at: string | null } | null }) {
  if (!c) return <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
  const when = c.completed_at ?? c.sent_at
  return (
    <Tooltip text={`${CONTRACT_LABEL[c.status] ?? c.status}${when ? ` · ${when.slice(0, 10)}` : ''}`} placement="below">
      <Badge tone={CONTRACT_TONE[c.status] ?? 'progress'}>{CONTRACT_LABEL[c.status] ?? c.status}</Badge>
    </Tooltip>
  )
}

function fmtPrice(n: number) { return n ? `₩${n.toLocaleString()}` : '—' }
function fmtDate(s: string)  { return s ? s.slice(0, 10) : '—' }



function MyListView() {
  const [quotes, setQuotes]   = useState<ApiQuote[]>([])
  const [orders, setOrders]   = useState<ApiOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr]         = useState('')
  const [contractQuote, setContractQuote] = useState<
    { id: number; customerName?: string; customerEmail?: string; customerPhone?: string } | null>(null)
  /**
   * 계약서 만들기 직전 확인 — 견적서 단계에서 안 받은 값(생년월일·주소·세부주소)을 여기서 받는다.
   * 이미 다 채워져 있어도 **한 번은 띄운다** — 계약서에 그대로 박히는 값이라 눈으로 확인하고 넘어간다.
   */
  const [contractPrep, setContractPrep] = useState<{ quote: ApiQuote; next: 'pdf' | 'sign' } | null>(null)
  const [prepSaving, setPrepSaving] = useState(false)
  const [prepErr, setPrepErr] = useState('')
  // 확인 팝업 안에서 지역을 고칠 수 있어야 한다(보조금이 걸린 값)
  const [regions, setRegions] = useState<string[]>([])
  useEffect(() => { fetchRegions().then(setRegions).catch(() => setRegions([])) }, [])
  const [emailQuote, setEmailQuote] = useState<{ id: number; customerName?: string } | null>(null)
  const [confirmQuoteModal, setConfirmQuoteModal] = useState<
    { id: number; customerName?: string; status: string; inputs?: Record<string, unknown>; customer?: ApiQuote['customer'] } | null
  >(null)
  /** 고객정보 수정 — 저장 모달을 수정 모드로 재사용한다(입력 구성이 같다). */
  // 「수정」 = 옵션·고객정보·할부 3탭 팝업 / 「고객정보」 = 조회 전용
  const [editQuote, setEditQuote] = useState<ApiQuote | null>(null)
  const [viewQuote, setViewQuote] = useState<ApiQuote | null>(null)
  const [dupBusy, setDupBusy] = useState<number | null>(null)
  /** 배정 문의 — 상세를 열어 둔 건 / 수락 처리 중인 건 */
  const [acceptView, setAcceptView] = useState<ApiQuote | null>(null)
  const [acceptBusy, setAcceptBusy] = useState<number | null>(null)
  /**
   * 접어 둔 날짜 — 기본은 **가장 최근 날짜만 펼침**.
   * 목록이 쌓이면 "오늘 뭘 했나"를 먼저 보게 되고, 지난 날짜는 필요할 때만 편다.
   */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  // 권한 없는 버튼은 아예 감춘다 — 눌러서 403 을 보게 두면 왜 안 되는지 알 수 없다
  const canEdit = usePermission('quote.edit')
  const canEmail = usePermission('doc.send.email')
  const canSign = usePermission('doc.send.sign')

  /**
   * 같은 고객·같은 옵션으로 새 견적을 만든다.
   * 전자서명을 보낸 견적은 고정되어 고칠 수 없다 — 조건을 바꿔 다시 내려면 이 길을 쓴다.
   */
  async function handleDuplicate(q: ApiQuote) {
    if (!window.confirm(
      `${q.quote_no ?? `#${q.id}`} 의 옵션·고객정보·할부 조건을 그대로 복사해\n`
      + '새 견적(임시저장)을 만듭니다. 진행할까요?',
    )) return
    setDupBusy(q.id); setErr('')
    try {
      const r = await duplicateQuote(q.id)
      load()
      window.alert(`새 견적 ${r.quote_no ?? `#${r.id}`} 을(를) 만들었습니다. 「수정」에서 조건을 고친 뒤 견적서를 생성하세요.`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '견적 복제 실패')
    } finally { setDupBusy(null) }
  }

  function load() {
    setLoading(true); setErr('')
    Promise.all([fetchQuotes({}), fetchOrders({})])
      .then(([q, o]) => { setQuotes(q); setOrders(o) })
      .catch(e => setErr(e instanceof Error ? e.message : '로드 실패'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  // order_id 빠른 조회용 (quote_id → order)
  const orderByQuote = new Map(orders.map(o => [o.quote_id, o]))

  /*
   * 수락 대기 — 관리자가 나에게 배정한 **공개 창구 문의**.
   *
   * 배정만으로 담당이 정해졌다고 보지 않는다. 받겠다고 누르기 전까지는 「아무도 안 본 건」이라
   * 아래 목록에 섞여 묻히면 안 된다 — 그래서 목록 위에 따로 세운다.
   * (영업이 직접 만든 견적은 이미 자기 것이라 여기 오지 않는다)
   */
  const pendingAccept = quotes.filter(q => q.source === 'public' && !q.sales_accepted_at)

  async function handleAccept(quoteId: number) {
    setAcceptBusy(quoteId); setErr('')
    try {
      await acceptSalesQuote(quoteId)
      setAcceptView(null)
      load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '수락 실패')
    } finally { setAcceptBusy(null) }
  }

  /**
   * 날짜별 묶음 — 목록이 쌓이면 "언제 것인지"가 먼저 필요한 정보가 된다.
   * 서버가 최신순으로 주므로 **순서를 다시 정렬하지 않는다**(Map 이 삽입 순서를 지킨다).
   */
  const byDate = useMemo(() => {
    const m = new Map<string, ApiQuote[]>()
    for (const q of quotes) {
      const d = fmtDate(q.created_at)
      const list = m.get(d)
      if (list) list.push(q); else m.set(d, [q])
    }
    return [...m.entries()]
  }, [quotes])

  // 가장 최근 날짜만 펼쳐 둔다 — 목록을 처음 열었을 때 오늘 것부터 보이게
  useEffect(() => {
    if (byDate.length > 1) setCollapsed(new Set(byDate.slice(1).map(([d]) => d)))
  }, [byDate.length])

  /*
   * ⚠️ 첫 로드에서만 「로딩 중…」으로 갈아친다.
   *    저장 뒤 목록을 다시 읽을 때도 갈아치웠더니, 이 컴포넌트 안에 있는 **수정 팝업이
   *    통째로 사라졌다 다시 열려** 저장 메시지가 보이지 않고 화면이 깜빡였다.
   *    이미 한 번 받아 둔 목록이 있으면 그대로 두고 조용히 갱신한다.
   */
  if (loading && quotes.length === 0) return <div style={lv.empty}>로딩 중…</div>
  /*
   * ⚠️ 오류가 났다고 **목록을 통째로 갈아치우지 않는다.**
   *    예전에는 여기서 오류 문구만 남기고 return 했다. 그래서 목록을 다 받아 둔 뒤의
   *    실패(수락·복제 같은 동작 실패)에도 화면에서 견적이 전부 사라졌다 — 무엇이
   *    실패했는지도, 방금까지 보던 목록도 함께 없어졌다(수락 기능을 붙이다 실제로 겪음).
   *    받아 둔 목록이 없을 때만 오류로 화면을 채우고, 그 밖에는 목록 위에 띠로 얹는다.
   */
  if (err && quotes.length === 0) return <div style={{ ...lv.empty, color: 'var(--warn)' }}>{err}</div>

  return (
    <>
    
    
    {contractQuote && (
      <div
        style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}
      >
        <div style={{ width: 'min(460px, 94vw)', background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>계약 · 전자서명{contractQuote.customerName ? ` — ${contractQuote.customerName}` : ''}</span>
            {/* 팝업 안에서 서명을 요청하면 목록의 상태·발송현황이 달라진다 — 닫을 때 다시 읽는다 */}
            <button style={BTN.secondary} onClick={() => { setContractQuote(null); load() }}>✕</button>
          </div>
          <ContractPanel
            quoteId={contractQuote.id}
            customerName={contractQuote.customerName}
            customerEmail={contractQuote.customerEmail}
            customerPhone={contractQuote.customerPhone}
          />
        </div>
      </div>
    )}
    {emailQuote && (
      <EmailSendModal
        quoteId={emailQuote.id}
        customerName={emailQuote.customerName}
        onClose={() => setEmailQuote(null)}
      />
    )}
    {editQuote && (
      <QuoteEditModal
        quote={editQuote}
        onClose={() => setEditQuote(null)}
        onSaved={load}
      />
    )}
    {viewQuote && (
      <CustomerViewModal quote={viewQuote} onClose={() => setViewQuote(null)} />
    )}
    {/*
      계약서 만들기 직전 확인 — 견적서 단계에서 안 받은 값(생년월일·주소·세부주소)을 받는다.
      이미 채워져 있어도 한 번은 띄운다. 계약서에 그대로 박히는 값이라 눈으로 보고 넘어가야 한다.
    */}
    {contractPrep && (
      <QuoteSaveModal
        mode="contract"
        initial={customerEditValues(contractPrep.quote)}
        regions={regions}
        saving={prepSaving}
        error={prepErr}
        onClose={() => setContractPrep(null)}
        onSave={async values => {
          // ⚠️ 저장(await) 뒤에 window.open 을 부르면 팝업 차단에 걸린다.
          //    클릭한 지금 빈 탭을 먼저 잡아 두고, 저장이 끝나면 주소만 바꾼다.
          const pdfTab = contractPrep.next === 'pdf' ? reservePdfTab() : null
          setPrepSaving(true); setPrepErr('')
          try {
            const q = contractPrep.quote
            await saveQuoteCustomer(q.id, {
              name: values.name.trim(),
              phone: values.phone,
              email: values.email.trim(),
              address: values.address.trim(),
              address_detail: values.address_detail.trim(),
              reg_no: values.buyer_regno.trim(),
              ceo_name: values.subsidy.business_type === 'corporate' ? values.ceo_name.trim() : '',
              tel: values.buyer_tel,
            })
            await saveQuoteInputs(q.id, {
              biz_type: mapBizType(values.subsidy.business_type),
              is_sosang: values.subsidy.is_small_business ?? false,
              region: values.subsidy.region_code,
              has_transport_license: values.subsidy.has_transport_license ?? false,
              diesel_status: values.subsidy.diesel_status || 'none',
              ceo_name: values.subsidy.business_type === 'corporate' ? values.ceo_name.trim() : '',
              contract_party: values.contract_party.trim(),
              buyer_agent: values.buyer_agent.trim(),
              buyer_relation: values.buyer_relation.trim(),
              buyer_regno: values.buyer_regno.trim(),
              buyer_tel: values.buyer_tel,
            })
            const next = contractPrep.next
            setContractPrep(null)
            load()
            if (next === 'sign') {
              setContractQuote({
                id: q.id,
                customerName: values.name.trim() || (q.customer?.name ?? undefined),
                customerEmail: values.email.trim() || (q.customer?.email ?? undefined),
                customerPhone: values.phone || (q.customer?.phone ?? undefined),
              })
            } else {
              // 확인한 값으로 계약서를 새로 만들어 연다
              openPdfIn(pdfTab, `/api/v1/quotes/${q.id}/contract-pdf`)
            }
          } catch (e) {
            closeReservedTab(pdfTab)
            setPrepErr(e instanceof Error ? e.message : '저장 실패')
          } finally { setPrepSaving(false) }
        }}
      />
    )}
    {confirmQuoteModal && (
      <ConfirmQuoteModal
        quoteId={confirmQuoteModal.id}
        customerName={confirmQuoteModal.customerName}
        status={confirmQuoteModal.status}
        initialInputs={confirmQuoteModal.inputs}
        onClose={() => setConfirmQuoteModal(null)}
        onDone={load}
      />
    )}
    {acceptView && (
      <QuoteAcceptModal
        quote={acceptView}
        busy={acceptBusy === acceptView.id}
        // 이미 받은 건을 다시 열어 볼 때는 받기 버튼을 두지 않는다
        onAccept={acceptView.sales_accepted_at ? null : () => handleAccept(acceptView.id)}
        onClose={() => setAcceptView(null)}
      />
    )}
    <div style={lv.root}>
      {err && <div style={lv.errBar}>{err}</div>}
      <InboxPanel
        title="배정된 문의"
        items={pendingAccept.map(q => ({
          id: q.id,
          no: q.quote_no ?? `#${q.id}`,
          title: q.customer?.name ?? '고객 미상',
          sub: `${q.model_code} · ${fmtPrice(q.final_price)}`,
          meta: fmtDate(q.created_at),
        }))}
        acceptLabel="접수"
        busyId={acceptBusy}
        onView={id => setAcceptView(pendingAccept.find(q => q.id === id) ?? null)}
        onAccept={handleAccept}
      />
      <div style={lv.section}>
        <div style={lv.sectionTitle}>내 견적 ({quotes.length})</div>
        {quotes.length === 0 ? (
          <EmptyState
            title="아직 저장된 견적이 없습니다"
            description="컨피규레이터에서 옵션을 고르고 견적을 저장하면 여기에 쌓입니다."
          />
        ) : (
          <div style={lv.tableWrap}>
            <table style={lv.table}>
              <thead>
                <tr>
                  <th style={lv.th}>#</th>
                  <th style={lv.th}>고객</th>
                  <th style={lv.th}>실구매가</th>
                  <th style={lv.th}>상태</th>
                  <th style={lv.th}>전자서명</th>
                  <th style={lv.th}>주문 현황</th>
                  <th style={lv.th}>특장사</th>
                  <th style={lv.th}>날짜</th>
                  <th style={lv.th}></th>
                </tr>
              </thead>
              {byDate.map(([date, rows]) => {
                const isOpen = !collapsed.has(date)
                return (
              <tbody key={date}>
                {/*
                  날짜 머리 — 누르면 그 날짜만 접힌다.
                  건수만 붙인다. 금액 합계는 마이페이지가 따로 집계하므로 여기선 중복이다.
                */}
                <tr
                  style={lv.groupRow}
                  onClick={() => setCollapsed(prev => {
                    const next = new Set(prev)
                    next.has(date) ? next.delete(date) : next.add(date)
                    return next
                  })}
                >
                  <td colSpan={9} style={lv.groupCell}>
                    <span style={lv.groupArrow}>{isOpen ? '▾' : '▸'}</span>
                    <span style={lv.groupDate}>{date}</span>
                    <span style={lv.groupCount}>{rows.length}건</span>
                  </td>
                </tr>
                {isOpen && rows.map(q => {
                  const order = orderByQuote.get(q.id)
                  return (
                    <tr key={q.id}>
                      <td style={lv.td}>{q.quote_no ?? `#${q.id}`}</td>
                      <td style={lv.td}>{q.customer?.name ?? '—'}</td>
                      <td style={{ ...lv.td, fontVariantNumeric: 'tabular-nums', textAlign: 'right' as const }}>{fmtPrice(q.final_price)}</td>
                      <td style={lv.td}>
                        <Tooltip text={quoteStatusTip(q.status)} placement="below">
                          <Badge tone={q.status === 'draft' ? 'wait' : (q.status === 'confirmed' || q.status === 'assigned' || q.status === 'ordered') ? 'progress' : 'done'}>
                            {QUOTE_STATUS_KO[q.status] ?? q.status}
                          </Badge>
                        </Tooltip>
                      </td>
                      <td style={lv.td}><ContractBadge c={q.contract} /></td>
                      {/*
                        옛 6단계 문자열 대신 **단계 진행**을 보여준다.
                        영업이 여기서 알고 싶은 것은 「어느 칸에 있나」가 아니라
                        「얼마나 왔나 · 늦었나 · 언제 오나」다.
                      */}
                      <td style={lv.td}>
                        {order?.steps
                          ? (
                            <Tooltip text={order.steps.open.length ? order.steps.open.join(' · ') : '진행 대기'} placement="below">
                              <span style={order.steps.stalled ? lv.progLate : lv.prog}>
                                {order.steps.done}/{order.steps.total}
                                {order.steps.stalled ? ' 지연' : ''}
                              </span>
                            </Tooltip>
                          )
                          : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
                        }
                      </td>
                      <td style={{ ...lv.td, color: 'var(--muted)', fontSize: 12 }}>{q.order?.maker_org?.name ?? '—'}</td>
                      <td style={{ ...lv.td, color: 'var(--muted)', fontSize: 12 }}>{fmtDate(q.created_at)}</td>
                      <td style={lv.td}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'nowrap' }}>
                          {/* 「수정」 하나로 옵션·고객정보·할부를 전부 고친다(팝업 안에서 탭으로 나뉜다).
                              권한이 없으면 이력만 볼 수 있게 그대로 두되 라벨을 바꾼다. */}
                          <button
                            style={q.docs_frozen_at ? { ...lv.pdfBtn, opacity: 0.45 } : lv.pdfBtn}
                            title={q.docs_frozen_at
                              ? `전자서명 발송(${fmtDate(q.docs_frozen_at)})으로 서류가 고정되었습니다 — 이력만 볼 수 있습니다. 조건을 바꾸려면 「복제」로 새 견적을 만드세요.`
                              : '옵션 · 고객정보 · 할부 수정 및 수정 이력 (전자서명 발송 전까지 가능)'}
                            onClick={() => setEditQuote(q)}
                          >{q.docs_frozen_at || !canEdit ? '이력' : '수정'}</button>
                          {/* 전자서명을 보낸 견적은 고칠 수 없다 — 조건을 바꿔 다시 낼 땐 복제한다 */}
                          {canEdit && (
                          <button
                            style={dupBusy === q.id ? { ...lv.pdfBtn, opacity: 0.45 } : lv.pdfBtn}
                            disabled={dupBusy === q.id}
                            title="같은 고객·같은 옵션으로 새 견적을 만듭니다 (새 번호·임시저장)"
                            onClick={() => void handleDuplicate(q)}
                          >{dupBusy === q.id ? '…' : '복제'}</button>
                          )}
                          {/* 「고객정보」는 조회 전용 — 고치는 곳은 「수정」 한 군데로 모았다 */}
                          <button
                            style={lv.pdfBtn}
                            title="고객·계약 정보 조회 (수정 불가)"
                            onClick={() => setViewQuote(q)}
                          >고객정보</button>
                          <button
                            style={q.status === 'draft' ? lv.confirmBtn : lv.pdfBtn}
                            title={q.status === 'draft' ? '선수금·할부·면세 등 입력 후 견적서 생성' : '견적서 열람·다운로드'}
                            onClick={() => q.status === 'draft'
                              ? setConfirmQuoteModal({ id: q.id, customerName: q.customer?.name ?? undefined, status: q.status, inputs: q.inputs ?? undefined, customer: q.customer ?? undefined })
                              : openPdf(`/api/v1/quotes/${q.id}/pdf`)}
                          >{q.status === 'draft' ? '견적 생성' : '견적서'}</button>
                          {/*
                            계약서는 **견적서 다음 단계**다. 견적서가 나오기 전에는 만들 수 없고,
                            누르면 계약서에만 필요한 값(생년월일·주소·세부주소)을 확인하는 팝업이 먼저 뜬다.
                            다 채워져 있어도 한 번은 보여 준다 — 계약서에 그대로 박히는 값이라서.
                          */}
                          <button
                            style={q.status === 'draft' ? { ...lv.pdfBtn, opacity: 0.45, cursor: 'not-allowed' } : lv.pdfBtn}
                            disabled={q.status === 'draft'}
                            title={q.status === 'draft'
                              ? '견적서를 먼저 만들어야 계약서를 만들 수 있습니다'
                              : '계약 정보를 확인하고 특장 매매계약서를 만듭니다'}
                            onClick={() => { setPrepErr(''); setContractPrep({ quote: q, next: 'pdf' }) }}
                          >{q.status === 'draft' ? '계약서' : '계약서 생성'}</button>
                          {/* 서명이 끝난 계약만 — 도장·서명이 찍힌 정본을 시스템에 보관한다 */}
                          {q.contract?.status === 'COMPLETED' && (
                            <button
                              style={lv.confirmBtn}
                              title="고객이 서명·날인한 계약서 정본 (시스템 보관본)"
                              onClick={() => openPdf(`/api/v1/quotes/${q.id}/contract/signed`)}
                            >서명본</button>
                          )}
                          {/* 발송 채널 둘의 성격이 다르다 — 참고용 전달 vs 법적 서명 요청. 이름으로 구분되게 둔다 */}
                          {/*
                            이메일은 견적 단계 필수가 아니다(문자로 받길 원하는 고객이 많다).
                            그래서 **보낼 곳이 없으면 이 버튼만 잠근다** — 견적 자체는 그대로 만든다.
                          */}
                          {canEmail && (
                            <button
                              style={q.customer?.email ? lv.pdfBtn : BTN.rowMuted}
                              disabled={!q.customer?.email}
                              title={q.customer?.email
                                ? '참고용 — 견적서·계약서 PDF 를 고객 메일로 전달합니다 (서명 요청 아님)'
                                : '고객 이메일이 없어 메일을 보낼 수 없습니다. 「고객정보」에서 이메일을 입력하세요.'}
                              onClick={() => setEmailQuote({ id: q.id, customerName: q.customer?.name ?? undefined })}
                            >메일 전달</button>
                          )}
                          {canSign && (
                          <button
                            style={q.status === 'draft' ? { ...lv.sendBtn, opacity: 0.4, cursor: 'not-allowed' } : lv.sendBtn}
                            disabled={q.status === 'draft'}
                            title={q.status === 'draft' ? '견적서 생성 후 서명을 요청할 수 있습니다' : '고객에게 전자서명을 요청합니다 — 진행상태가 기록됩니다'}
                            onClick={() => {
                              setPrepErr('')
                              // 계약서에 필요한 값이 비어 있으면 확인 팝업부터 — 서명은 그 계약서를 보내는 일이다
                              if (missingForContract(customerEditValues(q)).length) {
                                setContractPrep({ quote: q, next: 'sign' })
                              } else {
                                setContractQuote({
                                  id: q.id,
                                  customerName: q.customer?.name ?? undefined,
                                  customerEmail: q.customer?.email ?? undefined,
                                  customerPhone: q.customer?.phone ?? undefined,
                                })
                              }
                            }}
                          >서명 요청</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
                )
              })}
            </table>
          </div>
        )}
      </div>
    </div>
    </>
  )
}

// ── SalesPage ───────────────────────────────────────────────────────────────
export function SalesPage() {
  const { session } = useAuth()
  const canConvert = usePermission('quote.create')
  // 좁거나 짧은 창(창 모드 태블릿 등)에서는 좌우 2단 대신 위아래로 쌓는다
  const compact = useIsCompact()
  // 휴대폰은 3D 를 접는다 — 그 크기의 차량 그림은 보여 주는 것이 없고, 자리는 옵션에 필요하다
  const phone = useIsPhone()
  const [salesTab, setSalesTab] = useState<'config' | 'list' | 'me'>('config')
  // 권한 없는 탭은 **버튼째** 감춘다. 눌러서 「권한이 없습니다」를 보게 두면
  // 왜 있는 버튼인지 알 수 없고, 없는 기능을 있는 것처럼 보이게 한다.
  const canSeeStats = usePermission('stats.own')
  // 보고 있던 탭이 감춰지면(권한이 도중에 꺼지면) 첫 탭으로 되돌린다
  useEffect(() => { if (salesTab === 'me' && !canSeeStats) setSalesTab('config') }, [salesTab, canSeeStats])

  const [bundle, setBundle] = useState<ApiPricingBundle | null>(null)
  const [bundleLoading, setBundleLoading] = useState(true)
  const [selections, setSelections] = useState<Record<string, string>>({})

  /**
   * 보조금 산정 입력 — **화면 금액을 즉시 바꾸는 값**이라 저장 모달이 아니라
   * 가격바 「보조금」 팝업에서 그 자리에서 고친다. 진입 시 팝업으로 막지 않는다.
   */
  const [subsidyInputs, setSubsidyInputs] = useState<SubsidyInputs>(DEFAULT_SUBSIDY_INPUTS)
  /** 지역 목록(161개) — 보조금 팝업·저장 모달이 함께 쓴다. */
  const [regions, setRegions] = useState<string[]>([])
  /** 저장 단계에서 받은 고객·계약 정보(저장 후 다시 열 때 유지) */
  const [customer, setCustomer] = useState<CustomerInfo | null>(null)
  const [showSaveModal, setShowSaveModal] = useState(false)
  /** 지방보조금은 지역을 골라야 계산된다 — 그 전까지 보조금 금액을 흐리게 보여준다. */
  // 법인은 지방보조금이 없어 지역을 묻지 않는다 — 지역 없이도 국고보조금은 계산된다
  const subsidyReady = subsidyInputs.business_type === 'corporate' || !!subsidyInputs.region_code

  const [subsidyLocal, setSubsidyLocal] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  const [savedQuote, setSavedQuote] = useState<{ quote_id: number; pricing: PricingOk } | null>(null)
  const [saveError, setSaveError] = useState('')

  // 메모/안내문 + 재량할인(0원 처리 특장옵션 그룹)
  const [memo, setMemo] = useState('')
  /** 옵션 무상제공(0원 처리)할 특장옵션 그룹 */
  const [promotionZeroed, setPromotionZeroed] = useState<Set<string>>(new Set())
  const togglePromotion = (group: string) => setPromotionZeroed(prev => {
    const next = new Set(prev)
    next.has(group) ? next.delete(group) : next.add(group)
    return next
  })
  /** 프로모션 금액 할인(원, VAT 포함) — 무상제공과 별개다 */
  const [promotionDiscount, setPromotionDiscount] = useState(0)
  const [localSubsidyOff, setLocalSubsidyOff] = useState(false)  // 지방보조금 소진 시 견적별 미적용



  // 번들 1회 로드
  useEffect(() => {
    if (!session) return
    setBundleLoading(true)
    fetchPricingBundle('PV5_OPENBED')
      .then(data => {
        setBundle(data)
        const defaults: Record<string, string> = {}
        for (const g of data.groups) {
          if (g.values.length === 0) continue
          // 토글형 옵션(온도기록계·스포일러·격벽·도어추가)은 기본 '없음'
          defaults[g.code] = offValueCode(g) ?? g.values[0]!.code
        }
        // 트림 기본값 = 플러스 (있으면)
        if (data.groups.some(g => g.code === 'TRIM' && g.values.some(v => v.code === 'TRIM_PLUS'))) {
          defaults['TRIM'] = 'TRIM_PLUS'
        }
        setSelections(sanitizeSelections(defaults, data))
      })
      .catch(e => console.error('pricing-bundle 로드 실패', e))
      .finally(() => setBundleLoading(false))
  }, [session])

  useEffect(() => {
    fetchRegions().then(setRegions).catch(() => setRegions([]))
  }, [])

  // 지역 변경 시 지방보조금 fetch
  useEffect(() => {
    if (!subsidyInputs.region_code) {
      setSubsidyLocal(0)
      return
    }
    fetchLocalSubsidy(subsidyInputs.region_code, new Date().getFullYear())
      .then(setSubsidyLocal)
      .catch(() => setSubsidyLocal(0))
  }, [subsidyInputs.region_code])

  // option_rule 기준 비활성 그룹 코드
  const disabledGroupCodes = useMemo<Set<string>>(
    () => (bundle ? computeDisabledGroups(selections, bundle) : new Set<string>()),
    [bundle, selections],
  )

  // option_rule(effect=hide) 기준 숨김 그룹/값 + 옵션별 증감액
  const { hiddenGroupCodes, hiddenValueCodes } = useMemo(() => {
    if (!bundle) return { hiddenGroupCodes: new Set<string>(), hiddenValueCodes: new Set<string>() }
    const { groups, values } = computeHidden(selections, bundle)
    return { hiddenGroupCodes: groups, hiddenValueCodes: values }
  }, [bundle, selections])


  // 실시간 계산 (조립 로직은 백엔드 라우트와 shared 공용)
  const liveCalc = useMemo<PricingResult | null>(() => {
    if (!bundle || Object.keys(selections).length === 0) return null

    const price = (code: string) => bundle.option_prices[code] ?? 0
    // 재량할인(프로모션) 0원 처리를 조립 단계에 반영 → 화면 가격이 실제 견적과 일치
    const { trim_price, option_sum } = assembleOptionSum(selections, price, [...promotionZeroed])
    return calcPrice({
      trim_price,
      option_sum,
      subsidy: {
        national:          bundle.subsidy_national?.amount ?? 0,
        local:             subsidyReady && !localSubsidyOff ? subsidyLocal : 0,
        sosang_rate:       bundle.subsidy_national?.sosang_rate ?? 0.3,
        takbae_rate:       TAKBAE_RATE,
        diesel_conversion: DIESEL_CONVERSION_SUBSIDY,
      },
      tax: bundle.tax,
      customer: {
        biz_type:  mapBizType(subsidyInputs.business_type),
        is_sosang: subsidyInputs.is_small_business ?? false,
        has_transport_license: subsidyInputs.has_transport_license ?? false,
        // Ver1.21 엔진은 '유지'만 감액 대상으로 본다(총견적서와 동일 기준)
        diesel_conversion:     subsidyInputs.diesel_status === 'keep',
      },
    })
  }, [bundle, selections, subsidyLocal, subsidyInputs, subsidyReady, customer, promotionZeroed, promotionDiscount, localSubsidyOff])

  /**
   * 화면 표시 금액의 단일 소스 — **총견적서 기준**(견적서 PDF 와 동일 규칙).
   * 취득세 base·특장취득세 기준액·공채할인·의무보험이 Ver1.21(calcPrice)과 달라
   * 화면과 견적서가 어긋나던 문제를 이걸로 통일한다.
   */
  /**
   * 화면 표시 금액의 단일 소스 — **총견적서 기준**(견적서 PDF 와 동일 규칙).
   * 계산식은 lib/liveQuote.ts 한 곳에 있다 — 공개 화면(비로그인)도 같은 함수를 쓴다.
   */
  const liveTotal = useMemo<QuoteResult | null>(
    () => buildLiveTotal({
      bundle, selections, subsidyInputs, subsidyLocal, subsidyReady,
      promotionZeroed, promotionDiscount, localSubsidyOff, customer,
    }),
    [bundle, selections, subsidyLocal, subsidyInputs, subsidyReady, customer, promotionZeroed, promotionDiscount, localSubsidyOff],
  )

  function handleSelect(groupCode: string, valueCode: string) {
    setSelections(prev => {
      const next = { ...prev, [groupCode]: valueCode }
      if (!bundle) return next
      // 규칙 적용: 비활성화된 그룹의 기존 선택 해제
      for (const rule of bundle.rules) {
        if (rule.effect === 'disable' && rule.target_type === 'group') {
          if (Object.values(next).includes(rule.when_value)) {
            delete next[rule.target_code]
          }
        }
      }
      // 숨김 규칙: 숨겨진 그룹/값 선택 정리 (예: 냉동↔내장 전환 시 도어·온도·격벽)
      return sanitizeSelections(next, bundle)
    })
    setSavedQuote(null)
    setSaveError('')
  }

  /** 「견적 저장」 → 고객·계약 정보를 받는 모달을 먼저 연다(진입 시 팝업은 없앴다). */
  /**
   * 저장 완료 후 새 견적 시작 — **화면을 새로고침한다.**
   *
   * 상태를 하나씩 되돌리는 방식은 빠뜨리기 쉽다(실제로 탭 방문기록 `visited` 가 남아
   * '특장·옵션 확인' 강제가 풀린 채로 저장할 수 있었다). 옵션 선택·고객 입력·보조금 조건·
   * 메모·프로모션·탭 방문기록이 여러 컴포넌트에 흩어져 있어, 새 견적은 처음 상태에서
   * 시작하는 게 안전하다.
   */
  function handleStartNew() {
    window.location.reload()
  }

  function handleOpenSave() {
    if (!bundle || liveCalc?.status === 'unsupported') return
    setSaveError('')
    setShowSaveModal(true)
  }

  async function handleSave(v: QuoteSaveValues) {
    if (!bundle) return
    if (liveCalc?.status === 'unsupported') return

    setIsSaving(true)
    setSaveError('')
    try {
      const req: SaveQuoteRequest = {
        model_code: 'PV5_OPENBED',
        year: new Date().getFullYear(),
        selections,
        memo: memo || undefined,
        // 화면 금액을 만든 입력을 그대로 싣는다 — 손으로 옮겨 적지 않는다.
        // 여기서 하나라도 빠지면 화면 금액과 저장된 견적이 어긋난다(#182).
        ...quotePriceExtras({ promotionZeroed, promotionDiscount, localSubsidyOff }),
        customer: {
          name: v.name.trim(),
          // 법인만 값이 있다 → 계약서 {{ceo_name}}. 개인이면 보내지 않는다.
          ceo_name: v.subsidy.business_type === 'corporate' ? v.ceo_name.trim() : undefined,
          email: v.email.trim() || undefined,
          phone: v.phone || undefined,
          biz_type: mapBizType(v.subsidy.business_type),
          is_sosang: v.subsidy.is_small_business ?? false,
          region: v.subsidy.region_code,
          address: v.address.trim() || undefined,
          address_detail: v.address_detail.trim() || undefined,
          has_transport_license: v.subsidy.has_transport_license ?? false,
          diesel_status: v.subsidy.diesel_status || 'none',
          // 계약서 전용 입력 — 비우면 계약서에 공란으로 나간다
          contract_party: v.contract_party.trim() || undefined,
          buyer_agent: v.buyer_agent.trim() || undefined,
          buyer_relation: v.buyer_relation.trim() || undefined,
          buyer_regno: v.buyer_regno.trim() || undefined,
          buyer_tel: v.buyer_tel || undefined,
        },
      }
      const result = await saveQuote(req)
      setSavedQuote(result)
      // 저장에 쓴 값을 화면 상태로 되돌려 둔다(헤더 표시·다시 열기).
      setSubsidyInputs(v.subsidy)
      setCustomer({
        name: v.name.trim(), ceo_name: v.ceo_name.trim() || undefined,
        email: v.email.trim() || undefined, phone: v.phone || undefined,
        business_type: v.subsidy.business_type,
        region_code: v.subsidy.region_code, address: v.address.trim() || undefined,
        address_detail: v.address_detail.trim() || undefined,
        is_small_business: v.subsidy.is_small_business ?? false,
        has_transport_license: v.subsidy.has_transport_license ?? false,
        diesel_status: v.subsidy.diesel_status || 'none',
        is_diesel_conversion: v.subsidy.diesel_status === 'keep',
        contract_party: v.contract_party.trim() || undefined,
        buyer_agent: v.buyer_agent.trim() || undefined,
        buyer_relation: v.buyer_relation.trim() || undefined,
        buyer_regno: v.buyer_regno.trim() || undefined,
        buyer_tel: v.buyer_tel || undefined,
      })
      setShowSaveModal(false)
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : '저장 실패')
    } finally {
      setIsSaving(false)
    }
  }

  const isUnsupported = liveCalc?.status === 'unsupported'
  const displayCalc = savedQuote ? { ...savedQuote.pricing, status: 'ok' as const } : liveCalc

  if (bundleLoading) return <div style={styles.loading}>로딩 중…</div>
  if (!bundle) return <div style={styles.loading}>옵션 데이터 로드 실패</div>

  return (
    <div style={styles.root}>
      {/* 견적 저장 단계에서만 고객·계약 정보를 받는다 — 진입 시 팝업은 없앴다 */}
      {showSaveModal && (
        <QuoteSaveModal
          initial={valuesFromCustomer(customer, subsidyInputs)}
          regions={regions}
          saving={isSaving}
          error={saveError}
          onSave={handleSave}
          onClose={() => setShowSaveModal(false)}
        />
      )}

      <Header customer={customer} />

      {/* 마이페이지(내 진행상황·성과)는 권한이 있을 때만 목록에 넣는다 — 비활성이 아니라 숨김 */}
      <div style={styles.tabBar}>
        <Tabs
          items={[
            { key: 'config' as const, label: '컨피규레이터' },
            { key: 'list' as const, label: '견적·주문' },
            ...(canSeeStats ? [{ key: 'me' as const, label: '마이페이지' }] : []),
          ]}
          value={salesTab}
          onChange={setSalesTab}
        />
      </div>

      {salesTab === 'list' && <MyListView />}
      {salesTab === 'me' && canSeeStats && (
        <div style={styles.meWrap}>
          <SalesPerformance />
        </div>
      )}

      {/*
        넓은 창: 좌(3D+가격바) | 우(옵션)  ·  좁거나 짧은 창: 3D → 옵션 → 가격바 세로 배치.
        창 모드로 띄우면 폭·높이가 모두 모자라, 2단을 고집하면 옵션이 라벨만 남는다.
      */}
      <div style={{
        ...styles.body,
        display: salesTab === 'config' ? 'flex' : 'none',
        ...(compact ? styles.bodyCompact : null),
      }}>
        {/* 휴대폰에서는 3D 칸을 통째로 접는다(시점 탭 포함) — 남는 자리를 옵션이 쓴다 */}
        {!phone && (
        <section style={{ ...styles.viewer, ...(compact ? styles.viewerCompact : null) }}>
          {/* 3D 시점 선택 — 아직 VIVAR 연동 전이라 표시만 한다(고르면 바뀌는 것은 연동 때) */}
          <div style={styles.vtabs}>
            <Segmented
              items={['FREE', 'TOP', 'SIDE', 'REAR', 'FRONT'].map(v => ({ value: v, label: v }))}
              value="FREE"
              onChange={() => {}}
            />
          </div>

          <div style={styles.stage}>
           {/*
             지금은 VIVAR 3D 대신 정지 이미지를 띄운다(임시). 이미지 자체가 16:9(1672x941)라
             프레임에 딱 맞는다. 3D 연동이 붙으면 이 자리에 iframe 이 들어간다.
           */}
           <div style={styles.frame}>
             <img src={stegoSide} alt="STEGO-K 측면" style={styles.stageImg} />
           </div>
           <div style={styles.stageNote}>3D 미리보기 연동 예정</div>
          </div>

          {!compact && (
            <PriceBar
              calc={displayCalc}
              total={liveTotal}
              hasCustomer={subsidyReady}
              breakdown={bundle ? assembleOptionSum(selections, c => bundle.option_prices[c] ?? 0, [...promotionZeroed]) : null}
              subsidy={subsidyInputs}
              onSubsidyChange={setSubsidyInputs}
              regions={regions}
            />
          )}
        </section>
        )}

        <OptionPanel
          compact={compact}
          bundle={bundle}
          selections={selections}
          disabledGroupCodes={disabledGroupCodes}
          hiddenGroupCodes={hiddenGroupCodes}
          hiddenValueCodes={hiddenValueCodes}
          optionPrices={bundle.option_prices}
          onSelect={handleSelect}
          onSave={handleOpenSave}
          onStartNew={handleStartNew}
          isSaving={isSaving}
          savedQuote={savedQuote}
          saveError={saveError}
          isUnsupported={isUnsupported}
          canConvert={canConvert}
          memo={memo}
          onMemoChange={setMemo}
          promotionZeroed={promotionZeroed}
          onTogglePromotion={togglePromotion}
          promotionDiscount={promotionDiscount}
          onPromotionDiscountChange={setPromotionDiscount}
          localSubsidyOff={localSubsidyOff}
          onToggleLocalSubsidy={setLocalSubsidyOff}
        />

        {/* 좁은 창에서는 가격바가 폭 전체를 쓴다 — 좁은 칸에 욱여넣으면 금액이 잘린다 */}
        {compact && (
          <PriceBar
            calc={displayCalc}
            total={liveTotal}
            hasCustomer={subsidyReady}
            breakdown={bundle ? assembleOptionSum(selections, c => bundle.option_prices[c] ?? 0, [...promotionZeroed]) : null}
            subsidy={subsidyInputs}
            onSubsidyChange={setSubsidyInputs}
            regions={regions}
            /*
             * 좁은 창은 폰이든 태블릿 창 모드든 **요약 한 줄**을 쓴다.
             * 6칸을 가로로 두면 670px 짜리 창에서 오른쪽이 잘려 나간다(실제 제보).
             * 옆으로 밀어 볼 수는 있었지만, 잘린 화면은 고장으로 읽힌다.
             */
            summary
          />
        )}
      </div>
    </div>
  )
}

const styles = {
  loading: { padding: 24, color: 'var(--muted)' },
  root: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  // 탭 모양·좌우 여백은 components/ui/Tabs 가 갖는다(밑줄이 화면 끝까지 이어지도록)
  tabBar: {
    flexShrink: 0,
    display: 'flex',
    background: '#fff',
  },
  body: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    overflow: 'hidden',
  },
  meWrap: { flex: 1, minHeight: 0, overflowY: 'auto' as const, padding: '20px 24px' },
  viewer: {
    // 폭은 옵션 패널과 2:1 로 나눈다. 3D 는 이 폭 안에서 16:9 로 맞춰지고(styles.frame),
    // 남는 자리는 위아래 여백이 된다 — 패널은 고정폭이 아니라 남은 폭을 전부 채운다.
    flex: 2,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    background: 'var(--bg)',
    overflow: 'hidden',
  },
  // 좁은 창 배치 — 3D → 옵션 → 가격바 순으로 쌓는다
  bodyCompact: { flexDirection: 'column' as const },
  viewerCompact: {
    // 3D 는 화면 위쪽 조금만 차지하고 나머지는 옵션에 넘긴다(고를 것이 더 중요하다)
    flex: '0 0 auto' as const,
    maxHeight: '28%',
  },
  vtabs: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    padding: 'var(--sp-2) var(--sp-4)',
    // 좁으면 알약이 잘린다 — 잘라 없애지 말고 옆으로 밀어 볼 수 있게 한다
    overflowX: 'auto' as const,
  },
  vtabR: {
    marginLeft: 'auto',
    fontSize: 12,
    border: '0.5px solid var(--line)',
    padding: '5px 11px',
    borderRadius: 6,
    cursor: 'pointer',
    background: '#fff',
  },
  stage: {
    flex: 1,
    // 좁은 창에서는 viewerCompact 의 maxHeight 가 우선한다(최소치를 낮게 잡아 옵션 자리를 남긴다)
    minHeight: 140,
    display: 'flex',
    flexDirection: 'column' as const,   // 3D 칸 아래에 안내 문구가 온다
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    boxSizing: 'border-box' as const,
    overflow: 'hidden' as const,
    // 안쪽 16:9 박스가 이 영역을 기준으로 크기를 잡는다(아래 frame 의 cqw/cqh)
    containerType: 'size' as const,
  },
  /**
   * 3D 가 실제로 그려지는 곳 — **항상 정확히 16:9**.
   *
   * `aspect-ratio` 만 쓰면 가로가 좁아질 때 브라우저가 비율을 깨뜨린다(실측 확인).
   * 그래서 남는 가로·세로 중 작은 쪽에 맞춰 폭을 직접 계산한다:
   *   폭 = min(가용 가로, 가용 세로 × 16/9)
   * 화면이 어떤 크기든 3D 는 16:9 를 유지하고, 남는 자리는 위아래(또는 좌우) 여백이 된다.
   */
  frame: {
    position: 'relative' as const,
    // 26px = 아래 안내 문구가 차지하는 높이(글자 15 + 여백 8 + 여유). 이만큼 빼야
    // 문구까지 넣고도 16:9 가 정확히 유지된다.
    width: 'min(100cqw, (100cqh - 26px) * 16 / 9)',
    aspectRatio: '16 / 9',
    overflow: 'hidden' as const,
    borderRadius: 'var(--r-md)',
    background: 'var(--bg)',
  },
  embedTag: {
    position: 'absolute' as const,
    top: 14,
    left: 16,
    fontSize: 11,
    color: 'var(--muted)',
    background: '#fff',
    border: '0.5px solid var(--line)',
    padding: '4px 8px',
    borderRadius: 6,
  },
  // 이미지가 프레임과 같은 16:9 라 그대로 채운다
  stageImg: { position: 'absolute' as const, inset: 0, width: '100%', height: '100%', objectFit: 'cover' as const, display: 'block' },
  stageNote: { marginTop: 8, fontSize: 12, color: 'var(--muted)', textAlign: 'center' as const },
}

const lv: Record<string, React.CSSProperties> = {
  // 진행은 숫자로 — 뱃지로 칠하면 옆 칸의 상태 뱃지와 뜻이 섞인다
  prog: { fontSize: 'var(--fs-caption)', color: 'var(--dark)', fontVariantNumeric: 'tabular-nums' },
  progLate: { fontSize: 'var(--fs-caption)', color: 'var(--req)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
  // 동작이 실패했을 때 목록 위에 얹는 띠 — 목록은 그대로 둔다
  errBar: {
    fontSize: 'var(--fs-label)', color: 'var(--warn)', background: 'var(--warnbg)',
    border: '0.5px solid var(--warn)', borderRadius: 'var(--r-sm)',
    padding: 'var(--sp-2) var(--sp-3)', marginBottom: 'var(--sp-3)',
  },
  root: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px' },
  section: { marginBottom: 28 },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: 'var(--dark)', marginBottom: 12 },
  empty: { color: 'var(--muted)', fontSize: 13, padding: '24px 0', textAlign: 'center' },
  tableWrap: { overflowX: 'auto' },
  /*
   * 날짜 머리 — **칸을 채우지 않는다**. 위쪽 헤어라인 하나로 묶음을 나눈다.
   */
  groupRow: { cursor: 'pointer' },
  groupCell: {
    padding: 'var(--sp-3) var(--sp-3) var(--sp-2)', borderTop: 'var(--hairline)',
    display: 'flex', alignItems: 'baseline', gap: 'var(--sp-2)',
  },
  groupArrow: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', width: 12 },
  groupDate: {
    fontSize: 'var(--fs-label)', fontWeight: 700, color: 'var(--dark)',
    letterSpacing: 'var(--ls-tight)', fontVariantNumeric: 'tabular-nums' as const,
  },
  groupCount: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  // 폭이 모자라면 칸을 **줄여서 글자를 접지 말고** 가로로 넘겨 스크롤한다.
  // (예전엔 고객명이 한 글자씩 세로로 접히고 배지·버튼이 눌려 찌그러졌다)
  table: { width: '100%', minWidth: 'max-content', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    textAlign: 'left', padding: '8px 12px',
    borderBottom: '2px solid var(--line)', color: 'var(--muted)', fontWeight: 600, fontSize: 12,
    whiteSpace: 'nowrap',
  },
  td: { padding: '10px 12px', borderBottom: '0.5px solid var(--line)', verticalAlign: 'middle', whiteSpace: 'nowrap' },
  // 버튼 크기·모양은 styles/buttons.ts 한 곳에서 관리한다(영업·관리자 동일)
  pdfBtn: BTN.row,
  sendBtn: BTN.rowSend,
  confirmBtn: BTN.rowPrimary,
}
