# Conditional lifetime and inspection planning

The Lifetime Tools panel uses an adopted model in project exposure units or
explicit manual parameters. A source change makes retained output historical.
These are public probability models, with no proprietary estimator emulation.

## Conditional means, quantiles and tables

For a lifetime X surviving to age a, conditional survival over additional
exposure d is R(a+d)/R(a). The table evaluates that ratio and its failure
complement independently on at most 2,500 cells. Columns are additional
exposure, not absolute future age. CSV export uses the normal artifact
provenance/verification workflow.

Mean remaining life is integral from a to infinity of R(t)dt, divided by R(a).
For Weibull scale eta and shape beta, with z=(a/eta)^beta, it is
`eta/beta * exp(z) * Gamma(1/beta,z)`. The shared implementation uses a scaled
upper-gamma tail and asymptotic evaluation after regularized-gamma underflow.
Threshold shifts retain the remaining failure-free exposure. Exponential
remaining means are memoryless after the threshold. Other families use
conditional-survival integration; nonconvergence is reported and a divergent
loglogistic mean is explicitly infinite. The Burn-In tool uses this same core.

A remaining-life quantile solves R(a+d)/R(a)=target. It is labeled with its
reliability target and is distinct from mean remaining exposure and the
unconditional model mean. Models with material probability below zero trigger
a lifetime-interpretation note only for lifetime quantities.

## Mechanical equivalent rates

An Lp input denotes fraction p failed. Convert to characteristic life by
`eta=Lp/[-log(1-p)]^(1/beta)`. This does not by itself determine an MTBF.

Under age replacement, renew on failure or at attained operating age T:

- Mean operating cycle `C=integral_0^T R(t)dt`.
- Corrective-event intensity per operating exposure `F(T)/C`.
- Preventive-event intensity per operating exposure `R(T)/C`.
- Mean calendar cycle `C+F(T)*mean_CM_downtime+R(T)*mean_PM_downtime`.

The reciprocal corrective intensity is an equivalent long-run spacing between
corrective events, not instantaneous hazard, the minimal-repair rate H(T)/T,
or the unmaintained mean life. Calendar rates and availability are available
only for time-based exposure. For cycles/distance, downtime is rejected and
calendar outputs are withheld. All replacements restore new condition and
operating age pauses during downtime. Tiny F(T) uses expm1 and the truncated
mean uses a scaled small-hazard expansion when needed.

## Inspection counts and predictive uncertainty

Inputs are original population N, failures X observed by t1, future inspection
t2>t1, and fixed Weibull shape beta. Each shape row is a separate sensitivity
scenario. Its scale MLE is `t1/[-log(1-X/N)]^(1/beta)` for 0<X<N. The plug-in
expected additional count is `(N-X)*[1-(1-X/N)^k]`, where
`k=(t2/t1)^beta-1`. Zero/all failures have no finite interior scale estimate;
posterior prediction still applies under the declared prior.

Let p1=P(first failure by t1) have prior Beta(alpha0,beta0). After inspection,
`p1|X ~ Beta(X+alpha0,N-X+beta0)`. For each posterior p1,
`Y|p1,X ~ Binomial(N-X, 1-(1-p1)^k)`.

The predictive mixture includes future count variation and uncertainty in p1.
Its mean uses a beta-function moment with a stable digamma-integral fallback
for sparse large populations. The UI shows the selected prior plus Jeffreys
Beta(.5,.5) and Uniform Beta(1,1) sensitivity. It does not average shape rows
or imply that their spread is a probability interval for unknown shape.

Intervals are conservative equal-tailed **Bayesian posterior predictive**
intervals, not nominal frequentist confidence bounds. To integrate the CDF,
transform p1 through its inverse CDF using u uniform on [0,1]. The conditional
binomial CDF is monotone decreasing in u. Left and right rectangle sums bracket
the mixture CDF with width at most 1/cells. The lower count endpoint uses the
upper CDF bound; the upper endpoint uses the lower CDF bound. Thus numerical
discretization can widen, but cannot narrow, the targeted posterior interval.
This is a discretization bound; underlying SciPy floating-point evaluation is
not interval arithmetic. The default CDF width is at most .0005.

At beta=1 and t2=2*t1 the predictive mixture is exactly beta-binomial; tests
compare its means and interval posterior mass to this independent oracle.
Additional tests cover zero/all failures, large sparse cohorts, rate quadrature,
conditional-normal means, extreme tails and scale invariance. The real-handler
browser fixture verifies table/CSV, percentile conversion, prior sensitivity
and the Fleet Forecast handoff. The handoff replaces the fleet scenario with
the calibrated surviving cohort; existing fleet entry/retirement and repair
choices remain available. Fleet numerical solver bounds are not predictive
count intervals.

## Sources and fixtures

- [NIST Weibull definitions](https://www.itl.nist.gov/div898/handbook/apr/section1/apr162.htm).
- [NIST likelihood with censored and readout data](https://www.itl.nist.gov/div898/handbook/apr/section4/apr412.htm).
- [SciPy beta-binomial definition](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.betabinom.html).
- [Nordman and Meeker (2002)](https://doi.org/10.1198/004017002753398191) is comparison context for inspection prediction; the declared Bayesian method above does not claim to reproduce a particular procedure from that paper or the toolkit's small-event approximation.

The public toolkit sample `examples/toolkit-weibull-observations.csv` contains
exact failures and suspensions. Choose MLE, RRY or RRX explicitly; the plotting
position selector records the rank convention. Inspection intervals must use
the existing interval/mixed likelihood rather than entering midpoint failures.

Reference numerical examples: eta13,beta2,age6.5 gives mean remaining
7.093337689946 and median remaining6.125049446027. eta50000,beta1.3,T87600 gives
20.617528603753 corrective events per million operating hours. The inspection
example N20000,X8,t1=3,t2=10,beta3 gives plug-in mean286.170710652334; posterior
results additionally depend on the declared prior.

Predictive calibration is additionally checked by exact prior-predictive enumeration of all initial inspection counts in the beta-binomial benchmark. Nonlinear Weibull conditional probabilities are checked by independent integration over the posterior probability density. These are Bayesian model checks, not claims of fixed-parameter frequentist coverage.
