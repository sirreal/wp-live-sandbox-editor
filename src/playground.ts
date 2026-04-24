import type { PlaygroundClient } from '@wp-playground/client';
import { ensureDir, writeFile } from './filesystem.js';
import { getAppData } from './types.js';

async function getErrorResponseText(res: Response): Promise<string | null> {
	const text = (await res.text()).trim();
	return text ? text : null;
}

export async function initPlayground(
	iframe: HTMLIFrameElement,
	onStatus: (status: string) => void,
): Promise<PlaygroundClient> {
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

	onStatus('Importing site files…');
	const filesOk = await importReprintFiles(client);

	if (filesOk) {
		onStatus('Importing database…');
		await importReprintDb(client);

		onStatus('Fixing site URL…');
		await fixSiteUrl(client);
	}

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
			const errorText = await getErrorResponseText(res);
			console.error(
				'[live-sandbox-editor] Reprint file import failed:',
				res.status,
				errorText ?? '',
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
		const errorText = await getErrorResponseText(res);
		console.error(
			'[live-sandbox-editor] Reprint DB import failed:',
			res.status,
			errorText ?? '',
		);
		return;
	}

	const sql = await res.text();
	const docroot = await client.documentRoot;
	const sqlPath = '/tmp/live-sandbox-import.sql';

	await writeFile(client, sqlPath, sql);

	const result = await client.run({
		code: String.raw`<?php
        require_once '${docroot}/wp-load.php';
        global $wpdb;
        $sql = file_get_contents('${sqlPath}');
        // MySQL dumps terminate each statement with ";\n".
        // Splitting on that avoids false splits on semicolons inside string values.
        // $statements = preg_split('/;[ \\t]*(?:\\r\\n|\\n)/', $sql);
        $statements = preg_split('/;$/m', $sql);
        $errors = [];
        foreach ($statements as $statement) {
            $statement = trim($statement);
            // Skip blank lines and SQL comment lines (-- style).
            if ($statement === '' || str_starts_with($statement, '--')) {
                continue;
            }
            if (false === $wpdb->query($statement)) {
                $errors[] = $wpdb->last_error . ': ' . substr($statement, 0, 120);
            }
        }
        if ($errors) {
            echo implode("\\n", array_slice($errors, 0, 20));
        }
    `,
	});

	if (result.text?.trim()) {
		console.warn(
			'[live-sandbox-editor] DB import warnings:\n',
			result.text.trim(),
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

function base64ToBytes(b64: string): Uint8Array {
	return Uint8Array.fromBase64(b64);
}
