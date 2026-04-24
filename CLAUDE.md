# Live Sandbox Editor

WordPress plugin that renders a Monaco editor + WordPress Playground sandbox in the admin.

## Project layout

- Plugin source: `live-sandbox-editor/` (subdirectory, not root)
- JS source: `src/` → built to `live-sandbox-editor/build/` via Vite
- WordPress symlinked at `wordpress/`

## Build

`npm run build` — Vite (not @wordpress/scripts). Monaco web workers require Vite; webpack breaks them.
`npm run dev` — Vite dev server

## Key dependencies

- Monaco: `monaco-editor` + `vite-plugin-monaco-editor`
- Playground: `@wp-playground/client` (verify package name before install)
- Site snapshot: depends on **Reprint exporter plugin** active on the live site

## Code style

Biome (`biome.json`): single quotes, recommended rules. Run: `npx biome check .`
PHP: WPCS via phpcs (`phpcs.xml`). Namespace: `Live_Sandbox_Editor`, slug: `live-sandbox-editor`.

## Script modules

JS is loaded as an ES module via `wp_enqueue_script_module()`. Data is passed with
`add_filter('script_module_data_' . SLUG, fn() => [...])` and read in JS from
`document.getElementById('wp-script-module-data-live-sandbox-editor')`.
`wp_localize_script` does not work for modules.
