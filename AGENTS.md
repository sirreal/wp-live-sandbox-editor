# Live Sandbox Editor

WordPress plugin exposing a Monaco editor and WordPress Playground sandbox inside wp-admin.

## Scope Map

- `live-sandbox-editor/` is the shipped plugin. Follow `live-sandbox-editor/AGENTS.md` before changing PHP, REST routes, enqueues, styles, or plugin Composer files.
- `src/` is the TypeScript frontend. Follow `src/AGENTS.md` before changing `.ts` files.
- `assets/blueprints/` contains Playground blueprints.
- `wordpress/` is a reference checkout only; never edit it.
- `plugin-repo/` is publishing output; leave it alone unless the task is explicitly about publishing.

## Sources Of Truth

- Tooling and build details live in `package.json`, `vite.config.ts`, `biome.json`, `tsconfig.json`, and `phpcs.xml`.
- Import-route details live in `.claude/docs/import-pipeline.md`.
- PHP-to-JS data handoff details live in `.claude/docs/script-module-data.md`.
- Testing-harness constraints live in `.claude/docs/testing.md`.

## Verification

- JS/TS: `npx biome check .`
- PHP: `vendor/bin/phpcs`
- Build: `npm run build`
- There is no automated end-to-end suite; verify behavior in a WordPress install when the change affects runtime behavior.

## Version Bumps

For plugin releases, update the plugin header and `VERSION` constant in `live-sandbox-editor/live-sandbox-editor.php`, plus `Stable tag:` in `live-sandbox-editor/readme.txt`.

Do not assume root `package.json` is tied to the plugin version unless the release task says so.

## Boundaries

- Ask before changing the build toolchain, bumping `@wp-playground/client`, editing `wordpress/` or `plugin-repo/`, changing the REST transport, or adding a test harness.
- Never commit `build/`, `vendor/`, or `node_modules/`.
- Never use `wp_localize_script` for this plugin's JS; it is loaded as a script module.
- Never widen REST permissions beyond `manage_options`.
