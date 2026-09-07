import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Segmented } from '../components/ui/Segmented'
import { BTN } from '../styles/buttons'
import { safeTop, safeLeft, safeRight } from '../styles/safeArea'
import { homeFor } from '../lib/surfaces'
import logoUrl from '../assets/logo.png'
import { rolesOf } from '@shared/types/index'
import { useLang, setLang, t } from '../i18n'

/**
 * 마이페이지 — **한 번 정하면 끝인 것들**이 모이는 자리.
 *
 * 언어를 최상단바에 두어 봤더니 줄이 두 줄로 밀렸다. 그 줄은 이미 로고·화면전환·계정·
 * 로그아웃이 자리를 다투고 있고(코드 주석에 「공간 차지가 너무 심하다」는 제보가 그대로 남아 있다),
 * 언어는 **하루에 한 번도 안 누르는 설정**이다. 자주 쓰는 것과 한 번 쓰는 것을 같은 줄에 두면
 * 자주 쓰는 쪽이 밀린다.
 *
 * 들어오는 길은 최상단바의 **계정 이름**이다 — 버튼을 새로 더하지 않았다.
 *
 * ⚠️ 영업·관리·특장 화면과 **떼어 놓는다.** 공용 최상단바를 그대로 쓰면 역할 전환 토글이
 *    같이 뜨는데, `/me` 는 그 셋 중 어디도 아니라서 **아무 데도 아닌 곳에서 「영업」이 켜진 것처럼**
 *    보였다. 여기는 설정 화면이지 넷째 업무 화면이 아니다 — 표지와 돌아가는 길만 둔다.
 */
export function MyPage() {
  const { session, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const lang = useLang()
  const user = session?.user
  const org = session?.org

  /*
   * 돌아갈 곳 — 온 자리로 되돌린다. 주소를 직접 쳐서 들어와 되돌아갈 기록이 없으면
   * 그 계정의 첫 화면으로 보낸다(막다른 길을 만들지 않는다).
   */
  const back = () => {
    const from = (location.state as { from?: string } | null)?.from
    if (from) navigate(from)
    else if (window.history.length > 1) navigate(-1)
    else navigate(user ? homeFor(user.role) : '/')
  }

  return (
    <div style={s.page}>
      {/* 설정 화면 전용 표지 — 역할 전환도, 화면 탭도 없다 */}
      <header style={s.bar}>
        <img src={logoUrl} alt="EV&Solution" style={s.logo} />
        <div style={{ flex: 1 }} />
        <button style={BTN.secondary} onClick={back}>{t('뒤로')}</button>
      </header>
      <div style={s.body}>
        <h1 style={s.title}>{t('마이페이지')}</h1>

        <section style={s.card}>
          <h2 style={s.cardTitle}>{t('계정')}</h2>
          <dl style={s.rows}>
            <Row k={t('이름')} v={user?.name ?? '—'} />
            <Row k={t('이메일')} v={user?.email ?? '—'} />
            <Row k={t('소속 조직')} v={org?.name ?? user?.org_code ?? '—'} />
            <Row k={t('역할')} v={user ? rolesOf(user).join(' · ') : '—'} />
          </dl>
        </section>

        <section style={s.card}>
          <h2 style={s.cardTitle}>{t('언어')}</h2>
          {/*
            역할 전환과 **같은 컨트롤**을 쓴다. 설정 화면에서 새 모양을 하나 더 만들 이유가 없다.
            각 언어는 **그 언어로** 적는다 — 영어를 못 읽는 사람도 「한국어」는 찾을 수 있어야 한다.
          */}
          <Segmented
            items={[{ value: 'ko', label: t('한국어') }, { value: 'en', label: 'English' }] as const}
            value={lang}
            onChange={setLang}
          />
          <p style={s.help}>{t('이 기기에 저장됩니다. 다른 기기에서는 다시 골라 주세요.')}</p>
        </section>

        <section style={s.card}>
          <h2 style={s.cardTitle}>{t('비밀번호')}</h2>
          <button style={BTN.secondary} onClick={() => navigate('/change-password')}>
            {t('비밀번호 변경')}
          </button>
        </section>

        {/*
          로그아웃 — 예전엔 최상단바에 있었다. 하루에 한 번 누를까 말까 한 동작이 늘 자리를
          차지했고, 휴대폰에서는 그 폭이 화면 전환 토글을 눌렀다.

          ⚠️ 로그아웃하면 **홈(공개 컨피규레이터)** 으로 보낸다. 로그인 화면으로 되돌리면
             "나가려는데 다시 들어오라"는 화면이 뜨는 셈이다.
             (세션이 만료돼 튕기는 경우는 RequireAuth 가 로그인 화면으로 보낸다 — 그건 하던 일이 있는 경우다)
        */}
        <section style={s.card}>
          <button
            style={{ ...BTN.secondary, color: 'var(--muted)' }}
            onClick={async () => { await logout(); navigate('/', { replace: true }) }}
          >
            {t('로그아웃')}
          </button>
        </section>
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={s.row}>
      <dt style={s.k}>{k}</dt>
      <dd style={s.v}>{v}</dd>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 },
  bar: {
    flexShrink: 0, display: 'flex', alignItems: 'center', gap: 'var(--sp-4)',
    height: safeTop('60px'), paddingTop: 'env(safe-area-inset-top, 0px)', boxSizing: 'border-box',
    paddingLeft: safeLeft('var(--sp-5)'), paddingRight: safeRight('var(--sp-5)'),
    borderBottom: 'var(--hairline)', background: '#fff', overflow: 'hidden',
  },
  logo: { height: 28, width: 'auto', display: 'block', flexShrink: 0 },
  // 설정은 읽고 고르는 화면이라 한 단 좁게 둔다 — 넓으면 라벨과 값이 멀어져 눈이 오간다
  body: { flex: 1, overflowY: 'auto', padding: 'var(--sp-5)', maxWidth: 560, width: '100%' },
  title: {
    fontSize: 'var(--fs-section)', fontWeight: 700, letterSpacing: 'var(--ls-tight)',
    margin: '0 0 var(--sp-5)', color: 'var(--dark)',
  },
  card: {
    border: 'var(--hairline)', borderRadius: 10, padding: 'var(--sp-5)',
    marginBottom: 'var(--sp-4)', background: '#fff',
    display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', alignItems: 'flex-start',
  },
  cardTitle: { fontSize: 'var(--fs-label)', fontWeight: 700, margin: 0, color: 'var(--dark)' },
  rows: { margin: 0, width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' },
  /*
   * 라벨과 값이 **한 줄**에 서고, 좁아지면 값이 아래로 내려간다.
   * 영어는 한국어보다 길어 라벨 칸을 못 박으면 잘린다 — 그래서 폭을 정하지 않고 밀어낸다.
   */
  row: { display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', margin: 0 },
  k: { fontSize: 'var(--fs-label)', color: 'var(--muted)', margin: 0, minWidth: 96 },
  v: { fontSize: 'var(--fs-label)', color: 'var(--dark)', margin: 0, wordBreak: 'break-word' },
  help: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', margin: 0, lineHeight: 1.5 },
}
