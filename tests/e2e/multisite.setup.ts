/**
 * Playwright "setup project" that provisions the multisite wp-env with
 * the fixtures the multisite specs depend on:
 *
 * - A subsite at `/site2/` (subdirectory multisite).
 * - A user `siteadmin / siteadmin` with `administrator` role on `/site2/`
 *   and **not** a Super Admin — the exact identity the manifest-table
 *   authorization fix in `live-sandbox-editor/inc/manifest.php` is
 *   meant to protect.
 *
 * wp-env handles the multisite *install* via `"multisite": true` in
 * `tests-multisite/.wp-env.json`; this file only adds the second site
 * and the non-super-admin user. All wp-cli calls go through `wpCli`
 * with `cwd: MULTISITE_TESTS_CWD`, which is how the helper distinguishes
 * the two wp-env sessions.
 *
 * Idempotent: every step is guarded so a warm rerun (or a stale
 * partial state from an aborted previous run) converges silently
 * instead of erroring out.
 */
import { test as setup } from '@playwright/test';
import { wpCli } from './helpers/wp-cli.js';
import { MULTISITE_TESTS_CWD } from './helpers/wp-env.js';

const PLUGIN_SLUG = 'live-sandbox-editor';
const SITE_SLUG = 'site2';
const SITE_TITLE = 'Site 2';
const SITE_EMAIL = 'site2@example.com';
const SITE_ADMIN_USER = 'siteadmin';
const SITE_ADMIN_PASS = 'siteadmin';
const SITE_ADMIN_EMAIL = 'siteadmin@example.com';

type SiteRecord = { blog_id: string; url: string; path: string };

function cli(args: string[], opts: { ignoreErrors?: boolean } = {}): string {
	return wpCli(args, { ...opts, cwd: MULTISITE_TESTS_CWD });
}

function listSites(): SiteRecord[] {
	const json = cli(['site', 'list', '--format=json', '--fields=blog_id,url,path']);
	return JSON.parse(json) as SiteRecord[];
}

setup('multisite fixtures installed', async () => {
	// Sanity check: `"multisite": true` in tests-multisite/.wp-env.json
	// should have made the install multisite. If it didn't, the
	// downstream `wp site create` would fail with a confusing
	// "function only available in multisite" error — surface a clear
	// message here instead.
	console.log('[multisite-setup] Verifying multisite installation...');
	const isMultisite = cli(['eval', 'echo is_multisite() ? "1" : "0";']);
	if (isMultisite !== '1') {
		throw new Error(
			`tests-multisite wp-env is not running as multisite (is_multisite()=${isMultisite}). ` +
				'Check tests-multisite/.wp-env.json has "multisite": true and try `npm run test:wp-env-multisite:destroy` then rerun.',
		);
	}

	// Ensure the plugin is network-active. wp-env's `"plugins"` list
	// activates a plugin on blog 1 only when the install is multisite,
	// so without this the LSE admin page would 404 on every subsite
	// (and the chromium-multisite /site2 specs would fail at the very
	// first `expect(#live-sandbox-editor-root).toBeVisible()`).
	console.log(`[multisite-setup] Checking network activation of '${PLUGIN_SLUG}'...`);
	const networkActiveList = cli([
		'plugin',
		'list',
		'--status=active-network',
		'--field=name',
	])
		.split('\n')
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
	if (!networkActiveList.includes(PLUGIN_SLUG)) {
		console.log(`[multisite-setup] Network-activating '${PLUGIN_SLUG}'...`);
		cli(['plugin', 'activate', PLUGIN_SLUG, '--network']);
	} else {
		console.log(`[multisite-setup] '${PLUGIN_SLUG}' already network-active.`);
	}

	// Ensure the subsite exists. `wp site list` returns the subsite
	// path as `/site2/` (with slashes), which is what we match on.
	console.log(`[multisite-setup] Looking up subsite '/${SITE_SLUG}/'...`);
	let sites = listSites();
	let subsite = sites.find((s) => s.path === `/${SITE_SLUG}/`);
	if (!subsite) {
		console.log(`[multisite-setup] Creating subsite '/${SITE_SLUG}/' (${SITE_TITLE})...`);
		cli([
			'site',
			'create',
			`--slug=${SITE_SLUG}`,
			`--title=${SITE_TITLE}`,
			`--email=${SITE_EMAIL}`,
		]);
		sites = listSites();
		subsite = sites.find((s) => s.path === `/${SITE_SLUG}/`);
		if (!subsite) {
			throw new Error(`Subsite '/${SITE_SLUG}/' missing after wp site create.`);
		}
	} else {
		console.log(`[multisite-setup] Subsite '/${SITE_SLUG}/' already exists at ${subsite.url}`);
	}

	// Ensure the non-super-admin user exists with administrator role
	// on the subsite. `wp user create --url=<subsite-url>` anchors the
	// new user's primary blog to that subsite, which is what
	// 'administrator on site2 only' looks like in WP terms.
	console.log(`[multisite-setup] Looking up user '${SITE_ADMIN_USER}'...`);
	const existingUserId = cli(['user', 'get', SITE_ADMIN_USER, '--field=ID'], { ignoreErrors: true });
	if (!existingUserId) {
		console.log(`[multisite-setup] Creating user '${SITE_ADMIN_USER}' with administrator role on '/${SITE_SLUG}/'...`);
		cli([
			'user',
			'create',
			SITE_ADMIN_USER,
			SITE_ADMIN_EMAIL,
			'--role=administrator',
			`--user_pass=${SITE_ADMIN_PASS}`,
			`--url=${subsite.url}`,
		]);
	} else {
		console.log(`[multisite-setup] User '${SITE_ADMIN_USER}' already exists (ID=${existingUserId})`);
	}

	// Force-set the administrator role on the subsite. Symmetric with the
	// super-admin removal below: warm/partial state from an aborted prior
	// run could leave the user without `wp_2_capabilities` (not a member
	// of /site2/), or with a weaker role like `subscriber` — both would
	// break the boundary the specs exercise. `add_user_to_blog()` is
	// idempotent: it inserts the membership when missing and overwrites
	// the role when present.
	console.log(`[multisite-setup] Ensuring '${SITE_ADMIN_USER}' has administrator role on '/${SITE_SLUG}/'...`);
	cli([
		'eval',
		`add_user_to_blog( ${subsite.blog_id}, get_user_by( 'login', '${SITE_ADMIN_USER}' )->ID, 'administrator' );`,
	]);

	// Defensive: a fresh `wp user create` doesn't auto-promote, but a
	// prior run could have left this user as Super Admin. Strip the
	// role so the boundary the specs exercise is the real one.
	console.log(`[multisite-setup] Ensuring '${SITE_ADMIN_USER}' is NOT a Super Admin...`);
	cli(['super-admin', 'remove', SITE_ADMIN_USER], { ignoreErrors: true });

	console.log('[multisite-setup] Fixtures ready.');
});
