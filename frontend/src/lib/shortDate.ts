/**
 * 날짜를 짧게 — 「10/13」(2026-09-14 지시). 앞자리 0 은 뺀다(9/2). **올해가 아니면 연도를 붙인다**(2027/1/5) —
 * 연말에 내년 날짜가 올해 날짜처럼 읽히면 안 된다. 날짜 띠(DateStrip)가 쓴다.
 */
export function shortDate(iso: string | null | undefined, now = new Date()): string {
  const m = typeof iso === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null
  if (!m) return ''
  const md = `${Number(m[2])}/${Number(m[3])}`
  return Number(m[1]) === now.getFullYear() ? md : `${m[1]}/${md}`
}
