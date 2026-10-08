"""A bounded, declarative digits robustness experiment; never executes model code.

The independent test split is opened only after validation-only selection is frozen.
Run this exact file snapshot to reproduce a completed experiment.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import importlib.metadata
import json
import platform
import shutil
import sys
import time
import warnings
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ModelRecipe(BaseModel):
    model_config = ConfigDict(extra="forbid")
    algorithm: Literal["logistic_regression", "random_forest"] = "logistic_regression"
    regularization_c: float = Field(default=1.0, ge=0.05, le=5)
    standardize: bool = True
    augmentation_std: float = Field(default=0.15, ge=0.02, le=0.4)
    trees: int = Field(default=64, ge=16, le=128)
    max_depth: int = Field(default=12, ge=3, le=20)


class ResearchRecipe(BaseModel):
    """Small schema for model-produced experiment configurations, not Python code."""
    model_config = ConfigDict(extra="forbid")
    dataset: Literal["sklearn_digits"] = "sklearn_digits"
    seeds: list[int] = Field(default_factory=lambda: [13, 37, 73], min_length=3, max_length=5)
    evaluation_noise_std: float = Field(default=0.25, ge=0.05, le=0.5)
    candidates: list[ModelRecipe] = Field(default_factory=lambda: [ModelRecipe(), ModelRecipe(augmentation_std=0.3)], min_length=1, max_length=3)

    @model_validator(mode="after")
    def validate_seeds(self):
        if len(set(self.seeds)) != len(self.seeds) or any(seed < 0 or seed > 100000 for seed in self.seeds):
            raise ValueError("seeds must be distinct integers between 0 and 100000")
        return self


def validate_recipe(data: dict | ResearchRecipe | None) -> ResearchRecipe:
    if isinstance(data, ResearchRecipe):
        if type(data) is not ResearchRecipe:
            raise ValueError("only the registered ResearchRecipe class is accepted")
        data = data.model_dump(mode="python")
    return ResearchRecipe.model_validate(data or {})


def recipe_json_schema() -> dict:
    return ResearchRecipe.model_json_schema()


def sha256_file(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def artifact(path: str | Path, kind: str) -> dict:
    path = Path(path).resolve()
    return {"kind": kind, "path": str(path), "sha256": sha256_file(path), "size_bytes": path.stat().st_size}


def write_json(path: Path, data: dict | list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    temporary.replace(path)


class ExperimentCancelled(RuntimeError):
    pass


def prepare_dataset(output_dir: str | Path, recipe: dict | ResearchRecipe | None = None) -> dict:
    """Prepare real digit data and index splits, without any model fit or test query."""
    import numpy as np
    from sklearn.datasets import load_digits
    from sklearn.model_selection import train_test_split

    recipe = validate_recipe(recipe)
    directory = Path(output_dir).resolve() / "experiments"
    directory.mkdir(parents=True, exist_ok=True)
    digits = load_digits()
    x, y = np.asarray(digits.data, dtype=np.float64) / 16.0, np.asarray(digits.target, dtype=np.int64)
    data_hash = hashlib.sha256(x.tobytes(order="C") + y.tobytes(order="C")).hexdigest()
    splits = {}
    for seed in recipe.seeds:
        # One global holdout: cross-seed validation must never include another
        # seed's final-test labels when selecting one shared candidate.
        train, held = train_test_split(np.arange(len(y)), test_size=0.4, random_state=2026, stratify=y)
        validation, test = train_test_split(held, test_size=0.5, random_state=2027, stratify=y[held])
        splits[str(seed)] = {"train": train.tolist(), "validation": validation.tolist(), "test": test.tolist()}
    split_path = directory / "splits.json"
    if split_path.exists() and json.loads(split_path.read_text(encoding="utf-8")) != splits:
        raise ValueError("prepared data split is immutable; use a new run for different seeds")
    if not split_path.exists():
        write_json(split_path, splits)
    description = {"dataset": "sklearn_digits", "samples": len(y), "features": x.shape[1], "classes": 10,
        "dataset_sha256": data_hash, "seeds": recipe.seeds, "split_sha256": sha256_file(split_path),
        "train_sizes": {seed: len(split["train"]) for seed, split in splits.items()},
        "validation_sizes": {seed: len(split["validation"]) for seed, split in splits.items()},
        "test_sizes": {seed: len(split["test"]) for seed, split in splits.items()},
        "test_opened": False, "source": "https://scikit-learn.org/stable/modules/generated/sklearn.datasets.load_digits.html",
        "split_seed": 2026, "data_policy": "bundled sklearn digits; no network download; one fixed stratified split shared by model/augmentation/corruption seeds; no final test metrics yet"}
    path = directory / "data_protocol.json"
    if not path.exists():
        write_json(path, description)
    return {"ok": True, "status": "completed", **description, "artifacts": [artifact(split_path, "data_splits"), artifact(path, "data_protocol")]}


def run_baseline(output_dir: str | Path, recipe: dict | ResearchRecipe | None = None, cancelled: Callable[[], bool] | None = None, *, deadline: float | None = None, before_fit: Callable[[], None] | None = None) -> dict:
    """A preliminary, fixed logistic baseline evaluated only on validation data."""
    import numpy as np
    from sklearn.datasets import load_digits
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import accuracy_score
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    recipe = validate_recipe(recipe)
    prepare_dataset(output_dir, recipe)
    directory = Path(output_dir).resolve() / "experiments"
    manifest = directory / "baseline.json"
    if manifest.exists():
        saved = json.loads(manifest.read_text(encoding="utf-8"))
        if saved.get("ok") and saved["seeds"] == recipe.seeds and saved["evaluation_noise_std"] == recipe.evaluation_noise_std:
            for item in saved["artifacts"]:
                if sha256_file(item["path"]) != item["sha256"]:
                    raise ValueError("baseline artifact hash mismatch")
            return {**saved, "manifest": artifact(manifest, "baseline_manifest"), "reused": True}
    digits = load_digits()
    x, y = np.asarray(digits.data, dtype=np.float64) / 16.0, np.asarray(digits.target, dtype=np.int64)
    splits = json.loads((directory / "splits.json").read_text(encoding="utf-8"))
    rows = []
    begin = time.monotonic()
    status, error, fit_count = "completed", None, 0
    try:
        for seed in recipe.seeds:
            if (cancelled and cancelled()) or (deadline is not None and time.monotonic() >= deadline):
                raise ExperimentCancelled("baseline cancelled/deadline at seed boundary")
            train, validation = np.asarray(splits[str(seed)]["train"]), np.asarray(splits[str(seed)]["validation"])
            model = make_pipeline(StandardScaler(), LogisticRegression(C=1.0, max_iter=350, solver="lbfgs", random_state=seed))
            if before_fit:
                before_fit()
            fit_begin = time.monotonic()
            model.fit(x[train], y[train])
            fit_count += 1
            elapsed = time.monotonic() - fit_begin
            rng = np.random.default_rng(seed + 3000)
            noisy = np.clip(x[validation] + rng.normal(0, recipe.evaluation_noise_std, x[validation].shape), 0, 1)
            for condition, values in (("clean", x[validation]), ("gaussian_noise", noisy)):
                rows.append({"seed": seed, "split": "validation", "condition": condition, "accuracy": float(accuracy_score(y[validation], model.predict(values))), "fit_seconds": elapsed})
    except ExperimentCancelled as exc:
        status, error = "cancelled", str(exc)
    except Exception as exc:
        status, error = "failed", f"{type(exc).__name__}: {exc}"
    csv_path = directory / "baseline_validation.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]) if rows else ["seed", "split", "condition", "accuracy", "fit_seconds"])
        writer.writeheader()
        writer.writerows(rows)
    result = {"ok": status == "completed", "status": status, "error": error, "fit_count": fit_count, "seeds": recipe.seeds, "evaluation_noise_std": recipe.evaluation_noise_std,
        "role": "preliminary_fixed_logistic_baseline_validation", "test_opened": False,
        "configuration": {"algorithm": "logistic_regression", "regularization_c": 1.0, "standardize": True, "augmentation": False},
        "validation_noise_accuracy_mean": float(np.mean([row["accuracy"] for row in rows if row["condition"] == "gaussian_noise"])) if rows else None,
        "duration_seconds": time.monotonic() - begin, "artifacts": [artifact(csv_path, "baseline_validation_csv")]}
    write_json(manifest, result)
    return {**result, "manifest": artifact(manifest, "baseline_manifest"), "reused": False}


def confirm_results(output_dir: str | Path, recipe: dict | ResearchRecipe | None = None, cancelled: Callable[[], bool] | None = None, *, max_trials: int | None = None, deadline: float | None = None, before_fit: Callable[[], None] | None = None) -> dict:
    return run_experiments(output_dir, recipe, cancelled, max_trials=max_trials, deadline=deadline, phase="confirm", before_fit=before_fit)


def run_experiments(
    output_dir: str | Path,
    recipe: dict | ResearchRecipe | None = None,
    cancelled: Callable[[], bool] | None = None,
    *,
    max_trials: int | None = None,
    deadline: float | None = None,
    phase: Literal["all", "search", "confirm"] = "all",
    before_fit: Callable[[], None] | None = None,
) -> dict:
    """Execute declared recipes. ``deadline`` is an absolute time.monotonic value.

    A trial is one estimator fit. Required fits are checked before running: candidate
    search for all seeds plus a matched control for each seed. Cancellation and time
    limits apply between fits, not inside sklearn's bounded fit call.
    """
    import numpy as np
    from sklearn.datasets import load_digits
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import accuracy_score, f1_score
    from sklearn.model_selection import train_test_split
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    recipe = validate_recipe(recipe)
    if phase not in ("all", "search", "confirm"):
        raise ValueError("invalid experiment phase")
    needed_trials = len(recipe.seeds) * (2 if phase == "confirm" else len(recipe.candidates) + 1)
    if max_trials is not None and needed_trials > max_trials:
        raise ValueError(f"protocol requires {needed_trials} fits; budget permits {max_trials}")
    directory = Path(output_dir).resolve() / "experiments"
    directory.mkdir(parents=True, exist_ok=True)
    result_path = directory / ("search.json" if phase == "search" else "experiment.json")
    # Completed results are immutable: a subsequent attempt gets a new run directory.
    previous = None
    if result_path.exists():
        saved = json.loads(result_path.read_text(encoding="utf-8"))
        previous = saved
        if saved.get("recipe") != recipe.model_dump():
            raise ValueError("existing experiment recipe cannot change in the same run")
        if saved.get("status") == "completed":
            if saved.get("recipe") != recipe.model_dump():
                raise ValueError("this run already has a frozen experiment with a different recipe")
            for record in saved["artifacts"]:
                if sha256_file(record["path"]) != record["sha256"]:
                    raise ValueError(f"existing experiment artifact changed: {record['path']}")
            return {**saved, "manifest": artifact(result_path, "experiment_manifest"), "reused": True}
    started = time.monotonic()
    data = load_digits()
    x = np.asarray(data.data, dtype=np.float64) / 16.0
    y = np.asarray(data.target, dtype=np.int64)
    indices = np.arange(len(y))
    data_hash = hashlib.sha256(x.tobytes(order="C") + y.tobytes(order="C")).hexdigest()
    splits = {}
    for seed in recipe.seeds:
        train, held = train_test_split(indices, test_size=0.4, random_state=2026, stratify=y)
        validation, test = train_test_split(held, test_size=0.5, random_state=2027, stratify=y[held])
        assert not (set(train) & set(validation) or set(train) & set(test) or set(validation) & set(test))
        splits[str(seed)] = {"train": train.tolist(), "validation": validation.tolist(), "test": test.tolist()}
    prepare_dataset(output_dir, recipe)
    write_json(directory / "recipe.json", recipe.model_dump())
    shutil.copyfile(Path(__file__), directory / "fixed_runner.py")
    versions = {}
    for name in ("numpy", "scikit-learn", "scipy", "pydantic", "matplotlib"):
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            versions[name] = "not_installed"
    write_json(directory / "environment.json", {"python": sys.version, "platform": platform.platform(), "packages": versions})
    (directory / "requirements-reproduce.txt").write_text("\n".join(f"{name}=={version}" for name, version in versions.items() if version != "not_installed") + "\n", encoding="utf-8")
    protocol = {
        "version": 1, "prepared_utc": datetime.now(timezone.utc).isoformat(),
        "dataset": "sklearn.datasets.load_digits (UCI handwritten digits, 1797 samples, 8x8 pixels)",
        "dataset_documentation": "https://scikit-learn.org/stable/modules/generated/sklearn.datasets.load_digits.html",
        "data_sha256": data_hash, "recipe_sha256": sha256_file(directory / "recipe.json"),
        "split_sha256": sha256_file(directory / "splits.json"), "code_sha256": sha256_file(directory / "fixed_runner.py"),
        "split_rule": "one fixed stratified 60% train, 20% validation, 20% test split (2026/2027), shared across random seeds; test indices never appear in any training or validation subset",
        "random_seed_effect": "estimator randomness, training augmentation, validation/test Gaussian draws; data split is fixed",
        "preprocessing": "pixel / 16; optional scaler fitted on train only",
        "augmentation": "one clipped Gaussian-noisy copy of training examples, concatenated with clean train; labels unchanged",
        "selection": "highest mean Gaussian-noise validation accuracy across all seeds; tie uses earliest candidate",
        "test_policy": "candidate configuration and selected index frozen before any test predictions; each model evaluated once per seed and condition",
        "control": "selected candidate's exact algorithm and hyperparameters without noisy augmentation; baseline and ablation are the same matched control",
        "evaluation": "clean and clipped Gaussian noise; identical noisy inputs for paired models; accuracy and macro F1",
        "fit_budget": {"needed": needed_trials, "allowed": max_trials},
        "scope": "fixed bounded sklearn runner, declarative configurations; no generated Python or arbitrary repository execution",
        "limitations": ["Small benchmark, synthetic corruption, CPU experiments, limited recipe search.", "Seeds share one held-out sample set: reported seed SD is descriptive and not an independent statistical confidence interval.", "Augmentation doubles training examples; fit times and train counts are reported, so this is not equal-compute proof.", "No global novelty or publication quality assessment."],
    }
    if phase == "confirm":
        search_path = directory / "search.json"
        if not search_path.exists():
            raise ValueError("confirm requires a completed validation search")
        search_result = json.loads(search_path.read_text(encoding="utf-8"))
        if search_result.get("status") != "completed" or search_result.get("test_opened") or search_result.get("recipe") != recipe.model_dump():
            raise ValueError("validation search is incomplete, changed, or already exposed the test")
        for item in search_result["artifacts"]:
            if sha256_file(item["path"]) != item["sha256"]:
                raise ValueError("frozen validation artifact hash mismatch")
    else:
        write_json(directory / "protocol.json", protocol)
    metric_rows: list[dict] = []
    prediction_rows: list[dict] = []
    if previous and previous.get("test_opened"):
        # Same frozen configuration only. Preserve completed seed tests when resuming.
        for filename, target in (("metrics.csv", metric_rows), ("predictions.csv", prediction_rows)):
            path = directory / filename
            if path.exists():
                with path.open(encoding="utf-8", newline="") as stream:
                    for row in csv.DictReader(stream):
                        for key in ("seed", "training_examples", "evaluation_examples", "sample_index", "y_true", "y_pred"):
                            if key in row:
                                row[key] = int(row[key])
                        for key in ("accuracy", "macro_f1", "fit_seconds"):
                            if key in row:
                                row[key] = float(row[key])
                        target.append(row)
    warnings_list: list[str] = []
    fit_count = 0

    def boundary():
        if cancelled and cancelled():
            raise ExperimentCancelled("cancel requested at experiment step boundary")
        if deadline is not None and time.monotonic() >= deadline:
            raise ExperimentCancelled("experiment deadline reached at step boundary")

    def fit(config: ModelRecipe, seed: int, augmented: bool):
        nonlocal fit_count
        boundary()
        ids = np.asarray(splits[str(seed)]["train"])
        train_x, train_y = x[ids], y[ids]
        if augmented:
            rng = np.random.default_rng(seed + 2000)
            noisy = np.clip(train_x + rng.normal(0, config.augmentation_std, train_x.shape), 0, 1)
            train_x = np.concatenate([train_x, noisy])
            train_y = np.concatenate([train_y, train_y])
        if config.algorithm == "logistic_regression":
            estimator = LogisticRegression(C=config.regularization_c, max_iter=350, solver="lbfgs", random_state=seed)
        else:
            estimator = RandomForestClassifier(n_estimators=config.trees, max_depth=config.max_depth, random_state=seed, n_jobs=1)
        model = make_pipeline(StandardScaler(), estimator) if config.standardize else estimator
        if before_fit:
            before_fit()
        begin = time.monotonic()
        with warnings.catch_warnings(record=True) as captured:
            warnings.simplefilter("always")
            model.fit(train_x, train_y)
        warnings_list.extend(str(item.message) for item in captured)
        fit_count += 1
        return model, time.monotonic() - begin, len(train_y)

    def evaluate(model, seed, split, label, elapsed, train_count, keep_predictions=False):
        ids = np.asarray(splits[str(seed)][split])
        clean = x[ids]
        rng = np.random.default_rng(seed + (3000 if split == "validation" else 4000))
        noisy = np.clip(clean + rng.normal(0, recipe.evaluation_noise_std, clean.shape), 0, 1)
        scores = {}
        for condition, inputs in (("clean", clean), ("gaussian_noise", noisy)):
            predicted = model.predict(inputs)
            accuracy = float(accuracy_score(y[ids], predicted))
            macro_f1 = float(f1_score(y[ids], predicted, average="macro", zero_division=0))
            metric_rows.append({"model": label, "seed": seed, "split": split, "condition": condition, "accuracy": accuracy, "macro_f1": macro_f1, "fit_seconds": elapsed, "training_examples": train_count, "evaluation_examples": len(ids)})
            scores[condition] = accuracy
            if keep_predictions:
                prediction_rows.extend({"model": label, "seed": seed, "split": split, "condition": condition, "sample_index": int(index), "y_true": int(actual), "y_pred": int(pred)} for index, actual, pred in zip(ids, y[ids], predicted))
        return scores

    models = {}
    validation_scores = [[] for _ in recipe.candidates]
    status, error = "completed", None
    selected_index = None
    try:
        if phase == "confirm":
            selection = json.loads((directory / "selection.json").read_text(encoding="utf-8"))
            selected_index = selection["selected_index"]
            if selection["selected_recipe"] != recipe.candidates[selected_index].model_dump():
                raise ValueError("selection does not match the frozen recipe")
        else:
            for seed in recipe.seeds:
                for index, config in enumerate(recipe.candidates):
                    model, elapsed, count = fit(config, seed, True)
                    models[(seed, index)] = (model, elapsed, count)
                    scores = evaluate(model, seed, "validation", f"candidate_{index}", elapsed, count, True)
                    validation_scores[index].append(scores["gaussian_noise"])
            selected_index = int(np.argmax([np.mean(scores) for scores in validation_scores]))
            selection = {"selected_index": selected_index, "selected_recipe": recipe.candidates[selected_index].model_dump(), "selection_metric": "mean corrupted validation accuracy", "validation_means": [float(np.mean(values)) for values in validation_scores], "frozen_before_test": True, "frozen_utc": datetime.now(timezone.utc).isoformat()}
            write_json(directory / "selection.json", selection)
        boundary()
        # The control is fitted after selection; it never influences model choice.
        for seed in recipe.seeds:
            if phase != "search" and len([r for r in metric_rows if r["seed"] == seed and r["split"] == "test"]) == 6:
                continue
            config = recipe.candidates[selected_index]
            control, elapsed, count = fit(config, seed, False)
            if phase == "confirm":
                selected, selected_elapsed, selected_count = fit(config, seed, True)
            else:
                selected, selected_elapsed, selected_count = models[(seed, selected_index)]
            for split in (("validation",) if phase == "search" else ("validation", "test") if phase == "all" else ("test",)):
                evaluate(control, seed, split, "baseline", elapsed, count, True)
                # Ablation is explicitly an alias to the matched baseline, not a new independent result.
                evaluate(control, seed, split, "ablation_no_augmentation", elapsed, count, True)
            if phase != "search":
                evaluate(selected, seed, "test", "selected_candidate", selected_elapsed, selected_count, True)
    except ExperimentCancelled as exc:
        status, error = "cancelled", str(exc)
    except Exception as exc:
        status, error = "failed", f"{type(exc).__name__}: {exc}"
    suffix = "_search" if phase == "search" else ""
    for filename, rows in ((f"metrics{suffix}.csv", metric_rows), (f"predictions{suffix}.csv", prediction_rows)):
        with (directory / filename).open("w", encoding="utf-8", newline="") as stream:
            if rows:
                writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
                writer.writeheader()
                writer.writerows(rows)
    summary = []
    for label in ("baseline", "selected_candidate", "ablation_no_augmentation"):
        for condition in ("clean", "gaussian_noise"):
            rows = [row for row in metric_rows if row["model"] == label and row["split"] == "test" and row["condition"] == condition]
            if rows:
                values = [row["accuracy"] for row in rows]
                summary.append({"model": label, "condition": condition, "accuracy_mean": float(np.mean(values)), "accuracy_sd": float(np.std(values, ddof=1)) if len(values) > 1 else 0.0, "macro_f1_mean": float(np.mean([row["macro_f1"] for row in rows])), "seeds_completed": len(rows)})
    plot_status = "not_generated"
    if status == "completed" and phase != "search":
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            figure, axes = plt.subplots(figsize=(7, 4), constrained_layout=True)
            for offset, label in ((-0.16, "baseline"), (0.16, "selected_candidate")):
                rows = [row for row in summary if row["model"] == label]
                axes.bar(np.arange(2) + offset, [row["accuracy_mean"] for row in rows], width=0.32, yerr=[row["accuracy_sd"] for row in rows], capsize=4, label=label.replace("_", " "))
            axes.set_xticks([0, 1], ["Clean test", "Gaussian-noise test"])
            axes.set_ylim(0, 1)
            axes.set_ylabel("Accuracy (mean; error bars = seed SD)")
            axes.legend(loc="lower left")
            figure.savefig(directory / "robustness.png", dpi=160)
            plt.close(figure)
            plot_status = "generated"
        except Exception as exc:
            plot_status = f"failed: {type(exc).__name__}: {exc}"
    result = {
        "ok": status == "completed", "status": status, "error": error,
        "phase": phase,
        "domain": "digits_classification_robustness", "execution_scope": protocol["scope"],
        "recipe": recipe.model_dump(), "dataset_sha256": data_hash,
        "selected_index": selected_index, "test_opened": any(row["split"] == "test" for row in metric_rows),
        "test_policy": protocol["test_policy"], "fit_count": fit_count,
        "summary": summary, "plot_status": plot_status, "warnings": sorted(set(warnings_list)),
        "novelty_status": "novelty_unverified", "external_quality": "not_evaluated",
        "limitations": protocol["limitations"], "duration_seconds": time.monotonic() - started,
        "artifacts": [artifact(path, path.suffix.lstrip(".")) for path in sorted(directory.iterdir()) if path.is_file() and path != result_path and path.name not in ("experiment.json", "search.json") and not path.name.endswith(".tmp")],
    }
    write_json(result_path, result)
    # experiment.json is the manifest; it cannot include its own recursive hash.
    return {**result, "manifest": artifact(result_path, "experiment_manifest"), "reused": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--recipe")
    arguments = parser.parse_args()
    configuration = json.loads(Path(arguments.recipe).read_text(encoding="utf-8")) if arguments.recipe else None
    print(json.dumps(run_experiments(arguments.output, configuration), ensure_ascii=False, indent=2))
