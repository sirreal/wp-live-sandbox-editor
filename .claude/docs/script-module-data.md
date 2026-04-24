# Passing data from PHP to JS

This plugin's JS is loaded as an **ES module** via `wp_enqueue_script_module()`. `wp_localize_script` silently does nothing for modules — use the `script_module_data_<SLUG>` filter instead.

## PHP side (`live-sandbox-editor/live-sandbox-editor.php`)

```php
add_filter('script_module_data_' . SLUG, function () {
  return array(
    'restUrl' => rest_url( SLUG . '/v1' ),
    'nonce'   => wp_create_nonce( 'wp_rest' ),
    'siteUrl' => get_site_url(),
  );
});
```

Field names are **camelCase**. The filter is registered inside `enqueue_assets()`, which only fires on `hook_suffix === 'toplevel_page_' . SLUG`.

WordPress serialises the returned array as JSON and emits a `<script type="application/json" id="wp-script-module-data-<SLUG>">` tag before the module script runs.

## JS side (`src/types.ts`)

```ts
export interface AppData {
  restUrl: string;
  nonce: string;
  siteUrl: string;
}

export function getAppData(): AppData {
  const el = document.getElementById('wp-script-module-data-live-sandbox-editor');
  return JSON.parse(el?.textContent ?? '{}') as AppData;
}
```

Call `getAppData()` wherever you need the data — it's a synchronous DOM read, not expensive.

## Adding a field

Three places must stay in sync:
1. The filter callback in `live-sandbox-editor.php` — add the key.
2. The `AppData` interface in `src/types.ts` — add the field with its TS type.
3. Any consumer that reads it via `getAppData()`.

Do not add a second filter — extend the existing callback. The single-filter pattern keeps the contract one-to-one with the `AppData` interface.
