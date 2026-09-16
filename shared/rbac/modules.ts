/**
 * **기능모듈 한 벌** — 코드·이름·설명·묶음이 **여기 한 곳**에 있다(2026-09-16 전수조사).
 *
 * 전에는 세 곳에 흩어져 있었다 — 코드는 라우트에, 이름은 DB 시드에, 설명은 화면 상수에.
 * 그래서 이런 것들이 쌓였다.
 *   · 아무 데서도 검사하지 않는 모듈이 목록에 남아 켜고 끌 수 있었다(견적 삭제·앱 알림·배정 알림 메일)
 *   · 같은 뜻의 모듈이 둘이었다(옛 우산 `basedata.manage` 와 새로 쪼갠 다섯)
 *   · 정렬 번호가 셋씩 겹쳐 목록 순서가 뜰 때마다 달라졌다
 *   · 이름이 실제로 하는 일과 어긋났다(「고객 목록」인데 서류함까지, 「주문 상태 변경」인데 제작 단계 진행)
 *
 * ⚠️ **새 모듈을 만들면 여기에 한 줄을 더한다.** 목록 순서는 이 배열 순서다(번호를 따로 매기지 않는다 —
 *    번호를 매기면 겹친다). 시드(`db/seed/feature_module.csv`)는 이 표를 비추기만 하고,
 *    `permission-catalog.test.ts` 가 둘이 어긋나지 않게 지킨다.
 */

/** 어느 화면의 기능인가 — 목록에서 눈으로 가르는 용도다(권한 판정에는 쓰지 않는다) */
export type ModuleSurface = '영업' | '관리자' | '특장사';

/** 목록에서 줄을 나누는 묶음 */
export type ModuleGroup = '견적' | '서류' | '고객' | '주문·제작' | '성과·손익' | '기준데이터' | '운영';

export interface ModuleDef {
  code: string;
  /** 짧은 이름 — **실제로 하는 일**로 적는다 */
  name: string;
  /** 한 줄 설명 — 켜면 무엇을 할 수 있는지. 이름을 늘여 쓰지 말 것 */
  desc: string;
  surfaces: ModuleSurface[];
  group: ModuleGroup;
  /**
   * 물러난 모듈 — **목록에 뜨지 않는다.** 왜 물러났는지를 값으로 적는다.
   * 행은 지우지 않는다(이미 켜 둔 계정의 권한 기록을 잃지 않기 위해). 새로 켤 수는 없다.
   */
  retired?: string;
}

export const MODULES: ModuleDef[] = [
  // ── 견적 ────────────────────────────────────────────────────────────────
  { code: 'quote.create', group: '견적', surfaces: ['영업'],
    name: '견적 만들기', desc: '컨피규레이터에서 새 견적을 만든다' },
  { code: 'quote.edit', group: '견적', surfaces: ['영업', '관리자'],
    name: '견적 고치기', desc: '저장된 견적의 옵션·고객정보를 고치고 복제한다' },
  { code: 'quote.confirm', group: '견적', surfaces: ['영업', '관리자'],
    name: '견적 확정', desc: '임시저장을 확정해 견적번호를 매기고 견적서를 낸다' },

  // ── 서류 ────────────────────────────────────────────────────────────────
  { code: 'doc.send.email', group: '서류', surfaces: ['영업', '관리자'],
    name: '견적서·계약서 메일 발송', desc: '고객에게 PDF 를 메일로 보낸다' },
  { code: 'doc.send.sign', group: '서류', surfaces: ['영업', '관리자'],
    name: '전자서명 요청', desc: '계약서에 서명을 요청하고 서명본을 받는다' },
  { code: 'doc.view', group: '서류', surfaces: ['관리자', '특장사'],
    name: '구조변경 서류 보기', desc: '하중계산서·제원대비표·작업지시서를 열어 보고 내려받는다' },

  // ── 고객 ────────────────────────────────────────────────────────────────
  { code: 'customer.view', group: '고객', surfaces: ['관리자'],
    name: '고객·서류함 보기', desc: '남의 고객까지 본다 (영업은 이 권한 없이도 자기 고객을 본다)' },

  // ── 주문·제작 ───────────────────────────────────────────────────────────
  { code: 'order.view', group: '주문·제작', surfaces: ['영업', '관리자', '특장사'],
    name: '주문 진행 보기', desc: '주문 현황판과 주문 상세를 본다' },
  { code: 'order.confirm', group: '주문·제작', surfaces: ['관리자'],
    name: '제작 배정', desc: '계약된 건을 특장사에 배정하고, 배정을 거두거나 돌려보낸다' },
  { code: 'order.control', group: '주문·제작', surfaces: ['관리자', '특장사'],
    name: '제작 단계 진행', desc: '단계를 완료·되돌리고 납기와 차량 도착 예정일을 고친다' },
  { code: 'order.remove', group: '주문·제작', surfaces: ['관리자'],
    name: '주문 치우기', desc: '잘못 만든 주문을 목록에서 감춘다 (기록은 지워지지 않는다)' },
  { code: 'addon.view', group: '주문·제작', surfaces: ['관리자'],
    name: '부가작업 보기', desc: '특장사 출고 뒤 고객 인도까지의 진행을 본다' },
  { code: 'addon.manage', group: '주문·제작', surfaces: ['관리자'],
    name: '부가작업 진행', desc: '부가작업 단계를 완료하고 고객 인도 목표일·인도일을 적는다' },
  { code: 'checklist.manage', group: '주문·제작', surfaces: ['관리자'],
    name: '체크리스트 서식 관리', desc: '단계마다 확인할 항목을 만들고 고친다' },

  // ── 성과·손익 ───────────────────────────────────────────────────────────
  { code: 'stats.own', group: '성과·손익', surfaces: ['영업', '관리자'],
    name: '내 실적 보기', desc: '내가 맡은 건의 깔때기·금액·소요일' },
  { code: 'stats.all', group: '성과·손익', surfaces: ['관리자'],
    name: '전체 실적 보기', desc: '모든 영업의 실적과 계정별 비교' },
  { code: 'pnl.view', group: '성과·손익', surfaces: ['관리자'],
    name: '손익 보기', desc: '판매건별 매출·원가·수익 (보기 전용)' },
  { code: 'pnl.manage', group: '성과·손익', surfaces: ['관리자'],
    name: '손익 입력', desc: '세금계산서 발행일·입금·원가를 적고 줄을 삭제한다' },

  // ── 기준데이터 ──────────────────────────────────────────────────────────
  { code: 'basedata.optiondb', group: '기준데이터', surfaces: ['관리자'],
    name: '옵션DB 관리', desc: '고객 견적에 쓰는 옵션 단가·보조금·세율' },
  { code: 'basedata.weights', group: '기준데이터', surfaces: ['관리자'],
    name: '무게상수 관리', desc: '하중계산에 쓰는 상수' },
  { code: 'basedata.dims', group: '기준데이터', surfaces: ['관리자'],
    name: '치수 프리셋 관리', desc: '사양별 튜닝 후 치수' },
  { code: 'basedata.makerprice', group: '기준데이터', surfaces: ['관리자'],
    name: '특장사 단가 관리', desc: '우리가 특장사에 지급하는 값 (고객 견적가와 다른 축이다)' },
  { code: 'basedata.holiday', group: '기준데이터', surfaces: ['관리자'],
    name: '공휴일 관리', desc: '납기를 영업일로 셀 때 쓰는 기준' },

  // ── 운영 ────────────────────────────────────────────────────────────────
  { code: 'account.manage', group: '운영', surfaces: ['관리자'],
    name: '계정·권한 관리', desc: '계정을 만들고 역할·자리(프리셋)·기능모듈을 켠다' },

  // ── 물러난 모듈 ─────────────────────────────────────────────────────────
  // 행은 남긴다(이미 켜 둔 계정의 기록을 잃지 않게). 목록에는 안 뜨고 새로 켤 수도 없다.
  { code: 'quote.delete', group: '견적', surfaces: ['관리자'],
    name: '견적 삭제', desc: '쓰지 않는다',
    retired: '삭제 기능을 제품에서 없앴다(2026-08) — 지우지 않고 숨긴다' },
  { code: 'notify.assign', group: '운영', surfaces: ['관리자'],
    name: '제작 배정 알림 메일', desc: '쓰지 않는다',
    retired: '알림 받을 자리를 역할 프리셋이 정한다(2026-09-16)' },
  { code: 'notify.push', group: '운영', surfaces: ['영업', '관리자', '특장사'],
    name: '앱 알림', desc: '쓰지 않는다',
    retired: '알림함에는 늘 쌓이고 푸시는 기기에서 허용한다 — 계정 설정으로 가르지 않는다(2026-09-14)' },
  { code: 'basedata.manage', group: '기준데이터', surfaces: ['관리자'],
    name: '기준데이터 관리(옛 우산)', desc: '쓰지 않는다',
    retired: '기준데이터를 다섯으로 쪼갰다(2026-09-16) — 이미 켜 둔 계정에서만 다섯을 대신한다' },
];

export const MODULE_BY_CODE: Record<string, ModuleDef> = Object.fromEntries(MODULES.map(m => [m.code, m]));

/** 목록에 뜨는 것 — 물러난 모듈은 뺀다. 순서는 이 배열 순서다 */
export const LIVE_MODULES: ModuleDef[] = MODULES.filter(m => !m.retired);

/** 물러난 모듈인가 — 프리셋·시드가 새로 켜지 못하게 막을 때 쓴다 */
export const isRetired = (code: string): boolean => !!MODULE_BY_CODE[code]?.retired;

/** 묶음 순서 — 화면이 이 순서로 줄을 나눈다 */
export const MODULE_GROUPS: ModuleGroup[] = ['견적', '서류', '고객', '주문·제작', '성과·손익', '기준데이터', '운영'];
