/**
 * Manage the lifecycle of the wp-env session dedicated to Playwright runs.
 *
 * Why a dedicated session: the project root's `.wp-env.json` is what the
 * developer uses for manual exploration, typically pinned to port 8888.
 * Running tests against that same session would either collide on the
 * port or smash the developer's working state with the test fixtures.
 * `tests/.wp-env.json` is a sibling config that wp-env hashes under a
 * different installation dir, so both can be up at the same time.
 *
 * The port is picked by `wp-env start --auto-port` (wp-env walks
 * upward from the configured port until it finds a free one) and
 * cached in `tests/.cache/wp-env.json`. Subsequent runs read the
 * cached port, ping it, and skip the `wp-env start` invocation
 * entirely if the containers are still alive — the steady state
 * during a tight test/edit loop.
 *
 * Concurrency: a sibling lock file (`tests/.cache/wp-env.json.lock`)
 * serialises the read→start→write path so two parallel invocations
 * can't both decide the cache is stale and race `wp-env start
 * --auto-port` against each other. The fast warm-cache path stays
 * outside the lock — only the slow start path takes it.
 */
import { spawnSync } from 'node:child_process';
import {
	closeSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
	writeSync,
} from 'node:fs';
import { join } from 'node:path';

// Playwright runs npm scripts from the project root, so `tests/` and
// `tests-multisite/` sit at stable locations relative to cwd. Avoid
// `import.meta.url` — Playwright's TS transform loads helpers as CJS,
// where it isn't defined.
export const TESTS_CWD = join(process.cwd(), 'tests');
export const MULTISITE_TESTS_CWD = join(process.cwd(), 'tests-multisite');

// wp-env's first-run cold pull can run ~2 minutes; the lock holder is
// inside that span for the entire duration. Budget generously so a
// legitimately busy session doesn't trip the timeout.
const LOCK_WAIT_TIMEOUT_MS = 5 * 60 * 1000;
const LOCK_POLL_INTERVAL_MS = 250;

export interface WpEnvSession {
	port: number;
	baseUrl: string;
}

interface CachePaths {
	cacheDir: string;
	cacheFile: string;
	lockFile: string;
}

function pathsFor(testsCwd: string): CachePaths {
	const cacheDir = join(testsCwd, '.cache');
	const cacheFile = join(cacheDir, 'wp-env.json');
	return { cacheDir, cacheFile, lockFile: `${cacheFile}.lock` };
}

function readCache(cacheFile: string): WpEnvSession | null {
	// No `existsSync` pre-check: it would add a TOCTOU window where
	// another process could delete the file between the check and the
	// read. `readFileSync` already throws `ENOENT` on a missing file,
	// which the catch below treats as a miss.
	try {
		const data = JSON.parse(readFileSync(cacheFile, 'utf8')) as Partial<WpEnvSession>;
		if (typeof data.port === 'number' && typeof data.baseUrl === 'string') {
			return { port: data.port, baseUrl: data.baseUrl };
		}
	} catch {
		// ENOENT (no cache yet) and JSON syntax errors are both treated
		// as a miss; `startFreshSession()` rewrites the file under the
		// lock.
	}
	return null;
}

function writeCache(paths: CachePaths, session: WpEnvSession): void {
	mkdirSync(paths.cacheDir, { recursive: true });
	// Atomic write: writeFileSync truncates first, so a reader hitting
	// the gap would see an empty file and parse-fail. `renameSync` is
	// atomic on POSIX, so any reader sees either the old contents or
	// the new — never a half-written intermediate.
	const tmp = `${paths.cacheFile}.${process.pid}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(session, null, '\t')}\n`, 'utf8');
	renameSync(tmp, paths.cacheFile);
}

/**
 * Probe the cached port synchronously via a one-shot Node HTTP request
 * embedded in a child process. Using a sub-process keeps this callable
 * from `playwright.config.ts` (which runs synchronously at module load).
 * `curl` would be simpler but is not guaranteed on every CI image —
 * Node is.
 */
function pingPort(port: number): boolean {
	const probe = `
const http = require('http');
const req = http.get(
	{ host: '127.0.0.1', port: ${port}, path: '/wp-login.php', timeout: 3000 },
	(res) => { res.resume(); process.exit(res.statusCode === 200 ? 0 : 1); },
);
req.on('error', () => process.exit(1));
req.on('timeout', () => { req.destroy(); process.exit(1); });
`;
	const result = spawnSync(process.execPath, ['-e', probe], { stdio: 'ignore' });
	return result.status === 0;
}

/**
 * Block the current thread for `ms` milliseconds without spawning a
 * child process. `Atomics.wait` returns "timed-out" because the
 * SharedArrayBuffer is zero-initialised and we wait for "value 0
 * differs from current"; the condition never holds, so the call
 * sleeps for the full duration.
 */
function sleepSync(ms: number): void {
	const buf = new Int32Array(new SharedArrayBuffer(4));
	Atomics.wait(buf, 0, 0, ms);
}

/**
 * Probe a PID for liveness. `process.kill(pid, 0)` doesn't actually
 * deliver a signal — it only runs the kernel's permission/existence
 * check.
 *
 * - `ESRCH`: no such process — dead. Lock is reclaimable.
 * - `EPERM`: process exists but we can't signal it (different uid,
 *   container boundary). Treat as alive — better to wait than to
 *   bulldoze a healthy holder.
 * - Anything else: be conservative and treat as alive.
 */
function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === 'EPERM';
	}
}

function readLockHolderPid(lockFile: string): number | null {
	try {
		const pid = Number(readFileSync(lockFile, 'utf8').trim());
		return Number.isFinite(pid) && pid > 0 ? pid : null;
	} catch {
		// The lock file may have been released between our open attempt
		// and this read; the caller's retry loop handles that.
		return null;
	}
}

function acquireLock(paths: CachePaths): void {
	mkdirSync(paths.cacheDir, { recursive: true });
	const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
	while (true) {
		try {
			// `wx` = O_CREAT | O_EXCL. The kernel guarantees only one
			// caller's open succeeds across processes — this is the
			// actual atomic primitive the lock rides on.
			const fd = openSync(paths.lockFile, 'wx');
			try {
				writeSync(fd, String(process.pid));
			} finally {
				closeSync(fd);
			}
			return;
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code !== 'EEXIST') throw err;

			// Lock is held. Check for a stale holder (process died
			// without releasing) before we resign to waiting.
			const holderPid = readLockHolderPid(paths.lockFile);
			if (holderPid !== null && !isProcessAlive(holderPid)) {
				// Stale: force-claim. The unlink may race with another
				// contender's unlink, which is fine — at worst the
				// next openSync attempt fails and we loop again.
				try {
					unlinkSync(paths.lockFile);
				} catch {
					// Another contender beat us to the cleanup.
				}
				continue;
			}

			if (Date.now() > deadline) {
				throw new Error(
					`Timed out after ${LOCK_WAIT_TIMEOUT_MS}ms waiting for wp-env cache lock at ${paths.lockFile} ` +
						`(held by PID ${holderPid ?? 'unknown'}). Delete the file manually if the holder is gone.`,
				);
			}
			sleepSync(LOCK_POLL_INTERVAL_MS);
		}
	}
}

function releaseLock(lockFile: string): void {
	try {
		unlinkSync(lockFile);
	} catch {
		// Idempotent — already gone (someone reclaimed it as stale, or
		// we never actually acquired). Either way, nothing to do.
	}
}

function withLock<T>(paths: CachePaths, fn: () => T): T {
	acquireLock(paths);
	try {
		return fn();
	} finally {
		releaseLock(paths.lockFile);
	}
}

function startFreshSession(testsCwd: string): WpEnvSession {
	// wp-env writes progress (Docker pulls, container status, the
	// summary "started at" line) to stderr; stdout stays mostly empty.
	// Capture both so the regex below can scan whichever stream the
	// URL ends up on, and re-echo to the user's terminal so cold-pull
	// progress isn't hidden.
	//
	// `--auto-port` is intentionally NOT used. wp-env's install dir is
	// keyed off the config-file path, so it gets reused across runs —
	// but with `--auto-port`, the chosen host port can drift run to
	// run while WP's `siteurl` / `home` in the reused DB stay pinned
	// to the original port. The mismatch produces a 302 → dead-port
	// → ERR_CONNECTION_REFUSED chain that defeats the whole "warm
	// reuse" story. Each .wp-env.json now declares a `port`
	// explicitly (8881 single-site, 8882 multisite); if a port is
	// busy, wp-env will surface the error here.
	const result = spawnSync('npx', ['--no-install', 'wp-env', 'start'], {
		cwd: testsCwd,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	const stdout = result.stdout ?? '';
	const stderr = result.stderr ?? '';
	process.stdout.write(stdout);
	process.stderr.write(stderr);
	if (result.status !== 0) {
		throw new Error(`wp-env start (cwd: ${testsCwd}) exited with status ${result.status}.`);
	}
	const combined = `${stdout}\n${stderr}`;
	const match = combined.match(/development\s+site[^\n]*?http:\/\/[^\s:]+:(\d+)/i);
	if (!match?.[1]) {
		throw new Error(
			`wp-env start (cwd: ${testsCwd}) did not include a "development site started at http://…:<port>" line. ` +
				'Either the wp-env output format changed or the dev environment is disabled in the .wp-env.json.',
		);
	}
	const port = Number(match[1]);
	return { port, baseUrl: `http://localhost:${port}` };
}

/**
 * Internal: return a live wp-env session for the given config directory,
 * starting one if necessary. Cache + lock files live under
 * `${testsCwd}/.cache/`, so two separate configs (single-site, multisite)
 * cache independently and can run concurrently on auto-discovered ports.
 *
 * Fast path (cache warm): a single ping outside the lock — no
 * serialisation overhead in the common case where the containers are
 * already up. Slow path (cache miss or stale): take the lock,
 * **re-check inside the critical section**, and only then spawn
 * `wp-env start`. The re-check ensures a contender that lost the race
 * for the lock sees the winner's freshly written cache instead of
 * redundantly starting a second session.
 */
function ensureRunning(testsCwd: string): WpEnvSession {
	const paths = pathsFor(testsCwd);
	const warm = readCache(paths.cacheFile);
	if (warm && pingPort(warm.port)) return warm;

	return withLock(paths, () => {
		const recheck = readCache(paths.cacheFile);
		if (recheck && pingPort(recheck.port)) return recheck;
		const session = startFreshSession(testsCwd);
		writeCache(paths, session);
		return session;
	});
}

/**
 * Read the cached baseUrl for a given test config dir without
 * pinging the port or starting wp-env. Returns undefined when no
 * cache exists.
 *
 * Useful inside Playwright worker subprocesses: they re-load the
 * config file but cannot re-parse the parent's `--project` filter
 * (Playwright doesn't pass it through). They also don't need to boot
 * anything — the parent already did — so reading the cache is
 * sufficient to resolve baseURL for navigation.
 */
export function readCachedBaseUrl(testsCwd: string): string | undefined {
	return readCache(pathsFor(testsCwd).cacheFile)?.baseUrl;
}

/**
 * Return a live single-site wp-env session, starting one if necessary.
 * Safe to call from synchronous contexts (e.g. `playwright.config.ts`
 * load). Announces progress on the warm and cold paths so the user
 * sees what is happening during the long-running config-load step.
 */
export function ensureWpEnvRunning(): WpEnvSession {
	console.log('[wp-env] Ensuring single-site wp-env is running...');
	const session = ensureRunning(TESTS_CWD);
	console.log(`[wp-env] Single-site wp-env ready at ${session.baseUrl}`);
	return session;
}

/**
 * Return a live multisite wp-env session, starting one if necessary.
 * Backed by `tests-multisite/.wp-env.json` (which declares
 * `"multisite": true`) and an independent cache/lock under
 * `tests-multisite/.cache/`, so it can run alongside the single-site
 * session without contention.
 */
export function ensureMultisiteRunning(): WpEnvSession {
	console.log('[wp-env] Ensuring multisite wp-env is running...');
	const session = ensureRunning(MULTISITE_TESTS_CWD);
	console.log(`[wp-env] Multisite wp-env ready at ${session.baseUrl}`);
	return session;
}
