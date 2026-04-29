<?php
/**
 * Live Sandbox Editor — uploads URL passthrough.
 *
 * Auto-installed by the editor when a DB sync ran without an uploads
 * sync. Imported attachments don't have their files in the local
 * filesystem, so every runtime-generated upload URL is redirected back
 * at the host where the file actually lives. Files uploaded inside the
 * sandbox after the sync stay on playground URLs because the upload's
 * URL is appended to a skip list at attachment-meta time.
 *
 * Skip list lives in the `lse_uploads_passthrough_skip_urls` option
 * (array of URL prefixes). Hook the `lse_uploads_passthrough_skip_urls`
 * filter to extend it at runtime — e.g. once partial media sync lands,
 * the host plugin can append the synced subset.
 *
 * `LSE_PASSTHROUGH_HOST_UPLOADS_URL` is templated in by the editor at
 * install time (placeholder is rejected by the guard below if the
 * substitution somehow didn't happen).
 *
 * @package Live_Sandbox_Editor
 */

const LSE_PASSTHROUGH_HOST_UPLOADS_URL = '__LSE_HOST_UPLOADS_URL__';
const LSE_PASSTHROUGH_OPTION           = 'lse_uploads_passthrough_skip_urls';

if ( str_starts_with( LSE_PASSTHROUGH_HOST_UPLOADS_URL, '__LSE_' ) ) {
	return;
}

/**
 * Resolve the active skip list: option value extended by the
 * `lse_uploads_passthrough_skip_urls` filter, then validated.
 *
 * Memoized within a request since image-heavy pages call this dozens
 * of times via the srcset filter. `lse_passthrough_record_upload`
 * resets the cache when it appends a new URL so within-request writes
 * are visible to subsequent reads.
 *
 * @param bool $reset Internal — pass true from the recorder to invalidate.
 * @return array<int,string>
 */
function lse_passthrough_skip_list( bool $reset = false ): array {
	static $cache = null;
	if ( $reset ) {
		$cache = null;
		return array();
	}
	if ( null !== $cache ) {
		return $cache;
	}
	$stored = get_option( LSE_PASSTHROUGH_OPTION, array() );
	if ( ! is_array( $stored ) ) {
		$stored = array();
	}
	$list  = (array) apply_filters( LSE_PASSTHROUGH_OPTION, $stored );
	$cache = array_values(
		array_filter(
			$list,
			static fn( $v ) => is_string( $v ) && '' !== $v
		)
	);
	return $cache;
}

/**
 * Test whether $url should be left alone (kept on playground origin).
 *
 * Linear scan over the skip list. Acceptable for v1 — the list grows
 * by one entry per in-sandbox upload and a typical session adds a
 * handful at most. If real-world usage ever pushes the list past a few
 * hundred entries, swap the array for a hash lookup keyed by URL prefix.
 *
 * @param string $url Candidate URL.
 * @return bool
 */
function lse_passthrough_is_skipped( string $url ): bool {
	foreach ( lse_passthrough_skip_list() as $prefix ) {
		if ( str_starts_with( $url, $prefix ) ) {
			return true;
		}
	}
	return false;
}

/**
 * Replace the playground uploads baseurl in $url with the host's.
 *
 * `wp_get_upload_dir()` re-applies the `upload_dir` filter chain on
 * every call; the baseurl is cached per request so srcset rendering
 * doesn't re-fire the chain once per source entry.
 *
 * @param string $url URL produced by WP using the playground baseurl.
 * @return string $url unchanged if it's not under the playground baseurl,
 *                otherwise the same path with the host baseurl swapped in.
 */
function lse_passthrough_swap_to_host( string $url ): string {
	static $baseurl = null;
	if ( null === $baseurl ) {
		$upload_dir = wp_get_upload_dir();
		$baseurl    = ( ! empty( $upload_dir['baseurl'] ) && is_string( $upload_dir['baseurl'] ) )
			? $upload_dir['baseurl']
			: '';
	}
	if ( '' === $baseurl ) {
		return $url;
	}
	if ( ! str_starts_with( $url, $baseurl ) ) {
		return $url;
	}
	return LSE_PASSTHROUGH_HOST_UPLOADS_URL . substr( $url, strlen( $baseurl ) );
}

add_filter(
	'wp_get_attachment_url',
	static function ( $url ) {
		if ( ! is_string( $url ) || '' === $url ) {
			return $url;
		}
		if ( lse_passthrough_is_skipped( $url ) ) {
			return $url;
		}
		return lse_passthrough_swap_to_host( $url );
	},
	PHP_INT_MAX
);

add_filter(
	'wp_calculate_image_srcset',
	static function ( $sources ) {
		if ( ! is_array( $sources ) ) {
			return $sources;
		}
		foreach ( $sources as &$source ) {
			if ( ! is_array( $source ) || ! isset( $source['url'] ) || ! is_string( $source['url'] ) ) {
				continue;
			}
			if ( lse_passthrough_is_skipped( $source['url'] ) ) {
				continue;
			}
			$source['url'] = lse_passthrough_swap_to_host( $source['url'] );
		}
		unset( $source );
		return $sources;
	},
	PHP_INT_MAX
);

/**
 * Persist newly uploaded media into the skip list. Hooks both
 * `added_post_meta` and `updated_post_meta` because `update_attached_file()`
 * routes through `update_post_meta()`, which fires one or the other
 * depending on whether the meta row already existed.
 *
 * The DB import phase doesn't fire either hook — it writes rows via raw
 * `$wpdb->update()`/`$wpdb->query()` and bypasses the metadata API
 * entirely. The skip list therefore only accumulates entries for
 * attachments created post-import.
 *
 * @param int    $meta_id    Unused — passed by the action signature.
 * @param int    $post_id    Unused.
 * @param string $meta_key   Postmeta key being written.
 * @param mixed  $meta_value New value.
 */
function lse_passthrough_record_upload( $meta_id, $post_id, $meta_key, $meta_value ): void {
	if ( '_wp_attached_file' !== $meta_key ) {
		return;
	}
	if ( ! is_string( $meta_value ) || '' === $meta_value ) {
		return;
	}
	$upload_dir = wp_get_upload_dir();
	if ( empty( $upload_dir['baseurl'] ) || ! is_string( $upload_dir['baseurl'] ) ) {
		return;
	}
	$url    = rtrim( $upload_dir['baseurl'], '/' ) . '/' . ltrim( $meta_value, '/' );
	$stored = get_option( LSE_PASSTHROUGH_OPTION, array() );
	if ( ! is_array( $stored ) ) {
		$stored = array();
	}
	if ( in_array( $url, $stored, true ) ) {
		return;
	}
	$stored[] = $url;
	update_option( LSE_PASSTHROUGH_OPTION, $stored, false );
	lse_passthrough_skip_list( true );
}
add_action( 'added_post_meta', 'lse_passthrough_record_upload', 10, 4 );
add_action( 'updated_post_meta', 'lse_passthrough_record_upload', 10, 4 );
