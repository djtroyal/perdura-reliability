# Regression and Machine Learning Methodology

## Purpose and scope

Perdura's Regression & ML workflow is a supervised tabular-modeling system for
regression and classification. Its primary output is an out-of-sample model
comparison, not a collection of in-sample fits. The workflow covers data
readiness, nested validation, hyperparameter selection, probability decisions,
diagnostics, interpretation, finalization, and scoring.

It is not a causal-inference engine, an unsupervised-learning workbench, or an
automatic substitute for engineering judgment. A strong validation score does
not establish that a predictor is causal or that future operating conditions
match the development data.

## Data contract and readiness audit

The user declares one target and one or more features. Classification labels
are encoded in sorted label order and the original labels are retained for all
display and scoring outputs. Regression targets must be finite numeric values.

Rows with missing targets are excluded. Predictor missingness is handled by one
of three explicit policies:

- complete-row deletion;
- fold-learned median/numeric and most-frequent/categorical imputation; or
- the same imputation plus missingness indicators.

Imputation, scaling, and one-hot encoding are fitted only on the current
training fold. They are never fitted once on the full dataset before
validation. Previously unseen categorical levels are ignored by the fitted
encoder rather than causing a scoring failure.

The readiness audit reports eligible rows, feature types, missingness,
duplicates, constant predictors, high-cardinality categories, ID-like
predictors, class counts, and likely leakage. A feature that reproduces the
target, or whose observed levels deterministically map to the target, is called
out for review. These checks are warnings because a deterministic mapping can
occasionally be legitimate; the user remains responsible for confirming that
every feature exists at the intended prediction time.

## Unified nested-validation contract

All candidate algorithms use the same outer validation splits. Hyperparameters
are selected only from inner splits of each outer training set. For outer fold
\(k\), the fitted prediction is therefore

\[
\hat y_i^{(-k)} = f_{\hat\theta_k,\,D_{-k}}(x_i),
\qquad i \in D_k,
\]

where \(\hat\theta_k\) is selected using only inner validation within
\(D_{-k}\). Leaderboard metrics are calculated from the combined outer-fold
predictions. No training predictions are substituted for failed or uncovered
outer observations.

Available structures are:

- shuffled random folds for regression;
- stratified shuffled folds for classification;
- grouped folds that keep an entity entirely in training or validation; and
- forward time splits in which every validation time follows every training
  time.

Grouped classification uses stratified grouped splitting where possible.
Every training fold must contain all target classes. A held-out group or time
window may contain only a subset of classes and is retained, avoiding silent
deletion of difficult validation units. A run is rejected when fewer than two
estimable folds remain.

Quick, Standard, and Thorough budgets control outer folds, inner folds, and the
maximum number of deterministic random-search candidates. Failed candidates
are reported per model. A candidate must succeed and converge in every inner
fold to be eligible for selection; partial-fold success is not allowed to make
it appear artificially strong.

## Model families

Regression supports ordinary linear regression, ridge, lasso, elastic net,
single-feature polynomial regression, decision trees, random forests, gradient
boosting, histogram gradient boosting, AdaBoost, support-vector regression,
k-nearest neighbors, and a multilayer perceptron.

Classification supports logistic regression, decision trees, random forests,
gradient boosting, histogram gradient boosting, AdaBoost, CHAID,
support-vector classification, k-nearest neighbors, and a multilayer
perceptron. Linear and logistic predictive pipelines can use categorical
features through fold-safe one-hot encoding. Classical coefficient inference
is reported separately only when its stricter numeric/no-imputation assumptions
are met.

CHAID discretizes numeric predictors within each training fold, selects
multiway splits with chi-square tests, and stores the empirical class
distribution at every node. Predictions for an unseen branch fall back to the
deepest known parent node, including that node's class probabilities.

## Metrics and uncertainty

Regression metrics are RMSE, MAE, median absolute error, and \(R^2\).
Classification metrics include accuracy, balanced accuracy, macro precision,
macro recall, macro F1, log loss, expected calibration error, and—where
defined—ROC AUC, average precision, Brier score, positive-class metrics, and
expected decision cost. Multiclass runs reject binary-only selection metrics
before fitting.

For a false-positive cost \(C_{FP}\) and false-negative cost \(C_{FN}\), the
reported mean decision cost is

\[
\widehat C = \frac{C_{FP}N_{FP}+C_{FN}N_{FN}}{n}.
\]

Each performance estimate receives a percentile interval from resampling the
paired outer-fold observations and predictions. Resampling follows the
validation structure:

- row bootstrap for random regression folds;
- within-class stratified bootstrap for classification;
- cluster bootstrap for grouped entities; and
- moving-block bootstrap after chronological ordering for time data.

These intervals quantify performance sampling variability conditional on the
modeled data-generating regime. They do not include uncertainty about future
dataset shift or feature availability.

## Probability calibration and decision thresholds

Binary classifiers may use no calibration, sigmoid calibration, or isotonic
calibration. Calibration is fitted from inner out-of-fold probabilities and is
then applied to the untouched outer fold. Isotonic calibration is blocked for
small samples because unconstrained step functions are unstable with sparse
class support.

The binary threshold is selected from inner predictions using the declared
selection metric. When costs are supplied, the same inner process minimizes
expected cost. The chosen policy is evaluated only on outer observations.
Multiclass threshold tuning and cost matrices are deliberately out of scope for
this version.

During finalization, calibration and threshold selection are recomputed from
full-development-data inner out-of-fold predictions. Perdura does not reuse a
calibrator from one outer fold or a median diagnostic threshold as the deployed
policy.

## Diagnostics and interpretation

Regression diagnostics include outer-fold observed-versus-predicted values,
held-out residuals, fold stability, and an approximate prediction band.
Classification diagnostics include confusion matrices, ROC and
precision-recall curves, reliability diagrams, fold stability, and the chosen
probability policy.

Raw-feature permutation importance is calculated separately on each held-out
outer fold and aggregated across folds. Partial-dependence and ICE curves are
calculated for the most important numeric features on the final full-data
point model. They explain model response, not causality. Strongly correlated
numeric predictors trigger a warning because permutation and partial-
dependence interpretations can be misleading in that regime.

For regression, the symmetric band uses the empirical quantile of absolute
outer-fold residuals:

\[
[\hat y(x)-q,\;\hat y(x)+q].
\]

Because the residuals come from ordinary cross-validation rather than a
dedicated split-conformal or cross-conformal construction, Perdura labels this
as an approximate empirical band and does not claim a finite-sample coverage
guarantee.

Classical coefficient tables are intentionally separate from the predictive
leaderboard. Their full-sample estimates and p-values answer a different
question than outer-fold prediction performance.

## Final model assets and safe scoring

Finalization refits the selected point estimator on all eligible development
rows and creates an immutable project asset containing:

- schema and dataset fingerprint;
- selected hyperparameters and validation recipe;
- outer-fold metrics and diagnostics metadata;
- final probability calibration and threshold policy;
- software versions and fit diagnostics;
- a rebuild recipe with the eligible training snapshot; and
- an executable artifact when safe conversion succeeds.

Supported scikit-learn pipelines are converted to ONNX. Perdura executes a
sample through both implementations and requires prediction parity. For
classifiers it independently validates probabilities; where an ONNX tree
converter emits a signed binary score, Perdura records a normalization only if
it numerically reproduces the source model. Labels are then derived from the
validated probabilities. Runtime scoring verifies the artifact checksum,
size, graph operators, tensor locality, output finiteness, probability bounds,
and row sums. A failed conversion is retained as a transparent rebuild recipe,
not accepted as an executable model.

CHAID uses a bounded native JSON tree with stored node distributions. Pickle
and joblib deserialization are not supported. Saved assets remain available
after a new comparison run and can be selected for single-row or batch scoring.

The downloadable model card omits executable bytes and training rows. A full
project snapshot can include them explicitly; the default inputs-only project
export removes validation runs and model assets.

## Current limitations

- Binary calibration, threshold tuning, and decision costs do not yet extend
  to multiclass cost matrices.
- The prediction band is approximate, symmetric, and constant-width.
- Partial dependence can traverse unrealistic feature combinations.
- ONNX conversion support depends on the estimator and preprocessing graph;
  an unsupported graph remains a rebuild-only asset.
- CPU execution is used for the current tabular workloads. GPU execution is
  not enabled because transfer and packaging overhead generally dominates at
  the dataset sizes supported by this interface.
- Unsupervised learning, survival ML, degradation/life joint models, and
  reliability-specific feature pipelines remain separate future work.
