import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

/**
 * **지금 화면을 다시 불러오는 길** — 헤더의 새로고침 버튼과 「앱으로 돌아왔을 때」가 함께 쓴다.
 *
 * 왜 필요한가:
 *   홈 화면에 추가한 앱(PWA)에는 **주소창도 새로고침 버튼도 없다.** 게다가 이 앱은
 *   `html, body, #root` 가 모두 `overflow: hidden` 이라 **당겨서 새로고침도 발동하지 않는다.**
 *   목록이 오래되거나 화면이 막혔을 때 앱을 완전히 껐다 켜는 것 말고는 길이 없었다.
 *
 * ⚠️ **화면을 통째로 리로드하지 않는다.** 견적 저장·고객정보 수정처럼 긴 폼이 있는 앱이라,
 *    리로드는 입력 중이던 것을 전부 날린다. 「막혔을 때 누르는 버튼」이 하필 그런 순간에
 *    눌린다 — 그래서 **지금 화면의 데이터만 다시 불러온다.**
 */
interface RefreshApi {
  /** 지금 화면이 등록해 둔 다시 불러오기. 없으면 null(헤더가 버튼을 숨긴다) */
  refresh: (() => void | Promise<void>) | null
  register: (fn: (() => void | Promise<void>) | null) => void
  running: boolean
  run: () => void
}

const Ctx = createContext<RefreshApi | null>(null)

export function RefreshProvider({ children }: { children: React.ReactNode }) {
  const [refresh, setRefresh] = useState<RefreshApi['refresh']>(null)
  const [running, setRunning] = useState(false)

  // 함수를 상태에 담을 때는 감싸서 넣어야 한다 — 안 그러면 React 가 갱신 함수로 오해한다
  const register = useCallback((fn: RefreshApi['refresh']) => setRefresh(() => fn), [])

  const run = useCallback(() => {
    if (!refresh || running) return
    setRunning(true)
    void Promise.resolve(refresh())
      .finally(() => {
        // 너무 빨리 끝나면 눌린 티가 안 난다 — 잠깐 붙잡아 「돌고 있다」를 보여 준다
        setTimeout(() => setRunning(false), 400)
      })
  }, [refresh, running])

  return <Ctx.Provider value={{ refresh, register, running, run }}>{children}</Ctx.Provider>
}

export function useRefreshApi(): RefreshApi {
  return useContext(Ctx) ?? { refresh: null, register: () => {}, running: false, run: () => {} }
}

/** 앱으로 돌아온 것으로 볼 최소 간격 — 잠깐 화면을 오갔다고 매번 다시 부르지 않는다. */
const STALE_MS = 30_000

/**
 * 목록 화면이 부르는 것 — **다시 불러오기를 헤더에 등록하고, 앱으로 돌아오면 저절로 부른다.**
 *
 * 자동 재조회가 본진이다. 다른 앱에 갔다 오거나 화면을 껐다 켜면 목록이 이미 최신이라,
 * 사람이 버튼을 찾을 일 자체가 줄어든다. 버튼은 그래도 막혔을 때를 위한 비상구다.
 *
 * ⚠️ 돌아올 때마다 부르지는 않는다. 알림 하나 보고 돌아오는 왕복이 잦아, 그때마다
 *    목록이 깜빡이면 오히려 방해가 된다 — **마지막으로 부른 지 30초가 지났을 때만** 부른다.
 */
export function useScreenRefresh(load: () => void | Promise<void>) {
  const { register } = useRefreshApi()
  // load 는 매 렌더 새 함수라 그대로 의존성에 두면 등록이 무한히 반복된다
  const ref = useRef(load)
  ref.current = load
  const lastRun = useRef(Date.now())

  const call = useCallback(() => {
    lastRun.current = Date.now()
    return ref.current()
  }, [])

  useEffect(() => {
    register(call)
    return () => register(null)
  }, [register, call])

  useEffect(() => {
    const onBack = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastRun.current < STALE_MS) return
      void call()
    }
    document.addEventListener('visibilitychange', onBack)
    window.addEventListener('focus', onBack)
    return () => {
      document.removeEventListener('visibilitychange', onBack)
      window.removeEventListener('focus', onBack)
    }
  }, [call])
}
