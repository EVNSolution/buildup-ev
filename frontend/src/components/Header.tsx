import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useRefreshApi } from '../contexts/RefreshContext'
import { useIsMobile } from '../hooks/useIsMobile'
import { Segmented } from './ui/Segmented'
import { surfacesFor } from '../lib/surfaces'
import { BTN } from '../styles/buttons'
import logoUrl from '../assets/logo.png'
import type { CustomerInfo, Role } from '@shared/types/index'

// 로고 옆 배지는 영어 한 단어로만 — 한글까지 넣으면 배지가 길어져 로고를 밀어낸다
const ROLE_LABELS: Record<Role, string> = {
  SALES: 'Sales',
  ADMIN: 'Admin',
  MAKER: 'Maker',
}

interface Props {
  customer?: CustomerInfo | null
}

export function Header({ customer }: Props) {
  const { session, logout } = useAuth()
  // 지금 화면이 「다시 불러오기」를 등록해 두었을 때만 버튼을 띄운다
  const { refresh, running, run } = useRefreshApi()
  const navigate = useNavigate()
  const location = useLocation()
  const isMobile = useIsMobile()
  const user = session?.user
  const org  = session?.org

  // 고객 칩을 감출 폭 기준 — 헤더 내용 필요폭(칩 포함 1041px)에서 나온 값
  const isNarrow = useIsMobile(1100)

  // 이 계정이 쓸 수 있는 화면(겸직 포함). 하나뿐이면 전환 토글 자체를 띄우지 않는다.
  const mySurfaces = user ? surfacesFor(user) : []

  // 저장된 고객 표시 전용. 예전엔 눌러서 진입 팝업을 다시 열었지만, 고객정보 입력이
  // 견적 저장 단계로 옮겨가면서 여는 대상이 사라졌다(보조금 조건은 가격바에서 고친다).
  const custLabel = customer
    ? `${customer.name} · ${customer.region_code} · ${customer.is_small_business ? '소상공인' : '일반'}`
    : null

  return (
    <header style={{
      ...styles.header,
      // 모바일은 줄바꿈으로 높이가 달라지므로 고정 높이를 풀고 예전 여백을 쓴다
      ...(isMobile ? { height: 'auto', padding: '10px 14px' } : {}),
      flexWrap: isMobile ? 'wrap' : 'nowrap',
      ...(isMobile ? { gap: 8 } : {}),
    }}>
      {/*
        로고 · 구분선 · 워드마크. 셋을 붙여 하나의 표지로 읽히게 한다 —
        굵기·자간은 로고(800/-0.05em)가 가장 강하고 워드마크가 반 단계 아래(700/-0.035em)다.
      */}
      <div style={styles.brand}>
        <img src={logoUrl} alt="EV&Solution" style={styles.logo} />
        {/*
          휴대폰에서 전환 토글까지 있으면 한 줄에 다 들어가지 않아 로그아웃이 둘째 줄로 밀린다.
          그때는 워드마크를 접는다 — 로고만으로도 어느 서비스인지 알 수 있고,
          토글은 접으면 다른 화면으로 갈 길이 사라진다(중요도가 다르다).
        */}
        {!(isMobile && mySurfaces.length > 1) && (
          <>
            <span style={styles.brandLine} aria-hidden />
            <span style={styles.wordmark}>Buildup-EV</span>
          </>
        )}
      </div>
      {user && !isMobile && <span style={styles.badge}>{ROLE_LABELS[user.role]}</span>}
      <div style={{ flex: 1 }} />

      {/*
        화면 전환 — **가진 역할이 둘 이상일 때만** 나온다.
        역할이 하나면 고를 것이 없어 자리만 차지한다(빈 토글은 "뭔가 더 있나" 하고 누르게 된다).
        겸직을 준 계정과 마스터 계정이 대상이다.
      */}
      {mySurfaces.length > 1 && (
        <div style={{ flexShrink: 0 }}>
          <Segmented
            items={mySurfaces.map(s => ({ value: s.path, label: s.label }))}
            value={mySurfaces.find(s => s.path === location.pathname)?.path ?? mySurfaces[0]!.path}
            onChange={p => navigate(p)}
            size={isMobile ? 'sm' : undefined}
          />
        </div>
      )}

      {/*
        영업화면 전용: 저장된 고객 표시 칩(클릭 동작 없음).
        이 줄에서 가장 길어 자리가 모자라면 가장 먼저 줄어든다. 1100px 아래에서는
        줄여 봐야 '…' 만 남아 자리만 차지하므로 아예 감춘다.
      */}
      {custLabel && !isNarrow && <span style={styles.custChip} title={custLabel}>{custLabel}</span>}

      {/* 로그인 사용자 표시 */}
      {user && (
        <div style={styles.userInfo}>
          <span style={styles.userName}>{user.name}</span>
          {!isMobile && <span style={styles.userOrg}>{org?.name ?? user.org_code}</span>}
        </div>
      )}

      {/*
        로그아웃하면 **홈(공개 컨피규레이터)** 으로 보낸다.
        로그인 화면으로 되돌리면 "나가려는데 다시 들어오라"는 화면이 뜨는 셈이다.
        (세션이 만료돼 튕기는 경우는 RequireAuth 가 로그인 화면으로 보낸다 — 그건 하던 일이 있는 경우다)
      */}
      {/*
        새로고침 — **설치형 앱에는 주소창도 새로고침도 없다.** 게다가 이 앱은 문서가
        스크롤되지 않아 당겨서 새로고침도 발동하지 않는다. 목록이 오래됐거나 화면이
        막혔을 때 누를 자리가 하나는 있어야 한다.

        ⚠️ 화면을 리로드하지 않고 **지금 화면의 데이터만** 다시 불러온다.
           견적 저장·고객정보 수정 같은 긴 폼이 열려 있어도 입력이 날아가지 않는다.
      */}
      {refresh && (
        <button
          style={{ ...BTN.secondary, color: 'var(--muted)', flexShrink: 0, opacity: running ? 0.5 : 1 }}
          disabled={running}
          onClick={run}
          title="지금 화면을 다시 불러옵니다"
          aria-label="새로고침"
        >
          {running ? '불러오는 중' : '새로고침'}
        </button>
      )}

      <button
        style={{ ...BTN.secondary, color: 'var(--muted)', flexShrink: 0 }}
        onClick={async () => { await logout(); navigate('/', { replace: true }) }}
      >
        로그아웃
      </button>
    </header>
  )
}

/**
 * 최상단바 크기 — **고정값**. 예전 크기의 약 1.56배(로고 18 → 28px)로 통일했다.
 *
 * 화면 폭에 따라 늘였다 줄였다 하면 창을 옮길 때마다 크기가 달라져 어수선하다.
 * 그래서 한 벌로 못 박되, 좁은 화면에서도 깨지지 않는 선에서 정했다(브라우저 실측):
 *   내용 필요폭 828px — 관리자·특장 화면은 창 900px 부터 여유 있음
 *   영업 화면은 고객 칩이 붙어 1041px 필요 → 칩만 줄어들게 해 좁아도 안 깨진다
 * 두께는 60px. 한때 107px(2배)로 뒀는데 태블릿에서 화면을 너무 잡아먹어 되돌렸다.
 * 글자는 그대로 두고 위아래 여백만 줄인 값이다(내용 높이 ≒ 49px).
 */
const HEADER_H = 60

const styles: Record<string, React.CSSProperties> = {
  header: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--sp-4)',
    height: HEADER_H,
    boxSizing: 'border-box',
    padding: '0 var(--sp-5)',
    borderBottom: 'var(--hairline)',
    background: '#fff',
    // 어떤 경우에도 내용이 바 밖으로 새어 나가지 않게
    overflow: 'hidden',
  },
  brand: { display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexShrink: 0 },
  // 로고 이미지(706x261). 높이만 정하고 폭은 비율대로.
  logo: { height: 28, width: 'auto', display: 'block', flexShrink: 0 },
  // 로고와 워드마크를 가르는 세로 헤어라인 — 둘이 한 낱말로 붙어 읽히는 것을 막는다
  brandLine: { width: 1, height: 18, background: 'var(--line)', display: 'block', flexShrink: 0 },
  wordmark: {
    fontSize: 'var(--fs-section)', fontWeight: 700, letterSpacing: '-0.035em',
    color: 'var(--dark)', whiteSpace: 'nowrap',
  },
  badge: {
    background: 'var(--lime)', color: 'var(--dark)', whiteSpace: 'nowrap', flexShrink: 0,
    fontWeight: 'var(--fw-section)' as React.CSSProperties['fontWeight'],
    fontSize: 'var(--fs-caption)', padding: '3px var(--sp-3)', borderRadius: 'var(--r-pill)',
  },
  // 고객 칩은 이 줄에서 가장 덜 중요하고 가장 길다 — 자리가 모자라면 이것부터 줄인다
  custChip: {
    fontSize: 'var(--fs-label)', border: 'var(--hairline)', borderRadius: 'var(--r-pill)',
    padding: '5px var(--sp-3)', background: '#fff', color: 'var(--body)',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flexShrink: 1,
  },
  userInfo: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1, flexShrink: 0 },
  userName: {
    fontSize: 'var(--fs-label)', fontWeight: 'var(--fw-section)' as React.CSSProperties['fontWeight'],
    color: 'var(--dark)', whiteSpace: 'nowrap',
  },
  userOrg: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', whiteSpace: 'nowrap' },
}
