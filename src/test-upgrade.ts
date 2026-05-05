import type { PlaygroundClient } from '@wp-playground/client';
import type { TestThemeUpgradeRequest, TestUpgradeRequest } from './types.js';

export async function runTestUpgrade(
	client: PlaygroundClient,
	req: TestUpgradeRequest,
	onStatus: (status: string) => void,
): Promise<void> {
	onStatus('Triggering upgrade…');
	const upgradeUrl = await findUpgradeUrl(client, req.entry);

	// Show plugins.php first so the "There is a new version" row is visible
	// for one beat before the upgrade screen takes over. The 800 ms delay is
	// intentional UX, not a sync boundary.
	await client.goTo('/wp-admin/plugins.php');
	await sleep(800);

	await client.goTo(upgradeUrl);
	onStatus('Upgrade in progress. See iframe.');
}

/**
 * Locate the per-row upgrade link in plugins.php and return its href
 * (including the embedded nonce). Fetching the HTML via `client.request`
 * runs the PHP request inside the iframe's auth session, so the rendered
 * `_wpnonce` matches what `update.php` will expect from the iframe's own
 * navigation. Minting the nonce via `client.run()` would use a different
 * session token (no LOGGED_IN cookie) and trip "link expired."
 */
async function findUpgradeUrl(
	client: PlaygroundClient,
	entry: string,
): Promise<string> {
	const response = await client.request({ url: '/wp-admin/plugins.php' });
	// esc_url() can emit either &amp; or &#038; for query separators in admin
	// link hrefs. Normalize to plain & so a single regex covers both forms.
	const normalized = response.text.replace(/&(?:amp;|#038;)/g, '&');

	const encodedEntry = encodeURIComponent(entry);
	const re = new RegExp(
		`update\\.php\\?action=upgrade-plugin&plugin=${escapeRegex(encodedEntry)}&_wpnonce=([a-f0-9]+)`,
		'i',
	);
	const match = normalized.match(re);
	if (!match) {
		throw new Error(
			`No upgrade link found on plugins.php for ${entry}. The transferred update_plugins transient may have been overwritten or the plugin isn't installed in Playground.`,
		);
	}
	return `/wp-admin/update.php?action=upgrade-plugin&plugin=${encodedEntry}&_wpnonce=${match[1]}`;
}

/**
 * Drive the theme upgrade from the testThemeUpgrade param.
 *
 * Fetches themes.php via the iframe's auth session to extract the
 * upgrade URL (including nonce) for the target theme, then navigates
 * the iframe through themes.php → update.php to run the upgrade.
 */
export async function runTestThemeUpgrade(
	client: PlaygroundClient,
	req: TestThemeUpgradeRequest,
	onStatus: (status: string) => void,
): Promise<void> {
	onStatus('Triggering theme upgrade…');
	const upgradeUrl = await findThemeUpgradeUrl(client, req.slug);

	// Show themes.php first so the update badge is visible for one beat
	// before the upgrade screen takes over. The 800 ms delay is intentional
	// UX, not a sync boundary.
	await client.goTo('/wp-admin/themes.php');
	await sleep(800);

	await client.goTo(upgradeUrl);
	onStatus('Upgrade in progress. See iframe.');
}

/**
 * Locate the per-theme upgrade URL in themes.php and return it
 * (including the embedded nonce).
 *
 * WordPress embeds the nonce inside the `update` HTML field of the
 * `_wpThemeSettings` JS variable on themes.php. Fetching via
 * `client.request` runs inside the iframe's auth session, so the nonce
 * matches what update.php expects from the iframe's own navigation.
 */
async function findThemeUpgradeUrl(
	client: PlaygroundClient,
	slug: string,
): Promise<string> {
	const response = await client.request({ url: '/wp-admin/themes.php' });
	// The update URL is embedded as HTML inside a JSON string value.
	// WordPress's wp_nonce_url uses esc_html which encodes & as &amp;.
	// Normalize all common forms so a single regex covers them.
	const normalized = response.text.replace(/&(?:amp;|#038;)/g, '&');

	const encodedSlug = encodeURIComponent(slug);
	const re = new RegExp(
		`update\\.php\\?action=upgrade-theme&theme=${escapeRegex(encodedSlug)}&_wpnonce=([a-f0-9]+)`,
		'i',
	);
	const match = normalized.match(re);
	if (!match) {
		throw new Error(
			`No upgrade link found on themes.php for ${slug}. The theme may not have an available update or is not installed in Playground.`,
		);
	}
	return `/wp-admin/update.php?action=upgrade-theme&theme=${encodedSlug}&_wpnonce=${match[1]}`;
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}
