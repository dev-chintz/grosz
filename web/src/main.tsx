import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles/tokens.css';
import './styles/global.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import { Layout } from './components/Layout.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { Calendar } from './pages/Calendar.tsx';
import { Categories } from './pages/Categories.tsx';
import { ComingSoon } from './pages/ComingSoon.tsx';
import { Recurring } from './pages/Recurring.tsx';
import { Reports } from './pages/Reports.tsx';
import { Settings } from './pages/Settings.tsx';
import { Transactions } from './pages/Transactions.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="transakcje" element={<Transactions />} />
          <Route path="cykliczne" element={<Recurring />} />
          <Route path="cykliczne/:id" element={<Recurring />} />
          <Route path="kalendarz" element={<Calendar />} />
          <Route path="kategorie" element={<Categories />} />
          <Route path="raporty" element={<Reports />} />
          <Route path="ustawienia" element={<Settings />} />
          <Route path="*" element={<ComingSoon title="Nie ma takiej strony" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
