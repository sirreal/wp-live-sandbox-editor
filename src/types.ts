export interface OpenFile {
	path: string;
	label: string;
}

export interface FileNode {
	path: string;
	name: string;
	isDir: boolean;
	depth: number;
	expanded?: boolean;
}

export type PlaygroundStatus =
	| 'booting'
	| 'importing-files'
	| 'importing-db'
	| 'fixing-urls'
	| 'ready'
	| 'error';

export interface AppData {
	restUrl: string;
	nonce: string;
	siteUrl: string;
	runUrl: string;
	scriptDebug: boolean;
	wpDebug: boolean;
	// Host's WP / PHP versions as `major.minor` (e.g. "6.9", "8.2"), or
	// "" when normalization failed on the host side — JS falls back to
	// Playground's defaults in that case.
	wpVersion: string;
	phpVersion: string;
	// Host-side LSE plugin slug (mirror of the PHP `SLUG` constant).
	// Pre-sync cleanup uses it to self-protect the LSE directory.
	selfPluginSlug: string;
	testPluginUpgradePayload?: TestPluginUpgradePayload;
	testThemeUpgradePayload?: TestThemeUpgradePayload;
}

/**
 * Update payload for a plugin, lifted from the host's `update_plugins`
 * site_transient at enqueue time. Playground writes a synthetic entry
 * with these fields into its own `update_plugins` transient so the
 * upgrade notice (and its `_wpnonce`) render on plugins.php without an
 * `api.wordpress.org` round-trip.
 */
export interface TestPluginUpgradePayload {
	plugin: string;
	slug: string;
	new_version: string;
	package: string;
	url: string;
}

/**
 * Update payload for a theme, lifted from the host's `update_themes`
 * site_transient. Counterpart of TestPluginUpgradePayload — themes use
 * the stylesheet slug as the response key and don't carry a separate
 * `plugin`-style entry.
 */
export interface TestThemeUpgradePayload {
	slug: string;
	new_version: string;
	package: string;
	url: string;
}

export function getAppData(moduleId = 'live-sandbox-editor'): AppData {
	const el = document.getElementById(`wp-script-module-data-${moduleId}`);
	return JSON.parse(el?.textContent ?? '{}') as AppData;
}
