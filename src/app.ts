import {
	addSaveCommand,
	initEditor,
	loadFileIntoEditor,
	showInEditor,
} from './editor.js';
import { initFileExplorer } from './file-explorer.js';
import { readFile, writeFile } from './filesystem.js';
import { sandbox } from './store.js';
import type { OpenFile } from './types.js';

export async function initApp(root: HTMLElement): Promise<void> {
	const tabStrip = mustQuery(root, '#lse-tabs');
	const monacoContainer = mustQuery(root, '#lse-monaco');
	const fileTreeBody = mustQuery(root, '#lse-file-tree-body');
	const dragHandle = mustQuery(root, '#lse-drag-handle');
	const editorPane = mustQuery(root, '.lse-editor-pane');
	const previewPane = mustQuery(root, '.lse-preview-pane');
	const iframe = mustQuery(root, '#lse-preview-iframe') as HTMLIFrameElement;

	initEditor(monacoContainer);
	initDragHandle(dragHandle, editorPane, previewPane);

	// --- Tab state ---
	const openTabs: OpenFile[] = [];
	let activeTab: string | null = null;

	function renderTabs(): void {
		tabStrip.replaceChildren();
		for (const tab of openTabs) {
			const tabEl = el('div', 'lse-tab');
			if (tab.path === activeTab) tabEl.classList.add('active');

			const labelEl = el('span');
			labelEl.textContent = tab.label;

			const closeBtn = el('span', 'lse-tab-close');
			closeBtn.textContent = '×';
			closeBtn.setAttribute('title', 'Close');

			tabEl.appendChild(labelEl);
			tabEl.appendChild(closeBtn);

			tabEl.addEventListener('click', () => activateTab(tab.path));
			closeBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				closeTab(tab.path);
			});

			tabStrip.appendChild(tabEl);
		}
	}

	function activateTab(path: string): void {
		activeTab = path;
		showInEditor(path);
		renderTabs();
	}

	function closeTab(path: string): void {
		const idx = openTabs.findIndex((t) => t.path === path);
		openTabs.splice(idx, 1);
		if (activeTab === path) {
			activeTab = openTabs[idx]?.path ?? openTabs[idx - 1]?.path ?? null;
			showInEditor(activeTab);
		}
		renderTabs();
	}

	const client = await sandbox.actions.boot(iframe);
	if (!client) return;

	const docroot = await client.documentRoot;
	const wpContentPath = `${docroot}/wp-content`;

	// --- File explorer ---
	initFileExplorer(fileTreeBody, client, wpContentPath, async (filePath) => {
		const existingTab = openTabs.find((t) => t.path === filePath);
		const label = filePath.split('/').pop() ?? filePath;

		if (!existingTab) {
			const content = await readFile(client, filePath);
			openTabs.push({ path: filePath, label });
			loadFileIntoEditor(filePath, content);
		}

		activateTab(filePath);
		sandbox.state.statusText = filePath;
	});

	// --- Save handler ---
	addSaveCommand(async (path, content) => {
		await writeFile(client, path, content);
		const currentUrl = await client.getCurrentURL();
		await client.goTo(currentUrl);
		sandbox.state.statusText = `Saved: ${path.split('/').pop()}`;
		setTimeout(() => {
			sandbox.state.statusText = 'Ready';
		}, 2000);
	});
}

function el(tag: string, className?: string): HTMLElement {
	const element = document.createElement(tag);
	if (className) element.className = className;
	return element;
}

function mustQuery(root: HTMLElement, selector: string): HTMLElement {
	const found = root.querySelector(selector);
	if (!(found instanceof HTMLElement)) {
		throw new Error(`[live-sandbox-editor] Missing element ${selector}`);
	}
	return found;
}

function initDragHandle(
	handle: HTMLElement,
	editorPane: HTMLElement,
	previewPane: HTMLElement,
): void {
	handle.addEventListener('mousedown', (startEvent: MouseEvent) => {
		startEvent.preventDefault();
		const container = handle.parentElement;
		if (!container) return;

		const onMove = (e: MouseEvent): void => {
			const containerRect = container.getBoundingClientRect();
			const handleWidth = 4;
			const editorWidth = e.clientX - containerRect.left;
			const previewWidth = containerRect.width - editorWidth - handleWidth;

			if (editorWidth < 200 || previewWidth < 200) return;

			editorPane.style.flex = 'none';
			editorPane.style.width = `${editorWidth}px`;
			previewPane.style.flex = 'none';
			previewPane.style.width = `${previewWidth}px`;
		};

		const onUp = (): void => {
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup', onUp);
		};

		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseup', onUp);
	});
}
