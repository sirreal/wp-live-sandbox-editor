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

use FileTreeProducer;
use WP_REST_Request;
use WordPress\DataLiberation\MySQLDumpProducer;

const SLUG       = 'live-sandbox-editor';
const SETUP_SLUG = 'live-sandbox-editor-setup';
const VERSION    = '0.1';

require_once __DIR__ . '/inc/sync-stream.php';
require_once __DIR__ . '/inc/manifest.php';
require_once __DIR__ . '/inc/class-wpdb-pdo-adapter.php';

/**
 * Load vendored Reprint classes only if they are not already defined.
 *
 * When the Reprint plugin is active it registers its own autoloader for
 * these classes. Loading our vendor/autoload.php on top would attempt to
 * redefine them and cause a fatal "Cannot redeclare class" error. We check
 * for FileTreeProducer (global-namespace) as a sentinel; if it is already
 * available the rest of the vendored classes will be too.
 */
function maybe_load_reprint(): void {
	if ( class_exists( 'FileTreeProducer' ) ) {
		return;
	}
	$autoload = __DIR__ . '/vendor/autoload.php';
	if ( file_exists( $autoload ) ) {
		require_once $autoload;
	}
}

/** Set up the plugin. */
function init(): void {
	static $done = false;
	if ( $done ) {
		return;
	}
	$done = true;

	add_action( 'rest_api_init', __NAMESPACE__ . '\\register_rest_routes' );
	add_action( 'admin_enqueue_scripts', __NAMESPACE__ . '\\enqueue_assets' );
	add_action( 'admin_menu', __NAMESPACE__ . '\\register_menu' );
	add_action( 'admin_notices', __NAMESPACE__ . '\\reprint_notice' );
}

/**
 * Enqueue assets on our admin page.
 *
 * @param string $hook_suffix Current hook suffix.
 */
function enqueue_assets( string $hook_suffix ): void {
	$page = page_for_screen( $hook_suffix );
	if ( null === $page ) {
		return;
	}

	$module_id = 'setup' === $page ? SETUP_SLUG : SLUG;
	add_filter( 'script_module_data_' . $module_id, __NAMESPACE__ . '\\app_data' );

	wp_enqueue_style(
		SLUG,
		plugins_url( 'style.css', __FILE__ ),
		array(),
		asset_version( 'style.css' )
	);

	if ( 'setup' === $page ) {
		wp_enqueue_script_module(
			SETUP_SLUG,
			plugins_url( 'build/setup.js', __FILE__ ),
			array( '@wordpress/interactivity' ),
			asset_version( 'build/setup.js' )
		);
		return;
	}

	wp_enqueue_script_module(
		SLUG,
		plugins_url( 'build/main.js', __FILE__ ),
		array( '@wordpress/interactivity' ),
		asset_version( 'build/main.js' )
	);

	// Authoritative initial state. JS store ({@see src/store.ts}) only
	// declares derived getters; primitives live here.
	wp_interactivity_state(
		SLUG . '/sandbox',
		array(
			'url'        => '',
			'statusText' => 'Initializing…',
			'isReady'    => false,
		)
	);

	wp_enqueue_style(
		SLUG . '-monaco',
		plugins_url( 'build/monaco.css', __FILE__ ),
		array(),
		asset_version( 'build/monaco.css' )
	);
}

/**
 * Classify a screen ID or admin-enqueue hook suffix into our two pages.
 *
 * Submenu hooks are prefixed with `sanitize_title( $parent_menu_title )`,
 * not the parent slug. With menu title "Live Sandbox Editor" that resolves
 * to SLUG, so the run page's hook is `SLUG . '_page_' . SLUG`.
 *
 * @param string $hook_or_screen_id Screen ID or admin_enqueue_scripts hook suffix.
 * @return string|null 'setup', 'run', or null if not one of ours.
 */
function page_for_screen( string $hook_or_screen_id ): ?string {
	if ( 'toplevel_page_' . SETUP_SLUG === $hook_or_screen_id ) {
		return 'setup';
	}
	if ( SLUG . '_page_' . SLUG === $hook_or_screen_id ) {
		return 'run';
	}
	return null;
}

/**
 * Script-module data shared by both pages. Sync type with AppData TS interface.
 *
 * @param array<string,mixed> $data Existing filtered data.
 * @return array<string,mixed>
 */
function app_data( array $data ): array {
	return array_merge(
		$data,
		array(
			'restUrl'     => rest_url( SLUG . '/v1' ),
			'nonce'       => wp_create_nonce( 'wp_rest' ),
			'siteUrl'     => get_site_url(),
			'runUrl'      => menu_page_url( SLUG, false ),
			'scriptDebug' => defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG,
			'wpDebug'     => defined( 'WP_DEBUG' ) && WP_DEBUG,
		)
	);
}

/**
 * Get a cache-busting version for a plugin asset.
 *
 * @param string $relative_path Asset path relative to this plugin directory.
 * @return string Asset version.
 */
function asset_version( string $relative_path ): string {
	$path = __DIR__ . '/' . ltrim( $relative_path, '/' );
	if ( file_exists( $path ) ) {
		return (string) filemtime( $path );
	}
	return VERSION;
}

/** Register the admin menu pages. */
function register_menu(): void {
	add_menu_page(
		'Live Sandbox Editor',
		'Live Sandbox Editor',
		'manage_options',
		SETUP_SLUG,
		__NAMESPACE__ . '\\render_setup_page'
	);
	// Override the auto-mirror submenu so the entry reads "Setup" instead of
	// the parent menu's title.
	add_submenu_page(
		SETUP_SLUG,
		'Setup',
		'Setup',
		'manage_options',
		SETUP_SLUG,
		__NAMESPACE__ . '\\render_setup_page'
	);
	add_submenu_page(
		SETUP_SLUG,
		'Live Sandbox Editor',
		'Run',
		'manage_options',
		SLUG,
		__NAMESPACE__ . '\\render_run_page'
	);
}

/** Render the setup admin page. */
function render_setup_page(): void {
	require __DIR__ . '/templates/setup-view.php';
}

/** Render the run admin page. */
function render_run_page(): void {
	require __DIR__ . '/templates/sandbox-view.php';
}

/** Show a notice when the vendored Reprint classes are unavailable. */
function reprint_notice(): void {
	$screen = get_current_screen();
	if ( ! $screen || null === page_for_screen( $screen->id ) ) {
		return;
	}
	maybe_load_reprint();
	if ( class_exists( 'FileTreeProducer' ) ) {
		return;
	}
	echo '<div class="notice notice-error"><p>';
	esc_html_e( 'Live Sandbox Editor: Reprint classes could not be loaded. Run composer install in the project root directory.', 'live-sandbox-editor' );
	echo '</p></div>';
}

/** Register REST API routes. */
function register_rest_routes(): void {
	$can_manage = static fn() => current_user_can( 'manage_options' );

	register_rest_route(
		SLUG . '/v1',
		'/sync-manifest',
		array(
			'methods'             => 'GET',
			'permission_callback' => $can_manage,
			'callback'            => __NAMESPACE__ . '\\rest_sync_manifest',
		)
	);

	register_rest_route(
		SLUG . '/v1',
		'/sync-files',
		array(
			'methods'             => array( 'GET', 'POST' ),
			'permission_callback' => $can_manage,
			'callback'            => __NAMESPACE__ . '\\rest_sync_files',
		)
	);

	register_rest_route(
		SLUG . '/v1',
		'/sync-db',
		array(
			'methods'             => array( 'GET', 'POST' ),
			'permission_callback' => $can_manage,
			'callback'            => __NAMESPACE__ . '\\rest_sync_db',
		)
	);
}

/**
 * REST callback: return the default sync manifest plus the host site URL
 * and uploads URL, so the JS side can decide how to drive the sync and
 * how to rewrite media URLs after import.
 *
 * @SuppressWarnings(PHPMD.UnusedFormalParameter)
 *
 * @param  WP_REST_Request $request Request.
 * @return array
 */
function rest_sync_manifest( WP_REST_Request $request ): array {
	$uploads     = wp_upload_dir( null, false );
	$uploads_url = is_array( $uploads ) && ! empty( $uploads['baseurl'] ) ? (string) $uploads['baseurl'] : '';
	$manifest    = Manifest\defaults();

	$response = array(
		'manifest'   => $manifest,
		'siteUrl'    => (string) get_site_url(),
		'uploadsUrl' => $uploads_url,
	);

	// Setup-only: walking every installed plugin/theme is opt-in via
	// `?labels=1` so the run-page boot stays cheap.
	if ( ! $request->get_param( 'labels' ) ) {
		return $response;
	}

	// `get_plugins()` is admin-only and not autoloaded for REST callbacks.
	require_once ABSPATH . 'wp-admin/includes/plugin.php';
	$plugin_labels = array();
	foreach ( get_plugins() as $entry => $data ) {
		if ( Manifest\is_self_plugin_entry( $entry ) ) {
			continue;
		}
		$name                    = isset( $data['Name'] ) ? (string) $data['Name'] : '';
		$plugin_labels[ $entry ] = '' !== $name ? $name : $entry;
	}

	$theme_labels = array();
	foreach ( wp_get_themes() as $slug => $theme ) {
		$name                          = (string) $theme->get( 'Name' );
		$theme_labels[ (string) $slug ] = '' !== $name ? $name : (string) $slug;
	}

	$response['pluginLabels'] = $plugin_labels;
	$response['themeLabels']  = $theme_labels;
	return $response;
}

/**
 * REST callback: stream selected files using the chunked-terminator wire
 * format. The handler exits directly so the body is streamed without WP's
 * JSON-envelope buffering.
 *
 * @param  WP_REST_Request $request Request.
 */
function rest_sync_files( WP_REST_Request $request ): void {
	maybe_load_reprint();
	Sync_Stream\setup();

	if ( ! class_exists( 'FileTreeProducer' ) ) {
		http_response_code( 500 );
		Sync_Stream\emit_marker( Sync_Stream\MARKER_ERR, 'Reprint classes not available.' );
		Sync_Stream\emit_marker( Sync_Stream\MARKER_DONE );
		exit;
	}

	$manifest = Manifest\from_request( $request );

	$entries = build_file_entries( $manifest );
	if ( empty( $entries ) ) {
		Sync_Stream\emit_marker( Sync_Stream\MARKER_DONE );
		exit;
	}

	$paths       = array();
	$logical_for = array();
	foreach ( $entries as $tuple ) {
		$paths[]                  = $tuple[0];
		$logical_for[ $tuple[0] ] = $tuple[1];
	}

	// FileTreeProducer's `directories` argument is normalised but not
	// enforced against `paths`; passing a sentinel value is fine.
	$producer = new FileTreeProducer(
		'/',
		array(
			'paths'      => $paths,
			'chunk_size' => 256 * 1024,
		)
	);

	$encoder      = new Sync_Stream\B64_Streamer();
	$emitted      = 0;
	$current_path = null;

	try {
		while ( $producer->next_chunk() ) {
			$chunk = $producer->get_current_chunk();
			if ( ! $chunk || 'file' !== $chunk['type'] ) {
				continue;
			}

			$host_path = $chunk['path'];
			$logical   = $logical_for[ $host_path ] ?? null;
			if ( null === $logical ) {
				continue;
			}

			if ( $current_path !== $logical ) {
				if ( null !== $current_path ) {
					$encoder->finalize();
					Sync_Stream\emit_marker( Sync_Stream\MARKER_END );
				}
				Sync_Stream\emit_marker( Sync_Stream\MARKER_FILE, $logical );
				$current_path = $logical;
			}

			$encoder->feed( $chunk['data'] );

			if ( ! empty( $chunk['is_last_chunk'] ) ) {
				$encoder->finalize();
				Sync_Stream\emit_marker( Sync_Stream\MARKER_END );
				$current_path = null;
			}

			++$emitted;
			if ( 0 === ( $emitted % 64 ) ) {
				// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- set_time_limit may be disabled in php.ini; the silence is the intended fallback.
				@set_time_limit( 0 );
				if ( connection_aborted() ) {
					exit;
				}
			}
		}

		if ( null !== $current_path ) {
			$encoder->finalize();
			Sync_Stream\emit_marker( Sync_Stream\MARKER_END );
		}
	} catch ( \Throwable $e ) {
		if ( ! headers_sent() ) {
			http_response_code( 500 );
		}
		Sync_Stream\emit_marker( Sync_Stream\MARKER_ERR, $e->getMessage() );
		Sync_Stream\emit_marker( Sync_Stream\MARKER_DONE );
		exit;
	}

	Sync_Stream\emit_marker( Sync_Stream\MARKER_DONE );
	exit;
}

/**
 * Build the (host_path, logical_path) tuples to stream from a manifest.
 *
 * @param array{plugins:array<string>,themes:array<string>,uploads:bool} $manifest Normalized manifest.
 * @return array<int,array{0:string,1:string}>
 */
function build_file_entries( array $manifest ): array {
	$tuples = array();
	foreach ( $manifest['plugins'] as $entry ) {
		foreach ( Manifest\plugin_paths( $entry ) as $tuple ) {
			$tuples[] = $tuple;
		}
	}
	foreach ( $manifest['themes'] as $slug ) {
		foreach ( Manifest\theme_paths( $slug ) as $tuple ) {
			$tuples[] = $tuple;
		}
	}
	if ( ! empty( $manifest['uploads'] ) ) {
		foreach ( Manifest\uploads_paths() as $tuple ) {
			$tuples[] = $tuple;
		}
	}

	// Dedupe on host path — different manifest entries shouldn't double-emit a file.
	$seen = array();
	$out  = array();
	foreach ( $tuples as $t ) {
		if ( isset( $seen[ $t[0] ] ) ) {
			continue;
		}
		$seen[ $t[0] ] = true;
		$out[]         = $t;
	}
	return $out;
}

/**
 * REST callback: stream a MySQL dump of the manifest's tables using the
 * chunked-terminator wire format.
 *
 * @param  WP_REST_Request $request Request.
 */
function rest_sync_db( WP_REST_Request $request ): void {
	maybe_load_reprint();
	Sync_Stream\setup();

	if ( ! class_exists( 'WordPress\\DataLiberation\\MySQLDumpProducer' ) ) {
		http_response_code( 503 );
		Sync_Stream\emit_marker( Sync_Stream\MARKER_ERR, 'Reprint classes not available.' );
		Sync_Stream\emit_marker( Sync_Stream\MARKER_DONE );
		exit;
	}

	$manifest = Manifest\from_request( $request );
	if ( empty( $manifest['tables'] ) ) {
		Sync_Stream\emit_marker( Sync_Stream\MARKER_DONE );
		exit;
	}

	try {
		if ( extension_loaded( 'pdo_mysql' ) ) {
			// build_pdo_dsn() is provided by reprint-exporter's Composer `files`
			// autoload; static analysers can't see it.
			if ( function_exists( 'build_pdo_dsn' ) ) {
				$dsn = build_pdo_dsn( DB_HOST, DB_NAME );
			} else {
				$dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4';
			}
			// phpcs:disable WordPress.DB.RestrictedClasses.mysql__PDO -- raw PDO is the preferred dump connection when pdo_mysql is loaded; the wpdb adapter is the fallback for hosts without it.
			$db = new \PDO(
				$dsn,
				DB_USER,
				DB_PASSWORD,
				array( \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION )
			);
			// phpcs:enable WordPress.DB.RestrictedClasses.mysql__PDO
		} else {
			$db = new Wpdb_Pdo_Adapter( $GLOBALS['wpdb'] );
		}
	} catch ( \PDOException $e ) {
		http_response_code( 500 );
		Sync_Stream\emit_marker( Sync_Stream\MARKER_ERR, 'db_connect: ' . $e->getMessage() );
		Sync_Stream\emit_marker( Sync_Stream\MARKER_DONE );
		exit;
	}

	$producer = new MySQLDumpProducer(
		$db,
		array( 'tables_to_process' => $manifest['tables'] )
	);
	$encoder  = new Sync_Stream\B64_Streamer();
	$emitted  = 0;
	$started  = false;

	try {
		while ( $producer->next_sql_fragment() ) {
			$fragment = $producer->get_sql_fragment();
			if ( null === $fragment ) {
				continue;
			}
			if ( ! $started ) {
				Sync_Stream\emit_marker( Sync_Stream\MARKER_SQL );
				$started = true;
			}
			// Newline keeps the splitter inside Playground happy: each
			// fragment is a complete statement and trails a newline.
			$encoder->feed( $fragment . "\n" );

			++$emitted;
			if ( 0 === ( $emitted % 64 ) ) {
				// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- set_time_limit may be disabled in php.ini; the silence is the intended fallback.
				@set_time_limit( 0 );
				if ( connection_aborted() ) {
					exit;
				}
			}
		}
		if ( $started ) {
			$encoder->finalize();
			Sync_Stream\emit_marker( Sync_Stream\MARKER_END );
		}
	} catch ( \Throwable $e ) {
		if ( ! headers_sent() ) {
			http_response_code( 500 );
		}
		Sync_Stream\emit_marker( Sync_Stream\MARKER_ERR, $e->getMessage() );
		Sync_Stream\emit_marker( Sync_Stream\MARKER_DONE );
		exit;
	}

	Sync_Stream\emit_marker( Sync_Stream\MARKER_DONE );
	exit;
}

add_action( 'init', __NAMESPACE__ . '\\init' );
