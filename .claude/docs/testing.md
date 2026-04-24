# Testing

No automated test suite. Verify changes by loading the built plugin in a WP install and opening the Live Sandbox Editor admin page.

If you propose adding a harness, these are the real constraints it will hit:

- The plugin mounts on `admin.php?page=live-sandbox-editor` at `#live-sandbox-editor-root`.
- Playground runs in a cross-origin iframe (`https://playground.wordpress.net/remote.html`); its DOM isn't drivable from the host.
- Stable host-side selectors: `.lse-status-indicator`, `.lse-tree-item` under `.lse-file-tree-body`, `.lse-tab` under `.lse-tabs`.
- The two REST routes to stub (shapes in `.claude/docs/import-pipeline.md`) are `/wp-json/live-sandbox-editor/v1/reprint-files` and `/reprint-db`. Returning 503 from both exercises the graceful-degradation path.
- Boot (Playground download + site import) takes 30–90 s on a populated site.

Everything else — framework choice, directory layout, CI wiring — is a design decision for the proposal.
