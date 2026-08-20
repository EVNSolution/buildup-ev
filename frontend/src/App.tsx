import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { RequireAuth } from './components/RequireAuth'
import { LoginPage } from './pages/LoginPage'
import { PrivacyPage } from './pages/PrivacyPage'
import { HomeGate } from './components/HomeGate'
import { RefreshProvider } from './contexts/RefreshContext'
import { SalesPage } from './pages/SalesPage'
import { AdminPage } from './pages/AdminPage'
import { MakerPage } from './pages/MakerPage'
import { ChangePasswordPage } from './pages/ChangePasswordPage'

export function App() {
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

          <Route path="/conversion" element={<Navigate to="/maker" replace />} />
          {/* 모르는 주소는 기본 화면으로 — 로그인 화면이 첫인상이 되지 않게 */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      </RefreshProvider>
    </AuthProvider>
  )
}
