/** 组装首页与随笔页路由，不承载业务计算。 */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import ThemeProvider from './components/ui/ThemeProvider';
const LandingPage = lazy(() => import('./routes/LandingPage'));
const NotebookPage = lazy(() => import('./routes/NotebookPage'));
export default function App() {
  return (
    <ThemeProvider>
    <BrowserRouter>
      <Suspense fallback={<div role="status" style={{ padding: '2rem', background: 'var(--yh-bg)', color: 'var(--yh-accent)', minHeight: '100vh' }}>萤火正在点亮……</div>}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/notebook" element={<NotebookPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
    </ThemeProvider>
  );
}
