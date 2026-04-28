import type { PlaygroundClient } from '@wp-playground/client';

export type NdjsonRecord =
	| { type: 'file'; path: string; b64: string; seq: number; final: boolean }
	| { type: 'sql'; b64: string }
	| { type: 'end' }
	| { type: 'err'; message: string };

/**
 * Read an NDJSON response body line by line, invoking `onRecord` for each
 * parsed JSON object. Resolves cleanly only when the server emits a final
 * `{t:"end"}` record; throws on `{t:"err"}` or premature EOF.
 *
 * Uses the streaming `TextDecoder` flag so multi-byte UTF-8 sequences split
 * across chunk boundaries are joined correctly.
 */
export async function readNdjson(
	res: Response,
	onRecord: (rec: NdjsonRecord) => Promise<void>,
): Promise<void> {
	if (!res.body) {
		throw new Error('Response has no body');
	}
	const reader = res.body.getReader();
	const decoder = new TextDecoder('utf-8');
	let buf = '';
	let sawEnd = false;

	while (!sawEnd) {
		const { value, done } = await reader.read();
		if (done) {
			buf += decoder.decode();
			break;
		}
		buf += decoder.decode(value, { stream: true });

		let nl;
		while ((nl = buf.indexOf('\n')) >= 0) {
			const line = buf.slice(0, nl);
			buf = buf.slice(nl + 1);
			if (!line) continue;
			const rec = JSON.parse(line) as NdjsonRecord;
			if (rec.type === 'err') {
				throw new Error(`Stream error: ${rec.message}`);
			}
			if (rec.type === 'end') {
				sawEnd = true;
				break;
			}
			await onRecord(rec);
		}
	}

	if (buf.trim().length > 0) {
		throw new Error(`Stream ended with unterminated record: ${buf.slice(0, 120)}`);
	}
	if (!sawEnd) {
		throw new Error('Stream ended without {"t":"end"} marker (truncated)');
	}
}

interface PendingFileChunk {
	kind: 'file';
	path: string;
	b64: string;
	first: boolean;
}

interface PendingSqlChunk {
	kind: 'sql';
	b64: string;
}

type PendingChunk = PendingFileChunk | PendingSqlChunk;

/**
 * Buffers incoming chunks and flushes them inside Playground via a single
 * PHP run that loops `file_put_contents(..., FILE_APPEND)` per chunk.
 *
 * Trades a small bounded JS-side buffer (default 4 MB) for far fewer PHP
 * round-trips than per-chunk flushing. Total memory is bounded by
 * `flushBytes`, regardless of export size.
 */
export class BatchedDiskFlusher {
	private queue: PendingChunk[] = [];
	private queuedBytes = 0;
	private readonly flushBytes: number;
	private readonly client: PlaygroundClient;
	private readonly sqlPath: string;

	constructor(
		client: PlaygroundClient,
		options: { flushBytes?: number; sqlPath?: string } = {},
	) {
		this.client = client;
		this.flushBytes = options.flushBytes ?? 4 * 1024 * 1024;
		this.sqlPath = options.sqlPath ?? '/tmp/lse-import.sql';
	}

	getSqlPath(): string {
		return this.sqlPath;
	}

	async addFileChunk(
		path: string,
		b64: string,
		first: boolean,
	): Promise<void> {
		this.queue.push({ kind: 'file', path, b64, first });
		this.queuedBytes += b64.length;
		if (this.queuedBytes >= this.flushBytes) {
			await this.flush();
		}
	}

	async addSqlChunk(b64: string): Promise<void> {
		this.queue.push({ kind: 'sql', b64 });
		this.queuedBytes += b64.length;
		if (this.queuedBytes >= this.flushBytes) {
			await this.flush();
		}
	}

	/**
	 * Truncate the on-disk SQL file before streaming begins. Required because
	 * `addSqlChunk` always appends.
	 */
	async resetSqlFile(): Promise<void> {
		await this.client.writeFile(this.sqlPath, new Uint8Array(0));
	}

	async flush(): Promise<void> {
		if (this.queue.length === 0) return;
		const items = this.queue;
		this.queue = [];
		this.queuedBytes = 0;

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
