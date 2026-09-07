import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAppHeight, useNoPinchZoom } from './lib/viewport'
import { AuthProvider } from './contexts/AuthContext'
import { RequireAuth } from './components/RequireAuth'
import { LoginPage } from './pages/LoginPage'
import { PrivacyPage } from './pages/PrivacyPage'
import { HomeGate } from './components/HomeGate'
import { useLang } from './i18n'
import { RefreshProvider } from './contexts/RefreshContext'
import { SalesPage } from './pages/SalesPage'
import { AdminPage } from './pages/AdminPage'
import { MakerPage } from './pages/MakerPage'
import { MyPage } from './pages/MyPage'
import { ChangePasswordPage } from './pages/ChangePasswordPage'

export function App() {
  // 앱 전체 높이를 여기 한 곳에서 정한다 — 화면마다 뷰포트를 다시 재지 않는다
  useAppHeight()
  // 손가락으로 화면을 확대하지 못하게 한다 — 확대되면 레이아웃이 화면 밖으로 밀린다
  useNoPinchZoom()
  /*
   * 언어를 **여기 한 곳에서만** 구독한다.
   *
   * t() 는 모듈 변수를 읽으므로, 구독하지 않은 컴포넌트는 언어를 바꿔도 옛 글자를 든 채
   * 남는다. 컴포넌트마다 useLang() 을 부르게 하면 반드시 빠뜨리는 자리가 생기고,
   * 그 자리만 한국어로 남는다 — 눈에 잘 안 띈다.
   *
   * 이 앱에는 React.memo 가 한 곳도 없어서, 최상위가 다시 그려지면 아래가 전부 따라 그려진다.
   * key 를 바꿔 통째로 다시 마운트하는 방법도 있지만 그러면 **입력 중이던 값이 날아간다.**
   * 다시 그리기만 하면 상태는 그대로 남는다.
   */
  useLang()

  return (
    <AuthProvider>
      <RefreshProvider>
      <BrowserRouter>
        <Routes>
          {/*
            기본 화면 = 컨피규레이터. 로그인하지 않아도 사양을 고르고 금액을 볼 수 있다.
            로그인한 사용자는 자기 화면(영업/관리/특장)으로 보낸다 — 거기 컨피규레이터가 있다.
          */}
          <Route path="/" element={<HomeGate />} />

          {/* 개인정보 처리방침 — 로그인 없이 열려야 한다(동의 전에 읽는 문서). 아직 어디서도 링크하지 않는다. */}
          <Route path="/privacy" element={<PrivacyPage />} />

          <Route path="/login" element={<LoginPage />} />

          <Route path="/change-password" element={
            <RequireAuth skipChangePasswordCheck><ChangePasswordPage /></RequireAuth>
          } />

          <Route path="/sales" element={
            <RequireAuth><SalesPage /></RequireAuth>
          } />
          <Route path="/admin" element={
            <RequireAuth><AdminPage /></RequireAuth>
          } />
          <Route path="/maker" element={
            <RequireAuth><MakerPage /></RequireAuth>
          } />

          {/* 마이페이지 — 역할과 무관하게 로그인한 사람 누구나. 최상단바의 계정 이름으로 들어온다 */}
          <Route path="/me" element={
            <RequireAuth><MyPage /></RequireAuth>
          } />

          <Route path="/conversion" element={<Navigate to="/maker" replace />} />
          {/* 모르는 주소는 기본 화면으로 — 로그인 화면이 첫인상이 되지 않게 */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      </RefreshProvider>
    </AuthProvider>
  )
}
