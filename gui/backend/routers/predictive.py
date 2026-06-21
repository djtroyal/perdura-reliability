"""Predictive Analytics router -- sklearn decision-tree family + CHAID."""

import sys
import math
from pathlib import Path
from typing import List, Optional, Dict, Literal, Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import numpy as np
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor, export_text
from sklearn.ensemble import (
    RandomForestClassifier, RandomForestRegressor,
    GradientBoostingClassifier, GradientBoostingRegressor,
    AdaBoostClassifier, AdaBoostRegressor,
)
from sklearn.svm import SVC, SVR
from sklearn.neighbors import KNeighborsClassifier, KNeighborsRegressor
from sklearn.neural_network import MLPClassifier, MLPRegressor
from sklearn.model_selection import cross_val_score
from sklearn.metrics import (
    accuracy_score, precision_recall_fscore_support, confusion_matrix,
    roc_auc_score, r2_score, mean_squared_error, mean_absolute_error,
)
from sklearn.preprocessing import LabelEncoder

# Bootstrap the reliability src package path
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from reliability.CHAID import CHAIDTree

router = APIRouter()


# ---------------------------------------------------------------------------
# Inline Pydantic schemas
# ---------------------------------------------------------------------------

class FitRequest(BaseModel):
    model: Literal["decision_tree", "chaid", "random_forest", "gradient_boosting", "svm", "knn", "adaboost", "mlp"] = "decision_tree"
    task: Optional[Literal["classification", "regression"]] = None
    data: Dict[str, List[Any]]
    target: str
    features: List[str]
    test_size: float = 0.25
    params: Optional[Dict[str, Any]] = None


class CompareRequest(BaseModel):
    task: Optional[Literal["classification", "regression"]] = None
    data: Dict[str, List[Any]]
    target: str
    features: List[str]
    test_size: float = 0.25


# ---------------------------------------------------------------------------
# Sanitizer
# ---------------------------------------------------------------------------

def _safe(obj):
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if isinstance(obj, (np.floating,)):
        return _safe(float(obj))
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, np.ndarray):
        return [_safe(v) for v in obj.tolist()]
    if isinstance(obj, dict):
        return {k: _safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_safe(v) for v in obj]
    return obj


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _detect_task(y: np.ndarray) -> str:
    """Heuristic auto-detection: few distinct or non-numeric => classification."""
    try:
        yf = y.astype(float)
    except (ValueError, TypeError):
        return "classification"
    uniq = np.unique(yf)
    if uniq.size <= max(2, int(0.1 * len(yf))) and np.all(uniq == uniq.astype(int)):
        return "classification"
    return "regression"


def _build_matrix(data: Dict[str, List[Any]], features: List[str], target: str):
    n = len(data[target])
    for f in features + [target]:
        if f not in data:
            raise ValueError(f"Column '{f}' not in data.")
        if len(data[f]) != n:
            raise ValueError("All columns must have equal length.")
    # Drop rows with empty cells.
    keep = []
    for i in range(n):
        ok = all(str(data[c][i]).strip() != "" and data[c][i] is not None
                 for c in features + [target])
        if ok:
            keep.append(i)
    if len(keep) < 4:
        raise ValueError("Need at least 4 complete rows.")

    def col(name):
        return [data[name][i] for i in keep]

    # Encode features: try numeric, else label-encode.
    X_cols = []
    for f in features:
        raw = col(f)
        try:
            X_cols.append(np.asarray(raw, dtype=float))
        except (ValueError, TypeError):
            X_cols.append(LabelEncoder().fit_transform(np.asarray(raw, dtype=str)).astype(float))
    X = np.column_stack(X_cols) if X_cols else np.empty((len(keep), 0))
    y_raw = np.asarray(col(target))
    return X, y_raw


def _split(X, y, test_size, seed=42):
    n = len(y)
    rng = np.random.default_rng(seed)
    idx = rng.permutation(n)
    n_test = max(1, int(round(test_size * n)))
    test_idx, train_idx = idx[:n_test], idx[n_test:]
    return X[train_idx], X[test_idx], y[train_idx], y[test_idx]


def _make_model(model: str, task: str, params: Optional[dict]):
    p = params or {}
    if model == "decision_tree":
        cls = DecisionTreeClassifier if task == "classification" else DecisionTreeRegressor
        return cls(random_state=42, **p)
    if model == "random_forest":
        cls = RandomForestClassifier if task == "classification" else RandomForestRegressor
        return cls(random_state=42, n_estimators=p.pop("n_estimators", 100), **p)
    if model == "gradient_boosting":
        cls = GradientBoostingClassifier if task == "classification" else GradientBoostingRegressor
        return cls(random_state=42, **p)
    if model == "svm":
        if task == "classification":
            return SVC(random_state=42, probability=True, **p)
        return SVR(**p)
    if model == "knn":
        cls = KNeighborsClassifier if task == "classification" else KNeighborsRegressor
        return cls(**p)
    if model == "adaboost":
        cls = AdaBoostClassifier if task == "classification" else AdaBoostRegressor
        return cls(random_state=42, **p)
    if model == "mlp":
        cls = MLPClassifier if task == "classification" else MLPRegressor
        return cls(random_state=42, max_iter=1000, **p)
    raise ValueError(f"Unknown model: {model}")


def _classification_metrics(y_true, y_pred, model, X_test, classes):
    acc = accuracy_score(y_true, y_pred)
    pr, rc, f1, _ = precision_recall_fscore_support(
        y_true, y_pred, average="macro", zero_division=0)
    cm = confusion_matrix(y_true, y_pred, labels=classes)
    out = {
        "accuracy": float(acc),
        "precision": float(pr),
        "recall": float(rc),
        "f1": float(f1),
        "confusion_matrix": cm.tolist(),
        "classes": [str(c) for c in classes],
    }
    # Binary ROC AUC if probabilities available.
    if len(classes) == 2 and hasattr(model, "predict_proba"):
        try:
            proba = model.predict_proba(X_test)[:, 1]
            pos = classes[1]
            out["roc_auc"] = float(roc_auc_score((y_true == pos).astype(int), proba))
        except Exception:
            out["roc_auc"] = None
    return out


def _regression_metrics(y_true, y_pred):
    rmse = math.sqrt(mean_squared_error(y_true, y_pred))
    return {
        "r2": float(r2_score(y_true, y_pred)),
        "rmse": float(rmse),
        "mae": float(mean_absolute_error(y_true, y_pred)),
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/fit")
def fit(req: FitRequest):
    try:
        X, y_raw = _build_matrix(req.data, req.features, req.target)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    task = req.task or _detect_task(y_raw)

    try:
        # --- CHAID (custom classifier) ---
        if req.model == "chaid":
            if task != "classification":
                raise HTTPException(status_code=400,
                                    detail="CHAID supports classification only.")
            Xtr, Xte, ytr, yte = _split(X, y_raw.astype(str), req.test_size)
            tree = CHAIDTree(**(req.params or {}))
            tree.fit(Xtr, ytr, feature_names=req.features)
            yp = tree.predict(Xte)
            classes = np.array(tree.classes_)
            metrics = _classification_metrics(yte, yp, tree, Xte, classes)
            importances = tree.feature_importances_.tolist()
            preds = tree.predict(X)
            return _safe({
                "model": "chaid", "task": "classification",
                "metrics": metrics,
                "feature_importances": dict(zip(req.features, importances)),
                "tree": tree.to_dict(),
                "tree_text": None,
                "predictions": [str(p) for p in preds],
                "actual": [str(a) for a in y_raw],
                "n_train": len(ytr), "n_test": len(yte),
            })

        # --- sklearn models ---
        if task == "classification":
            le = LabelEncoder()
            y = le.fit_transform(y_raw.astype(str))
            classes = np.arange(len(le.classes_))
        else:
            y = y_raw.astype(float)

        model = _make_model(req.model, task, dict(req.params or {}))
        Xtr, Xte, ytr, yte = _split(X, y, req.test_size)
        model.fit(Xtr, ytr)
        yp = model.predict(Xte)

        if task == "classification":
            metrics = _classification_metrics(yte, yp, model, Xte, classes)
            metrics["classes"] = [str(c) for c in le.classes_]
            preds = le.inverse_transform(model.predict(X))
            actual = y_raw.astype(str).tolist()
        else:
            metrics = _regression_metrics(yte, yp)
            preds = model.predict(X)
            actual = y.tolist()

        importances = (model.feature_importances_.tolist()
                       if hasattr(model, "feature_importances_") else None)

        tree_text = None
        tree_struct = None
        if req.model == "decision_tree":
            tree_text = export_text(model, feature_names=list(req.features))
            tree_struct = _tree_to_dict(model, req.features,
                                        le.classes_ if task == "classification" else None)

        return _safe({
            "model": req.model, "task": task,
            "metrics": metrics,
            "feature_importances": (dict(zip(req.features, importances))
                                    if importances is not None else None),
            "tree": tree_struct,
            "tree_text": tree_text,
            "predictions": [str(p) for p in preds] if task == "classification"
                           else list(preds),
            "actual": actual,
            "n_train": len(ytr), "n_test": len(yte),
        })
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/compare")
def compare(req: CompareRequest):
    try:
        X, y_raw = _build_matrix(req.data, req.features, req.target)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    task = req.task or _detect_task(y_raw)
    if task == "classification":
        le = LabelEncoder()
        y = le.fit_transform(y_raw.astype(str))
        classes = np.arange(len(le.classes_))
        scoring = "accuracy"
    else:
        y = y_raw.astype(float)
        scoring = "r2"

    rows = []
    try:
        cv = min(5, max(2, len(y) // 3))
        for name in ("decision_tree", "random_forest", "gradient_boosting", "svm", "knn", "adaboost", "mlp"):
            model = _make_model(name, task, None)
            Xtr, Xte, ytr, yte = _split(X, y, req.test_size)
            model.fit(Xtr, ytr)
            yp = model.predict(Xte)
            try:
                cv_scores = cross_val_score(
                    _make_model(name, task, None), X, y, cv=cv, scoring=scoring)
                cv_mean = float(np.mean(cv_scores))
                cv_std = float(np.std(cv_scores))
            except Exception:
                cv_mean = cv_std = None

            row = {"model": name, "cv_mean": cv_mean, "cv_std": cv_std}
            if task == "classification":
                m = _classification_metrics(yte, yp, model, Xte, classes)
                row.update({"accuracy": m["accuracy"], "f1": m["f1"],
                            "precision": m["precision"], "recall": m["recall"],
                            "roc_auc": m.get("roc_auc")})
            else:
                m = _regression_metrics(yte, yp)
                row.update(m)
            rows.append(row)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return _safe({"task": task, "scoring": scoring, "comparison": rows})


class PredictRequest(BaseModel):
    model: Literal["decision_tree", "chaid", "random_forest", "gradient_boosting", "svm", "knn", "adaboost", "mlp"] = "decision_tree"
    task: Optional[Literal["classification", "regression"]] = None
    data: Dict[str, List[Any]]
    target: str
    features: List[str]
    params: Optional[Dict[str, Any]] = None
    input: Dict[str, Any] = {}


@router.post("/predict")
def predict(req: PredictRequest):
    """Re-fit the model on the full dataset and predict for a single new input."""
    try:
        X, y_raw = _build_matrix(req.data, req.features, req.target)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    task = req.task or _detect_task(y_raw)

    # Build input vector
    input_vals = []
    for f in req.features:
        v = req.input.get(f)
        if v is None or str(v).strip() == "":
            raise HTTPException(status_code=400, detail=f"Missing input for feature '{f}'.")
        try:
            input_vals.append(float(v))
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail=f"Feature '{f}' must be numeric for prediction.")

    X_new = np.array([input_vals])

    try:
        if req.model == "chaid":
            if task != "classification":
                raise HTTPException(status_code=400, detail="CHAID supports classification only.")
            tree = CHAIDTree(**(req.params or {}))
            tree.fit(X, y_raw.astype(str), feature_names=req.features)
            pred = tree.predict(X_new)[0]
            return _safe({"prediction": str(pred), "task": task})

        if task == "classification":
            le = LabelEncoder()
            y = le.fit_transform(y_raw.astype(str))
        else:
            y = y_raw.astype(float)

        model_obj = _make_model(req.model, task, dict(req.params or {}))
        model_obj.fit(X, y)

        if task == "classification":
            pred_encoded = model_obj.predict(X_new)[0]
            pred_label = le.inverse_transform([pred_encoded])[0]
            result: Dict[str, Any] = {"prediction": str(pred_label), "task": task}
            if hasattr(model_obj, "predict_proba"):
                proba = model_obj.predict_proba(X_new)[0]
                result["probabilities"] = {str(le.inverse_transform([i])[0]): float(p)
                                           for i, p in enumerate(proba)}
            return _safe(result)
        else:
            pred_val = float(model_obj.predict(X_new)[0])
            return _safe({"prediction": pred_val, "task": task})
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class PredictBatchRequest(BaseModel):
    model: Literal["decision_tree", "chaid", "random_forest", "gradient_boosting", "svm", "knn", "adaboost", "mlp"] = "decision_tree"
    task: Optional[Literal["classification", "regression"]] = None
    data: Dict[str, List[Any]]              # training data
    target: str
    features: List[str]
    params: Optional[Dict[str, Any]] = None
    inputs: List[Dict[str, Any]]           # new rows to score


@router.post("/predict_batch")
def predict_batch(req: PredictBatchRequest):
    """Re-fit the model on the training dataset and score many new rows at once."""
    try:
        X, y_raw = _build_matrix(req.data, req.features, req.target)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    task = req.task or _detect_task(y_raw)

    if not req.inputs:
        raise HTTPException(status_code=400, detail="No rows to score.")

    # Build the new feature matrix (rows × features), validating each cell.
    new_rows = []
    for r_i, row in enumerate(req.inputs):
        vec = []
        for f in req.features:
            v = row.get(f)
            if v is None or str(v).strip() == "":
                raise HTTPException(status_code=400,
                                    detail=f"Row {r_i + 1}: missing value for '{f}'.")
            try:
                vec.append(float(v))
            except (ValueError, TypeError):
                raise HTTPException(status_code=400,
                                    detail=f"Row {r_i + 1}: '{f}' must be numeric.")
        new_rows.append(vec)
    X_new = np.array(new_rows)

    try:
        if req.model == "chaid":
            if task != "classification":
                raise HTTPException(status_code=400, detail="CHAID supports classification only.")
            tree = CHAIDTree(**(req.params or {}))
            tree.fit(X, y_raw.astype(str), feature_names=req.features)
            preds = tree.predict(X_new)
            return _safe({"predictions": [str(p) for p in preds], "task": task})

        if task == "classification":
            le = LabelEncoder()
            y = le.fit_transform(y_raw.astype(str))
        else:
            y = y_raw.astype(float)

        model_obj = _make_model(req.model, task, dict(req.params or {}))
        model_obj.fit(X, y)

        if task == "classification":
            preds = le.inverse_transform(model_obj.predict(X_new))
            return _safe({"predictions": [str(p) for p in preds], "task": task})
        else:
            preds = model_obj.predict(X_new)
            return _safe({"predictions": [float(p) for p in preds], "task": task})
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _tree_to_dict(model, features, class_names=None):
    """Convert a fitted sklearn DecisionTree to a nested dict."""
    t = model.tree_

    def walk(node):
        if t.children_left[node] == t.children_right[node]:  # leaf
            val = t.value[node][0]
            if class_names is not None:
                pred = class_names[int(np.argmax(val))]
                return {"leaf": True, "prediction": str(pred), "n": int(t.n_node_samples[node])}
            return {"leaf": True, "value": float(val[0]), "n": int(t.n_node_samples[node])}
        fname = features[t.feature[node]]
        thr = float(t.threshold[node])
        return {
            "leaf": False,
            "feature": fname,
            "threshold": thr,
            "n": int(t.n_node_samples[node]),
            "left": walk(int(t.children_left[node])),
            "right": walk(int(t.children_right[node])),
        }

    return walk(0)
