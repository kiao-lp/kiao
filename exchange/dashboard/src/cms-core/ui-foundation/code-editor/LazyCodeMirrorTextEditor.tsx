import { lazyComponent } from '../react/lazyComponent';

export const CodeMirrorTextEditor = lazyComponent(() => import('./CodeMirrorTextEditor').then(m => ({ default: m.CodeMirrorTextEditor })));
