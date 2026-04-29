import { store } from '@wordpress/interactivity';
import { getClient } from './playground-client-ref.js';

export interface SandboxState {
	url: string;
	statusText: string;
	isReady: boolean;
}

const sandboxStore = store('live-sandbox-editor/sandbox', {
	state: {
		url: '',
		statusText: '',
		isReady: false,
	} as SandboxState,
	actions: {
		setUrl(event: Event): void {
			const input = event.target as HTMLInputElement;
			sandboxStore.state.url = input.value;
		},
		*navigate(event: Event): Generator<Promise<unknown>, void> {
			event.preventDefault();
			const client = getClient();
			if (!client) return;
			yield client.goTo(sandboxStore.state.url);
		},
		*refresh(): Generator<Promise<unknown>, void> {
			const client = getClient();
			if (!client) return;
			yield client.goTo(sandboxStore.state.url);
		},
	},
});

export const sandboxState = sandboxStore.state;
