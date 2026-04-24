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
		rollupOptions: {
			input: {
				main: 'src/main.ts',
				'editor.worker': 'src/workers/editor.worker.ts',
				'json.worker': 'src/workers/json.worker.ts',
				'css.worker': 'src/workers/css.worker.ts',
				'html.worker': 'src/workers/html.worker.ts',
				'ts.worker': 'src/workers/ts.worker.ts',
			},
			output: {
				entryFileNames: '[name].js',
				chunkFileNames: '[name]-[hash].js',
				assetFileNames: '[name][extname]',
			},
		},
	},
});
