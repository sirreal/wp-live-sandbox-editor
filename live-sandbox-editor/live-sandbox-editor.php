<?php
/**
 * Plugin Name:       Live Sandbox Editor
 * Plugin URI:        https://github.com/sirreal/live-sandbox-editor
 * Description:       Open a live sandbox editor of your site for testing or development.
 * Version:           0.1
 * Requires at least: 6.8
 * Tested up to:      6.9
 * Author:            Jon Surrell
 * Author URI:        https://profiles.wordpress.org/jonsurrell/
 * License:           GPLv2 or later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 *
 * @package LiveSandboxEditor
 */

namespace Live_Sandbox_Editor;

use WP_REST_Request;
use Exception;

const SLUG    = 'live-sandbox-editor';
const VERSION = '0.1';

/** Set up the plugin. */
function init() {
	static $done = false;
	if ( $done ) {
		return;
	}
	$done = true;

	add_action(
		'rest_api_init',
		function () {
			register_rest_route(
				SLUG . '/v1',
				'/to-do',
				array(
					'methods' => 'GET',
					'callback' => function ( WP_REST_Request $request ) {
						return 'Looks good!';
					},
					'permission_callback' => fn() => current_user_can( 'update_php' ),
				)
			);
		}
	);

	wp_register_script_module(
		'@' . SLUG . '/main',
		plugins_url( 'main.mjs', __FILE__ ),
		array(),
		VERSION
	);

	add_action(
		'admin_enqueue_scripts',
		function ( $hook_suffix ) {
			if ( $hook_suffix === 'toplevel_page_' . SLUG ) {
					wp_enqueue_style( SLUG, plugins_url( 'style.css', __FILE__ ), array(), VERSION );
					wp_enqueue_script_module( '@html-api-debugger/main' );
			}
		}
	);

	add_action(
		'admin_menu',
		function () {
			add_menu_page(
				'Live Sandbox Editor',
				'Live Sandbox Editor',
				'update_php',
				SLUG,
				function () {
					echo <<<'HTML'
					<h1>Working</h1>
					HTML;
				},
			);
		}
	);
}

add_action( 'init', __NAMESPACE__ . '\\init' );
