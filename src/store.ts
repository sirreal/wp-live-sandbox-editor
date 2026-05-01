import { getContext, store } from '@wordpress/interactivity';
import type { PlaygroundClient } from '@wp-playground/client';
import { initPlayground, type SyncManifest } from './playground.js';
import { getAppData } from './types.js';

export type ThemeMode = 'light' | 'dark' | 'auto';
export type EffectiveTheme = 'vs' | 'vs-dark';

export interface SandboxState {
	url: string;
	statusText: string;
	isReady: boolean;
	editorOpen: boolean;
	urlMenuOpen: boolean;
	themeMode: ThemeMode;
	readonly notReady: boolean;
	readonly effectiveTheme: EffectiveTheme;
	readonly themeIsAuto: boolean;
	readonly themeIsLight: boolean;
	readonly themeIsDark: boolean;
}

interface SandboxStore {
	state: SandboxState;
	actions: {
		setUrl(event: Event): void;
		navigate(event: Event): Generator<Promise<unknown>, void>;
		refresh(): Generator<Promise<unknown>, void>;
		toggleEditor(): void;
		openUrlMenu(): void;
		quickNavigate(): Generator<Promise<unknown>, void>;
		setThemeMode(): void;
		boot(
			iframe: HTMLIFrameElement,
			manifestOverride?: SyncManifest,
		): Generator<Promise<unknown>, PlaygroundClient | null>;
	};
}

const THEME_STORAGE_KEY = 'lse-theme-mode';

function isThemeMode(v: unknown): v is ThemeMode {
	return v === 'light' || v === 'dark' || v === 'auto';
}

function readStoredThemeMode(): ThemeMode {
	try {
		const v = localStorage.getItem(THEME_STORAGE_KEY);
		if (isThemeMode(v)) return v;
	} catch {
		// localStorage may be unavailable (privacy modes); fall through.
	}
	return 'auto';
}

const darkMediaQuery =
	typeof window !== 'undefined' && typeof window.matchMedia === 'function'
		? window.matchMedia('(prefers-color-scheme: dark)')
		: null;

// Editor module registers a setter once Monaco is loaded so the store can
// push theme changes without forcing the lazy `monaco-editor` chunk to load
// before the user opens the editor.
let monacoSetTheme: ((theme: EffectiveTheme) => void) | null = null;

export function registerMonacoThemeSetter(
	fn: (theme: EffectiveTheme) => void,
): void {
	monacoSetTheme = fn;
}

function applyMonacoTheme(): void {
	monacoSetTheme?.(sandbox.state.effectiveTheme);
}

let client: PlaygroundClient | null = null;

// Set by quickNavigate when it programmatically refocuses the URL input
// after a keyboard activation; consumed by openUrlMenu so the resulting
// focus event doesn't immediately reopen the menu we just closed.
let suppressNextOpen = false;

// Primitive initial values are authoritative in PHP via
// `wp_interactivity_state` (see live-sandbox-editor/live-sandbox-editor.php).
// Only the derived `notReady` getter is declared here; the rest of the shape
// is supplied by the `SandboxStore` generic and merged from server state at
// hydration.
export const sandbox = store<SandboxStore>('live-sandbox-editor/sandbox', {
	state: {
		themeMode: readStoredThemeMode(),
		get notReady(): boolean {
			return !sandbox.state.isReady;
		},
		get effectiveTheme(): EffectiveTheme {
			const mode = sandbox.state.themeMode;
			if (mode === 'light') return 'vs';
			if (mode === 'dark') return 'vs-dark';
			return darkMediaQuery?.matches ? 'vs-dark' : 'vs';
		},
		get themeIsAuto(): boolean {
			return sandbox.state.themeMode === 'auto';
		},
		get themeIsLight(): boolean {
			return sandbox.state.themeMode === 'light';
		},
		get themeIsDark(): boolean {
			return sandbox.state.themeMode === 'dark';
		},
	},
	actions: {
		setUrl(event: Event): void {
			const input = event.target as HTMLInputElement;
			sandbox.state.url = input.value;
		},
		*navigate(event: Event): Generator<Promise<unknown>, void> {
			event.preventDefault();
			sandbox.state.urlMenuOpen = false;
			if (!client) return;
			yield client.goTo(sandbox.state.url);
		},
		*refresh(): Generator<Promise<unknown>, void> {
			if (!client) return;
			const currentUrl = (yield client.getCurrentURL()) as string;
			yield client.goTo(currentUrl);
		},
		toggleEditor(): void {
			sandbox.state.editorOpen = !sandbox.state.editorOpen;
		},
		setThemeMode(): void {
			const { value } = getContext<{ value: unknown }>();
			if (!isThemeMode(value)) return;
			if (value === sandbox.state.themeMode) return;
			sandbox.state.themeMode = value;
			try {
				localStorage.setItem(THEME_STORAGE_KEY, value);
			} catch {
				// Ignore quota / disabled-storage failures; in-memory state
				// still reflects the user's choice for this session.
			}
			applyMonacoTheme();
		},
		openUrlMenu(): void {
			if (suppressNextOpen) {
				suppressNextOpen = false;
				return;
			}
			sandbox.state.urlMenuOpen = true;
		},
		*quickNavigate(): Generator<Promise<unknown>, void> {
			const { path } = getContext<{ path: string }>();
			sandbox.state.urlMenuOpen = false;
			sandbox.state.url = path;
			// Keyboard activation (Enter/Space) leaves focus on the menu
			// button that the bound `hidden` then makes invisible — focus
			// would fall back to body. Move it to the URL input so the user
			// can keep typing. The suppress flag stops the focus event from
			// reopening the menu.
			const input = document.querySelector<HTMLInputElement>('.lse-url-input');
			if (input && document.activeElement !== input) {
				suppressNextOpen = true;
				input.focus();
			}
			if (!client) return;
			yield client.goTo(path);
		},
		*boot(
			iframe: HTMLIFrameElement,
			manifestOverride?: SyncManifest,
		): Generator<Promise<unknown>, PlaygroundClient | null> {
			const { scriptDebug, wpDebug } = getAppData();
			try {
				client = (yield initPlayground(
					iframe,
					(s: string) => {
						sandbox.state.statusText = s;
					},
					{ scriptDebug, wpDebug },
					manifestOverride,
				)) as PlaygroundClient;
			} catch (err) {
				sandbox.state.statusText = 'Playground failed to initialize.';
				console.error('[live-sandbox-editor] Playground init error:', err);
				return null;
			}

			sandbox.state.statusText = 'Refreshing…';
			const currentUrl = (yield client.getCurrentURL()) as string;
			yield client.goTo(currentUrl);

			sandbox.state.statusText = 'Ready';
			sandbox.state.isReady = true;
			sandbox.state.url = currentUrl;
			yield client.onNavigation((path: string) => {
				const input = document.querySelector('.lse-url-input');
				if (document.activeElement === input) return;
				sandbox.state.url = path;
			});

			return client;
		},
	},
});

// Live-follow OS appearance only when the user has chosen 'auto'. In manual
// modes the listener fires but the effective theme doesn't change, so the
// editor stays put.
darkMediaQuery?.addEventListener('change', () => {
	if (sandbox.state.themeMode === 'auto') applyMonacoTheme();
});
