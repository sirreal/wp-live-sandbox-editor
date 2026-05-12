import { initApp } from './app.js';
import type { SyncManifest } from './playground.js';
import type {
	TestPluginUpgradePayload,
	TestThemeUpgradePayload,
} from './types.js';
import { getAppData } from './types.js';

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

function parseTestPluginUpgrade(): TestPluginUpgradePayload | undefined {
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
	// The payload (lifted from the host's update_plugins transient at
	// enqueue time) carries everything Playground needs to render the
	// upgrade notice — without it the upgrade flow can't proceed, so we
	// only return when the URL trigger and the AppData payload agree.
	const payload = getAppData().testPluginUpgradePayload;
	if (!payload || payload.plugin !== raw) {
		console.warn(
			'[live-sandbox-editor] testUpgrade URL present but no matching payload in AppData; ignoring.',
		);
		return undefined;
	}
	return payload;
}

function parseTestThemeUpgrade(): TestThemeUpgradePayload | undefined {
	const raw = new URLSearchParams(window.location.search).get(
		'testThemeUpgrade',
	);
	if (!raw) return undefined;
	// Mirror is_safe_theme_slug on the PHP side.
	if (!/^[A-Za-z0-9._-]+$/.test(raw) || raw === '.' || raw === '..') {
		console.warn(
			'[live-sandbox-editor] Ignoring malformed testThemeUpgrade param.',
		);
		return undefined;
	}
	const payload = getAppData().testThemeUpgradePayload;
	if (!payload || payload.slug !== raw) {
		console.warn(
			'[live-sandbox-editor] testThemeUpgrade URL present but no matching payload in AppData; ignoring.',
		);
		return undefined;
	}
	return payload;
}

const root = document.getElementById('live-sandbox-editor-root');
if (!root) {
	console.error('[live-sandbox-editor] Root element not found.');
} else {
	initApp(
		root,
		parseManifestParam(),
		parseTestPluginUpgrade(),
		parseTestThemeUpgrade(),
	).catch((err: unknown) => {
		console.error('[live-sandbox-editor] App init failed:', err);
	});
}
