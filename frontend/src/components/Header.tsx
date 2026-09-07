import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useIsMobile } from '../hooks/useIsMobile'
import { Segmented } from './ui/Segmented'
import { surfacesFor } from '../lib/surfaces'
import { useLang, t } from '../i18n'
import logoUrl from '../assets/logo.png'
import { safeTop, safeLeft, safeRight } from '../styles/safeArea'
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
  const { session } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const isMobile = useIsMobile()
  useLang()  // 언어가 바뀌면 최상단바 글자도 따라간다
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
          워드마크는 **좁은 화면에서 접는다.** 로고만으로도 어느 서비스인지 알 수 있고,
          이 줄에서 자리를 다투는 것은 전환 토글이다 — 토글이 눌리면 못 쓰는 버튼이 되지만
          워드마크는 없어도 아무것도 잃지 않는다.
        */}
        {!isMobile && (
          <>
            <span style={styles.brandLine} aria-hidden />
            <span style={styles.wordmark}>Buildup-EV</span>
          </>
        )}
      </div>
      {user && !isMobile && <span style={styles.badge}>{ROLE_LABELS[user.role]}</span>}
      {/* 밀개 — 남는 폭을 먹어 오른쪽 것들을 끝으로 민다 */}
      <div style={{ flex: 1 }} />

      {/*
        화면 전환 — **가진 역할이 둘 이상일 때만** 나온다.
        역할이 하나면 고를 것이 없어 자리만 차지한다(빈 토글은 "뭔가 더 있나" 하고 누르게 된다).
        겸직을 준 계정과 마스터 계정이 대상이다.
      */}
      {mySurfaces.length > 1 && (
        /*
         * 휴대폰에서도 **한 줄 안에** 둔다.
         *
         * 한때 제 줄을 통째로 내줬더니 헤더가 60 → 116px 이 되어 화면을 너무 먹었다
         * (제보: 「공간 차지가 너무 심하다」). 대신 이 줄에서 **없어도 되는 것을 접는다** —
         * 워드마크와 계정 이름이다. 그러면 토글이 제 크기로 설 자리가 난다.
         *
         * ⚠️ 남는 폭을 **채우게 하지 않는다**(`fullWidth` 금지). 그렇게 했더니 칸 하나가
         *    화면 절반을 먹었다(제보: 「토글버튼 자체가 너무 큼」). 글자 몇 자를 고르는
         *    버튼은 글자만큼만 크면 된다 — 넓힐 이유도, 줄일 이유도 없다.
         */
        <div style={{ flexShrink: 0 }}>
          <Segmented
            // 표의 label 은 한국어 그대로 둔다 — 값 비교에 쓰인다. 그리는 자리에서만 옮긴다
            items={mySurfaces.map(s => ({ value: s.path, label: t(s.label) }))}
            value={mySurfaces.find(s => s.path === location.pathname)?.path ?? mySurfaces[0]!.path}
            onChange={p => navigate(p)}
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
      {/*
        계정 이름 — 한때 좁은 화면에서 **접었다.** 이제는 접지 않고 **줄인다.**
        마이페이지로 들어가는 유일한 길이라, 접으면 휴대폰에서 설정에 닿을 방법이 사라진다
        (언어를 여기로 옮기면서 실제로 그렇게 됐다). 고객 칩과 같은 방식으로 —
        자리가 모자라면 사라지는 게 아니라 '…' 로 줄어든다.
      */}
      {user && (
        /*
         * 계정 이름이 곧 **마이페이지로 가는 길**이다. 언어·비밀번호 같은 「한 번 정하면 끝」인
         * 설정을 최상단바에 벌여 놓으면 줄이 두 줄로 밀린다(언어 토글을 넣어 보고 실제로 겪음).
         * 이 줄에 컨트롤을 더하지 않고, 이미 있는 이름에 길을 붙인다.
         */
        <button
          type="button"
          style={styles.userInfo}
          // 온 자리를 실어 보낸다 — 마이페이지의 「뒤로」가 여기로 되돌린다
          onClick={() => navigate('/me', { state: { from: location.pathname } })}
          title={t('마이페이지')}
        >
          <span style={styles.userName}>{user.name}</span>
          {!isMobile && <span style={styles.userOrg}>{org?.name ?? user.org_code}</span>}
        </button>
      )}

      {/*
        로그아웃은 **마이페이지로 옮겼다**(계정 이름 → 마이페이지).
        하루에 한 번 누를까 말까 한 동작이 이 줄에서 늘 자리를 차지하고 있었고,
        휴대폰에서는 그 폭이 화면 전환 토글을 눌렀다. 계정에 딸린 동작은 계정 화면에 둔다 —
        메일·채팅 앱들이 계정 메뉴 안에 로그아웃을 두는 것과 같다.
      */}
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
    /*
     * 아이폰 노치·다이내믹 아일랜드 아래로 내려 앉힌다. 흰 배경은 화면 꼭대기까지
     * 올라가고 로고·버튼만 그만큼 내려온다 — 바를 낮추지 않는다.
     * 좌우도 둥근 모서리와 가로 모드를 감안해 벌린다.
     */
    height: safeTop(`${HEADER_H}px`),
    paddingTop: 'env(safe-area-inset-top, 0px)',
    boxSizing: 'border-box',
    paddingLeft: safeLeft('var(--sp-5)'),
    paddingRight: safeRight('var(--sp-5)'),
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
  userInfo: {
    display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1,
    // 자리가 모자라면 **사라지는 게 아니라 줄어든다** — 길이 없어지면 안 된다
    flexShrink: 1, minWidth: 0, overflow: 'hidden',
    // 버튼으로 바꾸면서 브라우저 기본 모양은 지운다 — 보이던 것과 같아야 한다
    background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer',
  },
  userName: {
    fontSize: 'var(--fs-label)', fontWeight: 'var(--fw-section)' as React.CSSProperties['fontWeight'],
    color: 'var(--dark)', whiteSpace: 'nowrap',
    overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%',
  },
  userOrg: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', whiteSpace: 'nowrap' },
}
