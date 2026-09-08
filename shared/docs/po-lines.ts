/**
 * 발주서 **공급가 표** — 특장사에 지급할 금액의 줄들.
 *
 * 계약서(기본거래계약서 [별첨3] 발주서 양식)가 요구하는 표다:
 *   `No. | 품목명 | 단위 | 발주수량 | 단가 | 공급가액 | 비고`
 * 「기본형 사양」과 「추가 옵션 사양」 두 구역으로 나뉘고, 아래에 합계가 온다.
 *
 * ⚠️ 고객 견적가(`option_price`)와 **다른 축**이다. 저기는 우리가 고객에게 **받는** 값,
 *    여기는 우리가 특장사에 **지급하는** 값이다. 둘은 아무 관계가 없다.
 *
 * ⚠️ 금액은 전부 **VAT 별도**다(계약서 단가표가 그렇다).
 */

/** 발주서 한 줄 */
export interface PoLine {
  /** 발주서 「품목명」 — 계약서 문구 그대로 */
  label: string;
  /** 기본형 사양 / 추가 옵션 사양 */
  section: 'BASE' | 'OPTION';
  unit: string;
  qty: number;
  /** VAT 별도 */
  unit_price: number;
  /** = unit_price × qty. 저장할 때 함께 얼려 둔다(나중에 다시 곱하지 않는다) */
  amount: number;
  memo?: string;
  /**
   * 이 줄이 어디서 왔는가.
   *   CONTRACT = 계약 단가표에서 자동으로 온 줄 — 관리자가 금액을 고치지 않는다
   *   MANUAL   = 계약에 없어 관리자가 직접 적은 줄
   */
  source: 'CONTRACT' | 'MANUAL';
}

/** 단가표 한 행 — DB(`maker_price`)에서 그대로 온다 */
export interface MakerPriceRow {
  label: string;
  group_code: string | null;
  value_code: string | null;
  top_code: string | null;
  section: string;
  /** MAKER=특장사 작업(발주서에 실린다) · EVN=EV& 직접 추가작업(실리지 않는다) */
  work_by: string;
  unit: string;
  qty: number;
  unit_price: number;
  sort_order: number;
  memo: string | null;
}

/**
 * 선택 → 계약 단가로 채워지는 줄들.
 *
 * ⚠️ **`work_by='MAKER'` 만 싣는다.** EV& 가 인도받아 직접 하는 추가작업은 특장사에
 *    지급할 값이 아니다 — 발주서에 실으면 우리가 안 시킨 일의 대금을 청구받는 셈이 된다.
 *
 * ⚠️ 계약에 없는 사양은 **줄을 만들지 않는다.** 0원으로 채워 넣으면 특장사가
 *    「무상으로 해 주기로 한 일」로 읽는다. 그런 줄은 관리자가 직접 적는다(`MANUAL`).
 */
export function contractLines(
  selections: Record<string, string>,
  rows: readonly MakerPriceRow[],
): PoLine[] {
  const top = selections['TOP'] ?? '';
  const picked: MakerPriceRow[] = [];

  for (const r of rows) {
    if (r.work_by !== 'MAKER') continue;
    // 탑 높이가 지정된 단가는 그 높이일 때만 — 저상 단가를 표준형 발주서에 실으면 안 된다
    if (r.top_code && r.top_code !== top) continue;
    if (!r.group_code) continue;
    const chosen = selections[r.group_code];
    if (!chosen) continue;
    // value_code 가 없으면 그 문항의 어떤 값이든 걸린다(기본형처럼)
    if (r.value_code && r.value_code !== chosen) continue;
    picked.push(r);
  }

  picked.sort((a, b) => a.sort_order - b.sort_order);
  return picked.map(r => ({
    label: r.label,
    section: r.section === 'BASE' ? 'BASE' : 'OPTION',
    unit: r.unit,
    qty: r.qty,
    unit_price: r.unit_price,
    amount: r.unit_price * r.qty,
    ...(r.memo ? { memo: r.memo } : {}),
    source: 'CONTRACT' as const,
  }));
}

/** 합계 — VAT 별도. 표에 찍히는 값이라 여기서 한 번만 센다 */
export function poTotal(lines: readonly PoLine[]): number {
  return lines.reduce((sum, l) => sum + l.amount, 0);
}

/** 관리자가 적는 줄의 상한 — 발주서 한 장을 넘기면 축소돼 글씨가 작아진다 */
export const PO_LINE_LABEL_MAX = 40;
export const PO_LINES_MAX = 20;

/** 적다 만 줄 — 품목명이 없거나 단가가 음수면 발주서에 실을 수 없다 */
export function checkPoLines(lines: readonly PoLine[]): { ok: true } | { ok: false; row: number } {
  if (lines.length > PO_LINES_MAX) return { ok: false, row: PO_LINES_MAX + 1 };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (!l.label.trim()) return { ok: false, row: i + 1 };
    if (!Number.isFinite(l.unit_price) || l.unit_price < 0) return { ok: false, row: i + 1 };
    if (!Number.isInteger(l.qty) || l.qty < 1) return { ok: false, row: i + 1 };
  }
  return { ok: true };
}

/** 저장 전에 다듬는다 — 화면이 보낸 값을 그대로 믿지 않는다(금액은 여기서 다시 곱한다) */
export function normalizePoLines(raw: unknown): PoLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, PO_LINES_MAX).map((r): PoLine => {
    const o = (r ?? {}) as Record<string, unknown>;
    const qty = Math.max(1, Math.trunc(Number(o['qty']) || 1));
    const unit_price = Math.max(0, Math.trunc(Number(o['unit_price']) || 0));
    const memo = String(o['memo'] ?? '').slice(0, PO_LINE_LABEL_MAX);
    return {
      label: String(o['label'] ?? '').slice(0, PO_LINE_LABEL_MAX),
      section: o['section'] === 'BASE' ? 'BASE' : 'OPTION',
      unit: String(o['unit'] ?? 'EA').slice(0, 10) || 'EA',
      qty,
      unit_price,
      // 화면이 보낸 합계는 믿지 않는다 — 단가×수량과 어긋나면 표가 스스로 거짓말을 한다
      amount: unit_price * qty,
      ...(memo ? { memo } : {}),
      source: o['source'] === 'CONTRACT' ? 'CONTRACT' : 'MANUAL',
    };
  });
}
