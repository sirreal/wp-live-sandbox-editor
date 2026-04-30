<?php
/**
 * wpdb-backed PDO adapter for MySQLDumpProducer.
 *
 * On hosts with `ext-pdo` but no `pdo_mysql`, `new \PDO('mysql:...')` fails
 * yet `wpdb` (mysqli) is fully functional. The producer is duck-typed
 * against PDO, so wrapping `$wpdb` keeps the dump path working.
 *
 * @package LiveSandboxEditor
 */

namespace Live_Sandbox_Editor;

require_once __DIR__ . '/class-wpdb-pdo-statement.php';

class Wpdb_Pdo_Adapter {

	/** @var \wpdb */
	private $wpdb;

	/**
	 * Mutates the shared mysqli connection on `$wpdb->dbh`: pins its
	 * charset for the rest of the request so quoting is deterministic.
	 * The change is not reverted — callers that share this `$wpdb`
	 * with code that relies on a different charset must coordinate.
	 *
	 * Inherits the rest of WordPress's session as-is. wpdb's
	 * `incompatible_modes` strips the composite `ANSI` mode but not a
	 * standalone `ANSI_QUOTES`, and `NO_BACKSLASH_ESCAPES` is never set
	 * by wpdb itself. Either can land in our session via a plugin, a
	 * site-config hook, or an RDS parameter group, so we re-check both.
	 *
	 * @param \wpdb $wpdb wpdb instance whose `dbh` is a mysqli connection.
	 * @throws \PDOException If `$wpdb->dbh` is not a `\mysqli` instance,
	 *                       if the charset cannot be pinned, if the
	 *                       `sql_mode` lookup fails, or if the session
	 *                       runs in a mode the statement parser or
	 *                       `quote()` is not safe under
	 *                       (`NO_BACKSLASH_ESCAPES` or `ANSI_QUOTES`).
	 */
	public function __construct( \wpdb $wpdb ) {
		if ( ! ( $wpdb->dbh instanceof \mysqli ) ) {
			throw new \PDOException( 'Wpdb_Pdo_Adapter requires a mysqli-backed wpdb.' );
		}

		// Pin the connection charset so `mysqli_real_escape_string()` knows
		// how to escape multibyte input regardless of how wpdb was set up.
		$charset = ( isset( $wpdb->charset ) && '' !== $wpdb->charset ) ? $wpdb->charset : 'utf8mb4';
		// phpcs:ignore WordPress.DB.RestrictedFunctions.mysql_mysqli_set_charset -- intentional: wpdb's $charset reflects the desired connection charset, but on hosts where wpdb didn't get to call set_charset() we still need to pin it so mysqli_real_escape_string() is well-defined.
		if ( ! \mysqli_set_charset( $wpdb->dbh, $charset ) ) {
			throw new \PDOException( 'Wpdb_Pdo_Adapter could not set connection charset to ' . $charset . '.' );
		}

		// Reject session modes that invalidate the assumptions baked into
		// `quote()` (NO_BACKSLASH_ESCAPES) or the statement parser's
		// string-literal tracking (ANSI_QUOTES, which makes `"…"` an
		// identifier delimiter rather than a string literal). Route
		// through wpdb so the lookup participates in its query accounting.
		// Use `get_results()` instead of `get_var()` so a legitimately
		// empty `sql_mode = ''` is not mistaken for a query failure.
		// Fail closed on real lookup failure — silently skipping the
		// check would re-open the very vector this guard exists to close.
		$wpdb->last_error = '';
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.DirectDatabaseQuery.NoCaching -- intentional: this is a one-shot session-metadata check at adapter construction; caching the value would only hide a sql_mode change made after we last looked.
		$rows = $wpdb->get_results( 'SELECT @@SESSION.sql_mode', ARRAY_N );
		if ( '' !== (string) $wpdb->last_error || ! is_array( $rows ) || ! isset( $rows[0][0] ) ) {
			throw new \PDOException( 'Wpdb_Pdo_Adapter could not read sql_mode for safety check.' );
		}
		$mode = (string) $rows[0][0];
		foreach ( array( 'NO_BACKSLASH_ESCAPES', 'ANSI_QUOTES' ) as $forbidden ) {
			if ( false !== stripos( $mode, $forbidden ) ) {
				throw new \PDOException( 'Wpdb_Pdo_Adapter cannot run with ' . $forbidden . ' sql_mode.' );
			}
		}

		$this->wpdb = $wpdb;
	}

	public function prepare( string $sql ): Wpdb_Pdo_Statement {
		return new Wpdb_Pdo_Statement( $this->wpdb, $this, $sql );
	}

	public function query( string $sql ): Wpdb_Pdo_Statement {
		$stmt = new Wpdb_Pdo_Statement( $this->wpdb, $this, $sql );
		$stmt->execute();
		return $stmt;
	}

	/**
	 * Quote a value byte-equivalent to `\PDO::quote()` against the mysql
	 * driver. Bypasses `wpdb::esc_sql()` / `wpdb::_real_escape()` because
	 * both feed their output through `wpdb::add_placeholder_escape()`, which
	 * substitutes `%` with a sentinel meant to be stripped by
	 * `wpdb::prepare()`. Since this adapter never calls `prepare()`, those
	 * sentinels would leak into the dumped SQL.
	 *
	 * @param mixed $value Scalar or null to quote.
	 */
	public function quote( $value ): string {
		if ( null === $value ) {
			return 'NULL';
		}
		if ( is_bool( $value ) ) {
			// PDO's mysql driver emits '1' / '' for true / false — match it.
			return $value ? "'1'" : "''";
		}
		// phpcs:ignore WordPress.DB.RestrictedFunctions.mysql_mysqli_real_escape_string -- intentional: we need PDO::quote() byte-equivalence, which wpdb's escape wrappers cannot provide.
		$escaped = \mysqli_real_escape_string( $this->wpdb->dbh, (string) $value );
		return "'" . $escaped . "'";
	}

	/**
	 * @throws \PDOException Always — surfaces unimplemented producer calls
	 *                       through the existing PDOException handlers.
	 */
	public function __call( string $name, array $args ) {
		throw new \PDOException( 'Wpdb_Pdo_Adapter does not implement ' . $name . '()' );
	}
}
