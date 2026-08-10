/**
 * 주소 검색 — 카카오(다음) 우편번호 서비스.
 *
 * 키 발급이 필요 없고, 사용량 제한이 없으며, 상업적 이용도 무료다.
 * 도로명주소 DB 를 행정안전부에서 직접 받아 쓰므로 우리가 주소를 관리할 필요가 없다.
 * (팝업 하단의 'Powered by kakao' 표시를 가리면 이용이 제한될 수 있어 그대로 둔다.)
 *
 * 스크립트는 **버튼을 누른 순간 처음 한 번만** 불러온다. 견적 화면에 들어오는 모든
 * 사람에게 미리 받게 할 이유가 없다.
 */
const SCRIPT_SRC = 'https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js'

interface PostcodeResult {
  /** 우편번호 5자리 */
  zonecode: string
  /** 사용자가 고른 방식(도로명/지번)의 주소 */
  address: string
  roadAddress: string
  jibunAddress: string
  buildingName: string
  /** 'R' = 도로명, 'J' = 지번 */
  userSelectedType: 'R' | 'J'
}

declare global {
  interface Window {
    daum?: { Postcode: new (opts: { oncomplete: (d: PostcodeResult) => void }) => { open: () => void } }
  }
}

let loading: Promise<void> | null = null

function loadScript(): Promise<void> {
  if (window.daum?.Postcode) return Promise.resolve()
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = SCRIPT_SRC
    el.async = true
    el.onload = () => resolve()
    el.onerror = () => { loading = null; reject(new Error('주소 검색을 불러오지 못했습니다')) }
    document.head.appendChild(el)
  })
  return loading
}

/** 도로명주소 + 건물명 형태로 다듬는다 — 계약서·견적서에 그대로 들어갈 문자열. */
function format(d: PostcodeResult): string {
  const base = d.userSelectedType === 'R' ? d.roadAddress : d.jibunAddress
  return d.buildingName ? `${base} (${d.buildingName})` : base
}

/**
 * 미리 받아두기 — 팝업 창은 **사용자가 누른 그 순간** 열려야 브라우저가 막지 않는다.
 * 클릭한 뒤에 스크립트를 받기 시작하면 그 사이 사용자 동작 권한이 풀려 차단될 수 있다.
 * 그래서 입력 화면이 뜰 때 조용히 먼저 받아둔다(실패해도 무시 — 클릭 때 다시 시도).
 */
export function preloadPostcode(): void {
  void loadScript().catch(() => {})
}

/**
 * 주소 검색창을 띄우고, 고른 주소를 돌려준다.
 * 창을 그냥 닫으면 아무 일도 일어나지 않는다(콜백 미호출).
 */
export async function searchAddress(onPick: (address: string, zonecode: string) => void): Promise<void> {
  const open = () => {
    if (!window.daum?.Postcode) throw new Error('주소 검색을 불러오지 못했습니다')
    new window.daum.Postcode({
      oncomplete: (d) => onPick(format(d), d.zonecode),
    }).open()
  }
  // 이미 받아둔 경우엔 기다리지 않고 바로 연다(팝업 차단 회피)
  if (window.daum?.Postcode) { open(); return }
  await loadScript()
  open()
}
