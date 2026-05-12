import type { PlaygroundClient } from '@wp-playground/client';
import { phpStringLiteral } from './playground.js';
import testUpgradeInterceptMuPhp from './test-upgrade-intercept.mu.php?raw';
import type {
	TestPluginUpgradePayload,
	TestThemeUpgradePayload,
} from './types.js';

interface UpgradeKind {
	listingPath: string;
	action: 'upgrade-plugin' | 'upgrade-theme';
	keyParam: 'plugin' | 'theme';
	keyValue: string;
	// PHP fragment that writes the host-resolved update payload into a
	// `lse_test_upgrade_payload` option. A mu-plugin (installed once per
	// boot) reads that option and intercepts `api.wordpress.org/{plugins,
	// themes}-update-check` requests with a synthetic response, so
	// WordPress's normal `wp_update_{plugins,themes}()` path populates
	// the right transient — even when the outbound .org call would
	// otherwise return empty (as we've observed for the themes endpoint
	// inside Playground).
	storePayloadPhp: string;
	notFoundError: string;
}

// Paths are absolute relative to Playground's docroot, which always serves
// admin at `/wp-admin/`. The host's `admin_url()` is irrelevant here:
// hosts running in a subdirectory (e.g. `/wp/wp-admin/`) would otherwise
// produce paths that don't exist inside Playground.
const PG_ADMIN = '/wp-admin/';

export async function runTestPluginUpgrade(
	client: PlaygroundClient,
	payload: TestPluginUpgradePayload,
	onStatus: (status: string) => void,
): Promise<void> {
	await runUpgrade(
		client,
		{
			listingPath: `${PG_ADMIN}plugins.php`,
			action: 'upgrade-plugin',
			keyParam: 'plugin',
			keyValue: payload.plugin,
			storePayloadPhp: buildPluginPayloadPhp(payload),
			notFoundError: `No upgrade link found on plugins.php for ${payload.plugin} after pre-populating the host's update payload.`,
		},
		onStatus,
	);
}

export async function runTestThemeUpgrade(
	client: PlaygroundClient,
	payload: TestThemeUpgradePayload,
	onStatus: (status: string) => void,
): Promise<void> {
	await runUpgrade(
		client,
		{
			listingPath: `${PG_ADMIN}themes.php`,
			action: 'upgrade-theme',
			keyParam: 'theme',
			keyValue: payload.slug,
			storePayloadPhp: buildThemePayloadPhp(payload),
			notFoundError: `No upgrade link found on themes.php for ${payload.slug} after pre-populating the host's update payload.`,
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
 * Plant the host's update payload + a `pre_http_request` mu-plugin inside
 * Playground, then fetch the listing page. WP's normal update-check path
 * sees the synthetic .org response and writes the matching transient, so
 * plugins.php / themes.php renders the upgrade notice (with a
 * Playground-side `_wpnonce`) for our matcher.
 *
 * Fetching the listing HTML via `client.request` runs the PHP request inside
 * the iframe's auth session, so the rendered nonce matches what `update.php`
 * will expect from the iframe's own navigation. Minting the nonce via
 * `client.run()` would use a different session token (no LOGGED_IN cookie)
 * and trip "link expired."
 *
 * Anchors for plugins.php (and the network-admin themes list table) are
 * PHP-rendered, so `DOMParser` + `URLSearchParams` does the lookup directly.
 * Single-site themes.php hands the per-theme `update` HTML to a Backbone
 * template via the `_wpThemeSettings` JSON literal inside an inline
 * `<script>`; the upgrade URL never makes it into the live DOM at request
 * time. For that path we evaluate the `#theme-js-extra` initializer inside
 * a hidden srcdoc iframe to read `_wpThemeSettings` directly, then parse
 * the per-theme `update` fragment as its own document.
 */
async function findUpgradeUrl(
	client: PlaygroundClient,
	kind: UpgradeKind,
): Promise<string> {
	const docroot = await client.documentRoot;

	await installInterceptor(client, docroot);
	await client.run({
		code: `<?php
			require '${docroot}/wp-load.php';
			${kind.storePayloadPhp}
			// Flush stale checks so the next admin-page load re-runs
			// wp_update_{plugins,themes}() — which our pre_http_request
			// filter now intercepts with the host payload.
			delete_site_transient( 'update_plugins' );
			delete_site_transient( 'update_themes' );
		`,
	});

	const response = await client.request({ url: kind.listingPath });
	const doc = new DOMParser().parseFromString(response.text, 'text/html');

	const selector = `a[href*="action=${kind.action}"]`;
	for (const a of doc.querySelectorAll(selector)) {
		const tail = matchUpdatePath(a.getAttribute('href') ?? '', kind);
		if (tail) return `${PG_ADMIN}${tail}`;
	}

	if (kind.action === 'upgrade-theme') {
		const tail = await findThemeUpdateUrl(doc, kind);
		if (tail) return `${PG_ADMIN}${tail}`;
	}

	throw new Error(kind.notFoundError);
}

function matchUpdatePath(href: string, kind: UpgradeKind): string | null {
	const idx = href.indexOf('update.php?');
	if (idx === -1) return null;
	const tail = href.slice(idx);
	const params = new URLSearchParams(tail.slice(tail.indexOf('?') + 1));
	return params.get('action') === kind.action &&
		params.get(kind.keyParam) === kind.keyValue &&
		params.get('_wpnonce')
		? tail
		: null;
}

async function findThemeUpdateUrl(
	doc: Document,
	kind: UpgradeKind,
): Promise<string | null> {
	// `#theme-js-extra` is the id `wp_localize_script` emits for the `theme`
	// handle on single-site themes.php — the only script that ships
	// `_wpThemeSettings` in core. If WP ever renames the handle this returns
	// `[]` and the outer `findUpgradeUrl` throws `notFoundError`.
	const scriptEl = doc.querySelector('#theme-js-extra');
	if (!scriptEl) return null;

	const themes = await readThemesFromScript(scriptEl.outerHTML);
	const theme = themes.find((t) => t.id === kind.keyValue);
	if (!theme || typeof theme.update !== 'string') return null;

	// `theme.update` is a `<p>…<a href="update.php?…">…</a></p>` fragment.
	// Parsing as HTML and reading the anchor href is fine here because
	// `matchUpdatePath` below requires a literal `update.php?` path with
	// the right `action`/key params and a `_wpnonce` — anything else (e.g.
	// a `javascript:` URI) is rejected before we hand it to `client.goTo`.
	const updateDoc = new DOMParser().parseFromString(theme.update, 'text/html');
	for (const a of updateDoc.querySelectorAll(
		'a[href*="/wp-admin/update.php"]',
	)) {
		const tail = matchUpdatePath(a.getAttribute('href') ?? '', kind);
		if (tail) return tail;
	}
	return null;
}

// Run WP's `var _wpThemeSettings = {…};` initializer inside a hidden srcdoc
// iframe and return its `themes` array. Lets the JS engine parse the
// literal directly — no hand-rolled brace-counter, no `JSON.parse` round
// trip — at the cost of executing fetched JS in a same-origin iframe.
// Returns `[]` when the script doesn't set `_wpThemeSettings.themes`; the
// iframe is always removed before this resolves.
async function readThemesFromScript(
	scriptHtml: string,
): Promise<Array<{ id?: unknown; update?: unknown }>> {
	const frame = document.createElement('iframe');
	frame.style.display = 'none';
	frame.srcdoc = scriptHtml;
	const loaded = new Promise<void>((resolve) => {
		frame.addEventListener('load', () => resolve(), { once: true });
	});
	document.body.append(frame);
	try {
		await loaded;
		const themes = (
			frame.contentWindow as unknown as {
				_wpThemeSettings?: { themes?: unknown };
			} | null
		)?._wpThemeSettings?.themes;
		return Array.isArray(themes)
			? (themes as Array<{ id?: unknown; update?: unknown }>)
			: [];
	} finally {
		frame.remove();
	}
}

/**
 * Drop the `pre_http_request` interceptor mu-plugin into Playground.
 * The source lives at src/test-upgrade-intercept.mu.php and is bundled
 * via Vite's `?raw` import — same pattern as the iframe-target-fix and
 * uploads-passthrough mu-plugins in playground.ts.
 *
 * The mu-plugin reads `lse_test_upgrade_payload` (rewritten by each
 * test-upgrade run via `buildPluginPayloadPhp` / `buildThemePayloadPhp`)
 * to synthesize a .org response, so both plugin and theme flows share
 * the same installer.
 */
async function installInterceptor(
	client: PlaygroundClient,
	docroot: string,
): Promise<void> {
	const muDir = `${docroot}/wp-content/mu-plugins`;
	await client.run({
		code: `<?php
			$dir = ${phpStringLiteral(muDir)};
			@mkdir( $dir, 0755, true );
			file_put_contents(
				$dir . '/lse-test-upgrade-intercept.php',
				${phpStringLiteral(testUpgradeInterceptMuPhp)}
			);
		`,
	});
}

function buildPluginPayloadPhp(p: TestPluginUpgradePayload): string {
	return `
		update_option( 'lse_test_upgrade_payload', array(
			'kind'         => 'plugin',
			'plugin'       => ${phpStringLiteral(p.plugin)},
			'slug'         => ${phpStringLiteral(p.slug)},
			'new_version'  => ${phpStringLiteral(p.new_version)},
			'url'          => ${phpStringLiteral(p.url)},
			'package'      => ${phpStringLiteral(p.package)},
			'requires'     => ${phpStringLiteral(p.requires)},
			'requires_php' => ${phpStringLiteral(p.requires_php)},
		), false );
	`;
}

function buildThemePayloadPhp(p: TestThemeUpgradePayload): string {
	return `
		update_option( 'lse_test_upgrade_payload', array(
			'kind'         => 'theme',
			'slug'         => ${phpStringLiteral(p.slug)},
			'new_version'  => ${phpStringLiteral(p.new_version)},
			'url'          => ${phpStringLiteral(p.url)},
			'package'      => ${phpStringLiteral(p.package)},
			'requires'     => ${phpStringLiteral(p.requires)},
			'requires_php' => ${phpStringLiteral(p.requires_php)},
		), false );
	`;
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}
