import type { Prisma } from '@prisma/client';

/**
 * 숨기기 규칙 — **견적과 고객이 같은 기준을 쓴다.**
 *
 * 기준은 하나다: **계약서가 고객에게 나갔는가.**
 * 나가기 전이라면 언제든 숨길 수 있다(잘못 만든 견적을 정리하는 일이라 흔하다).
 * 나간 뒤라면 숨길 수 없다 — 고객이 이미 받아 본 것이고, 서명이 진행 중일 수 있다.
 *
 * 견적 상태(draft·confirmed…)로 가르지 않는다. 확정만 해 두고 계약서를 안 보낸 견적은
 * 여전히 정리 대상이다 — 예전에 임시저장만 숨길 수 있게 했더니 테스트 정리가 막혔다.
 */

/**
 * **고객에게 나간** 계약 상태.
 *
 * DRAFT 는 아직 안 나갔다(만들다 실패했거나 발송 직전). REJECTED·CANCELED 는
 * 되돌아온 것이라 다시 정리할 수 있어야 한다.
 */
export const SENT_CONTRACT_STATUSES = ['SENT', 'VIEWED', 'SIGNING', 'COMPLETED'] as const;

/** 이 견적에 **나간 계약**이 있는가 — 있으면 숨길 수 없다. */
export const SENT_CONTRACT_FILTER = {
  status: { in: [...SENT_CONTRACT_STATUSES] },
} satisfies Prisma.PurchaseContractWhereInput;

/**
 * 마스터는 무엇이든 숨길 수 있다.
 *
 * 잘못 나간 계약까지 포함해 정리해야 하는 사람이 하나는 있어야 한다.
 * 숨김은 지우는 것이 아니고 되돌릴 수 있으며, `hidden_by` 에 누가 했는지 남는다 —
 * 되돌릴 수 없는 권한이 아니라서 한 사람에게 열어 둘 수 있다.
 */
export function canHideAnything(auth: { is_master?: boolean } | undefined): boolean {
  return auth?.is_master === true;
}
