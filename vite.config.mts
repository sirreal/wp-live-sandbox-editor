import { defineConfig } from 'vite';

export default defineConfig({
	base: './',
	server: {
		watch: {
			// `.claude/worktrees/**` holds full git worktree copies of this
			// repo (including `src/`); without this rule chokidar treats
			// edits in a worktree as edits to the parent and fires HMR.
			ignored: ['**/.claude/**'],
		},
	},
	build: {
		outDir: 'live-sandbox-editor/build',
		emptyOutDir: true,
		modulePreload: false,
		sourcemap: true,
		rolldownOptions: {
			input: {
				main: 'src/main.ts',
				setup: 'src/setup.ts',
				'themes-grid': 'src/themes-grid.ts',
			},
			/*
			 * `@wordpress/interactivity` is provided at runtime by WordPress
			 * core.
			 * `@wp-playground/client` is expected to be served from playground.wordpress.net instead of bundled. It is the interface to the playground frame.
			 */
			external: ['@wordpress/interactivity', '@wp-playground/client'],
			output: {
				entryFileNames: '[name].js',
				chunkFileNames: '[name]-[hash].js',
				assetFileNames: '[name][extname]',
				paths: {
					'@wp-playground/client':
						'https://playground.wordpress.net/client/index.js',
				},
				// Monaco's lazy language chunks (cssMode, tsMode, …) need a
				// shared parent for monaco's eager core. With a single entry
				// they'd otherwise import `./main.js`, which WP enqueues with
				// `?ver=…` — two URL identities for the same module re-runs
				// the entry's side effects (second editor + Playground iframe).
				// Pull monaco-editor's static graph into its own chunk; lazy
				// language modes (cssMode, tsMode, …) stay as their own
				// dynamic chunks and share `./monaco-[hash].js` with main.js.
				codeSplitting: {
					groups: [
						// Vite's __vitePreload helper is a synthetic module shared
						// between any chunk that performs dynamic imports. Without
						// pinning it to its own chunk, rolldown hoists it into the
						// largest consumer (here: monaco), which forces main.js to
						// statically import the monaco chunk just to reach the
						// helper — defeating the lazy-load goal.
						{
							name: 'preload-helper',
							test: (id) => id.includes('preload-helper'),
						},
						{
							name: 'monaco',
							test: (id) =>
								id.includes('node_modules/monaco-editor/') &&
								!/\/(?:cssMode|tsMode|htmlMode|jsonMode)\.js$/.test(id),
						},
					],
				},
			},
		},
	},
});
