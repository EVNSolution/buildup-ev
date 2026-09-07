import { useNavigate } from 'react-router-dom'
import { Header } from '../components/Header'
import { useAuth } from '../contexts/AuthContext'
import { Segmented } from '../components/ui/Segmented'
import { BTN } from '../styles/buttons'
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
 */
export function MyPage() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const lang = useLang()
  const user = session?.user
  const org = session?.org

  return (
    <div style={s.page}>
      <Header />
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
            items={[{ value: 'ko', label: '한국어' }, { value: 'en', label: 'English' }] as const}
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
