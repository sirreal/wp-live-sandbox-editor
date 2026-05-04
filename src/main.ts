import { initApp } from './app.js';
import type { SyncManifest } from './playground.js';
import type { TestUpgradeRequest } from './types.js';

function parseManifestParam(): SyncManifest | undefined {
	const raw = new URLSearchParams(window.location.search).get('manifest');
	if (!raw) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		console.warn('[live-sandbox-editor] Ignoring malformed manifest param.');
		return undefined;
	}
	if (
		!parsed ||
		typeof parsed !== 'object' ||
		!Array.isArray((parsed as SyncManifest).plugins) ||
		!Array.isArray((parsed as SyncManifest).themes) ||
		!Array.isArray((parsed as SyncManifest).tables) ||
		typeof (parsed as SyncManifest).uploads !== 'boolean'
	) {
		console.warn(
			'[live-sandbox-editor] Ignoring manifest param with wrong shape.',
		);
		return undefined;
	}
	return parsed as SyncManifest;
}

function parseTestUpgradeParam(): TestUpgradeRequest | undefined {
	const raw = new URLSearchParams(window.location.search).get('testUpgrade');
	if (!raw) return undefined;
	// Mirror is_safe_plugin_entry on the PHP side; defence in depth before
	// the value flows into Playground PHP via client.run().
	if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)?\.php$/.test(raw)) {
		console.warn('[live-sandbox-editor] Ignoring malformed testUpgrade param.');
		return undefined;
	}
	for (const segment of raw.split('/')) {
		if (segment === '' || segment === '.' || segment === '..') {
			console.warn(
				'[live-sandbox-editor] Ignoring malformed testUpgrade param.',
			);
			return undefined;
		}
	}
	return { entry: raw };
}

const root = document.getElementById('live-sandbox-editor-root');
if (!root) {
	console.error('[live-sandbox-editor] Root element not found.');
} else {
	initApp(root, parseManifestParam(), parseTestUpgradeParam()).catch(
		(err: unknown) => {
			console.error('[live-sandbox-editor] App init failed:', err);
		},
	);
}
