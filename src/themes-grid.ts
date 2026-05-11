import { getModuleData, type ThemesGridData } from './types.js';

const data = getModuleData<ThemesGridData>('live-sandbox-editor-themes-grid');
// Bail out cleanly if the script-module-data element is missing or malformed
// (e.g. an unrelated script-module-data filter clobbers the JSON). Without
// this, downstream `hrefs[slug]` access would throw and could break
// themes.php's own JS.
if (
	!data ||
	typeof data !== 'object' ||
	typeof data.label !== 'string' ||
	!data.hrefs ||
	typeof data.hrefs !== 'object'
) {
	console.warn(
		'[live-sandbox-editor] themes-grid: missing or malformed module data; not installing.',
	);
} else {
	install(data);
}

function install({ hrefs, label }: ThemesGridData): void {
	// Capture-phase listener fires before themes.js's bubble-phase delegation
	// on `.update-message`. Without it, themes.js hijacks the click into its
	// AJAX update flow.
	document.addEventListener(
		'click',
		(e) => {
			const target = e.target;
			if (
				target instanceof Element &&
				target.closest('a.lse-test-upgrade-link')
			) {
				e.stopPropagation();
			}
		},
		true,
	);

	function slugFor(card: Element): string | null {
		// JS-rendered cards have data-slug; PHP-rendered cards expose the slug
		// via the theme-name id ("{slug}-name").
		const slug = card.getAttribute('data-slug');
		if (slug) return slug;
		const name = card.querySelector<HTMLElement>('.theme-name[id$="-name"]');
		if (!name) return null;
		return name.id.replace(/-name$/, '');
	}

	function append(card: Element): void {
		// `.notice-warning .update-message` is what themes.php renders for
		// actionable "New version available" rows. Incompatibility messages
		// use `.notice-error .update-message` and have no upgrade action —
		// scoping the selector keeps us off those.
		const msg = card.querySelector('.notice-warning .update-message');
		if (!msg) return;
		if (msg.querySelector('.lse-test-upgrade-link')) return;
		const p = msg.querySelector('p');
		if (!p) return;
		const slug = slugFor(card);
		if (!slug) return;
		const href = hrefs[slug];
		if (!href) return;

		const link = document.createElement('a');
		link.className = 'lse-test-upgrade-link';
		link.href = href;
		link.textContent = label;
		link.setAttribute('data-lse-test-theme-upgrade', slug);

		p.appendChild(document.createElement('br'));
		p.appendChild(link);
	}

	function processAll(): void {
		for (const card of document.querySelectorAll('.theme')) {
			append(card);
		}
	}

	processAll();

	// themes.js's main render path empties `.wrap` and re-appends a fresh
	// `.themes` container, so observing the original `.themes` node misses
	// re-renders. `#wpbody-content` is a stable ancestor. rAF-coalesce
	// because themes.js fires many small mutations per render
	// (search-as-you-type, modal open/close).
	const container = document.getElementById('wpbody-content') ?? document.body;
	let pending = false;
	const schedule = (): void => {
		if (pending) return;
		pending = true;
		requestAnimationFrame(() => {
			pending = false;
			processAll();
		});
	};
	new MutationObserver((records) => {
		for (const r of records) {
			if (r.addedNodes.length) {
				schedule();
				return;
			}
		}
	}).observe(container, { childList: true, subtree: true });
}
