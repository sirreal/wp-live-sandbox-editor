<?php
/**
 * "Test upgrade in sandbox" — host-side link injection for plugins and themes.
 *
 * @package LiveSandboxEditor
 */

namespace Live_Sandbox_Editor\Test_Upgrade;

\defined( 'ABSPATH' ) || exit;

use Live_Sandbox_Editor;

/** Bootstraps the feature. Called from main plugin init(). */
function init(): void {
	add_action( 'admin_init', __NAMESPACE__ . '\\register_plugin_update_message_hooks' );
	add_action( 'admin_init', __NAMESPACE__ . '\\register_theme_update_message_hooks' );
	add_filter( 'wp_prepare_themes_for_js', __NAMESPACE__ . '\\inject_theme_sandbox_links' );
	add_action( 'admin_enqueue_scripts', __NAMESPACE__ . '\\enqueue_themes_grid_module' );
}

/**
 * Return the host's update payload for the given plugin entry, or null if
 * the host's `update_plugins` site_transient doesn't have a response row
 * for it. Caller (Run-page enqueue) lifts this into AppData so Playground
 * can seed its own transient instead of hitting api.wordpress.org.
 *
 * @return array{plugin:string,slug:string,new_version:string,package:string,url:string}|null
 */
function get_plugin_update_payload( string $entry ): ?array {
	if ( ! current_user_can( 'manage_options' ) ) {
		return null;
	}
	$updates = get_site_transient( 'update_plugins' );
	if ( ! is_object( $updates ) || empty( $updates->response ) || ! is_array( $updates->response ) ) {
		return null;
	}
	if ( ! isset( $updates->response[ $entry ] ) ) {
		return null;
	}
	$r = $updates->response[ $entry ];
	// Plugin response rows are objects in modern WP, but older transient
	// shapes (or hand-built ones from filters) can be arrays. Accept both.
	$get = static function ( $key, string $default = '' ) use ( $r ): string {
		if ( is_object( $r ) && isset( $r->$key ) ) {
			return (string) $r->$key;
		}
		if ( is_array( $r ) && isset( $r[ $key ] ) ) {
			return (string) $r[ $key ];
		}
		return $default;
	};
	$slug = $get( 'slug' );
	if ( '' === $slug ) {
		// Best-effort fallback when the response row lacks an explicit slug:
		// the plugin folder name is what `w.org/plugins/{slug}` is keyed on.
		$slug = str_contains( $entry, '/' ) ? explode( '/', $entry, 2 )[0] : '';
	}
	return array(
		'plugin'      => $entry,
		'slug'        => $slug,
		'new_version' => $get( 'new_version' ),
		'package'     => $get( 'package' ),
		'url'         => $get( 'url' ),
	);
}

/**
 * Return the host's update payload for the given theme slug, or null.
 * Theme entries in `update_themes->response` are arrays (not objects).
 *
 * @return array{slug:string,new_version:string,package:string,url:string}|null
 */
function get_theme_update_payload( string $slug ): ?array {
	if ( ! current_user_can( 'manage_options' ) ) {
		return null;
	}
	$updates = get_site_transient( 'update_themes' );
	if ( ! is_object( $updates ) || empty( $updates->response ) || ! is_array( $updates->response ) ) {
		return null;
	}
	if ( empty( $updates->response[ $slug ] ) || ! is_array( $updates->response[ $slug ] ) ) {
		return null;
	}
	$r = $updates->response[ $slug ];
	return array(
		'slug'        => $slug,
		'new_version' => isset( $r['new_version'] ) ? (string) $r['new_version'] : '',
		'package'     => isset( $r['package'] ) ? (string) $r['package'] : '',
		'url'         => isset( $r['url'] ) ? (string) $r['url'] : '',
	);
}

/**
 * Read the named site transient and register one closure per item that has
 * an advertised update under the given hook prefix. Reading the transient
 * here (rather than per render) keeps registration idempotent and avoids
 * running the inner closure for items that don't apply.
 */
function register_per_item_update_hooks( string $transient, string $hook_prefix, callable $renderer ): void {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$updates = get_site_transient( $transient );
	if ( ! is_object( $updates ) || empty( $updates->response ) || ! is_array( $updates->response ) ) {
		return;
	}
	foreach ( array_keys( $updates->response ) as $key ) {
		$key = (string) $key;
		add_action(
			$hook_prefix . $key,
			static function () use ( $key, $renderer ): void {
				$renderer( $key );
			},
			10,
			0
		);
	}
}

function register_plugin_update_message_hooks(): void {
	register_per_item_update_hooks(
		'update_plugins',
		'in_plugin_update_message-',
		__NAMESPACE__ . '\\render_plugin_link'
	);
}

/**
 * `in_theme_update_message-{slug}` only fires in the multisite network-admin
 * themes list table (WP_MS_Themes_List_Table). Single-site installs use
 * inject_theme_sandbox_links() via wp_prepare_themes_for_js instead.
 */
function register_theme_update_message_hooks(): void {
	if ( ! is_network_admin() ) {
		return;
	}
	register_per_item_update_hooks(
		'update_themes',
		'in_theme_update_message-',
		__NAMESPACE__ . '\\render_theme_link'
	);
}

/**
 * Filter wp_prepare_themes_for_js to append the sandbox link to each theme's
 * update HTML. themes.php's grid and the theme-detail overlay both render
 * from this data, and neither has a per-card PHP hook.
 *
 * @param array<string,array<string,mixed>> $prepared_themes Theme data keyed by slug.
 * @return array<string,array<string,mixed>>
 */
function inject_theme_sandbox_links( array $prepared_themes ): array {
	if ( ! current_user_can( 'manage_options' ) ) {
		return $prepared_themes;
	}
	$label = __( 'test the theme update in the sandbox', 'live-sandbox-editor' );
	foreach ( $prepared_themes as $slug => &$theme_data ) {
		// wp_prepare_themes_for_js is filterable; an upstream filter could
		// hand us a non-array value for a single theme. Guard at the boundary.
		if ( ! is_array( $theme_data ) ) {
			continue;
		}
		if ( empty( $theme_data['hasUpdate'] ) || empty( $theme_data['update'] ) ) {
			continue;
		}
		$link_html = build_link_html(
			(string) $slug,
			'testThemeUpgrade',
			'data-lse-test-theme-upgrade',
			$label
		);
		$update = (string) $theme_data['update'];
		// Insert before the trailing `</p>`, tolerating whatever closes the
		// notice (`</strong>`, plain text, or trailing whitespace). If there
		// is no trailing `</p>` the markup has drifted and we silently no-op
		// rather than risk producing broken HTML. Using preg_replace_callback
		// keeps `$link_html` out of the replacement-string parser — otherwise
		// any `$0`..`$9` sequence (e.g. from a translated label) would be
		// reinterpreted as a backreference.
		$replaced = preg_replace_callback(
			'#</p>\s*$#i',
			static function ( array $m ) use ( $link_html ): string {
				return $link_html . $m[0];
			},
			$update,
			1
		);
		if ( null !== $replaced && $replaced !== $update ) {
			$theme_data['update'] = $replaced;
		}
	}
	unset( $theme_data );
	return $prepared_themes;
}

function render_plugin_link( string $entry ): void {
	// build_link_html() already escapes every interpolation with the
	// context-correct helper; no kses wrap needed.
	echo build_link_html( // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- See build_link_html().
		$entry,
		'testUpgrade',
		'data-lse-test-upgrade',
		__( 'test the plugin update in the sandbox', 'live-sandbox-editor' )
	);
}

function render_theme_link( string $slug ): void {
	// build_link_html() already escapes every interpolation with the
	// context-correct helper; no kses wrap needed.
	echo build_link_html( // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- See build_link_html().
		$slug,
		'testThemeUpgrade',
		'data-lse-test-theme-upgrade',
		__( 'test the theme update in the sandbox', 'live-sandbox-editor' )
	);
}

/**
 * URL of the Run page, usable from both blog admin and network admin.
 *
 * `menu_page_url()` reads `$_parent_pages`, which is only populated for menus
 * registered via `admin_menu`. The plugin doesn't register on
 * `network_admin_menu`, so calling `menu_page_url()` from a network-admin
 * request returns an empty string and any `add_query_arg()` built on top of
 * it resolves against the current network-admin URL — i.e. the link goes
 * nowhere useful. Building the URL via `admin_url()` skips the
 * `$_parent_pages` lookup and lands on the current blog's admin (the main
 * site when called from network admin), where the menu IS registered.
 */
function get_run_page_url(): string {
	return admin_url( 'admin.php?page=' . Live_Sandbox_Editor\SLUG );
}

/**
 * Build the "Or {link}." sandbox-link HTML fragment to append to an update
 * notice. The leading <br> breaks it onto its own line below the standard
 * "View version X details" / "update now" links so the sandbox-test offer
 * reads as a distinct alternative.
 */
function build_link_html( string $key, string $query_arg, string $data_attr, string $label ): string {
	$run_url = get_run_page_url();
	$href    = add_query_arg( $query_arg, $key, $run_url );

	return '<br>' . sprintf(
		/* translators: %s: link to test the update in the Live Sandbox Editor. */
		esc_html__( 'Or %s.', 'live-sandbox-editor' ),
		sprintf(
			'<a href="%s" class="lse-test-upgrade-link" %s="%s">%s</a>',
			esc_url( $href ),
			esc_attr( $data_attr ),
			esc_attr( $key ),
			esc_html( $label )
		)
	);
}

/**
 * themes.php's per-card "New version available." notice is rendered by a JS
 * Backbone template, so there's no per-card PHP hook to attach to. The
 * module at src/themes-grid.ts walks the DOM, observes re-renders, and
 * captures clicks before themes.js's delegated handler hijacks the link.
 * Host-side data (href map + label + translation fragments) is forwarded
 * via the `script_module_data_{$module_id}` filter and consumed in JS
 * through the same `wp-script-module-data-…` element that AppData uses.
 */
function enqueue_themes_grid_module( string $hook_suffix ): void {
	if ( 'themes.php' !== $hook_suffix ) {
		return;
	}
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$updates = get_site_transient( 'update_themes' );
	if ( ! is_object( $updates ) || empty( $updates->response ) || ! is_array( $updates->response ) ) {
		return;
	}
	$run_url = get_run_page_url();
	$hrefs   = array();
	foreach ( array_keys( $updates->response ) as $slug ) {
		$hrefs[ (string) $slug ] = add_query_arg( 'testThemeUpgrade', $slug, $run_url );
	}
	$label = __( 'test the theme update in the sandbox', 'live-sandbox-editor' );
	/* translators: %s: link to test the update in the Live Sandbox Editor. */
	$or_label = __( 'Or %s.', 'live-sandbox-editor' );
	// Split on the PHP side so JS never has to know about gettext placeholder
	// shapes — translations may legally use `%1$s` instead of `%s`. If the
	// translation drops the placeholder entirely (broken catalog), fall back
	// to the source string's split.
	$or_parts  = preg_split( '/%(?:\d+\$)?s/', $or_label, 2 );
	$or_prefix = ( is_array( $or_parts ) && isset( $or_parts[1] ) ) ? $or_parts[0] : 'Or ';
	$or_suffix = ( is_array( $or_parts ) && isset( $or_parts[1] ) ) ? $or_parts[1] : '.';

	$module_id = Live_Sandbox_Editor\SLUG . '-themes-grid';
	wp_enqueue_script_module(
		$module_id,
		plugins_url( 'build/themes-grid.js', Live_Sandbox_Editor\PLUGIN_FILE ),
		array(),
		Live_Sandbox_Editor\asset_version( 'build/themes-grid.js' )
	);
	add_filter(
		"script_module_data_{$module_id}",
		static function () use ( $hrefs, $label, $or_prefix, $or_suffix ) {
			return array(
				'hrefs'     => $hrefs,
				'label'     => $label,
				'orPrefix'  => $or_prefix,
				'orSuffix'  => $or_suffix,
			);
		}
	);
}
