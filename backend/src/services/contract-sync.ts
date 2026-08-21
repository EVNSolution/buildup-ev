/**
 * **웹훅이 잠긴 동안 계약 상태를 따라잡는 길** — 목록을 불러올 때 함께 맞춘다.
 *
 * 원래는 모두싸인이 웹훅으로 «서명 완료»를 알려 준다. 그런데 지금 그 기능이
 * 계정에서 잠겨 있다(`/webhooks` → 403). 그대로 두면 고객이 서명을 마쳐도
 * **우리 쪽 계약은 `SENT` 에 멈춘 채로 남는다** — 제작 배정이 열리지 않고
 * 서명본 PDF 도 받아오지 못한다.
 *
 * 그래서 **견적 목록을 불러오는 길에 얹었다.** 화면을 열든, 새로고침을 누르든,
 * 앱으로 돌아오든 전부 같은 요청을 타므로 셋 다 저절로 같아진다.
 * 누가 눌렀든 결과는 DB 에 남으므로, 관리자가 한 번 부르면 영업 화면에도 반영된다.
 *
 * ⚠️ **주기 조회(폴링)를 하지 않는다.** 아무도 화면을 보지 않는 밤에는 한 번도
 *    부르지 않는다. 게다가 이 서버는 blue/green 두 슬롯이 **동시에 떠 있어서**,
 *    타이머를 걸면 양쪽에서 각각 돌아 호출이 두 배가 된다. 요청을 타고 들어오면
 *    활성 슬롯 하나만 일한다.
 *
 * ⚠️ **목록을 조금도 막지 않는다.** 던져 두고 곧바로 돌아온다.
 *    처음엔 「3초까지만 기다린다」로 두었는데, 옛 계정에서 만든 문서 하나가 403 을
 *    내는 데 2.7초를 써서 **새로고침이 눈에 띄게 느려졌다**(실제 제보).
 *    갱신 결과는 DB 에 남으므로 **다음 목록 조회에 반영된다** — 한 박자 늦을 뿐 잃지 않는다.
 */
import type { PrismaClient } from '@prisma/client';
import { refreshContractStatus } from './contract.js';

/** 한 번에 따라잡을 최대 건수 — 계약이 쌓여도 새로고침이 무거워지지 않게. */
const MAX_PER_CALL = 10;

/** 같은 계약을 다시 물어보기까지의 최소 간격. 여러 명이 동시에 눌러도 한 번만 나간다. */
const COOLDOWN_MS = 3 * 60_000;

/**
 * 실패한 계약을 다시 물어보기까지의 간격 — **0 이 아니다.**
 *
 * 처음엔 실패하면 쿨다운을 지워 곧바로 다시 시도하게 했다. 일시적인 장애를 빨리
 * 따라잡으려던 것인데, **영영 실패하는 문서**에서는 정반대로 작동했다 —
 * 옛 계정에서 만든 문서가 403 을 내는 데 2.7초씩 쓰는 것을 **새로고침할 때마다**
 * 되풀이했다. 짧게 쉬어 주면 일시 장애는 곧 따라잡고, 영구 실패는 1분에 한 번만 낭비한다.
 */
const FAIL_COOLDOWN_MS = 60_000;

/**
 * 서명 기한이 이만큼 지나면 더 묻지 않는다.
 *
 * 고객이 끝내 서명하지 않은 건을 몇 달씩 물어볼 이유가 없다. 모두싸인 기본 기한이
 * 2주라 넉넉히 잡았다 — 기한을 늘려 보낸 건까지 덮는다.
 */
const STALE_DAYS = 45;

/** 최근에 물어본 계약 — **메모리에만** 둔다. */
const lastChecked = new Map<number, number>();

/**
 * 아직 끝나지 않은 계약들의 상태를 모두싸인에 물어 DB 에 반영한다 — **기다리지 않는다.**
 * 반환값은 이번에 조회를 시작한 건수(로그용). 결과는 다음 목록 조회에 실린다.
 */
export async function syncOpenContracts(prisma: PrismaClient): Promise<number> {
  const now = Date.now();
  const cutoff = new Date(now - STALE_DAYS * 86_400_000);

  const open = await prisma.purchaseContract.findMany({
    where: {
      // 서면계약은 모두싸인에 문서가 없다 — 물어볼 곳이 없다
      signing_method: { not: 'PAPER' },
      status: { notIn: ['COMPLETED', 'REJECTED', 'CANCELED'] },
      modusign_document_id: { not: null },
      sent_at: { gte: cutoff },
    },
    orderBy: { sent_at: 'desc' },
    select: { id: true, quote_id: true, status: true },
    take: MAX_PER_CALL * 3, // 쿨다운으로 걸러낸 뒤 MAX_PER_CALL 만큼 쓴다
  });

  const due = open
    .filter(c => now - (lastChecked.get(c.id) ?? 0) >= COOLDOWN_MS)
    .slice(0, MAX_PER_CALL);
  if (due.length === 0) return 0;

  // 물어보기 **전에** 표시한다 — 동시에 들어온 두 요청이 같은 계약을 겹쳐 묻지 않게.
  for (const c of due) lastChecked.set(c.id, now);

  // ⚠️ **기다리지 않는다.** 목록은 이 줄 다음에 곧바로 나간다.
  for (const c of due) {
    void (async () => {
      try {
        const after = await refreshContractStatus(c.quote_id);
        // 「불렀다」가 아니라 **정말 달라졌을 때만** 남긴다 — 로그가 부풀면 읽을 이유가 없어진다
        if (after && after.status !== c.status) {
          console.info(`[contract-sync] 견적 ${c.quote_id} 계약 ${c.status} → ${after.status}`);
        }
      } catch (e) {
        // 한 건이 실패해도 나머지는 계속한다. 짧게 쉬었다가 다시 시도한다.
        console.error('[contract-sync] 상태 조회 실패', { quote_id: c.quote_id, err: e });
        lastChecked.set(c.id, Date.now() - COOLDOWN_MS + FAIL_COOLDOWN_MS);
      }
    })();
  }
  return due.length;
}

/** 테스트용 — 쿨다운 기억을 비운다. */
export function _resetCooldown(): void {
  lastChecked.clear();
}
