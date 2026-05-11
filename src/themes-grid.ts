import { getModuleData, type ThemesGridData } from './types.js';

const { hrefs, label, orPrefix, orSuffix } = getModuleData<ThemesGridData>(
	'live-sandbox-editor-themes-grid',
);

// Capture-phase listener fires before themes.js's bubble-phase delegation on
// `.update-message`. Without it, themes.js hijacks the click into its AJAX
// update flow.
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
	const msg = card.querySelector('.update-message');
	if (!msg) return;
	if (msg.querySelector('.lse-test-upgrade-link')) return;
	const p = msg.querySelector('p');
	if (!p) return;
	const slug = slugFor(card);
	const href = slug ? hrefs[slug] : undefined;
	if (!href) return;

	const link = document.createElement('a');
	link.className = 'lse-test-upgrade-link';
	link.href = href;
	link.textContent = label;
	link.setAttribute('data-lse-test-theme-upgrade', slug ?? '');

	p.appendChild(document.createElement('br'));
	p.appendChild(document.createTextNode(orPrefix));
	p.appendChild(link);
	p.appendChild(document.createTextNode(orSuffix));
}

function processAll(): void {
	for (const card of document.querySelectorAll('.theme')) {
		append(card);
	}
}

processAll();

// themes.js's main render path empties `.wrap` and re-appends a fresh
// `.themes` container, so observing the original `.themes` node misses
// re-renders. `#wpbody-content` is a stable ancestor. rAF-coalesce because
// themes.js fires many small mutations per render (search-as-you-type,
// modal open/close).
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
