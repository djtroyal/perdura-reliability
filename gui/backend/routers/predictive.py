"""Predictive analytics with split-safe preprocessing and validation.

Categorical predictors retain categorical semantics: sklearn estimators receive
one-hot columns fitted inside each training fold, while CHAID receives the raw
categories and learns numeric bin edges from training data only.  Validation
can be random, stratified, grouped, or forward-in-time, and every response
states the strategy, preprocessing, convergence, and available calibration
diagnostics.
"""

import logging
import math
import sys
import warnings
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sklearn.base import clone
from sklearn.calibration import calibration_curve
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import (
    AdaBoostClassifier,
    AdaBoostRegressor,
    GradientBoostingClassifier,
    GradientBoostingRegressor,
    RandomForestClassifier,
    RandomForestRegressor,
)
from sklearn.exceptions import ConvergenceWarning
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    balanced_accuracy_score,
    brier_score_loss,
    confusion_matrix,
    log_loss,
    mean_absolute_error,
    mean_squared_error,
    precision_recall_fscore_support,
    r2_score,
    roc_auc_score,
)
from sklearn.model_selection import GroupKFold, GroupShuffleSplit, KFold, StratifiedKFold, TimeSeriesSplit
from sklearn.neighbors import KNeighborsClassifier, KNeighborsRegressor
from sklearn.neural_network import MLPClassifier, MLPRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import LabelEncoder, OneHotEncoder, StandardScaler
from sklearn.svm import SVC, SVR
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor, export_text

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.CHAID import CHAIDTree

router = APIRouter()
logger = logging.getLogger(__name__)

ModelName = Literal[
    "decision_tree", "chaid", "random_forest", "gradient_boosting",
    "svm", "knn", "adaboost", "mlp",
]
TaskName = Literal["classification", "regression"]
SplitName = Literal["auto", "random", "stratified", "group", "time"]


class FitRequest(BaseModel):
    model: ModelName = "decision_tree"
    task: Optional[TaskName] = None
    data: Dict[str, List[Any]]
    target: str
    features: List[str]
    test_size: float = Field(0.25, gt=0, lt=1)
    params: Optional[Dict[str, Any]] = None
    split_strategy: SplitName = "auto"
    group_column: Optional[str] = None
    time_column: Optional[str] = None
    seed: int = 42


class CompareRequest(BaseModel):
    task: Optional[TaskName] = None
    data: Dict[str, List[Any]]
    target: str
    features: List[str]
    test_size: float = Field(0.25, gt=0, lt=1)
    split_strategy: SplitName = "auto"
    group_column: Optional[str] = None
    time_column: Optional[str] = None
    seed: int = 42


class PredictRequest(BaseModel):
    model: ModelName = "decision_tree"
    task: Optional[TaskName] = None
    data: Dict[str, List[Any]]
    target: str
    features: List[str]
    params: Optional[Dict[str, Any]] = None
    input: Dict[str, Any] = {}


class PredictBatchRequest(BaseModel):
    model: ModelName = "decision_tree"
    task: Optional[TaskName] = None
    data: Dict[str, List[Any]]
    target: str
    features: List[str]
    params: Optional[Dict[str, Any]] = None
    inputs: List[Dict[str, Any]]


def _safe(obj):
    if isinstance(obj, float):
        return None if math.isnan(obj) or math.isinf(obj) else obj
    if isinstance(obj, np.floating):
        return _safe(float(obj))
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.ndarray):
        return [_safe(v) for v in obj.tolist()]
    if isinstance(obj, dict):
        return {k: _safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_safe(v) for v in obj]
    return obj


def _detect_task(y: np.ndarray) -> str:
    """Few integer levels or a nonnumeric target implies classification."""
    try:
        yf = y.astype(float)
    except (ValueError, TypeError):
        return "classification"
    uniq = np.unique(yf)
    if uniq.size <= max(2, int(0.1 * len(yf))) and np.all(uniq == uniq.astype(int)):
        return "classification"
    return "regression"


def _build_matrix(data: Dict[str, List[Any]], features: List[str], target: str):
    if target not in data:
        raise ValueError(f"Column '{target}' not in data.")
    if not features:
        raise ValueError("Select at least one predictor feature.")
    if len(set(features)) != len(features):
        raise ValueError("Predictor feature names must be unique.")
    if target in features:
        raise ValueError("The target column cannot also be a predictor feature.")

    n = len(data[target])
    for name in features + [target]:
        if name not in data:
            raise ValueError(f"Column '{name}' not in data.")
        if len(data[name]) != n:
            raise ValueError("All selected columns must have equal length.")

    keep = [
        i for i in range(n)
        if all(data[c][i] is not None and str(data[c][i]).strip() != ""
               for c in features + [target])
    ]
    if len(keep) < 4:
        raise ValueError("Need at least 4 complete rows.")

    frame = pd.DataFrame({name: [data[name][i] for i in keep] for name in features})
    numeric: list[str] = []
    categorical: list[str] = []
    for name in features:
        converted = pd.to_numeric(frame[name], errors="coerce")
        if converted.notna().all():
            values = converted.to_numpy(dtype=float)
            if not np.all(np.isfinite(values)):
                raise ValueError(f"Numeric feature '{name}' contains a non-finite value.")
            frame[name] = values
            numeric.append(name)
        else:
            frame[name] = frame[name].astype(str)
            categorical.append(name)

    y_raw = np.asarray([data[target][i] for i in keep])
    schema = {
        "feature_names": list(features),
        "numeric_features": numeric,
        "categorical_features": categorical,
        "row_indices": keep,
        "n_rows_original": n,
        "n_rows_dropped": n - len(keep),
    }
    return frame, y_raw, schema


def _preprocessing_metadata(schema: dict, model: str) -> dict:
    return {
        "numeric_features": schema["numeric_features"],
        "categorical_features": schema["categorical_features"],
        "categorical_encoding": "native categories with train-only binning" if model == "chaid" else "one-hot, fit on training data only",
        "unknown_category_handling": "node fallback" if model == "chaid" else "ignored as all-zero one-hot group",
        "numeric_scaling": (
            "standardized on training data only" if model in {"svm", "knn", "mlp"}
            else "model-specific (SVM/KNN/MLP standardize inside each training fold)" if model == "model-specific"
            else "not required for this estimator"
        ),
        "rows_dropped_for_missing_values": schema["n_rows_dropped"],
    }


def _make_model(model: str, task: str, params: Optional[dict], schema: dict):
    p = dict(params or {})
    if model == "decision_tree":
        estimator = (DecisionTreeClassifier if task == "classification" else DecisionTreeRegressor)(random_state=42, **p)
    elif model == "random_forest":
        cls = RandomForestClassifier if task == "classification" else RandomForestRegressor
        p.setdefault("n_estimators", 100)
        estimator = cls(random_state=42, **p)
    elif model == "gradient_boosting":
        cls = GradientBoostingClassifier if task == "classification" else GradientBoostingRegressor
        estimator = cls(random_state=42, **p)
    elif model == "svm":
        estimator = SVC(random_state=42, probability=True, **p) if task == "classification" else SVR(**p)
    elif model == "knn":
        estimator = (KNeighborsClassifier if task == "classification" else KNeighborsRegressor)(**p)
    elif model == "adaboost":
        cls = AdaBoostClassifier if task == "classification" else AdaBoostRegressor
        estimator = cls(random_state=42, **p)
    elif model == "mlp":
        cls = MLPClassifier if task == "classification" else MLPRegressor
        p.setdefault("max_iter", 2000)
        estimator = cls(random_state=42, **p)
    else:
        raise ValueError(f"Unknown model: {model}")

    scale = model in {"svm", "knn", "mlp"}
    transformers = []
    if schema["numeric_features"]:
        transformers.append((
            "numeric",
            StandardScaler() if scale else "passthrough",
            schema["numeric_features"],
        ))
    if schema["categorical_features"]:
        transformers.append((
            "categorical",
            OneHotEncoder(handle_unknown="ignore", sparse_output=False),
            schema["categorical_features"],
        ))
    preprocess = ColumnTransformer(
        transformers=transformers,
        remainder="drop",
        sparse_threshold=0.0,
        verbose_feature_names_out=True,
    )
    return Pipeline([("preprocess", preprocess), ("estimator", estimator)])


def _fit_with_diagnostics(model, X, y):
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always", ConvergenceWarning)
        model.fit(X, y)
    convergence_messages = [str(w.message) for w in caught if issubclass(w.category, ConvergenceWarning)]
    estimator = model.named_steps["estimator"] if isinstance(model, Pipeline) else model
    n_iter_raw = getattr(estimator, "n_iter_", None)
    if n_iter_raw is None:
        n_iter = None
    else:
        arr = np.asarray(n_iter_raw)
        n_iter = int(np.max(arr)) if arr.size else None
    fit_status = getattr(estimator, "fit_status_", 0)
    converged = not convergence_messages and fit_status == 0
    if fit_status != 0 and not convergence_messages:
        convergence_messages.append(f"Estimator fit_status_={fit_status} indicates non-convergence.")
    return {
        "converged": bool(converged),
        "n_iter": n_iter,
        "max_iter": getattr(estimator, "max_iter", None),
        "warnings": convergence_messages,
    }


def _split_column(data: Dict[str, List[Any]], schema: dict, column: Optional[str], label: str):
    if not column:
        raise ValueError(f"{label}_column is required for the selected split strategy.")
    if column not in data:
        raise ValueError(f"Split column '{column}' not in data.")
    if len(data[column]) != schema["n_rows_original"]:
        raise ValueError(f"Split column '{column}' has a different length from the model data.")
    values = [data[column][i] for i in schema["row_indices"]]
    if any(v is None or str(v).strip() == "" for v in values):
        raise ValueError(f"Split column '{column}' contains missing values in complete model rows.")
    return np.asarray(values, dtype=object)


def _time_order(values: np.ndarray) -> np.ndarray:
    numeric = pd.to_numeric(pd.Series(values), errors="coerce")
    if numeric.notna().all():
        order_values = numeric.to_numpy(dtype=float)
    else:
        parsed = pd.to_datetime(pd.Series(values), errors="coerce", utc=True)
        if parsed.isna().any():
            raise ValueError("Time split values must all be numeric or parseable timestamps.")
        order_values = parsed.astype("int64").to_numpy()
    return np.argsort(order_values, kind="mergesort")


def _resolve_strategy(requested: str, task: str) -> str:
    if requested == "auto":
        return "stratified" if task == "classification" else "random"
    if requested == "stratified" and task != "classification":
        raise ValueError("Stratified splitting is only available for classification.")
    return requested


def _split(X, y, test_size, task, strategy, seed=42, groups=None, times=None):
    strategy = _resolve_strategy(strategy, task)
    n = len(y)
    minimum_test = 1 if task == "classification" else 2
    n_test = max(minimum_test, int(round(test_size * n)))
    if n_test >= n - 1:
        raise ValueError("The test fraction leaves too few training observations.")

    if strategy == "stratified":
        rng = np.random.default_rng(seed)
        train_parts, test_parts = [], []
        for cls in np.unique(y):
            idx = rng.permutation(np.where(y == cls)[0])
            if len(idx) < 2:
                raise ValueError(f"Class '{cls}' has fewer than 2 observations; stratified validation is impossible.")
            n_cls_test = min(len(idx) - 1, max(1, int(round(test_size * len(idx)))))
            test_parts.append(idx[:n_cls_test])
            train_parts.append(idx[n_cls_test:])
        train_idx = np.concatenate(train_parts)
        test_idx = np.concatenate(test_parts)
    elif strategy == "group":
        if groups is None:
            raise ValueError("group_column is required for a group split.")
        if len(np.unique(groups)) < 2:
            raise ValueError("Group splitting requires at least two distinct groups.")
        train_idx, test_idx = next(GroupShuffleSplit(
            n_splits=1, test_size=test_size, random_state=seed
        ).split(np.arange(n), y, groups))
    elif strategy == "time":
        if times is None:
            raise ValueError("time_column is required for a time split.")
        order = _time_order(times)
        test_idx = order[-n_test:]
        train_idx = order[:-n_test]
    elif strategy == "random":
        idx = np.random.default_rng(seed).permutation(n)
        test_idx, train_idx = idx[:n_test], idx[n_test:]
    else:
        raise ValueError(f"Unknown split strategy '{strategy}'.")

    if task == "classification":
        all_classes = set(np.unique(y))
        if set(np.unique(y[train_idx])) != all_classes or set(np.unique(y[test_idx])) != all_classes:
            raise ValueError(
                f"The {strategy} split does not place every class in both train and test sets. "
                "Add data, change the split column, or choose stratified validation."
            )

    meta = {
        "strategy": strategy,
        "test_fraction": float(test_size),
        "seed": seed if strategy in {"random", "stratified", "group"} else None,
        "n_train": int(len(train_idx)),
        "n_test": int(len(test_idx)),
        "group_overlap": (
            bool(set(groups[train_idx]) & set(groups[test_idx])) if strategy == "group" else None
        ),
        "time_order_preserved": bool(strategy == "time") if strategy == "time" else None,
    }
    return (
        X.iloc[train_idx].reset_index(drop=True),
        X.iloc[test_idx].reset_index(drop=True),
        y[train_idx], y[test_idx],
        train_idx, test_idx, meta,
    )


def _classification_metrics(y_true, y_pred, model, X_test, classes):
    precision, recall, f1, _ = precision_recall_fscore_support(
        y_true, y_pred, average="macro", zero_division=0
    )
    out = {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y_true, y_pred)),
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
        "confusion_matrix": confusion_matrix(y_true, y_pred, labels=classes).tolist(),
        "classes": [str(c) for c in classes],
        "roc_auc": None,
        "average_precision": None,
        "calibration": {
            "available": False,
            "reason": "Estimator does not expose class probabilities.",
            "brier_score": None,
            "log_loss": None,
            "expected_calibration_error": None,
            "predicted_probability": [],
            "observed_frequency": [],
        },
    }
    if not hasattr(model, "predict_proba"):
        return out
    try:
        probabilities = np.asarray(model.predict_proba(X_test), dtype=float)
        out["calibration"]["available"] = True
        out["calibration"]["reason"] = None
        out["calibration"]["log_loss"] = float(log_loss(y_true, probabilities, labels=classes))
        confidence = np.max(probabilities, axis=1)
        predicted = classes[np.argmax(probabilities, axis=1)]
        correct = (predicted == y_true).astype(float)
        edges = np.linspace(0.0, 1.0, 11)
        ece = 0.0
        for lo, hi in zip(edges[:-1], edges[1:]):
            mask = (confidence >= lo) & (confidence < hi if hi < 1.0 else confidence <= hi)
            if np.any(mask):
                ece += np.mean(mask) * abs(float(np.mean(correct[mask]) - np.mean(confidence[mask])))
        out["calibration"]["expected_calibration_error"] = float(ece)

        if len(classes) == 2:
            positive = classes[1]
            y_binary = (y_true == positive).astype(int)
            positive_probability = probabilities[:, 1]
            out["roc_auc"] = float(roc_auc_score(y_binary, positive_probability))
            out["average_precision"] = float(average_precision_score(y_binary, positive_probability))
            out["calibration"]["brier_score"] = float(brier_score_loss(y_binary, positive_probability))
            observed, predicted_probability = calibration_curve(
                y_binary, positive_probability,
                n_bins=min(10, max(2, len(y_binary) // 3)), strategy="uniform",
            )
            out["calibration"]["predicted_probability"] = predicted_probability.tolist()
            out["calibration"]["observed_frequency"] = observed.tolist()
    except Exception:
        logger.exception("Classification calibration diagnostics failed.")
        out["calibration"]["available"] = False
        out["calibration"]["reason"] = (
            "Calibration diagnostics are unavailable for this fitted model."
        )
    return out


def _regression_metrics(y_true, y_pred):
    return {
        "r2": float(r2_score(y_true, y_pred)),
        "rmse": float(math.sqrt(mean_squared_error(y_true, y_pred))),
        "mae": float(mean_absolute_error(y_true, y_pred)),
    }


def _pipeline_feature_details(model: Pipeline, schema: dict):
    estimator = model.named_steps["estimator"]
    preprocess = model.named_steps["preprocess"]
    transformed_names = [str(name) for name in preprocess.get_feature_names_out()]
    raw_importances = getattr(estimator, "feature_importances_", None)
    if raw_importances is None:
        return transformed_names, None

    raw_importances = np.asarray(raw_importances, dtype=float)
    aggregated = {name: 0.0 for name in schema["feature_names"]}
    if schema["numeric_features"]:
        sl = preprocess.output_indices_["numeric"]
        for name, value in zip(schema["numeric_features"], raw_importances[sl]):
            aggregated[name] += float(value)
    if schema["categorical_features"]:
        sl = preprocess.output_indices_["categorical"]
        encoder = preprocess.named_transformers_["categorical"]
        position = sl.start
        for name, categories in zip(schema["categorical_features"], encoder.categories_):
            width = len(categories)
            aggregated[name] += float(np.sum(raw_importances[position:position + width]))
            position += width
    return transformed_names, aggregated


def _new_frame(rows: List[Dict[str, Any]], schema: dict) -> pd.DataFrame:
    prepared: list[dict] = []
    for row_index, row in enumerate(rows, start=1):
        result = {}
        for name in schema["feature_names"]:
            value = row.get(name)
            if value is None or str(value).strip() == "":
                raise ValueError(f"Row {row_index}: missing value for '{name}'.")
            if name in schema["numeric_features"]:
                try:
                    numeric = float(value)
                except (TypeError, ValueError):
                    raise ValueError(f"Row {row_index}: '{name}' must be numeric.")
                if not math.isfinite(numeric):
                    raise ValueError(f"Row {row_index}: '{name}' must be finite.")
                result[name] = numeric
            else:
                result[name] = str(value)
        prepared.append(result)
    return pd.DataFrame(prepared, columns=schema["feature_names"])


def _request_split_values(req, schema):
    strategy = _resolve_strategy(req.split_strategy, req.task or "regression") if req.split_strategy != "auto" else req.split_strategy
    groups = _split_column(req.data, schema, req.group_column, "group") if strategy == "group" else None
    times = _split_column(req.data, schema, req.time_column, "time") if strategy == "time" else None
    return groups, times


def _cv_indices(y, task, strategy, seed, groups=None, times=None):
    strategy = _resolve_strategy(strategy, task)
    n = len(y)
    if strategy == "stratified":
        smallest = min(np.sum(y == cls) for cls in np.unique(y))
        folds = min(5, int(smallest))
        if folds < 2:
            return []
        splitter = StratifiedKFold(n_splits=folds, shuffle=True, random_state=seed)
        return list(splitter.split(np.arange(n), y))
    if strategy == "group":
        folds = min(5, len(np.unique(groups)))
        if folds < 2:
            return []
        return list(GroupKFold(n_splits=folds).split(np.arange(n), y, groups))
    if strategy == "time":
        order = _time_order(times)
        folds = min(5, max(2, n // 3))
        return [(order[tr], order[te]) for tr, te in TimeSeriesSplit(n_splits=folds).split(order)]
    folds = min(5, max(2, n // 3))
    return list(KFold(n_splits=folds, shuffle=True, random_state=seed).split(np.arange(n), y))


@router.post("/fit")
def fit(req: FitRequest):
    try:
        X, y_raw, schema = _build_matrix(req.data, req.features, req.target)
        task = req.task or _detect_task(y_raw)
        groups = _split_column(req.data, schema, req.group_column, "group") if req.split_strategy == "group" else None
        times = _split_column(req.data, schema, req.time_column, "time") if req.split_strategy == "time" else None

        if req.model == "chaid":
            if task != "classification":
                raise ValueError("CHAID supports classification only.")
            y = y_raw.astype(str)
        elif task == "classification":
            encoder = LabelEncoder()
            y = encoder.fit_transform(y_raw.astype(str))
        else:
            y = y_raw.astype(float)
            if not np.all(np.isfinite(y)):
                raise ValueError("Regression target contains a non-finite value.")

        Xtr, Xte, ytr, yte, _, test_idx, validation = _split(
            X, y, req.test_size, task, req.split_strategy, req.seed, groups, times
        )
        preprocessing = _preprocessing_metadata(schema, req.model)

        if req.model == "chaid":
            model = CHAIDTree(**(req.params or {}))
            model.fit(Xtr.to_numpy(dtype=object), ytr, feature_names=req.features)
            yp = model.predict(Xte.to_numpy(dtype=object))
            metrics = _classification_metrics(yte, yp, model, Xte.to_numpy(dtype=object), np.asarray(model.classes_))
            return _safe({
                "model": "chaid", "task": task, "metrics": metrics,
                "feature_importances": dict(zip(req.features, model.feature_importances_.tolist())),
                "tree": model.to_dict(), "tree_text": None,
                "predictions": [str(v) for v in yp], "actual": [str(v) for v in yte],
                "n_train": len(ytr), "n_test": len(yte),
                "prediction_scope": "holdout", "preprocessing": preprocessing,
                "validation": validation,
                "fit_diagnostics": {"converged": True, "n_iter": None, "max_iter": None, "warnings": []},
            })

        model = _make_model(req.model, task, req.params, schema)
        fit_diagnostics = _fit_with_diagnostics(model, Xtr, ytr)
        yp = model.predict(Xte)
        if task == "classification":
            classes = np.arange(len(encoder.classes_))
            metrics = _classification_metrics(yte, yp, model, Xte, classes)
            metrics["classes"] = [str(c) for c in encoder.classes_]
            predictions = encoder.inverse_transform(np.asarray(yp, dtype=int)).tolist()
            actual = encoder.inverse_transform(np.asarray(yte, dtype=int)).tolist()
        else:
            metrics = _regression_metrics(yte, yp)
            predictions = np.asarray(yp, dtype=float).tolist()
            actual = np.asarray(yte, dtype=float).tolist()

        transformed_names, importances = _pipeline_feature_details(model, schema)
        estimator = model.named_steps["estimator"]
        tree_text = None
        tree_struct = None
        if req.model == "decision_tree":
            tree_text = export_text(estimator, feature_names=transformed_names)
            class_names = encoder.classes_ if task == "classification" else None
            tree_struct = _tree_to_dict(estimator, transformed_names, class_names)

        return _safe({
            "model": req.model, "task": task, "metrics": metrics,
            "feature_importances": importances,
            "tree": tree_struct, "tree_text": tree_text,
            "predictions": predictions, "actual": actual,
            "n_train": len(ytr), "n_test": len(yte),
            "prediction_scope": "holdout", "preprocessing": preprocessing,
            "validation": validation, "fit_diagnostics": fit_diagnostics,
        })
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/compare")
def compare(req: CompareRequest):
    try:
        X, y_raw, schema = _build_matrix(req.data, req.features, req.target)
        task = req.task or _detect_task(y_raw)
        if task == "classification":
            encoder = LabelEncoder()
            y = encoder.fit_transform(y_raw.astype(str))
            classes = np.arange(len(encoder.classes_))
            scoring = "accuracy"
        else:
            y = y_raw.astype(float)
            classes = None
            scoring = "r2"
        groups = _split_column(req.data, schema, req.group_column, "group") if req.split_strategy == "group" else None
        times = _split_column(req.data, schema, req.time_column, "time") if req.split_strategy == "time" else None
        Xtr, Xte, ytr, yte, _, _, validation = _split(
            X, y, req.test_size, task, req.split_strategy, req.seed, groups, times
        )
        folds = _cv_indices(y, task, req.split_strategy, req.seed, groups, times)

        rows = []
        for name in ("decision_tree", "random_forest", "gradient_boosting", "svm", "knn", "adaboost", "mlp"):
            model = _make_model(name, task, None, schema)
            diagnostics = _fit_with_diagnostics(model, Xtr, ytr)
            yp = model.predict(Xte)
            cv_scores = []
            cv_converged = True
            for train_idx, test_idx in folds:
                if task == "classification":
                    all_classes = set(np.unique(y))
                    if set(np.unique(y[train_idx])) != all_classes or set(np.unique(y[test_idx])) != all_classes:
                        continue
                if task == "regression" and len(test_idx) < 2:
                    continue
                fold_model = clone(_make_model(name, task, None, schema))
                fold_diag = _fit_with_diagnostics(fold_model, X.iloc[train_idx], y[train_idx])
                cv_converged = cv_converged and fold_diag["converged"]
                fold_pred = fold_model.predict(X.iloc[test_idx])
                score = accuracy_score(y[test_idx], fold_pred) if task == "classification" else r2_score(y[test_idx], fold_pred)
                if np.isfinite(score):
                    cv_scores.append(float(score))

            row = {
                "model": name,
                "cv_mean": float(np.mean(cv_scores)) if cv_scores else None,
                "cv_std": float(np.std(cv_scores)) if cv_scores else None,
                "cv_folds_successful": len(cv_scores),
                "converged": diagnostics["converged"] and cv_converged,
                "convergence_warnings": diagnostics["warnings"],
            }
            if task == "classification":
                metrics = _classification_metrics(yte, yp, model, Xte, classes)
                row.update({
                    "accuracy": metrics["accuracy"], "balanced_accuracy": metrics["balanced_accuracy"],
                    "f1": metrics["f1"], "precision": metrics["precision"],
                    "recall": metrics["recall"], "roc_auc": metrics["roc_auc"],
                    "brier_score": metrics["calibration"]["brier_score"],
                    "expected_calibration_error": metrics["calibration"]["expected_calibration_error"],
                })
            else:
                row.update(_regression_metrics(yte, yp))
            rows.append(row)

        return _safe({
            "task": task, "scoring": scoring, "comparison": rows,
            "validation": {**validation, "cv_strategy": validation["strategy"], "cv_folds_requested": len(folds)},
            "preprocessing": _preprocessing_metadata(schema, "model-specific"),
        })
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/predict")
def predict(req: PredictRequest):
    try:
        X, y_raw, schema = _build_matrix(req.data, req.features, req.target)
        X_new = _new_frame([req.input], schema)
        task = req.task or _detect_task(y_raw)
        preprocessing = _preprocessing_metadata(schema, req.model)
        if req.model == "chaid":
            if task != "classification":
                raise ValueError("CHAID supports classification only.")
            model = CHAIDTree(**(req.params or {})).fit(
                X.to_numpy(dtype=object), y_raw.astype(str), feature_names=req.features
            )
            prediction = model.predict(X_new.to_numpy(dtype=object))[0]
            return _safe({"prediction": str(prediction), "task": task, "preprocessing": preprocessing})

        if task == "classification":
            encoder = LabelEncoder()
            y = encoder.fit_transform(y_raw.astype(str))
        else:
            y = y_raw.astype(float)
        model = _make_model(req.model, task, req.params, schema)
        diagnostics = _fit_with_diagnostics(model, X, y)
        if task == "classification":
            encoded = int(model.predict(X_new)[0])
            result = {
                "prediction": str(encoder.inverse_transform([encoded])[0]),
                "task": task, "fit_diagnostics": diagnostics, "preprocessing": preprocessing,
            }
            if hasattr(model, "predict_proba"):
                probabilities = model.predict_proba(X_new)[0]
                estimator_classes = model.named_steps["estimator"].classes_
                result["probabilities"] = {
                    str(encoder.inverse_transform([int(cls)])[0]): float(probability)
                    for cls, probability in zip(estimator_classes, probabilities)
                }
            return _safe(result)
        return _safe({
            "prediction": float(model.predict(X_new)[0]), "task": task,
            "fit_diagnostics": diagnostics, "preprocessing": preprocessing,
        })
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/predict_batch")
def predict_batch(req: PredictBatchRequest):
    try:
        if not req.inputs:
            raise ValueError("No rows to score.")
        X, y_raw, schema = _build_matrix(req.data, req.features, req.target)
        X_new = _new_frame(req.inputs, schema)
        task = req.task or _detect_task(y_raw)
        preprocessing = _preprocessing_metadata(schema, req.model)
        if req.model == "chaid":
            if task != "classification":
                raise ValueError("CHAID supports classification only.")
            model = CHAIDTree(**(req.params or {})).fit(
                X.to_numpy(dtype=object), y_raw.astype(str), feature_names=req.features
            )
            predictions = model.predict(X_new.to_numpy(dtype=object))
            return _safe({"predictions": [str(v) for v in predictions], "task": task, "preprocessing": preprocessing})

        if task == "classification":
            encoder = LabelEncoder()
            y = encoder.fit_transform(y_raw.astype(str))
        else:
            y = y_raw.astype(float)
        model = _make_model(req.model, task, req.params, schema)
        diagnostics = _fit_with_diagnostics(model, X, y)
        predictions = model.predict(X_new)
        if task == "classification":
            values = [str(v) for v in encoder.inverse_transform(np.asarray(predictions, dtype=int))]
        else:
            values = [float(v) for v in predictions]
        return _safe({
            "predictions": values, "task": task,
            "fit_diagnostics": diagnostics, "preprocessing": preprocessing,
        })
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _tree_to_dict(model, features, class_names=None):
    """Convert a fitted sklearn DecisionTree to a nested serialisable dict."""
    tree = model.tree_

    def walk(node):
        if tree.children_left[node] == tree.children_right[node]:
            value = tree.value[node][0]
            if class_names is not None:
                prediction = class_names[int(np.argmax(value))]
                return {"leaf": True, "prediction": str(prediction), "n": int(tree.n_node_samples[node])}
            return {"leaf": True, "value": float(value[0]), "n": int(tree.n_node_samples[node])}
        return {
            "leaf": False,
            "feature": features[tree.feature[node]],
            "threshold": float(tree.threshold[node]),
            "n": int(tree.n_node_samples[node]),
            "left": walk(int(tree.children_left[node])),
            "right": walk(int(tree.children_right[node])),
        }

    return walk(0)
