import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pydantic import BaseModel

from src.research.domain import ModelRecipe, ResearchRecipe
from src.research.execution import (
    EXECUTION_NOTICE,
    ExecutionGuardError,
    capability_report,
    declarative_execution_guard,
)


class ExecutionGuardTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.recipe = ResearchRecipe()

    def tearDown(self):
        self.temporary.cleanup()

    def guard(self, recipe=None, paths=None, **kwargs):
        return declarative_execution_guard(
            self.recipe if recipe is None else recipe,
            {"workdir": "run-123"} if paths is None else paths,
            allowed_root=self.root,
            **kwargs,
        )

    def test_registered_recipe_and_bounded_paths_need_no_docker(self):
        with patch("src.research.execution.subprocess.run") as command:
            result = self.guard(paths={"workdir": "run-123", "plot": self.root / "run-123" / "plot.png"})
            command.assert_not_called()
        self.assertEqual(result["runner"], "digits_robustness")
        self.assertEqual(result["recipe"], self.recipe.model_dump(mode="json"))
        self.assertEqual(Path(result["paths"]["workdir"]), self.root / "run-123")
        self.assertFalse((self.root / "run-123").exists())
        self.assertFalse(result["arbitrary_code_execution"])
        self.assertEqual(result["notice"], EXECUTION_NOTICE)

    def test_unregistered_runner_and_algorithm_are_rejected(self):
        with self.assertRaises(ExecutionGuardError):
            self.guard(runner="python")
        request = self.recipe.model_dump()
        request["candidates"][0]["algorithm"] = "__import__('os').system"
        with self.assertRaises(ExecutionGuardError):
            self.guard(recipe=request)

    def test_arbitrary_shell_code_and_nested_command_fields_are_rejected(self):
        for field in ("shell", "command", "python_code", "path", "env"):
            with self.subTest(field=field):
                request = self.recipe.model_dump()
                request[field] = "ignored"
                with self.assertRaises(ExecutionGuardError):
                    self.guard(recipe=request)
        request = self.recipe.model_dump()
        request["candidates"][0]["command"] = "powershell.exe"
        with self.assertRaises(ExecutionGuardError):
            self.guard(recipe=request)

    def test_unsupported_schema_and_unknown_fields_cannot_validate_themselves(self):
        class PermissiveRecipe(BaseModel):
            dataset: str = "sklearn_digits"

        with self.assertRaises(ExecutionGuardError):
            self.guard(recipe=PermissiveRecipe())
        request = self.recipe.model_dump()
        request["unexpected"] = "accepted by a custom schema"
        with self.assertRaises(ExecutionGuardError):
            self.guard(recipe=request)

    def test_constructed_models_cannot_bypass_resource_or_algorithm_limits(self):
        invalid = ResearchRecipe.model_construct(seeds=[13, 37, 73], evaluation_noise_std=0.25,
            candidates=[ModelRecipe.model_construct(algorithm="logistic_regression", trees=100000)])
        with self.assertRaises(ExecutionGuardError):
            self.guard(recipe=invalid)
        nested = self.recipe.model_dump()
        nested["candidates"] = [ModelRecipe.model_construct(algorithm="python")]
        with self.assertRaises(ExecutionGuardError):
            self.guard(recipe=nested)

    def test_invalid_seeds_and_inflated_trial_shape_are_rejected(self):
        for seeds in ([1], [1, 1, 2], [1, 2, 100001], [1, 2, 3, 4, 5, 6]):
            request = self.recipe.model_dump()
            request["seeds"] = seeds
            with self.subTest(seeds=seeds), self.assertRaises(ExecutionGuardError):
                self.guard(recipe=request)
        request = self.recipe.model_dump()
        request["candidates"] *= 10
        with self.assertRaises(ExecutionGuardError):
            self.guard(recipe=request)

    def test_traversal_absolute_escape_and_shell_like_paths_are_rejected(self):
        paths = (
            "../outside.json", "run/../../outside.json", "run\\..\\outside.json",
            self.root.parent / "outside.json", "run/report.json:payload", "run;whoami",
            "run|powershell", "run/$(whoami)", "run/`whoami`", "run/\x00",
            "https://example.com/data", "\\\\server\\share\\data", "NUL.txt", "run/COM1", "",
        )
        for path in paths:
            with self.subTest(path=path), self.assertRaises(ExecutionGuardError):
                self.guard(paths={"output": path})

    def test_symlink_escape_is_rejected_after_resolution(self):
        with tempfile.TemporaryDirectory() as outside:
            link = self.root / "escape"
            try:
                link.symlink_to(outside, target_is_directory=True)
            except OSError:
                self.skipTest("Windows symlink privileges are unavailable")
            with self.assertRaises(ExecutionGuardError):
                self.guard(paths={"output": link / "result.json"})

    def test_path_list_supported_but_bare_string_and_empty_request_are_rejected(self):
        result = self.guard(paths=["run-1/result.json"])
        self.assertEqual(result["paths"]["0"], str(self.root / "run-1" / "result.json"))
        for paths in ("run-1/result.json", {}, []):
            with self.subTest(paths=paths), self.assertRaises(ExecutionGuardError):
                self.guard(paths=paths)


class CapabilityTests(unittest.TestCase):
    def test_missing_docker_still_allows_fixed_runner_and_no_process_starts(self):
        with patch("src.research.execution.shutil.which", return_value=None), \
             patch("src.research.execution._dependency_available", return_value=True), \
             patch("src.research.execution.subprocess.run") as command:
            report = capability_report()
            command.assert_not_called()
        self.assertTrue(report["fixed_runner"]["available"])
        self.assertFalse(report["fixed_runner"]["requires_docker"])
        self.assertFalse(report["docker"]["available"])
        self.assertFalse(report["arbitrary_code_sandbox"]["enabled"])

    def test_dependency_failure_is_reported(self):
        with patch("src.research.execution._dependency_available", side_effect=lambda name: name != "sklearn"):
            report = capability_report(probe_external=False)
        self.assertFalse(report["fixed_runner"]["available"])
        self.assertFalse(report["fixed_runner"]["dependencies"]["sklearn"])

    def test_available_daemon_does_not_enable_an_unconfigured_sandbox(self):
        def probe(command, **options):
            self.assertFalse(options["shell"])
            self.assertEqual(options["timeout"], 3)
            self.assertNotIn("start", command)
            self.assertNotIn("pull", command)
            if "info" in command:
                self.assertEqual(command[-1], "{{.ServerVersion}}")
                return subprocess.CompletedProcess(command, 0, stdout=b"29.2.0\n", stderr=b"")
            self.assertIn("--status", command)
            return subprocess.CompletedProcess(command, 0, stdout="WSL version: 2".encode("utf-16-le"), stderr=b"")

        with patch("src.research.execution.shutil.which", side_effect=lambda name: name), \
             patch("src.research.execution.sys.platform", "win32"), \
             patch("src.research.execution.subprocess.run", side_effect=probe):
            report = capability_report()
        self.assertTrue(report["docker"]["available"])
        self.assertEqual(report["docker"]["detail"], "29.2.0")
        self.assertFalse(report["docker"]["sandbox_enabled"])
        self.assertFalse(report["docker"]["execution_enabled"])
        self.assertFalse(report["arbitrary_code_execution"])
        self.assertEqual(report["wsl"]["detail"], "WSL version: 2")

    def test_timeout_and_unreachable_daemon_are_explicit(self):
        for failure in (subprocess.TimeoutExpired("docker", 3), subprocess.CompletedProcess("docker", 1, stdout=b"", stderr=b"daemon offline"), OSError("missing executable")):
            with self.subTest(failure=failure):
                with patch("src.research.execution.shutil.which", return_value="docker"), \
                     patch("src.research.execution.sys.platform", "linux"), \
                     patch("src.research.execution.subprocess.run", side_effect=failure if isinstance(failure, Exception) else None, return_value=failure):
                    report = capability_report()
                self.assertFalse(report["docker"]["available"])
                self.assertIn("error", report["docker"])

    def test_readonly_probe_can_be_disabled(self):
        with patch("src.research.execution.subprocess.run") as command:
            report = capability_report(probe_external=False)
        command.assert_not_called()
        self.assertEqual(report["docker"]["status"], "not_checked")
        self.assertFalse(report["arbitrary_code_execution"])


if __name__ == "__main__":
    unittest.main()
