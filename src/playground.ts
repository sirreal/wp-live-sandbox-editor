import type { PlaygroundClient } from '@wp-playground/client';
import postImportFixupsPhp from './post-import-fixups.php?raw';
import { BatchedDiskFlusher, readSyncStream } from './streaming.js';
import { getAppData } from './types.js';
import uploadsPassthroughMuPhp from './uploads-passthrough.mu.php?raw';

const FIXUPS_PATH = '/tmp/lse-fixups.php';

export interface DebugSettings {
	scriptDebug: boolean;
	wpDebug: boolean;
}

export interface SyncManifest {
	plugins: string[];
	themes: string[];
	tables: string[];
	uploads: boolean;
}

interface ManifestResponse {
	manifest: SyncManifest;
	siteUrl: string;
	uploadsUrl: string;
}

async function getErrorResponseText(res: Response): Promise<string | null> {
	try {
		const text = (await res.text()).trim();
		return text ? text : null;
	} catch {
		return null;
	}
}

export async function initPlayground(
	iframe: HTMLIFrameElement,
	onStatus: (status: string) => void,
	debug: DebugSettings,
): Promise<PlaygroundClient> {
	const debugMode = debug.scriptDebug || debug.wpDebug;
	const { startPlaygroundWeb } = await import('@wp-playground/client');

	onStatus('Booting Playground…');
	const client = await startPlaygroundWeb({
		iframe,
		remoteUrl: 'https://playground.wordpress.net/remote.html',
		blueprint: {
			preferredVersions: { wp: 'latest', php: '8.2' },
			steps: [{ step: 'login', username: 'admin', password: 'password' }],
		},
	});

	if (debugMode) {
		await logSqliteIntegrationVersion(client);
	}

	onStatus('Resolving sync manifest…');
	const manifestResp = await fetchManifest();
	// Future PR: surface a UI for the user to override `manifest` before
	// kicking off the sync. For now, defaults: active plugins, active
	// theme + parent, structural WP tables, no uploads.
	const manifest = manifestResp.manifest;

	if (debugMode) {
		console.log('[live-sandbox-editor] manifest:', manifestResp);
	}

	const hasFiles =
		manifest.plugins.length > 0 ||
		manifest.themes.length > 0 ||
		manifest.uploads;
	const hasDb = manifest.tables.length > 0;

	if (hasFiles) {
		onStatus('Importing site files…');
		await importFiles(client, manifest, debugMode);
	}

	if (hasDb) {
		onStatus('Importing database…');
		await importDb(client, manifest, debugMode);
	}

	onStatus('Finalizing sandbox…');
	await applyPostImportFixups(client, hasDb ? manifestResp : null, onStatus);

	await client.goTo('/');
	return client;
}

async function fetchManifest(): Promise<ManifestResponse> {
	const { restUrl, nonce } = getAppData();
	const res = await fetch(`${restUrl}/sync-manifest`, {
		headers: { 'X-WP-Nonce': nonce, Accept: 'application/json' },
	});
	if (!res.ok) {
		throw new Error(`sync-manifest failed: ${res.status}`);
	}
	return (await res.json()) as ManifestResponse;
}

/**
 * Log the bundled sqlite-database-integration plugin version and whether
 * the FROM_BASE64 UDF (added in PR #326, first tagged in v2.2.23) is wired up.
 * Reprint dumps wrap every non-numeric column in FROM_BASE64('…'), so without
 * this UDF every INSERT silently fails through the runSql layer.
 */
async function logSqliteIntegrationVersion(
	client: PlaygroundClient,
): Promise<void> {
	const result = await client.run({
		code: `<?php
			$candidates = array(
				'/internal/shared/sqlite-database-integration/load.php',
				'/wp-content/mu-plugins/sqlite-database-integration/load.php',
				'/wp-content/plugins/sqlite-database-integration/load.php',
			);
			$found = null;
			foreach ($candidates as $p) {
				if (file_exists($p)) { $found = $p; break; }
			}
			$version = null;
			if ($found) {
				$header = file_get_contents($found, false, null, 0, 4096);
				if (preg_match('/^[ \\t\\/*#@]*Version:\\s*(.+)$/mi', $header, $m)) {
					$version = trim($m[1]);
				}
			}
			$has_from_base64 = false;
			$udf_path = null;
			if ($found) {
				$dir = dirname($found);
				foreach (array(
					$dir . '/wp-includes/database/sqlite/class-wp-sqlite-pdo-user-defined-functions.php',
					$dir . '/wp-includes/sqlite/class-wp-sqlite-pdo-user-defined-functions.php',
					$dir . '/wp-includes/sqlite-ast/class-wp-sqlite-pdo-user-defined-functions.php',
				) as $u) {
					if (file_exists($u)) {
						$udf_path = $u;
						$has_from_base64 = (false !== strpos(file_get_contents($u), 'from_base64'));
						break;
					}
				}
			}
			echo json_encode(array(
				'pluginPath' => $found,
				'version' => $version,
				'udfPath' => $udf_path,
				'hasFromBase64' => $has_from_base64,
			));
		`,
	});
	console.log(
		'[live-sandbox-editor] sqlite-database-integration:',
		JSON.parse(result.text),
	);
}

async function postManifestStream(
	endpoint: string,
	manifest: SyncManifest,
): Promise<Response> {
	const { restUrl, nonce } = getAppData();
	return fetch(`${restUrl}/${endpoint}`, {
		method: 'POST',
		headers: {
			'X-WP-Nonce': nonce,
			'Content-Type': 'application/json',
			Accept: 'application/octet-stream',
		},
		body: JSON.stringify(manifest),
	});
}

async function importFiles(
	client: PlaygroundClient,
	manifest: SyncManifest,
	debugMode: boolean,
): Promise<void> {
	const docroot = await client.documentRoot;
	const res = await postManifestStream('sync-files', manifest);
	if (!res.ok) {
		const errorText = await getErrorResponseText(res);
		console.error(
			'[live-sandbox-editor] sync-files failed:',
			res.status,
			errorText ?? '',
		);
		return;
	}

	const flusher = new BatchedDiskFlusher(client, {
		// Logical paths begin with `/wp-content/...` — the Playground docroot
		// lives at /wordpress (or similar), so prefix accordingly.
		logicalToFullPath: (logical: string) => `${docroot}${logical}`,
		debug: debugMode,
	});

	try {
		await readSyncStream(res, flusher);
		await flusher.finalize();
	} catch (err) {
		console.error('[live-sandbox-editor] file stream failed:', err);
	}
}

async function importDb(
	client: PlaygroundClient,
	manifest: SyncManifest,
	debugMode: boolean,
): Promise<void> {
	const res = await postManifestStream('sync-db', manifest);
	if (!res.ok) {
		const errorText = await getErrorResponseText(res);
		console.error(
			'[live-sandbox-editor] sync-db failed:',
			res.status,
			errorText ?? '',
		);
		return;
	}

	const flusher = new BatchedDiskFlusher(client, {
		// SQL stream doesn't need a path mapper, but the constructor requires one.
		logicalToFullPath: (p) => p,
		debug: debugMode,
	});
	await flusher.resetSqlFile();

	try {
		await readSyncStream(res, flusher);
		await flusher.finalize();
	} catch (err) {
		console.error('[live-sandbox-editor] db stream failed:', err);
		return;
	}

	await runSqlFromDisk(client, flusher.getSqlPath(), debugMode);
}

/**
 * Execute a SQL dump that's already on disk inside Playground.
 *
 * Uses an in-PHP statement splitter that handles `--` line comments and
 * `/* …` block comments before applying the in-string state machine, so an
 * apostrophe inside a comment (e.g. `-- Dumping data for table 'foo'`)
 * doesn't flip parsing state. The in-string machine itself only recognises
 * single-quoted literals (with SQL `''` escape) — this matches Reprint's
 * output, which wraps every non-numeric column in `FROM_BASE64('…')` and
 * never emits double-quoted strings or backslash escapes. If the producer
 * ever changes shape, audit this splitter.
 *
 * `runSql()` from `@wp-playground/blueprints` ignores `$wpdb->query()`
 * return values and `$wpdb->last_error`, so a failing dump looks identical
 * to a successful import. This loop tracks per-statement results; in debug
 * mode the first N failures are surfaced.
 */
async function runSqlFromDisk(
	client: PlaygroundClient,
	sqlPath: string,
	debugMode: boolean,
): Promise<void> {
	const docroot = await client.documentRoot;

	const result = await client.run({
		code: `<?php
			require_once '${docroot}/wp-load.php';
			global $wpdb;
			$wpdb->suppress_errors();
			$wpdb->hide_errors();

			$fp = fopen('${sqlPath}', 'rb');
			if (!$fp) {
				echo json_encode(array(
					'ok' => 0,
					'fail' => 1,
					'sampleErrors' => array(array('error' => 'fopen failed', 'sql' => '${sqlPath}')),
				));
				exit;
			}

			$ok = 0;
			$fail = 0;
			$errors = array();
			$max_errors = 20;

			$run_stmt = function ($stmt) use (&$wpdb, &$ok, &$fail, &$errors, $max_errors) {
				$stmt = trim($stmt);
				if ($stmt === '' || $stmt === ';') return;
				$wpdb->last_error = '';
				$r = $wpdb->query($stmt);
				if ($r === false || $wpdb->last_error !== '') {
					$fail++;
					if (count($errors) < $max_errors) {
						$errors[] = array(
							'error' => $wpdb->last_error,
							'sql'   => substr($stmt, 0, 400),
						);
					}
				} else {
					$ok++;
				}
			};

			// Streaming statement splitter. Memory: chunk_size + one statement.
			// State persists across reads so strings/comments/statements straddling
			// a chunk boundary are handled identically to the in-memory version.
			$stmt  = '';
			$state = 'normal'; // normal | string | line_comment | block_comment
			$tail  = '';       // 1-byte carry so $next is always defined inside the loop

			$read_failed = false;
			while (!feof($fp)) {
				$chunk = fread($fp, 262144);
				if ($chunk === false) { $read_failed = true; break; }
				if ($chunk === '') continue;

				$buf  = $tail . $chunk;
				$blen = strlen($buf);
				$eof  = feof($fp);
				$end  = $eof ? $blen : $blen - 1;
				$tail = $eof ? ''    : $buf[$blen - 1];

				for ($i = 0; $i < $end; $i++) {
					$c    = $buf[$i];
					$next = ($i + 1 < $blen) ? $buf[$i + 1] : '';

					if ($state === 'normal') {
						if ($c === '-' && $next === '-') { $state = 'line_comment';  $i++; continue; }
						if ($c === '/' && $next === '*') { $state = 'block_comment'; $i++; continue; }
						if ($c === "'")                  { $state = 'string'; $stmt .= $c; continue; }
						if ($c === ';')                  { $stmt .= $c; $run_stmt($stmt); $stmt = ''; continue; }
						$stmt .= $c;
					} elseif ($state === 'string') {
						if ($c === "'" && $next === "'") { $stmt .= "''"; $i++; continue; }
						if ($c === "'")                  { $state = 'normal'; $stmt .= $c; continue; }
						$stmt .= $c;
					} elseif ($state === 'line_comment') {
						if ($c === "\\n") $state = 'normal';
					} else { // block_comment
						if ($c === '*' && $next === '/') { $state = 'normal'; $i++; }
					}
				}

				// 2-char-token cases above peek into $buf[$blen-1] (the deferred
				// byte) and advance $i past it. When that happens the loop exits
				// with $i > $end; clear $tail so the deferred byte isn't replayed.
				if ($i > $end) $tail = '';
			}

			if ($read_failed) {
				echo json_encode(array(
					'ok' => $ok,
					'fail' => $fail + 1,
					'sampleErrors' => array_merge($errors, array(array('error' => 'fread failed', 'sql' => '${sqlPath}'))),
				));
				fclose($fp);
				exit;
			}

			if (trim($stmt) !== '') $run_stmt($stmt);
			fclose($fp);

			echo json_encode(array(
				'ok' => $ok,
				'fail' => $fail,
				'sampleErrors' => $errors,
			));
		`,
	});

	const summary = JSON.parse(result.text) as {
		ok: number;
		fail: number;
		sampleErrors: Array<{ error: string; sql: string }>;
	};
	if (summary.fail > 0) {
		console.warn(
			`[live-sandbox-editor] DB import: ${summary.ok} ok, ${summary.fail} failed`,
		);
		if (debugMode) {
			for (const e of summary.sampleErrors) {
				console.warn(
					'[live-sandbox-editor] failed stmt:',
					e.error,
					'\n',
					e.sql,
				);
			}
		}
	} else {
		console.log(
			`[live-sandbox-editor] DB import: ${summary.ok} statements applied cleanly`,
		);
	}
}

function phpStringLiteral(s: string): string {
	// PHP single-quoted: escape backslashes and single quotes only.
	return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

interface RewriteCtx {
	hostUrl: string;
	uploadsUrl: string;
	playgroundUrl: string;
}

async function applyPostImportFixups(
	client: PlaygroundClient,
	dbContext: ManifestResponse | null,
	onStatus: (status: string) => void,
): Promise<void> {
	const docroot = await client.documentRoot;
	await client.writeFile(FIXUPS_PATH, postImportFixupsPhp);

	// URL rewrite is conditional on a DB sync — without one, Playground's
	// default options shouldn't be smashed with the host's URLs.
	if (dbContext) {
		const ctx: RewriteCtx = {
			hostUrl: dbContext.siteUrl.replace(/\/$/, ''),
			uploadsUrl: dbContext.uploadsUrl.replace(/\/$/, ''),
			playgroundUrl: (await client.absoluteUrl).replace(/\/$/, ''),
		};
		await rewriteUrls(client, docroot, ctx, onStatus);
		if (!dbContext.manifest.uploads) {
			await installUploadsPassthrough(client, docroot, ctx.uploadsUrl);
		}
	}

	// Self-deactivate runs unconditionally — file sync excludes the editor
	// from copy, but `active_plugins` in the imported DB may still carry it.
	await client.run({
		code: `<?php
			require '${docroot}/wp-load.php';
			require_once '${FIXUPS_PATH}';
			lse_deactivate_self();
		`,
	});
}

/**
 * Install a mu-plugin that filters runtime upload-URL helpers
 * (`wp_get_attachment_url`, `wp_calculate_image_srcset`) back at the
 * host. Without this, every runtime-generated upload URL resolves to
 * Playground's origin, where the file doesn't exist because uploads
 * weren't synced.
 *
 * The mu-plugin maintains a skip list (`lse_uploads_passthrough_skip_urls`
 * option, also exposed as a filter of the same name) so URLs we _don't_
 * want redirected — chiefly media uploaded inside the sandbox post-sync —
 * stay on playground origin. Newly added attachments append themselves
 * to the skip list via the postmeta hooks in the mu-plugin.
 */
async function installUploadsPassthrough(
	client: PlaygroundClient,
	docroot: string,
	hostUploadsUrl: string,
): Promise<void> {
	const muDir = `${docroot}/wp-content/mu-plugins`;
	// Swap the whole PHP literal so `phpStringLiteral` handles escaping;
	// the mu-plugin guards against missed substitutions by sniffing for
	// the `__LSE_` prefix on its constant value before registering hooks.
	const muPlugin = uploadsPassthroughMuPhp.replace(
		"'__LSE_HOST_UPLOADS_URL__'",
		phpStringLiteral(hostUploadsUrl),
	);
	// One round-trip: mkdir + write together. Embedding the whole
	// mu-plugin via `phpStringLiteral` means PHP un-escapes the literal
	// back to the original source byte-for-byte before `file_put_contents`
	// writes it.
	await client.run({
		code: `<?php
			$dir = ${phpStringLiteral(muDir)};
			@mkdir( $dir, 0755, true );
			file_put_contents(
				$dir . '/lse-uploads-passthrough.php',
				${phpStringLiteral(muPlugin)}
			);
		`,
	});
}

async function rewriteUrls(
	client: PlaygroundClient,
	docroot: string,
	ctx: RewriteCtx,
	onStatus: (status: string) => void,
): Promise<void> {
	onStatus('Rewriting site URLs…');
	await client.run({
		code: `<?php
			require '${docroot}/wp-load.php';
			require_once '${FIXUPS_PATH}';
			update_option('siteurl', ${phpStringLiteral(ctx.playgroundUrl)});
			update_option('home', ${phpStringLiteral(ctx.playgroundUrl)});
			lse_rewrite_all_urls(
				${phpStringLiteral(ctx.hostUrl)},
				${phpStringLiteral(ctx.playgroundUrl)},
				${phpStringLiteral(ctx.uploadsUrl)}
			);
		`,
	});
}
