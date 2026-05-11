import type { PlaygroundClient } from '@wp-playground/client';
import {
	getAppData,
	type TestPluginUpgradePayload,
	type TestThemeUpgradePayload,
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

export async function runTestPluginUpgrade(
	client: PlaygroundClient,
	payload: TestPluginUpgradePayload,
	onStatus: (status: string) => void,
): Promise<void> {
	const { adminPath } = getAppData();
	await runUpgrade(
		client,
		{
			listingPath: `${adminPath}plugins.php`,
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
	const { adminPath } = getAppData();
	await runUpgrade(
		client,
		{
			listingPath: `${adminPath}themes.php`,
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
 * The matcher extracts every `update.php?…` URL on the page and parses its
 * query string with `URLSearchParams`, so query-arg order doesn't matter and
 * extra args injected by core or another plugin don't break the lookup.
 * Matches both `/wp-admin/update.php?…` and bare `update.php?…` (the form
 * emitted by themes.php's Backbone template); the result is rebuilt against
 * `adminPath` for navigation.
 */
async function findUpgradeUrl(
	client: PlaygroundClient,
	kind: UpgradeKind,
): Promise<string> {
	const { adminPath } = getAppData();
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
	// esc_url() can emit either &amp; or &#038; for query separators in admin
	// link hrefs. Normalize to plain & before parsing.
	const normalized = response.text.replace(/&(?:amp;|#038;)/g, '&');

	// Excluding `\` as well as quotes/angle brackets: themes.php emits the
	// upgrade URL inside JSON-encoded HTML (e.g. `data-update=\"…\"`),
	// where the URL's terminating quote is preceded by a `\`. Without
	// excluding the backslash we'd capture it into the match, corrupt
	// the trailing nonce, and update.php would respond "link expired."
	const urlRe = /update\.php\?[^\s"'<>\\]+/gi;
	for (const m of normalized.matchAll(urlRe)) {
		const url = m[0];
		const qIdx = url.indexOf('?');
		const params = new URLSearchParams(url.slice(qIdx + 1));
		if (
			params.get('action') === kind.action &&
			params.get(kind.keyParam) === kind.keyValue &&
			params.get('_wpnonce')
		) {
			return `${adminPath}${url}`;
		}
	}
	throw new Error(kind.notFoundError);
}

/**
 * Install (idempotent) the mu-plugin that intercepts
 * `api.wordpress.org/{plugins,themes}-update-check` HTTP requests and
 * returns a synthetic response built from the `lse_test_upgrade_payload`
 * option. Each test-upgrade run rewrites that option just before
 * navigating, so the same mu-plugin serves both plugin and theme flows.
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
				'requires'     => '',
				'requires_php' => '',
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
				'id'          => 'w.org/plugins/' . $slug,
				'slug'        => $slug,
				'plugin'      => $entry_path,
				'new_version' => $new_version,
				'url'         => (string) ( $payload['url'] ?? '' ),
				'package'     => (string) ( $payload['package'] ?? '' ),
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

/**
 * Encode a JS string for use inside a PHP single-quoted literal: only `\\`
 * and `'` need escaping.
 */
function php(s: string): string {
	return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function buildPluginPayloadPhp(p: TestPluginUpgradePayload): string {
	return `
		update_option( 'lse_test_upgrade_payload', array(
			'kind'        => 'plugin',
			'plugin'      => ${php(p.plugin)},
			'slug'        => ${php(p.slug)},
			'new_version' => ${php(p.new_version)},
			'url'         => ${php(p.url)},
			'package'     => ${php(p.package)},
		), false );
	`;
}

function buildThemePayloadPhp(p: TestThemeUpgradePayload): string {
	return `
		update_option( 'lse_test_upgrade_payload', array(
			'kind'        => 'theme',
			'slug'        => ${php(p.slug)},
			'new_version' => ${php(p.new_version)},
			'url'         => ${php(p.url)},
			'package'     => ${php(p.package)},
		), false );
	`;
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}
