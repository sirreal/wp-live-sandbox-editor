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
	add_action( 'admin_init', __NAMESPACE__ . '\\register_update_message_hooks' );
	add_action( 'admin_init', __NAMESPACE__ . '\\register_theme_update_message_hooks' );
	add_filter( 'wp_prepare_themes_for_js', __NAMESPACE__ . '\\inject_theme_sandbox_links' );
}

/**
 * One closure per entry that currently has an advertised update. Reading
 * the transient here (rather than per render) keeps the registration
 * idempotent and avoids running the inner closure for plugins that don't
 * apply.
 */
function register_update_message_hooks(): void {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$updates = get_site_transient( 'update_plugins' );
	if ( ! is_object( $updates ) || empty( $updates->response ) || ! is_array( $updates->response ) ) {
		return;
	}
	foreach ( array_keys( $updates->response ) as $entry ) {
		add_action(
			'in_plugin_update_message-' . $entry,
			static function () use ( $entry ): void {
				render_link( (string) $entry );
			},
			10,
			0
		);
	}
}

/**
 * One closure per theme that currently has an advertised update.
 * `in_theme_update_message-{slug}` fires in the multisite network-admin
 * themes list table (WP_MS_Themes_List_Table). Single-site installs use
 * inject_theme_sandbox_links() via wp_prepare_themes_for_js instead.
 */
function register_theme_update_message_hooks(): void {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$updates = get_site_transient( 'update_themes' );
	if ( ! is_object( $updates ) || empty( $updates->response ) || ! is_array( $updates->response ) ) {
		return;
	}
	foreach ( array_keys( $updates->response ) as $slug ) {
		add_action(
			'in_theme_update_message-' . $slug,
			static function () use ( $slug ): void {
				render_theme_link( (string) $slug );
			},
			10,
			0
		);
	}
}

/**
 * Filter wp_prepare_themes_for_js to append the sandbox link to each
 * theme's update HTML. Used for single-site installs where
 * in_theme_update_message-{slug} never fires (themes.php uses a
 * JavaScript-driven grid rather than a list table with PHP row hooks).
 *
 * @param array<string,array<string,mixed>> $prepared_themes Theme data keyed by slug.
 * @return array<string,array<string,mixed>>
 */
function inject_theme_sandbox_links( array $prepared_themes ): array {
	if ( ! current_user_can( 'manage_options' ) ) {
		return $prepared_themes;
	}
	foreach ( $prepared_themes as $slug => &$theme_data ) {
		if ( empty( $theme_data['hasUpdate'] ) || empty( $theme_data['update'] ) ) {
			continue;
		}
		$link_html = build_theme_link_html( (string) $slug );
		$suffix    = '</strong></p>';
		$update    = (string) $theme_data['update'];
		if ( str_ends_with( $update, $suffix ) ) {
			$theme_data['update'] = substr( $update, 0, -strlen( $suffix ) ) . $link_html . $suffix;
		}
	}
	unset( $theme_data );
	return $prepared_themes;
}

/**
 * Echo the plugin sandbox link inside the update-message paragraph.
 */
function render_link( string $entry ): void {
	$run_url = menu_page_url( Live_Sandbox_Editor\SLUG, false );
	$href    = add_query_arg( 'testUpgrade', $entry, $run_url );
	$label   = __( 'test the plugin update in the sandbox', 'live-sandbox-editor' );

	printf(
		/* translators: %s: link to test the update in the Live Sandbox Editor. */
		'<br>' . esc_html__( 'Or %s.', 'live-sandbox-editor' ),
		sprintf(
			'<a href="%s" class="lse-test-upgrade-link" data-lse-test-upgrade="%s">%s</a>',
			esc_url( $href ),
			esc_attr( $entry ),
			esc_html( $label )
		)
	);
}

/**
 * Echo the theme sandbox link (used by in_theme_update_message-{slug} on
 * multisite network-admin themes page).
 */
function render_theme_link( string $slug ): void {
	echo wp_kses_post( build_theme_link_html( $slug ) );
}

/**
 * Build the sandbox-link HTML fragment to append to a theme update notice.
 */
function build_theme_link_html( string $slug ): string {
	$run_url = menu_page_url( Live_Sandbox_Editor\SLUG, false );
	$href    = add_query_arg( 'testThemeUpgrade', $slug, $run_url );
	$label   = __( 'test the theme update in the sandbox', 'live-sandbox-editor' );

	return '<br>' . sprintf(
		/* translators: %s: link to test the update in the Live Sandbox Editor. */
		esc_html__( 'Or %s.', 'live-sandbox-editor' ),
		sprintf(
			'<a href="%s" class="lse-test-upgrade-link" data-lse-test-theme-upgrade="%s">%s</a>',
			esc_url( $href ),
			esc_attr( $slug ),
			esc_html( $label )
		)
	);
}
