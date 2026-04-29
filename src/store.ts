import { store } from '@wordpress/interactivity';
import type { PlaygroundClient } from '@wp-playground/client';
import { initPlayground } from './playground.js';
import { getAppData } from './types.js';

export interface SandboxState {
	url: string;
	statusText: string;
	isReady: boolean;
}

let client: PlaygroundClient | null = null;

export const sandbox = store('live-sandbox-editor/sandbox', {
	state: {
		url: '',
		statusText: '',
		isReady: false,
	} as SandboxState,
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
			yield client.goTo(sandbox.state.url);
		},
		*boot(
			iframe: HTMLIFrameElement,
		): Generator<Promise<unknown>, PlaygroundClient | null> {
			const { scriptDebug, wpDebug } = getAppData();
			try {
				client = (yield initPlayground(
					iframe,
					(s: string) => {
						sandbox.state.statusText = s;
					},
					{ scriptDebug, wpDebug },
				)) as PlaygroundClient;
			} catch (err) {
				sandbox.state.statusText = 'Playground failed to initialize.';
				console.error(
					'[live-sandbox-editor] Playground init error:',
					err,
				);
				return null;
			}

			sandbox.state.statusText = 'Ready';
			sandbox.state.isReady = true;
			sandbox.state.url = (yield client.getCurrentURL()) as string;
			yield client.onNavigation((path: string) => {
				sandbox.state.url = path;
			});

			return client;
		},
	},
});
