# `src/` — TypeScript frontend

Entry is `main.ts`, loaded inside wp-admin. Built by Vite (see root `CLAUDE.md`) into `live-sandbox-editor/build/main.js`, `boot.js`, `app.js`, and `main.css`; only `main.js` is enqueued as an ES module via `wp_enqueue_script_module()`.

## Modules

- `main.ts` — bootstraps the worker environment, then runtime-imports the built `boot.js` entry. Nothing else belongs here.
- `app-entry.ts` — builds to `boot.js`, finds the admin root, and calls `initApp(root)`. This is a separate Vite entry so chunks do not import the WP-enqueued `main.js` as a preload helper.
- `monaco-environment.ts` — installs `self.MonacoEnvironment` and creates Vite-managed Monaco workers. Imported by `main.ts` before the app entry is runtime-imported.
- `app.ts` — builds the DOM (editor pane, file tree, preview iframe, status bar, drag handle), wires tab state, calls `initPlayground`, `initFileExplorer`, `addSaveCommand`. The single orchestrator.
- `editor.ts` — Monaco lifecycle. One shared `IStandaloneCodeEditor`, per-path `ITextModel` cache, Cmd/Ctrl-S command, extension→language map.
- `file-explorer.ts` — recursive tree over `PlaygroundClient.listFiles`. Directories sort first; each node lazily renders children on expand.
- `filesystem.ts` — thin async wrappers over `PlaygroundClient` file ops. Keep it thin; don't let business logic leak in.
- `playground.ts` — boots Playground via `startPlaygroundWeb`, then pulls `/wp-content` and a SQL dump from the PHP REST routes, writes them into the Playground VFS, and fixes `siteurl`/`home`. See "Import pipeline" below.
- `types.ts` — shared types plus `getAppData()`, which reads the script-module data blob.

## Conventions

- Biome enforces single quotes + tabs; imports auto-organized. Run `npx biome check .` before committing.
- `tsconfig` extends `@tsconfig/strictest`. No implicit any, no unchecked indexed access — expect narrowing work.
- Relative imports end in `.js` (ESM resolution, even though source is `.ts`). Keep this.
- DOM built imperatively via the local `el(tag, className)` helper in `app.ts`. No framework, no JSX; don't introduce one without discussion.
- CSS lives in `live-sandbox-editor/style.css`, not here. Class names use the `lse-` prefix.

## Passing data from PHP

JS reads a data blob from `#wp-script-module-data-live-sandbox-editor` via `getAppData()` in `types.ts`. **Never** use `wp_localize_script` for this plugin — it's a script module and `wp_localize_script` silently does nothing. Adding a field means updating the PHP filter, the `AppData` interface, and consumers together. Full recipe: `.claude/docs/script-module-data.md`.

## Import pipeline (`playground.ts`)

Boots Playground and populates its VFS with the host site:

1. `startPlaygroundWeb` with blueprint:
   ```ts
   { preferredVersions: { wp: 'latest', php: '8.2' },
     steps: [{ step: 'login', username: 'admin', password: 'password' }] }
   ```
   Remove the `login` step to land the user logged-out. `steps` accepts any Playground blueprint step; see `@wp-playground/client` types.
2. Pull `/wp-content` via `GET {restUrl}/reprint-files?cursor=…` (base64 → `Uint8Array` → `writeFile`, looped on opaque cursor).
3. Pull DB via `GET {restUrl}/reprint-db`, write to `/tmp/live-sandbox-import.sql`, execute statement-by-statement inside Playground.
4. `update_option('siteurl'|'home', …)` with the Playground URL so internal links resolve.

503 from either route means Reprint classes are missing on the host — the pipeline logs and continues without import. Don't hard-fail.

Full wire contract (shapes, budgets, cursor semantics, statement-split regex, base64 rationale, DB-route pagination recipe): **`.claude/docs/import-pipeline.md`**. Consult it before editing `playground.ts` or either route.

## Tab / app state

All app state is closure-local inside `initApp(root)` in `app.ts`:
- `openTabs: OpenFile[]` — `OpenFile` is `{ path, label }` (see `types.ts`).
- `activeTab: string | null`
- `playgroundClient: PlaygroundClient | null`
There is no global store, no framework, no persistence — reloading the page loses tab state.

Init order inside `initApp`:
1. Build DOM (editor pane, file tree, preview iframe, status bar, loading overlay).
2. `initEditor(monacoContainer)` — Monaco is synchronous.
3. `initPlayground(iframe, onStatus)` — awaits Playground boot + the whole import pipeline. Blocks everything else.
4. `initFileExplorer(...)` — needs `client` and `wpContentPath` (= `docroot + '/wp-content'`).
5. `addSaveCommand(...)` — Cmd/Ctrl-S handler, needs `client`.

## Reading files

`filesystem.ts::readFile` calls `PlaygroundClient.readFileAsText` — text only. The `PlaygroundClient` surface evolves; re-check signatures in `node_modules/@wp-playground/client` before adding new methods.

## Status bar

The status bar is `<div class="lse-status-bar">` containing one `<span class="lse-status-indicator">● <state></state></span>`. `app.ts` mutates its `textContent` directly for progress updates (`● Booting Playground…`, `● Ready`, `● Saved: <file>`). Transient success messages auto-revert to `● Ready` after ~2000ms via `setTimeout`. Errors go to `console.error` with the `[live-sandbox-editor]` prefix; don't surface stack traces to the status bar.

## Keyboard shortcuts

The only shortcut is Cmd/Ctrl-S, registered inside Monaco via `editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, …)` in `editor.ts`. `KeyMod.CtrlCmd` resolves to Cmd on macOS and Ctrl elsewhere.

## Gotchas

- Monaco web workers are wired in `monaco-environment.ts` using Vite's `?worker` imports. `main.ts` imports that environment module first, then runtime-imports the built `boot.js` entry so Monaco sees `self.MonacoEnvironment` before any `monaco-editor` module evaluates. Keep `main.js` out of Vite's preload-helper import graph: WordPress enqueues it with a `?ver=...` query string, while chunks import bare relative URLs. If a chunk imports `./main.js`, the browser treats it as a different module and runs the entry side effects again. Keep `app.js` side-effect-free too; Vite's lazy Monaco chunks may import it as a shared helper module. Let Vite own worker creation so URLs resolve relative to the build output; do not hand-register worker entry points in PHP or pass worker URLs through `AppData`.
- `@wp-playground/client` API evolves fast; always re-check the current `PlaygroundClient` signatures before adding calls.
- `initPlayground` is imported dynamically (`await import('@wp-playground/client')`) to keep the initial chunk small; preserve that.
