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
}

export function getAppData(moduleId = 'live-sandbox-editor'): AppData {
	const el = document.getElementById(`wp-script-module-data-${moduleId}`);
	return JSON.parse(el?.textContent ?? '{}') as AppData;
}
