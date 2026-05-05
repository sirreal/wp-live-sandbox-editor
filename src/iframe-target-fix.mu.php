<?php
/**
 * Live Sandbox Editor — strip target="_parent" from upgrader action links.
 *
 * WP core hardcodes `target="_parent"` on the action links emitted by the
 * plugin/theme upgrader and installer skins (a leftover from the bulk-update
 * iframe UI inside plugins.php). Playground's entire admin already runs in
 * an iframe owned by the editor; `_parent` resolves to the editor's host
 * page, so clicking those links navigates the host out of the sandbox UI.
 *
 * Each emitting site filters its action array through a dedicated hook, so
 * we intercept those and rewrite the HTML via the HTML API.
 *
 * @package Live_Sandbox_Editor
 */

/**
 * Remove target="_parent" from any anchor in each action HTML string.
 *
 * @param array $actions Action label => anchor HTML.
 * @return array
 */
function lse_strip_parent_target_actions( $actions ) {
	if ( ! is_array( $actions ) ) {
		return $actions;
	}
	foreach ( $actions as $key => $html ) {
		if ( ! is_string( $html ) || false === strpos( $html, '_parent' ) ) {
			continue;
		}
		$p = new WP_HTML_Tag_Processor( $html );
		while ( $p->next_tag( 'a' ) ) {
			if ( '_parent' === $p->get_attribute( 'target' ) ) {
				$p->remove_attribute( 'target' );
			}
		}
		$actions[ $key ] = $p->get_updated_html();
	}
	return $actions;
}

foreach (
	array(
		'update_plugin_complete_actions',
		'update_bulk_plugins_complete_actions',
		'update_theme_complete_actions',
		'update_bulk_theme_complete_actions',
		'update_translations_complete_actions',
		'install_plugin_complete_actions',
		'install_plugin_overwrite_actions',
		'install_theme_complete_actions',
		'install_theme_overwrite_actions',
		'theme_install_actions',
	) as $lse_hook
) {
	add_filter( $lse_hook, 'lse_strip_parent_target_actions' );
}
unset( $lse_hook );
