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
	add_action( 'admin_footer-themes.php', __NAMESPACE__ . '\\print_themes_grid_script' );
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

/**
 * Inject the sandbox link into per-card update notices on themes.php.
 *
 * The card-level "New version available." notice is rendered inline by
 * themes.php (no per-card PHP hook), and the JS template re-renders cards
 * on Backbone model changes — so this script (a) walks initial DOM after
 * load and (b) reapplies via MutationObserver. WordPress's themes.js
 * delegates `click .update-message` to its own `updateTheme` handler, so
 * the injected link calls `stopPropagation` to keep the click from being
 * hijacked into the AJAX-update flow.
 */
function print_themes_grid_script(): void {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$updates = get_site_transient( 'update_themes' );
	if ( ! is_object( $updates ) || empty( $updates->response ) || ! is_array( $updates->response ) ) {
		return;
	}
	$run_url = menu_page_url( Live_Sandbox_Editor\SLUG, false );
	$hrefs   = array();
	foreach ( array_keys( $updates->response ) as $slug ) {
		$hrefs[ (string) $slug ] = add_query_arg( 'testThemeUpgrade', $slug, $run_url );
	}
	$label    = __( 'test the theme update in the sandbox', 'live-sandbox-editor' );
	$or_label = __( 'Or %s.', 'live-sandbox-editor' );
	?>
	<script>
	(function() {
		var hrefs = <?php echo wp_json_encode( $hrefs ); ?>;
		var linkLabel = <?php echo wp_json_encode( $label ); ?>;
		var orFmt = <?php echo wp_json_encode( $or_label ); ?>;

		function slugFor(card) {
			// JS-rendered cards have data-slug; PHP-rendered cards expose the
			// slug via the theme-name id ("{slug}-name").
			var slug = card.getAttribute('data-slug');
			if (slug) return slug;
			var name = card.querySelector('.theme-name[id$="-name"]');
			if (!name) return null;
			return name.id.replace(/-name$/, '');
		}

		function append(card) {
			var msg = card.querySelector('.update-message');
			if (!msg) return;
			if (msg.querySelector('.lse-test-upgrade-link')) return;
			var p = msg.querySelector('p');
			if (!p) return;
			var slug = slugFor(card);
			var href = slug && hrefs[slug];
			if (!href) return;

			var link = document.createElement('a');
			link.className = 'lse-test-upgrade-link';
			link.href = href;
			link.textContent = linkLabel;
			link.setAttribute('data-lse-test-theme-upgrade', slug);
			// themes.js delegates `click .update-message` to its own handler;
			// stop propagation so the link navigates instead of triggering
			// the AJAX update flow.
			link.setAttribute('onclick', 'event.stopPropagation()');

			var parts = orFmt.split('%s');
			p.appendChild(document.createElement('br'));
			p.appendChild(document.createTextNode(parts[0] || ''));
			p.appendChild(link);
			p.appendChild(document.createTextNode(parts[1] || ''));
		}

		function processAll() {
			document.querySelectorAll('.theme').forEach(append);
		}

		if (document.readyState !== 'loading') {
			processAll();
		} else {
			document.addEventListener('DOMContentLoaded', processAll);
		}

		// themes.js's main render path empties `.wrap` and appends a fresh
		// `.themes` container, so the original `.themes` node we'd observe
		// gets detached. Observe `#wpbody-content` (a stable ancestor) and
		// re-process on any subtree change.
		var container = document.getElementById('wpbody-content') || document.body;
		if (container && typeof MutationObserver === 'function') {
			new MutationObserver(processAll).observe(container, {
				childList: true,
				subtree: true,
			});
		}
	})();
	</script>
	<?php
}
