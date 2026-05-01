// Placeholder — full implementation added in Task 3.
// Rolldown (Vite 8) resolves dynamic imports at build time, so the module
// must exist. This stub is replaced by the real implementation in Task 3.
import type { PlaygroundClient } from '@wp-playground/client';
import type { TestUpgradeRequest } from './types.js';

export async function runTestUpgrade(
	_client: PlaygroundClient,
	_request: TestUpgradeRequest,
	_onStatus: (status: string) => void,
): Promise<void> {
	throw new Error('runTestUpgrade: not yet implemented (Task 3)');
}
