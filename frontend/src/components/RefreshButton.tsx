import { useRefreshApi } from '../contexts/RefreshContext'

/**
 * 새로고침 — **탭 줄 오른쪽 끝**에 붙는 작은 화살표.
 *
 * 설치형 앱에는 주소창도 새로고침도 없고, 이 앱은 문서가 스크롤되지 않아 당겨서
 * 새로고침도 발동하지 않는다. 그래서 화면마다 누를 자리가 하나는 있어야 한다.
 *
 * ⚠️ **화면을 리로드하지 않는다.** 지금 화면의 데이터만 다시 불러온다 —
 *    긴 폼을 채우던 중에 눌려도 입력이 날아가지 않는다.
 *
 * ⚠️ 지금 화면이 다시 불러오기를 **등록해 두었을 때만** 뜬다. 컨피규레이터처럼
 *    다시 불러올 것이 없는 화면에는 나오지 않는다 — 눌러도 아무 일이 없는 버튼은
 *    있는 것이 없느니만 못하다.
 */
export function RefreshButton() {
  const { refresh, running, run } = useRefreshApi()
  if (!refresh) return null
  return (
    <button
      type="button"
      onClick={run}
      disabled={running}
      title="지금 화면을 다시 불러옵니다"
      aria-label="새로고침"
      style={{ ...s.btn, ...(running ? s.btnBusy : null) }}
    >
      {/*
        도는 화살표 하나. 글자(↻)를 쓰면 기기마다 크기·굵기가 달라 탭 글자와 어긋난다 —
        그려서 넣으면 어디서나 같게 보인다.
      */}
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden style={running ? s.spin : undefined}>
        <path
          d="M13.3 8a5.3 5.3 0 1 1-1.6-3.8"
          fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
        />
        <path d="M13.6 1.9v3.4h-3.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}

const s: Record<string, React.CSSProperties> = {
  btn: {
    // 탭과 같은 높이로 서서 줄이 흔들리지 않게 한다
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 'var(--h-control)', height: 'var(--h-control)',
    flexShrink: 0,
    background: 'transparent', border: 'none', borderRadius: 'var(--r-sm)',
    color: 'var(--muted)', cursor: 'pointer', padding: 0,
  },
  btnBusy: { color: 'var(--dark)', cursor: 'default' },
  spin: { animation: 'wcspin 700ms linear infinite', transformOrigin: '50% 50%' },
}
