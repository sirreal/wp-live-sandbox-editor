<?php
/**
 * Sync manifest helpers.
 *
 * Manifest shape:
 *   {
 *     "plugins": [ "akismet/akismet.php", "hello.php" ],
 *     "themes":  [ "twentytwentyfour", "twentytwentyfour-child" ],
 *     "tables":  [ "wp_posts", "wp_options", … ],   // prefixed
 *     "uploads": false
 *   }
 *
 * - `plugins` entries are WordPress plugin entry strings (`folder/main.php`
 *   for multi-file plugins, `single.php` for single-file plugins) — same
 *   shape as `get_option('active_plugins')`.
 * - `themes` are stylesheet/template slugs.
 * - `tables` are fully prefixed table names.
 * - `uploads` toggles syncing of `wp-content/uploads`. Default false; media
 *   URLs are rewritten to point back at the host site post-import.
 *
 * @package LiveSandboxEditor
 */

namespace Live_Sandbox_Editor\Manifest;

/**
 * Default manifest: active plugins, active theme + parent, structural (core
 * WP) tables, no uploads.
 *
 * @return array{plugins:array<string>,themes:array<string>,tables:array<string>,uploads:bool}
 */
function defaults(): array {
	return array(
		'plugins' => default_active_plugins(),
		'themes'  => default_active_themes(),
		'tables'  => default_structural_tables(),
		'uploads' => false,
	);
}

/**
 * Active plugin entries. On multisite, includes network-active plugins.
 * Self plugin (live-sandbox-editor) is always excluded — we don't want
 * the sandbox to load the editor that booted it.
 *
 * @return array<string>
 */
function default_active_plugins(): array {
	$active = (array) get_option( 'active_plugins', array() );
	if ( is_multisite() ) {
		$network = (array) get_site_option( 'active_sitewide_plugins', array() );
		$active  = array_merge( $active, array_keys( $network ) );
	}
	$active = array_values(
		array_unique(
			array_filter(
				$active,
				static fn( $entry ) => is_string( $entry ) && '' !== $entry && ! is_self_plugin_entry( $entry )
			)
		)
	);
	return $active;
}

/**
 * Active stylesheet plus its template, if different. Both are returned so
 * a child theme + its parent are synced together by default.
 *
 * @return array<string>
 */
function default_active_themes(): array {
	$slugs      = array();
	$stylesheet = (string) get_stylesheet();
	$template   = (string) get_template();
	if ( '' !== $stylesheet ) {
		$slugs[] = $stylesheet;
	}
	if ( '' !== $template && $template !== $stylesheet ) {
		$slugs[] = $template;
	}
	return $slugs;
}

/**
 * Core WordPress tables (prefixed). Plugin/custom tables are excluded.
 *
 * @return array<string>
 */
function default_structural_tables(): array {
	global $wpdb;
	$blog   = (array) $wpdb->tables( 'blog', true );
	$global = is_multisite() ? (array) $wpdb->tables( 'global', true ) : array();
	return array_values( array_unique( array_merge( array_values( $blog ), array_values( $global ) ) ) );
}

/**
 * Coerce a decoded JSON manifest into the canonical shape used by the
 * sync endpoints. Drops unknown keys, validates types, and falls back
 * to empty arrays / `false` for malformed input.
 *
 * @param mixed $raw Decoded JSON manifest (or null/array from request).
 * @return array{plugins:array<string>,themes:array<string>,tables:array<string>,uploads:bool}
 */
function normalize( $raw ): array {
	if ( ! is_array( $raw ) ) {
		return array(
			'plugins' => array(),
			'themes'  => array(),
			'tables'  => array(),
			'uploads' => false,
		);
	}

	$plugins = array();
	if ( isset( $raw['plugins'] ) && is_array( $raw['plugins'] ) ) {
		foreach ( $raw['plugins'] as $entry ) {
			if ( is_string( $entry ) && '' !== $entry && ! is_self_plugin_entry( $entry ) ) {
				$plugins[] = $entry;
			}
		}
	}

	$themes = array();
	if ( isset( $raw['themes'] ) && is_array( $raw['themes'] ) ) {
		foreach ( $raw['themes'] as $slug ) {
			if ( is_string( $slug ) && '' !== $slug ) {
				$themes[] = $slug;
			}
		}
	}

	$tables = array();
	if ( isset( $raw['tables'] ) && is_array( $raw['tables'] ) ) {
		global $wpdb;
		$prefix = (string) $wpdb->prefix;
		$base_p = (string) $wpdb->base_prefix;
		foreach ( $raw['tables'] as $name ) {
			if ( ! is_string( $name ) || '' === $name ) {
				continue;
			}
			// Defence in depth: only allow safe table-name characters and
			// require the configured prefix so we never dump arbitrary tables.
			if ( ! preg_match( '/^[A-Za-z0-9_]+$/', $name ) ) {
				continue;
			}
			if ( ! str_starts_with( $name, $prefix ) && ! str_starts_with( $name, $base_p ) ) {
				continue;
			}
			$tables[] = $name;
		}
	}

	$uploads = ! empty( $raw['uploads'] );

	return array(
		'plugins' => array_values( array_unique( $plugins ) ),
		'themes'  => array_values( array_unique( $themes ) ),
		'tables'  => array_values( array_unique( $tables ) ),
		'uploads' => $uploads,
	);
}

/**
 * Resolve a plugin entry to absolute host paths plus a logical
 * Playground-relative path for each file. Handles single-file plugins.
 *
 * Returned tuples:
 *   [ host_abs_path, logical_path ]  where logical_path begins '/wp-content/plugins/...'
 *
 * @param string $entry Plugin entry (folder/main.php or single.php).
 * @return array<int,array{0:string,1:string}>
 */
function plugin_paths( string $entry ): array {
	$plugin_dir   = rtrim( WP_PLUGIN_DIR, '/' );
	$logical_root = '/wp-content/plugins';

	if ( str_contains( $entry, '/' ) ) {
		$slug         = explode( '/', $entry, 2 )[0];
		$host_root    = $plugin_dir . '/' . $slug;
		$logical_base = $logical_root . '/' . $slug;
		return collect_files( $host_root, $logical_base );
	}

	// Single-file plugin lives directly in the plugins dir.
	$host_path = $plugin_dir . '/' . $entry;
	if ( ! is_file( $host_path ) ) {
		return array();
	}
	return array( array( $host_path, $logical_root . '/' . $entry ) );
}

/**
 * Resolve a theme slug to its host directory and logical Playground path.
 * Uses get_theme_root() so registered alternate theme roots work.
 *
 * @param string $slug Theme slug.
 * @return array<int,array{0:string,1:string}>
 */
function theme_paths( string $slug ): array {
	$theme_root = (string) get_theme_root( $slug );
	if ( '' === $theme_root ) {
		return array();
	}
	$host_root    = rtrim( $theme_root, '/' ) . '/' . $slug;
	$logical_base = '/wp-content/themes/' . $slug;
	return collect_files( $host_root, $logical_base );
}

/**
 * Resolve uploads dir.
 *
 * @return array<int,array{0:string,1:string}>
 */
function uploads_paths(): array {
	$dirs = wp_upload_dir( null, false );
	if ( empty( $dirs['basedir'] ) ) {
		return array();
	}
	return collect_files( rtrim( $dirs['basedir'], '/' ), '/wp-content/uploads' );
}

/**
 * Walk a directory and return [host_abs, logical] tuples for every regular
 * file, skipping the self-plugin directory anywhere in the tree.
 *
 * @param string $host_root    Absolute host path to walk.
 * @param string $logical_base Logical path prefix used in the wire stream.
 * @return array<int,array{0:string,1:string}>
 */
function collect_files( string $host_root, string $logical_base ): array {
	if ( ! is_dir( $host_root ) ) {
		return array();
	}
	$self_plugin = self_plugin_dir();
	$out         = array();
	try {
		$rdi      = new \RecursiveDirectoryIterator(
			$host_root,
			\RecursiveDirectoryIterator::SKIP_DOTS | \FilesystemIterator::CURRENT_AS_FILEINFO
		);
		$filtered = new \RecursiveCallbackFilterIterator(
			$rdi,
			static function ( \SplFileInfo $current ) use ( $self_plugin ): bool {
				if ( null === $self_plugin ) {
					return true;
				}
				$real = $current->getRealPath();
				if ( false === $real ) {
					return true;
				}
				return $real !== $self_plugin
					&& ! str_starts_with( $real, $self_plugin . DIRECTORY_SEPARATOR );
			}
		);
		$rii      = new \RecursiveIteratorIterator( $filtered, \RecursiveIteratorIterator::SELF_FIRST );
		$root_len = strlen( $host_root );
		foreach ( $rii as $file ) {
			if ( ! $file->isFile() ) {
				continue;
			}
			$abs     = $file->getPathname();
			$rel     = substr( $abs, $root_len );
			$logical = $logical_base . str_replace( DIRECTORY_SEPARATOR, '/', $rel );
			$out[]   = array( $abs, $logical );
		}
	} catch ( \UnexpectedValueException $e ) {
		// Unreadable directory — silently skip; the stream still finishes.
		return $out;
	}
	return $out;
}

/**
 * Absolute path of this plugin's own directory, or null if it cannot be
 * resolved. Used to keep the editor itself out of synced filesets.
 */
function self_plugin_dir(): ?string {
	$dir = realpath( dirname( __DIR__ ) );
	return false === $dir ? null : $dir;
}

/**
 * Match $entry against this plugin's main file by postfix.
 *
 * Directory names aren't stable across installs (users may rename or
 * symlink), so the comparison anchors on the main filename.
 *
 * @param string $entry Plugin entry as stored in `active_plugins`.
 * @return bool
 */
function is_self_plugin_entry( string $entry ): bool {
	return str_ends_with( $entry, '/live-sandbox-editor.php' )
		|| 'live-sandbox-editor.php' === $entry;
}

/**
 * Decode the manifest from a REST request — supports both a `manifest`
 * JSON string param and a raw JSON body.
 *
 * @param \WP_REST_Request $request Request.
 * @return array{plugins:array<string>,themes:array<string>,tables:array<string>,uploads:bool}
 */
function from_request( \WP_REST_Request $request ): array {
	$param = $request->get_param( 'manifest' );
	if ( is_string( $param ) && '' !== $param ) {
		$decoded = json_decode( $param, true );
		if ( is_array( $decoded ) ) {
			return normalize( $decoded );
		}
	}
	$body = $request->get_json_params();
	if ( is_array( $body ) ) {
		return normalize( $body );
	}
	return normalize( null );
}
