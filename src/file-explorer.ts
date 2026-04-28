import type { PlaygroundClient } from '@wp-playground/client';
import { isDirectory, listDir } from './filesystem.js';

export function initFileExplorer(
	container: HTMLElement,
	client: PlaygroundClient,
	rootPath: string,
	onFileOpen: (path: string) => void,
): void {
	container.replaceChildren();
	renderDir(container, client, rootPath, 0, onFileOpen);
}

async function renderDir(
	container: HTMLElement,
	client: PlaygroundClient,
	dirPath: string,
	depth: number,
	onFileOpen: (path: string) => void,
): Promise<void> {
	let entries: string[];
	try {
		entries = await listDir(client, dirPath);
	} catch {
		return;
	}

	// Sort: dirs first, then files, both alphabetically
	const sorted = await sortEntries(client, entries);

	for (const entry of sorted) {
		const name = entry.split('/').pop() ?? entry;
		const isDir = await isDirectory(client, entry);
		const item = createTreeItem(name, isDir, depth);

		if (isDir) {
			let expanded = false;
			let childContainer: HTMLElement | null = null;

			item.addEventListener('click', async (e) => {
				e.stopPropagation();
				expanded = !expanded;
				const icon = item.querySelector('.lse-tree-icon');
				if (icon) icon.textContent = expanded ? '▾' : '▸';

				if (expanded) {
					childContainer = document.createElement('div');
					container.insertBefore(childContainer, item.nextSibling);
					await renderDir(childContainer, client, entry, depth + 1, onFileOpen);
				} else if (childContainer) {
					childContainer.remove();
					childContainer = null;
				}
			});
		} else {
			item.addEventListener('click', (e) => {
				e.stopPropagation();
				for (const el of document.querySelectorAll('.lse-tree-item.selected')) {
					el.classList.remove('selected');
				}
				item.classList.add('selected');
				onFileOpen(entry);
			});
		}

		container.appendChild(item);
	}
}

function createTreeItem(
	name: string,
	isDir: boolean,
	depth: number,
): HTMLElement {
	const item = document.createElement('div');
	item.className = 'lse-tree-item';
	item.style.paddingLeft = `${8 + depth * 12}px`;

	const icon = document.createElement('span');
	icon.className = 'lse-tree-icon';
	icon.textContent = isDir ? '▸' : '';

	const label = document.createElement('span');
	label.textContent = name;

	item.appendChild(icon);
	item.appendChild(label);
	return item;
}

async function sortEntries(
	client: PlaygroundClient,
	entries: string[],
): Promise<string[]> {
	const withType = await Promise.all(
		entries.map(async (e) => ({
			path: e,
			isDir: await isDirectory(client, e),
		})),
	);
	withType.sort((a, b) => {
		if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
		return a.path.localeCompare(b.path);
	});
	return withType.map((e) => e.path);
}
