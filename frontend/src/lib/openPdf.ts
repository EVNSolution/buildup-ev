/**
 * PDF 를 새 브라우저 탭으로 연다.
 *
 * 모달 안 iframe 으로 띄우면 PC 에 설치된 PDF 리더(Acrobat 등) 플러그인이 잡아가
 * 환경마다 다르게 보이고 화면도 좁다. 새 탭은 브라우저 기본 뷰어로 크게 열린다.
 *
 * ⚠️ 반드시 **클릭 핸들러 안에서 동기적으로** 호출할 것. setTimeout·useEffect 안에서
 *    부르면 팝업 차단에 걸린다.
 */
export function openPdf(url: string) {
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
 */
export function reservePdfTab(): Window | null {
  return window.open('', '_blank')
}

export function openPdfIn(w: Window | null, url: string) {
  if (!w) { openPdf(url); return }
  // 새 탭에서 opener 로 이 페이지를 건드리지 못하게 끊는다(noopener 대체)
  w.opener = null
  w.location.replace(url)
}

export function closeReservedTab(w: Window | null) {
  w?.close()
}
