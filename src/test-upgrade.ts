import type { PlaygroundClient } from '@wp-playground/client';
import type { TestUpgradeRequest } from './types.js';

export async function runTestUpgrade(
	client: PlaygroundClient,
	req: TestUpgradeRequest,
	onStatus: (status: string) => void,
): Promise<void> {
	const docroot = await client.documentRoot;

	onStatus('Refreshing plugin updates…');
	const refresh = await refreshUpdates(client, docroot, req.entry);
	if (!refresh.found) {
		onStatus(
			`No update advertised for ${req.entry} — Playground couldn't resolve it.`,
		);
		// Best effort: still navigate to plugins.php so the user can see
		// the state for themselves.
		await client.goTo('/wp-admin/plugins.php');
		return;
	}

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

	onStatus('Upgrade in progress — see iframe.');
}

interface RefreshResult {
	found: boolean;
	newVersion: string | null;
}

async function refreshUpdates(
	client: PlaygroundClient,
	docroot: string,
	entry: string,
): Promise<RefreshResult> {
	const result = await client.run({
		code: `<?php
			require '${docroot}/wp-load.php';
			wp_set_current_user(1);
			delete_site_transient('update_plugins');
			if (!function_exists('wp_update_plugins')) {
				require_once ABSPATH . 'wp-admin/includes/update.php';
			}
			wp_update_plugins();
			$updates = get_site_transient('update_plugins');
			$entry = ${phpStr(entry)};
			$found = is_object($updates) && !empty($updates->response[$entry]);
			$new_version = null;
			if ($found && isset($updates->response[$entry]->new_version)) {
				$new_version = (string) $updates->response[$entry]->new_version;
			}
			echo json_encode(array('found' => $found, 'newVersion' => $new_version));
		`,
	});
	const parsed = JSON.parse(result.text) as RefreshResult;
	return parsed;
}

async function mintUpgradeNonce(
	client: PlaygroundClient,
	docroot: string,
	entry: string,
): Promise<string> {
	const result = await client.run({
		code: `<?php
			require '${docroot}/wp-load.php';
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
