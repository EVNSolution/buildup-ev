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
  | 'tuning_apply'       // 튜닝신청서(작성본)
  | 'tuning_signed_doc'  // 튜닝신청서 서명본
  | 'tuning_approval'    // 구조변경 승인서
  | 'inspection_doc'     // 안전검사 관련 서류
  | 'docs_bundle';       // 그 밖의 제출 서류 일체

/** 원본을 지켜야 하는 증빙 = 글자를 읽어야 하는 것. 나머지는 줄여서 저장한다. */
export const KEEP_ORIGINAL: EvidenceKind[] = [
  'receipt', 'plate_return', 'vehicle_reg',
  'tuning_apply', 'tuning_signed_doc', 'tuning_approval',
  'inspection_doc', 'docs_bundle',
];

export const EVIDENCE_LABEL: Record<EvidenceKind, string> = {
  inspection_photo: '검수 사진',
  plate_photo: '번호판 장착 사진',
  receipt: '인수증(서명본)',
  plate_return: '임시번호판 반납 확인서',
  vehicle_reg: '자동차등록증',
  tuning_apply: '튜닝신청서',
  tuning_signed_doc: '튜닝신청서 서명본',
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
   * **이 단계의 마감이 어디서 오는가.** 없으면 마감이 없는 단계다.
   *
   * ⚠️ 예전에는 단계마다 「며칠 넘으면 지연」을 임의로 적어 두었다(3일·7일·21일…).
   *    근거가 없는 숫자라 무엇이 왜 지연인지 아무도 설명할 수 없었다.
   *    지연은 **약속한 날을 넘긴 것**이어야 한다 — 우리가 실제로 가진 약속만 쓴다:
   *      · 납기일   특장사가 수락하며 약속한 날(order.delivery_due)
   *      · 검사예정일 특장사가 안전검사를 신청하며 적은 날
   *    약속이 없는 단계는 지연이라 부르지 않고 **며칠째인지만** 보여준다.
   */
  dueFrom?:
    | { from: 'order'; field: 'delivery_due' }
    | { from: 'step'; code: string };
}

/**
 * 순서대로 적는다 — 화면이 이 순서로 그린다.
 * 트랙 안에서는 위에서 아래로 이어지고, 트랙 사이는 `requires` 가 잇는다.
 */
export const STEPS: StepDef[] = [
  // ── 차량 ───────────────────────────────────────────────────────────────
  { code: 'car_arrived', track: 'vehicle', label: '차량 도착', actor: 'MAKER',
    requires: [], evidence: ['inspection_photo', 'receipt'] },
  { code: 'temp_plate_returned', track: 'vehicle', label: '임시번호판 반납', actor: 'MAKER',
    requires: ['car_arrived'], evidence: ['plate_return'] },
  // 보험은 확인만 한다 — 증빙 파일은 추후(회의 확정)
  { code: 'insurance_checked', track: 'vehicle', label: '보험 확인', actor: 'ADMIN',
    requires: ['car_arrived'], evidence: [] },
  /*
   * 임시번호판을 반납해야 영업용(하늘색) 번호판이 나온다.
   * **자동차등록증이 이 시점에 들어온다** — 튜닝신청서의 4항목(차명·형식·등록번호·차대번호)이
   * 여기서 확보되므로, 번호판을 실제로 다는 것(다음 단계)을 기다리지 않고 튜닝을 시작할 수 있다.
   */
  { code: 'plate_received', track: 'vehicle', label: '번호판·등록증 수령', actor: 'MAKER',
    requires: ['temp_plate_returned'], evidence: ['vehicle_reg'] },
  { code: 'plate_mounted', track: 'vehicle', label: '번호판 장착', actor: 'MAKER',
    requires: ['plate_received'], evidence: ['plate_photo'] },

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
    requires: [], evidence: [], dueFrom: { from: 'order', field: 'delivery_due' } },

  /*
   * ── 튜닝(인허가) — 등록증이 나오면 특장과 **무관하게** 시작한다 ──────────
   *
   * **전자서명은 쓰지 않는다.** 종이로 받아 스캔해 올리는 방식이다 —
   * 신청서를 올리고 · 서명본을 올리고 · 승인서를 받는다. 세 단계 모두 파일이 근거다.
   *
   * ⚠️ 옛 단계 코드를 그대로 쓴다(`tuning_drafted` · `tuning_signed` · `tuning_approved`).
   *    진행 중인 주문에 이미 그 코드로 행이 깔려 있어, 이름을 바꾸면 그 기록이 갈 곳을 잃는다.
   *    빠진 것은 전자서명 요청 단계(`tuning_sign_sent`) 하나뿐이다 —
   *    카탈로그에서 빠지면 그 행은 「해당 없음」으로 남고 진행률에서도 빠진다.
   */
  { code: 'tuning_drafted', track: 'tuning', label: '튜닝신청서 업로드', actor: 'MAKER',
    requires: ['plate_received'], evidence: ['tuning_apply'] },
  { code: 'tuning_signed', track: 'tuning', label: '서명본 업로드', actor: 'MAKER',
    requires: ['tuning_drafted'], evidence: ['tuning_signed_doc'] },
  { code: 'tuning_approved', track: 'tuning', label: '승인서 수령', actor: 'MAKER',
    requires: ['tuning_signed'], evidence: ['tuning_approval'] },

  // ── 출고 ───────────────────────────────────────────────────────────────
  // 만나는 지점: 차가 와 있고 특장이 다 만들어져야 얹을 수 있다
  { code: 'mounted', track: 'merged', label: '특장 장착', actor: 'MAKER',
    requires: ['car_arrived', 'build_done'], evidence: [] },
  // 합쳐지는 지점: 장착된 실물 + 승인서가 있어야 검사에 넣는다
  { code: 'inspection_booked', track: 'merged', label: '안전검사 신청', actor: 'MAKER',
    requires: ['mounted', 'tuning_approved'], evidence: [], dateLabel: '검사예정일' },
  { code: 'inspection_done', track: 'merged', label: '안전검사 완료', actor: 'MAKER',
    requires: ['inspection_booked'], evidence: ['vehicle_reg'], dueFrom: { from: 'step', code: 'inspection_booked' } },
  { code: 'docs_complete', track: 'merged', label: '서류 일체', actor: 'MAKER',
    requires: ['inspection_done'], evidence: ['docs_bundle'] },
  { code: 'delivered', track: 'merged', label: '인도', actor: 'SALES',
    requires: ['inspection_done', 'docs_complete'], dateLabel: '인도일', evidence: [] },
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

/**
 * **특장만 주문**에서는 차량 트랙에 「차량 도착」 하나만 남는다.
 *
 * 차가 이미 고객 것이라 우리가 할 일이 없다 — 임시번호판은 진작 반납됐고, 번호판은
 * 달려 있고, 보험도 고객이 든 것이다. 그 단계들을 남겨 두면 아무도 누를 수 없는 칸이
 * 넷 생기고, 그 뒤 단계가 영원히 열리지 않는다.
 */
export const BODY_ONLY_SKIPPED: string[] = [
  'temp_plate_returned', 'insurance_checked', 'plate_received', 'plate_mounted',
];

/**
 * 이 주문에 실제로 해당하는 단계 목록.
 *
 * 특장만 주문에서 달라지는 것은 셋뿐이다:
 *   ① 차량 트랙은 「차량 도착」만 남는다(위 참조)
 *   ② 「차량 도착」의 증빙이 **인수증 → 자동차등록증**으로 바뀐다.
 *      우리가 넘겨준 차가 아니라 고객이 몰고 온 차라, 받을 인수증이 없다.
 *      대신 튜닝신청서에 들어갈 4항목(차명·형식·등록번호·차대번호)이 여기서 확보된다.
 *   ③ 그래서 「튜닝신청서 생성」의 선행이 **번호판·등록증 수령 → 차량 도착**이 된다.
 *      원래 등록증을 주던 단계가 사라졌으니 등록증이 들어오는 자리를 가리켜야 한다.
 *
 * ⚠️ 카탈로그를 통째로 바꾸지 않고 **여기서 한 번만** 갈아 끼운다. 서버와 화면이
 *    같은 함수를 불러야 화면에서 눌리는데 서버가 거절하는 일이 안 생긴다.
 */
export function stepsFor(bodyOnly: boolean): StepDef[] {
  if (!bodyOnly) return STEPS;
  const skip = new Set(BODY_ONLY_SKIPPED);
  return STEPS.filter(s => !skip.has(s.code)).map(s => {
    if (s.code === 'car_arrived') return { ...s, evidence: ['vehicle_reg'] as EvidenceKind[] };
    if (s.code === 'tuning_drafted') return { ...s, requires: ['car_arrived'] };
    return s;
  });
}

export function stepMapFor(bodyOnly: boolean): Record<string, StepDef> {
  return bodyOnly ? Object.fromEntries(stepsFor(true).map(s => [s.code, s])) : STEP_BY_CODE;
}

/**
 * **어느 단계에나 덧붙일 수 있는 증빙** — 완료를 막지 않는다.
 *
 * 현장 사진은 필수 증빙이 아니어도 많을수록 좋다. 나중에 「그때 이 부분이 어땠나」를
 * 물을 때 남아 있는 것은 사진뿐이고, 그때 가서는 다시 찍을 수 없다.
 * 필수 증빙과 달리 **여러 장**을 올린다는 전제로 다룬다.
 */
export const EXTRA_EVIDENCE: EvidenceKind[] = ['inspection_photo'];

/** 이 단계에 이 증빙을 붙일 수 있나 — 필수 증빙이거나, 어디에나 붙는 덧증빙이거나. */
export function acceptsEvidence(def: StepDef, kind: EvidenceKind): boolean {
  return def.evidence.includes(kind) || EXTRA_EVIDENCE.includes(kind);
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
  /** 이 주문의 카탈로그. 특장만 주문은 `stepsFor(true)` 를 넘긴다 */
  defs: StepDef[] = STEPS,
): StepGate {
  const byDef = defs === STEPS ? STEP_BY_CODE : Object.fromEntries(defs.map(d => [d.code, d]));
  const def = byDef[code];
  if (!def) return { ok: false, reason: '알 수 없는 단계입니다' };

  const byCode = new Map(states.map(s => [s.code, s]));
  const missing = def.requires.filter(r => byCode.get(r)?.status !== 'done');
  if (missing.length > 0) {
    const names = missing.map(m => byDef[m]?.label ?? m).join(' · ');
    return { ok: false, reason: `선행 단계가 완료되지 않았습니다 — ${names}` };
  }

  const lackEvidence = def.evidence.filter(e => !uploadedKinds.includes(e));
  if (lackEvidence.length > 0) {
    const names = lackEvidence.map(e => EVIDENCE_LABEL[e]).join(' · ');
    return { ok: false, reason: `증빙 등록 후 완료할 수 있습니다 — ${names}` };
  }

  return { ok: true };
}

/** 선행이 다 끝나 지금 손댈 수 있는 단계인가. */
export function isOpen(code: string, doneCodes: Set<string>, defs: StepDef[] = STEPS): boolean {
  const def = (defs === STEPS ? STEP_BY_CODE : Object.fromEntries(defs.map(d => [d.code, d])))[code];
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
export function newlyOpened(completed: string, doneBefore: Set<string>, defs: StepDef[] = STEPS): string[] {
  const after = new Set(doneBefore); after.add(completed);
  return defs
    .filter(s => isOpen(s.code, after, defs) && !isOpen(s.code, doneBefore, defs))
    .map(s => s.code);
}

/**
 * 이 단계를 되돌릴 수 있는가 — **뒤 단계가 이미 끝났으면 안 된다.**
 *
 * 「차량 도착」을 되돌리는데 그 뒤의 「특장 장착」이 완료로 남아 있으면, 차가 오지도 않았는데
 * 얹었다는 기록이 된다. 뒤에서부터 풀어야 앞뒤가 맞는다 — 무엇을 먼저 되돌려야 하는지
 * 이름으로 알려 준다.
 */
export function canUndo(code: string, states: StepState[], defs: StepDef[] = STEPS): StepGate {
  const def = (defs === STEPS ? STEP_BY_CODE : Object.fromEntries(defs.map(d => [d.code, d])))[code];
  if (!def) return { ok: false, reason: '알 수 없는 단계입니다' };
  if (states.find(s => s.code === code)?.status !== 'done') {
    return { ok: false, reason: '완료된 단계만 취소할 수 있습니다' };
  }
  const done = new Set(states.filter(s => s.status === 'done').map(s => s.code));
  // 이 단계를 선행으로 삼는 단계 중 이미 끝난 것
  const blockers = defs.filter(s => s.requires.includes(code) && done.has(s.code));
  if (blockers.length > 0) {
    const names = blockers.map(b => b.label).join(' · ');
    return { ok: false, reason: `후속 단계를 먼저 취소하십시오 — ${names}` };
  }
  return { ok: true };
}

/**
 * 약속한 날을 며칠 넘겼나. 마감이 없거나 아직 안 넘겼으면 null.
 * 마감일 **당일까지는 지연이 아니다** — 그날 안에 하면 지킨 것이다.
 */
export function overdueDays(due: string | null | undefined, now: Date): number | null {
  if (!due) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(due);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((today.getTime() - d.getTime()) / 86400000);
  return diff > 0 ? diff : null;
}

/**
 * 지연인가 — **약속한 날을 넘겼고, 지금 손댈 수 있는데 안 끝난 것.**
 *
 * 아직 열리지도 않은 단계는 지연이 아니다(아무도 시작할 수 없는 일이다).
 * 약속이 없는 단계도 지연이라 부르지 않는다 — 근거 없이 빨갛게 칠하면
 * 진짜 늦은 것을 알아볼 수 없다.
 */
export function isOverdue(
  code: string,
  state: StepState | undefined,
  due: string | null | undefined,
  now: Date,
  doneCodes: Set<string>,
  defs: StepDef[] = STEPS,
): boolean {
  if (!state || state.status === 'done' || state.status === 'skipped') return false;
  if (!isOpen(code, doneCodes, defs)) return false;
  return overdueDays(due, now) !== null;
}

/** 이 단계에 며칠째 머물고 있나(달력일). 들어온 적이 없으면 null. */
export function stalledDays(enteredAt: Date | null, now: Date): number | null {
  if (!enteredAt) return null;
  const a = new Date(enteredAt.getFullYear(), enteredAt.getMonth(), enteredAt.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}
