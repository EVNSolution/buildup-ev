/**
 * **부가작업** — 특장사가 공장에서 「출고」한 뒤, 고객에게 인도하기까지 **우리 쪽에서** 하는 일(2026-09-14).
 *
 * 블랙박스·썬팅 같은 작업이라도 **반드시 있다** — 그래서 건너뛰는 길은 없다.
 * 특장사에게는 보이지 않고 관리자(기능모듈 `addon.manage`)만 다룬다.
 *
 * 특장사 단계(steps.ts)와 같은 모양으로 트랙 셋:
 *   · 작업 전  — 차량 도착
 *   · 작업 중  — 배선/배관 작업 · 외관 작업 · 기타 작업(순서 상관없음, 차량 도착 뒤)
 *   · 고객 인도 — PDI → 차량 출발 → 인도 완료(실제 인도일을 적는다)
 *
 * ⚠️ **세부 단계는 나중에 늘어난다.** 단계를 더하려면 이 표에 한 줄을 넣는다 — 화면·서버·현황판이
 *    모두 이 표를 읽는다. 진행 기록(order_addon_step)은 코드로 묶이므로 **이미 쓰인 코드는 바꾸지 않는다.**
 */
import { laneSpotsOf, type LaneSpot } from './steps';

export type AddonTrack = 'prep' | 'work' | 'handover';
export const ADDON_TRACKS: AddonTrack[] = ['prep', 'work', 'handover'];
export const ADDON_TRACK_LABEL: Record<AddonTrack, string> = { prep: '작업 전', work: '작업 중', handover: '고객 인도' };

export interface AddonStepDef {
  code: string;
  track: AddonTrack;
  label: string;
  /** 먼저 끝나야 하는 단계 */
  requires: string[];
  /** 끝낼 때 날짜를 받는다(인도 완료 = 실제 인도일) */
  dateLabel?: string;
}

const WORK = ['addon_wiring', 'addon_exterior', 'addon_etc'];

export const ADDON_STEPS: AddonStepDef[] = [
  { code: 'addon_car_arrived', track: 'prep', label: '차량 도착', requires: [] },
  { code: 'addon_wiring', track: 'work', label: '배선/배관 작업', requires: ['addon_car_arrived'] },
  { code: 'addon_exterior', track: 'work', label: '외관 작업', requires: ['addon_car_arrived'] },
  { code: 'addon_etc', track: 'work', label: '기타 작업', requires: ['addon_car_arrived'] },
  { code: 'addon_pdi', track: 'handover', label: 'PDI', requires: WORK },
  { code: 'addon_departed', track: 'handover', label: '차량 출발', requires: ['addon_pdi'] },
  { code: 'addon_delivered', track: 'handover', label: '인도 완료', requires: ['addon_departed'], dateLabel: '인도일' },
];

/** 고객 인도 완료 — 이 단계가 끝나면 주문이 끝난다(견적 「완료」) */
export const ADDON_LAST = 'addon_delivered';
/** 부가작업을 열 수 있는 조건 — 특장사가 공장에서 출고했다 */
export const ADDON_OPENS_AFTER = 'delivered';

export const ADDON_BY_CODE: Record<string, AddonStepDef> = Object.fromEntries(ADDON_STEPS.map(s => [s.code, s]));

export type AddonGate = { ok: true } | { ok: false; reason: string };

/** 끝낼 수 있는가 — 공장 출고 후, 선행이 끝났고, 아직 안 끝났다 */
export function addonCanComplete(code: string, done: Set<string>, factoryDone: boolean): AddonGate {
  const def = ADDON_BY_CODE[code];
  if (!def) return { ok: false, reason: '알 수 없는 부가작업 단계입니다' };
  if (!factoryDone) return { ok: false, reason: '특장사 출고 전에는 부가작업을 진행할 수 없습니다' };
  if (done.has(code)) return { ok: false, reason: '이미 완료된 단계입니다' };
  const missing = def.requires.filter(r => !done.has(r));
  if (missing.length > 0) {
    return { ok: false, reason: `먼저 끝내야 합니다 — ${missing.map(m => ADDON_BY_CODE[m]?.label ?? m).join(', ')}` };
  }
  return { ok: true };
}

/** 되돌릴 수 있는가 — 끝난 단계이고, 뒤에서 이 단계를 기다린 단계가 아직 안 끝났다 */
export function addonCanUndo(code: string, done: Set<string>): AddonGate {
  const def = ADDON_BY_CODE[code];
  if (!def) return { ok: false, reason: '알 수 없는 부가작업 단계입니다' };
  if (!done.has(code)) return { ok: false, reason: '완료된 단계만 되돌릴 수 있습니다' };
  const after = ADDON_STEPS.filter(s => s.requires.includes(code) && done.has(s.code));
  if (after.length > 0) return { ok: false, reason: `뒤 단계를 먼저 되돌리세요 — ${after.map(a => a.label).join(', ')}` };
  return { ok: true };
}

/** 트랙마다 지금 서 있는 칸 — 현황판이 센다 */
export function addonSpots(
  rows: { code: string; status: string; done_at: Date | string | null }[],
  startedAt: Date | string | null,
): Record<AddonTrack, LaneSpot | null> {
  return laneSpotsOf(ADDON_TRACKS, ADDON_STEPS, rows, startedAt);
}
