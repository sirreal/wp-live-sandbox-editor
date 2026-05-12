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

/** Lifted from the host's `update_plugins` site_transient row. */
export interface TestPluginUpgradePayload {
	plugin: string;
	slug: string;
	new_version: string;
	package: string;
	url: string;
	requires: string;
	requires_php: string;
}

/** Lifted from the host's `update_themes` site_transient row. */
export interface TestThemeUpgradePayload {
	slug: string;
	new_version: string;
	package: string;
	url: string;
	requires: string;
	requires_php: string;
}

export interface ThemesGridData {
	hrefs: Record<string, string>;
	label: string;
}

export function getModuleData<T>(moduleId: string): T {
	const el = document.getElementById(`wp-script-module-data-${moduleId}`);
	return JSON.parse(el?.textContent ?? '{}') as T;
}

export function getAppData(moduleId = 'live-sandbox-editor'): AppData {
	return getModuleData<AppData>(moduleId);
}
