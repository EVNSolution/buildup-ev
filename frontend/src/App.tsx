import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { RequireAuth } from './components/RequireAuth'
import { LoginPage } from './pages/LoginPage'
import { SalesPage } from './pages/SalesPage'
import { AdminPage } from './pages/AdminPage'
import { MakerPage } from './pages/MakerPage'
import { ChangePasswordPage } from './pages/ChangePasswordPage'

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
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
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
