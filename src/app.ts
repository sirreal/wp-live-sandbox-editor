import { store } from '@wordpress/interactivity';
import { initFileExplorer } from './file-explorer.js';
import { readFile, writeFile } from './filesystem.js';
import type { SyncManifest } from './playground.js';
import { sandbox } from './store.js';
import type { OpenFile } from './types.js';

type EditorMod = typeof import('./editor.js');

export async function initApp(
	root: HTMLElement,
	manifestOverride?: SyncManifest,
): Promise<void> {
	const tabStrip = mustQuery(root, '#lse-tabs');
	const monacoContainer = mustQuery(root, '#lse-monaco');
	const fileTreeBody = mustQuery(root, '#lse-file-tree-body');
	const dragHandle = mustQuery(root, '#lse-drag-handle');
	const editorPane = mustQuery(root, '.lse-editor-pane');
	const previewPane = mustQuery(root, '.lse-preview-pane');
	const iframe = mustQuery(root, '#lse-preview-iframe') as HTMLIFrameElement;

	initDragHandle(dragHandle, editorPane, previewPane);

	const openTabs: OpenFile[] = [];
	let activeTab: string | null = null;

	function renderTabs(mod: EditorMod): void {
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

			tabEl.addEventListener('click', () => activateTab(tab.path, mod));
			closeBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				closeTab(tab.path, mod);
			});

			tabStrip.appendChild(tabEl);
		}
	}

	function activateTab(path: string, mod: EditorMod): void {
		activeTab = path;
		mod.showInEditor(path);
		renderTabs(mod);
	}

	function closeTab(path: string, mod: EditorMod): void {
		const idx = openTabs.findIndex((t) => t.path === path);
		if (idx === -1) return;
		openTabs.splice(idx, 1);
		if (activeTab === path) {
			activeTab = openTabs[idx]?.path ?? openTabs[idx - 1]?.path ?? null;
			mod.showInEditor(activeTab);
		}
		renderTabs(mod);
	}

	let saveHandler: ((path: string, content: string) => Promise<void>) | null =
		null;

	let editorLoadPromise: Promise<EditorMod | null> | null = null;
	function ensureEditorLoaded(): Promise<EditorMod | null> {
		if (!editorLoadPromise) {
			editorLoadPromise = (async () => {
				try {
					// editor.js side-effect-imports monaco-environment.js, so
					// MonacoEnvironment is registered before monaco.editor.create().
					const mod = await import('./editor.js');
					mod.initEditor(monacoContainer);
					// Always register the save command. The wrapper resolves
					// `saveHandler` at Cmd-S press time, so initialising the
					// editor before `saveHandler` is assigned (toggle clicked
					// during the gap between `state.isReady` flipping and
					// `boot()` resolving) is safe — Cmd-S no-ops until the
					// handler lands instead of permanently losing the binding.
					mod.addSaveCommand((path, content) => {
						saveHandler?.(path, content)?.catch((err) => {
							console.error('[live-sandbox-editor] Save failed:', err);
							sandbox.state.statusText = 'Save failed.';
						});
					});
					// Belt-and-suspenders: Monaco's automaticLayout ResizeObserver
					// can lag a frame on first reveal of a previously-hidden
					// container; force a sync layout against real dims.
					requestAnimationFrame(() => mod.getEditor()?.layout());
					return mod;
				} catch (err) {
					// Stale chunk after a plugin update or a transient network
					// blip will surface here; clear the cached promise so the
					// user can retry by toggling again, fall back to closed,
					// and surface the failure in the status bar.
					console.error('[live-sandbox-editor] Editor load failed:', err);
					editorLoadPromise = null;
					sandbox.state.editorOpen = false;
					sandbox.state.statusText = 'Failed to load editor.';
					return null;
				}
			})();
		}
		return editorLoadPromise;
	}

	// Register the data-wp-watch callback synchronously, before the boot
	// await — so any toggle click after hydration finds it. The
	// Interactivity API's store() merges successive registrations to the
	// same namespace.
	store('live-sandbox-editor/sandbox', {
		callbacks: {
			*onEditorOpenChange(): Generator<Promise<unknown>, void> {
				if (sandbox.state.editorOpen) {
					yield ensureEditorLoaded();
					// Re-check: ensureEditorLoaded flips editorOpen back to
					// false on failure, which schedules another tick of this
					// callback (the close branch). Skip focus here so the
					// fallback tick can manage focus instead.
					if (sandbox.state.editorOpen) fileTreeBody.focus();
				} else {
					// Clear inline widths set by the drag handle: their
					// `width:Npx` would otherwise pin the preview pane to its
					// dragged width when the editor pane is hidden, leaving an
					// empty gap where the editor used to be.
					editorPane.style.cssText = '';
					previewPane.style.cssText = '';
					const btn = root.querySelector<HTMLElement>(
						'[data-wp-on--click="actions.toggleEditor"]',
					);
					btn?.focus();
				}
			},
		},
	});

	const client = await sandbox.actions.boot(iframe, manifestOverride);
	if (!client) return;

	saveHandler = async (path, content) => {
		await writeFile(client, path, content);
		const currentUrl = await client.getCurrentURL();
		await client.goTo(currentUrl);
		const savedMessage = `Saved: ${path.split('/').pop()}`;
		sandbox.state.statusText = savedMessage;
		setTimeout(() => {
			if (sandbox.state.statusText === savedMessage) {
				sandbox.state.statusText = 'Ready';
			}
		}, 2000);
	};

	const docroot = await client.documentRoot;
	const wpContentPath = `${docroot}/wp-content`;

	initFileExplorer(fileTreeBody, client, wpContentPath, async (filePath) => {
		const mod = await ensureEditorLoaded();
		// File-tree clicks should be unreachable when the editor isn't loaded
		// (the tree lives inside the hidden editor pane), but if a load failure
		// raced an in-flight click, just bail.
		if (!mod) return;
		const existingTab = openTabs.find((t) => t.path === filePath);
		const label = filePath.split('/').pop() ?? filePath;

		if (!existingTab) {
			const content = await readFile(client, filePath);
			openTabs.push({ path: filePath, label });
			mod.loadFileIntoEditor(filePath, content);
		}

		activateTab(filePath, mod);
		sandbox.state.statusText = filePath;
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
