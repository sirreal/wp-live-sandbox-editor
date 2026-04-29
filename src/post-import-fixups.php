<?php
/**
 * Post-import fixup library.
 *
 * Bundled into the JS entry as a raw string (`?raw` import), then
 * `client.writeFile()`'d to `/tmp/lse-fixups.php` inside Playground at
 * the start of `applyPostImportFixups`. Each subsequent `client.run()`
 * `require_once`'s it. This file is **never** loaded by the host
 * WordPress that ships this plugin — keep it self-contained.
 *
 * Each `lse_*` symbol is wrapped in `function_exists()` so the file is
 * safe to `require_once` from any number of fresh PHP requests within
 * one Playground session without `Cannot redeclare` fatals.
 *
 * @package Live_Sandbox_Editor
 */

if ( ! function_exists( 'lse_replace_string' ) ) {
	/**
	 * Replace $host with $playground in $s, leaving substrings of any URL
	 * that begins with $uploads_url untouched (sentinel-protected swap).
	 *
	 * @param string $s           Source string.
	 * @param string $host        Host site URL to replace.
	 * @param string $playground  Playground URL to substitute in.
	 * @param string $uploads_url Uploads base URL whose contents must not be rewritten.
	 * @return string
	 */
	function lse_replace_string( $s, $host, $playground, $uploads_url ) {
		if ( $host === $playground ) {
			return $s;
		}
		$sentinel    = "\x00LSE_UPLOADS\x00";
		$has_uploads = ( '' !== $uploads_url ) && ( false !== strpos( $s, $uploads_url ) );
		if ( $has_uploads ) {
			$s = str_replace( $uploads_url, $sentinel, $s );
		}
		if ( false !== strpos( $s, $host ) ) {
			$s = str_replace( $host, $playground, $s );
		}
		if ( $has_uploads ) {
			$s = str_replace( $sentinel, $uploads_url, $s );
		}
		return $s;
	}
}

if ( ! function_exists( 'lse_replace_in_value' ) ) {
	/**
	 * Recursively replace $host with $playground in every string inside
	 * $data, except where the string lies inside a URL that begins with
	 * $uploads_url. Handles PHP-serialized values by inflating, recursing,
	 * and reserializing.
	 *
	 * `unserialize` is called with `allowed_classes => ['stdClass']`.
	 * Three reasons stacked together:
	 *   1. POI defense — refuse to instantiate arbitrary classes from
	 *      possibly-tampered DB content; gadget chains in `__wakeup` /
	 *      `__destruct` cannot fire (stdClass has no magic methods).
	 *   2. Sandbox correctness — the imported DB came from a host where
	 *      arbitrary plugins may have stored their own classes in
	 *      options/postmeta. Those classes don't exist in Playground's
	 *      WP install; the allowlist turns them into
	 *      `__PHP_Incomplete_Class` predictably instead of emitting
	 *      warnings.
	 *   3. stdClass is the common case in WP core and many plugins
	 *      (widget options, theme_mods entries, etc.). Allowing it lets
	 *      the rewrite recurse into the actual properties, rather than
	 *      bailing on every serialized object.
	 *
	 * `__PHP_Incomplete_Class` instances are walked read-only and
	 * returned untouched — PHP forbids property assignment on them and
	 * a write would trigger a fatal. Strings inside such objects stay
	 * as-is; in practice these come from custom plugin classes that
	 * rarely store host URLs.
	 *
	 * The `$visited` `SplObjectStorage` threads through recursion to
	 * break cycles in object graphs. Stock WP core data has none, but
	 * custom plugin objects stored in options/postmeta have been
	 * observed to hold back-references to themselves or to parent
	 * objects, and PHP's call stack is the only thing stopping us
	 * otherwise.
	 *
	 * @param mixed                 $data        Value to walk.
	 * @param string                $host        Host site URL.
	 * @param string                $playground  Playground URL.
	 * @param string                $uploads_url Uploads base URL to preserve.
	 * @param SplObjectStorage|null $visited     Object cycle tracker (internal).
	 * @return mixed
	 */
	function lse_replace_in_value( $data, $host, $playground, $uploads_url, $visited = null ) {
		if ( null === $visited ) {
			$visited = new SplObjectStorage();
		}
		if ( is_string( $data ) ) {
			if ( '' === $data ) {
				return $data;
			}
			if ( is_serialized( $data ) ) {
				// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.PHP.DiscouragedPHPFunctions.serialize_unserialize -- intentional: see allowed_classes rationale in docblock above.
				$unser = @unserialize( $data, array( 'allowed_classes' => array( 'stdClass' ) ) );
				// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.serialize_serialize -- mirrors the unserialize above; values are reserialized to preserve the on-disk shape.
				if ( false !== $unser || serialize( false ) === $data ) {
					$replaced = lse_replace_in_value( $unser, $host, $playground, $uploads_url, $visited );
					// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.serialize_serialize -- see comment above.
					return serialize( $replaced );
				}
				// `is_serialized()` matched the shape but `unserialize()`
				// rejected the payload — the value is structurally corrupt
				// (truncated, hand-edited, encoding-mangled, etc.). A naive
				// `str_replace` would desync the embedded `s:N:` byte
				// counts and produce a value that no PHP code downstream
				// can ever reload. Pass it through untouched so the
				// corruption stays exactly as imported, and let whatever
				// owns that row decide what to do with it.
				return $data;
			}
			return lse_replace_string( $data, $host, $playground, $uploads_url );
		}
		if ( is_array( $data ) ) {
			foreach ( $data as $k => $v ) {
				$data[ $k ] = lse_replace_in_value( $v, $host, $playground, $uploads_url, $visited );
			}
			return $data;
		}
		if ( is_object( $data ) ) {
			if ( $data instanceof \Closure ) {
				return $data;
			}
			// Property assignment on `__PHP_Incomplete_Class` is a fatal
			// — see the function's docblock for why instances reach us
			// at all and why pass-through is the right behaviour.
			if ( $data instanceof \__PHP_Incomplete_Class ) {
				return $data;
			}
			if ( $visited->contains( $data ) ) {
				return $data;
			}
			$visited->attach( $data );
			foreach ( get_object_vars( $data ) as $k => $v ) {
				$data->$k = lse_replace_in_value( $v, $host, $playground, $uploads_url, $visited );
			}
			return $data;
		}
		return $data;
	}
}

if ( ! defined( 'LSE_REWRITE_BATCH_SIZE' ) ) {
	define( 'LSE_REWRITE_BATCH_SIZE', 2000 );
}

if ( ! function_exists( 'lse_rewrite_all_urls' ) ) {
	/**
	 * Sweep every host-URL occurrence across the standard WP tables and
	 * rewrite it to the Playground URL, preserving substrings of any URL
	 * that begins with `$uploads_url`. Designed to run in a single
	 * Playground PHP request: WordPress is bootstrapped once by the
	 * caller, and this function loops every target table internally,
	 * keyset-paginated in `$batch_size` chunks for memory hygiene (so
	 * `$wpdb->get_results` never has to materialize an entire large
	 * table at once).
	 *
	 * **Caller contract:** the target list is built here from
	 * `$wpdb->prefix` plus a hardcoded set of core tables/columns. The
	 * identifiers are interpolated into SQL (they cannot be passed
	 * through `$wpdb->prepare()`, which only parameterizes values). The
	 * allowlist is intentionally local to this function — do not extend
	 * it with caller-supplied table or column names without re-auditing
	 * the suppression below.
	 *
	 * @param string $host        Host site URL.
	 * @param string $playground  Playground URL.
	 * @param string $uploads_url Uploads base URL to preserve.
	 * @param int    $batch_size  Rows per SELECT (memory bound, not a request bound).
	 * @return array{scanned:int,updated:int}
	 */
	function lse_rewrite_all_urls( $host, $playground, $uploads_url, $batch_size = LSE_REWRITE_BATCH_SIZE ) {
		global $wpdb;
		if ( $host === $playground ) {
			return array(
				'scanned' => 0,
				'updated' => 0,
			);
		}

		$prefix  = $wpdb->prefix;
		$targets = array(
			array(
				'table' => $prefix . 'options',
				'pk'    => 'option_id',
				'cols'  => array( 'option_value' ),
			),
			array(
				'table' => $prefix . 'postmeta',
				'pk'    => 'meta_id',
				'cols'  => array( 'meta_value' ),
			),
			array(
				'table' => $prefix . 'usermeta',
				'pk'    => 'umeta_id',
				'cols'  => array( 'meta_value' ),
			),
			array(
				'table' => $prefix . 'termmeta',
				'pk'    => 'meta_id',
				'cols'  => array( 'meta_value' ),
			),
			array(
				'table' => $prefix . 'commentmeta',
				'pk'    => 'meta_id',
				'cols'  => array( 'meta_value' ),
			),
			array(
				'table' => $prefix . 'posts',
				'pk'    => 'ID',
				'cols'  => array( 'post_content', 'post_excerpt', 'post_title', 'guid' ),
			),
			array(
				'table' => $prefix . 'comments',
				'pk'    => 'comment_ID',
				'cols'  => array( 'comment_content' ),
			),
			array(
				'table' => $prefix . 'links',
				'pk'    => 'link_id',
				'cols'  => array( 'link_url', 'link_image' ),
			),
		);

		$existing      = lse_existing_tables();
		$total_scanned = 0;
		$total_updated = 0;

		foreach ( $targets as $t ) {
			$table = $t['table'];
			if ( empty( $existing[ $table ] ) ) {
				continue;
			}
			$pk       = $t['pk'];
			$cols     = $t['cols'];
			$cols_sql = '`' . implode( '`, `', $cols ) . '`';
			$last_pk  = 0;
			while ( true ) {
				// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- $table/$pk/$cols are SQL identifiers; $wpdb->prepare() can only parameterize values, not identifiers. Per the caller contract documented above, every entry comes from the local hardcoded allowlist built above from $wpdb->prefix plus literal core column names. If a future change accepts caller-supplied identifiers here, this suppression hides a real injection — re-audit before relaxing the allowlist.
				$rows = $wpdb->get_results(
					$wpdb->prepare(
						"SELECT `{$pk}`, {$cols_sql} FROM `{$table}` WHERE `{$pk}` > %d ORDER BY `{$pk}` ASC LIMIT %d",
						$last_pk,
						$batch_size
					),
					ARRAY_A
				);
				// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				if ( ! $rows ) {
					break;
				}
				foreach ( $rows as $row ) {
					$last_pk = (int) $row[ $pk ];
					$updates = array();
					foreach ( $cols as $col ) {
						$orig = $row[ $col ];
						if ( ! is_string( $orig ) || '' === $orig ) {
							continue;
						}
						$new = lse_replace_in_value( $orig, $host, $playground, $uploads_url );
						if ( $new !== $orig ) {
							$updates[ $col ] = $new;
						}
					}
					if ( $updates ) {
						$wpdb->update( $table, $updates, array( $pk => $last_pk ) );
						++$total_updated;
					}
				}
				$total_scanned += count( $rows );
				if ( count( $rows ) < $batch_size ) {
					break;
				}
			}
		}

		return array(
			'scanned' => $total_scanned,
			'updated' => $total_updated,
		);
	}
}

if ( ! function_exists( 'lse_existing_tables' ) ) {
	/**
	 * Return a `[table_name => true]` map for every table in the current
	 * MySQL/SQLite database. Caller intersects with its target list —
	 * one round-trip beats `SHOW TABLES LIKE %s` per target.
	 */
	function lse_existing_tables() {
		global $wpdb;
		$rows = $wpdb->get_col( 'SHOW TABLES' );
		return array_fill_keys( (array) $rows, true );
	}
}

if ( ! function_exists( 'lse_deactivate_self' ) ) {
	/**
	 * Match by main-file postfix — the WP plugin dir name isn't stable
	 * (users may rename or symlink the plugin directory).
	 */
	function lse_deactivate_self() {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
		$active   = (array) get_option( 'active_plugins', array() );
		$sitewide = is_multisite()
			? array_keys( (array) get_site_option( 'active_sitewide_plugins', array() ) )
			: array();
		$entries  = array_filter(
			array_unique( array_merge( $active, $sitewide ) ),
			static function ( $entry ) {
				return str_ends_with( $entry, '/live-sandbox-editor.php' );
			}
		);
		if ( $entries ) {
			deactivate_plugins( array_values( $entries ), true );
		}
	}
}
