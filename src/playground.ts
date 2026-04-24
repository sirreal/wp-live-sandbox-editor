import {
	type PlaygroundClient,
	startPlaygroundWeb,
} from '@wp-playground/client';
import { runSql } from '@wp-playground/blueprints';
import { ensureDir, writeFile } from './filesystem.js';
import { getAppData } from './types.js';

export async function initPlayground(
	iframe: HTMLIFrameElement,
	onStatus: (status: string) => void,
): Promise<PlaygroundClient> {
	onStatus('Booting Playground…');
	const client = await startPlaygroundWeb({
		iframe,
		remoteUrl: 'https://playground.wordpress.net/remote.html',
		blueprint: {
			preferredVersions: { wp: 'latest', php: '8.2' },
			steps: [{ step: 'login', username: 'admin', password: 'password' }],
		},
	});

	onStatus('Importing site files…');
	const filesOk = true || (await importReprintFiles(client));

	if (filesOk) {
		onStatus('Importing database…');
		await importReprintDb(client);

		onStatus('Fixing site URL…');
		await fixSiteUrl(client);
	}

	// Debug: dump the SQLite database as a downloadable blob URL
	await dumpSqliteBlob(client);

	await client.goTo('/');
	return client;
}

/**
 * Fetch wp-content files from the REST proxy and write them into Playground.
 *
 * PHP returns file contents as base64 (so binary assets survive JSON).
 * We decode each value to a Uint8Array before handing it to writeFile().
 *
 * Returns true if files were successfully imported, false on failure.
 */
async function importReprintFiles(client: PlaygroundClient): Promise<boolean> {
	const { restUrl, nonce } = getAppData();
	const docroot = await client.documentRoot;
	let cursor: string | null = null;

	do {
		const params = new URLSearchParams();
		if (cursor) params.set('cursor', cursor);

		const res = await fetch(`${restUrl}/reprint-files?${params.toString()}`, {
			headers: { 'X-WP-Nonce': nonce },
		});

		if (res.status === 503) {
			console.warn(
				'[live-sandbox-editor] Reprint classes unavailable — skipping file import.',
			);
			return false;
		}

		if (!res.ok) {
			throw res;
			console.error(
				'[live-sandbox-editor] Reprint file import failed:',
				res.status,
			);
			return false;
		}

		const data = (await res.json()) as {
			files: Record<string, string>;
			nextCursor: string | null;
		};

		for (const [relativePath, b64Content] of Object.entries(data.files)) {
			const fullPath = docroot + relativePath;
			const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
			await ensureDir(client, dir);
			// Decode base64 → Uint8Array so binary files (images, fonts) are
			// written correctly. PlaygroundClient.writeFile accepts Uint8Array.
			const bytes = base64ToBytes(b64Content);
			await writeFile(client, fullPath, bytes);
		}

		cursor = data.nextCursor;
	} while (cursor);

	return true;
}

async function importReprintDb(client: PlaygroundClient): Promise<void> {
	const { restUrl, nonce } = getAppData();
	const res = await fetch(`${restUrl}/reprint-db`, {
		headers: { 'X-WP-Nonce': nonce },
	});

	if (res.status === 503) {
		console.warn(
			'[live-sandbox-editor] Reprint classes unavailable — skipping DB import.',
		);
		return;
	}

	if (!res.ok) {
		throw res;
		console.error(
			'[live-sandbox-editor] Reprint DB import failed:',
			res.status,
		);
		return;
	}

	const sqlFile = new File([await res.blob()], 'reprint-import.sql', {
		type: 'application/sql',
	});
	await runSql(client, { sql: sqlFile });
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

async function dumpSqliteBlob(client: PlaygroundClient): Promise<void> {
	const docroot = await client.documentRoot;
	const sqlitePath = `${docroot}/wp-content/database/.ht.sqlite`;
	try {
		const result = await client.run({
			code: `<?php echo base64_encode(file_get_contents('${sqlitePath}'));`,
		});
		const b64 = result.text;
		const bytes = Uint8Array.fromBase64(b64);
		const blob = new Blob([bytes], { type: 'application/x-sqlite3' });
		const url = URL.createObjectURL(blob);
		console.log(
			'[live-sandbox-editor] SQLite blob URL (paste into browser address bar to download):',
			url,
		);
	} catch (e) {
		console.error('[live-sandbox-editor] Failed to read SQLite database:', e);
	}
}

function base64ToBytes(b64: string): Uint8Array {
	return Uint8Array.fromBase64(b64);
}
