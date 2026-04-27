import './monaco-environment.js';

const appEntryUrl = './boot.js';

import(/* @vite-ignore */ appEntryUrl).catch((err: unknown) => {
	console.error('[live-sandbox-editor] App entry failed:', err);
});
