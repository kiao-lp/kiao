import { lazyComponent } from '../../core/lazyComponent';

export const CodeMirrorTextEditor = lazyComponent(() => import('./CodeMirrorTextEditor').then(m => ({ default: m.CodeMirrorTextEditor })));
