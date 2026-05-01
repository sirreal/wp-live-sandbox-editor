// Side-effect import: registers self.MonacoEnvironment.getWorker before any
// monaco.editor.create() runs. Keep above the monaco import so worker
// bindings are in place when monaco's static graph initialises.
import './monaco-environment.js';
import * as monaco from 'monaco-editor';
import type { EffectiveTheme } from './store.js';

// Runtime imports from store.ts deliberately avoided: store.ts is in the
// eager main.js chunk; if this lazy chunk imports it, the lazy `import()` URL
// resolves without the WP enqueue `?ver=…` query and the browser instantiates
// main.js twice (one per URL identity). app.ts wires the editor up after
// init instead.

let editor: monaco.editor.IStandaloneCodeEditor | null = null;
const models = new Map<string, monaco.editor.ITextModel>();

export function initEditor(
	container: HTMLElement,
	initialTheme: EffectiveTheme,
): monaco.editor.IStandaloneCodeEditor {
	if (editor) return editor;
	editor = monaco.editor.create(container, {
		theme: initialTheme,
		automaticLayout: true,
		fontSize: 13,
		lineHeight: 20,
		minimap: { enabled: false },
		scrollBeyondLastLine: false,
		renderLineHighlight: 'gutter',
	});
	return editor;
}

export function setEditorTheme(theme: EffectiveTheme): void {
	monaco.editor.setTheme(theme);
}

export function loadFileIntoEditor(path: string, content: string): void {
	if (models.has(path)) return;
	const uri = monaco.Uri.parse(`file://${path}`);
	const model = monaco.editor.createModel(content, detectLanguage(path), uri);
	models.set(path, model);
}

export function showInEditor(path: string | null): void {
	if (!editor) return;
	if (path === null) {
		editor.setModel(null);
		return;
	}
	const model = models.get(path);
	if (model) editor.setModel(model);
}

export function getEditor(): monaco.editor.IStandaloneCodeEditor | null {
	return editor;
}

export function getCurrentPath(): string | null {
	return editor?.getModel()?.uri.path ?? null;
}

export function getCurrentValue(): string {
	return editor?.getValue() ?? '';
}

export function addSaveCommand(
	handler: (path: string, content: string) => void,
): void {
	if (!editor) return;
	editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
		const path = getCurrentPath();
		if (path) handler(path, getCurrentValue());
	});
}

function detectLanguage(path: string): string {
	const ext = path.split('.').pop() ?? '';
	const map: Record<string, string> = {
		php: 'php',
		css: 'css',
		js: 'javascript',
		jsx: 'javascript',
		ts: 'typescript',
		tsx: 'typescript',
		json: 'json',
		html: 'html',
		md: 'markdown',
		txt: 'plaintext',
		xml: 'xml',
		yml: 'yaml',
		yaml: 'yaml',
	};
	return map[ext] ?? 'plaintext';
}
