import type { SalesStat } from '../api/stats'

/**
 * **영업 깔때기 — 화면이 읽는 한 벌.**
 *
 * 성과 탭과 관리자 대시보드가 **같은 정의**를 쓴다. 두 곳에서 따로 셈을 쓰면
 * 같은 달 숫자가 화면마다 달라진다.
 *
 * ⚠️ **임시저장(만든 견적 수)은 여기 넣지 않는다**(2026-09-16 지시). 견적 수와 고객 수는
 *    단위가 달라, 「607건 › 38% › 228명」이 **이탈률**로 읽혔다. 만든 견적 수는 깔때기가 아니라
 *    활동량이라 계정 이름 옆(견적 N건)에 적는다.
 *
 * 단위가 섞여 있다 — 일부러 그렇다(2026-09-16 지시).
 *   · 상담고객·견적완료는 **명** — 같은 고객에게 여러 건이 나가도 상담한 사람은 하나다
 *   · 계약완료부터는 **건** — 계약·주문·인도는 차 한 대마다 따로 된 거래다
 * 그래서 숫자 옆에 단위를 **반드시** 적는다. 단위가 없으면 「명」과 「건」이 섞여 읽힌다.
 */
export interface FunnelStep {
  key: string
  label: string
  unit: '건' | '명'
  get: (s: SalesStat) => number
}

export const FUNNEL_STEPS: FunnelStep[] = [
  { key: 'consult', label: '상담 고객', unit: '명', get: s => s.customers.draft },
  { key: 'confirmed', label: '견적 완료', unit: '명', get: s => s.customers.confirmed },
  { key: 'contracted', label: '계약 완료', unit: '건', get: s => s.reached.contracted },
  { key: 'assigned', label: '배정 완료', unit: '건', get: s => s.reached.assigned },
  { key: 'ordered', label: '주문 진행', unit: '건', get: s => s.reached.ordered },
  { key: 'completed', label: '인도 완료', unit: '건', get: s => s.reached.completed },
]

/** 대시보드 「영업 성과」 카드가 쓰는 네 칸 — 상담고객 › 계약완료 › 주문진행 › 인도완료 */
export const DASH_STEPS: FunnelStep[] = ['consult', 'contracted', 'ordered', 'completed']
  .map(k => FUNNEL_STEPS.find(s => s.key === k)!)
