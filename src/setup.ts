import { getContext, store } from '@wordpress/interactivity';
import type { ManifestResponse, SyncManifest } from './playground.js';
import { getAppData } from './types.js';

const SETUP_MODULE_ID = 'live-sandbox-editor-setup';

interface Item {
	id: string;
	label: string;
	selected: boolean;
}

interface SetupState {
	loading: boolean;
	loadError: boolean;
	plugins: Item[];
	themes: Item[];
	tables: Item[];
	uploads: boolean;
	readonly runDisabled: boolean;
}

interface SetupStore {
	state: SetupState;
	actions: {
		togglePlugin(): void;
		toggleTheme(): void;
		toggleTable(): void;
		toggleUploads(): void;
		retry(): void;
		run(): void;
	};
}

const setup = store<SetupStore>('live-sandbox-editor/setup', {
	state: {
		loading: true,
		loadError: false,
		plugins: [],
		themes: [],
		tables: [],
		uploads: false,
		get runDisabled(): boolean {
			if (setup.state.loading || setup.state.loadError) return true;
			const anySelected =
				setup.state.plugins.some((p) => p.selected) ||
				setup.state.themes.some((t) => t.selected) ||
				setup.state.tables.some((t) => t.selected);
			return !anySelected && !setup.state.uploads;
		},
	},
	actions: {
		togglePlugin(): void {
			const ctx = getContext<{ item: Item }>();
			ctx.item.selected = !ctx.item.selected;
		},
		toggleTheme(): void {
			const ctx = getContext<{ item: Item }>();
			ctx.item.selected = !ctx.item.selected;
		},
		toggleTable(): void {
			const ctx = getContext<{ item: Item }>();
			ctx.item.selected = !ctx.item.selected;
		},
		toggleUploads(): void {
			setup.state.uploads = !setup.state.uploads;
		},
		retry(): void {
			void loadDefaults();
		},
		run(): void {
			const manifest: SyncManifest = {
				plugins: setup.state.plugins.filter((p) => p.selected).map((p) => p.id),
				themes: setup.state.themes.filter((t) => t.selected).map((t) => t.id),
				tables: setup.state.tables.filter((t) => t.selected).map((t) => t.id),
				uploads: setup.state.uploads,
			};
			const { runUrl } = getAppData(SETUP_MODULE_ID);
			const sep = runUrl.includes('?') ? '&' : '?';
			const url = `${runUrl}${sep}manifest=${encodeURIComponent(
				JSON.stringify(manifest),
			)}`;
			window.location.assign(url);
		},
	},
});

void loadDefaults();

async function loadDefaults(): Promise<void> {
	setup.state.loading = true;
	setup.state.loadError = false;
	const { restUrl, nonce } = getAppData(SETUP_MODULE_ID);
	try {
		const res = await fetch(`${restUrl}/sync-manifest`, {
			headers: { 'X-WP-Nonce': nonce, Accept: 'application/json' },
		});
		if (!res.ok) {
			throw new Error(`sync-manifest failed: ${res.status}`);
		}
		const data = (await res.json()) as ManifestResponse;
		const pluginLabels = data.pluginLabels ?? {};
		const themeLabels = data.themeLabels ?? {};
		setup.state.plugins = data.manifest.plugins.map((id) => ({
			id,
			label: pluginLabels[id] ?? id,
			selected: true,
		}));
		setup.state.themes = data.manifest.themes.map((id) => ({
			id,
			label: themeLabels[id] ?? id,
			selected: true,
		}));
		setup.state.tables = data.manifest.tables.map((id) => ({
			id,
			label: id,
			selected: true,
		}));
		setup.state.uploads = data.manifest.uploads;
		setup.state.loading = false;
	} catch (err) {
		console.error('[live-sandbox-editor] Failed to load defaults:', err);
		setup.state.loadError = true;
		setup.state.loading = false;
	}
}
