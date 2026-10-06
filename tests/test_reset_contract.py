import os
import subprocess
import unittest


OPERATIONAL_TABLES = (
    "fulfillment_records",
    "issue_report_attachments",
    "issue_reports",
    "machine_production_logs",
    "material_movements",
    "order_items",
    "orders",
    "production_entry_batches",
    "production_logs",
    "production_order_items",
    "production_orders",
    "raw_material_batches",
    "raw_material_entries",
    "stock_adjustments",
    "stock_activity_log",
    "stock_reset_log",
    "trading_records",
    "wastage_data",
)


class MigrationSourceContractTest(unittest.TestCase):
    def test_two_location_migration_is_additive_and_zero_safe(self):
        with open("migrations/007_two_location_stock_ledger.sql", encoding="utf-8") as source:
            migration = source.read()

        self.assertIn("CREATE TABLE IF NOT EXISTS stock_activity_log", migration)
        self.assertNotIn("UPDATE floor_material_balance SET total_quantity_kg = raw", migration)
        self.assertIn("CHECK (warehouse_closing_kg >= 0)", migration)
        self.assertIn("CHECK (floor_closing_kg >= 0)", migration)


def psql_scalar(database, sql):
    result = subprocess.run(
        ["sudo", "-u", "postgres", "psql", "-X", "-At", "-v", "ON_ERROR_STOP=1", "-d", database, "-c", sql],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


@unittest.skipUnless(os.getenv("VP_TEST_DB"), "VP_TEST_DB is required for reset integration tests")
class ResetContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database = os.environ["VP_TEST_DB"]
        cls.preserved = {
            key: int(value)
            for key, value in (
                item.split(":", 1) for item in os.environ["VP_PRESERVED_COUNTS"].split(",")
            )
        }

    def test_operational_tables_are_empty(self):
        for table in OPERATIONAL_TABLES:
            with self.subTest(table=table):
                self.assertEqual(psql_scalar(self.database, f"SELECT count(*) FROM {table}"), "0")

    def test_stock_and_machine_workers_are_zero(self):
        checks = {
            "raw_material_totals": "SELECT count(*) FROM raw_material_totals WHERE total_quantity_kg <> 0",
            "floor_material_balance": "SELECT count(*) FROM floor_material_balance WHERE total_quantity_kg <> 0",
            "machine_stock_assignments": "SELECT count(*) FROM machine_stock_assignments WHERE quantity_kg <> 0",
            "machine_state": "SELECT count(*) FROM machine_state WHERE current_worker IS NOT NULL",
        }
        for name, sql in checks.items():
            with self.subTest(name=name):
                self.assertEqual(psql_scalar(self.database, sql), "0")

    def test_preserved_master_counts_are_unchanged(self):
        for table, expected in self.preserved.items():
            with self.subTest(table=table):
                self.assertEqual(int(psql_scalar(self.database, f"SELECT count(*) FROM {table}")), expected)

    def test_operational_sequences_are_restarted(self):
        sequences = psql_scalar(
            self.database,
            """SELECT sequencename FROM pg_sequences
               WHERE schemaname='public'
                 AND sequencename IN (
                   'production_logs_id_seq', 'material_movements_id_seq',
                   'raw_material_batches_id_seq', 'orders_id_seq',
                   'wastage_data_id_seq', 'stock_adjustments_id_seq'
                 ) ORDER BY sequencename""",
        ).splitlines()
        self.assertIn("stock_adjustments_id_seq", sequences)
        for sequence in sequences:
            with self.subTest(sequence=sequence):
                state = psql_scalar(self.database, f"SELECT last_value || ':' || is_called FROM {sequence}")
                self.assertEqual(state, "1:false")


if __name__ == "__main__":
    unittest.main()
