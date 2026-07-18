"""
A simple CHAID (Chi-square Automatic Interaction Detection) decision tree.

CHAID grows a multiway tree by, at each node, choosing the predictor whose
split most significantly separates the target (smallest chi-square p-value),
splitting on the (binned) categories of that predictor. Continuous
predictors are discretised into quantile bins; the target is treated as
categorical (classification). For a usable feature-importance signal we
accumulate the chi-square test statistic attributed to each feature and
normalise it to sum to 1.

Only numpy and scipy are used. This is a compact reference implementation
intended for small data sets (the GUI's Predictive Analytics tool), not a
production CHAID.
"""

import numpy as np
from scipy.stats import chi2_contingency


class _Node:
    def __init__(self, depth):
        self.depth = depth
        self.feature = None         # split feature index or None (leaf)
        self.feature_name = None
        self.children = {}          # category value -> _Node
        self.prediction = None      # majority class at this node
        self.n = 0
        self.p_value = None
        self.class_counts = {}


class CHAIDTree:
    """A chi-square based multiway classification tree."""

    def __init__(self, max_depth=4, min_samples_split=10, alpha=0.05, n_bins=4):
        self.max_depth = max_depth
        self.min_samples_split = min_samples_split
        self.alpha = alpha
        self.n_bins = n_bins
        self.feature_names_ = None
        self.classes_ = None
        self.feature_importances_ = None
        self.root_ = None
        self._bin_edges = None

    # -- discretise continuous columns into quantile bins --
    def _binize(self, X, fit=False):
        X = np.asarray(X)
        n_features = X.shape[1]
        if fit:
            self._bin_edges = []
        out = np.empty(X.shape, dtype=object)
        for j in range(n_features):
            col = X[:, j]
            numeric = True
            try:
                colf = col.astype(float)
            except (ValueError, TypeError):
                numeric = False
            if numeric and len(np.unique(colf)) > self.n_bins:
                if fit:
                    qs = np.quantile(colf, np.linspace(0, 1, self.n_bins + 1))
                    qs = np.unique(qs)
                    self._bin_edges.append(qs)
                edges = self._bin_edges[j] if not fit else self._bin_edges[-1]
                out[:, j] = np.digitize(colf, edges[1:-1])
            else:
                if fit:
                    self._bin_edges.append(None)
                out[:, j] = col.astype(str)
        return out

    def fit(self, X, y, feature_names=None):
        X = np.asarray(X, dtype=object)
        y = np.asarray(y).astype(str)
        self.feature_names_ = list(feature_names) if feature_names is not None \
            else [f"x{i}" for i in range(X.shape[1])]
        self.classes_ = sorted(np.unique(y).tolist())
        Xb = self._binize(X, fit=True)
        self._importance = np.zeros(X.shape[1])
        self.root_ = self._grow(Xb, y, 0)
        total = self._importance.sum()
        self.feature_importances_ = (self._importance / total) if total > 0 \
            else np.ones(X.shape[1]) / X.shape[1]
        return self

    def _majority(self, y):
        vals, counts = np.unique(y, return_counts=True)
        return vals[np.argmax(counts)]

    def _grow(self, X, y, depth):
        node = _Node(depth)
        node.n = len(y)
        node.prediction = self._majority(y)
        node.class_counts = {
            str(cls): int(np.sum(y == cls)) for cls in self.classes_
        }
        if (depth >= self.max_depth or len(y) < self.min_samples_split
                or len(np.unique(y)) < 2):
            return node

        best_p, best_j, best_stat = 1.0, None, 0.0
        for j in range(X.shape[1]):
            col = X[:, j]
            if len(np.unique(col)) < 2:
                continue
            cats = np.unique(col)
            table = np.array([
                [np.sum((col == c) & (y == cls)) for cls in self.classes_]
                for c in cats
            ])
            if table.sum() == 0 or (table.sum(axis=0) == 0).any():
                continue
            try:
                stat, p, _, _ = chi2_contingency(table)
            except ValueError:
                continue
            if p < best_p:
                best_p, best_j, best_stat = p, j, stat

        if best_j is None or best_p > self.alpha:
            return node

        node.feature = best_j
        node.feature_name = self.feature_names_[best_j]
        node.p_value = float(best_p)
        self._importance[best_j] += best_stat
        col = X[:, best_j]
        for c in np.unique(col):
            mask = col == c
            node.children[str(c)] = self._grow(X[mask], y[mask], depth + 1)
        return node

    def _descend_one(self, xb):
        node = self.root_
        while node.feature is not None:
            key = str(xb[node.feature])
            if key in node.children:
                node = node.children[key]
            else:
                break
        return node

    def _predict_one(self, xb):
        return self._descend_one(xb).prediction

    def predict(self, X):
        X = np.asarray(X, dtype=object)
        Xb = self._binize(X, fit=False)
        return np.array([self._predict_one(Xb[i]) for i in range(Xb.shape[0])])

    def predict_proba(self, X):
        """Return empirical class proportions at each reached node.

        An unseen branch falls back to the distribution at the deepest known
        parent, matching :meth:`predict`.  The column order is ``classes_``.
        """
        X = np.asarray(X, dtype=object)
        Xb = self._binize(X, fit=False)
        rows = []
        for i in range(Xb.shape[0]):
            node = self._descend_one(Xb[i])
            total = max(1, sum(node.class_counts.values()))
            rows.append([
                node.class_counts.get(str(cls), 0) / total for cls in self.classes_
            ])
        return np.asarray(rows, dtype=float)

    def score(self, X, y):
        y = np.asarray(y).astype(str)
        return float(np.mean(self.predict(X) == y))

    def to_dict(self):
        """JSON-serialisable tree structure."""
        def walk(node):
            d = {
                "prediction": str(node.prediction),
                "n": int(node.n),
                "class_counts": dict(node.class_counts),
                "class_probabilities": {
                    cls: (count / node.n if node.n else 0.0)
                    for cls, count in node.class_counts.items()
                },
            }
            if node.feature is not None:
                d["split_feature"] = node.feature_name
                d["p_value"] = node.p_value
                d["children"] = {k: walk(v) for k, v in node.children.items()}
            return d
        return walk(self.root_)
