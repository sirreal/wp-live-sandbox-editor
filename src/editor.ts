import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

self.MonacoEnvironment = {
	getWorker(_: unknown, label: string) {
		if (label === 'json') return new jsonWorker();
		if (label === 'css' || label === 'scss' || label === 'less')
			return new cssWorker();
		if (label === 'html' || label === 'handlebars' || label === 'razor')
			return new htmlWorker();
		if (label === 'typescript' || label === 'javascript') return new tsWorker();
		return new editorWorker();
	},
};

let editor: monaco.editor.IStandaloneCodeEditor | null = null;
const models = new Map<string, monaco.editor.ITextModel>();

export function initEditor(
	container: HTMLElement,
): monaco.editor.IStandaloneCodeEditor {
	editor = monaco.editor.create(container, {
		theme: 'vs-dark',
		automaticLayout: true,
		fontSize: 13,
		lineHeight: 20,
		minimap: { enabled: false },
		scrollBeyondLastLine: false,
		renderLineHighlight: 'gutter',
	});
	return editor;
}

export function openInEditor(path: string, content: string): void {
	if (!editor) return;
	const uri = monaco.Uri.parse('file://' + path);
	let model = models.get(path);
	if (!model) {
		model = monaco.editor.createModel(content, detectLanguage(path), uri);
		models.set(path, model);
	}
	editor.setModel(model);
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
