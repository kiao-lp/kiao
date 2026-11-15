import 'regenerator-runtime/runtime';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

import 'kiao-style/style-tools.css';

import 'kiao-style/kiao-dark.css';
import 'kiao-style/kiao-light.css';
import 'kiao-style/kiao-sober-dark.css';
import 'kiao-style/kiao-sober-light.css';

// @ts-ignore
console.log('Build Date:', BUILD_DATETIME);

const container = document.getElementById('root');
const root = createRoot(container!);
// read from the file store now, so it cannot resolve before the client exists.
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
