# `live-sandbox-editor/` — Shipped Plugin

This directory is what gets zipped and installed.

## Guardrails

- `build/` and `vendor/` are generated; never commit them.
- Composer is driven from the repo root: `composer install` / `composer update` populate this directory's `vendor/` via a post-install script. To operate on the plugin manifest directly, use `COMPOSER=plugin-composer.json composer <cmd> --working-dir=live-sandbox-editor` from the repo root.
- PHP coding rules are defined in `../phpcs.xml`.
- User-facing strings use the `live-sandbox-editor` text domain.
- Global PHP symbols use the `live_sandbox_editor` prefix.

## REST And Reprint

Read `../.claude/docs/import-pipeline.md` before editing REST import routes or `../src/playground.ts`.

- Keep import routes under `live-sandbox-editor/v1`.
- Keep route permissions at `manage_options`.
- Use `maybe_load_reprint()` before route code that depends on Reprint classes.
- If Reprint classes are still unavailable, return 503.
- Preserve the existing request-response contract unless the task explicitly changes the transport.

Ask before bumping `wp-php-toolkit/reprint-exporter`; cursor behavior and the DSN helper are load-bearing.

## Script Modules

Read `../.claude/docs/script-module-data.md` before changing PHP data passed to JS.

- JS is enqueued with `wp_enqueue_script_module()`.
- Use the `script_module_data_<SLUG>` filter for PHP-to-JS data.
- Never use `wp_localize_script` for this plugin.
