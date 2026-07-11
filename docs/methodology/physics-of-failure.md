# Physics-of-failure calculation contract

Physics-of-failure (PoF) laws are conditional engineering models, not universal lifetime distributions. Perdura therefore returns every PoF calculation with an `analysis` contract containing:

- the deterministic scalar outputs;
- the unit convention for inputs, coefficients and outputs;
- the mechanism and validity assumptions;
- domain/extrapolation warnings; and
- a separate optional uncertainty result.

Legacy scalar response keys remain for compatibility. Time-bearing laws also return a generic value and explicit `time_unit` or `life_unit`; an `*_hours` compatibility key is populated only when hours were selected.

## Input and regime validation

All fourteen endpoints reject non-finite inputs and physically invalid signs or domains. Examples include humidity above 100%, temperatures at or below absolute zero, negative cycle counts, non-positive fracture geometry/toughness, non-decreasing Basquin fits, non-negative Coffin-Manson exponents, a non-negative Larson-Miller stress coefficient, and inconsistent material strengths.

Exponentials are evaluated in the log domain and fail with a unit/calibration message before floating-point overflow or underflow can be returned as a plausible lifetime. Each model also states what the calculator cannot validate, such as mechanism continuity, coefficient calibration range or small-scale yielding without yield/geometry inputs.

## Input uncertainty

An optional request supplies a coefficient of variation for named scalar fields or list elements such as `cycles_to_failure[0]`, a draw count, confidence level and seed. Positive inputs use independent mean-preserving lognormal draws. Negative inputs use independent normal draws with standard deviation `abs(value) * CV`. Zero inputs cannot use relative uncertainty.

Each draw is revalidated against the complete physical domain. Invalid draws are counted and rejected; the calculation declines to report an interval if fewer than half (or fewer than 50) remain. Accepted outputs are summarized by mean, median, sample standard deviation and central quantiles. These intervals propagate only the selected input distributions and independence assumption; they do not include unmodeled mechanism or model-form uncertainty.

## Model sensitivity

### Cumulative fatigue damage

Miner damage remains

`D = sum(n_i / N_i)`.

It is order invariant. When an analyst supplies one positive damage exponent `q_i` per load block, Perdura also evaluates the explicit nonlinear sensitivity recursion

`D_i = (D_(i-1)^(1/q_i) + n_i/N_i)^q_i`, with `D_0 = 0`.

The entered and reversed block orders are both reported. With every `q_i = 1`, the recursion reduces exactly to Miner. The exponents are analyst-supplied sensitivity parameters—not fitted material constants or uncertainty bounds. NASA reviews nonlinear damage-curve and double-linear approaches while cautioning that complex histories still require experimental validation ([NASA report](https://ntrs.nasa.gov/archive/nasa/casi.ntrs.nasa.gov/19860018208.pdf)).

### Crack growth

For the same crack geometry and constant-amplitude loading, the tool can compare:

- Paris: `da/dN = C (Delta K)^m`;
- Walker: `da/dN = C [Delta K/(1-R)^(1-gamma)]^m`; and
- Forman: `da/dN = C (Delta K)^m / [(1-R)K_c - Delta K]`.

The cyclic critical crack length is computed from `K_max = Delta K/(1-R)` and integration stops immediately below instability. Geometric crack spacing improves numerical resolution of the life integral. Walker and Forman account for effects omitted by Paris, but each law's `C` and `m` have different dimensions/calibration and must come from compatible test data; constants are never copied automatically between models. NASA sources document the [Forman stress-ratio/toughness dependence](https://ntrs.nasa.gov/api/citations/19680018001/downloads/19680018001.pdf) and the [Walker modification used here](https://ntrs.nasa.gov/api/citations/20160012453/downloads/20160012453.pdf).

### Tensile mean stress

The same operating point is evaluated against modified Goodman, Soderberg and Gerber failure loci. A factor of safety scales both applied stresses until the selected locus is reached. For Gerber this solves

`(sigma_m/Su)^2 n^2 + (sigma_a/Se) n - 1 = 0`.

All three factors and curves are returned. Disagreement on pass/fail is flagged as model-form sensitivity and calls for material-specific fatigue evidence. The current comparison is restricted to non-negative tensile mean stress and uniaxial high-cycle-fatigue use; it does not claim a Walker, Morrow or SWT material fit.

## Interpretation

A deterministic life is a conditional characteristic calculation, not a population reliability or confidence bound. A propagated interval quantifies selected input uncertainty only. Differences among alternative laws are model sensitivity. These three quantities are deliberately shown in separate UI sections and response fields.
