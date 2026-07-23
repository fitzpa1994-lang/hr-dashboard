import importlib.util
import pathlib
import unittest


MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "validate_n8n_exports.py"
SPEC = importlib.util.spec_from_file_location("validate_n8n_exports", MODULE_PATH)
VALIDATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VALIDATOR)


class ValidateUpdateLiteralsTests(unittest.TestCase):
    def test_where_status_is_not_treated_as_an_update_value(self):
        errors = []
        VALIDATOR.validate_update_literals(
            "workflow.json",
            "UPDATE resignations SET status = 'active' WHERE status = 'pending';",
            errors,
        )
        self.assertEqual(errors, [])

    def test_invalid_set_status_is_still_rejected(self):
        errors = []
        VALIDATOR.validate_update_literals(
            "workflow.json",
            "UPDATE resignations SET status = 'queued' WHERE status = 'active';",
            errors,
        )
        self.assertEqual(
            errors,
            [
                "workflow.json: resignations.status writes 'queued', "
                "allowed: ['active', 'cancelled', 'done', 'pending']"
            ],
        )

    def test_pending_resignation_insert_matches_postgres_schema(self):
        errors = []
        VALIDATOR.validate_insert_literals(
            "workflow.json",
            "INSERT INTO resignations (name, status) SELECT '王小明', 'pending';",
            errors,
        )
        self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()
