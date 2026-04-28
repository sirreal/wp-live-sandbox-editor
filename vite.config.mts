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
		rollupOptions: {
			input: 'src/main.ts',
			output: {
				entryFileNames: '[name].js',
				chunkFileNames: '[name]-[hash].js',
				assetFileNames: '[name][extname]',
				// Monaco's lazy language chunks (cssMode, tsMode, …) need a
				// shared parent for monaco's eager core. With a single entry
				// they'd otherwise import `./main.js`, which WP enqueues with
				// `?ver=…` — two URL identities for the same module re-runs
				// the entry's side effects (second editor + Playground iframe).
				// Pull monaco-editor's static graph into its own chunk; lazy
				// language modes stay as their own dynamic chunks and share
				// `./monaco-[hash].js` with main.js.
				manualChunks: {
					monaco: ['monaco-editor'],
				},
			},
		},
	},
});
