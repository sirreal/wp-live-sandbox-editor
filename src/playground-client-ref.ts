import type { PlaygroundClient } from '@wp-playground/client';

let _client: PlaygroundClient | null = null;

export function setClient(client: PlaygroundClient): void {
	_client = client;
}

export function getClient(): PlaygroundClient | null {
	return _client;
}
