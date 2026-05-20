// SPDX-FileCopyrightText: Maik-0000FF
// SPDX-License-Identifier: GPL-3.0-or-later

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './style.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('editor: #root element missing from index.html');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
