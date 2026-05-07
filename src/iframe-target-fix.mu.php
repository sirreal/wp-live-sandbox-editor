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
 * Strip `target="_parent"` from anchors in an upgrader/installer action list.
 *
 * @param array<string,string>|mixed $actions Action HTML keyed by slug.
 *
 * @return array<string,string>|mixed Filtered actions, or original value if not an array.
 */
function lse_strip_parent_target_actions( $actions ) {
	if ( ! is_array( $actions ) ) {
		return $actions;
	}
	foreach ( $actions as $key => $html ) {
		if ( ! is_string( $html ) || false === stripos( $html, '_parent' ) ) {
			continue;
		}
		$p = new WP_HTML_Tag_Processor( $html );
		while ( $p->next_tag( 'a' ) ) {
			$target = $p->get_attribute( 'target' );
			if ( is_string( $target ) && 0 === strcasecmp( $target, '_parent' ) ) {
				$p->remove_attribute( 'target' );
			}
		}
		$actions[ $key ] = $p->get_updated_html();
	}
	return $actions;
}

add_filter( 'update_plugin_complete_actions', 'lse_strip_parent_target_actions' );
add_filter( 'update_bulk_plugins_complete_actions', 'lse_strip_parent_target_actions' );
add_filter( 'update_theme_complete_actions', 'lse_strip_parent_target_actions' );
add_filter( 'update_bulk_theme_complete_actions', 'lse_strip_parent_target_actions' );
add_filter( 'update_translations_complete_actions', 'lse_strip_parent_target_actions' );
add_filter( 'install_plugin_complete_actions', 'lse_strip_parent_target_actions' );
add_filter( 'install_plugin_overwrite_actions', 'lse_strip_parent_target_actions' );
add_filter( 'install_theme_complete_actions', 'lse_strip_parent_target_actions' );
add_filter( 'install_theme_overwrite_actions', 'lse_strip_parent_target_actions' );
add_filter( 'theme_install_actions', 'lse_strip_parent_target_actions' );
