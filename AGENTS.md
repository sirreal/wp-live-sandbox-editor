# Live Sandbox Editor

WordPress plugin exposing a Monaco editor + WordPress Playground sandbox inside wp-admin. The admin page boots Playground in an iframe, imports the host site's `wp-content` and DB via the Reprint exporter, then lets the user edit files live.

## Layout

- `live-sandbox-editor/` — shipped plugin (PHP, REST, built JS). See `live-sandbox-editor/CLAUDE.md` before touching PHP, REST routes, enqueues, or `composer.json`.
- `src/` — TypeScript frontend (Monaco + Playground client). See `src/CLAUDE.md` before touching any `.ts` file.
- `assets/blueprints/` — Playground blueprint JSON.
- `wordpress/` — symlink into a WP checkout for reference only; never edit.
- `plugin-repo/` — build output (SVN-style); not in git.

## Build / lint

- `npm run build` — Vite, outputs to `live-sandbox-editor/build/`. Do **not** swap to `@wordpress/scripts`: webpack breaks Monaco's web workers.
- `npm run dev` — Vite dev server (not wired to wp-admin; used for isolated Monaco work).
- `npm run zip` — build + produce `live-sandbox-editor.zip`.
- `npx biome check .` — JS/TS lint + format check. Add `--write` to auto-fix (`npx biome check . --write`). Config `biome.json`; single quotes, tabs, `recommended` rules.
- `vendor/bin/phpcs` — PHP lint (WPCS; ruleset `phpcs.xml`, scope limited to `live-sandbox-editor/`). `vendor/bin/phpcbf` auto-fixes the subset it can.

Node/npm pinned via Volta and `.nvmrc` (Node 22). TypeScript is `@typescript/native-preview` — expect occasional surprises vs. stock `tsc`.

## Testing

No automated test suite. Verify changes by loading the built plugin in a WP install. Adding a test harness is net-new infra — see `.claude/docs/testing.md` for constraints, stable selectors, REST stubbing, and reasonable defaults before proposing one.

## Version bumps

The plugin version lives in three files; update them together:
1. `live-sandbox-editor/live-sandbox-editor.php` — `Version:` header **and** the `VERSION` constant.
2. `live-sandbox-editor/readme.txt` — `Stable tag:` header.
3. `package.json` — `version` field (root).
`composer.json` has no `version` field. A `plugin-repo/` SVN bump is only relevant when publishing.

## Runtime dependency

The plugin's REST routes require the **Reprint exporter** classes (`FileTreeProducer`, `WordPress\DataLiberation\MySQLDumpProducer`). They are vendored via Composer in `live-sandbox-editor/composer.json`, but the sibling Reprint plugin, if active, registers them first — the PHP guards against redeclaration. See `live-sandbox-editor/CLAUDE.md`.

## Boundaries

- Ask before: changing the build toolchain, bumping `@wp-playground/client` (API churn), editing `wordpress/` or `plugin-repo/`, changing the REST transport (the request-response + opaque-cursor contract is load-bearing on both sides).
- Never: commit `build/`, `vendor/`, or `node_modules/`; ship `wp_localize_script` for this plugin's JS (it's a script module — won't work); widen REST permission callbacks beyond `manage_options`.

## Deep-dive references (`.claude/docs/`)

- `.claude/docs/import-pipeline.md` — full REST route contract (`/reprint-files`, `/reprint-db`), cursor semantics, budget, base64 rationale, statement-split regex. Consult before editing either route or the JS importer.
- `.claude/docs/script-module-data.md` — PHP↔JS data handoff via `script_module_data_<SLUG>` filter + `getAppData()`. Consult when adding a field that must flow from PHP into JS.
- `.claude/docs/testing.md` — constraints if you propose adding a test harness.
