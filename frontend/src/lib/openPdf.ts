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
