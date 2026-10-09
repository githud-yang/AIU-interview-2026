"""Execution boundaries for the registered, declarative research runner.

The runner executes trusted project code on the host. Validation narrows the
inputs it accepts; neither validation, a thread nor a subprocess is a sandbox.
Docker detection only reports availability and never starts a service or pulls
an image. Arbitrary model-generated code execution is disabled in this version.
"""
from __future__ import annotations

import importlib.util
import locale
import shutil
import subprocess
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path, PureWindowsPath
from typing import Any

from pydantic import BaseModel, ValidationError


REGISTERED_RUNNERS = ("digits_robustness", "yolo_tradeoff")
REGISTERED_ALGORITHMS = ("logistic_regression", "random_forest")
EXECUTION_NOTICE = "固定领域runner，未启用任意模型生成代码沙箱"
DEFAULT_EXECUTION_ROOT = Path(__file__).resolve().parents[2] / "logs" / "research"
_PROBE_TIMEOUT_SECONDS = 3
_FORBIDDEN_RECIPE_KEYS = frozenset({
    "shell", "command", "commands", "argv", "code", "python_code", "script",
    "script_path", "executable", "cwd", "workdir", "working_directory", "path",
    "paths", "input_path", "output_path", "output_dir", "dataset_path",
    "environment", "env", "pip", "install", "requirements", "imports",
})


class ExecutionGuardError(ValueError):
    """A request is outside the registered runner's input boundary."""


def _dependency_available(module_name: str) -> bool:
    try:
        return importlib.util.find_spec(module_name) is not None
    except (ImportError, ValueError):
        return False


def _decode_probe(data: bytes | str | None) -> str:
    if isinstance(data, str):
        return data.strip()
    if not data:
        return ""
    # wsl.exe emits UTF-16 on some Windows releases, local code pages on others.
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16", errors="replace").strip()
    if b"\x00" in data[:100]:
        return data.decode("utf-16-le", errors="replace").strip()
    encodings = ("utf-8", locale.getpreferredencoding(False), "cp936")
    for encoding in encodings:
        try:
            return data.decode(encoding).strip()
        except (UnicodeDecodeError, LookupError):
            pass
    return data.decode("utf-8", errors="replace").strip()


def _readonly_probe(executable: str, arguments: list[str]) -> dict[str, Any]:
    resolved = shutil.which(executable)
    report: dict[str, Any] = {
        "installed": resolved is not None,
        "available": False,
        "status": "not_installed" if resolved is None else "not_checked",
        "timeout_seconds": _PROBE_TIMEOUT_SECONDS,
    }
    if resolved is None:
        return report
    options: dict[str, Any] = {}
    if sys.platform == "win32":
        options["creationflags"] = subprocess.CREATE_NO_WINDOW
    try:
        result = subprocess.run(
            [resolved, *arguments],
            shell=False,
            capture_output=True,
            timeout=_PROBE_TIMEOUT_SECONDS,
            check=False,
            **options,
        )
    except subprocess.TimeoutExpired:
        report.update(status="timeout", error="只读能力探测超过3秒")
        return report
    except OSError as exc:
        report.update(status="probe_error", error=str(exc)[:512])
        return report
    report.update(
        available=result.returncode == 0,
        status="available" if result.returncode == 0 else "unavailable",
        returncode=result.returncode,
    )
    # Deliberately avoid docker's full info JSON: it contains host configuration.
    if result.returncode == 0:
        report["detail"] = _decode_probe(result.stdout)[:512]
    else:
        report["error"] = (_decode_probe(result.stderr) or _decode_probe(result.stdout))[:512]
    return report


def capability_report(*, probe_external: bool = True) -> dict[str, Any]:
    """Report what is available, without enabling arbitrary code execution.

    Docker's server-version query and WSL status query each have a three-second
    timeout. A reachable Docker daemon is a prerequisite for a future Docker
    executor, not proof that image, limits, mounts or isolation are configured.
    """
    dependencies = {
        name: _dependency_available(name)
        for name in ("numpy", "scipy", "sklearn", "matplotlib", "pydantic")
    }
    if probe_external:
        docker = _readonly_probe("docker", ["info", "--format", "{{.ServerVersion}}"])
        wsl = _readonly_probe("wsl", ["--status"]) if sys.platform == "win32" else {
            "installed": False, "available": False, "status": "not_applicable",
        }
    else:
        docker = {
            "installed": shutil.which("docker") is not None,
            "available": False, "status": "not_checked",
        }
        wsl = {
            "installed": shutil.which("wsl") is not None,
            "available": False, "status": "not_checked",
        }
    docker["sandbox_enabled"] = False
    docker["execution_enabled"] = False
    docker["note"] = "仅探测daemon可达性；未配置或启用镜像、挂载、资源及网络隔离策略"
    return {
        "mode": "fixed_runner",
        "notice": EXECUTION_NOTICE,
        "python_version": sys.version.split()[0],
        "platform": {"win32": "Windows", "darwin": "Darwin"}.get(sys.platform, sys.platform),
        "fixed_runner": {
            "available": all(dependencies.values()),
            "registered_runners": list(REGISTERED_RUNNERS),
            "registered_algorithms": list(REGISTERED_ALGORITHMS),
            "dependencies": dependencies,
            "requires_docker": False,
            "device": "cpu",
            "isolation": "trusted_host_code_with_validated_declarative_inputs",
        },
        "arbitrary_code_execution": False,
        "arbitrary_code_sandbox": {"enabled": False, "reason": EXECUTION_NOTICE},
        "docker": docker,
        "wsl": wsl,
    }


def _reject_execution_fields(value: Any, *, depth: int = 0) -> None:
    if depth > 8:
        raise ExecutionGuardError("声明式配方嵌套过深")
    if isinstance(value, Mapping):
        for key, child in value.items():
            if not isinstance(key, str):
                raise ExecutionGuardError("配方字段名称必须是字符串")
            normalized = key.lower().replace("-", "_")
            if normalized in _FORBIDDEN_RECIPE_KEYS:
                raise ExecutionGuardError(f"声明式配方不允许执行或路径字段: {key}")
            _reject_execution_fields(child, depth=depth + 1)
    elif isinstance(value, (list, tuple)):
        for child in value:
            _reject_execution_fields(child, depth=depth + 1)
    elif not isinstance(value, (str, int, float, bool, type(None))):
        raise ExecutionGuardError("配方字段只允许JSON声明值，不能包含可执行对象")


def _validated_recipe(recipe: BaseModel | Mapping[str, Any]) -> dict[str, Any]:
    # This import is the registration boundary: accepting an arbitrary BaseModel
    # would let a caller define a permissive schema or use model_construct().
    from .domain import ResearchRecipe

    if isinstance(recipe, BaseModel):
        if type(recipe) is not ResearchRecipe:
            raise ExecutionGuardError("只允许已登记的ResearchRecipe类型")
        raw = recipe.model_dump(mode="python")
    elif isinstance(recipe, Mapping):
        raw = dict(recipe)
    else:
        raise ExecutionGuardError("配方必须为ResearchRecipe或可校验的字段对象")
    _reject_execution_fields(raw)
    try:
        # Dump-and-validate also validates instances built without validation.
        validated = ResearchRecipe.model_validate(raw)
    except (ValidationError, TypeError, ValueError) as exc:
        raise ExecutionGuardError(f"配方schema校验失败: {exc}") from exc
    normalized = validated.model_dump(mode="json")
    if any(candidate["algorithm"] not in REGISTERED_ALGORITHMS for candidate in normalized["candidates"]):
        raise ExecutionGuardError("算法未登记")
    return normalized


def _guarded_path(raw_path: str | Path, root: Path) -> Path:
    if not isinstance(raw_path, (str, Path)):
        raise ExecutionGuardError("路径必须为字符串或Path")
    value = str(raw_path)
    if not value.strip() or any(ord(character) < 32 for character in value):
        raise ExecutionGuardError("路径为空或包含控制字符")
    normalized = value.replace("\\", "/")
    if normalized.startswith("//") or "://" in value:
        raise ExecutionGuardError("不允许网络路径或URL")
    if ".." in normalized.split("/"):
        raise ExecutionGuardError("不允许父目录路径跳转")
    # Windows alternate data streams and shell-like path inputs are unnecessary
    # for the registered runner. A drive-letter colon is the only allowed colon.
    windows_path = PureWindowsPath(value)
    without_drive = value[len(windows_path.drive):]
    if ":" in without_drive or any(c in value for c in (";", "|", "&", "<", ">", "`", "$")):
        raise ExecutionGuardError("路径包含不允许的操作符或数据流名称")
    reserved = {"CON", "PRN", "AUX", "NUL"} | {
        f"{prefix}{number}" for prefix in ("COM", "LPT") for number in range(1, 10)
    }
    for part in normalized.split("/"):
        if part.rstrip(" .").split(".")[0].upper() in reserved:
            raise ExecutionGuardError("不允许Windows设备路径")
    candidate = Path(value)
    if not candidate.is_absolute():
        candidate = root / candidate
    try:
        resolved = candidate.resolve(strict=False)
        resolved.relative_to(root)
    except (OSError, RuntimeError, ValueError) as exc:
        raise ExecutionGuardError("路径不在允许的研究工作区内") from exc
    return resolved


def declarative_execution_guard(
    recipe: BaseModel | Mapping[str, Any],
    paths: Mapping[str, str | Path] | Sequence[str | Path],
    *,
    allowed_root: str | Path | None = None,
    runner: str = "digits_robustness",
) -> dict[str, Any]:
    """Validate registered recipe and server-supplied workspace paths only.

    ``allowed_root`` is server configuration, never a model-provided field. The
    guard creates no files and runs no commands. ``paths`` can be a role/path
    mapping or a sequence; relative paths are relative to the allowed root.
    Existing symlinks/junctions are resolved before the containment check. This
    is a trusted-host input boundary, not isolation from concurrent filesystem
    changes or a sandbox for arbitrary generated code.
    """
    if runner not in REGISTERED_RUNNERS:
        raise ExecutionGuardError("runner未登记")
    validated = _validated_recipe(recipe)
    root = Path(allowed_root or DEFAULT_EXECUTION_ROOT).resolve(strict=False)
    if isinstance(paths, Mapping):
        entries = paths.items()
    elif isinstance(paths, Sequence) and not isinstance(paths, (str, bytes)):
        entries = ((str(index), path) for index, path in enumerate(paths))
    else:
        raise ExecutionGuardError("paths必须为路径映射或路径列表")
    resolved_paths: dict[str, str] = {}
    for role, raw_path in entries:
        if not isinstance(role, str) or not role or len(role) > 64:
            raise ExecutionGuardError("路径角色名称无效")
        resolved_paths[role] = str(_guarded_path(raw_path, root))
    if not resolved_paths:
        raise ExecutionGuardError("至少提供一个受限工作区路径")
    return {
        "allowed": True,
        "runner": runner,
        "mode": "fixed_runner",
        "recipe": validated,
        "allowed_root": str(root),
        "paths": resolved_paths,
        "arbitrary_code_execution": False,
        "notice": EXECUTION_NOTICE,
    }
