/**
 * **역할 프리셋** — 관리자 안을 하는 일로 나눈다(2026-09-16 지시).
 *
 * 영업·특장사는 역할 하나로 뜻이 분명한데 관리자는 한 덩어리라, 영업관리자에게 옵션DB가 보이고
 * 생산관리자에게 계정 관리가 보였다. 프리셋은 **관리자 계정이 실제로 하는 일**을 이름으로 갖는다.
 *
 * ## 규칙이 코드에 있는 이유
 * 프리셋은 「우리 조직이 일을 어떻게 나눴나」다 — 데이터로 내리면 그것을 고치는 화면이 또 필요하고,
 * 어느 프리셋이 무엇을 할 수 있는지 시험으로 지킬 수 없다. **계정마다의 예외**는 지금처럼
 * 계정 관리의 기능모듈 토글이 갖는다(프리셋 → 계정 토글 순으로 덮는다).
 *
 * ## 프리셋이 없는 계정
 * 지금까지 쓰던 관리자 계정은 프리셋이 **없다**(null). 그때는 예전 그대로 역할 기본값을 쓴다 —
 * 프리셋을 지정하는 순간부터 그 프리셋 규칙을 따른다(기존 계정이 갑자기 권한을 잃지 않게).
 */

export type PresetCode = 'sales_mgr' | 'pm' | 'prod_mgr' | 'exec' | 'master';

export interface PresetDef {
  code: PresetCode;
  label: string;
  /** 무엇을 하는 자리인가 — 계정 관리 화면이 그대로 보여 준다 */
  desc: string;
  /**
   * 이 프리셋이 켜 두는 기능모듈. **여기 없는 모듈은 꺼진 것**이다(역할 기본값도 덮는다).
   * 계정 하나만 달리 하려면 계정 관리에서 그 계정의 토글을 쓴다.
   */
  modules: string[];
}

/** 관리자 화면 탭과 이어지는 모듈 — 프리셋을 읽을 때 눈으로 짝지을 수 있게 모아 둔다 */
export const TAB_MODULE = {
  견적목록: null,                    // 늘 보인다(관리자 공통)
  고객: 'customer.view',
  영업성과: 'stats.own',
  주문진행: 'order.view',
  체크리스트: 'checklist.manage',
  파일: 'order.view',
  무게상수: 'basedata.weights',
  치수프리셋: 'basedata.dims',
  옵션DB: 'basedata.optiondb',
  특장사단가: 'basedata.makerprice',
  공휴일: 'basedata.holiday',
  계정관리: 'account.manage',
  기능모듈: 'account.manage',
} as const;

/** 관리자 계정이면 프리셋과 무관하게 갖는 것 — 견적 목록·서류 조회처럼 관리 업무의 바탕 */
const BASE = ['quote.confirm', 'quote.edit', 'order.view', 'doc.view', 'stats.own', 'notify.push'];

export const PRESETS: PresetDef[] = [
  {
    code: 'sales_mgr',
    label: '영업관리',
    desc: '견적·고객·영업 성과를 보고 제작 배정까지 — 만드는 일(체크리스트·기준데이터)은 다루지 않는다',
    modules: [...BASE, 'customer.view', 'stats.all', 'order.confirm', 'doc.send.email', 'doc.send.sign', 'addon.view'],
  },
  {
    code: 'pm',
    label: 'PM',
    desc: '제품·기준데이터의 주인 — 옵션DB·무게상수·치수 프리셋·특장사 단가와 체크리스트 서식',
    modules: [
      ...BASE, 'stats.all', 'order.confirm', 'order.control', 'order.remove', 'addon.manage',
      'checklist.manage', 'basedata.weights', 'basedata.dims', 'basedata.optiondb', 'basedata.makerprice',
    ],
  },
  {
    code: 'prod_mgr',
    label: '생산관리',
    desc: '제작 진행을 굴린다 — 제작 배정·단계·체크리스트·부가작업, 특장사 단가는 보고 고친다',
    /* 제작 배정 알림을 받는 자리다 — 받기만 하고 누르지 못하면 알림이 헛돈다(2026-09-16 지적) */
    modules: [...BASE, 'stats.all', 'order.confirm', 'order.control', 'addon.manage', 'checklist.manage', 'basedata.makerprice'],
  },
  {
    code: 'exec',
    label: '경영관리',
    desc: '보기만 한다 — 견적·성과·주문 진행·부가작업·파일. 배정·단계·기준데이터는 손대지 않는다',
    modules: [...BASE, 'stats.all', 'addon.view'],
  },
  {
    code: 'master',
    label: '마스터',
    desc: '전부 — 공휴일·계정 관리·기능모듈까지',
    modules: [
      ...BASE, 'customer.view', 'stats.all', 'quote.create', 'quote.delete', 'doc.send.email', 'doc.send.sign',
      'order.confirm', 'order.control', 'order.remove', 'addon.manage', 'checklist.manage',
      'basedata.weights', 'basedata.dims', 'basedata.optiondb', 'basedata.makerprice', 'basedata.holiday',
      'basedata.manage', 'account.manage', 'notify.assign', 'addon.view',
    ],
  },
];

export const PRESET_BY_CODE: Record<string, PresetDef> = Object.fromEntries(PRESETS.map(p => [p.code, p]));

/** 문자열이 프리셋 코드인가 — 화면·API 가 받은 값을 믿지 않고 여기서 거른다 */
export function isPresetCode(v: unknown): v is PresetCode {
  return typeof v === 'string' && v in PRESET_BY_CODE;
}

/**
 * **알림 종류** — 누가 받는가를 여기 한 곳에 적는다(2026-09-16 지시).
 *
 * ⚠️ 알림을 새로 만들 때는 **반드시 여기에 한 줄을 더한다.** 「관리자 전원」처럼 뭉뚱그리면
 *    상관없는 사람에게까지 고객 이름·금액이 간다. 받는 사람이 정해지지 않은 알림은 보내지 않는다.
 *
 * `presets` = 이 알림을 받는 관리자 프리셋. 마스터는 어느 알림이든 받는다.
 * `extra`  = 프리셋과 별개로 그 건에 얽힌 사람(담당 영업·배정된 특장사 조직·대화 참여자).
 */
export type NotifyExtra = 'sales_owner' | 'maker_org' | 'thread';

export interface NotifyTopicDef {
  code: string;
  label: string;
  presets: PresetCode[];
  extra: NotifyExtra[];
}

export const NOTIFY_TOPICS: NotifyTopicDef[] = [
  { code: 'assign.maker',   label: '제작 배정 필요',   presets: ['sales_mgr', 'pm', 'prod_mgr', 'master'], extra: [] },
  { code: 'assign.sales',   label: '영업 배정 필요',   presets: ['sales_mgr', 'master'], extra: [] },
  { code: 'assign.request', label: '배정 요청 필요',   presets: ['sales_mgr', 'pm', 'master'], extra: ['sales_owner'] },
  { code: 'assign.reject',  label: '배정 거부',        presets: ['sales_mgr', 'pm', 'master'], extra: ['sales_owner'] },
  { code: 'assign.cancel',  label: '배정 취소',        presets: ['sales_mgr', 'pm', 'master'], extra: ['sales_owner', 'maker_org'] },
  { code: 'order.car_arrival', label: '차량 도착 예정일', presets: ['sales_mgr', 'pm', 'prod_mgr', 'exec', 'master'], extra: ['maker_org'] },
  { code: 'order.due_change',  label: '납기일 변경',     presets: ['sales_mgr', 'pm', 'prod_mgr', 'exec', 'master'], extra: ['maker_org'] },
  { code: 'order.due_nudge',   label: '납기 임박·경과',  presets: ['pm', 'prod_mgr', 'master'], extra: ['maker_org'] },
  { code: 'order.step_chat',   label: '단계 대화',       presets: ['pm', 'prod_mgr', 'master'], extra: ['maker_org', 'thread'] },
  { code: 'order.handover',    label: '고객 인도 완료',  presets: ['sales_mgr', 'pm', 'prod_mgr', 'exec', 'master'], extra: ['sales_owner'] },
  { code: 'checklist.submitted', label: '체크리스트 제출', presets: ['pm', 'prod_mgr', 'master'], extra: [] },
];

export const NOTIFY_TOPIC_BY_CODE: Record<string, NotifyTopicDef> = Object.fromEntries(NOTIFY_TOPICS.map(t => [t.code, t]));
