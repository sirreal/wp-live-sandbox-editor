# Import pipeline — REST contract

The plugin's REST routes let the browser pull the host site's `wp-content` and DB into Playground. This file is the single source of truth for the wire contract shared between PHP (`live-sandbox-editor/live-sandbox-editor.php`) and JS (`src/playground.ts`).

Both routes live under `live-sandbox-editor/v1`, are gated by `current_user_can('manage_options')`, and return 503 when Reprint classes are missing (the JS side logs and continues — do not hard-fail).

JSON field names use **camelCase** (`nextCursor`, `restUrl`, `siteUrl`). Match this when adding routes.

## `GET /reprint-files?cursor=…`

Streams `wp-content` via `FileTreeProducer`.

Response:
```json
{ "files": { "/wp-content/<path>": "<base64>" }, "nextCursor": "<opaque>" }
```

- **Budget:** ~768 KB of file *data* per response (not response bytes). Per response, not per cycle.
- **Chunk size:** 8 MB passed to the producer, so typical WP files land as a single chunk and one file never splits across two responses.
- **Base64:** mandatory — JSON strings can't carry raw bytes safely for binary assets (images, fonts). JS decodes to `Uint8Array` before `writeFile`.
- **Cursor:** opaque string from `FileTreeProducer::get_reentrancy_cursor()`. Internally JSON (`{ "phase": "...", ... }`) but **never parse or construct it in JS** — just pass the value through. `nextCursor` is `null` exactly when the producer's phase is `finished`.

JS loop:
```ts
let cursor: string | null = null;
do {
  const res = await fetch(`${restUrl}/reprint-files?cursor=${cursor ?? ''}`, { headers: { 'X-WP-Nonce': nonce } });
  if (res.status === 503) return false;              // Reprint absent — skip import
  const { files, nextCursor } = await res.json();
  for (const [path, b64] of Object.entries(files)) {
    await writeFile(client, docroot + path, base64ToBytes(b64));
  }
  cursor = nextCursor;
} while (cursor);
```

## `GET /reprint-db`

Full MySQL dump via `MySQLDumpProducer`, returned as a raw SQL string. WP REST wraps the body in a JSON string literal on the wire; the JS consumer calls `await res.json()` to recover the original SQL — no further decoding required.

- DSN: `build_pdo_dsn()` from the Reprint `files` autoload if present, else fallback `mysql:host=…;dbname=…;charset=utf8mb4`.
- No pagination today.
- `MySQLDumpProducer` exposes `next_sql_fragment()` / `get_sql_fragment()`, which return **statement-bounded** fragments (not raw byte chunks). If you add a cursor, accumulate fragments until a byte budget, flush, and reuse the producer's re-entrancy mechanism.

JS side hands the SQL string to `runSql` from `@wp-playground/blueprints`:
```ts
const sql = (await res.json()) as string;
const sqlFile = new File([sql], 'reprint-import.sql', { type: 'application/sql' });
await runSql(client, { sql: sqlFile });
```

`runSql` swallows per-statement failures (it loops `$wpdb->query($q)` and never inspects `last_error`). When `WP_DEBUG` or `SCRIPT_DEBUG` is on, `playground.ts` swaps in `runSqlVerbose`, which executes statements one-by-one and surfaces the first 20 failures to the console. The verbose path uses a hand-rolled splitter that's only correct for Reprint's output (single-quoted `FROM_BASE64('…')` literals — base64 alphabet contains no `'`, `;`, or `\n`); it is **not** a general-purpose SQL splitter.

Pagination is not implemented; `MySQLDumpProducer::next_sql_fragment()` returns statement-bounded fragments, which would make cursor-style chunking straightforward if ever needed. Changing the wire format (e.g. switching to chunked streaming) is an ask-before change — the current contract has no version marker.

## Post-import step

After both imports complete, JS updates `siteurl` and `home` so internal links resolve to the Playground URL:
```php
update_option('siteurl', '${playgroundUrl}'); update_option('home', '${playgroundUrl}');
```

## Adding a new route

Copy the pattern in `register_rest_routes()`:
- namespace `SLUG . '/v1'`
- permission callback `fn() => current_user_can('manage_options')`
- callback named `rest_<snake_case>`
- args sanitised via `sanitize_text_field` or stricter
- camelCase JSON field names

Changing the REST transport (SSE, WebSocket, chunked streaming) is an ask-before change.
