import 'regenerator-runtime/runtime';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

import 'kiao-style/style-tools.css';

// kiao-dark.css carries the base rules as well as its own tokens; the other themes are
// token blocks laid over it and have to come after, or the dark ones win on equal specificity.
import 'kiao-style/kiao-dark.css';
import 'kiao-style/kiao-light.css';
import 'kiao-style/kiao-sober-dark.css';
import 'kiao-style/kiao-sober-light.css';

// @ts-ignore
console.log('Build Date:', BUILD_DATETIME);

const container = document.getElementById('root');
const root = createRoot(container!);
// ThemeProvider is mounted inside App, below the view-state gate: the theme is
// read from the file store now, so it cannot resolve before the client exists.
// index.html carries data-theme="dark" so the screens shown until then are styled.
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
