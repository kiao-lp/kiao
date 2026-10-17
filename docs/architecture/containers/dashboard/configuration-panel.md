# The configuration panel (`src/cms-core/toolbox/`)

> Detail of [ARCHITECTURE.md](../../../../exchange/dashboard/ARCHITECTURE.md).
> `src/…` paths are relative to `exchange/dashboard/`; every other path to the repo root.

A tool bar tab, `Configuration`, registered in `CoreContributions` beside the file navigation and
the Git panel, and put in front by the **Configuration…** entry of the tools dropdown. It reads as a
package manager because that is what it is: rows, each with its state, its small print and one
control.

**One list, three kinds.** A row is a runtime, an MCP server or a plugin, and the difference is real
— the first two are installed on the machine worker runs on, the third is built into this
build and switched on per store. It is not, though, a difference the reader is looking for: somebody
after "ffmpeg" or "mindmap" wants one place to look. So the kinds are said by an **icon on the row**
and a **chip in the filter bar**, not by cutting the panel into sections — which is what it did until
it read as two panels stacked, each scrolling on its own. The bar above the list filters by kind and
searches title, description and id.

What it manages lives entirely in worker (`internal/toolbox`, and `PROTOCOL.md` § *The
toolbox*): a catalogue **compiled into the service binary**, so the panel never sends a command, a
package name or a version — only a catalogue id. That is what keeps a UI that installs software off
the machine's command line.

- **`useToolbox.ts`** — the whole conversation with the service. An install takes minutes, so the
  service answers a job and this polls it, the idiom `GitSyncMonitor` and `useChatAuth` already
  use: Dashboard has no streaming transport but the chat socket, and that is a turn's channel. The
  job lives in the service, so closing the tab mid-install and reopening it finds the same job still
  running with its log where it left off.
- **`ToolboxPanel.tsx`** — the rows, of both sources, in one filtered list. A dependency prompt is
  composed **from the catalogue the panel already holds** (`missingRequires`), so "installing
  markitdown also installs uv and Python — is that alright?" is answered before a request is sent. A
  row this service did not install offers no uninstall, because the service would refuse it and
  saying so with a missing button is better than saying it with a 400.
- **`usePlugins.ts`** — the other source, and the only one about the *store* rather than the machine.
  Same two halves as the service's: a catalogue that is fixed (built into the assembly rather than
  compiled into a binary) and a state the user writes, here `plugins` in `dashboard.json`. The one
  thing it does that installing does not is **ask for a reload**, and say why: a plugin brings
  creation commands, providers and tool bar tabs, and the provider stack is built out of the list
  once, before the first render. Turning one on mid-session would mean rebuilding that stack under a
  mounted application. The panel also names the plugins the store asks for that this build does not
  carry — see *[The assembly](../../../../exchange/dashboard/ARCHITECTURE.md#the-assembly-what-is-shipped-and-what-is-loaded)*.
- **`itemKinds.tsx` / `ToolboxFilter.tsx`** — the kind vocabulary and the bar that uses it. The icon
  on a row and the chip in the bar are the same icon on purpose: the filter teaches the row and the
  row teaches the filter, so neither needs a legend. The sentences the section titles used to carry
  live on the icons' tooltips.
- **`toolboxTab.tsx`** — the tab declaration. Ships in the right column, where a panel that is
  consulted rather than worked in belongs.

Two numbers on a server's row are worth the space: how many tools it declares, and how many bytes of
tool definitions every single request to the model pays for it. Registering eight servers is a real
bill, and nothing else in Dashboard would ever say so. The registration switch is separate from installing
for the same reason — a server can be kept on the machine and switched off.

And one sentence above the list, because nobody would guess it: once anything is registered here, a
turn is handed **exactly** these servers, and servers registered with the `claude` command itself
stop arriving.
