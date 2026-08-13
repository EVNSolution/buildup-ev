import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import { App } from './App'
import { startScrollHints } from './lib/scrollHint'

// 스크롤 그림자(더 볼 게 있다) — 화면 어디서든 같은 방식으로 도는 한 벌
startScrollHints()

const root = document.getElementById('root')!
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
