import { initApp } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
	const root = document.getElementById('live-sandbox-editor-root');
	if (!root) {
		console.error('[live-sandbox-editor] Root element not found.');
		return;
	}
	initApp(root).catch((err: unknown) => {
		console.error('[live-sandbox-editor] App init failed:', err);
	});
});
