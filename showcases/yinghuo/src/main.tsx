/** 初始化前端本地词库并挂载 React 应用。 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ensureVocabBundleSeeded } from './services/vocabKnowledge'
import { initializeTheme } from './services/theme'

initializeTheme()
void ensureVocabBundleSeeded()

document.body.classList.add('cinematic-overlay');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
