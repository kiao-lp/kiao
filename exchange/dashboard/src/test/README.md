# Dashboard test helpers

React tests import Testing Library from `src/test/render` and Vitest from `vitest`.
The render helper keeps RTL's options and result, including `wrapper` and `rerender`.
It adds only an optional worker client, with the methods that the rendered tree needs:

```tsx
import { render, screen } from 'src/test/render';

render(<Preview />, { workerClient: { getDownloadUrl: path => `/files/${path}` } });
```

Without `workerClient`, render mounts exactly the tree supplied. Tests keep their own
providers when those providers are the subject of the test. `renderHook` is RTL's own.

`mocks.tsx` contains fresh named spies, an external store, and small component stand-ins.
`agents.ts` builds independent agent catalogues; `webSocket.ts` provides a transport that
tests can open, feed frames and inspect while exercising the real socket provider.
Mocks and fixtures specific to a plugin live in that plugin's `test/` directory.

Create mock state before Vitest evaluates mocked modules. Import its factory through an
async `vi.hoisted`, keeping the `vi.mock` declarations and their module paths in the test:

```ts
const client = await vi.hoisted(async () => {
    const { mockFunctions } = await import('src/test/mocks');
    return mockFunctions('getFileText', 'listFiles');
});

vi.mock('@cms-core', () => ({ useWorkerClient: () => client }));
```

Factories return new state and spies for every caller. They do not install mocks or reset
them globally; each suite keeps its existing reset lifecycle and local overrides.
Helpers imported during hoisting must avoid runtime imports of application modules.

The antd policy stays in `src/setupTests.ts`: real controls, refs, portals and events,
with only runtime CSS generation disabled. Use those controls directly; preserve any
local stand-in only where the test needs that particular boundary.
