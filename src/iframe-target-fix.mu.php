<?php
/**
 * Live Sandbox Editor — strip target="_parent" from admin links.
 *
 * WP core hardcodes `target="_parent"` on a handful of admin navigation
 * links (notably the post-upgrade "Go to Plugins page" link on
 * update.php) — a leftover from the bulk-update iframe UI inside
 * plugins.php. Playground's entire admin already runs in an iframe
 * owned by the editor; `_parent` resolves to the editor's host page,
 * so clicking the link navigates the host out of the sandbox UI.
 *
 * Stripped at click-time via a capturing delegated listener so dynamic
 * content is covered too.
 *
 * @package Live_Sandbox_Editor
 */

add_action(
	'admin_print_footer_scripts',
	static function () {
		?>
<script>
(function(){
	document.addEventListener('click', function(e){
		var t = e.target;
		if (!t || !t.closest) return;
		var a = t.closest('a[target="_parent"]');
		if (a) a.removeAttribute('target');
	}, true);
})();
</script>
		<?php
	}
);
