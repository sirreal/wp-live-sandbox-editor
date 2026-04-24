# `live-sandbox-editor/` — shipped plugin

This directory is what gets zipped and installed. PHP bootstrap, built assets, styles, and Composer-vendored Reprint classes.

## Files

- `live-sandbox-editor.php` — single-file bootstrap. Namespace `Live_Sandbox_Editor`, constants `SLUG` / `VERSION`. Registers admin menu, enqueues, two REST routes, and a Reprint-missing admin notice.
- `style.css` — admin page chrome (`lse-*` classes). Monaco's own CSS is emitted separately to `build/main.css`.
- `readme.txt` — WordPress.org readme.
- `composer.json` — requires `wp-php-toolkit/reprint-exporter`. Run `composer install` here (not at repo root).
- `build/` — Vite output; generated, not in git. See root `CLAUDE.md` for the build command.
- `vendor/` — Composer output; generated, not in git.

Frontend source is in `src/` at the repo root — see `../src/CLAUDE.md`.

## REST routes

Two routes live under `live-sandbox-editor/v1`, both gated by `current_user_can('manage_options')`, both return 503 when Reprint classes are missing:

- `GET /reprint-files?cursor=…` — cursor-paginated `wp-content` stream via `FileTreeProducer`. JSON `{ files, nextCursor }`, base64 values, ~768 KB budget per response.
- `GET /reprint-db` — full MySQL dump as `text/plain` via `MySQLDumpProducer`. Not paginated today; if you add pagination, use the producer's statement-bounded `next_sql_fragment()` API (it sidesteps the JS split regex).

The only camelCase JSON field in a REST response today is `nextCursor`. Match that style when adding new fields.

Wire contract detail — exact shapes, cursor opacity, budget semantics, base64 rationale, statement-split regex, JS consumer snippet — lives in **`.claude/docs/import-pipeline.md`**. Consult it before editing either route or the JS importer in `../src/playground.ts`.

When adding a route, copy the pattern in `register_rest_routes()`: same namespace (`SLUG . '/v1'`), same permission callback, callback named `rest_<snake_case>`, args sanitised via `sanitize_text_field` or stricter.

## Reprint loading

`maybe_load_reprint()` is the single entry point. It checks for `FileTreeProducer` (global namespace) as a sentinel; if absent, it requires `__DIR__ . '/vendor/autoload.php'`. This avoids a fatal redeclare when the standalone Reprint plugin is also active (it registers its own autoloader first). Call it at the top of any route handler that needs those classes, and return 503 if the class still isn't defined.

`reprint_notice()` is already registered on `admin_notices` and renders an error notice (WordPress `notice notice-error` classes) on the plugin's own page only (it checks `get_current_screen()->id === 'toplevel_page_' . SLUG`). Current message text (translatable, text domain `live-sandbox-editor`):

> Live Sandbox Editor: Reprint classes could not be loaded. Run composer install in the plugin directory.

Plugin directory means `live-sandbox-editor/` (the inner subdirectory, which is where `composer.json` lives — *not* the repo root). If you're adding more user-visible diagnostics, extend this function rather than registering a second notice hook. No separate setup documentation exists; the notice message is the install instruction, kept self-contained. This is the only admin notice the plugin emits — there is no house style beyond standard WordPress conventions (plain imperative tone, no marketing, no emoji, no HTML beyond `<p>` wrappers that WP adds automatically).

## Enqueuing

JS ships as an **ES module** via `wp_enqueue_script_module()`. Data flows through the `script_module_data_<SLUG>` filter — `wp_localize_script` silently does nothing for modules. Full handoff recipe: `.claude/docs/script-module-data.md`.

Enqueue only fires on `hook_suffix === 'toplevel_page_' . SLUG` — the plugin's own top-level menu page.

## Code style

WPCS via `../phpcs.xml`. Scope is this directory only; `vendor/` and `build/` are excluded. Text domain is `live-sandbox-editor`; global prefix is `live_sandbox_editor`. File-comment and Yoda-conditions rules are disabled — don't add them back.

## Boundaries

- Ask before bumping `wp-php-toolkit/reprint-exporter`: chunk-cursor behaviour and the DSN helper are load-bearing.
- Never commit `build/` or `vendor/`.
- Never widen the REST permission callback beyond `manage_options` — these routes leak site data.
