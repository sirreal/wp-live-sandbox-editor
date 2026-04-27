import type { PlaygroundClient } from '@wp-playground/client';
import {
	addSaveCommand,
	initEditor,
	loadFileIntoEditor,
	showInEditor,
} from './editor.js';
import { initFileExplorer } from './file-explorer.js';
import { readFile, writeFile } from './filesystem.js';
import { initPlayground } from './playground.js';
import type { OpenFile } from './types.js';

const INITIALIZED_DATA_KEY = 'liveSandboxEditorInitialized';

export async function initApp(root: HTMLElement): Promise<void> {
	if (root.dataset[INITIALIZED_DATA_KEY] === 'true') {
		return;
	}
	root.dataset[INITIALIZED_DATA_KEY] = 'true';
	root.replaceChildren();

	// --- Build DOM ---
	const main = el('div', 'lse-main');
	const editorPane = el('div', 'lse-editor-pane');
	const fileTree = el('div', 'lse-file-tree');
	const fileTreeHeader = el('div', 'lse-file-tree-header');
	fileTreeHeader.textContent = 'Files';
	const fileTreeBody = el('div', 'lse-file-tree-body');
	fileTree.appendChild(fileTreeHeader);
	fileTree.appendChild(fileTreeBody);

	const monacoSection = el('div', 'lse-monaco-section');
	const tabStrip = el('div', 'lse-tabs');
	const monacoContainer = el('div', 'lse-monaco-container');
	monacoSection.appendChild(tabStrip);
	monacoSection.appendChild(monacoContainer);

	editorPane.appendChild(fileTree);
	editorPane.appendChild(monacoSection);

	const dragHandle = el('div', 'lse-drag-handle');

	const previewPane = el('div', 'lse-preview-pane');
	const previewToolbar = el('div', 'lse-preview-toolbar');
	const previewLabel = el('span');
	previewLabel.textContent = 'Playground Preview';
	const refreshBtn = el('button');
	refreshBtn.textContent = '↺ Refresh';
	previewToolbar.appendChild(previewLabel);
	previewToolbar.appendChild(refreshBtn);
	const iframe = document.createElement('iframe');
	iframe.className = 'lse-preview-iframe';
	iframe.setAttribute('allow', 'cross-origin-isolated');
	previewPane.appendChild(previewToolbar);
	previewPane.appendChild(iframe);

	main.appendChild(editorPane);
	main.appendChild(dragHandle);
	main.appendChild(previewPane);

	const statusBar = el('div', 'lse-status-bar');
	const statusText = el('span', 'lse-status-indicator');
	statusText.textContent = '● Initializing…';
	statusBar.appendChild(statusText);

	const loading = el('div', 'lse-loading');
	const spinner = el('div', 'lse-spinner');
	const loadingLabel = el('span');
	loadingLabel.textContent = 'Booting Playground…';
	loading.appendChild(spinner);
	loading.appendChild(loadingLabel);

	root.appendChild(main);
	root.appendChild(statusBar);
	root.appendChild(loading);

	// --- Init Monaco ---
	initEditor(monacoContainer);

	// --- Drag handle ---
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

	// --- Init Playground ---
	let playgroundClient: PlaygroundClient | null = null;

	const onStatus = (status: string): void => {
		loadingLabel.textContent = status;
		statusText.textContent = `● ${status}`;
	};

	try {
		playgroundClient = await initPlayground(iframe, onStatus);
	} catch (err) {
		loadingLabel.textContent = 'Playground failed to initialize.';
		console.error('[live-sandbox-editor] Playground init error:', err);
		return;
	}

	loading.classList.add('hidden');
	statusText.textContent = '● Ready';

	const client = playgroundClient;
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
		statusText.textContent = `● ${filePath}`;
	});

	// --- Save handler ---
	addSaveCommand(async (path, content) => {
		await writeFile(client, path, content);
		const currentUrl = await client.getCurrentURL();
		await client.goTo(currentUrl);
		statusText.textContent = `● Saved: ${path.split('/').pop()}`;
		setTimeout(() => {
			statusText.textContent = '● Ready';
		}, 2000);
	});

	// --- Refresh button ---
	refreshBtn.addEventListener('click', async () => {
		const currentUrl = await client.getCurrentURL();
		await client.goTo(currentUrl);
	});
}

function el(tag: string, className?: string): HTMLElement {
	const element = document.createElement(tag);
	if (className) element.className = className;
	return element;
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
