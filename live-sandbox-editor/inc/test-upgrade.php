<?php
/**
 * "Test upgrade in sandbox" — host-side link injection.
 *
 * @package LiveSandboxEditor
 */

namespace Live_Sandbox_Editor\Test_Upgrade;

\defined( 'ABSPATH' ) || exit;

use Live_Sandbox_Editor;

/** Bootstraps the feature. Called from main plugin init(). */
function init(): void {
	add_action( 'admin_init', __NAMESPACE__ . '\\register_update_message_hooks' );
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
			}
		);
	}
}

/**
 * Echo the link inside the update-message paragraph. The `<br>` breaks it
 * onto its own line below the standard "View version X details" / "update
 * now" links so the sandbox-test offer reads as a distinct alternative.
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
