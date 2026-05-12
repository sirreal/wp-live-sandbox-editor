import { execFileSync } from 'node:child_process';
import { TESTS_CWD } from './wp-env.js';

/**
 * Run a WP-CLI command inside the test wp-env container and return
 * stdout. Throws if the command exits non-zero unless `ignoreErrors` is
 * set.
 *
 * `cwd: TESTS_CWD` is what binds this to the tests/.wp-env.json session
 * instead of the project root's developer-facing config — wp-env picks
 * its environment based on the location of the .wp-env.json it finds.
 * `npx --no-install` keeps the lookup inside the project's
 * node_modules so we don't accidentally hit a global wp-env install
 * with a different version.
 */
export function wpCli(args: string[], opts: { ignoreErrors?: boolean } = {}): string {
	try {
		return execFileSync('npx', ['--no-install', 'wp-env', 'run', 'cli', '--', 'wp', ...args], {
			cwd: TESTS_CWD,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		}).trim();
	} catch (err) {
		if (opts.ignoreErrors) {
			return '';
		}
		throw err;
	}
}

export function getInstalledPluginVersion(entry: string): string {
	const slug = entry.split('/')[0] ?? entry;
	return wpCli(['plugin', 'get', slug, '--field=version']);
}

export function getInstalledThemeVersion(stylesheet: string): string {
	return wpCli(['theme', 'get', stylesheet, '--field=version']);
}
