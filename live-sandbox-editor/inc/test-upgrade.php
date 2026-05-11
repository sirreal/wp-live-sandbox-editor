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
	add_action( 'admin_footer-themes.php', __NAMESPACE__ . '\\print_themes_grid_script' );
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
		// rather than risk producing broken HTML.
		$replaced = preg_replace( '#</p>\s*$#i', $link_html . '$0', $update, 1 );
		if ( null !== $replaced && $replaced !== $update ) {
			$theme_data['update'] = $replaced;
		}
	}
	unset( $theme_data );
	return $prepared_themes;
}

function render_plugin_link( string $entry ): void {
	echo wp_kses_post( build_link_html(
		$entry,
		'testUpgrade',
		'data-lse-test-upgrade',
		__( 'test the plugin update in the sandbox', 'live-sandbox-editor' )
	) );
}

function render_theme_link( string $slug ): void {
	echo wp_kses_post( build_link_html(
		$slug,
		'testThemeUpgrade',
		'data-lse-test-theme-upgrade',
		__( 'test the theme update in the sandbox', 'live-sandbox-editor' )
	) );
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
 * Backbone template, so there's no per-card PHP hook to attach to. This
 * script (a) walks the initial DOM after load, (b) re-applies on subtree
 * mutation (re-renders), and (c) installs a single capture-phase click
 * handler that stops propagation for every .lse-test-upgrade-link — without
 * that, themes.js's delegated `click .update-message` handler hijacks the
 * link into the AJAX-update flow. The capture-phase listener also covers
 * PHP-filter-injected anchors that the DOM-walk skips as already-present.
 */
function print_themes_grid_script(): void {
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
	$label    = __( 'test the theme update in the sandbox', 'live-sandbox-editor' );
	$or_label = __( 'Or %s.', 'live-sandbox-editor' );
	?>
	<script>
	(function() {
		var hrefs = <?php echo wp_json_encode( $hrefs ); ?>;
		var linkLabel = <?php echo wp_json_encode( $label ); ?>;
		var orFmt = <?php echo wp_json_encode( $or_label ); ?>;

		// Capture-phase listener fires before themes.js's bubble-phase
		// delegation on `.update-message`, covering both JS-injected cards
		// and PHP-filter-injected anchors uniformly.
		document.addEventListener('click', function(e) {
			var t = e.target;
			if (t && t.closest && t.closest('a.lse-test-upgrade-link')) {
				e.stopPropagation();
			}
		}, true);

		function slugFor(card) {
			// JS-rendered cards have data-slug; PHP-rendered cards expose
			// the slug via the theme-name id ("{slug}-name").
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
		// re-process. rAF-coalesce because themes.js fires many small
		// mutations per render (search-as-you-type, modal open/close).
		var container = document.getElementById('wpbody-content') || document.body;
		if (container && typeof MutationObserver === 'function') {
			var pending = false;
			var schedule = function() {
				if (pending) return;
				pending = true;
				requestAnimationFrame(function() {
					pending = false;
					processAll();
				});
			};
			new MutationObserver(function(records) {
				for (var i = 0; i < records.length; i++) {
					if (records[i].addedNodes && records[i].addedNodes.length) {
						schedule();
						return;
					}
				}
			}).observe(container, { childList: true, subtree: true });
		}
	})();
	</script>
	<?php
}
