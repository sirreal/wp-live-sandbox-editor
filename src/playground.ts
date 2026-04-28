import type { PlaygroundClient } from '@wp-playground/client';
import { BatchedDiskFlusher, readNdjson } from './streaming.js';
import { getAppData } from './types.js';

export interface DebugSettings {
	scriptDebug: boolean;
	wpDebug: boolean;
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

	onStatus('Importing site files…');
	const filesOk = await importReprintFiles(client);

	if (filesOk) {
		onStatus('Importing database…');
		await importReprintDb(client, debugMode);

		onStatus('Fixing site URL…');
		await fixSiteUrl(client);
	}

	await client.goTo('/');
	return client;
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
					// v3.0.0+ layout (monorepo restructure, PR #334).
					$dir . '/wp-includes/database/sqlite/class-wp-sqlite-pdo-user-defined-functions.php',
					// pre-v3 layout.
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

/**
 * Stream wp-content files from the REST proxy directly into Playground
 * disk. Files are appended chunk-by-chunk via FILE_APPEND inside Playground;
 * the JS heap never holds a full file or a buffered response body.
 *
 * Returns true on success, false if the server reports the Reprint classes
 * are unavailable (handled gracefully so the rest of the boot continues).
 */
async function importReprintFiles(client: PlaygroundClient): Promise<boolean> {
	const { restUrl, nonce } = getAppData();
	const docroot = await client.documentRoot;

	const res = await fetch(`${restUrl}/reprint-files`, {
		headers: { 'X-WP-Nonce': nonce, Accept: 'application/x-ndjson' },
	});

	if (res.status === 503) {
		console.warn(
			'[live-sandbox-editor] Reprint classes unavailable — skipping file import.',
		);
		return false;
	}

	if (!res.ok) {
		const errorText = await getErrorResponseText(res);
		console.error(
			'[live-sandbox-editor] Reprint file import failed:',
			res.status,
			errorText ?? '',
		);
		return false;
	}

	const flusher = new BatchedDiskFlusher(client);

	try {
		await readNdjson(res, async (rec) => {
			if (rec.t !== 'f') return;
			const fullPath = docroot + rec.path;
			await flusher.addFileChunk(fullPath, rec.b64, rec.seq === 0);
		});
		await flusher.flush();
	} catch (err) {
		console.error('[live-sandbox-editor] File stream failed:', err);
		return false;
	}

	return true;
}

/**
 * Stream the SQL dump from the REST proxy straight to a file inside
 * Playground, then execute it via an in-Playground splitter that reads
 * from disk. The full SQL never lives in JS or PHP memory — both sides
 * are bounded by the flusher's batch size.
 */
async function importReprintDb(
	client: PlaygroundClient,
	debugMode: boolean,
): Promise<void> {
	const { restUrl, nonce } = getAppData();
	const res = await fetch(`${restUrl}/reprint-db`, {
		headers: { 'X-WP-Nonce': nonce, Accept: 'application/x-ndjson' },
	});

	if (res.status === 503) {
		console.warn(
			'[live-sandbox-editor] Reprint classes unavailable — skipping DB import.',
		);
		return;
	}

	if (!res.ok) {
		const errorText = await getErrorResponseText(res);
		console.error(
			'[live-sandbox-editor] Reprint DB import failed:',
			res.status,
			errorText ?? '',
		);
		return;
	}

	const flusher = new BatchedDiskFlusher(client);
	await flusher.resetSqlFile();

	try {
		await readNdjson(res, async (rec) => {
			if (rec.t !== 'sql') return;
			await flusher.addSqlChunk(rec.b64);
		});
		await flusher.flush();
	} catch (err) {
		console.error('[live-sandbox-editor] DB stream failed:', err);
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

			$sql = file_get_contents('${sqlPath}');
			$len = strlen($sql);
			$i = 0;
			$start = 0;
			$in_str = false;
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

			while ($i < $len) {
				$c = $sql[$i];
				if (!$in_str) {
					if ($c === '-' && $i + 1 < $len && $sql[$i + 1] === '-') {
						$nl = strpos($sql, "\\n", $i);
						$i = ($nl === false) ? $len : $nl + 1;
						continue;
					}
					if ($c === '/' && $i + 1 < $len && $sql[$i + 1] === '*') {
						$end = strpos($sql, '*/', $i + 2);
						$i = ($end === false) ? $len : $end + 2;
						continue;
					}
					if ($c === "'") {
						$in_str = true;
					} elseif ($c === ';') {
						$run_stmt(substr($sql, $start, $i - $start + 1));
						$start = $i + 1;
					}
				} else {
					if ($c === "'") {
						if ($i + 1 < $len && $sql[$i + 1] === "'") {
							$i++;
						} else {
							$in_str = false;
						}
					}
				}
				$i++;
			}
			if ($start < $len) {
				$run_stmt(substr($sql, $start));
			}

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

async function fixSiteUrl(client: PlaygroundClient): Promise<void> {
	const docroot = await client.documentRoot;
	const playgroundUrl = await client.absoluteUrl;

	await client.run({
		code: `<?php
			require('${docroot}/wp-load.php');
			update_option('siteurl', '${playgroundUrl}');
			update_option('home', '${playgroundUrl}');
		`,
	});
}
