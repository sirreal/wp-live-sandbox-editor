import type { PlaygroundClient } from '@wp-playground/client';
import type { TestUpgradeRequest } from './types.js';

export async function runTestUpgrade(
	client: PlaygroundClient,
	req: TestUpgradeRequest,
	onStatus: (status: string) => void,
): Promise<void> {
	const docroot = await client.documentRoot;

	onStatus('Triggering upgrade…');
	const nonce = await mintUpgradeNonce(client, docroot, req.entry);

	// Show plugins.php first so the "There is a new version" row is visible
	// for one beat before the upgrade screen takes over. The 800 ms delay is
	// intentional UX, not a sync boundary.
	await client.goTo('/wp-admin/plugins.php');
	await sleep(800);

	const params = new URLSearchParams({
		action: 'upgrade-plugin',
		plugin: req.entry,
		_wpnonce: nonce,
	});
	await client.goTo(`/wp-admin/update.php?${params.toString()}`);

	onStatus('Upgrade in progress. See iframe.');
}

async function mintUpgradeNonce(
	client: PlaygroundClient,
	docroot: string,
	entry: string,
): Promise<string> {
	const result = await client.run({
		code: `<?php
			require ${phpStr(docroot)} . '/wp-load.php';
			wp_set_current_user(1);
			echo wp_create_nonce('upgrade-plugin_' . ${phpStr(entry)});
		`,
	});
	const nonce = result.text.trim();
	if (!/^[a-f0-9]{8,}$/i.test(nonce)) {
		throw new Error(`Failed to mint upgrade nonce; got: ${nonce.slice(0, 80)}`);
	}
	return nonce;
}

function phpStr(s: string): string {
	return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}
