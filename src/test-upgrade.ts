import type { PlaygroundClient } from '@wp-playground/client';
import type { TestThemeUpgradeRequest, TestUpgradeRequest } from './types.js';

interface UpgradeKind {
	listingPath: string;
	action: 'upgrade-plugin' | 'upgrade-theme';
	keyParam: 'plugin' | 'theme';
	keyValue: string;
	notFoundError: string;
}

export async function runTestUpgrade(
	client: PlaygroundClient,
	req: TestUpgradeRequest,
	onStatus: (status: string) => void,
): Promise<void> {
	await runUpgrade(
		client,
		{
			listingPath: '/wp-admin/plugins.php',
			action: 'upgrade-plugin',
			keyParam: 'plugin',
			keyValue: req.entry,
			notFoundError: `No upgrade link found on plugins.php for ${req.entry}. The transferred update_plugins transient may have been overwritten or the plugin isn't installed in Playground.`,
		},
		onStatus,
	);
}

export async function runTestThemeUpgrade(
	client: PlaygroundClient,
	req: TestThemeUpgradeRequest,
	onStatus: (status: string) => void,
): Promise<void> {
	await runUpgrade(
		client,
		{
			listingPath: '/wp-admin/themes.php',
			action: 'upgrade-theme',
			keyParam: 'theme',
			keyValue: req.slug,
			notFoundError: `No upgrade link found on themes.php for ${req.slug}. The theme may not have an available update or is not installed in Playground.`,
		},
		onStatus,
	);
}

async function runUpgrade(
	client: PlaygroundClient,
	kind: UpgradeKind,
	onStatus: (status: string) => void,
): Promise<void> {
	onStatus('Triggering upgrade…');
	const upgradeUrl = await findUpgradeUrl(client, kind);

	// Show the listing page first so the update row/badge is visible for one
	// beat before the upgrade screen takes over. The 800 ms delay is
	// intentional UX, not a sync boundary.
	await client.goTo(kind.listingPath);
	await sleep(800);

	await client.goTo(upgradeUrl);
	onStatus('Upgrade in progress. See iframe.');
}

/**
 * Fetching the listing HTML via `client.request` runs the PHP request inside
 * the iframe's auth session, so the rendered `_wpnonce` matches what
 * `update.php` will expect from the iframe's own navigation. Minting the
 * nonce via `client.run()` would use a different session token (no
 * LOGGED_IN cookie) and trip "link expired."
 *
 * The matcher extracts every `update.php?…` URL on the page and parses its
 * query string with `URLSearchParams`, so query-arg order doesn't matter and
 * extra args injected by core or another plugin don't break the lookup.
 */
async function findUpgradeUrl(
	client: PlaygroundClient,
	kind: UpgradeKind,
): Promise<string> {
	const response = await client.request({ url: kind.listingPath });
	// esc_url() can emit either &amp; or &#038; for query separators in admin
	// link hrefs. Normalize to plain & before parsing.
	const normalized = response.text.replace(/&(?:amp;|#038;)/g, '&');

	// Match every update.php URL on the page; the negated character class
	// chops at HTML attribute and tag boundaries. The `/wp-admin/` prefix
	// is optional because themes.php's Backbone template renders bare
	// `update.php?…` hrefs (the host-resolved form). Normalize to the
	// `/wp-admin/update.php?…` path before returning so `client.goTo`
	// lands at a stable, docroot-relative location regardless of which
	// form the page emitted.
	const urlRe = /(?:\/wp-admin\/)?update\.php\?[^\s"'<>]+/gi;
	for (const m of normalized.matchAll(urlRe)) {
		const url = m[0];
		const qIdx = url.indexOf('?');
		const params = new URLSearchParams(url.slice(qIdx + 1));
		if (
			params.get('action') === kind.action &&
			params.get(kind.keyParam) === kind.keyValue &&
			params.get('_wpnonce')
		) {
			const idx = url.indexOf('update.php?');
			return `/wp-admin/${url.slice(idx)}`;
		}
	}
	throw new Error(kind.notFoundError);
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}
