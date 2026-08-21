/**
 * **저장할 때마다 견적서를 한 판 남긴다.**
 *
 * 예전에는 견적서 PDF 가 **열어 볼 때** 만들어졌다. 그래서 옵션을 고쳐 저장만 하고
 * 견적서를 안 열면 그 판이 **아무 데도 남지 않았다** — 서류함에 「그때 뭘로 냈더라」가
 * 비어 있었다(실제 제보).
 *
 * 이제 저장이 끝나면 그 시점 견적서를 만들어 고객 서류함에 쌓는다.
 * 신규든 수정이든 **저장한 판은 전부 남는다.**
 *
 * ⚠️ **저장을 막지 않는다.** PDF 렌더는 브라우저를 띄우는 무거운 일이라(수 초),
 *    응답을 기다리게 하면 저장이 느려진다. 그리고 렌더가 실패해도 저장 자체는
 *    이미 끝난 일이다 — 실패는 로그로만 남기고 넘어간다.
 *
 * ⚠️ **같은 내용은 두 번 쌓이지 않는다.** 보관함이 직전 판과 내용을 대조한다
 *    (`doc-archive`). 저장 버튼을 두 번 눌러도 판이 둘로 늘지 않는다.
 */
import { prisma } from '../lib/prisma.js';

/**
 * 견적서를 만들어 보관함에 남긴다 — **기다리지 않는다.**
 *
 * 부르는 쪽은 `void archiveQuoteSnapshot(id)` 처럼 던져 두면 된다.
 * 고객이 아직 없는 견적(공개 접수 직후 등)은 쌓을 자리가 없어 건너뛴다.
 */
export function archiveQuoteSnapshot(quoteId: number): void {
  void (async () => {
    try {
      if (!prisma) return;
      const q = await prisma.quote.findUnique({
        where: { id: quoteId },
        select: { customer_id: true },
      });
      // 고객이 없으면 보관함에 폴더를 만들 수 없다 — 배정되며 고객이 붙을 때 다시 쌓인다
      if (!q?.customer_id) return;

      /*
       * 렌더 자체가 보관까지 한다(`quote-pdf` 안에서 `archiveCustomerDoc` 을 부른다).
       * 여기서 다시 저장하지 않는다 — 두 곳에서 쌓으면 같은 판이 두 줄로 남는다.
       */
      const { generateQuotePdf } = await import('./quote-pdf.js');
      await generateQuotePdf(quoteId);
    } catch (e) {
      console.error('[quote-snapshot] 견적서 보관 실패(저장은 이미 끝났다)', { quoteId, err: e });
    }
  })();
}
