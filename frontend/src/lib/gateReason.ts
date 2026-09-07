import type { StepGate } from '@shared/process/steps'
import { t, tf } from '../i18n'

/**
 * 단계가 막힌 이유를 **화면에서 조립한다.**
 *
 * shared 의 `reason` 은 이름을 이미 끼워 넣은 한국어 완성문이라 사전에서 찾을 수 없다
 * (`선행 단계가 완료되지 않았습니다 — 차량 도착 · 보험 확인`). 대신 함께 오는
 * `code` 와 `names` 로 다시 만든다 — 이름 하나하나도 사전을 태운다.
 */
export function gateReason(gate: StepGate): string {
  if (gate.ok) return ''
  const names = (gate.names ?? []).map(n => t(n)).join(' · ')
  switch (gate.code) {
    case 'requires':     return tf('선행 단계가 완료되지 않았습니다 — {0}', names)
    case 'evidence':     return tf('증빙 등록 후 완료할 수 있습니다 — {0}', names)
    case 'undo_blocked': return tf('후속 단계를 먼저 취소하십시오 — {0}', names)
    case 'not_done':     return t('완료된 단계만 취소할 수 있습니다')
    default:             return t('알 수 없는 단계입니다')
  }
}
