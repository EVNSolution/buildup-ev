import type { CustomOptionsCheck } from '@shared/pricing/custom-options'
import { tf } from '../i18n'

/**
 * 추가 옵션 검증 문구를 **화면에서 조립한다.**
 * shared 의 `message` 는 줄 번호와 한도가 이미 박힌 한국어라 사전에서 찾을 수 없다.
 * 함께 오는 `code`·`row`·`limit` 으로 다시 만든다.
 */
export function customOptionError(c: CustomOptionsCheck): string {
  if (c.ok) return ''
  const row = c.row ?? 0
  switch (c.code) {
    case 'too_many':  return tf('추가 옵션은 {0}줄까지 넣을 수 있습니다.', c.limit ?? 0)
    case 'partial':   return tf('추가 옵션 {0}번째 줄 — 옵션명과 금액을 모두 적어 주세요.', row)
    case 'name_long': return tf('추가 옵션 {0}번째 줄 — 옵션명은 {1}자까지 넣을 수 있습니다.', row, c.limit ?? 0)
    case 'negative':  return tf('추가 옵션 {0}번째 줄 — 금액은 0원 이상이어야 합니다.', row)
    case 'too_big':   return tf('추가 옵션 {0}번째 줄 — 금액이 너무 큽니다. 다시 확인해 주세요.', row)
    default:          return c.message
  }
}
