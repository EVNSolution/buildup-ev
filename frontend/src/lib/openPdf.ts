/**
 * 서류(PDF)를 연다 — **설치형(PWA)과 브라우저를 갈라서.**
 *
 * 브라우저에서는 새 탭이 가장 낫다. 모달 안 iframe 으로 띄우면 PC 에 설치된 PDF 리더
 * (Acrobat 등) 플러그인이 잡아가 환경마다 다르게 보이고 화면도 좁다.
 *
 * ⚠️ **그런데 홈 화면에 추가한 앱(PWA)에는 탭이 없다.** 그래서 `target="_blank"` 도
 *    `window.open` 도 아무 일이 일어나지 않고, 서류를 아예 볼 수 없었다(실제 제보).
 *    그럴 때는 **내려받아 휴대폰의 PDF 뷰어로 넘긴다** — 안드로이드에서 이게 유일하게
 *    확실히 되는 길이다(크롬 안드로이드는 PDF 를 iframe 안에 그리지 못한다).
 */

/** 탭이 없는 창인가 — 홈 화면에 추가해 앱처럼 띄운 경우. */
export function isStandalone(): boolean {
  const mm = window.matchMedia?.bind(window);
  return (
    mm?.('(display-mode: standalone)').matches === true ||
    mm?.('(display-mode: fullscreen)').matches === true ||
    mm?.('(display-mode: minimal-ui)').matches === true ||
    // iOS 사파리는 display-mode 대신 이 값을 쓴다
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

/** 응답 헤더에 적힌 파일명 — `filename*=UTF-8''...` 형태를 먼저 본다. */
function nameFromHeader(cd: string | null): string | null {
  if (!cd) return null
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)
  if (star?.[1]) { try { return decodeURIComponent(star[1]) } catch { /* 깨진 값은 무시 */ } }
  const plain = /filename="?([^";]+)"?/i.exec(cd)
  return plain?.[1] ?? null
}

/**
 * 내려받아 기기에 넘긴다. 서버가 붙여 준 파일명을 그대로 쓰고, 없으면 `fallback`.
 *
 * ⚠️ 주소로 바로 이동시키지 않는다 — 앱 창이 PDF 로 넘어가 버리면 돌아올 길이 없다.
 *    파일만 빼내고 화면은 그대로 둔다.
 */
async function saveToDevice(url: string, fallback: string): Promise<void> {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(body.error?.message ?? `서류를 불러오지 못했습니다 (${res.status})`)
  }
  const blob = await res.blob()
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = nameFromHeader(res.headers.get('content-disposition')) ?? fallback
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 바로 거둬들이면 내려받기가 시작되기 전에 끊긴다
  setTimeout(() => URL.revokeObjectURL(href), 60_000)
}

/**
 * PDF 열기 — 브라우저면 새 탭, 설치형 앱이면 내려받기.
 *
 * ⚠️ 브라우저 경로는 반드시 **클릭 핸들러 안에서 동기적으로** 호출할 것.
 *    setTimeout·useEffect 안에서 부르면 팝업 차단에 걸린다.
 */
export function openPdf(url: string, fallbackName = '서류.pdf') {
  if (isStandalone()) {
    void saveToDevice(url, fallbackName).catch((e: unknown) => {
      alert(e instanceof Error ? e.message : '서류를 불러오지 못했습니다')
    })
    return
  }
  const w = window.open(url, '_blank', 'noopener,noreferrer')
  if (!w) alert('팝업이 차단되었습니다. 브라우저 주소창의 팝업 차단을 해제해 주세요.')
}

/**
 * 저장(await) 을 끝낸 뒤에 PDF 를 열어야 할 때 쓰는 짝.
 *
 * 브라우저는 `window.open` 을 **클릭 직후 잠깐**만 허용한다. 계약서처럼
 * "고객정보 저장 → 그 값으로 PDF 생성" 순서면 open 이 await 뒤로 밀려 차단된다.
 * 그래서 클릭 시점에 **빈 탭을 먼저 잡아 두고**(reservePdfTab), 저장이 끝나면
 * 그 탭의 주소만 바꾼다(openPdfIn). 실패하면 잡아 둔 탭을 닫는다(closeReservedTab).
 *
 * 설치형 앱에서는 잡아 둘 탭이 없다 — `null` 을 돌려주고 나중에 내려받기로 간다.
 */
export function reservePdfTab(): Window | null {
  if (isStandalone()) return null
  return window.open('', '_blank')
}

export function openPdfIn(w: Window | null, url: string, fallbackName?: string) {
  // 잡아 둔 탭이 없으면(설치형이거나 차단됐거나) 기본 경로로 — 거기서 다시 갈린다
  if (!w) { openPdf(url, fallbackName); return }
  // 새 탭에서 opener 로 이 페이지를 건드리지 못하게 끊는다(noopener 대체)
  w.opener = null
  w.location.replace(url)
}

export function closeReservedTab(w: Window | null) {
  w?.close()
}
