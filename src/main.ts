import './monaco-environment.js';
import { initApp } from './app.js';

const root = document.getElementById('live-sandbox-editor-root');
if (!root) {
	console.error('[live-sandbox-editor] Root element not found.');
} else {
	initApp(root).catch((err: unknown) => {
		console.error('[live-sandbox-editor] App init failed:', err);
	});
}
