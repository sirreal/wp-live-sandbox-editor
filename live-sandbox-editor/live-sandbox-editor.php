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
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use WP_REST_Request;
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
		asset_version( 'build/main.js' )
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

	wp_enqueue_style(
		SLUG,
		plugins_url( 'style.css', __FILE__ ),
		array(),
		asset_version( 'style.css' )
	);
	wp_enqueue_style(
		SLUG . '-monaco',
		plugins_url( 'build/monaco.css', __FILE__ ),
		array(),
		asset_version( 'build/monaco.css' )
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
	esc_html_e( 'Live Sandbox Editor: Reprint classes could not be loaded. Run composer install in the project root directory.', 'live-sandbox-editor' );
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
 * Prepare a streaming NDJSON response: drop output buffers, disable
 * compression/buffering middleware, send the header set, and return.
 *
 * Caller is responsible for echoing one JSON object per line (terminated
 * with "\n"), calling flush() after each, and exiting before the WP REST
 * dispatcher tries to wrap a return value.
 */
function stream_ndjson_setup(): void {
	while ( ob_get_level() > 0 ) {
		ob_end_clean();
	}
	@ini_set( 'zlib.output_compression', '0' ); // phpcs:ignore WordPress.PHP.IniSet.Risky
	if ( function_exists( 'apache_setenv' ) ) {
		@apache_setenv( 'no-gzip', '1' );
	}
	// Streaming a full wp-content / DB dump comfortably exceeds the default
	// 30s max_execution_time. Disable it for this request and call
	// set_time_limit() again periodically inside the loop in case the host
	// silently re-imposes a per-iteration timer.
	@set_time_limit( 0 );
	// Keep producing data even if the browser tab closes — half-written files
	// in Playground are useless, so we'd rather finish the stream.
	ignore_user_abort( true );
	if ( function_exists( 'session_write_close' ) ) {
		@session_write_close();
	}
	nocache_headers();
	header( 'Content-Type: application/x-ndjson; charset=utf-8' );
	header( 'Cache-Control: no-cache, no-store, no-transform, must-revalidate' );
	header( 'Pragma: no-cache' );
	// nginx: opt this response out of proxy_buffering.
	header( 'X-Accel-Buffering: no' );
	// Defeat compression middleware that otherwise buffers entire body.
	header( 'Content-Encoding: identity' );
	header( 'X-Content-Type-Options: nosniff' );
	// Deliberately no Content-Length — its absence forces chunked transfer.
}

/**
 * Emit a single NDJSON record and flush.
 *
 * @param array $record Record payload — JSON-encoded as one line.
 */
function stream_ndjson_emit( array $record ): void {
	echo wp_json_encode( $record ), "\n";
	flush();
}

/**
 * REST callback: stream wp-content files as NDJSON.
 *
 * Each line is one chunk of one file:
 *   { "t":"f", "path":"/wp-content/…", "b64":"…", "seq":N, "final":bool }
 *
 * The handler bypasses WP_REST_Response and exits directly so the body is
 * streamed without WP's JSON-envelope buffering. PHP peak memory stays
 * bounded by chunk size (no per-file accumulation, no response array).
 *
 * @SuppressWarnings(PHPMD.UnusedFormalParameter)
 */
function rest_reprint_files( WP_REST_Request $request ): void { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.Found
	maybe_load_reprint();

	if ( ! class_exists( 'FileTreeProducer' ) ) {
		stream_ndjson_setup();
		stream_ndjson_emit( array( 't' => 'err', 'message' => 'Reprint classes not available.' ) );
		exit;
	}

	$wp_content_dir = rtrim( WP_CONTENT_DIR, '/' );

	$paths = array();
	try {
		$rdi = new RecursiveDirectoryIterator( $wp_content_dir, RecursiveDirectoryIterator::SKIP_DOTS );
		$rii = new RecursiveIteratorIterator( $rdi, RecursiveIteratorIterator::SELF_FIRST );
		foreach ( $rii as $file ) {
			$paths[] = $file->getPathname();
		}
	} catch ( \UnexpectedValueException $e ) {
		stream_ndjson_setup();
		stream_ndjson_emit( array( 't' => 'err', 'message' => 'scan_error: ' . $e->getMessage() ) );
		exit;
	}

	stream_ndjson_setup();

	// Small chunks keep PHP peak memory bounded regardless of file size; the
	// underlying FileTreeProducer reads files in $chunk_size pieces.
	$producer = new FileTreeProducer(
		$wp_content_dir,
		array(
			'paths'      => $paths,
			'chunk_size' => 256 * 1024,
		)
	);

	$content_prefix_len = strlen( $wp_content_dir );
	$emitted            = 0;

	try {
		while ( $producer->next_chunk() ) {
			$chunk = $producer->get_current_chunk();
			if ( ! $chunk || $chunk['type'] !== 'file' ) {
				continue;
			}

			$rel = '/wp-content' . substr( $chunk['path'], $content_prefix_len );

			stream_ndjson_emit(
				array(
					't'     => 'f',
					'path'  => $rel,
					'b64'   => base64_encode( $chunk['data'] ), // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode
					'seq'   => (int) ( $chunk['offset'] ?? 0 ),
					'final' => (bool) ( $chunk['is_last_chunk'] ?? false ),
				)
			);

			// Reset the wall-clock budget every so often: some hosts reapply
			// max_execution_time after each request hook even when we set 0
			// up front, and the loop can run for minutes on big sites.
			if ( ( ++$emitted % 64 ) === 0 ) {
				@set_time_limit( 0 );
				if ( connection_aborted() ) {
					exit;
				}
			}
		}
	} catch ( \Throwable $e ) {
		stream_ndjson_emit( array( 't' => 'err', 'message' => $e->getMessage() ) );
		exit;
	}

	stream_ndjson_emit( array( 't' => 'end' ) );
	exit;
}

/**
 * REST callback: stream a MySQL dump as NDJSON.
 *
 * Each line is one SQL fragment from MySQLDumpProducer:
 *   { "t":"sql", "b64":"…" }
 *
 * Fragments are base64-encoded so embedded newlines/binary bytes don't
 * break NDJSON line framing. PHP peak memory stays bounded by the
 * largest single fragment (~max_allowed_packet).
 *
 * @SuppressWarnings(PHPMD.UnusedFormalParameter)
 */
function rest_reprint_db( WP_REST_Request $request ): void { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.Found
	maybe_load_reprint();

	if ( ! class_exists( 'WordPress\\DataLiberation\\MySQLDumpProducer' ) ) {
		stream_ndjson_setup();
		stream_ndjson_emit( array( 't' => 'err', 'message' => 'Reprint classes not available.' ) );
		exit;
	}

	try {
		// build_pdo_dsn() is provided by vendor/wp-php-toolkit/reprint-exporter/src/utils.php
		// via Composer's `files` autoload entry; unavailable to static analysers.
		if ( function_exists( 'build_pdo_dsn' ) ) {
			$dsn = build_pdo_dsn( DB_HOST, DB_NAME );
		} else {
			$dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4';
		}
		// phpcs:ignore WordPress.DB.RestrictedClasses.mysql__PDO
		$pdo = new \PDO(
			$dsn,
			DB_USER,
			DB_PASSWORD,
			// phpcs:ignore WordPress.DB.RestrictedClasses.mysql__PDO
			array( \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION )
		);
	} catch ( \PDOException $e ) {
		stream_ndjson_setup();
		stream_ndjson_emit( array( 't' => 'err', 'message' => 'db_connect: ' . $e->getMessage() ) );
		exit;
	}

	stream_ndjson_setup();

	$producer = new MySQLDumpProducer( $pdo );
	$emitted  = 0;

	try {
		while ( $producer->next_sql_fragment() ) {
			$fragment = $producer->get_sql_fragment();
			if ( null === $fragment ) {
				continue;
			}
			stream_ndjson_emit(
				array(
					't'   => 'sql',
					'b64' => base64_encode( $fragment . "\n" ), // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode
				)
			);

			if ( ( ++$emitted % 64 ) === 0 ) {
				@set_time_limit( 0 );
				if ( connection_aborted() ) {
					exit;
				}
			}
		}
	} catch ( \Throwable $e ) {
		stream_ndjson_emit( array( 't' => 'err', 'message' => $e->getMessage() ) );
		exit;
	}

	stream_ndjson_emit( array( 't' => 'end' ) );
	exit;
}

add_action( 'init', __NAMESPACE__ . '\\init' );
