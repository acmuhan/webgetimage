import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline, ThemeProvider, createTheme, LinearProgress } from '@mui/material';
import { zhCN } from '@mui/material/locale';
import Visitor from './pages/Visitor.jsx';

// 控制台单独拆包，访客不需要下载
const Admin = lazy(() => import('./pages/Admin.jsx'));

const theme = createTheme(
  {
    colorSchemes: { light: true, dark: true },
    cssVariables: { colorSchemeSelector: 'media' },
    shape: { borderRadius: 10 },
    palette: { primary: { main: '#3f51b5' } },
  },
  zhCN,
);

const isAdmin = location.pathname.replace(/\/+$/, '') === '/admin';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline enableColorScheme />
      {isAdmin ? (
        <Suspense fallback={<LinearProgress />}>
          <Admin />
        </Suspense>
      ) : (
        <Visitor />
      )}
    </ThemeProvider>
  </StrictMode>,
);
