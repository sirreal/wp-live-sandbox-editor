# `src/` — TypeScript Frontend

Frontend source for the Monaco editor and WordPress Playground admin app.

## Guardrails

- Keep the no-framework, imperative DOM style. Do not introduce a framework or JSX without discussion.
- Relative local imports end in `.js`, even when importing `.ts` source files.
- CSS lives in `live-sandbox-editor/style.css`; keep app classes under the `lse-` prefix.
- Keep `filesystem.ts` as thin async wrappers over `PlaygroundClient` file operations.
- Re-check the installed `@wp-playground/client` signatures before adding new Playground calls.
- Preserve the dynamic import of `@wp-playground/client`.

## PHP Data

Read `../.claude/docs/script-module-data.md` before changing data passed from PHP to JS.

- JS reads data through `getAppData()` in `types.ts`.
- Adding a field means updating the PHP filter, `AppData`, and consumers together.
- Never use `wp_localize_script`; script modules do not receive that data.

## Import Pipeline

Read `../.claude/docs/import-pipeline.md` before editing `playground.ts` or the PHP import routes.

- Treat file-route cursors as opaque pass-through values.
- File payloads are base64; the DB route returns raw SQL through WP REST's JSON envelope.
- A 503 from the import routes means Reprint is unavailable; log it and continue without hard-failing the app.
