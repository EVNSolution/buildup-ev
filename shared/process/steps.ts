/**
 * 주문 단계 카탈로그 — **차량·특장·튜닝이 따로 돌고 중간에 합류하는 구조의 단일 출처.**
 *
 * 예전에는 `order.status` 문자열 한 칸이었다(제작착수→…→인도완료). 한 줄이라
 * 「차는 아직인데 특장은 다 됐다」를 표현할 수 없었고, 어느 단계에서 며칠 멈췄는지도
 * 알 수 없었다. 특장은 차 위에서 만들어지지 않는다 — 따로 만들어서 차가 오면 얹는다.
 *
 * 단계 정의를 **DB 가 아니라 코드에 두는 이유**: DB 에 두면 그것을 관리하는 화면이
 * 또 필요해지고, 선행조건·필수증빙 같은 규칙까지 데이터로 들어가면 검증이 흩어진다.
 * 진행 상태(`order_step` 행)만 DB 에 남기고, 규칙은 여기 한 곳에서 읽는다.
 *
 * 설계: docs/process-redesign.md §2·§3
 */

export type Track = 'vehicle' | 'body' | 'tuning' | 'merged';
export type StepStatus = 'pending' | 'in_progress' | 'done' | 'skipped';
export type Actor = 'SALES' | 'ADMIN' | 'MAKER' | 'SYSTEM';

/**
 * 증빙 종류 — **사진은 줄여서 저장하고 서류는 원본을 지킨다.**
 * 서류는 글자를 읽어야 하는 것들이다(인수증 서명, 자동차등록증 4항목, 승인서 번호).
 * 사진을 원본으로 쌓으면 주문 하나에 수백 MB 가 된다(요즘 폰 사진 3~5MB).
 */
export type EvidenceKind =
  | 'inspection_photo'   // 차량 검수 사진
  | 'plate_photo'        // 번호판 장착 사진
  | 'receipt'            // 인수증(서명본)
  | 'plate_return'       // 임시번호판 반납 확인서
  | 'vehicle_reg'        // 자동차등록증
  | 'tuning_approval'    // 구조변경 승인서
  | 'inspection_doc'     // 안전검사 관련 서류
  | 'docs_bundle';       // 그 밖의 제출 서류 일체

/** 원본을 지켜야 하는 증빙 = 글자를 읽어야 하는 것. 나머지는 줄여서 저장한다. */
export const KEEP_ORIGINAL: EvidenceKind[] = [
  'receipt', 'plate_return', 'vehicle_reg', 'tuning_approval', 'inspection_doc', 'docs_bundle',
];

export const EVIDENCE_LABEL: Record<EvidenceKind, string> = {
  inspection_photo: '검수 사진',
  plate_photo: '번호판 장착 사진',
  receipt: '인수증(서명본)',
  plate_return: '임시번호판 반납 확인서',
  vehicle_reg: '자동차등록증',
  tuning_approval: '구조변경 승인서',
  inspection_doc: '안전검사 서류',
  docs_bundle: '제출 서류 일체',
};

export function keepsOriginal(kind: EvidenceKind): boolean {
  return KEEP_ORIGINAL.includes(kind);
}

export interface StepDef {
  code: string;
  track: Track;
  label: string;
  /** 이 단계를 처리하는 역할. SYSTEM = 사람이 누르는 게 아니라 다른 사건으로 채워진다 */
  actor: Actor;
  /** 선행 단계 — **전부** done 이어야 이 단계를 완료할 수 있다 */
  requires: string[];
  /** 이게 다 올라오기 전에는 완료 처리되지 않는다 */
  evidence: EvidenceKind[];
  /** 날짜를 하나 받는 단계(검사예정일·인도일) */
  dateLabel?: string;
  /**
   * 사람이 「완료」를 누르는 단계가 아니다 — 다른 행위(발송 등)가 일어나면 저절로 지나간다.
   * 화면에 완료 버튼을 두지 않는다.
   */
  auto?: boolean;
  /**
   * 완료 전에 반드시 해야 하는 확인 행위. 이걸 하기 전에는 완료 버튼이 열리지 않는다.
   * (예: 서명본을 내려받아 눈으로 보기)
   */
  ackLabel?: string;
  /**
   * 이 단계에 머문 지 이 일수를 넘으면 재촉한다(달력일).
   * 재촉은 「며칠째 방치됐나」의 문제라 주말도 흘러간 날로 센다.
   */
  stallDays: number;
}

/**
 * 순서대로 적는다 — 화면이 이 순서로 그린다.
 * 트랙 안에서는 위에서 아래로 이어지고, 트랙 사이는 `requires` 가 잇는다.
 */
export const STEPS: StepDef[] = [
  // ── 차량 ───────────────────────────────────────────────────────────────
  { code: 'car_arrived', track: 'vehicle', label: '차량 도착', actor: 'MAKER',
    requires: [], evidence: ['inspection_photo', 'receipt'], stallDays: 7 },
  { code: 'temp_plate_returned', track: 'vehicle', label: '임시번호판 반납', actor: 'MAKER',
    requires: ['car_arrived'], evidence: ['plate_return'], stallDays: 7 },
  // 보험은 확인만 한다 — 증빙 파일은 추후(회의 확정)
  { code: 'insurance_checked', track: 'vehicle', label: '보험 확인', actor: 'ADMIN',
    requires: ['car_arrived'], evidence: [], stallDays: 5 },
  /*
   * 임시번호판을 반납해야 영업용(하늘색) 번호판이 나온다.
   * **자동차등록증이 이 시점에 들어온다** — 튜닝신청서의 4항목(차명·형식·등록번호·차대번호)이
   * 여기서 확보되므로, 번호판을 실제로 다는 것(다음 단계)을 기다리지 않고 튜닝을 시작할 수 있다.
   */
  { code: 'plate_received', track: 'vehicle', label: '번호판·등록증 수령', actor: 'MAKER',
    requires: ['temp_plate_returned'], evidence: ['vehicle_reg'], stallDays: 10 },
  { code: 'plate_mounted', track: 'vehicle', label: '번호판 장착', actor: 'MAKER',
    requires: ['plate_received'], evidence: ['plate_photo'], stallDays: 5 },

  // ── 특장 ───────────────────────────────────────────────────────────────
  /*
   * 특장 트랙에는 **제작 완료 하나만** 둔다.
   *
   * 발주서 발행은 관리자의 일이고, 수락은 특장사가 이미 「수락 대기」에서 끝낸 일이다
   * (납기일도 그때 함께 정한다). 그것들을 단계로 두면 상세 화면에서 다시 「완료」를 누르고
   * 되돌릴 수 있게 되어, 이미 끝난 일을 두 번 관리하게 된다.
   * 발주·수락·납기는 주문 자체의 기록(assigned_at·accepted_at·delivery_due)으로 남는다.
   */
  { code: 'build_done', track: 'body', label: '특장 제작 완료', actor: 'MAKER',
    requires: [], evidence: [], stallDays: 21 },

  // ── 튜닝(인허가) — 등록증이 나오면 특장과 **무관하게** 시작한다 ──────────
  { code: 'tuning_drafted', track: 'tuning', label: '튜닝신청서 생성', actor: 'SYSTEM',
    requires: ['plate_received'], evidence: [], stallDays: 3 },
  /*
   * 전자서명 요청은 **영업이 보내는 순간 지나가는 단계**다. 특장사가 상세 화면에서
   * 「완료」를 눌러 줄 일이 아니다 — 보낸 사실은 발송이 곧 증명한다.
   */
  { code: 'tuning_sign_sent', track: 'tuning', label: '전자서명 요청', actor: 'SALES',
    requires: ['tuning_drafted'], evidence: [], auto: true, stallDays: 3 },
  /*
   * 서명이 끝나도 **서명본을 실제로 받아 보기 전에는** 완료로 넘기지 않는다.
   * 서명본은 관청에 내는 정본이라, 열어 보지 않고 넘기면 잘못 서명된 것을 뒤늦게 안다.
   */
  { code: 'tuning_signed', track: 'tuning', label: '서명 완료', actor: 'MAKER',
    requires: ['tuning_sign_sent'], evidence: [], ackLabel: '서명본 내려받기', stallDays: 5 },
  { code: 'tuning_approved', track: 'tuning', label: '승인서 수령', actor: 'MAKER',
    requires: ['tuning_signed'], evidence: ['tuning_approval'], stallDays: 10 },

  // ── 출고 ───────────────────────────────────────────────────────────────
  // 만나는 지점: 차가 와 있고 특장이 다 만들어져야 얹을 수 있다
  { code: 'mounted', track: 'merged', label: '특장 장착', actor: 'MAKER',
    requires: ['car_arrived', 'build_done'], evidence: [], stallDays: 7 },
  // 합쳐지는 지점: 장착된 실물 + 승인서가 있어야 검사에 넣는다
  { code: 'inspection_booked', track: 'merged', label: '안전검사 신청', actor: 'MAKER',
    requires: ['mounted', 'tuning_approved'], evidence: [], dateLabel: '검사예정일', stallDays: 5 },
  { code: 'inspection_done', track: 'merged', label: '안전검사 완료', actor: 'MAKER',
    requires: ['inspection_booked'], evidence: ['vehicle_reg'], stallDays: 10 },
  { code: 'docs_complete', track: 'merged', label: '서류 일체', actor: 'MAKER',
    requires: ['inspection_done'], evidence: ['docs_bundle'], stallDays: 7 },
  { code: 'delivered', track: 'merged', label: '인도', actor: 'SALES',
    requires: ['inspection_done', 'docs_complete'], dateLabel: '인도일', evidence: [], stallDays: 7 },
];

/**
 * 트랙 이름.
 * `merged` = 차와 특장이 하나가 된 뒤의 과정(장착 → 안전검사 → 서류 → 인도).
 * 「합류」는 길 이름 같아서 현장에서 쓰는 말과 멀다 — **내보내기 위한 마지막 과정**이므로 「출고」.
 */
export const TRACK_LABEL: Record<Track, string> = {
  vehicle: '차량', body: '특장', tuning: '튜닝', merged: '출고',
};

export const STEP_BY_CODE: Record<string, StepDef> =
  Object.fromEntries(STEPS.map(s => [s.code, s]));

export function stepsOfTrack(track: Track): StepDef[] {
  return STEPS.filter(s => s.track === track);
}

/** 진행 한 건 — DB(`order_step`) 에서 읽어 온 모양. */
export interface StepState {
  code: string;
  status: StepStatus;
  planned_at?: string | null;
  done_at?: string | null;
  done_by?: string | null;
}

/**
 * 지금 이 단계를 완료할 수 있는가 — **선행 단계와 증빙을 함께 본다.**
 * 서버가 최종 판정하고 화면도 같은 함수로 미리 막는다(같은 답이 나와야 한다).
 */
export type StepGate = { ok: true } | { ok: false; reason: string };

export function canComplete(
  code: string,
  states: StepState[],
  uploadedKinds: EvidenceKind[],
): StepGate {
  const def = STEP_BY_CODE[code];
  if (!def) return { ok: false, reason: '알 수 없는 단계입니다' };

  const byCode = new Map(states.map(s => [s.code, s]));
  const missing = def.requires.filter(r => byCode.get(r)?.status !== 'done');
  if (missing.length > 0) {
    const names = missing.map(m => STEP_BY_CODE[m]?.label ?? m).join(' · ');
    return { ok: false, reason: `먼저 끝나야 하는 단계가 있습니다 — ${names}` };
  }

  const lackEvidence = def.evidence.filter(e => !uploadedKinds.includes(e));
  if (lackEvidence.length > 0) {
    const names = lackEvidence.map(e => EVIDENCE_LABEL[e]).join(' · ');
    return { ok: false, reason: `증빙을 올려야 완료할 수 있습니다 — ${names}` };
  }

  return { ok: true };
}

/** 선행이 다 끝나 지금 손댈 수 있는 단계인가. */
export function isOpen(code: string, doneCodes: Set<string>): boolean {
  const def = STEP_BY_CODE[code];
  if (!def || doneCodes.has(code)) return false;
  return def.requires.every(q => doneCodes.has(q));
}

/**
 * 한 단계를 끝냈을 때 **비로소 열리는** 단계들.
 *
 * ⚠️ 「지금 열려 있는 것 전부」와 다르다. 그걸로 잡으면 무관한 단계를 완료할 때마다
 *    이미 열려서 며칠째 멈춰 있던 단계의 시계까지 리셋되어, 오래 방치된 건이 영원히
 *    재촉되지 않는다(실제로 그랬다).
 */
export function newlyOpened(completed: string, doneBefore: Set<string>): string[] {
  const after = new Set(doneBefore); after.add(completed);
  return STEPS
    .filter(s => isOpen(s.code, after) && !isOpen(s.code, doneBefore))
    .map(s => s.code);
}

/**
 * 이 단계를 되돌릴 수 있는가 — **뒤 단계가 이미 끝났으면 안 된다.**
 *
 * 「차량 도착」을 되돌리는데 그 뒤의 「특장 장착」이 완료로 남아 있으면, 차가 오지도 않았는데
 * 얹었다는 기록이 된다. 뒤에서부터 풀어야 앞뒤가 맞는다 — 무엇을 먼저 되돌려야 하는지
 * 이름으로 알려 준다.
 */
export function canUndo(code: string, states: StepState[]): StepGate {
  const def = STEP_BY_CODE[code];
  if (!def) return { ok: false, reason: '알 수 없는 단계입니다' };
  if (states.find(s => s.code === code)?.status !== 'done') {
    return { ok: false, reason: '완료된 단계만 되돌릴 수 있습니다' };
  }
  const done = new Set(states.filter(s => s.status === 'done').map(s => s.code));
  // 이 단계를 선행으로 삼는 단계 중 이미 끝난 것
  const blockers = STEPS.filter(s => s.requires.includes(code) && done.has(s.code));
  if (blockers.length > 0) {
    const names = blockers.map(b => b.label).join(' · ');
    return { ok: false, reason: `뒤 단계를 먼저 되돌려야 합니다 — ${names}` };
  }
  return { ok: true };
}

/** 이 단계에 며칠째 머물고 있나(달력일). 들어온 적이 없으면 null. */
export function stalledDays(enteredAt: Date | null, now: Date): number | null {
  if (!enteredAt) return null;
  const a = new Date(enteredAt.getFullYear(), enteredAt.getMonth(), enteredAt.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}

/**
 * 재촉해야 하는가.
 *
 * ⚠️ **아직 열리지도 않은 단계는 지연이 아니다.** 선행이 안 끝나 시작할 수 없는 일을
 *    「지연」이라 부르면 목록이 온통 빨개지고, 그러면 진짜 늦은 것을 알아볼 수 없다
 *    (실제로 주문 하나를 열었더니 14단계가 전부 지연으로 떴다 — 아무도 시작할 수
 *    없는 상태였는데도).
 *    지금 손댈 수 있는데 손대지 않고 있는 것만 재촉한다.
 */
export function isStalled(
  code: string,
  state: StepState | undefined,
  enteredAt: Date | null,
  now: Date,
  doneCodes: Set<string>,
): boolean {
  const def = STEP_BY_CODE[code];
  if (!def || !state || state.status === 'done' || state.status === 'skipped') return false;
  if (!isOpen(code, doneCodes)) return false;
  const d = stalledDays(enteredAt, now);
  return d !== null && d >= def.stallDays;
}
