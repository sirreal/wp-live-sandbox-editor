import type { PlaygroundClient } from '@wp-playground/client';
import { phpStringLiteral } from './playground.js';
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
 * time. For that path we lift the literal out of the script body, then
 * parse the `update` fragment as its own document.
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
		const tail = findInBackboneThemeData(doc, kind, selector);
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

function findInBackboneThemeData(
	doc: Document,
	kind: UpgradeKind,
	selector: string,
): string | null {
	for (const script of doc.querySelectorAll('script')) {
		const text = script.textContent ?? '';
		if (!text.includes('_wpThemeSettings')) continue;
		const literal = extractObjectLiteral(text, '_wpThemeSettings');
		if (!literal) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(literal);
		} catch {
			continue;
		}
		const themes = (
			parsed as { themes?: Array<{ id?: unknown; update?: unknown }> }
		).themes;
		if (!Array.isArray(themes)) continue;
		const theme = themes.find((t) => t.id === kind.keyValue);
		if (!theme || typeof theme.update !== 'string') continue;
		const frag = new DOMParser().parseFromString(theme.update, 'text/html');
		for (const a of frag.querySelectorAll(selector)) {
			const tail = matchUpdatePath(a.getAttribute('href') ?? '', kind);
			if (tail) return tail;
		}
	}
	return null;
}

// Pull the first `{...}` object literal assigned to `name` out of a JS
// source string. Counts braces while skipping over JSON/JS string
// contents so `}` inside string values doesn't terminate the match.
function extractObjectLiteral(source: string, name: string): string | null {
	const re = new RegExp(String.raw`\b${name}\b\s*=\s*`);
	const m = re.exec(source);
	if (!m) return null;
	const open = source.indexOf('{', m.index + m[0].length);
	if (open === -1) return null;
	let depth = 0;
	let inStr: string | null = null;
	let esc = false;
	for (let i = open; i < source.length; i++) {
		const c = source[i];
		if (inStr) {
			if (esc) esc = false;
			else if (c === '\\') esc = true;
			else if (c === inStr) inStr = null;
			continue;
		}
		if (c === '"' || c === "'") inStr = c;
		else if (c === '{') depth++;
		else if (c === '}') {
			depth--;
			if (depth === 0) return source.slice(open, i + 1);
		}
	}
	return null;
}

/**
 * Write the mu-plugin that intercepts
 * `api.wordpress.org/{plugins,themes}-update-check` HTTP requests and
 * returns a synthetic response built from the `lse_test_upgrade_payload`
 * option. The file is overwritten on every call — functionally idempotent,
 * not literally; the content is identical each run so the overwrite is a
 * no-op for behavior. Each test-upgrade run rewrites the option just
 * before navigating, so the same mu-plugin serves both plugin and theme
 * flows.
 */
async function installInterceptor(
	client: PlaygroundClient,
	docroot: string,
): Promise<void> {
	const muPluginPhp = `<?php
add_filter( 'pre_http_request', function ( $pre, $args, $url ) {
	if ( ! is_string( $url ) ) {
		return $pre;
	}
	$is_themes  = false !== strpos( $url, 'api.wordpress.org/themes/update-check' );
	$is_plugins = false !== strpos( $url, 'api.wordpress.org/plugins/update-check' );
	if ( ! $is_themes && ! $is_plugins ) {
		return $pre;
	}

	$payload = get_option( 'lse_test_upgrade_payload', null );
	if ( ! is_array( $payload ) || empty( $payload['kind'] ) ) {
		return $pre;
	}

	$body = array(
		'plugins'      => (object) array(),
		'themes'       => (object) array(),
		'no_update'    => (object) array(),
		'translations' => array(),
	);

	if ( $is_themes && 'theme' === $payload['kind'] ) {
		$slug = (string) ( $payload['slug'] ?? '' );
		if ( '' !== $slug ) {
			$new_version = (string) ( $payload['new_version'] ?? '' );
			$entry       = array(
				'theme'        => $slug,
				'new_version'  => $new_version,
				'url'          => (string) ( $payload['url'] ?? '' ),
				'package'      => (string) ( $payload['package'] ?? '' ),
				'requires'     => (string) ( $payload['requires'] ?? '' ),
				'requires_php' => (string) ( $payload['requires_php'] ?? '' ),
			);
			// Route to no_update once the on-disk version has caught up,
			// otherwise themes.php would keep flashing the upgrade notice
			// after a successful test upgrade.
			$installed = (string) wp_get_theme( $slug )->get( 'Version' );
			$bucket    = ( '' !== $installed && version_compare( $installed, $new_version, '>=' ) ) ? 'no_update' : 'themes';
			$body[ $bucket ] = array( $slug => $entry );
		}
	} elseif ( $is_plugins && 'plugin' === $payload['kind'] ) {
		$entry_path = (string) ( $payload['plugin'] ?? '' );
		$slug       = (string) ( $payload['slug'] ?? '' );
		if ( '' !== $entry_path ) {
			$new_version = (string) ( $payload['new_version'] ?? '' );
			$info        = array(
				'id'           => 'w.org/plugins/' . $slug,
				'slug'         => $slug,
				'plugin'       => $entry_path,
				'new_version'  => $new_version,
				'url'          => (string) ( $payload['url'] ?? '' ),
				'package'      => (string) ( $payload['package'] ?? '' ),
				'requires'     => (string) ( $payload['requires'] ?? '' ),
				'requires_php' => (string) ( $payload['requires_php'] ?? '' ),
			);
			if ( ! function_exists( 'get_plugins' ) ) {
				require_once ABSPATH . 'wp-admin/includes/plugin.php';
			}
			$all_plugins     = get_plugins();
			$installed       = isset( $all_plugins[ $entry_path ]['Version'] ) ? (string) $all_plugins[ $entry_path ]['Version'] : '';
			$bucket          = ( '' !== $installed && version_compare( $installed, $new_version, '>=' ) ) ? 'no_update' : 'plugins';
			$body[ $bucket ] = array( $entry_path => $info );
		}
	}

	return array(
		'response' => array( 'code' => 200, 'message' => 'OK' ),
		'headers'  => array(),
		'body'     => wp_json_encode( $body ),
		'cookies'  => array(),
		'filename' => null,
	);
}, 1, 3 );
`;
	const muPluginEscaped = muPluginPhp
		.replace(/\\/g, '\\\\')
		.replace(/'/g, "\\'");
	await client.run({
		code: `<?php
			$dir = '${docroot}/wp-content/mu-plugins';
			@mkdir( $dir, 0755, true );
			file_put_contents( $dir . '/lse-test-upgrade-intercept.php', '${muPluginEscaped}' );
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
