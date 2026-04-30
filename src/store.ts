import { store } from '@wordpress/interactivity';
import type { PlaygroundClient } from '@wp-playground/client';
import { initPlayground, type SyncManifest } from './playground.js';
import { getAppData } from './types.js';

export interface SandboxState {
	url: string;
	statusText: string;
	isReady: boolean;
	editorOpen: boolean;
	readonly notReady: boolean;
}

interface SandboxStore {
	state: SandboxState;
	actions: {
		setUrl(event: Event): void;
		navigate(event: Event): Generator<Promise<unknown>, void>;
		refresh(): Generator<Promise<unknown>, void>;
		toggleEditor(): void;
		boot(
			iframe: HTMLIFrameElement,
			manifestOverride?: SyncManifest,
		): Generator<Promise<unknown>, PlaygroundClient | null>;
	};
}

let client: PlaygroundClient | null = null;

// Primitive initial values are authoritative in PHP via
// `wp_interactivity_state` (see live-sandbox-editor/live-sandbox-editor.php).
// Only the derived `notReady` getter is declared here; the rest of the shape
// is supplied by the `SandboxStore` generic and merged from server state at
// hydration.
export const sandbox = store<SandboxStore>('live-sandbox-editor/sandbox', {
	state: {
		get notReady(): boolean {
			return !sandbox.state.isReady;
		},
	},
	actions: {
		setUrl(event: Event): void {
			const input = event.target as HTMLInputElement;
			sandbox.state.url = input.value;
		},
		*navigate(event: Event): Generator<Promise<unknown>, void> {
			event.preventDefault();
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
