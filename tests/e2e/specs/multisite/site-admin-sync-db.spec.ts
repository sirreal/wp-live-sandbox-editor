/**
 * Subsite admin on /site2/ POSTs hand-crafted manifests to `/sync-db`.
 * The picker spec only exercises the UI surface; this one drives the
 * REST endpoint directly, which is what an authenticated non-super-admin
 * could actually hit if they wanted to bypass the Setup form.
 *
 * Wire format from `live-sandbox-editor/inc/sync-stream.php`:
 *   \n#LSE:SQL\n <b64 sql chunks> \n#LSE:END\n#LSE:DONE\n
 * When `Manifest\filter_requested_tables` strips every entry, the
 * normalized `tables` is empty and `rest_sync_db` emits a bare
 * `#LSE:DONE` — no `#LSE:SQL` is ever written. That marker's presence
 * (or absence) is the visible signal that the backend filter ran.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { setupPageUrl, SITE_ADMIN_STORAGE_STATE } from '../../helpers/wp-admin.js';

test.use({ storageState: SITE_ADMIN_STORAGE_STATE });

const SETUP_MODULE_ID = 'live-sandbox-editor-setup';

interface RestAuth {
	restUrl: string;
	nonce: string;
}

/**
 * Read `restUrl` + `nonce` from the AppData script-module payload the
 * setup page renders. Doing this through the page (instead of hardcoding)
 * matches what real callers do and means the test doesn't break if the
 * REST namespace or nonce action ever change.
 */
async function readRestAuth(page: Page): Promise<RestAuth> {
	await page.goto(setupPageUrl('/site2'));
	const data = await page.evaluate<RestAuth | null, string>((id) => {
		const el = document.getElementById(`wp-script-module-data-${id}`);
		if (!el?.textContent) {
			return null;
		}
		try {
			const parsed = JSON.parse(el.textContent) as Partial<RestAuth>;
			if (typeof parsed.restUrl !== 'string' || typeof parsed.nonce !== 'string') {
				return null;
			}
			return { restUrl: parsed.restUrl, nonce: parsed.nonce };
		} catch {
			return null;
		}
	}, SETUP_MODULE_ID);
	expect(data, 'AppData script-module payload missing restUrl/nonce').not.toBeNull();
	return data as RestAuth;
}

async function postSyncDb(
	request: APIRequestContext,
	auth: RestAuth,
	tables: string[],
): Promise<string> {
	const resp = await request.post(`${auth.restUrl}/sync-db`, {
		headers: {
			'X-WP-Nonce': auth.nonce,
			'Content-Type': 'application/json',
		},
		data: { tables },
	});
	expect(resp.status(), `/sync-db returned ${resp.status()}`).toBe(200);
	return resp.text();
}

test('subsite admin /sync-db drops globals and cross-subsite tables', async ({ page }) => {
	const auth = await readRestAuth(page);
	// Every table here is forbidden for a /site2/ subsite admin:
	//   wp_users / wp_usermeta / wp_sitemeta  — network globals.
	//   wp_3_*                                 — another subsite's tables.
	// After `filter_requested_tables(_, false)` the normalized manifest
	// has zero entries, so `rest_sync_db` short-circuits to MARKER_DONE
	// without ever emitting MARKER_SQL.
	const body = await postSyncDb(page.request, auth, [
		'wp_users',
		'wp_usermeta',
		'wp_sitemeta',
		'wp_3_posts',
		'wp_3_options',
	]);

	expect(body, 'forbidden tables produced a SQL record').not.toContain('#LSE:SQL');
	expect(body, 'stream missing terminator — handler aborted before filter ran').toContain(
		'#LSE:DONE',
	);
	expect(body, 'handler reported an error').not.toContain('#LSE:ERR');
});

test('subsite admin /sync-db accepts this-site blog tables (positive control)', async ({
	page,
}) => {
	const auth = await readRestAuth(page);
	// Without this control the negative test above could pass for the
	// wrong reason (endpoint always returns DONE, e.g. handler crashed).
	// An allowed `/site2/` blog table must produce a SQL record.
	const body = await postSyncDb(page.request, auth, ['wp_2_options']);

	expect(body, 'allowed table produced no SQL — endpoint or filter broken').toContain(
		'#LSE:SQL',
	);
	expect(body).toContain('#LSE:DONE');
	expect(body).not.toContain('#LSE:ERR');
});
