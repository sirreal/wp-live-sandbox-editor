import './monaco-environment.js';
import { initApp } from './app.js';
import type { SyncManifest } from './playground.js';

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

const root = document.getElementById('live-sandbox-editor-root');
if (!root) {
	console.error('[live-sandbox-editor] Root element not found.');
} else {
	initApp(root, parseManifestParam()).catch((err: unknown) => {
		console.error('[live-sandbox-editor] App init failed:', err);
	});
}
