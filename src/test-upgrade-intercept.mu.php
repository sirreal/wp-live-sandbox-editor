<?php
/**
 * Live Sandbox Editor — intercept api.wordpress.org update-check HTTP calls.
 *
 * The test-upgrade flow (see src/test-upgrade.ts) writes a host-resolved
 * payload into the `lse_test_upgrade_payload` option just before the listing
 * page is fetched. This mu-plugin reads that option and short-circuits the
 * outbound update-check request with a synthetic response, so WordPress's
 * normal `wp_update_{plugins,themes}()` path populates the right transient
 * — even when the outbound .org call would otherwise return empty (as
 * observed for the themes endpoint inside Playground).
 *
 * Once the on-disk version catches up to the payload's `new_version`, the
 * synthetic entry is routed to the `no_update` bucket so the upgrade notice
 * stops flashing after a successful test run.
 *
 * @package Live_Sandbox_Editor
 */

/**
 * Short-circuit api.wordpress.org plugins/themes update-check requests with
 * a synthetic response built from the `lse_test_upgrade_payload` option.
 *
 * @param false|array|WP_Error $pre  Filter short-circuit value.
 * @param array                $args HTTP args (unused).
 * @param string|mixed         $url  Request URL.
 *
 * @return false|array|WP_Error Synthetic response on match, original $pre otherwise.
 */
function lse_test_upgrade_intercept( $pre, $args, $url ) {
	if ( ! is_string( $url ) ) {
		return $pre;
	}
	$is_themes  = false !== strpos( $url, 'api.wordpress.org/themes/update-check' );
	$is_plugins = false !== strpos( $url, 'api.wordpress.org/plugins/update-check' );
	if ( ! $is_themes && ! $is_plugins ) {
		return $pre;
	}

	$payload = get_option( 'lse_test_upgrade_payload', null );
	if ( ! is_array( $payload ) || empty( $payload['kind'] ) ) {
		return $pre;
	}

	$body = array(
		'plugins'      => (object) array(),
		'themes'       => (object) array(),
		'no_update'    => (object) array(),
		'translations' => array(),
	);

	if ( $is_themes && 'theme' === $payload['kind'] ) {
		$slug = (string) ( $payload['slug'] ?? '' );
		if ( '' !== $slug ) {
			$new_version = (string) ( $payload['new_version'] ?? '' );
			$entry       = array(
				'theme'        => $slug,
				'new_version'  => $new_version,
				'url'          => (string) ( $payload['url'] ?? '' ),
				'package'      => (string) ( $payload['package'] ?? '' ),
				'requires'     => (string) ( $payload['requires'] ?? '' ),
				'requires_php' => (string) ( $payload['requires_php'] ?? '' ),
			);
			// Route to no_update once the on-disk version has caught up,
			// otherwise themes.php would keep flashing the upgrade notice
			// after a successful test upgrade.
			$installed       = (string) wp_get_theme( $slug )->get( 'Version' );
			$bucket          = ( '' !== $installed && version_compare( $installed, $new_version, '>=' ) ) ? 'no_update' : 'themes';
			$body[ $bucket ] = array( $slug => $entry );
		}
	} elseif ( $is_plugins && 'plugin' === $payload['kind'] ) {
		$entry_path = (string) ( $payload['plugin'] ?? '' );
		$slug       = (string) ( $payload['slug'] ?? '' );
		if ( '' !== $entry_path ) {
			$new_version = (string) ( $payload['new_version'] ?? '' );
			$info        = array(
				'id'           => 'w.org/plugins/' . $slug,
				'slug'         => $slug,
				'plugin'       => $entry_path,
				'new_version'  => $new_version,
				'url'          => (string) ( $payload['url'] ?? '' ),
				'package'      => (string) ( $payload['package'] ?? '' ),
				'requires'     => (string) ( $payload['requires'] ?? '' ),
				'requires_php' => (string) ( $payload['requires_php'] ?? '' ),
			);
			if ( ! function_exists( 'get_plugins' ) ) {
				require_once ABSPATH . 'wp-admin/includes/plugin.php';
			}
			$all_plugins     = get_plugins();
			$installed       = isset( $all_plugins[ $entry_path ]['Version'] ) ? (string) $all_plugins[ $entry_path ]['Version'] : '';
			$bucket          = ( '' !== $installed && version_compare( $installed, $new_version, '>=' ) ) ? 'no_update' : 'plugins';
			$body[ $bucket ] = array( $entry_path => $info );
		}
	}

	return array(
		'response' => array(
			'code'    => 200,
			'message' => 'OK',
		),
		'headers'  => array(),
		'body'     => wp_json_encode( $body ),
		'cookies'  => array(),
		'filename' => null,
	);
}

add_filter( 'pre_http_request', 'lse_test_upgrade_intercept', 1, 3 );
