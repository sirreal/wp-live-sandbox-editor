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
use RecursiveCallbackFilterIterator;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use SplFileInfo;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;
use WordPress\DataLiberation\MySQLDumpProducer;

const SLUG    = 'live-sandbox-editor';
const VERSION = '0.1';

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
	if ( $hook_suffix !== 'toplevel_page_' . SLUG ) {
		return;
	}

	wp_enqueue_script_module(
		SLUG,
		plugins_url( 'build/main.js', __FILE__ ),
		array(),
		VERSION
	);

	add_filter(
		'script_module_data_' . SLUG,
		function (): array {
			/**
			 * Sync type with AppData TS interface.
			 *
			 * @phpstan-var array{
			 *                   restUrl: string;
			 *                   nonce: string;
			 *                   siteUrl: string;
			 *                   scriptDebug: bool;
			 *                   wpDebug: bool;
			 *                 }
			 */
			$app_data = array(
				'restUrl'     => rest_url( SLUG . '/v1' ),
				'nonce'       => wp_create_nonce( 'wp_rest' ),
				'siteUrl'     => get_site_url(),
				'scriptDebug' => defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG,
				'wpDebug'     => defined( 'WP_DEBUG' ) && WP_DEBUG,
			);
			return $app_data;
		}
	);

	wp_enqueue_style( SLUG, plugins_url( 'style.css', __FILE__ ), array(), VERSION );
	wp_enqueue_style( SLUG . '-monaco', plugins_url( 'build/main.css', __FILE__ ), array(), VERSION );
}

/** Register the admin menu page. */
function register_menu(): void {
	add_menu_page(
		'Live Sandbox Editor',
		'Live Sandbox Editor',
		'manage_options',
		SLUG,
		__NAMESPACE__ . '\\render_page'
	);
}

/** Render the admin page. */
function render_page(): void {
	echo '<div id="live-sandbox-editor-root"></div>';
}

/** Show a notice when the vendored Reprint classes are unavailable. */
function reprint_notice(): void {
	$screen = get_current_screen();
	if ( ! $screen || $screen->id !== 'toplevel_page_' . SLUG ) {
		return;
	}
	maybe_load_reprint();
	if ( class_exists( 'FileTreeProducer' ) ) {
		return;
	}
	echo '<div class="notice notice-error"><p>';
	esc_html_e( 'Live Sandbox Editor: Reprint classes could not be loaded. Run composer install in the plugin directory.', 'live-sandbox-editor' );
	echo '</p></div>';
}

/** Register REST API routes. */
function register_rest_routes(): void {
	register_rest_route(
		SLUG . '/v1',
		'/reprint-files',
		array(
			'methods'             => 'GET',
			'permission_callback' => fn() => current_user_can( 'manage_options' ),
			'callback'            => __NAMESPACE__ . '\\rest_reprint_files',
			'args'                => array(
				'cursor' => array(
					'type'              => 'string',
					'required'          => false,
					'sanitize_callback' => 'sanitize_text_field',
				),
			),
		)
	);

	register_rest_route(
		SLUG . '/v1',
		'/reprint-db',
		array(
			'methods'             => 'GET',
			'permission_callback' => fn() => current_user_can( 'manage_options' ),
			'callback'            => __NAMESPACE__ . '\\rest_reprint_db',
		)
	);
}

/**
 * REST callback: stream wp-content files via FileTreeProducer.
 *
 * Returns JSON: { files: { "/wp-content/...": "<base64>" }, nextCursor: string|null }
 * Iterates at most ~768 KB of file data per request; pass nextCursor back as
 * ?cursor= to resume. nextCursor is null when the export is complete.
 *
 * File contents are base64-encoded so binary assets (images, fonts) survive
 * JSON transport. The JS layer decodes them to Uint8Array before writing to
 * the Playground filesystem.
 *
 * @param WP_REST_Request $request The REST request; reads the optional `cursor` query arg.
 */
function rest_reprint_files( WP_REST_Request $request ): WP_REST_Response|WP_Error {
	maybe_load_reprint();

	if ( ! class_exists( 'FileTreeProducer' ) ) {
		return new WP_Error( 'reprint_unavailable', 'Reprint classes not available.', array( 'status' => 503 ) );
	}

	$wp_content_dir = rtrim( WP_CONTENT_DIR, '/' );

	// realpath so the comparison survives symlinked plugin installs.
	$plugin_dir = realpath( __DIR__ );

	// Build the full path list that FileTreeProducer requires on every request.
	// Directory iteration is fast; the producer handles cursor-based positioning.
	$paths = array();
	try {
		$rdi      = new RecursiveDirectoryIterator( $wp_content_dir, RecursiveDirectoryIterator::SKIP_DOTS );
		$filtered = new RecursiveCallbackFilterIterator(
			$rdi,
			static function ( SplFileInfo $current ) use ( $plugin_dir ): bool {
				$path = $current->getRealPath();
				return $path !== $plugin_dir
					&& ! str_starts_with( $path, $plugin_dir . DIRECTORY_SEPARATOR );
			}
		);
		$rii      = new RecursiveIteratorIterator( $filtered, RecursiveIteratorIterator::SELF_FIRST );
		foreach ( $rii as $file ) {
			$paths[] = $file->getPathname();
		}
	} catch ( \UnexpectedValueException $e ) {
		return new WP_Error( 'scan_error', $e->getMessage(), array( 'status' => 500 ) );
	}

	$cursor = $request->get_param( 'cursor' );
	if ( empty( $cursor ) ) {
		$cursor = null;
	}

	$producer = new FileTreeProducer(
		$wp_content_dir,
		array(
			'paths'      => $paths,
			// Large chunk size so most WP files are single-chunk; prevents
			// splitting a file's binary data across two REST responses.
			'chunk_size' => 8 * 1024 * 1024,
			'cursor'     => $cursor,
		)
	);

	// `$pending_data` accumulates raw bytes per path for multi-chunk files;
	// `$limit_bytes` caps file data emitted per response (~768 KB).
	$files          = array();
	$pending_data   = array();
	$response_bytes = 0;
	$limit_bytes    = 768 * 1024;

	while ( $producer->next_chunk() ) {
		$chunk = $producer->get_current_chunk();
		if ( ! $chunk || $chunk['type'] !== 'file' ) {
			continue;
		}

		// Convert absolute server path → relative wp-content path.
		$rel = '/wp-content' . substr( $chunk['path'], strlen( $wp_content_dir ) );

		if ( ! isset( $pending_data[ $rel ] ) ) {
			$pending_data[ $rel ] = '';
		}
		$pending_data[ $rel ] .= $chunk['data'];

		if ( $chunk['is_last_chunk'] ) {
			// base64 is required to ship raw bytes through the JSON envelope; not obfuscation.
			$files[ $rel ]   = base64_encode( $pending_data[ $rel ] ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode
			$response_bytes += strlen( $pending_data[ $rel ] );
			unset( $pending_data[ $rel ] );

			// Stop at a file boundary once the budget is spent.
			if ( $response_bytes >= $limit_bytes ) {
				break;
			}
		}
	}

	// Determine whether there is more data to fetch.
	$cursor_data = json_decode( $producer->get_reentrancy_cursor(), true );
	$next_cursor = ( isset( $cursor_data['phase'] ) && 'finished' !== $cursor_data['phase'] )
		? $producer->get_reentrancy_cursor()
		: null;

	return new WP_REST_Response(
		array(
			'files'      => $files,
			'nextCursor' => $next_cursor,
		)
	);
}

/**
 * REST callback: generate a MySQL dump via MySQLDumpProducer.
 *
 * Returns the full SQL dump as a JSON-encoded string body (WP REST always
 * JSON-encodes the response, so the JS side parses the envelope with
 * `res.json()` to recover the raw SQL). For very large databases this may
 * be slow; cursor-based pagination can be added later if needed.
 *
 * @param WP_REST_Request $request The REST request (no parameters consumed).
 *
 * @SuppressWarnings(PHPMD.UnusedFormalParameter)
 */
function rest_reprint_db( WP_REST_Request $request ): WP_REST_Response|WP_Error { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.Found
	maybe_load_reprint();

	if ( ! class_exists( 'WordPress\\DataLiberation\\MySQLDumpProducer' ) ) {
		return new WP_Error( 'reprint_unavailable', 'Reprint classes not available.', array( 'status' => 503 ) );
	}

	try {
		// build_pdo_dsn() is provided by vendor/wp-php-toolkit/reprint-exporter/src/utils.php
		// via Composer's `files` autoload entry; unavailable to static analysers.
		if ( function_exists( 'build_pdo_dsn' ) ) {
			$dsn = build_pdo_dsn( DB_HOST, DB_NAME );
		} else {
			// Fallback: simple host:dbname DSN sufficient for most single-host setups.
			$dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4';
		}
		// MySQLDumpProducer requires a raw PDO handle — wpdb cannot be used here.
		// phpcs:ignore WordPress.DB.RestrictedClasses.mysql__PDO
		$pdo = new \PDO(
			$dsn,
			DB_USER,
			DB_PASSWORD,
			// phpcs:ignore WordPress.DB.RestrictedClasses.mysql__PDO
			array( \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION )
		);
	} catch ( \PDOException $e ) {
		return new WP_Error( 'db_connect', 'Database connection failed: ' . $e->getMessage(), array( 'status' => 500 ) );
	}

	$producer = new MySQLDumpProducer( $pdo );

	$sql = '';
	while ( $producer->next_sql_fragment() ) {
		$sql .= $producer->get_sql_fragment() . "\n";
	}

	return new WP_REST_Response( $sql, 200 );
}

add_action( 'init', __NAMESPACE__ . '\\init' );
