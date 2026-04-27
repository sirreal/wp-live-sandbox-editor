import './monaco-environment.js';

const appModuleUrl = './app.js';

async function init(): Promise<void> {
	const root = document.getElementById('live-sandbox-editor-root');
	if (!root) {
		console.error('[live-sandbox-editor] Root element not found.');
		return;
	}

	const { initApp } = (await import(
		/* @vite-ignore */ appModuleUrl
	)) as typeof import('./app.js');
	await initApp(root);
}

init().catch((err: unknown) => {
	console.error('[live-sandbox-editor] App init failed:', err);
});
