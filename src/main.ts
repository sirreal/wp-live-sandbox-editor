import './monaco-environment.js';

const BOOTSTRAPPED_DATA_KEY = 'liveSandboxEditorBootstrapped';

const root = document.getElementById('live-sandbox-editor-root');
if (!root) {
	console.error('[live-sandbox-editor] Root element not found.');
} else if (root.dataset[BOOTSTRAPPED_DATA_KEY] === 'true') {
	console.warn('[live-sandbox-editor] App already bootstrapped.');
} else {
	root.dataset[BOOTSTRAPPED_DATA_KEY] = 'true';
	import('./app.js')
		.then(({ initApp }) => initApp(root))
		.catch((err: unknown) => {
			delete root.dataset[BOOTSTRAPPED_DATA_KEY];
			console.error('[live-sandbox-editor] App init failed:', err);
		});
}
