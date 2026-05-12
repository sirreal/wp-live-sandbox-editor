<?php
/**
 * Plugin Name: LSE Tests — Disable Admin Pointers
 * Description: Hides WordPress's "welcome" admin pointers during
 *              Playwright runs. They overlay row-action links on
 *              plugins.php / themes.php and intercept the clicks the
 *              upgrade-link specs depend on. CSS hide (with !important)
 *              keeps the pointer markup in the DOM but invisible and
 *              non-interactive — sufficient for Playwright's
 *              actionability check.
 *
 * Loaded as an mu-plugin via the `mappings` entry in tests/.wp-env.json.
 */

// phpcs:disable WordPress.WP.EnqueuedResources

namespace LSE\Tests\NoPointers;

\defined( 'ABSPATH' ) || exit;

\add_action(
	'admin_head',
	static function (): void {
		echo '<style id="lse-tests-no-pointers">.wp-pointer{display:none!important}</style>';
	}
);
