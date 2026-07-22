"""Decision-grade supervised modeling workflow.

This router is intentionally separate from the legacy ``regression`` and
``predictive`` endpoints.  The legacy endpoints remain useful compatibility
surfaces, while this module provides a single statistical contract for model
comparison: every reported leaderboard metric is produced out of sample and
every learned preprocessing, tuning, calibration, and threshold decision is
confined to the corresponding training fold.

The public workflow has three stages:

``/evaluate`` (or ``/evaluate/stream``)
    Audit the data, run nested validation, and return comparable models.
``/finalize``
    Refit the selected recipe and create a portable project model asset.
``/score``
    Score rows from that immutable asset without consulting the live dataset.

ONNX is used for safe, portable inference when the optional converter/runtime
dependencies are installed and parity validation succeeds.  CHAID uses a
bounded native JSON representation.  Pickle/joblib payloads are never loaded.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import math
import os
import platform
import threading
import time
import warnings
from dataclasses import dataclass
from importlib import metadata
from typing import Any, Callable, Literal, Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field, model_validator
from scipy.special import expit, logit
from sklearn.base import BaseEstimator, ClassifierMixin
from sklearn.calibration import calibration_curve
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import (
    AdaBoostClassifier,
    AdaBoostRegressor,
    GradientBoostingClassifier,
    GradientBoostingRegressor,
    HistGradientBoostingClassifier,
    HistGradientBoostingRegressor,
    RandomForestClassifier,
    RandomForestRegressor,
)

from api_contract import stream_error_event, stream_result_event
from sklearn.exceptions import ConvergenceWarning
from sklearn.impute import SimpleImputer
from sklearn.inspection import partial_dependence, permutation_importance
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import (
    ElasticNet,
    Lasso,
    LinearRegression,
    LogisticRegression,
    Ridge,
)
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    balanced_accuracy_score,
    brier_score_loss,
    confusion_matrix,
    f1_score,
    log_loss,
    mean_absolute_error,
    mean_squared_error,
    median_absolute_error,
    precision_score,
    r2_score,
    recall_score,
    roc_auc_score,
    roc_curve,
    precision_recall_curve,
)
from sklearn.model_selection import (
    GroupKFold,
    KFold,
    ParameterSampler,
    StratifiedGroupKFold,
    StratifiedKFold,
    TimeSeriesSplit,
)
from sklearn.neighbors import KNeighborsClassifier, KNeighborsRegressor
from sklearn.neural_network import MLPClassifier, MLPRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, PolynomialFeatures, StandardScaler
from sklearn.svm import SVC, SVR
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor

logger = logging.getLogger(__name__)

from reliability.CHAID import CHAIDTree
from reliability.Regression import (
    elastic_net_regression,
    lasso_regression,
    linear_regression,
    logistic_regression,
    polynomial_regression,
    ridge_regression,
)


router = APIRouter()

TaskName = Literal["regression", "classification"]
ValidationName = Literal["auto", "random", "stratified", "group", "time"]
MissingPolicy = Literal["drop", "impute", "impute_indicator"]
BudgetName = Literal["quick", "standard", "thorough"]
CalibrationName = Literal["none", "sigmoid", "isotonic"]
ModelName = Literal[
    "linear", "ridge", "lasso", "elastic_net", "polynomial", "logistic",
    "decision_tree", "random_forest", "gradient_boosting",
    "hist_gradient_boosting", "adaboost", "chaid", "svm", "knn", "mlp",
]


MODEL_LABELS: dict[str, str] = {
    "linear": "Linear (OLS)",
    "ridge": "Ridge (L2)",
    "lasso": "Lasso (L1)",
    "elastic_net": "Elastic Net",
    "polynomial": "Polynomial",
    "logistic": "Logistic",
    "decision_tree": "Decision Tree",
    "random_forest": "Random Forest",
    "gradient_boosting": "Gradient Boosting",
    "hist_gradient_boosting": "Histogram Gradient Boosting",
    "adaboost": "AdaBoost",
    "chaid": "CHAID",
    "svm": "Support Vector Machine",
    "knn": "k-Nearest Neighbors",
    "mlp": "MLP Neural Network",
}

REGRESSION_MODELS = {
    "linear", "ridge", "lasso", "elastic_net", "polynomial",
    "decision_tree", "random_forest", "gradient_boosting",
    "hist_gradient_boosting", "adaboost", "svm", "knn", "mlp",
}
CLASSIFICATION_MODELS = {
    "logistic", "decision_tree", "random_forest", "gradient_boosting",
    "hist_gradient_boosting", "adaboost", "chaid", "svm", "knn", "mlp",
}
CLASSICAL_INFERENCE_MODELS = {
    "linear", "ridge", "lasso", "elastic_net", "polynomial", "logistic",
}

REGRESSION_METRICS = {"rmse", "mae", "median_absolute_error", "r2"}
CLASSIFICATION_METRICS = {
    "balanced_accuracy", "accuracy", "f1_macro", "recall_macro", "precision_macro",
    "roc_auc", "average_precision", "log_loss", "brier_score", "expected_cost",
}
BINARY_ONLY_METRICS = {"roc_auc", "average_precision", "brier_score", "expected_cost"}

BUDGETS: dict[str, dict[str, int]] = {
    "quick": {"outer_folds": 3, "inner_folds": 3, "candidates": 12},
    "standard": {"outer_folds": 5, "inner_folds": 3, "candidates": 24},
    "thorough": {"outer_folds": 5, "inner_folds": 5, "candidates": 50},
}


class ModelSpec(BaseModel):
    model: ModelName
    params: dict[str, Any] = Field(default_factory=dict)
    tune: bool = True


class ValidationSpec(BaseModel):
    strategy: ValidationName = "auto"
    group_column: Optional[str] = None
    time_column: Optional[str] = None
    budget: BudgetName = "standard"
    outer_folds: Optional[int] = Field(None, ge=2, le=10)
    inner_folds: Optional[int] = Field(None, ge=2, le=10)
    candidates: Optional[int] = Field(None, ge=1, le=100)
    seed: int = Field(42, ge=0)

    @model_validator(mode="after")
    def columns_for_strategy(self):
        if self.strategy == "group" and not self.group_column:
            raise ValueError("group_column is required for group validation.")
        if self.strategy == "time" and not self.time_column:
            raise ValueError("time_column is required for time validation.")
        return self

    def resolved(self) -> dict[str, Any]:
        base = BUDGETS[self.budget]
        return {
            "strategy": self.strategy,
            "group_column": self.group_column,
            "time_column": self.time_column,
            "budget": self.budget,
            "outer_folds": self.outer_folds or base["outer_folds"],
            "inner_folds": self.inner_folds or base["inner_folds"],
            "candidates": self.candidates or base["candidates"],
            "seed": self.seed,
        }


class DecisionCosts(BaseModel):
    false_positive: float = Field(1.0, ge=0)
    false_negative: float = Field(1.0, ge=0)


class EvaluateRequest(BaseModel):
    data: dict[str, list[Any]]
    target: str
    features: list[str]
    task: TaskName
    models: list[ModelSpec]
    missing_policy: MissingPolicy = "impute_indicator"
    validation: ValidationSpec = Field(default_factory=ValidationSpec)
    selection_metric: Optional[str] = None
    positive_class: Optional[str] = None
    costs: Optional[DecisionCosts] = None
    calibration: CalibrationName = "none"
    confidence: float = Field(0.95, gt=0.5, lt=1.0)
    metric_resamples: int = Field(200, ge=50, le=2000)

    @model_validator(mode="after")
    def validate_request(self):
        if not self.features:
            raise ValueError("Select at least one predictor feature.")
        if len(set(self.features)) != len(self.features):
            raise ValueError("Predictor feature names must be unique.")
        if self.target in self.features:
            raise ValueError("The target cannot also be a predictor.")
        if not self.models:
            raise ValueError("Select at least one model.")
        if len({m.model for m in self.models}) != len(self.models):
            raise ValueError("Each selected model may appear only once.")
        return self


class FinalizeRequest(BaseModel):
    evaluation: EvaluateRequest
    model: ModelName
    selected_params: dict[str, Any] = Field(default_factory=dict)
    threshold: Optional[float] = None
    calibration_state: Optional[dict[str, Any]] = None
    conformal: Optional[dict[str, Any]] = None
    metrics: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


class ScoreRequest(BaseModel):
    asset: dict[str, Any]
    rows: list[dict[str, Any]] = Field(min_length=1, max_length=100_000)


class ExportRequest(BaseModel):
    asset: dict[str, Any]


class ModelingCancelled(RuntimeError):
    pass


def _safe(value: Any) -> Any:
    if isinstance(value, (np.floating, float)):
        number = float(value)
        return number if math.isfinite(number) else None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, np.generic):
        return _safe(value.item())
    if isinstance(value, np.ndarray):
        return _safe(value.tolist())
    if isinstance(value, dict):
        return {str(k): _safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_safe(v) for v in value]
    return value


def _is_missing(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, float) and math.isnan(value):
        return True
    return isinstance(value, str) and value.strip() == ""


def _package_version(name: str) -> Optional[str]:
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return None


def _versions() -> dict[str, Any]:
    return {
        "python": platform.python_version(),
        "numpy": np.__version__,
        "pandas": pd.__version__,
        "scikit_learn": _package_version("scikit-learn"),
        "skl2onnx": _package_version("skl2onnx"),
        "onnx": _package_version("onnx"),
        "onnxruntime": _package_version("onnxruntime"),
    }


@dataclass
class PreparedData:
    X: pd.DataFrame
    y: np.ndarray
    y_display: np.ndarray
    row_indices: np.ndarray
    numeric: list[str]
    categorical: list[str]
    groups: Optional[np.ndarray]
    times: Optional[np.ndarray]
    classes: Optional[list[str]]
    positive_index: Optional[int]
    readiness: dict[str, Any]
    schema: dict[str, Any]


def _validate_column_lengths(req: EvaluateRequest) -> int:
    required = list(dict.fromkeys(
        [req.target, *req.features,
         req.validation.group_column or "", req.validation.time_column or ""]
    ))
    required = [name for name in required if name]
    for name in required:
        if name not in req.data:
            raise ValueError(f"Column '{name}' is not present in the dataset.")
    lengths = {name: len(req.data[name]) for name in required}
    if len(set(lengths.values())) != 1:
        raise ValueError(f"Selected columns have inconsistent lengths: {lengths}.")
    return next(iter(lengths.values()))


def _data_fingerprint(req: EvaluateRequest, kept_rows: np.ndarray) -> str:
    payload = {
        "target": req.target,
        "features": req.features,
        "rows": [
            {name: req.data[name][int(i)] for name in [*req.features, req.target]}
            for i in kept_rows
        ],
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()
    return hashlib.sha256(encoded).hexdigest()


def _prepare(req: EvaluateRequest) -> PreparedData:
    n_original = _validate_column_lengths(req)
    rows: list[int] = []
    dropped_target = 0
    dropped_predictor = 0
    for i in range(n_original):
        if _is_missing(req.data[req.target][i]):
            dropped_target += 1
            continue
        if req.missing_policy == "drop" and any(
            _is_missing(req.data[name][i]) for name in req.features
        ):
            dropped_predictor += 1
            continue
        rows.append(i)
    if len(rows) < 8:
        raise ValueError("At least 8 eligible rows are required for validated modeling.")
    row_indices = np.asarray(rows, dtype=int)

    frame = pd.DataFrame(index=np.arange(len(rows)))
    numeric: list[str] = []
    categorical: list[str] = []
    missing_by_feature: dict[str, int] = {}
    cardinality: dict[str, int] = {}
    constants: list[str] = []
    high_cardinality: list[str] = []
    id_like: list[str] = []
    for name in req.features:
        raw = [req.data[name][i] for i in rows]
        missing_by_feature[name] = sum(_is_missing(v) for v in raw)
        nonmissing = [v for v in raw if not _is_missing(v)]
        converted = pd.to_numeric(pd.Series(nonmissing), errors="coerce")
        is_numeric = bool(nonmissing) and converted.notna().all()
        if is_numeric:
            values = [np.nan if _is_missing(v) else float(v) for v in raw]
            if not np.all(np.isfinite(np.asarray([v for v in values if not np.isnan(v)]))):
                raise ValueError(f"Numeric feature '{name}' contains a non-finite value.")
            frame[name] = np.asarray(values, dtype=float)
            numeric.append(name)
        else:
            # Keep a string sentinel for categorical missingness.  It remains
            # fold-learned by SimpleImputer and is representable in ONNX;
            # mixed float/string missing sentinels are not portable.
            frame[name] = ["" if _is_missing(v) else str(v) for v in raw]
            categorical.append(name)
        unique = int(pd.Series(nonmissing, dtype=object).nunique(dropna=True))
        cardinality[name] = unique
        if unique <= 1:
            constants.append(name)
        if name in categorical and unique > max(20, int(0.5 * len(rows))):
            high_cardinality.append(name)
        if unique >= max(8, int(0.9 * len(rows))):
            id_like.append(name)

    target_raw = np.asarray([req.data[req.target][i] for i in rows], dtype=object)
    classes: Optional[list[str]] = None
    positive_index: Optional[int] = None
    if req.task == "regression":
        try:
            y = target_raw.astype(float)
        except (TypeError, ValueError) as exc:
            raise ValueError("Regression requires a numeric target.") from exc
        if not np.all(np.isfinite(y)):
            raise ValueError("Regression target contains a non-finite value.")
        y_display = y.copy()
    else:
        target_strings = target_raw.astype(str)
        classes = sorted(np.unique(target_strings).tolist())
        if len(classes) < 2:
            raise ValueError("Classification requires at least two target classes.")
        mapping = {label: i for i, label in enumerate(classes)}
        y = np.asarray([mapping[label] for label in target_strings], dtype=int)
        y_display = target_strings
        if req.positive_class is not None:
            if str(req.positive_class) not in mapping:
                raise ValueError(
                    f"Positive class '{req.positive_class}' is not present; choose from {classes}."
                )
            positive_index = mapping[str(req.positive_class)]
        elif len(classes) == 2:
            positive_index = 1

    metric = _default_metric(req)
    allowed_metrics = REGRESSION_METRICS if req.task == "regression" else CLASSIFICATION_METRICS
    if metric not in allowed_metrics:
        raise ValueError(
            f"Selection metric '{metric}' is not valid for {req.task}; "
            f"choose from {sorted(allowed_metrics)}."
        )
    if req.task == "classification":
        if metric in BINARY_ONLY_METRICS and len(classes or []) != 2:
            raise ValueError(f"Selection metric '{metric}' requires exactly two target classes.")
        if req.costs is not None and len(classes or []) != 2:
            raise ValueError("Decision costs are currently supported only for binary classification.")
        if metric == "expected_cost" and req.costs is None:
            raise ValueError("Expected-cost selection requires false-positive and false-negative costs.")
        if req.calibration != "none" and len(classes or []) != 2:
            raise ValueError("Probability calibration is currently supported only for binary classification.")

    groups = None
    if req.validation.strategy == "group":
        groups = np.asarray([req.data[req.validation.group_column][i] for i in rows], dtype=object)
        if any(_is_missing(v) for v in groups):
            raise ValueError("The group column contains missing values in eligible rows.")
    times = None
    if req.validation.strategy == "time":
        values = [req.data[req.validation.time_column][i] for i in rows]
        if any(_is_missing(v) for v in values):
            raise ValueError("The time column contains missing values in eligible rows.")
        numeric_time = pd.to_numeric(pd.Series(values), errors="coerce")
        if numeric_time.notna().all():
            times = numeric_time.to_numpy(dtype=float)
        else:
            parsed = pd.to_datetime(pd.Series(values), errors="coerce", utc=True)
            if parsed.isna().any():
                raise ValueError("Time values must all be numeric or parseable timestamps.")
            times = parsed.astype("int64").to_numpy()

    duplicated = int(frame.assign(__target=target_raw).duplicated().sum())
    leakage: list[str] = []
    for name in req.features:
        feature = frame[name]
        comparable = feature.notna()
        if not comparable.any():
            continue
        left = feature[comparable].astype(str).to_numpy()
        right = target_raw[comparable.to_numpy()].astype(str)
        if len(left) and np.array_equal(left, right):
            leakage.append(f"'{name}' duplicates the target on every non-missing row.")
        elif req.task == "classification" and cardinality[name] > 1:
            table = pd.crosstab(feature[comparable].astype(str), target_raw[comparable.to_numpy()].astype(str))
            if len(table) >= 2 and (table.astype(bool).sum(axis=1) == 1).all():
                leakage.append(
                    f"'{name}' maps each observed level to one target class; verify it is available before prediction."
                )

    class_counts = None
    if classes is not None:
        class_counts = {classes[i]: int(np.sum(y == i)) for i in range(len(classes))}

    warnings_out: list[str] = []
    if dropped_target:
        warnings_out.append(f"Dropped {dropped_target} row(s) with a missing target.")
    if dropped_predictor:
        warnings_out.append(f"Dropped {dropped_predictor} row(s) under complete-row policy.")
    if constants:
        warnings_out.append(f"Constant predictors cannot contribute: {', '.join(constants)}.")
    if high_cardinality:
        warnings_out.append(
            "High-cardinality categorical predictors may overfit or expand the design: "
            + ", ".join(high_cardinality) + "."
        )
    if id_like:
        warnings_out.append(
            "ID-like predictors should be excluded unless their identity is genuinely predictive: "
            + ", ".join(id_like) + "."
        )
    warnings_out.extend(leakage)

    readiness = {
        "n_rows_original": n_original,
        "n_rows_eligible": len(rows),
        "dropped_missing_target": dropped_target,
        "dropped_missing_predictors": dropped_predictor,
        "missing_by_feature": missing_by_feature,
        "numeric_features": numeric,
        "categorical_features": categorical,
        "cardinality": cardinality,
        "constant_features": constants,
        "high_cardinality_features": high_cardinality,
        "id_like_features": id_like,
        "duplicate_rows": duplicated,
        "class_counts": class_counts,
        "leakage_warnings": leakage,
        "warnings": warnings_out,
        "status": "warning" if warnings_out else "ready",
    }
    schema = {
        "target": req.target,
        "features": list(req.features),
        "numeric_features": numeric,
        "categorical_features": categorical,
        "classes": classes,
        "positive_class": classes[positive_index] if classes and positive_index is not None else None,
        "missing_policy": req.missing_policy,
        "dataset_fingerprint": _data_fingerprint(req, row_indices),
    }
    return PreparedData(
        X=frame, y=y, y_display=y_display, row_indices=row_indices,
        numeric=numeric, categorical=categorical, groups=groups, times=times,
        classes=classes, positive_index=positive_index, readiness=readiness,
        schema=schema,
    )


class CHAIDAdapter(BaseEstimator, ClassifierMixin):
    """Cloneable, fold-safe wrapper around Perdura's compact CHAID tree."""

    def __init__(
        self,
        feature_names: tuple[str, ...],
        numeric_features: tuple[str, ...],
        missing_policy: str = "impute_indicator",
        max_depth: int = 4,
        min_samples_split: int = 10,
        alpha: float = 0.05,
        n_bins: int = 4,
    ):
        self.feature_names = feature_names
        self.numeric_features = numeric_features
        self.missing_policy = missing_policy
        self.max_depth = max_depth
        self.min_samples_split = min_samples_split
        self.alpha = alpha
        self.n_bins = n_bins

    def _frame(self, X, fit: bool) -> np.ndarray:
        frame = X.copy() if isinstance(X, pd.DataFrame) else pd.DataFrame(X, columns=self.feature_names)
        output: dict[str, Any] = {}
        if fit:
            self.fill_values_ = {}
        for name in self.feature_names:
            series = frame[name]
            is_numeric = name in self.numeric_features
            categorical_missing = (
                series.fillna("").astype(str).str.strip().eq("")
                if not is_numeric else pd.Series(False, index=series.index)
            )
            if fit:
                if is_numeric:
                    numeric = pd.to_numeric(series, errors="coerce")
                    fill = float(numeric.median()) if numeric.notna().any() else 0.0
                else:
                    mode = series[~categorical_missing].dropna().astype(str).mode()
                    fill = str(mode.iloc[0]) if len(mode) else "(missing)"
                self.fill_values_[name] = fill
            fill = self.fill_values_[name]
            missing = (series.isna() if is_numeric else categorical_missing).to_numpy()
            if is_numeric:
                output[name] = pd.to_numeric(series, errors="coerce").fillna(float(fill)).to_numpy(float)
            else:
                output[name] = series.mask(categorical_missing, str(fill)).fillna(str(fill)).astype(str).to_numpy()
            if self.missing_policy == "impute_indicator" and np.any(missing):
                output[f"{name}__missing"] = np.where(missing, "missing", "observed")
        self.output_features_ = list(output)
        return pd.DataFrame(output).to_numpy(dtype=object)

    def fit(self, X, y):
        matrix = self._frame(X, fit=True)
        labels = np.asarray(y).astype(str)
        self.model_ = CHAIDTree(
            max_depth=int(self.max_depth),
            min_samples_split=int(self.min_samples_split),
            alpha=float(self.alpha), n_bins=int(self.n_bins),
        ).fit(matrix, labels, feature_names=self.output_features_)
        self.classes_ = np.asarray(sorted(np.unique(np.asarray(y)).tolist()))
        raw = np.asarray(self.model_.feature_importances_, dtype=float)
        aggregated = {name: 0.0 for name in self.feature_names}
        for output_name, value in zip(self.output_features_, raw):
            source = output_name.removesuffix("__missing")
            aggregated[source] += float(value)
        self.feature_importances_ = np.asarray([aggregated[name] for name in self.feature_names])
        return self

    def predict(self, X):
        values = self.model_.predict(self._frame(X, fit=False)).astype(str)
        try:
            return values.astype(int)
        except ValueError:
            return values

    def predict_proba(self, X):
        return self.model_.predict_proba(self._frame(X, fit=False))


def _preprocessor(prepared: PreparedData, req: EvaluateRequest, scale: bool) -> ColumnTransformer:
    indicator = req.missing_policy == "impute_indicator"
    transformers: list[tuple[str, Any, list[str]]] = []
    if prepared.numeric:
        numeric_steps: list[tuple[str, Any]] = [
            ("impute", SimpleImputer(strategy="median", add_indicator=indicator)),
        ]
        if scale:
            numeric_steps.append(("scale", StandardScaler()))
        transformers.append(("numeric", Pipeline(numeric_steps), prepared.numeric))
    if prepared.categorical:
        categorical_steps = [
            ("impute", SimpleImputer(
                missing_values="", strategy="most_frequent", add_indicator=indicator,
            )),
            ("onehot", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
        ]
        transformers.append(("categorical", Pipeline(categorical_steps), prepared.categorical))
    return ColumnTransformer(
        transformers=transformers, remainder="drop", sparse_threshold=0.0,
        verbose_feature_names_out=True,
    )


def _base_estimator(model: str, task: str, seed: int) -> Any:
    if model == "linear":
        return LinearRegression()
    if model == "ridge":
        return Ridge(alpha=1.0)
    if model == "lasso":
        return Lasso(alpha=0.1, max_iter=10_000, random_state=seed)
    if model == "elastic_net":
        return ElasticNet(alpha=0.1, l1_ratio=0.5, max_iter=10_000, random_state=seed)
    if model == "logistic":
        return LogisticRegression(C=1.0, max_iter=3000, random_state=seed)
    if model == "decision_tree":
        cls = DecisionTreeClassifier if task == "classification" else DecisionTreeRegressor
        return cls(random_state=seed)
    if model == "random_forest":
        cls = RandomForestClassifier if task == "classification" else RandomForestRegressor
        return cls(n_estimators=150, random_state=seed, n_jobs=1)
    if model == "gradient_boosting":
        cls = GradientBoostingClassifier if task == "classification" else GradientBoostingRegressor
        return cls(random_state=seed)
    if model == "hist_gradient_boosting":
        cls = HistGradientBoostingClassifier if task == "classification" else HistGradientBoostingRegressor
        return cls(random_state=seed)
    if model == "adaboost":
        cls = AdaBoostClassifier if task == "classification" else AdaBoostRegressor
        return cls(random_state=seed)
    if model == "svm":
        return SVC(probability=True, random_state=seed) if task == "classification" else SVR()
    if model == "knn":
        cls = KNeighborsClassifier if task == "classification" else KNeighborsRegressor
        return cls(n_neighbors=5)
    if model == "mlp":
        cls = MLPClassifier if task == "classification" else MLPRegressor
        return cls(hidden_layer_sizes=(64, 32), max_iter=1500, early_stopping=True, random_state=seed)
    if model == "polynomial":
        return LinearRegression()
    raise ValueError(f"Unknown model '{model}'.")


def _make_model(model: str, prepared: PreparedData, req: EvaluateRequest, seed: int) -> Any:
    if model == "chaid":
        return CHAIDAdapter(
            tuple(req.features), tuple(prepared.numeric), req.missing_policy,
        )
    scale = model in {
        "linear", "ridge", "lasso", "elastic_net", "logistic", "polynomial",
        "svm", "knn", "mlp",
    }
    steps: list[tuple[str, Any]] = [("preprocess", _preprocessor(prepared, req, scale))]
    if model == "polynomial":
        steps.append(("polynomial", PolynomialFeatures(degree=2, include_bias=False)))
    steps.append(("estimator", _base_estimator(model, req.task, seed)))
    return Pipeline(steps)


def _parameter_space(model: str, task: str, n_rows: int) -> dict[str, list[Any]]:
    spaces: dict[str, dict[str, list[Any]]] = {
        "linear": {},
        "ridge": {"estimator__alpha": [0.001, 0.01, 0.1, 1.0, 10.0, 100.0]},
        "lasso": {"estimator__alpha": [0.0001, 0.001, 0.01, 0.1, 0.5, 1.0]},
        "elastic_net": {
            "estimator__alpha": [0.0001, 0.001, 0.01, 0.1, 0.5, 1.0],
            "estimator__l1_ratio": [0.1, 0.25, 0.5, 0.75, 0.9, 1.0],
        },
        "polynomial": {"polynomial__degree": [1, 2, 3, 4, 5]},
        "logistic": {
            "estimator__C": [0.01, 0.1, 0.5, 1.0, 5.0, 10.0, 100.0],
            "estimator__class_weight": [None, "balanced"],
        },
        "decision_tree": {
            "estimator__max_depth": [None, 2, 3, 5, 8, 12],
            "estimator__min_samples_leaf": [1, 2, 4, 8],
        },
        "random_forest": {
            "estimator__n_estimators": [100, 200, 350],
            "estimator__max_depth": [None, 4, 8, 14],
            "estimator__min_samples_leaf": [1, 2, 4],
            "estimator__max_features": ["sqrt", 0.5, 1.0],
        },
        "gradient_boosting": {
            "estimator__n_estimators": [50, 100, 200],
            "estimator__learning_rate": [0.02, 0.05, 0.1, 0.2],
            "estimator__max_depth": [1, 2, 3, 5],
        },
        "hist_gradient_boosting": {
            "estimator__learning_rate": [0.03, 0.06, 0.1, 0.2],
            "estimator__max_iter": [100, 200, 350],
            "estimator__max_leaf_nodes": [7, 15, 31, 63],
            "estimator__l2_regularization": [0.0, 0.1, 1.0, 10.0],
        },
        "adaboost": {
            "estimator__n_estimators": [50, 100, 200, 350],
            "estimator__learning_rate": [0.02, 0.05, 0.1, 0.5, 1.0],
        },
        "svm": (
            {"estimator__C": [0.1, 0.5, 1.0, 5.0, 10.0, 100.0],
             "estimator__gamma": ["scale", "auto", 0.001, 0.01, 0.1, 1.0],
             "estimator__kernel": ["rbf", "linear"]}
            if task == "classification" else
            {"estimator__C": [0.1, 0.5, 1.0, 5.0, 10.0, 100.0],
             "estimator__epsilon": [0.01, 0.05, 0.1, 0.25, 0.5],
             "estimator__gamma": ["scale", "auto", 0.001, 0.01, 0.1],
             "estimator__kernel": ["rbf", "linear"]}
        ),
        "knn": {
            "estimator__n_neighbors": sorted(set([1, 3, 5, 7, 11, min(19, max(1, n_rows // 5))])),
            "estimator__weights": ["uniform", "distance"],
            "estimator__p": [1, 2],
        },
        "mlp": {
            "estimator__hidden_layer_sizes": [(32,), (64,), (64, 32), (128, 64)],
            "estimator__alpha": [0.00001, 0.0001, 0.001, 0.01],
            "estimator__learning_rate_init": [0.0003, 0.001, 0.003, 0.01],
        },
        "chaid": {
            "max_depth": [2, 3, 4, 5, 6],
            "min_samples_split": [5, 10, 20, 30],
            "alpha": [0.01, 0.03, 0.05, 0.1, 0.2],
            "n_bins": [3, 4, 5, 6],
        },
    }
    space = dict(spaces[model])
    if task == "classification" and model in {
        "decision_tree", "random_forest",
    }:
        space["estimator__class_weight"] = [None, "balanced"]
    return space


def _manual_params(model: str, params: dict[str, Any]) -> dict[str, Any]:
    if not params:
        return {}
    out: dict[str, Any] = {}
    for key, value in params.items():
        if model == "chaid" or "__" in key:
            out[key] = value
        elif model == "polynomial" and key == "degree":
            out["polynomial__degree"] = value
        else:
            out[f"estimator__{key}"] = value
    return out


def _candidates(spec: ModelSpec, req: EvaluateRequest, n_rows: int) -> list[dict[str, Any]]:
    manual = _manual_params(spec.model, spec.params)
    if not spec.tune:
        return [manual]
    resolved = req.validation.resolved()
    space = _parameter_space(spec.model, req.task, n_rows)
    if not space:
        return [manual]
    sampled = list(ParameterSampler(
        space, n_iter=min(resolved["candidates"], math.prod(len(v) for v in space.values())),
        random_state=resolved["seed"],
    ))
    if manual:
        sampled = [{**candidate, **manual} for candidate in sampled]
    return sampled or [manual]


def _same_parameter_value(left: Any, right: Any) -> bool:
    """Compare recipe values after a JSON client round-trip.

    JSON has a single number type, so browsers serialize an integral float such
    as ``10.0`` as ``10``.  Sequence-valued estimator settings also cross the
    boundary as arrays.  Match those representations semantically while still
    keeping booleans, strings, nulls, keys, and collection shapes strict.
    """
    if isinstance(left, np.generic):
        left = left.item()
    if isinstance(right, np.generic):
        right = right.item()
    if isinstance(left, np.ndarray):
        left = left.tolist()
    if isinstance(right, np.ndarray):
        right = right.tolist()
    if isinstance(left, tuple):
        left = list(left)
    if isinstance(right, tuple):
        right = list(right)
    if isinstance(left, dict) or isinstance(right, dict):
        return (
            isinstance(left, dict)
            and isinstance(right, dict)
            and left.keys() == right.keys()
            and all(_same_parameter_value(left[key], right[key]) for key in left)
        )
    if isinstance(left, list) or isinstance(right, list):
        return (
            isinstance(left, list)
            and isinstance(right, list)
            and len(left) == len(right)
            and all(_same_parameter_value(a, b) for a, b in zip(left, right))
        )
    if isinstance(left, bool) or isinstance(right, bool):
        return isinstance(left, bool) and isinstance(right, bool) and left is right
    numeric = (int, float)
    if isinstance(left, numeric) or isinstance(right, numeric):
        return (
            isinstance(left, numeric)
            and isinstance(right, numeric)
            and math.isfinite(float(left))
            and math.isfinite(float(right))
            and left == right
        )
    return type(left) is type(right) and left == right


def _matching_recipe_params(
    requested: dict[str, Any], candidates: list[dict[str, Any]],
) -> Optional[dict[str, Any]]:
    return next(
        (candidate for candidate in candidates if _same_parameter_value(candidate, requested)),
        None,
    )


def _resolve_strategy(req: EvaluateRequest) -> str:
    strategy = req.validation.strategy
    if strategy == "auto":
        return "stratified" if req.task == "classification" else "random"
    if strategy == "stratified" and req.task != "classification":
        raise ValueError("Stratified validation is available only for classification.")
    return strategy


def _effective_folds(y: np.ndarray, requested: int, task: str, strategy: str,
                     groups: Optional[np.ndarray]) -> int:
    limit = len(y)
    if task == "classification" and strategy in {"stratified", "group"}:
        limit = min(limit, int(min(np.sum(y == value) for value in np.unique(y))))
    if strategy == "group":
        limit = min(limit, len(np.unique(groups)))
    if strategy == "time":
        limit = min(limit, max(2, len(y) // 3))
    folds = min(requested, limit)
    if folds < 2:
        raise ValueError(f"The data supports fewer than two {strategy} validation folds.")
    return int(folds)


def _splits(y: np.ndarray, req: EvaluateRequest, requested: int,
            groups: Optional[np.ndarray] = None,
            times: Optional[np.ndarray] = None,
            seed_offset: int = 0) -> list[tuple[np.ndarray, np.ndarray]]:
    strategy = _resolve_strategy(req)
    folds = _effective_folds(y, requested, req.task, strategy, groups)
    indices = np.arange(len(y))
    if strategy == "stratified":
        splitter = StratifiedKFold(n_splits=folds, shuffle=True,
                                    random_state=req.validation.seed + seed_offset)
        result = list(splitter.split(indices, y))
    elif strategy == "group":
        if groups is None:
            raise ValueError("Group validation requires group values.")
        if req.task == "classification":
            splitter = StratifiedGroupKFold(
                n_splits=folds, shuffle=True,
                random_state=req.validation.seed + seed_offset,
            )
            result = list(splitter.split(indices, y, groups))
        else:
            result = list(GroupKFold(n_splits=folds).split(indices, y, groups))
    elif strategy == "time":
        if times is None:
            raise ValueError("Time validation requires time values.")
        order = np.argsort(times, kind="mergesort")
        result = [(order[train], order[test]) for train, test in
                  TimeSeriesSplit(n_splits=folds).split(order)]
    else:
        splitter = KFold(n_splits=folds, shuffle=True,
                         random_state=req.validation.seed + seed_offset)
        result = list(splitter.split(indices, y))

    valid: list[tuple[np.ndarray, np.ndarray]] = []
    all_classes = set(np.unique(y)) if req.task == "classification" else set()
    for train, test in result:
        if len(train) < 4 or len(test) < 1:
            continue
        if req.task == "regression" and len(test) < 2:
            continue
        if req.task == "classification":
            # Every training fold must be estimable.  A held-out group or time
            # window may legitimately contain only a subset of classes; keep
            # it so those observations are not silently removed from the
            # out-of-sample result.
            if set(np.unique(y[train])) != all_classes:
                continue
        valid.append((np.asarray(train), np.asarray(test)))
    if len(valid) < 2:
        raise ValueError(
            f"Fewer than two valid {strategy} folds contain sufficient rows/classes. "
            "Add data or choose a different validation structure."
        )
    return valid


def _fit(model: Any, X: pd.DataFrame, y: np.ndarray) -> tuple[Any, dict[str, Any]]:
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always", ConvergenceWarning)
        model.fit(X, y)
    convergence = [str(item.message) for item in caught
                   if issubclass(item.category, ConvergenceWarning)]
    estimator = model.named_steps.get("estimator") if isinstance(model, Pipeline) else model
    n_iter_raw = getattr(estimator, "n_iter_", None)
    n_iter = None
    if n_iter_raw is not None:
        values = np.asarray(n_iter_raw)
        n_iter = int(np.max(values)) if values.size else None
    fit_status = int(getattr(estimator, "fit_status_", 0) or 0)
    if fit_status and not convergence:
        convergence.append(f"fit_status_={fit_status} indicates non-convergence.")
    return model, {
        "converged": not convergence and fit_status == 0,
        "warnings": convergence,
        "n_iter": n_iter,
        "max_iter": getattr(estimator, "max_iter", None),
    }


def _probabilities(model: Any, X: pd.DataFrame, n_classes: int) -> Optional[np.ndarray]:
    if hasattr(model, "predict_proba"):
        values = np.asarray(model.predict_proba(X), dtype=float)
        if values.ndim == 2 and values.shape[1] == n_classes:
            return values
    if hasattr(model, "decision_function"):
        raw = np.asarray(model.decision_function(X), dtype=float)
        if raw.ndim == 1 and n_classes == 2:
            p = expit(raw)
            return np.column_stack([1.0 - p, p])
        if raw.ndim == 2:
            shifted = raw - np.max(raw, axis=1, keepdims=True)
            exp = np.exp(shifted)
            return exp / np.sum(exp, axis=1, keepdims=True)
    return None


def _metric_points(task: str, y: np.ndarray, predicted: np.ndarray,
                   probabilities: Optional[np.ndarray], positive: Optional[int],
                   costs: Optional[DecisionCosts]) -> dict[str, float]:
    if task == "regression":
        return {
            "r2": float(r2_score(y, predicted)),
            "rmse": float(math.sqrt(mean_squared_error(y, predicted))),
            "mae": float(mean_absolute_error(y, predicted)),
            "median_absolute_error": float(median_absolute_error(y, predicted)),
        }
    out = {
        "accuracy": float(accuracy_score(y, predicted)),
        "balanced_accuracy": float(balanced_accuracy_score(y, predicted)),
        "precision_macro": float(precision_score(y, predicted, average="macro", zero_division=0)),
        "recall_macro": float(recall_score(y, predicted, average="macro", zero_division=0)),
        "f1_macro": float(f1_score(y, predicted, average="macro", zero_division=0)),
    }
    if probabilities is not None:
        labels = np.arange(probabilities.shape[1])
        try:
            out["log_loss"] = float(log_loss(y, probabilities, labels=labels))
        except ValueError:
            pass
        confidence = np.max(probabilities, axis=1)
        correct = (np.argmax(probabilities, axis=1) == y).astype(float)
        edges = np.linspace(0.0, 1.0, 11)
        ece = 0.0
        for lo, hi in zip(edges[:-1], edges[1:]):
            mask = (confidence >= lo) & (confidence < hi if hi < 1 else confidence <= hi)
            if np.any(mask):
                ece += np.mean(mask) * abs(float(np.mean(correct[mask]) - np.mean(confidence[mask])))
        out["expected_calibration_error"] = float(ece)
        if probabilities.shape[1] == 2 and positive is not None:
            binary = (y == positive).astype(int)
            prob = probabilities[:, positive]
            try:
                out["roc_auc"] = float(roc_auc_score(binary, prob))
                out["average_precision"] = float(average_precision_score(binary, prob))
                out["brier_score"] = float(brier_score_loss(binary, prob))
            except ValueError:
                pass
        elif probabilities.shape[1] > 2:
            try:
                out["roc_auc_ovr_macro"] = float(
                    roc_auc_score(y, probabilities, multi_class="ovr", average="macro")
                )
            except ValueError:
                pass
            onehot = np.eye(probabilities.shape[1])[y.astype(int)]
            out["brier_score"] = float(np.mean(np.sum((probabilities - onehot) ** 2, axis=1)))
    if positive is not None and len(np.unique(y)) == 2:
        binary = (y == positive).astype(int)
        predicted_binary = (predicted == positive).astype(int)
        out["precision_positive"] = float(precision_score(binary, predicted_binary, zero_division=0))
        out["recall_positive"] = float(recall_score(binary, predicted_binary, zero_division=0))
        out["f1_positive"] = float(f1_score(binary, predicted_binary, zero_division=0))
        if costs is not None:
            fp = np.sum((predicted_binary == 1) & (binary == 0))
            fn = np.sum((predicted_binary == 0) & (binary == 1))
            out["expected_cost"] = float(
                (costs.false_positive * fp + costs.false_negative * fn) / len(y)
            )
    return out


def _default_metric(req: EvaluateRequest) -> str:
    if req.selection_metric:
        return req.selection_metric
    return "balanced_accuracy" if req.task == "classification" else "rmse"


def _metric_utility(points: dict[str, float], metric: str) -> float:
    value = points.get(metric)
    if value is None or not math.isfinite(value):
        return -math.inf
    if metric in {"rmse", "mae", "median_absolute_error", "log_loss",
                  "brier_score", "expected_calibration_error", "expected_cost"}:
        return -float(value)
    return float(value)


def _binary_predictions(probability: np.ndarray, threshold: float,
                        positive: int) -> np.ndarray:
    negative = 1 - positive
    return np.where(probability >= threshold, positive, negative).astype(int)


def _choose_threshold(y: np.ndarray, probability: np.ndarray, req: EvaluateRequest,
                      positive: int) -> tuple[float, dict[str, Any]]:
    metric = _default_metric(req)
    candidates = np.unique(np.concatenate([
        np.linspace(0.05, 0.95, 91),
        np.quantile(probability, np.linspace(0.05, 0.95, 31)),
        np.asarray([0.5]),
    ]))
    best_threshold = 0.5
    best_utility = -math.inf
    curve = []
    for threshold in candidates:
        predicted = _binary_predictions(probability, float(threshold), positive)
        points = _metric_points("classification", y, predicted,
                                np.column_stack([1 - probability, probability])
                                if positive == 1 else
                                np.column_stack([probability, 1 - probability]),
                                positive, req.costs)
        utility = _metric_utility(points, metric)
        if utility > best_utility or (utility == best_utility and abs(threshold - 0.5) < abs(best_threshold - 0.5)):
            best_threshold, best_utility = float(threshold), utility
        curve.append({
            "threshold": float(threshold),
            "selection_value": points.get(metric),
            "expected_cost": points.get("expected_cost"),
            "recall_positive": points.get("recall_positive"),
            "precision_positive": points.get("precision_positive"),
        })
    return best_threshold, {"metric": metric, "curve": curve}


def _fit_calibrator(probability: np.ndarray, y_binary: np.ndarray,
                    method: str) -> dict[str, Any]:
    clipped = np.clip(probability, 1e-7, 1 - 1e-7)
    if method == "sigmoid":
        model = LogisticRegression(C=1e6, max_iter=2000).fit(
            logit(clipped).reshape(-1, 1), y_binary
        )
        return {
            "method": "sigmoid",
            "coefficient": float(model.coef_[0, 0]),
            "intercept": float(model.intercept_[0]),
        }
    if method == "isotonic":
        if len(probability) < 100 or min(np.sum(y_binary == 0), np.sum(y_binary == 1)) < 20:
            raise ValueError(
                "Isotonic calibration requires at least 100 inner predictions and 20 observations per class."
            )
        model = IsotonicRegression(out_of_bounds="clip").fit(probability, y_binary)
        return {
            "method": "isotonic",
            "x_thresholds": model.X_thresholds_.tolist(),
            "y_thresholds": model.y_thresholds_.tolist(),
        }
    return {"method": "none"}


def _apply_calibrator(probability: np.ndarray, state: Optional[dict[str, Any]]) -> np.ndarray:
    if not state or state.get("method") == "none":
        return np.asarray(probability, dtype=float)
    if state["method"] == "sigmoid":
        clipped = np.clip(probability, 1e-7, 1 - 1e-7)
        return expit(state["coefficient"] * logit(clipped) + state["intercept"])
    if state["method"] == "isotonic":
        return np.interp(
            probability, np.asarray(state["x_thresholds"], dtype=float),
            np.asarray(state["y_thresholds"], dtype=float),
        )
    raise ValueError(f"Unknown calibration method '{state.get('method')}'.")


def _inner_predictions(model_name: str, params: dict[str, Any], prepared: PreparedData,
                       req: EvaluateRequest, train_index: np.ndarray,
                       inner_splits: list[tuple[np.ndarray, np.ndarray]],
                       cancel: Optional[threading.Event]) -> tuple[np.ndarray, Optional[np.ndarray]]:
    y_train = prepared.y[train_index]
    pred = np.empty(len(train_index), dtype=float if req.task == "regression" else int)
    pred[:] = np.nan if req.task == "regression" else -1
    probabilities = None
    if req.task == "classification":
        probabilities = np.full((len(train_index), len(prepared.classes)), np.nan)
    for fold, (local_train, local_test) in enumerate(inner_splits):
        if cancel is not None and cancel.is_set():
            raise ModelingCancelled()
        model = _make_model(model_name, prepared, req, req.validation.seed + 2000 + fold)
        model.set_params(**params)
        model, _ = _fit(model, prepared.X.iloc[train_index[local_train]], y_train[local_train])
        pred[local_test] = model.predict(prepared.X.iloc[train_index[local_test]])
        if probabilities is not None:
            p = _probabilities(model, prepared.X.iloc[train_index[local_test]], len(prepared.classes))
            if p is not None:
                probabilities[local_test] = p
    return pred, probabilities


def _choose_params(model_name: str, candidates: list[dict[str, Any]],
                   prepared: PreparedData, req: EvaluateRequest,
                   train_index: np.ndarray,
                   inner_splits: list[tuple[np.ndarray, np.ndarray]],
                   progress: Optional[Callable[[dict[str, Any]], None]],
                   cancel: Optional[threading.Event], outer_fold: int) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    y_train = prepared.y[train_index]
    metric = _default_metric(req)
    rows: list[dict[str, Any]] = []
    best: Optional[dict[str, Any]] = None
    best_utility = -math.inf
    for candidate_index, params in enumerate(candidates):
        if cancel is not None and cancel.is_set():
            raise ModelingCancelled()
        failures: list[str] = []
        candidate_predicted = np.full(
            len(train_index), np.nan if req.task == "regression" else -1,
            dtype=float if req.task == "regression" else int,
        )
        candidate_probabilities = (
            np.full((len(train_index), len(prepared.classes)), np.nan)
            if req.task == "classification" else None
        )
        successful_folds = 0
        for local_train, local_test in inner_splits:
            try:
                model = _make_model(model_name, prepared, req,
                                    req.validation.seed + outer_fold * 101 + candidate_index)
                model.set_params(**params)
                model, fit_diag = _fit(
                    model, prepared.X.iloc[train_index[local_train]], y_train[local_train],
                )
                if not fit_diag["converged"]:
                    raise ValueError("; ".join(fit_diag["warnings"]) or "Estimator did not converge.")
                predicted = np.asarray(model.predict(prepared.X.iloc[train_index[local_test]]))
                probabilities = (_probabilities(
                    model, prepared.X.iloc[train_index[local_test]], len(prepared.classes)
                ) if req.task == "classification" else None)
                candidate_predicted[local_test] = predicted
                if candidate_probabilities is not None and probabilities is not None:
                    candidate_probabilities[local_test] = probabilities
                successful_folds += 1
            except Exception as exc:  # candidate-level fail-soft contract
                failures.append(str(exc))
        valid = (np.isfinite(candidate_predicted) if req.task == "regression"
                 else candidate_predicted >= 0)
        selection_threshold = None
        selection_probability = None
        selection_utility = -math.inf
        # Partial-fold success can make a candidate look artificially strong,
        # so it is recorded but never selected.
        if successful_folds == len(inner_splits) and np.any(valid):
            scored_prediction = candidate_predicted[valid]
            if candidate_probabilities is not None:
                probability_valid = np.all(np.isfinite(candidate_probabilities[valid]), axis=1)
                if np.all(probability_valid):
                    selection_probability = candidate_probabilities[valid]
            if (
                req.task == "classification"
                and selection_probability is not None
                and len(prepared.classes or []) == 2
            ):
                positive_probability = selection_probability[:, prepared.positive_index]
                selection_threshold, _ = _choose_threshold(
                    y_train[valid], positive_probability, req, prepared.positive_index,
                )
                scored_prediction = _binary_predictions(
                    positive_probability, selection_threshold, prepared.positive_index,
                )
            points = _metric_points(
                req.task, y_train[valid], scored_prediction, selection_probability,
                prepared.positive_index, req.costs,
            )
            selection_utility = _metric_utility(points, metric)
        row = {
            "params": params,
            "mean_utility": selection_utility if math.isfinite(selection_utility) else None,
            "selection_threshold": selection_threshold,
            "successful_folds": successful_folds,
            "failed_folds": len(inner_splits) - successful_folds,
            "errors": failures[:3],
        }
        rows.append(row)
        if selection_utility > best_utility:
            best, best_utility = params, selection_utility
        if progress:
            progress({
                "type": "progress", "stage": "tuning", "model": model_name,
                "outer_fold": outer_fold + 1, "candidate": candidate_index + 1,
                "candidates": len(candidates),
            })
    if best is None:
        raise ValueError("Every hyperparameter candidate failed in inner validation.")
    return best, rows


def _resample_indices(y: np.ndarray, req: EvaluateRequest,
                      groups: Optional[np.ndarray], times: Optional[np.ndarray],
                      rng: np.random.Generator) -> np.ndarray:
    n = len(y)
    strategy = _resolve_strategy(req)
    if strategy == "group" and groups is not None:
        unique = np.unique(groups)
        sampled = rng.choice(unique, size=len(unique), replace=True)
        return np.concatenate([np.where(groups == group)[0] for group in sampled])
    if strategy == "time":
        block = max(2, int(round(math.sqrt(n))))
        order = np.argsort(times, kind="mergesort") if times is not None else np.arange(n)
        starts = rng.integers(0, max(1, n - block + 1), size=math.ceil(n / block))
        positions = np.concatenate([
            np.arange(start, min(n, start + block)) for start in starts
        ])[:n]
        return order[positions]
    if req.task == "classification":
        return np.concatenate([
            rng.choice(np.where(y == cls)[0], size=np.sum(y == cls), replace=True)
            for cls in np.unique(y)
        ])
    return rng.integers(0, n, size=n)


def _metric_intervals(task: str, y: np.ndarray, predicted: np.ndarray,
                      probabilities: Optional[np.ndarray], prepared: PreparedData,
                      req: EvaluateRequest, valid_original_positions: np.ndarray) -> dict[str, dict[str, Any]]:
    points = _metric_points(task, y, predicted, probabilities,
                            prepared.positive_index, req.costs)
    groups = prepared.groups[valid_original_positions] if prepared.groups is not None else None
    times = prepared.times[valid_original_positions] if prepared.times is not None else None
    rng = np.random.default_rng(req.validation.seed + 9173)
    draws: dict[str, list[float]] = {key: [] for key in points}
    for _ in range(req.metric_resamples):
        idx = _resample_indices(y, req, groups, times, rng)
        if task == "classification" and len(np.unique(y[idx])) < len(np.unique(y)):
            continue
        sample = _metric_points(
            task, y[idx], predicted[idx],
            probabilities[idx] if probabilities is not None else None,
            prepared.positive_index, req.costs,
        )
        for key, value in sample.items():
            if key in draws and math.isfinite(value):
                draws[key].append(value)
    tail = (1.0 - req.confidence) / 2.0
    return {
        key: {
            "value": value,
            "lower": float(np.quantile(draws[key], tail)) if len(draws[key]) >= 20 else None,
            "upper": float(np.quantile(draws[key], 1.0 - tail)) if len(draws[key]) >= 20 else None,
            "confidence": req.confidence,
            "resamples": len(draws[key]),
        }
        for key, value in points.items()
    }


def _diagnostic_curves(task: str, y: np.ndarray, predicted: np.ndarray,
                       probabilities: Optional[np.ndarray], prepared: PreparedData,
                       threshold: Optional[float]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if task == "regression":
        residuals = y - predicted
        out["observed_predicted"] = {"observed": y.tolist(), "predicted": predicted.tolist()}
        out["residuals"] = {"predicted": predicted.tolist(), "residual": residuals.tolist()}
        return out
    labels = np.arange(len(prepared.classes))
    matrix = confusion_matrix(y, predicted, labels=labels)
    row_sums = matrix.sum(axis=1, keepdims=True)
    normalized = np.divide(
        matrix, row_sums,
        out=np.zeros_like(matrix, dtype=float), where=row_sums != 0,
    )
    out["confusion_matrix"] = {
        "labels": prepared.classes,
        "raw": matrix.tolist(),
        "normalized": normalized.tolist(),
    }
    if probabilities is not None and len(prepared.classes) == 2 and prepared.positive_index is not None:
        binary = (y == prepared.positive_index).astype(int)
        probability = probabilities[:, prepared.positive_index]
        fpr, tpr, _ = roc_curve(binary, probability)
        precision, recall, _ = precision_recall_curve(binary, probability)
        observed, mean_probability = calibration_curve(
            binary, probability, n_bins=min(10, max(3, len(binary) // 10)), strategy="quantile"
        )
        out["roc"] = {"fpr": fpr.tolist(), "tpr": tpr.tolist()}
        out["precision_recall"] = {"precision": precision.tolist(), "recall": recall.tolist()}
        out["calibration"] = {
            "mean_probability": mean_probability.tolist(),
            "observed_frequency": observed.tolist(),
        }
        out["threshold"] = threshold
    return out


def _raw_importances(model: Any, X: pd.DataFrame, y: np.ndarray,
                     req: EvaluateRequest) -> dict[str, Any]:
    scoring = (
        "balanced_accuracy" if req.task == "classification"
        else ("r2" if _default_metric(req) == "r2" else "neg_root_mean_squared_error")
    )
    try:
        result = permutation_importance(
            model, X, y, n_repeats=5, random_state=req.validation.seed,
            scoring=scoring, n_jobs=1,
        )
        return {
            "method": "held_out_permutation",
            "feature_names": list(req.features),
            "mean": result.importances_mean.tolist(),
            "std": result.importances_std.tolist(),
            "scoring": scoring,
        }
    except Exception as exc:
        return {"method": "unavailable", "reason": str(exc),
                "feature_names": list(req.features), "mean": [], "std": []}


def _aggregate_importance(records: list[dict[str, Any]], features: list[str]) -> dict[str, Any]:
    usable = [record for record in records if record.get("mean")]
    if not usable:
        return {"method": "unavailable", "feature_names": features, "mean": [], "std": []}
    matrix = np.asarray([record["mean"] for record in usable], dtype=float)
    return {
        "method": "outer_fold_permutation",
        "feature_names": features,
        "mean": np.mean(matrix, axis=0).tolist(),
        "std": np.std(matrix, axis=0).tolist(),
        "folds": len(usable),
        "scoring": usable[0].get("scoring"),
    }


def _dependence(model: Any, prepared: PreparedData, importance: dict[str, Any],
                req: EvaluateRequest) -> list[dict[str, Any]]:
    if not prepared.numeric:
        return []
    means = dict(zip(importance.get("feature_names", []), importance.get("mean", [])))
    selected = sorted(prepared.numeric, key=lambda name: means.get(name, 0), reverse=True)[:3]
    records: list[dict[str, Any]] = []
    for name in selected:
        try:
            result = partial_dependence(
                model, prepared.X, [name], kind="both", grid_resolution=25,
                percentiles=(0.05, 0.95), method="brute",
            )
            grid = result.get("grid_values", result.get("values"))[0]
            average = np.asarray(result["average"])
            individual = np.asarray(result["individual"])
            if average.ndim > 1:
                average = average[0]
            if individual.ndim == 3:
                individual = individual[0]
            cap = min(50, individual.shape[0]) if individual.ndim == 2 else 0
            records.append({
                "feature": name,
                "grid": np.asarray(grid).tolist(),
                "average": np.asarray(average).tolist(),
                "individual": individual[:cap].tolist() if cap else [],
                "kind": "partial_dependence_and_ice",
            })
        except Exception as exc:
            records.append({"feature": name, "error": str(exc)})
    return records


def _correlation_warnings(prepared: PreparedData) -> list[str]:
    if len(prepared.numeric) < 2:
        return []
    correlation = prepared.X[prepared.numeric].corr().abs()
    warnings_out: list[str] = []
    for i, left in enumerate(prepared.numeric):
        for right in prepared.numeric[i + 1:]:
            value = correlation.loc[left, right]
            if pd.notna(value) and value >= 0.7:
                warnings_out.append(
                    f"{left} and {right} are strongly correlated (|r|={value:.3f}); "
                    "permutation importance and partial dependence may understate or distort their separate effects."
                )
    return warnings_out


def _classical_inference(model_name: str, prepared: PreparedData,
                         req: EvaluateRequest, params: dict[str, Any]) -> Optional[dict[str, Any]]:
    if model_name not in CLASSICAL_INFERENCE_MODELS or prepared.categorical:
        return None
    if req.missing_policy != "drop" and prepared.X[prepared.numeric].isna().any().any():
        return None
    X = prepared.X[req.features].to_numpy(dtype=float)
    y = prepared.y.astype(float)
    try:
        if model_name == "linear":
            result = linear_regression(X, y, feature_names=req.features, CI=req.confidence)
        elif model_name == "ridge":
            result = ridge_regression(
                X, y, alpha=float(params.get("estimator__alpha", 1.0)),
                feature_names=req.features,
            )
        elif model_name == "lasso":
            result = lasso_regression(
                X, y, alpha=float(params.get("estimator__alpha", 0.1)),
                feature_names=req.features,
            )
        elif model_name == "elastic_net":
            result = elastic_net_regression(
                X, y, alpha=float(params.get("estimator__alpha", 0.1)),
                l1_ratio=float(params.get("estimator__l1_ratio", 0.5)),
                feature_names=req.features,
            )
        elif model_name == "logistic":
            result = logistic_regression(X, y, feature_names=req.features, CI=req.confidence)
        elif model_name == "polynomial" and len(req.features) == 1:
            result = polynomial_regression(
                X[:, 0], y, degree=int(params.get("polynomial__degree", 2)), CI=req.confidence,
            )
        else:
            return None
        return _safe(result)
    except Exception as exc:
        return {"status": "unavailable", "reason": str(exc)}


def _model_eligibility(spec: ModelSpec, prepared: PreparedData,
                       req: EvaluateRequest) -> Optional[str]:
    available = REGRESSION_MODELS if req.task == "regression" else CLASSIFICATION_MODELS
    if spec.model not in available:
        return f"{MODEL_LABELS[spec.model]} does not support {req.task}."
    if spec.model == "polynomial" and len(req.features) != 1:
        return "Polynomial regression currently requires exactly one predictor."
    if spec.model == "polynomial" and prepared.categorical:
        return "Polynomial regression requires a numeric predictor."
    if spec.model == "logistic" and len(prepared.classes or []) != 2:
        return "Classical logistic regression requires exactly two classes."
    return None


def _evaluate_one(spec: ModelSpec, prepared: PreparedData, req: EvaluateRequest,
                  outer_splits: list[tuple[np.ndarray, np.ndarray]],
                  progress: Optional[Callable[[dict[str, Any]], None]],
                  cancel: Optional[threading.Event]) -> dict[str, Any]:
    started = time.perf_counter()
    reason = _model_eligibility(spec, prepared, req)
    if reason:
        return {
            "model": spec.model, "label": MODEL_LABELS[spec.model],
            "status": "ineligible", "reason": reason, "metrics": {},
        }
    candidates = _candidates(spec, req, len(prepared.y))
    n = len(prepared.y)
    predicted = np.full(n, np.nan if req.task == "regression" else -1.0)
    probabilities = (np.full((n, len(prepared.classes)), np.nan)
                     if req.task == "classification" else None)
    fold_rows: list[dict[str, Any]] = []
    threshold_values: list[float] = []
    calibration_states: list[dict[str, Any]] = []
    importances: list[dict[str, Any]] = []
    search_records: list[dict[str, Any]] = []
    convergence_warnings: list[str] = []

    resolved = req.validation.resolved()
    for outer_fold, (train_index, test_index) in enumerate(outer_splits):
        if cancel is not None and cancel.is_set():
            raise ModelingCancelled()
        inner = _splits(
            prepared.y[train_index], req, resolved["inner_folds"],
            prepared.groups[train_index] if prepared.groups is not None else None,
            prepared.times[train_index] if prepared.times is not None else None,
            seed_offset=100 + outer_fold,
        )
        best_params, candidate_rows = _choose_params(
            spec.model, candidates, prepared, req, train_index, inner,
            progress, cancel, outer_fold,
        )
        search_records.append({"outer_fold": outer_fold + 1, "candidates": candidate_rows,
                               "selected_params": best_params})

        calibration_state: Optional[dict[str, Any]] = None
        threshold = None
        if req.task == "classification" and len(prepared.classes) == 2:
            _, inner_probabilities = _inner_predictions(
                spec.model, best_params, prepared, req, train_index, inner, cancel,
            )
            if inner_probabilities is not None:
                valid = np.all(np.isfinite(inner_probabilities), axis=1)
                if np.sum(valid) >= 4 and len(np.unique(prepared.y[train_index][valid])) == 2:
                    probability = inner_probabilities[valid, prepared.positive_index]
                    y_inner = prepared.y[train_index][valid]
                    if req.calibration != "none":
                        calibration_state = _fit_calibrator(
                            probability, (y_inner == prepared.positive_index).astype(int), req.calibration,
                        )
                        probability = _apply_calibrator(probability, calibration_state)
                    threshold, threshold_detail = _choose_threshold(
                        y_inner, probability, req, prepared.positive_index,
                    )
                    threshold_values.append(threshold)
                    if calibration_state:
                        calibration_states.append(calibration_state)
                else:
                    threshold_detail = {
                        "metric": _default_metric(req), "curve": [],
                        "reason": "Estimator does not provide probability estimates.",
                    }
            else:
                threshold_detail = {"metric": _default_metric(req), "curve": []}
        else:
            threshold_detail = None

        model = _make_model(spec.model, prepared, req,
                            req.validation.seed + 10_000 + outer_fold)
        model.set_params(**best_params)
        model, fit_diag = _fit(model, prepared.X.iloc[train_index], prepared.y[train_index])
        convergence_warnings.extend(fit_diag["warnings"])
        fold_probability = (_probabilities(
            model, prepared.X.iloc[test_index], len(prepared.classes)
        ) if req.task == "classification" else None)
        if fold_probability is not None and calibration_state and len(prepared.classes) == 2:
            pos = prepared.positive_index
            calibrated = _apply_calibrator(fold_probability[:, pos], calibration_state)
            fold_probability[:, pos] = calibrated
            fold_probability[:, 1 - pos] = 1.0 - calibrated
        if fold_probability is not None and threshold is not None:
            fold_prediction = _binary_predictions(
                fold_probability[:, prepared.positive_index], threshold, prepared.positive_index,
            )
        else:
            fold_prediction = np.asarray(model.predict(prepared.X.iloc[test_index]))
        predicted[test_index] = fold_prediction
        if probabilities is not None and fold_probability is not None:
            probabilities[test_index] = fold_probability
        fold_points = _metric_points(
            req.task, prepared.y[test_index], fold_prediction,
            fold_probability, prepared.positive_index, req.costs,
        )
        fold_rows.append({
            "fold": outer_fold + 1,
            "n_train": len(train_index), "n_test": len(test_index),
            "metrics": fold_points, "selected_params": best_params,
            "threshold": threshold, "calibration": calibration_state,
            "fit_diagnostics": fit_diag,
            "train_row_indices": prepared.row_indices[train_index].tolist(),
            "test_row_indices": prepared.row_indices[test_index].tolist(),
            "threshold_detail": threshold_detail,
        })
        importances.append(_raw_importances(
            model, prepared.X.iloc[test_index], prepared.y[test_index], req,
        ))
        if progress:
            progress({
                "type": "progress", "stage": "outer_validation",
                "model": spec.model, "outer_fold": outer_fold + 1,
                "outer_folds": len(outer_splits),
            })

    valid = np.isfinite(predicted) if req.task == "regression" else predicted >= 0
    if probabilities is not None:
        probability_valid = np.all(np.isfinite(probabilities), axis=1)
        metric_probabilities = probabilities[valid] if np.all(probability_valid[valid]) else None
    else:
        metric_probabilities = None
    y_valid = prepared.y[valid]
    pred_valid = predicted[valid].astype(float if req.task == "regression" else int)
    valid_positions = np.where(valid)[0]
    metrics = _metric_intervals(
        req.task, y_valid, pred_valid, metric_probabilities,
        prepared, req, valid_positions,
    )
    diagnostics = _diagnostic_curves(
        req.task, y_valid, pred_valid, metric_probabilities, prepared,
        float(np.median(threshold_values)) if threshold_values else None,
    )
    importance = _aggregate_importance(importances, req.features)

    full_index = np.arange(n)
    full_inner = _splits(prepared.y, req, resolved["inner_folds"],
                         prepared.groups, prepared.times, seed_offset=701)
    final_params, final_search = _choose_params(
        spec.model, candidates, prepared, req, full_index, full_inner,
        progress, cancel, len(outer_splits),
    )
    final_model = _make_model(spec.model, prepared, req, req.validation.seed + 99_001)
    final_model.set_params(**final_params)
    final_model, final_diag = _fit(final_model, prepared.X, prepared.y)
    dependence = _dependence(final_model, prepared, importance, req)

    conformal = None
    if req.task == "regression":
        residual = np.abs(y_valid - pred_valid)
        level = min(1.0, math.ceil((len(residual) + 1) * req.confidence) / len(residual))
        half_width = float(np.quantile(residual, level, method="higher"))
        conformal = {
            "method": "cross_validated_residual_quantile",
            "confidence": req.confidence,
            "half_width": half_width,
            "coverage_scope": (
                "exchangeable_rows_approximate_cv" if _resolve_strategy(req) in {"random", "stratified"}
                else "empirical_held_out_residual_band"
            ),
            "formal_finite_sample_guarantee": False,
        }
        diagnostics["observed_predicted"]["lower"] = (pred_valid - half_width).tolist()
        diagnostics["observed_predicted"]["upper"] = (pred_valid + half_width).tolist()

    selected_threshold = float(np.median(threshold_values)) if threshold_values else None
    selected_calibration = (
        {
            "method": req.calibration,
            "scope": "refit_separately_within_each_outer_training_fold",
            "folds": len(calibration_states),
        }
        if req.calibration != "none" else None
    )
    inference = _classical_inference(spec.model, prepared, req, final_params)
    warnings_out = list(dict.fromkeys(convergence_warnings + _correlation_warnings(prepared)))
    if inference is None and spec.model in CLASSICAL_INFERENCE_MODELS:
        warnings_out.append(
            "Classical coefficient inference is withheld when categorical predictors or imputed values are present."
        )
    return _safe({
        "model": spec.model, "label": MODEL_LABELS[spec.model], "status": "eligible",
        "selection_metric": _default_metric(req), "metrics": metrics,
        "folds": fold_rows, "selected_params": final_params,
        "search": {"outer": search_records, "final": final_search},
        "oof": {
            "row_indices": prepared.row_indices[valid].tolist(),
            "actual": prepared.y_display[valid].tolist(),
            "actual_encoded": y_valid.tolist(),
            "predicted": (
                [prepared.classes[int(v)] for v in pred_valid]
                if req.task == "classification" else pred_valid.tolist()
            ),
            "predicted_encoded": pred_valid.tolist(),
            "probabilities": metric_probabilities.tolist() if metric_probabilities is not None else None,
        },
        "diagnostics": diagnostics,
        "permutation_importance": importance,
        "partial_dependence": dependence,
        "threshold": selected_threshold,
        "calibration_state": selected_calibration,
        "conformal": conformal,
        "fit_diagnostics": final_diag,
        "inference": inference,
        "warnings": warnings_out,
        "runtime_seconds": time.perf_counter() - started,
    })


def evaluate_models(req: EvaluateRequest,
                    progress: Optional[Callable[[dict[str, Any]], None]] = None,
                    cancel: Optional[threading.Event] = None) -> dict[str, Any]:
    started = time.perf_counter()
    prepared = _prepare(req)
    resolved = req.validation.resolved()
    outer = _splits(prepared.y, req, resolved["outer_folds"],
                    prepared.groups, prepared.times)
    if progress:
        progress({
            "type": "start", "models": len(req.models),
            "models_done": 0, "models_total": len(req.models),
            "outer_folds": len(outer), "readiness": prepared.readiness,
        })
    results: list[dict[str, Any]] = []
    for index, spec in enumerate(req.models):
        if cancel is not None and cancel.is_set():
            raise ModelingCancelled()
        model_progress = None
        if progress:
            def model_progress(event: dict[str, Any], completed=index) -> None:
                progress({
                    **event,
                    "models_done": completed,
                    "models_total": len(req.models),
                    "outer_folds": len(outer),
                })
        try:
            result = _evaluate_one(spec, prepared, req, outer, model_progress, cancel)
        except ModelingCancelled:
            raise
        except Exception as exc:
            result = {
                "model": spec.model, "label": MODEL_LABELS[spec.model],
                "status": "failed", "reason": str(exc), "metrics": {},
            }
        results.append(result)
        if progress:
            progress({
                "type": "progress", "stage": "model_complete",
                "model": spec.model, "models_done": index + 1,
                "models_total": len(req.models),
            })

    selection_metric = _default_metric(req)
    eligible = [row for row in results if row["status"] == "eligible"]
    eligible.sort(
        key=lambda row: _metric_utility(
            {name: detail["value"] for name, detail in row["metrics"].items()},
            selection_metric,
        ), reverse=True,
    )
    rank = {row["model"]: i + 1 for i, row in enumerate(eligible)}
    for row in results:
        row["rank"] = rank.get(row["model"])
    recommended = eligible[0]["model"] if eligible else None
    return _safe({
        "schema_version": 1,
        "task": req.task,
        "selection_metric": selection_metric,
        "recommended_model": recommended,
        "readiness": prepared.readiness,
        "data_schema": prepared.schema,
        "validation": {
            **resolved, "strategy": _resolve_strategy(req),
            "outer_folds_used": len(outer),
            "nested": True,
            "preprocessing_scope": "fit_inside_each_training_fold",
            "selection_scope": "inner_validation_only",
            "reported_performance_scope": "outer_validation_predictions",
            "metric_interval_method": (
                "cluster_bootstrap" if _resolve_strategy(req) == "group" else
                "moving_block_bootstrap" if _resolve_strategy(req) == "time" else
                "stratified_bootstrap" if req.task == "classification" else
                "row_bootstrap"
            ),
        },
        "models": results,
        "versions": _versions(),
        "runtime_seconds": time.perf_counter() - started,
    })


@router.post("/evaluate")
def evaluate(req: EvaluateRequest):
    try:
        return evaluate_models(req)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/evaluate/stream", response_class=StreamingResponse, responses={
    200: {"content": {"application/x-ndjson": {"schema": {"type": "string"}}}},
})
async def evaluate_stream(req: EvaluateRequest, request: Request):
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    cancel = threading.Event()
    loop = asyncio.get_running_loop()

    def report(event: dict[str, Any]) -> None:
        loop.call_soon_threadsafe(queue.put_nowait, event)

    task = asyncio.create_task(asyncio.to_thread(evaluate_models, req, report, cancel))

    async def events():
        try:
            while True:
                if await request.is_disconnected():
                    cancel.set()
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=0.25)
                    yield json.dumps(_safe(event), separators=(",", ":")) + "\n"
                except asyncio.TimeoutError:
                    if task.done():
                        break
            if not cancel.is_set():
                try:
                    result = await task
                    yield json.dumps(stream_result_event(result), separators=(",", ":")) + "\n"
                except ModelingCancelled:
                    yield json.dumps(stream_error_event(
                        "Modeling cancelled.", request_id_value=getattr(request.state, "request_id", ""),
                        status=499, code="cancelled",
                    )) + "\n"
                except Exception:
                    logger.exception("Unexpected modeling stream failure.")
                    yield json.dumps(stream_error_event(
                        "The modeling run failed. Use the request ID when reporting this error.",
                        request_id_value=getattr(request.state, "request_id", ""),
                    )) + "\n"
        finally:
            cancel.set()

    return StreamingResponse(events(), media_type="application/x-ndjson")


def _training_snapshot(req: EvaluateRequest, prepared: PreparedData) -> dict[str, list[Any]]:
    columns = list(dict.fromkeys([
        *req.features, req.target,
        req.validation.group_column or "", req.validation.time_column or "",
    ]))
    return {
        name: [req.data[name][int(i)] for i in prepared.row_indices]
        for name in columns if name
    }


def _onnx_convert(model: Any, prepared: PreparedData, req: EvaluateRequest) -> dict[str, Any]:
    try:
        import onnx
        import onnxruntime as ort
        from skl2onnx import convert_sklearn
        from skl2onnx.common.data_types import FloatTensorType, StringTensorType
    except ImportError as exc:
        return {
            "kind": "recipe", "available": False,
            "reason": f"ONNX export dependencies are unavailable: {exc}",
        }
    if isinstance(model, CHAIDAdapter):
        return {"kind": "native_chaid", "available": False,
                "reason": "CHAID uses Perdura's safe native JSON tree format."}
    initial_types = []
    for name in req.features:
        if name in prepared.numeric:
            initial_types.append((name, FloatTensorType([None, 1])))
        else:
            initial_types.append((name, StringTensorType([None, 1])))
    options = None
    if req.task == "classification" and isinstance(model, Pipeline):
        # ``zipmap`` is an option of the final classifier converter, not of the
        # enclosing Pipeline (and is invalid for regressors).
        options = {id(model.named_steps["estimator"]): {"zipmap": False}}
    try:
        converted = convert_sklearn(
            model, initial_types=initial_types,
            options=options, target_opset=18,
        )
        payload = converted.SerializeToString()
        if len(payload) > 32 * 1024 * 1024:
            raise ValueError("Converted ONNX artifact exceeds the 32 MiB project limit.")
        session = ort.InferenceSession(payload, providers=["CPUExecutionProvider"])
        sample = prepared.X.iloc[:min(25, len(prepared.X))]
        feeds = {}
        for name in req.features:
            if name in prepared.numeric:
                # Preserve missing values so the exported pipeline's learned
                # imputer is exercised by the parity check too.
                values = pd.to_numeric(sample[name], errors="coerce").to_numpy(np.float32).reshape(-1, 1)
            else:
                values = sample[name].fillna("").astype(str).to_numpy().reshape(-1, 1)
            feeds[name] = values
        outputs = session.run(None, feeds)
        python_prediction = np.asarray(model.predict(sample))
        output_names = [item.name for item in session.get_outputs()]
        label_index = 0
        onnx_prediction = np.asarray(outputs[label_index]).reshape(-1)
        if req.task == "regression":
            max_error = float(np.max(np.abs(onnx_prediction.astype(float) - python_prediction.astype(float))))
            parity = max_error <= 1e-4 * max(1.0, float(np.max(np.abs(python_prediction))))
            label_parity = None
        else:
            label_parity = bool(np.array_equal(
                onnx_prediction.astype(str), python_prediction.astype(str),
            ))
            parity = label_parity
            max_error = None
        probability_index = None
        if req.task == "classification":
            for i, output in enumerate(outputs):
                arr = np.asarray(output)
                if arr.ndim == 2 and arr.shape[1] == len(prepared.classes):
                    probability_index = i
                    break
        probability_transform = None
        probability_max_error = None
        if (
            req.task == "classification"
            and probability_index is not None
            and hasattr(model, "predict_proba")
        ):
            expected_probability = np.asarray(model.predict_proba(sample), dtype=float)
            raw_probability = np.asarray(outputs[probability_index], dtype=float)
            candidates = ["identity"]
            if len(prepared.classes or []) == 2:
                # Some ai.onnx.ml tree converters emit a signed score in the
                # second column for binary classification. Record a transform
                # only when it reproduces sklearn probabilities.
                candidates.extend(["binary_second_complement", "binary_first_complement"])
            candidates.append("softmax")
            errors: list[tuple[float, str]] = []
            for candidate in candidates:
                try:
                    normalized = _onnx_probability_transform(raw_probability, candidate)
                    if normalized.shape != expected_probability.shape:
                        continue
                    error = float(np.max(np.abs(normalized - expected_probability)))
                    if np.all(np.isfinite(normalized)):
                        errors.append((error, candidate))
                except (IndexError, ValueError, FloatingPointError):
                    continue
            if not errors:
                raise ValueError("ONNX did not expose a usable probability output.")
            probability_max_error, probability_transform = min(errors)
            probability_tolerance = 1e-4 * max(
                1.0, float(np.max(np.abs(expected_probability))),
            )
            if probability_max_error > probability_tolerance:
                raise ValueError(
                    "ONNX probability parity validation failed "
                    f"(max error {probability_max_error:.6g})."
                )
            # Affected ai.onnx.ml tree converters can expose a nonstandard
            # binary score pair and derive an incorrect label output from it.
            # Once the score normalization has passed parity, Perdura derives
            # labels from those validated probabilities instead.
            parity = True
        if not parity:
            raise ValueError(f"ONNX parity validation failed (max error {max_error}).")
        graph = onnx.load_model_from_string(payload)
        operators = sorted({node.op_type for node in graph.graph.node})
        unknown_operators = sorted(set(operators) - _ALLOWED_ONNX_OPERATORS)
        if unknown_operators:
            raise ValueError(
                f"Converted graph requires unsupported operators: {unknown_operators}."
            )
        return {
            "kind": "onnx", "available": True,
            "bytes_base64": base64.b64encode(payload).decode("ascii"),
            "sha256": hashlib.sha256(payload).hexdigest(),
            "size_bytes": len(payload),
            "operators": operators,
            "node_count": len(graph.graph.node),
            "input_names": req.features,
            "output_names": output_names,
            "label_output_index": label_index,
            "probability_output_index": probability_index,
            "probability_transform": probability_transform,
            "prediction_source": (
                "probabilities" if req.task == "classification" and probability_transform
                else "label_output"
            ),
            "parity": {
                "passed": True,
                "rows": len(sample),
                "max_absolute_error": max_error,
                "probability_max_absolute_error": probability_max_error,
                "label_output_passed": label_parity,
            },
        }
    except Exception as exc:
        return {"kind": "recipe", "available": False,
                "reason": f"ONNX conversion/parity validation unavailable: {exc}"}


def _serialize_chaid(model: CHAIDAdapter, prepared: PreparedData,
                     req: EvaluateRequest) -> dict[str, Any]:
    return {
        "kind": "native_chaid", "available": True,
        "feature_names": list(model.feature_names),
        "numeric_features": list(model.numeric_features),
        "fill_values": _safe(model.fill_values_),
        "output_features": list(model.output_features_),
        "bin_edges": [None if edge is None else np.asarray(edge).tolist()
                      for edge in model.model_._bin_edges],
        "tree": model.model_.to_dict(),
        "classes": prepared.classes,
    }


def _onnx_probability_transform(values: np.ndarray, transform: str) -> np.ndarray:
    raw = np.asarray(values, dtype=float)
    if transform == "identity":
        return raw
    if transform == "binary_second_complement":
        positive = np.clip(raw[:, 1], 0.0, 1.0)
        return np.column_stack([1.0 - positive, positive])
    if transform == "binary_first_complement":
        negative = np.clip(raw[:, 0], 0.0, 1.0)
        return np.column_stack([negative, 1.0 - negative])
    if transform == "softmax":
        shifted = raw - np.max(raw, axis=1, keepdims=True)
        exponent = np.exp(shifted)
        return exponent / np.sum(exponent, axis=1, keepdims=True)
    raise ValueError(f"Unknown ONNX probability transform '{transform}'.")


def _final_calibration(model_name: str, params: dict[str, Any], prepared: PreparedData,
                       req: EvaluateRequest) -> tuple[Optional[dict[str, Any]], Optional[float]]:
    if req.task != "classification" or len(prepared.classes) != 2:
        return None, None
    resolved = req.validation.resolved()
    full = np.arange(len(prepared.y))
    inner = _splits(prepared.y, req, resolved["inner_folds"], prepared.groups, prepared.times,
                    seed_offset=4401)
    _, probabilities = _inner_predictions(model_name, params, prepared, req, full, inner, None)
    if probabilities is None:
        return None, None
    valid = np.all(np.isfinite(probabilities), axis=1)
    if np.sum(valid) < 4 or len(np.unique(prepared.y[valid])) < 2:
        return None, None
    probability = probabilities[valid, prepared.positive_index]
    y = prepared.y[valid]
    state = None
    if req.calibration != "none":
        state = _fit_calibrator(
            probability, (y == prepared.positive_index).astype(int), req.calibration,
        )
        probability = _apply_calibrator(probability, state)
    threshold, _ = _choose_threshold(y, probability, req, prepared.positive_index)
    return state, threshold


@router.post("/finalize")
def finalize(req: FinalizeRequest):
    try:
        prepared = _prepare(req.evaluation)
        spec = next((item for item in req.evaluation.models if item.model == req.model), None)
        if spec is None:
            raise ValueError("The selected model is not part of the evaluation recipe.")
        reason = _model_eligibility(spec, prepared, req.evaluation)
        if reason:
            raise ValueError(reason)
        selected_params = _matching_recipe_params(
            req.selected_params,
            _candidates(spec, req.evaluation, len(prepared.y)),
        )
        if selected_params is None:
            raise ValueError(
                "The selected parameters are outside this evaluation recipe; "
                "run model comparison again before finalizing."
            )
        model = _make_model(req.model, prepared, req.evaluation,
                            req.evaluation.validation.seed + 202_607)
        # Fit with the canonical recipe candidate, not the representation sent
        # back by the JSON client (which may have normalized numeric types).
        model.set_params(**selected_params)
        model, fit_diag = _fit(model, prepared.X, prepared.y)
        if not fit_diag["converged"]:
            raise ValueError("The final full-data estimator did not converge; finalization is blocked.")
        calibration_state, threshold = _final_calibration(
            req.model, selected_params, prepared, req.evaluation,
        )
        artifact = (_serialize_chaid(model, prepared, req.evaluation)
                    if isinstance(model, CHAIDAdapter)
                    else _onnx_convert(model, prepared, req.evaluation))
        created = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        asset_identity = hashlib.sha256(
            (prepared.schema["dataset_fingerprint"] + req.model + str(time.time_ns())).encode()
        ).hexdigest()[:16]
        asset = {
            "schema_version": 1,
            "asset_id": f"model-{asset_identity}",
            "name": f"{MODEL_LABELS[req.model]} — {req.evaluation.target}",
            "created_at": created,
            "task": req.evaluation.task,
            "model": req.model,
            "model_label": MODEL_LABELS[req.model],
            "schema": prepared.schema,
            "selected_params": selected_params,
            "validation": req.evaluation.validation.resolved(),
            "selection_metric": _default_metric(req.evaluation),
            "metrics": req.metrics,
            "calibration_state": calibration_state,
            "threshold": threshold,
            "conformal": req.conformal,
            "fit_diagnostics": fit_diag,
            "warnings": req.warnings,
            "versions": _versions(),
            "artifact": artifact,
            "rebuild_recipe": {
                "request": req.evaluation.model_dump(exclude={"data"}),
                "selected_params": selected_params,
                "training_snapshot": _training_snapshot(req.evaluation, prepared),
                "dataset_fingerprint": prepared.schema["dataset_fingerprint"],
            },
            "model_card": {
                "intended_use": "Supervised tabular prediction for data matching the recorded feature schema.",
                "out_of_scope": "Causal inference, extrapolation beyond represented data, and autonomous safety decisions.",
                "performance_basis": "Nested outer-fold predictions; final estimator refit on all eligible rows.",
                "missing_data_policy": req.evaluation.missing_policy,
                "positive_class": prepared.schema.get("positive_class"),
                "decision_costs": req.evaluation.costs.model_dump() if req.evaluation.costs else None,
            },
        }
        return _safe(asset)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


_ALLOWED_ONNX_OPERATORS = {
    "Abs", "Add", "ArgMax", "ArrayFeatureExtractor", "Cast", "Clip", "Concat",
    "Div", "Exp", "Gather", "Gemm", "Identity", "Imputer", "LabelEncoder",
    "LinearClassifier", "LinearRegressor", "MatMul", "Mul", "Normalizer",
    "OneHotEncoder", "ReduceMean", "ReduceSum", "Relu", "Reshape", "Scaler",
    "Scan", "Sigmoid", "Softmax", "Split", "Sub", "SVMClassifier", "SVMRegressor",
    "TreeEnsembleClassifier", "TreeEnsembleRegressor", "Where", "ZipMap",
}


def _validated_onnx(artifact: dict[str, Any]) -> tuple[bytes, Any]:
    try:
        import onnx
        import onnxruntime as ort
    except ImportError as exc:
        raise ValueError(f"ONNX runtime dependencies are unavailable: {exc}") from exc
    encoded = artifact.get("bytes_base64")
    if not isinstance(encoded, str):
        raise ValueError("ONNX asset does not contain model bytes.")
    if len(encoded) > 45 * 1024 * 1024:
        raise ValueError("Encoded ONNX asset exceeds the project safety limit.")
    try:
        payload = base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise ValueError("ONNX model bytes are not valid base64.") from exc
    if len(payload) > 32 * 1024 * 1024:
        raise ValueError("ONNX asset exceeds the 32 MiB safety limit.")
    if hashlib.sha256(payload).hexdigest() != artifact.get("sha256"):
        raise ValueError("ONNX artifact checksum does not match its model card.")
    graph = onnx.load_model_from_string(payload)
    if len(graph.graph.node) > 100_000:
        raise ValueError("ONNX graph exceeds the node-count safety limit.")
    if any(getattr(item, "data_location", 0) != 0 for item in graph.graph.initializer):
        raise ValueError("ONNX external-data tensors are not accepted.")
    operators = {node.op_type for node in graph.graph.node}
    unknown = sorted(operators - _ALLOWED_ONNX_OPERATORS)
    if unknown:
        raise ValueError(f"ONNX graph contains unsupported operators: {unknown}.")
    options = ort.SessionOptions()
    options.intra_op_num_threads = min(2, os.cpu_count() or 1)
    options.inter_op_num_threads = 1
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    session = ort.InferenceSession(payload, sess_options=options,
                                   providers=["CPUExecutionProvider"])
    return payload, session


def _validate_asset_structure(asset: dict[str, Any]) -> None:
    if asset.get("schema_version") != 1:
        raise ValueError("Unsupported model-asset schema version.")
    if asset.get("task") not in {"regression", "classification"}:
        raise ValueError("Model asset has an invalid task.")
    schema = asset.get("schema")
    if not isinstance(schema, dict):
        raise ValueError("Model asset has no valid feature schema.")
    features = schema.get("features")
    numeric = schema.get("numeric_features")
    if (
        not isinstance(features, list) or not features
        or not all(isinstance(name, str) and name for name in features)
        or len(features) != len(set(features))
        or not isinstance(numeric, list)
        or not all(isinstance(name, str) for name in numeric)
        or not set(numeric).issubset(features)
    ):
        raise ValueError("Model asset has an invalid feature schema.")
    if not isinstance(asset.get("artifact"), dict):
        raise ValueError("Model asset has no valid executable-artifact record.")


def _validate_prediction_policy(asset: dict[str, Any], probability_columns: Optional[int]) -> None:
    task = asset.get("task")
    schema = asset.get("schema") or {}
    classes = schema.get("classes")
    if task == "classification":
        if not isinstance(classes, list) or len(classes) < 2:
            raise ValueError("Classification asset has an invalid class schema.")
        if probability_columns is not None and len(classes) != probability_columns:
            raise ValueError("Classification labels do not match the model probability output.")
        threshold = asset.get("threshold")
        if threshold is not None:
            try:
                value = float(threshold)
            except (TypeError, ValueError) as exc:
                raise ValueError("The stored decision threshold is invalid for this asset.") from exc
            if len(classes) != 2 or not math.isfinite(value) or not 0.0 <= value <= 1.0:
                raise ValueError("The stored decision threshold is invalid for this asset.")
        state = asset.get("calibration_state")
        if state:
            if not isinstance(state, dict):
                raise ValueError("The stored calibration policy is invalid.")
            method = state.get("method")
            if method == "sigmoid":
                try:
                    values = [float(state.get("coefficient")), float(state.get("intercept"))]
                except (TypeError, ValueError) as exc:
                    raise ValueError("The stored sigmoid calibration policy is invalid.") from exc
                if not all(math.isfinite(value) for value in values):
                    raise ValueError("The stored sigmoid calibration policy is invalid.")
            elif method == "isotonic":
                try:
                    x = np.asarray(state.get("x_thresholds"), dtype=float)
                    y = np.asarray(state.get("y_thresholds"), dtype=float)
                except (TypeError, ValueError) as exc:
                    raise ValueError("The stored isotonic calibration policy is invalid.") from exc
                if (
                    x.ndim != 1 or y.ndim != 1 or len(x) < 2 or len(x) != len(y)
                    or not np.all(np.isfinite(x)) or not np.all(np.isfinite(y))
                    or np.any(np.diff(x) < 0) or np.any(y < 0) or np.any(y > 1)
                ):
                    raise ValueError("The stored isotonic calibration policy is invalid.")
            elif method not in {None, "none"}:
                raise ValueError(f"Unknown calibration method '{method}'.")
    conformal = asset.get("conformal")
    if task == "regression" and conformal:
        if not isinstance(conformal, dict):
            raise ValueError("The stored regression prediction band is invalid.")
        if conformal.get("half_width") is None:
            return
        try:
            half_width = float(conformal["half_width"])
        except (TypeError, ValueError) as exc:
            raise ValueError("The stored regression prediction-band width is invalid.") from exc
        if not math.isfinite(half_width) or half_width < 0:
            raise ValueError("The stored regression prediction-band width is invalid.")


def _score_onnx(asset: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any]:
    _, session = _validated_onnx(asset["artifact"])
    schema = asset["schema"]
    features = schema["features"]
    numeric = set(schema["numeric_features"])
    feeds = {}
    for name in features:
        values = []
        for row_number, row in enumerate(rows, start=1):
            if name not in row:
                raise ValueError(f"Row {row_number} is missing feature '{name}'.")
            value = row[name]
            if name in numeric:
                if _is_missing(value):
                    values.append(np.nan)
                else:
                    try:
                        number = float(value)
                    except (TypeError, ValueError) as exc:
                        raise ValueError(f"Row {row_number}: '{name}' must be numeric.") from exc
                    if not math.isfinite(number):
                        raise ValueError(f"Row {row_number}: '{name}' must be finite or missing.")
                    values.append(number)
            else:
                values.append("" if _is_missing(value) else str(value))
        feeds[name] = (np.asarray(values, dtype=np.float32).reshape(-1, 1)
                       if name in numeric else np.asarray(values, dtype=str).reshape(-1, 1))
    outputs = session.run(None, feeds)
    artifact = asset["artifact"]
    predicted = np.asarray(outputs[int(artifact["label_output_index"])]).reshape(-1)
    probabilities = None
    probability_index = artifact.get("probability_output_index")
    if probability_index is not None:
        probabilities = _onnx_probability_transform(
            np.asarray(outputs[int(probability_index)], dtype=float),
            artifact.get("probability_transform") or "identity",
        )
        if (
            probabilities.ndim != 2
            or not np.all(np.isfinite(probabilities))
            or np.any(probabilities < -1e-8)
            or np.any(probabilities > 1.0 + 1e-8)
            or not np.allclose(probabilities.sum(axis=1), 1.0, atol=1e-5)
        ):
            raise ValueError("ONNX classifier returned invalid probability values.")
    threshold = asset.get("threshold")
    classes = schema.get("classes")
    _validate_prediction_policy(
        asset, probabilities.shape[1] if probabilities is not None else None,
    )
    if asset["task"] == "classification" and probabilities is not None:
        predicted = np.argmax(probabilities, axis=1)
    if probabilities is not None and len(classes or []) == 2:
        positive_label = schema.get("positive_class")
        positive = classes.index(positive_label) if positive_label in classes else 1
        calibrated = _apply_calibrator(probabilities[:, positive], asset.get("calibration_state"))
        probabilities[:, positive] = calibrated
        probabilities[:, 1 - positive] = 1.0 - calibrated
        if threshold is not None:
            encoded = _binary_predictions(calibrated, float(threshold), positive)
            predicted = np.asarray([classes[int(value)] for value in encoded], dtype=object)
    if asset["task"] == "classification" and classes and threshold is None:
        labels: list[str] = []
        for value in predicted:
            try:
                index = int(value)
            except (TypeError, ValueError):
                labels.append(str(value))
            else:
                labels.append(str(classes[index]) if 0 <= index < len(classes) else str(value))
        predicted = np.asarray(labels, dtype=object)
    result: dict[str, Any] = {
        "predictions": predicted.tolist(),
        "probabilities": (
            [{str(label): float(row[i]) for i, label in enumerate(classes)} for row in probabilities]
            if probabilities is not None and classes else None
        ),
    }
    conformal = asset.get("conformal")
    if asset["task"] == "regression" and conformal and conformal.get("half_width") is not None:
        values = predicted.astype(float)
        half = float(conformal["half_width"])
        result["intervals"] = [{"lower": float(v - half), "upper": float(v + half)} for v in values]
    return result


def _native_chaid_node(artifact: dict[str, Any], row: dict[str, Any]) -> dict[str, Any]:
    features = artifact["feature_names"]
    numeric = set(artifact["numeric_features"])
    output: list[Any] = []
    for name in features:
        if name not in row:
            raise ValueError(f"Scoring row is missing feature '{name}'.")
        value = row.get(name)
        missing = _is_missing(value)
        fill = artifact["fill_values"][name]
        resolved = fill if missing else value
        output.append(float(resolved) if name in numeric else str(resolved))
        indicator = f"{name}__missing"
        if indicator in artifact["output_features"]:
            output.append("missing" if missing else "observed")
    binned: list[str] = []
    for value, edges in zip(output, artifact["bin_edges"]):
        if edges is None:
            binned.append(str(value))
        else:
            binned.append(str(int(np.digitize(float(value), np.asarray(edges)[1:-1]))))
    node = artifact["tree"]
    positions = {name: i for i, name in enumerate(artifact["output_features"])}
    while "children" in node:
        feature = node["split_feature"]
        key = binned[positions[feature]]
        child = node["children"].get(key)
        if child is None:
            break
        node = child
    return node


def _native_chaid_row(artifact: dict[str, Any], row: dict[str, Any]) -> str:
    node = _native_chaid_node(artifact, row)
    prediction = str(node["prediction"])
    classes = artifact.get("classes") or []
    try:
        encoded = int(prediction)
    except ValueError:
        return prediction
    return str(classes[encoded]) if 0 <= encoded < len(classes) else prediction


def _score_native_chaid(asset: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any]:
    artifact = asset["artifact"]
    classes = artifact.get("classes") or asset.get("schema", {}).get("classes") or []
    nodes = [_native_chaid_node(artifact, row) for row in rows]
    probabilities = np.asarray([
        [float(node.get("class_probabilities", {}).get(str(index), 0.0))
         for index in range(len(classes))]
        for node in nodes
    ], dtype=float)
    _validate_prediction_policy(asset, probabilities.shape[1] if probabilities.ndim == 2 else None)
    if probabilities.size == 0 or np.any(~np.isfinite(probabilities)):
        raise ValueError("The native CHAID asset does not contain valid class distributions.")
    totals = probabilities.sum(axis=1, keepdims=True)
    if np.any(totals <= 0):
        raise ValueError("The native CHAID asset contains an empty prediction node.")
    probabilities = probabilities / totals
    encoded = np.argmax(probabilities, axis=1)
    if len(classes) == 2:
        positive_label = asset.get("schema", {}).get("positive_class")
        positive = classes.index(positive_label) if positive_label in classes else 1
        calibrated = _apply_calibrator(
            probabilities[:, positive], asset.get("calibration_state"),
        )
        probabilities[:, positive] = calibrated
        probabilities[:, 1 - positive] = 1.0 - calibrated
        threshold = asset.get("threshold")
        if threshold is not None:
            encoded = _binary_predictions(calibrated, float(threshold), positive)
        else:
            encoded = np.argmax(probabilities, axis=1)
    return {
        "predictions": [str(classes[int(value)]) for value in encoded],
        "probabilities": [
            {str(label): float(row[index]) for index, label in enumerate(classes)}
            for row in probabilities
        ],
    }


@router.post("/score")
def score(req: ScoreRequest):
    try:
        asset = req.asset
        _validate_asset_structure(asset)
        artifact = asset.get("artifact") or {}
        if artifact.get("kind") == "onnx" and artifact.get("available"):
            result = _score_onnx(asset, req.rows)
        elif artifact.get("kind") == "native_chaid" and artifact.get("available"):
            result = _score_native_chaid(asset, req.rows)
        else:
            raise ValueError(
                artifact.get("reason") or
                "This model has no executable safe artifact; rebuild it with ONNX support installed."
            )
        return _safe({
            **result, "asset_id": asset.get("asset_id"), "task": asset.get("task"),
            "model": asset.get("model"), "scored_rows": len(req.rows),
        })
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/export/onnx")
def export_onnx(req: ExportRequest):
    try:
        _validate_asset_structure(req.asset)
        artifact = req.asset.get("artifact") or {}
        if artifact.get("kind") != "onnx" or not artifact.get("available"):
            raise ValueError(artifact.get("reason") or "This model is not available as ONNX.")
        payload, _ = _validated_onnx(artifact)
        filename = f"perdura-{req.asset.get('model', 'model')}.onnx"
        return Response(
            payload, media_type="application/octet-stream",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
