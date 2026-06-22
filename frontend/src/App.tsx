import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { SalesPage } from './pages/SalesPage'
import { ConversionPage } from './pages/ConversionPage'
import { AdminPage } from './pages/AdminPage'

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/sales" element={<SalesPage />} />
          <Route path="/conversion" element={<ConversionPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<Navigate to="/sales" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
