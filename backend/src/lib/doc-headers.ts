import type { Response } from 'express';

/**
 * 서류 응답에 붙이는 캐시 지시 — **저장하지 않는다.**
 *
 * 왜 필요한가:
 *   `Cache-Control` 이 없는 응답은 브라우저가 **제 마음대로 캐시해도 된다**(RFC 9111).
 *   그래서 선수금을 고치고 견적서를 다시 열면 **바뀌기 전 PDF 가 그대로 떴다**
 *   (실제 제보: 「선수금 수정 시 반영이 안 된다」). 서버는 새 값으로 렌더했는데
 *   브라우저가 요청조차 보내지 않은 것이다.
 *
 * 왜 `no-cache` 가 아니라 `no-store` 인가:
 *   견적서·계약서에는 **고객 이름·연락처·금액**이 들어 있다. `no-cache` 는 「쓸 때마다
 *   서버에 물어보라」일 뿐 **디스크에 남는 것은 막지 않는다.** 공용 PC 에서 열어 본
 *   계약서가 캐시에 남으면 다음 사람이 꺼내 볼 수 있다. 서류는 남기지 않는다.
 */
export function noStore(res: Response): void {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Pragma', 'no-cache');
}
