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
	 * @param \wpdb $wpdb wpdb instance whose `dbh` is a mysqli connection.
	 * @throws \PDOException If `$wpdb->dbh` is not a `\mysqli` instance.
	 */
	public function __construct( \wpdb $wpdb ) {
		if ( ! ( $wpdb->dbh instanceof \mysqli ) ) {
			throw new \PDOException( 'Wpdb_Pdo_Adapter requires a mysqli-backed wpdb.' );
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
