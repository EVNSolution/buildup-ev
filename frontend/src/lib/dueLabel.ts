import type { DueInfo } from '@shared/process/due'
import { t, tf } from '../i18n'

/**
 * 납기 문구를 **화면에서 조립한다.**
 *
 * shared 의 `dueInfo()` 는 `label` 에 숫자를 이미 끼워서 돌려준다(`납기 5일 경과`).
 * 그 상태로는 사전에서 찾을 수 없다 — 값이 바뀔 때마다 다른 문자열이 되기 때문이다.
 * 다행히 같은 객체에 `state` 와 `days` 가 들어 있어, 여기서 다시 만들면 된다.
 * **shared 는 손대지 않는다** — 백엔드도 같은 모듈을 쓴다.
 */
export function dueLabel(due: DueInfo): string {
  if (due.state === 'overdue') return tf('납기 {0}일 경과', -due.days)
  if (due.state === 'soon') {
    return due.days === 0 ? t('납기 오늘') : tf('납기 {0}일 전', due.days)
  }
  return ''
}
