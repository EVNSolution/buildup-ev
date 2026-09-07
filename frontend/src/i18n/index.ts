import { useSyncExternalStore } from 'react'
import { EN, EN_FMT } from './en'

export type Lang = 'ko' | 'en'

/**
 * 화면 글자를 영어로 바꾼다. **원문이 키다.**
 *
 * 사전에 없으면 한국어를 그대로 돌려준다 — 빠뜨린 자리에서 최악이 「원래 화면」이지
 * 빈 칸이나 `admin.tab.quotes` 같은 날글자가 아니다. 영문화가 덜 끝난 채로 배포해도
 * 화면이 깨지지 않는다는 뜻이고, 그래서 한 번에 다 옮기지 않아도 된다.
 *
 * ⚠️ **값 비교에는 쓰지 말 것.** `t('필수') === row.tag` 같은 코드는 영어일 때 거짓이 된다.
 *    비교는 늘 한국어 원문으로 하고, t() 는 화면에 내보내는 자리에만 쓴다.
 */
export function t(ko: string): string {
  if (lang === 'ko') return ko
  return EN[ko] ?? ko
}

/**
 * 같은 한국어가 자리마다 다른 영어여야 할 때(고객 = Customer / Customers 처럼).
 * 사전에 `원문 문맥` 키가 있으면 그것을, 없으면 보통 번역으로 떨어진다.
 */
export function tc(ko: string, ctx: string): string {
  if (lang === 'ko') return ko
  return EN[`${ko} ${ctx}`] ?? EN[ko] ?? ko
}

/**
 * 값이 끼어드는 문장. **템플릿 문자열을 그대로는 못 찾는다** — 값이 이미 박혀 있어
 * 사전의 키와 영영 일치하지 않기 때문이다. 그래서 틀(패턴)을 키로 두고 값을 나중에 끼운다.
 *
 *   전: `` `${name} 대화` ``
 *   후: tf('{0} 대화', name)
 *
 * 자리표시자가 **번호**인 이유는 영어에서 값의 순서가 바뀌기 때문이다.
 * `'{0} 의 견적 {1}건'` 이 영어로는 `'{1} quote(s) for {0}'` 가 된다.
 */
export function tf(ko: string, ...vals: (string | number)[]): string {
  const pat = lang === 'ko' ? ko : (EN_FMT[ko] ?? ko)
  return pat.replace(/\{(\d+)\}/g, (whole, i) => {
    const v = vals[Number(i)]
    return v === undefined ? whole : String(v)
  })
}

// ── 언어 결정 ────────────────────────────────────────────────────────────────
const KEY = 'buildup-lang'

function normalize(v: string | null | undefined): Lang | null {
  return v === 'en' || v === 'ko' ? v : null
}

/**
 * 순서: URL ?lang → 저장된 선택 → 브라우저 언어 → 한국어.
 *
 * URL 을 맨 앞에 두는 이유는 **링크 하나로 영어 화면을 보여줄 수 있어야** 하기 때문이다.
 * 공개 컨피규레이터 주소를 해외 고객에게 그냥 보내면 된다. 로그인 계정의 설정은
 * 서버에서 내려와 이 저장값을 덮어쓴다(setLang).
 */
function resolve(): Lang {
  try {
    const url = normalize(new URLSearchParams(location.search).get('lang'))
    if (url) {
      localStorage.setItem(KEY, url)
      return url
    }
    const saved = normalize(localStorage.getItem(KEY))
    if (saved) return saved
  } catch {
    /* 사생활 보호 모드에서 localStorage 가 던진다 — 기본값으로 간다 */
  }
  const nav = navigator.language?.toLowerCase() ?? 'ko'
  return nav.startsWith('ko') ? 'ko' : 'en'
}

let lang: Lang = resolve()
const subs = new Set<() => void>()

export function getLang(): Lang {
  return lang
}

export function setLang(next: Lang): void {
  if (next === lang) return
  lang = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    /* 위와 같음 */
  }
  document.documentElement.lang = next
  subs.forEach(fn => fn())
}

/** 화면이 언어 바뀜을 따라가게 한다. 바뀌면 그 화면만 다시 그린다 — 새로고침이 필요 없다. */
export function useLang(): Lang {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn)
      return () => {
        subs.delete(fn)
      }
    },
    () => lang,
    () => lang,
  )
}

document.documentElement.lang = lang
