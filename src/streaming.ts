import type { PlaygroundClient } from '@wp-playground/client';

/**
 * Wire format consumed here — matches `inc/sync-stream.php` on the server:
 *
 *   \n#LSE:FILE:<urlencoded path>\n   start a file record
 *   \n#LSE:SQL\n                       start a SQL record
 *   \n#LSE:END\n                       end of current record's payload
 *   \n#LSE:DONE\n                      end of stream
 *   \n#LSE:ERR:<urlencoded message>\n  fatal error (terminal)
 *
 * Between START and END the body is base64 — the producer aligns its
 * encoding to 3-byte input boundaries so the concatenated stream is valid
 * base64 and can be decoded incrementally in 4-char chunks.
 */

const MARKER_PREFIX = '\n#LSE:';

type ParserState =
	| { kind: 'pre' }
	| { kind: 'idle' }
	| { kind: 'file'; path: string }
	| { kind: 'sql' }
	| { kind: 'done' };

export interface PayloadHandler {
	onFileStart(path: string): Promise<void>;
	onFileBytes(path: string, bytes: Uint8Array): Promise<void>;
	onFileEnd(path: string): Promise<void>;
	onSqlBytes(bytes: Uint8Array): Promise<void>;
}

/**
 * Read a chunked-terminator response, dispatching decoded payload bytes to
 * the supplied handler. Resolves when a `DONE` marker is seen; throws on
 * `ERR`, an unterminated stream, or invalid framing.
 */
export async function readSyncStream(
	res: Response,
	handler: PayloadHandler,
): Promise<void> {
	if (!res.body) {
		throw new Error('Response has no body');
	}
	const reader = res.body.getReader();
	const decoder = new TextDecoder('utf-8');

	let state: ParserState = { kind: 'pre' };
	let buf = '';
	let pendingB64 = '';

	const emitDecoded = async (decodable: string): Promise<void> => {
		if (decodable.length === 0) return;
		const bytes = base64ToBytes(decodable);
		if (state.kind === 'file') {
			await handler.onFileBytes(state.path, bytes);
		} else if (state.kind === 'sql') {
			await handler.onSqlBytes(bytes);
		}
	};

	const flushPending = async (): Promise<void> => {
		if (pendingB64.length === 0) return;
		// Producer pads with `=` on finalize, so when END is reached the
		// total payload length is a multiple of 4 and pendingB64 is either
		// empty or a complete final quartet.
		if (pendingB64.length % 4 !== 0) {
			throw new Error(
				`Stream framing: ${pendingB64.length} unaligned base64 chars at record end`,
			);
		}
		const tail = pendingB64;
		pendingB64 = '';
		await emitDecoded(tail);
	};

	const handleMarker = async (line: string): Promise<void> => {
		// `line` is the marker without leading \n or trailing \n.
		if (!line.startsWith('#LSE:')) {
			throw new Error(`Stream framing: bad marker ${line}`);
		}
		const body = line.slice('#LSE:'.length);
		const colon = body.indexOf(':');
		const name = colon < 0 ? body : body.slice(0, colon);
		const arg = colon < 0 ? null : decodeURIComponent(body.slice(colon + 1));

		switch (name) {
			case 'FILE': {
				if (state.kind === 'file' || state.kind === 'sql') {
					throw new Error('Unexpected FILE marker mid-record');
				}
				if (!arg) {
					throw new Error('FILE marker missing path');
				}
				state = { kind: 'file', path: arg };
				pendingB64 = '';
				await handler.onFileStart(arg);
				return;
			}
			case 'SQL': {
				if (state.kind === 'file' || state.kind === 'sql') {
					throw new Error('Unexpected SQL marker mid-record');
				}
				state = { kind: 'sql' };
				pendingB64 = '';
				return;
			}
			case 'END': {
				await flushPending();
				if (state.kind === 'file') {
					await handler.onFileEnd(state.path);
				} else if (state.kind !== 'sql') {
					throw new Error('END marker outside a record');
				}
				state = { kind: 'idle' };
				return;
			}
			case 'DONE': {
				state = { kind: 'done' };
				return;
			}
			case 'ERR': {
				throw new Error(`Stream error: ${arg ?? '(no message)'}`);
			}
			default:
				throw new Error(`Unknown stream marker: ${name}`);
		}
	};

	const consumeMarker = async (atEof: boolean): Promise<boolean> => {
		// Buf is expected to start with `\n#LSE:` (or possibly an incomplete prefix).
		const eol = buf.indexOf('\n', 1);
		if (eol < 0) {
			if (atEof) {
				throw new Error('Truncated marker at end of stream');
			}
			return false;
		}
		const line = buf.slice(1, eol);
		buf = buf.slice(eol + 1);
		await handleMarker(line);
		return true;
	};

	const drain = async (atEof: boolean): Promise<void> => {
		while (true) {
			if (state.kind === 'done') return;

			if (state.kind === 'pre' || state.kind === 'idle') {
				const markerStart = buf.indexOf(MARKER_PREFIX);
				if (markerStart < 0) {
					const keep = Math.min(buf.length, MARKER_PREFIX.length - 1);
					buf = buf.slice(buf.length - keep);
					return;
				}
				if (markerStart > 0) {
					buf = buf.slice(markerStart);
				}
				if (!(await consumeMarker(atEof))) return;
				continue;
			}

			// Payload state — emit base64 up to the next marker.
			const markerStart = buf.indexOf(MARKER_PREFIX);
			let payloadEnd: number;
			if (markerStart < 0) {
				const safeEnd = Math.max(0, buf.length - (MARKER_PREFIX.length - 1));
				if (safeEnd === 0) return;
				payloadEnd = safeEnd;
			} else {
				payloadEnd = markerStart;
			}

			const slice = buf.slice(0, payloadEnd);
			buf = buf.slice(payloadEnd);

			// Producer never emits whitespace inside payload; strip
			// defensively to tolerate any proxy that line-wraps.
			const compact = slice.replace(/\s+/g, '');
			if (compact.length > 0) {
				const combined = pendingB64 + compact;
				const aligned = combined.length - (combined.length % 4);
				const decodable = combined.slice(0, aligned);
				pendingB64 = combined.slice(aligned);
				await emitDecoded(decodable);
			}

			if (markerStart < 0) return;
			if (!(await consumeMarker(atEof))) return;
		}
	};

	while (true) {
		const { value, done } = await reader.read();
		if (done) {
			buf += decoder.decode();
			await drain(true);
			break;
		}
		buf += decoder.decode(value, { stream: true });
		await drain(false);
		// TS narrows `state` based on direct assignments here; mutations
		// happen inside closures it can't see, so cast to read fresh.
		if ((state as ParserState).kind === 'done') break;
	}

	if ((state as ParserState).kind !== 'done') {
		throw new Error('Stream ended without DONE marker');
	}
	if (pendingB64.length > 0) {
		throw new Error('Stream ended with unflushed base64 tail');
	}
}

function base64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

function bytesToBase64(bytes: Uint8Array): string {
	let bin = '';
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		bin += String.fromCharCode(
			...bytes.subarray(i, Math.min(i + chunk, bytes.length)),
		);
	}
	return btoa(bin);
}

interface PendingFile {
	kind: 'file';
	path: string;
	first: boolean;
	b64: string;
}
interface PendingSql {
	kind: 'sql';
	b64: string;
}
type Pending = PendingFile | PendingSql;

/**
 * Buffers decoded byte chunks and flushes them inside Playground via a
 * single PHP run that loops `file_put_contents(..., FILE_APPEND)` per
 * chunk. Trades a small bounded JS-side buffer for far fewer PHP
 * round-trips than per-chunk flushing. Total memory is bounded by
 * `flushBytes`, regardless of export size.
 */
export class BatchedDiskFlusher implements PayloadHandler {
	private queue: Pending[] = [];
	private queuedBytes = 0;
	private readonly flushBytes: number;
	private readonly client: PlaygroundClient;
	private readonly sqlPath: string;
	private readonly logicalToFullPath: (logical: string) => string;
	private firstByPath: Map<string, boolean> = new Map();
	private readonly debug: boolean;
	private currentAssetKey: string | null = null;
	private assetBytes = 0;
	private assetFiles = 0;

	constructor(
		client: PlaygroundClient,
		options: {
			flushBytes?: number;
			sqlPath?: string;
			logicalToFullPath: (logical: string) => string;
			debug?: boolean;
		},
	) {
		this.client = client;
		this.flushBytes = options.flushBytes ?? 4 * 1024 * 1024;
		this.sqlPath = options.sqlPath ?? '/tmp/lse-import.sql';
		this.logicalToFullPath = options.logicalToFullPath;
		this.debug = options.debug ?? false;
	}

	private assetKeyFor(path: string): string {
		// Wire-format invariant: paths emitted by the producer
		// (`inc/manifest.php` `collect_files()` with `$logical_base`) are
		// always normalized under `/wp-content/{plugins,themes,uploads}/…`,
		// regardless of the host's actual `WP_PLUGIN_DIR` / theme-root /
		// uploads basedir. If you change that convention on the producer,
		// update the pattern here so the debug log keeps grouping correctly.
		const m = path.match(
			/^\/wp-content\/(plugins|themes|uploads)(?:\/([^/]+))?/,
		);
		if (!m) return `other (${path})`;
		if (m[1] === 'uploads') return 'uploads';
		const slug = m[2] ?? '(unknown)';
		return `${m[1] === 'plugins' ? 'plugin' : 'theme'}: ${slug}`;
	}

	private closeAsset(): void {
		if (this.currentAssetKey === null) return;
		if (this.debug) {
			console.log(
				`[live-sandbox-editor] Completed transfer of ${this.currentAssetKey} (${this.assetFiles} files, ${this.assetBytes} bytes)`,
			);
		}
		this.currentAssetKey = null;
		this.assetBytes = 0;
		this.assetFiles = 0;
	}

	getSqlPath(): string {
		return this.sqlPath;
	}

	async resetSqlFile(): Promise<void> {
		await this.client.writeFile(this.sqlPath, new Uint8Array(0));
	}

	async onFileStart(path: string): Promise<void> {
		this.firstByPath.set(path, true);
		if (this.debug) {
			const key = this.assetKeyFor(path);
			if (key !== this.currentAssetKey) {
				this.closeAsset();
				this.currentAssetKey = key;
				console.log(`[live-sandbox-editor] Starting transfer of ${key}`);
			}
			this.assetFiles++;
		}
	}

	async onFileBytes(path: string, bytes: Uint8Array): Promise<void> {
		const first = this.firstByPath.get(path) === true;
		if (first) this.firstByPath.set(path, false);
		this.queue.push({
			kind: 'file',
			path,
			first,
			b64: bytesToBase64(bytes),
		});
		this.queuedBytes += bytes.length;
		if (this.debug) this.assetBytes += bytes.length;
		if (this.queuedBytes >= this.flushBytes) {
			await this.flush();
		}
	}

	async onFileEnd(path: string): Promise<void> {
		// Zero-byte file: no onFileBytes was ever called, so nothing was
		// queued. Emit a marker chunk so the receiver creates the file.
		if (this.firstByPath.get(path) === true) {
			this.queue.push({ kind: 'file', path, first: true, b64: '' });
		}
		this.firstByPath.delete(path);
	}

	async onSqlBytes(bytes: Uint8Array): Promise<void> {
		this.queue.push({ kind: 'sql', b64: bytesToBase64(bytes) });
		this.queuedBytes += bytes.length;
		if (this.queuedBytes >= this.flushBytes) {
			await this.flush();
		}
	}

	async finalize(): Promise<void> {
		this.closeAsset();
		await this.flush();
	}

	async flush(): Promise<void> {
		if (this.queue.length === 0) return;
		const itemCount = this.queue.length;
		const flushedBytes = this.queuedBytes;
		const items = this.queue.map((p) =>
			p.kind === 'file'
				? {
						kind: 'file' as const,
						path: this.logicalToFullPath(p.path),
						first: p.first,
						b64: p.b64,
					}
				: { kind: 'sql' as const, b64: p.b64 },
		);
		this.queue = [];
		this.queuedBytes = 0;
		if (this.debug) {
			console.log(
				`[live-sandbox-editor] Flushing ${itemCount} chunks (${flushedBytes} bytes) to Playground`,
			);
		}

		const payload = JSON.stringify({ items, sqlPath: this.sqlPath });

		const result = await this.client.run({
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: payload,
			code: `<?php
				$raw = file_get_contents('php://input');
				$data = json_decode($raw, true);
				if ($data === null && json_last_error() !== JSON_ERROR_NONE) {
					echo json_encode(['errors' => ['json_decode failed: ' . json_last_error_msg()]]);
					exit;
				}
				$sql_path = $data['sqlPath'];
				$errors = [];
				foreach ($data['items'] as $it) {
					$bytes = base64_decode($it['b64'], true);
					if ($bytes === false) {
						$errors[] = 'base64_decode failed for ' . $it['kind'] . ' chunk';
						continue;
					}
					if ($it['kind'] === 'file') {
						$p = $it['path'];
						if (!empty($it['first'])) {
							@mkdir(dirname($p), 0777, true);
							$written = file_put_contents($p, $bytes);
						} else {
							$written = file_put_contents($p, $bytes, FILE_APPEND);
						}
						if ($written === false) {
							$errors[] = 'Failed to write file chunk to ' . $p;
						}
					} elseif ($it['kind'] === 'sql') {
						$written = file_put_contents($sql_path, $bytes, FILE_APPEND);
						if ($written === false) {
							$errors[] = 'Failed to append SQL chunk to ' . $sql_path;
						}
					}
				}
				echo json_encode(['errors' => $errors]);
			`,
		});

		const response = JSON.parse(result.text) as { errors: string[] };
		if (response.errors.length > 0) {
			throw new Error(`Disk flush failed: ${response.errors.join('; ')}`);
		}
	}
}
