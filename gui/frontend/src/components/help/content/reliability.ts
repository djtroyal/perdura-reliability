import type {
  HelpBlock,
  HelpCitationRef,
  HelpExampleBlock,
  HelpTopic,
} from '../types'
import { equation, example, list, note, p } from '../types'

const REVIEWED = '2026-07-17'

const cite = (id: string, locator?: string): HelpCitationRef => ({ id, locator })

interface TopicSpec {
  moduleId: string
  id: string
  title: string
  summary: string
  aliases?: string[]
  useWhen: string[]
  inputs: string[]
  outputs: string[]
  assumptions: string[]
  practice: string[]
  interpretation: string[]
  caution: string
  equations?: HelpBlock[]
  advanced?: string[]
  citations?: HelpCitationRef[]
  related?: string[]
  worked: HelpExampleBlock
}

const mathTopic = (spec: TopicSpec): HelpTopic => ({
  id: `${spec.moduleId}.${spec.id}`,
  moduleId: spec.moduleId,
  title: spec.title,
  summary: spec.summary,
  aliases: spec.aliases,
  keywords: [...(spec.aliases ?? []), spec.moduleId, 'worked example', 'equation'],
  basics: {
    purpose: spec.summary,
    useWhen: spec.useWhen,
    inputs: spec.inputs,
    outputs: spec.outputs,
    assumptions: spec.assumptions,
  },
  sections: [
    {
      id: 'practice', title: 'How to use it', depth: 'practice', defaultOpen: true,
      blocks: [list(spec.practice, undefined, true), spec.worked],
    },
    {
      id: 'interpretation', title: 'Equations and interpretation', depth: 'interpretation',
      blocks: [...(spec.equations ?? []), list(spec.interpretation)],
    },
    {
      id: 'advanced', title: 'Limits and deeper guidance', depth: 'advanced',
      blocks: [note('caution', spec.caution, 'Use with care'), ...(spec.advanced?.length ? [list(spec.advanced)] : [])],
    },
    ...(spec.citations?.length ? [{
      id: 'references', title: 'References', depth: 'references' as const,
      blocks: [p('The cited sources describe the method, its assumptions, or the implemented standard.', spec.citations)],
    }] : []),
  ],
  related: spec.related,
  reviewed: REVIEWED,
  exampleKind: 'worked',
})

interface WorkflowSpec extends Omit<TopicSpec, 'worked' | 'equations'> {
  walkthrough: HelpExampleBlock
  equations?: HelpBlock[]
}

const workflowTopic = (spec: WorkflowSpec): HelpTopic => ({
  ...mathTopic({ ...spec, worked: spec.walkthrough }),
  exampleKind: 'walkthrough',
})

const standardExample = (title: string, result: string): HelpExampleBlock => example(
  title,
  'A small system contains two line items: two units at 0.20 FPMH each and one unit at 0.60 FPMH.',
  ['Multiply each per-piece rate by quantity.', 'Add the line-item contributions.', 'Convert units only after the total is established.'],
  result,
  'A handbook prediction is a model-based planning estimate, not an observed field failure rate.',
)

// ---------------------------------------------------------------------------
// Life Data Analysis
// ---------------------------------------------------------------------------

const distributionSpecs = [
  {
    id: 'weibull-2p', title: 'Weibull (2-parameter)', aliases: ['Weibull_2P', '2P Weibull'],
    summary: 'Models positive life with a scale η and shape β; β controls whether hazard decreases, is constant, or increases.',
    latex: String.raw`R(t)=\exp\!\left[-\left(\frac{t}{\eta}\right)^{\beta}\right]`,
    inputs: ['Failure and suspension times greater than zero', 'Scale η > 0 and shape β > 0 when specifying a model'],
    assumptions: ['Life begins at t = 0.', 'One Weibull population and independent, non-informative censoring are adequate.'],
    interpretation: ['β < 1 indicates decreasing model hazard; β = 1 is exponential; β > 1 indicates increasing model hazard.', 'η is the time at which the fitted CDF reaches 1 − e⁻¹.'],
    scenario: 'Let η = 100 h, β = 2, and ask for reliability at 100 h.',
    result: 'R(100) = exp(−1) = 0.3679.',
  },
  {
    id: 'weibull-3p', title: 'Weibull (3-parameter)', aliases: ['Weibull_3P', 'threshold Weibull'],
    summary: 'Adds a fitted threshold γ to the Weibull model when failures cannot occur before a defensible onset time.',
    latex: String.raw`R(t)=\exp\!\left[-\left(\frac{t-\gamma}{\eta}\right)^{\beta}\right],\quad t>\gamma`,
    inputs: ['Failure and suspension times', 'Threshold γ, scale η, and shape β when specifying a model'],
    assumptions: ['R(t) = 1 for t ≤ γ.', 'The threshold is identifiable from the observed range.'],
    interpretation: ['η is measured from γ, not from zero.', 'A fitted γ near the first failure can be weakly identified and destabilize extrapolation.'],
    scenario: 'Let γ = 10 h, η = 90 h, β = 2, and evaluate at 100 h.',
    result: 'The shifted age is 90 h, so R(100) = exp(−1) = 0.3679.',
  },
  {
    id: 'exponential-1p', title: 'Exponential (1-parameter)', aliases: ['Exponential_1P', 'constant hazard'],
    summary: 'Models a constant failure rate λ and memoryless lifetime.',
    latex: String.raw`R(t)=e^{-\lambda t},\qquad \operatorname{MTTF}=\lambda^{-1}`,
    inputs: ['Failure and suspension times ≥ 0', 'Rate λ > 0 when specifying a model'],
    assumptions: ['The hazard is constant over the analyzed period.', 'Censoring is independent of failure time.'],
    interpretation: ['The model is the β = 1 Weibull special case.', 'Age does not change conditional failure risk under the memoryless assumption.'],
    scenario: 'Let λ = 0.01 h⁻¹ and evaluate reliability at 100 h.',
    result: 'R(100) = exp(−1) = 0.3679 and MTTF = 100 h.',
  },
  {
    id: 'exponential-2p', title: 'Exponential (2-parameter)', aliases: ['Exponential_2P', 'shifted exponential'],
    summary: 'Adds a threshold γ before a constant-rate exponential lifetime begins.',
    latex: String.raw`R(t)=e^{-\lambda(t-\gamma)},\quad t>\gamma`,
    inputs: ['Failure and suspension times', 'Rate λ and threshold γ when specifying a model'],
    assumptions: ['R(t) = 1 for t ≤ γ.', 'Hazard is constant after the threshold.'],
    interpretation: ['The threshold is an onset parameter, not an observed guaranteed-life claim.', 'Small samples can support unstable threshold estimates.'],
    scenario: 'Let γ = 10 h, λ = 1/90 h⁻¹, and evaluate at 100 h.',
    result: 'R(100) = exp[−(100−10)/90] = exp(−1) = 0.3679.',
  },
  {
    id: 'normal-2p', title: 'Normal', aliases: ['Normal_2P', 'Gaussian life'],
    summary: 'Models symmetric life values with location μ and standard deviation σ.',
    latex: String.raw`F(t)=\Phi\!\left(\frac{t-\mu}{\sigma}\right)`,
    inputs: ['Failure and suspension values on an untransformed scale', 'μ and σ > 0 when specifying a model'],
    assumptions: ['A symmetric, unbounded distribution is physically acceptable over the range of interest.', 'Observations are independent.'],
    interpretation: ['μ is both the mean and median.', 'Check whether appreciable fitted probability lies below a physical lower bound such as zero.'],
    scenario: 'Let μ = 100 h and σ = 20 h; evaluate failure probability at 100 h.',
    result: 'The standardized value is zero, so F(100) = 0.5.',
  },
  {
    id: 'lognormal-2p', title: 'Lognormal (2-parameter)', aliases: ['Lognormal_2P', 'log-normal'],
    summary: 'Models positive, right-skewed life when the logarithm of life is normal.',
    latex: String.raw`F(t)=\Phi\!\left(\frac{\ln t-\mu}{\sigma}\right),\quad t>0`,
    inputs: ['Strictly positive failure and suspension times', 'Log-location μ and log-scale σ > 0'],
    assumptions: ['ln(T) is adequately normal.', 'One multiplicative life-generating process is represented.'],
    interpretation: ['The median is exp(μ), not μ.', 'σ is dimensionless on the natural-log scale.'],
    scenario: 'Let μ = ln(100 h), σ = 0.3, and evaluate at 100 h.',
    result: 'The log-standardized value is zero, so F(100) = 0.5.',
  },
  {
    id: 'lognormal-3p', title: 'Lognormal (3-parameter)', aliases: ['Lognormal_3P', 'threshold lognormal'],
    summary: 'Adds threshold γ to a lognormal model for shifted positive life.',
    latex: String.raw`F(t)=\Phi\!\left(\frac{\ln(t-\gamma)-\mu}{\sigma}\right),\quad t>\gamma`,
    inputs: ['Failure and suspension times', 'Threshold γ, log-location μ, and log-scale σ'],
    assumptions: ['ln(T − γ) is normal.', 'The threshold is identifiable and physically meaningful.'],
    interpretation: ['The median is γ + exp(μ).', 'Threshold uncertainty can dominate lower-tail estimates.'],
    scenario: 'Let γ = 10 h, μ = ln(90 h), σ = 0.3, and evaluate at 100 h.',
    result: 'ln(100−10) equals μ, so F(100) = 0.5.',
  },
  {
    id: 'gamma-2p', title: 'Gamma (2-parameter)', aliases: ['Gamma_2P'],
    summary: 'Models positive, skewed life with shape α and scale β as defined in the results panel.',
    latex: String.raw`F(t)=P\!\left(\alpha,\frac{t}{\beta}\right)`,
    inputs: ['Strictly positive failure and suspension times', 'Shape α > 0 and scale β > 0'],
    assumptions: ['A gamma support and shape adequately represent life.', 'Parameter meanings follow Perdura’s displayed scale/shape convention.'],
    interpretation: ['The regularized incomplete gamma function supplies the CDF.', 'Do not interchange scale and rate parameterizations from another source.'],
    scenario: 'Let α = 1 and β = 10 h, then evaluate at t = 10 h.',
    result: 'With shape α = 1 the gamma reduces to an exponential with mean 10 h, so F(10) = 1 − e⁻¹ = 0.6321.',
  },
  {
    id: 'gamma-3p', title: 'Gamma (3-parameter)', aliases: ['Gamma_3P', 'threshold gamma'],
    summary: 'Adds threshold γ to the gamma lifetime model.',
    latex: String.raw`F(t)=P\!\left(\alpha,\frac{t-\gamma}{\beta}\right),\quad t>\gamma`,
    inputs: ['Failure and suspension times', 'Threshold γ, shape α, and scale β'],
    assumptions: ['T − γ follows the gamma model.', 'The data contain enough information to estimate γ.'],
    interpretation: ['All life summaries shift by γ.', 'A threshold variant is not available for inspection-interval fitting.'],
    scenario: 'Let γ = 5 h, α = 1, β = 10 h, and evaluate at 15 h.',
    result: 'The shifted time is 10 h; the exponential special case gives F(15) = 0.6321.',
  },
  {
    id: 'loglogistic-2p', title: 'Loglogistic (2-parameter)', aliases: ['Loglogistic_2P', 'log-logistic'],
    summary: 'Models positive, right-skewed life and permits a non-monotone hazard.',
    latex: String.raw`F(t)=\frac{1}{1+(t/\alpha)^{-\beta}}`,
    inputs: ['Strictly positive failure and suspension times', 'Scale α > 0 and shape β > 0'],
    assumptions: ['The loglogistic tail is plausible for the application.', 'Observations and censoring follow the stated sampling design.'],
    interpretation: ['α is the median life.', 'The heavier upper tail can strongly affect mean-life estimates.'],
    scenario: 'Let α = 100 h and β = 3; evaluate at 100 h.',
    result: 'At t = α, F(100) = 1/(1+1) = 0.5.',
  },
  {
    id: 'loglogistic-3p', title: 'Loglogistic (3-parameter)', aliases: ['Loglogistic_3P', 'threshold loglogistic'],
    summary: 'Adds threshold γ to a loglogistic lifetime model.',
    latex: String.raw`F(t)=\frac{1}{1+[(t-\gamma)/\alpha]^{-\beta}},\quad t>\gamma`,
    inputs: ['Failure and suspension times', 'Threshold γ, scale α, and shape β'],
    assumptions: ['T − γ follows the loglogistic model.', 'Threshold and tail behavior are supported by the data.'],
    interpretation: ['The median is γ + α.', 'Tail and threshold flexibility can be costly in small samples.'],
    scenario: 'Let γ = 10 h, α = 90 h, β = 3, and evaluate at 100 h.',
    result: 'The shifted time equals α, so F(100) = 0.5.',
  },
  {
    id: 'beta-2p', title: 'Beta', aliases: ['Beta_2P', 'unit-interval beta'],
    summary: 'Models a continuous quantity restricted to the unit interval with two shape parameters.',
    latex: String.raw`f(x)=\frac{x^{\alpha-1}(1-x)^{\beta-1}}{B(\alpha,\beta)},\quad 0<x<1`,
    inputs: ['Failure observations and censoring bounds within [0, 1]', 'Shapes α > 0 and β > 0'],
    assumptions: ['The analyzed quantity is intrinsically bounded by 0 and 1.', 'The beta shape is appropriate at both boundaries.'],
    interpretation: ['This is useful for normalized life or bounded fractions, not raw unbounded time.', 'α = β gives a symmetric distribution.'],
    scenario: 'Let α = β = 2 and evaluate at x = 0.5.',
    result: 'Symmetry about 0.5 gives F(0.5) = 0.5.',
  },
  {
    id: 'gumbel-2p', title: 'Gumbel', aliases: ['Gumbel_2P', 'smallest extreme value'],
    summary: 'Models smallest-extreme-value life with location μ and scale σ.',
    latex: String.raw`F(t)=1-\exp\!\left[-\exp\!\left(\frac{t-\mu}{\sigma}\right)\right]`,
    inputs: ['Failure and suspension values', 'Location μ and scale σ > 0'],
    assumptions: ['The minimum-extreme-value orientation matches the failure process.', 'The unbounded support is acceptable over the decision range.'],
    interpretation: ['Perdura uses the smallest-extreme-value orientation.', 'At t = μ, the CDF is 1 − e⁻¹ rather than 0.5.'],
    scenario: 'Let μ = 100 h and σ = 20 h; evaluate at t = μ.',
    result: 'F(100) = 1 − exp(−1) = 0.6321.',
  },
] as const

const distributionTopics: HelpTopic[] = distributionSpecs.map(d => mathTopic({
  moduleId: 'lifeData', id: d.id, title: d.title, summary: d.summary, aliases: [...d.aliases],
  useWhen: ['The support, shape, and hazard behavior match the failure mechanism and observed data.', 'Compare it with credible alternatives rather than selecting by habit.'],
  inputs: [...d.inputs], outputs: ['Fitted parameters and uncertainty', 'PDF, CDF, survival, hazard, quantiles, and fit diagnostics'],
  assumptions: [...d.assumptions],
  practice: ['Enter failures and suspensions using the correct observation format.', 'Fit the model, inspect eligibility and diagnostics, then interpret decision-relevant life or reliability.'],
  interpretation: [...d.interpretation],
  caution: 'Distribution choice is a model decision. A favorable ranking statistic does not establish the mechanism, tail behavior, or extrapolation validity.',
  equations: [equation(d.latex, { label: d.title, explanation: 'The displayed parameter convention is the convention used by Perdura.' })],
  advanced: ['Use profile or bootstrap scalar intervals only under the declared censoring design.', 'Three-parameter models need substantially more information than their two-parameter counterparts.'],
  citations: [cite('nist-apr-censoring')],
  related: ['lifeData.parametric', 'lifeData.fit-everything', 'lifeData.calibrated-intervals'],
  worked: example(`${d.title} calculation`, d.scenario, ['Substitute the parameters and evaluation point into the displayed CDF or survival equation.', 'Keep the parameter and time units consistent.'], d.result),
}))

const lifeModeTopics: HelpTopic[] = [
  mathTopic({
    moduleId: 'lifeData', id: 'parametric', title: 'Parametric life-data fitting',
    summary: 'Estimates a named lifetime distribution from exact, censored, frequency, or supported inspection-interval observations.',
    aliases: ['distribution fitting', 'MLE', 'rank regression'],
    useWhen: ['A distribution is defensible and you need extrapolated reliability, hazard, or life percentiles.'],
    inputs: ['Observed times or censoring intervals', 'Candidate distributions, fitting method, and confidence level'],
    outputs: ['Parameter estimates, fit ranking, eligibility, plots, and uncertainty'],
    assumptions: ['Independent sampling units', 'The selected likelihood matches the observation and censoring design'],
    practice: ['Start with plausible models and MLE.', 'Reject ineligible fits before using ranking statistics.', 'Set the chosen fit only after checking plots and mechanism plausibility.'],
    interpretation: ['AICc and BIC compare candidate models on the same data; lower is preferred.', 'A probability plot is a visual diagnostic, not a formal proof of fit.'],
    caution: 'Do not treat the best model in a candidate set as true, especially for small, censored, or tail-driven samples.',
    equations: [equation(String.raw`\ell(\theta)=\sum_{i\in F}\log f(t_i\mid\theta)+\sum_{i\in C}\log R(t_i\mid\theta)`, { label: 'Right-censored log-likelihood' })],
    advanced: ['Frequency counts weight these terms exactly; interval observations contribute log[F(u) − F(l)].'],
    citations: [cite('nist-apr-censoring')], related: distributionTopics.map(t => t.id),
    worked: example('One suspension in a likelihood', 'Two units fail at 10 h and 20 h; one is still operating at 25 h.', ['Add log-density terms for 10 and 20 h.', 'Add log-survival at 25 h.', 'Maximize the total over the model parameters.'], 'The suspension contributes information through R(25); it is not discarded or treated as a failure.'),
  }),
  mathTopic({
    moduleId: 'lifeData', id: 'kaplan-meier', title: 'Kaplan–Meier survival estimate',
    summary: 'Estimates the survival curve nonparametrically from exact failures and right censoring.', aliases: ['KM', 'product-limit'],
    useWhen: ['You need an empirical survival estimate without choosing a lifetime distribution.'],
    inputs: ['Exact failure times and right-censored times'], outputs: ['Stepwise survival estimate and confidence bounds'],
    assumptions: ['Censoring is independent of the failure process.', 'Units entering at a time are comparable to those already under observation.'],
    practice: ['Code failures and suspensions correctly.', 'Read the risk set immediately before each failure time.'],
    interpretation: ['The curve steps only at failures; censoring reduces later risk sets.', 'The tail after the last failure may be weakly supported.'],
    caution: 'Kaplan–Meier does not identify survival beyond the supported observation range and does not accept interval-censored rows.',
    equations: [equation(String.raw`\widehat R(t)=\prod_{t_j\le t}\left(1-\frac{d_j}{n_j}\right)`, { symbols: [{ symbol: 'd_j', meaning: 'failures at time j' }, { symbol: 'n_j', meaning: 'units at risk just before time j' }] })],
    citations: [cite('nist-apr-censoring')], related: ['lifeData.nonparametric', 'lifeData.nelson-aalen'],
    worked: example('First Kaplan–Meier step', 'At 10 h, 1 of 5 units fails and none was previously censored.', ['Use d = 1 and n = 5.', 'Multiply the prior survival of 1 by (1 − 1/5).'], 'The survival estimate immediately after 10 h is 0.8.'),
  }),
  mathTopic({
    moduleId: 'lifeData', id: 'nelson-aalen', title: 'Nelson–Aalen cumulative hazard',
    summary: 'Estimates cumulative hazard nonparametrically from exact failures and right censoring.', aliases: ['Nelson-Aalen', 'cumulative hazard'],
    useWhen: ['Cumulative hazard is the natural diagnostic or comparison scale.'],
    inputs: ['Exact failure times and right-censored times'], outputs: ['Stepwise cumulative hazard and derived survival'],
    assumptions: ['Independent units and non-informative right censoring'],
    practice: ['Build the same risk sets used for Kaplan–Meier.', 'Sum d/n at each event time.'],
    interpretation: ['A roughly linear cumulative hazard suggests a constant-rate region.', 'Derived survival exp(−H) is close to, but not identical to, Kaplan–Meier.'],
    caution: 'Shape seen in a sparse cumulative-hazard curve can be sampling noise; do not infer a mechanism from a few steps.',
    equations: [equation(String.raw`\widehat H(t)=\sum_{t_j\le t}\frac{d_j}{n_j},\qquad \widehat R(t)=e^{-\widehat H(t)}`)],
    citations: [cite('nist-apr-censoring')], related: ['lifeData.nonparametric', 'lifeData.kaplan-meier'],
    worked: example('First Nelson–Aalen step', 'At 10 h, 1 of 5 units fails.', ['Add d/n = 1/5 to cumulative hazard.', 'Optionally transform with exp(−H).'], 'H(10) = 0.2 and the transformed survival is exp(−0.2) = 0.8187.'),
  }),
  mathTopic({
    moduleId: 'lifeData', id: 'nonparametric', title: 'Non-parametric life analysis',
    summary: 'Uses Kaplan–Meier or Nelson–Aalen to describe observed survival without selecting a parametric lifetime distribution.',
    useWhen: ['You want empirical survival or hazard within the observed range.', 'A parametric tail assumption is not defensible.'],
    inputs: ['Exact failures and right-censored observations'], outputs: ['Empirical survival or cumulative hazard curves'],
    assumptions: ['Independent, non-informative censoring'],
    practice: ['Choose Kaplan–Meier for survival or Nelson–Aalen for cumulative hazard.', 'Keep claims inside the observed support.'],
    interpretation: ['Non-parametric means distribution-free, not assumption-free.', 'Precision still depends on risk-set size and event count.'],
    caution: 'This mode does not extrapolate an unobserved lifetime tail.', citations: [cite('nist-apr-censoring')],
    related: ['lifeData.kaplan-meier', 'lifeData.nelson-aalen', 'lifeData.turnbull'],
    worked: example('Choose an estimator', 'A censored field cohort needs an empirical one-year survival estimate.', ['Use Kaplan–Meier because survival is the decision quantity.', 'Inspect the risk set and confidence bounds at one year.'], 'Report the estimate with its interval and the number still at risk.'),
  }),
  mathTopic({
    moduleId: 'lifeData', id: 'turnbull', title: 'Turnbull interval-censored estimate',
    summary: 'Computes the non-parametric maximum-likelihood distribution for interval-, left-, and right-censored observations.', aliases: ['interval NPMLE'],
    useWhen: ['Failures are known only to have occurred between inspections.'],
    inputs: ['Observation intervals (lower, upper] and positive counts'], outputs: ['NPMLE mass allocation and CDF/SF context'],
    assumptions: ['The recorded intervals contain the true event times.', 'The inspection/censoring process is non-informative conditional on the design.'],
    practice: ['Leave lower blank for left censoring and upper blank for right censoring.', 'Use counts rather than duplicating identical rows.'],
    interpretation: ['Probability is allocated to support intervals, not invented midpoint times.', 'Non-unique mass allocations can produce the same likelihood.'],
    caution: 'Exact-time probability plots, histograms, and pointwise event diagnostics are not valid when event times are unobserved.',
    equations: [equation(String.raw`L(\mathbf p)=\prod_i\left(\sum_{j:\,I_j\subseteq (l_i,u_i]}p_j\right)^{w_i}`)],
    citations: [cite('turnbull-1976')], related: ['lifeData.observation-interval', 'lifeData.nonparametric'],
    worked: example('Inspection interval contribution', 'Three units fail between 10 h and 20 h.', ['Represent the row as (10, 20] with count 3.', 'Use the interval probability F(20) − F(10).'], 'The likelihood contribution is [F(20) − F(10)]³; no 15 h midpoint is assumed.'),
  }),
]

const observationTopics: HelpTopic[] = [
  workflowTopic({
    moduleId: 'lifeData', id: 'observation-individual', title: 'Individual observations',
    summary: 'Stores one exact failure or right-censored time per row.', useWhen: ['Each unit has its own recorded outcome.'],
    inputs: ['Time and F/S state for each unit'], outputs: ['An exact-time sample for fitting'], assumptions: ['Each row represents one sampling unit.'],
    practice: ['Use F only when failure time is observed.', 'Use S when a functioning unit leaves observation.'],
    interpretation: ['Suspensions contribute survival information through their censor time.'],
    caution: 'Do not code a suspension as a failure merely because testing stopped.', citations: [cite('nist-apr-censoring')],
    related: ['lifeData.parametric', 'lifeData.nonparametric'],
    walkthrough: example('Five-unit test', 'Three units fail and two survive the 100 h cutoff.', ['Enter three failure times as F.', 'Enter 100 h twice as S.'], 'All five units contribute to the likelihood.'),
  }),
  workflowTopic({
    moduleId: 'lifeData', id: 'observation-frequency', title: 'Frequency observations',
    summary: 'Represents repeated exact failures or suspensions with a positive integer count.', useWhen: ['Many units share an exact observed time and state.'],
    inputs: ['Exact time, F/S state, and integer count'], outputs: ['A weighted exact-time likelihood'], assumptions: ['A count is equivalent to repeated independent rows.'],
    practice: ['Aggregate only rows with the same time and state.', 'Use MLE for the weighted likelihood.'],
    interpretation: ['A count multiplies the corresponding log-density or log-survival term.'],
    caution: 'Frequency data are not inspection intervals; do not use a count at a midpoint to represent unknown event times.', citations: [cite('nist-apr-censoring')],
    related: ['lifeData.parametric'],
    walkthrough: example('Repeated suspensions', 'Ten units all survive to the 100 h cutoff.', ['Enter time 100, state S, count 10.'], 'The log-likelihood includes 10 log R(100), exactly as for ten separate rows.'),
  }),
  mathTopic({
    moduleId: 'lifeData', id: 'observation-interval', title: 'Inspection-interval observations',
    summary: 'Fits supported distributions when events are known only within inspection intervals.', useWhen: ['Units are checked periodically rather than monitored continuously.'],
    inputs: ['Lower bound, upper bound, and count for each observation group'], outputs: ['Interval-likelihood parameter estimates and Turnbull context'],
    assumptions: ['The event lies in (lower, upper].', 'Inspection timing is represented correctly.'],
    practice: ['Use blank lower for left censoring and blank upper for right censoring.', 'Use only distributions enabled for interval likelihood.'],
    interpretation: ['Finite intervals contribute F(u) − F(l).', 'Right-censored intervals contribute R(l).'],
    caution: 'Do not convert interval observations to midpoints; that changes both the likelihood and uncertainty.',
    equations: [equation(String.raw`\ell_i=w_i\log\{F(u_i)-F(l_i)\}`)], citations: [cite('turnbull-1976')],
    related: ['lifeData.turnbull', 'lifeData.parametric'],
    worked: example('Grouped inspection result', 'Four failures are discovered between 20 h and 30 h.', ['Set lower = 20, upper = 30, count = 4.', 'Evaluate the candidate-model interval probability.'], 'The likelihood contribution is 4 log[F(30) − F(20)].'),
  }),
]

const specialSpecs = [
  ['weibull-mixture', 'Weibull Mixture', 'Represents two latent Weibull subpopulations combined by a mixing proportion.', String.raw`F(t)=pF_1(t)+(1-p)F_2(t)`, 'With p = 0.25, F₁(100) = 0.8, and F₂(100) = 0.2, F(100) = 0.35.'],
  ['competing-risks', 'Competing Risks', 'Represents independent failure mechanisms whose first occurrence ends life.', String.raw`R(t)=R_1(t)R_2(t)`, 'If R₁(100) = 0.9 and R₂(100) = 0.8, system survival is 0.72.'],
  ['dszi', 'Defective Subpopulation Zero Inflated', 'Combines an immediate-failure mass, a susceptible Weibull population, and a non-failing fraction.', String.raw`F(t)=p_0+(1-p_0-p_\infty)F_W(t)`, 'If p₀ = 0.05, p∞ = 0.15, and F_W(100) = 0.5, F(100) = 0.45.'],
  ['defective-subpopulation', 'Defective Subpopulation', 'Allows a fraction of the population never to experience the modeled failure mode.', String.raw`F(t)=pF_W(t),\qquad F(\infty)=p<1`, 'If susceptible fraction p = 0.8 and F_W(100) = 0.5, population F(100) = 0.4.'],
  ['zero-inflated', 'Zero-Inflated Weibull', 'Adds a point mass for dead-on-arrival units to a Weibull life distribution.', String.raw`F(t)=p_0+(1-p_0)F_W(t)`, 'If p₀ = 0.10 and F_W(100) = 0.5, F(100) = 0.55.'],
] as const

const specialTopics = specialSpecs.map(([id, title, summary, latex, result]) => mathTopic({
  moduleId: 'lifeData', id, title, summary, useWhen: ['A single homogeneous lifetime distribution is contradicted by mechanism or population evidence.'],
  inputs: ['Failures, suspensions, and a defensible special-model structure'], outputs: ['Component parameters, population fractions, and combined curves'],
  assumptions: ['The stated latent-population or failure-mode interpretation is meaningful.', 'The additional parameters are identifiable from the data.'],
  practice: ['Fit a simpler credible baseline first.', 'Check component separation and parameter stability, not only AICc.'],
  interpretation: ['Population weights are probabilities and must remain in their valid simplex.', 'The combined curve, rather than either component alone, describes population life.'],
  caution: 'Flexible special models can mimic one another and overfit sparse or heavily censored samples; treat unstable components as diagnostic only.',
  equations: [equation(latex)], advanced: ['Use failure-mode labels and engineering evidence when available to support the latent structure.'],
  citations: [cite('nist-apr-censoring')], related: ['lifeData.special', 'lifeData.parametric'],
  worked: example(`${title} combination`, 'Evaluate the combined population at 100 h from supplied component probabilities.', ['Substitute the fractions and component probability into the displayed equation.'], result),
}))

const otherLifeTopics: HelpTopic[] = [
  mathTopic({
    moduleId: 'lifeData', id: 'special', title: 'Special lifetime models', summary: 'Fits mixtures, competing risks, defective-subpopulation, and zero-inflated Weibull structures.',
    useWhen: ['Engineering evidence indicates multiple populations, risks, or structural point masses.'], inputs: ['Failure/suspension data and selected structure'],
    outputs: ['Special-model parameters, fit criteria, and combined curves'], assumptions: ['The chosen special structure has a physical interpretation.'],
    practice: ['Use the model-specific topic before fitting.', 'Compare against a simple baseline and inspect identifiability.'],
    interpretation: ['More parameters can improve fit without improving prediction.'], caution: 'Do not label latent components as distinct mechanisms from statistics alone.',
    citations: [cite('nist-apr-censoring')], related: specialTopics.map(t => t.id),
    worked: example('Escalate from a baseline', 'A probability plot shows two persistent slopes and manufacturing records identify two lots.', ['Fit one Weibull first.', 'Fit a mixture and check whether components align with lot evidence.'], 'Use the mixture only if the richer interpretation and stability are defensible.'),
  }),
  mathTopic({
    moduleId: 'lifeData', id: 'weibayes', title: 'Weibayes fixed-shape analysis', aliases: ['zero-failure Weibull'],
    summary: 'Estimates Weibull scale while fixing, sensitivity-ranging, or propagating prior uncertainty in shape β.',
    useWhen: ['Failures are too few to estimate β, including a zero-failure test, and credible external shape information exists.'],
    inputs: ['Failure and suspension times', 'Fixed β, β range, or Bayesian β specification', 'Confidence level'],
    outputs: ['Scale η, survival curves, bounds, and β sensitivity or propagation'], assumptions: ['External β information applies to the same failure mode and population.'],
    practice: ['Document the source for β.', 'Use sensitivity or Bayesian propagation when β is not effectively known.'],
    interpretation: ['A fixed-β interval is conditional on β.', 'More accumulated exposure raises the lower life bound in zero-failure analysis.'],
    caution: 'Fixing β does not create information about failure-mode shape; an optimistic β can materially overstate life.',
    equations: [equation(String.raw`R(t)=\exp[-(t/\eta)^{\beta}]`)], citations: [cite('nist-apr-censoring')], related: ['lifeData.weibull-2p', 'alt.rdt-parametric'],
    worked: example('Zero-failure Weibayes setup', 'Ten units survive 100 h and β = 2 is justified from prior tests.', ['Enter ten suspensions at 100 h.', 'Fix β = 2 and select the confidence level.', 'Fit η and review the conditional lower bound.'], 'The analysis uses all 1,000 unit-hours of censored exposure; it does not fabricate a failure.'),
  }),
  mathTopic({
    moduleId: 'lifeData', id: 'cfm', title: 'Competing Failure Modes analysis', aliases: ['CFM'],
    summary: 'Fits each labeled failure mode while treating failures from other modes as suspensions, then combines mode survivals.',
    useWhen: ['Each failure has a known, mutually exclusive mode label and first failure ends observation.'],
    inputs: ['Failure/suspension times, mode IDs, and a distribution choice'], outputs: ['Per-mode fits and combined system survival'],
    assumptions: ['Mode-specific latent failure times are independent for the product calculation.', 'Mode labels are correct and modes are mutually exclusive at observed failure.'],
    practice: ['Use the ID column consistently.', 'Review each mode fit before interpreting the product.'],
    interpretation: ['Another mode’s failure right-censors the latent time for the current mode.', 'The combined hazard is the sum of independent mode hazards.'],
    caution: 'Dependent mechanisms or ambiguous root-cause classification invalidate the simple product interpretation.',
    equations: [equation(String.raw`R_{\mathrm{system}}(t)=\prod_m R_m(t),\qquad h_{\mathrm{system}}(t)=\sum_m h_m(t)`)],
    citations: [cite('meeker-escobar-1998', 'competing-risks models')], related: ['lifeData.competing-risks'],
    worked: example('Combine two mode fits', 'At 500 h, mode A survival is 0.95 and mode B survival is 0.90.', ['Multiply the independent latent-mode survivals.'], 'System survival is 0.95 × 0.90 = 0.855.'),
  }),
  mathTopic({
    moduleId: 'lifeData', id: 'stress-strength', title: 'Stress–Strength interference', aliases: ['S-S', 'probability of failure'],
    summary: 'Computes the probability that a random applied stress exceeds random strength.',
    useWhen: ['Stress and strength are represented by independent fitted or specified distributions.'],
    inputs: ['Stress distribution and parameters', 'Strength distribution and parameters'], outputs: ['Probability of interference and overlaid density curves'],
    assumptions: ['Stress and strength are independent unless dependence is modeled elsewhere.', 'Both distributions refer to the same units, population, and condition.'],
    practice: ['Import reviewed fits or specify parameters.', 'Check units and tails before integrating.'],
    interpretation: ['Failure probability is overlap weighted by the probability that stress exceeds strength.', 'Small tail changes can dominate a very low failure probability.'],
    caution: 'Ignoring correlation can be unconservative or conservative; independence must be justified.',
    equations: [equation(String.raw`P_f=P(S>X)=\int_{-\infty}^{\infty}f_S(s)F_X(s)\,ds`)],
    citations: [cite('nist-apr-censoring')], related: ['lifeData.distribution-spec'],
    worked: example('Normal stress and strength', 'Stress is Normal(80, 10²) MPa and strength is Normal(100, 10²) MPa, independently.', ['Form D = strength − stress.', 'D is Normal with mean 20 and standard deviation √200 = 14.142.', 'Compute P(D < 0).'], 'P(failure) = Φ(−20/14.142) ≈ 0.07865.'),
  }),
  mathTopic({
    moduleId: 'lifeData', id: 'monte-carlo', title: 'Monte Carlo and user-equation analysis', aliases: ['MC', 'user equation'],
    summary: 'Samples input distributions and propagates them through an arithmetic equation to create an output distribution.',
    useWhen: ['A derived quantity depends nonlinearly on several uncertain inputs.'],
    inputs: ['Named input distributions, parameters, equation, sample count, and seed'], outputs: ['Output sample, summary, and reusable fitted or empirical distribution'],
    assumptions: ['Inputs are independent unless the equation workflow explicitly represents dependence.', 'The sample count is adequate for the target tail probability.'],
    practice: ['Check the equation with deterministic values first.', 'Use a fixed seed for reproducible review.', 'Increase samples for stable tails.'],
    interpretation: ['Monte Carlo error decreases approximately with the square root of sample count.', 'The output distribution may not belong to the input families.'],
    caution: 'A large sample reduces simulation noise but does not correct wrong input models, missing dependence, or unit errors.',
    equations: [equation(String.raw`Y=g(X_1,\ldots,X_k),\qquad \widehat P(Y\le y)=\frac1N\sum_{i=1}^N\mathbf1(Y_i\le y)`)],
    related: ['lifeData.distribution-spec'],
    worked: example('Series tolerance stack', 'A and B are independent Normal variables with means 10 and 20 and standard deviations 1 and 2; Y = A + B.', ['Generate paired A and B draws.', 'Add each pair.', 'Compare simulation moments with the analytic check.'], 'Y should have mean 30 and standard deviation √5 ≈ 2.236; the simulation should approach these values.'),
  }),
  workflowTopic({
    moduleId: 'lifeData', id: 'compare-analyses', title: 'Compare analyses', aliases: ['compare folios'],
    summary: 'Overlays the distribution already selected in each analysis so reviewed models can be compared without changing them.',
    useWhen: ['Two or more analyses have a fitted or specified distribution selected.'], inputs: ['Reviewed analyses and a common curve type'],
    outputs: ['Superimposed curves with per-analysis toggles'], assumptions: ['Compared variables and units are commensurate.'],
    practice: ['Set the fit inside each source analysis first.', 'Use toggles to isolate crossings or tail differences.'],
    interpretation: ['The comparison inherits each source model; it is not a second fitting surface.'],
    caution: 'Overlaying curves with different units, populations, or conditions is visually possible but scientifically meaningless.',
    related: ['lifeData.parametric', 'lifeData.distribution-spec'],
    walkthrough: example('Compare two designs', 'Design A and B each have a reviewed Weibull fit.', ['Set the selected fit in each analysis.', 'Open Compare analyses and select both.', 'View survival curves on a common time scale.'], 'The overlay preserves both source fits and exposes reliability differences without refitting.'),
  }),
  mathTopic({
    moduleId: 'lifeData', id: 'distribution-spec', title: 'Distribution specification (model without data)', aliases: ['show model no data'],
    summary: 'Creates a reusable probability model directly from parameters without pretending that data were fitted.',
    useWhen: ['Parameters come from a requirement, supplier model, prior study, or design assumption.'],
    inputs: ['Distribution family and valid parameters'], outputs: ['PDF, CDF, survival, hazard, and a reusable project distribution'],
    assumptions: ['Parameter values and units have documented provenance.', 'No sampling uncertainty is implied unless supplied separately.'],
    practice: ['Choose Show model (no data).', 'Enter parameters in Perdura’s displayed convention.', 'Label the assumption and source.'],
    interpretation: ['Curves describe the specified model, not evidence of goodness of fit.', 'Downstream calculations inherit the exact chosen parameters.'],
    caution: 'Do not present a specified model as an estimated fit or attach data-derived confidence language to it.',
    equations: [equation(String.raw`F(t\mid\theta)\quad\text{with user-specified }\theta`)], related: distributionTopics.map(t => t.id),
    worked: example('Publish a supplier model', 'A supplier provides Weibull β = 2 and η = 5,000 h, but no raw data.', ['Select Weibull 2P and Show model (no data).', 'Enter η = 5,000 and β = 2.', 'Record the supplier document in the analysis name or notes.'], 'The resulting curves and imported distribution are explicitly parameter-specified, not fitted.'),
  }),
  mathTopic({
    moduleId: 'lifeData', id: 'calibrated-intervals', title: 'Calibrated scalar intervals', aliases: ['profile likelihood', 'parametric bootstrap'],
    summary: 'Builds an interval for one reliability value or life quantile using profile likelihood or parametric bootstrap.',
    useWhen: ['A single decision quantity needs an interval more targeted than a generic parameter interval.'],
    inputs: ['Selected fit, scalar target, confidence level, method, and declared censoring design'], outputs: ['Calibrated lower and upper endpoints plus diagnostic status'],
    assumptions: ['The fitted family and sampling/censoring design are adequate.', 'Bootstrap refits reproduce the planned design.'],
    practice: ['Choose reliability-at-time or a life quantile.', 'Declare the censoring design even if no unit happened to censor.', 'Review endpoint and refit diagnostics.'],
    interpretation: ['A scalar interval is not a simultaneous confidence band.', 'Profile likelihood re-optimizes nuisance parameters; bootstrap simulates and refits studies.'],
    caution: 'Low bootstrap counts, poor refit success, boundary estimates, or approximate censor-design reproduction make the interval partial or unverified.',
    equations: [equation(String.raw`2\{\ell(\widehat\theta)-\ell(\widehat\theta_q)\}\le \chi^2_{1,\,1-\alpha}`)],
    citations: [cite('meeker-escobar-1998', 'likelihood-based confidence intervals and simulation')], related: ['lifeData.parametric'],
    worked: example('B10 profile interval', 'A reviewed Weibull fit is used to bound B10 at 95% confidence.', ['Set target to life quantile 0.10.', 'Profile the likelihood while constraining B10.', 'Accept endpoints only when solver diagnostics pass.'], 'The reported interval applies to B10 alone; it is not a 95% band over the whole CDF.'),
  }),
  workflowTopic({
    moduleId: 'lifeData', id: 'fit-everything', title: 'Fit Everything and Compare Fits',
    summary: 'Fits the candidate distribution set, flags ineligible models, ranks eligible fits, and overlays selected curves with optional data context.',
    useWhen: ['Several physically plausible families need a consistent first-pass comparison.'], inputs: ['One dataset, fitting method, and confidence level'],
    outputs: ['Eligibility/status, AICc/BIC, fit table, and comparable curves'], assumptions: ['Every candidate is fitted to the same observations and censoring design.'],
    practice: ['Exclude ineligible distributions.', 'Use metrics, probability plots, and mechanism knowledge together.', 'Set the fit in the source analysis when satisfied.'],
    interpretation: ['Lower information criteria indicate relative support within the candidate set.', 'Dataset context is unconnected empirical context, not another fitted curve.'],
    caution: 'Automated ranking cannot validate support, mechanism, threshold plausibility, or tail extrapolation.', citations: [cite('nist-apr-censoring')],
    related: ['lifeData.parametric', 'lifeData.compare-analyses'],
    walkthrough: example('Shortlist a fit', 'A censored bearing dataset has Weibull and lognormal as plausible families.', ['Fit Everything.', 'Remove ineligible results.', 'Compare metrics and plots for the two plausible families.', 'Set the chosen distribution in the analysis.'], 'The selected row is the reviewed model; the comparison view does not change it.'),
  }),
]

// ---------------------------------------------------------------------------
// Reliability Testing / ALT
// ---------------------------------------------------------------------------

const stressFamilies = [
  { id: 'exponential', label: 'Exponential / Arrhenius stress relation', stress: 'temperature in kelvin', formula: String.raw`L(S)=a\exp(b/S)`, caveat: 'One thermally activated mechanism and a common life-distribution shape must hold across temperatures.' },
  { id: 'eyring', label: 'Eyring stress relation', stress: 'temperature in kelvin', formula: String.raw`L(S)=S^{-1}\exp[-(a-b/S)]`, caveat: 'The fitted Eyring terms are empirical unless their mechanism and units are independently justified.' },
  { id: 'power', label: 'Inverse-power stress relation', stress: 'a strictly positive non-temperature stress', formula: String.raw`L(S)=aS^n`, caveat: 'The same power-law mechanism must remain active between test and use stress.' },
] as const

const lifeFamilies = [
  { id: 'weibull', label: 'Weibull', detail: 'a common Weibull shape with stress-dependent characteristic life', result: 'At mission = projected η, reliability is e⁻¹ = 0.3679.' },
  { id: 'normal', label: 'Normal', detail: 'a common normal standard deviation with stress-dependent mean life', result: 'At mission = projected μ, failure probability is 0.5.' },
  { id: 'lognormal', label: 'Lognormal', detail: 'a common lognormal σ with stress-dependent median life', result: 'At mission = projected median, failure probability is 0.5.' },
  { id: 'exponential', label: 'Exponential', detail: 'a stress-dependent mean under a constant hazard at each stress', result: 'At mission = projected mean, reliability is e⁻¹ = 0.3679.' },
] as const

const lifeStressTopics: HelpTopic[] = stressFamilies.flatMap(stress => lifeFamilies.map(life => mathTopic({
  moduleId: 'alt', id: `life-stress-${life.id}-${stress.id}`, title: `${life.label} + ${stress.label}`,
  aliases: [`${life.label}_${stress.id === 'exponential' ? 'Exponential' : stress.id === 'eyring' ? 'Eyring' : 'Power'}`],
  summary: `Fits ${life.detail} using ${stress.label.toLowerCase()}.`,
  useWhen: [`Failure/suspension data are available at two or more constant levels of ${stress.stress}.`],
  inputs: ['Life and F/S state for each unit', 'Stress level for each unit', 'Optional use-level stress and confidence method'],
  outputs: ['Stress relation, common shape/dispersion, use-level life, eligibility diagnostics, and uncertainty'],
  assumptions: [stress.caveat, 'Units are independent and censoring is represented correctly.'],
  practice: ['Fit all supported combinations first.', 'Check transformed design rank, condition, tested range, physical direction, and common-shape diagnostic.', 'Use the model only if its mechanism and diagnostics are acceptable.'],
  interpretation: ['AICc/BIC compare combinations on the same data.', 'A use condition outside the tested stress range is extrapolation.', `This combination uses ${life.detail}.`],
  caution: 'Passing a common-shape diagnostic does not prove an unchanged failure mechanism. Extrapolation uncertainty is conditional on the selected model.',
  equations: [equation(stress.formula, { explanation: 'L(S) denotes the stress-dependent central life used by the selected lifetime family.' })],
  advanced: ['Delta intervals are local approximations; parametric bootstrap retains the stress and censoring design while refitting.'],
  citations: [cite('nist-alt-mle')], related: ['alt.life-stress-models'],
  worked: example(`${life.label} use-level interpretation`, 'The fitted stress relation projects central life of 1,000 h at the use condition.', ['Use the selected life family to evaluate a 1,000 h mission.'], life.result),
})))

const accelerationSpecs = [
  ['arrhenius', 'Arrhenius acceleration factor', String.raw`AF=\exp\!\left[\frac{E_a}{k}\left(\frac1{T_u}-\frac1{T_t}\right)\right]`, 'Temperature test/use in °C and activation energy Ea in eV', 'At Ea = 0.7 eV, 55 °C use and 125 °C test, AF is about 77.7.', 'One thermally activated mechanism and constant Ea apply.'],
  ['inverse-power', 'Inverse Power Law acceleration factor', String.raw`AF=(S_t/S_u)^n`, 'Positive test/use stress and exponent n', 'At test stress 2, use stress 1, and n = 2, AF = 4.', 'The power exponent and mechanism remain valid across stress.'],
  ['eyring', 'Eyring acceleration factor', String.raw`AF=\exp\!\left[A\left(\frac1{T_u}-\frac1{T_t}\right)\right]`, 'Temperature test/use in °C and fitted parameter A', 'With A = 1000 K, Tuse = 300 K, and Ttest = 350 K, AF = exp(0.4762) ≈ 1.61.', 'The implemented single-parameter Eyring relation is the intended empirical model.'],
  ['coffin-manson', 'Coffin–Manson acceleration factor', String.raw`AF=(\Delta T_t/\Delta T_u)^n`, 'Positive thermal-cycle ranges and fatigue exponent n', 'At ΔTtest = 100, ΔTuse = 50, and n = 2, AF = 4.', 'Cycle shape and fatigue mechanism are comparable between conditions.'],
  ['peck', 'Peck temperature–humidity acceleration', String.raw`AF=(RH_t/RH_u)^n\exp\!\left[\frac{E_a}{k}\left(\frac1{T_u}-\frac1{T_t}\right)\right]`, 'Temperatures, relative humidities, Ea, and humidity exponent n', 'If temperature is equal, RHtest/RHuse = 2, and n = 2, the humidity contribution to AF is 4.', 'No condensation or mechanism change occurs and RH uses the same percentage convention.'],
  ['norris-landzberg', 'Norris–Landzberg acceleration', String.raw`AF=(\Delta T_t/\Delta T_u)^n(f_u/f_t)^m\exp\!\left[\frac{E_a}{k}\left(\frac1{T_{\max,u}}-\frac1{T_{\max,t}}\right)\right]`, 'Cycle ranges, frequencies, maximum temperatures, exponents, and Ea', 'Holding frequency and temperature terms at 1, ΔTtest/ΔTuse = 2 and n = 2 gives AF = 4.', 'Solder-joint construction, cycle definition, and mechanism remain comparable.'],
  ['black', 'Black electromigration acceleration', String.raw`AF=(J_t/J_u)^n\exp\!\left[\frac{E_a}{k}\left(\frac1{T_u}-\frac1{T_t}\right)\right]`, 'Temperatures, current densities, exponent n, and Ea', 'Holding temperature equal, Jtest/Juse = 2 and n = 2 gives AF = 4.', 'The same electromigration mechanism and current-density convention apply.'],
] as const

const accelerationCitations = (id: string): HelpCitationRef[] => {
  if (id === 'coffin-manson') return [cite('nasa-nasalife', '§2.5, eqs. 24–27'), cite('nist-alt-mle')]
  if (id === 'norris-landzberg') return [cite('norris-landzberg-1969'), cite('nist-alt-mle')]
  if (id === 'peck') return [cite('peck-1986'), cite('nist-alt-mle')]
  if (id === 'black') return [cite('black-1969'), cite('nist-alt-mle')]
  return [cite('nist-alt-mle')]
}

const accelerationTopics = accelerationSpecs.map(([id, title, latex, inputs, result, assumption]) => mathTopic({
  moduleId: 'alt', id: `acceleration-${id}`, title, summary: `Converts exposure at accelerated conditions to equivalent use-condition life with the ${title}.`,
  useWhen: ['The model and its parameters are already justified for the failure mechanism.'], inputs: [inputs],
  outputs: ['Acceleration factor AF, where one test-time unit represents AF use-time units'], assumptions: [assumption, 'Temperatures are converted to kelvin inside exponential terms.'],
  practice: ['Enter test and use conditions in the labeled units.', 'Document parameter provenance.', 'Confirm AF direction: a harsher test normally gives AF > 1.'],
  interpretation: ['Use life equals AF × test life under the stated model.', 'AF uncertainty is not included unless the inputs are propagated elsewhere.'],
  caution: 'Acceleration factors can become enormous; numerical precision does not validate extrapolation or parameter choice.',
  equations: [equation(latex, { symbols: [{ symbol: 't', meaning: 'test condition' }, { symbol: 'u', meaning: 'use condition' }] })],
  citations: accelerationCitations(id), related: ['pof.arrhenius', 'pof.norris-landzberg'],
  worked: example(`${title} calculation`, inputs, ['Substitute values in the displayed AF equation.', 'Check the direction and unit convention.'], result),
}))

const altCitations = (id: string): HelpCitationRef[] => {
  if (id === 'step-stress' || id === 'multi-stress') return [cite('nist-alt-mle')]
  if (id.startsWith('degradation-')) return [cite('nist-degradation')]
  if (id === 'margin-test' || id === 'one-proportion') return [cite('nist-proportion-ci')]
  if (id === 'goodness-of-fit') return [cite('nist-ks')]
  return []
}

const altMath = (id: string, title: string, summary: string, useWhen: string, inputs: string[], outputs: string[], assumptions: string[], latex: string, scenario: string, steps: string[], result: string, caution: string, related: string[] = []): HelpTopic => mathTopic({
  moduleId: 'alt', id, title, summary, useWhen: [useWhen], inputs, outputs, assumptions,
  practice: ['Confirm the selected tool matches the sampling plan.', ...steps],
  interpretation: ['Read the reported claim together with its confidence, model, and allowed-failure assumptions.', 'Retain the input plan with the result for audit.'],
  caution, equations: [equation(latex)], citations: altCitations(id), related,
  worked: example(`${title} example`, scenario, steps, result),
})

const altTopics: HelpTopic[] = [
  workflowTopic({
    moduleId: 'alt', id: 'life-stress-models', title: 'Life–stress model comparison',
    summary: 'Fits and ranks all twelve combinations of Weibull, Normal, Lognormal, or Exponential life with Exponential/Arrhenius, Eyring, or Power stress relations.',
    useWhen: ['Failure data were collected at multiple constant stress levels.'], inputs: ['Life, F/S state, stress, use stress, criterion, and interval method'],
    outputs: ['Twelve candidate rows, eligibility diagnostics, fit curves, and use-level projection'], assumptions: ['Candidate models share the applicable failure mechanism.'],
    practice: ['Review all twelve named combination topics.', 'Select a result only after diagnostics and engineering review.'],
    interpretation: ['The selected row controls the displayed use projection.'], caution: 'AICc ranking alone is not a mechanism-selection rule.',
    citations: [cite('nist-alt-mle')], related: lifeStressTopics.map(t => t.id),
    walkthrough: example('Review a model table', 'Four stress levels contain failures and suspensions.', ['Fit all models.', 'Remove ineligible rows.', 'Compare diagnostics and physically plausible direction.', 'Inspect the chosen life–stress plot.'], 'Retain the selected model and its extrapolation diagnostics together.'),
  }),
  ...lifeStressTopics,
  ...accelerationTopics,
  altMath('step-stress', 'Step / Sequential Stress', 'Converts stepped exposures on the same units to equivalent reference-stress time before fitting life.', 'Stress rises in recorded steps on each tested unit.', ['Step stress/duration profile, failures, reference stress, model parameters'], ['Equivalent times and fitted life distribution'], ['Cumulative exposure applies and damage carries across steps.'], String.raw`t_{eq}=\sum_j AF_j\,\Delta t_j`, 'A unit spends 10 h at AF = 2 and then 5 h at AF = 4 before failure.', ['Multiply each duration by its AF and sum.'], 'Equivalent reference exposure is 10×2 + 5×4 = 40 h.', 'Unrecorded ramps, recovery, or a mechanism transition invalidate simple cumulative exposure.'),
  altMath('multi-stress', 'Multi-Stress analysis', 'Fits a log-linear life relation with two simultaneous stress variables.', 'At least three non-collinear combinations of two stresses were tested.', ['Life/F-S data and two stress columns', 'Use values for both stresses'], ['Two stress coefficients, life distribution, and use projection'], ['The scaled design has adequate rank and a common dispersion is defensible.'], String.raw`\log L=a+b_1S_1+b_2S_2`, 'A fitted model has a = 5, b₁S₁ = 1, and b₂S₂ = −0.5 at use.', ['Add terms to get log life.', 'Exponentiate.'], 'Luse = exp(5.5) ≈ 244.7 time units.', 'Correlated stress settings can make separate effects unidentifiable; a use point outside the tested convex hull is extrapolation.'),
  altMath('margin-test', 'Accelerated Margin Test', 'Converts accelerated duration to equivalent specification exposure and reports binomial reliability with a one-sided lower bound.', 'Units are tested at a justified accelerated condition and observed failures are counted.', ['Units, failures, accelerated duration, AF, stresses, and confidence'], ['Equivalent use exposure, observed reliability, lower bound, and optional exponential MTBF estimate'], ['AF applies to the demonstrated failure mode and every unit follows the stated test plan.'], String.raw`t_{use,eq}=AF\,t_{test}`, 'Ten units complete 100 h at AF = 5 with zero failures and 90% confidence.', ['Convert each unit’s duration.', 'For zero failures, compute the Clopper–Pearson lower bound (1−C)^(1/n).'], 'Each unit represents 500 h at use and the one-sided reliability lower bound is 0.1^(1/10) ≈ 0.7943.', 'An unjustified AF invalidates the exposure conversion; observed failures must never be omitted.'),
  workflowTopic({
    moduleId: 'alt', id: 'halt', title: 'HALT', aliases: ['Highly Accelerated Life Test'],
    summary: 'Records step-search passes, anomalies, and failures to identify operating and destruct limits for design learning.',
    useWhen: ['Development hardware is intentionally stressed to expose weak margins.'], inputs: ['Stress type, levels, and outcome at each step'], outputs: ['Operating limit, destruct limit, and margin relative to specification'],
    assumptions: ['Observed limits are specific to the tested configuration and procedure.'], practice: ['Record anomalies separately from destructive failures.', 'Correct weaknesses and repeat as the design changes.'],
    interpretation: ['HALT is a discovery exercise, not a life distribution or production acceptance test.'],
    caution: 'Do not convert HALT limits into quantitative field-life or reliability claims.', related: ['alt.hass', 'alt.ess'],
    walkthrough: example('Thermal step search', 'A unit operates through 90 °C, anomalies at 100 °C, and is damaged at 120 °C.', ['Record the last fully operating step, anomaly onset, and destruct event.', 'Compare margins with the rated limit.'], 'The result is a robustness margin and test observation, not an acceleration factor.'),
  }),
  altMath('rdt-parametric', 'Parametric Binomial RDT', 'Trades sample size and test duration using a known Weibull shape and optional acceleration factor.', 'A reliability target must be demonstrated and β is defensible from prior evidence.', ['Target R and confidence', 'Mission/test time, β, AF, and allowed failures'], ['Required sample size or duration'], ['Each unit follows the specified Weibull shape for the target mode.'], String.raw`R(t_{test})=R(t_{mission})^{(AF\,t_{test}/t_{mission})^{\beta}}`, 'For AF = 1 and test time equal to mission time, target mission reliability is 0.90.', ['Set the duration ratio to one.'], 'The per-unit test survival used by the binomial plan is also 0.90.', 'An incorrect β silently changes the duration credit; document its source.'),
  altMath('rdt-nonparametric', 'Non-Parametric Binomial RDT', 'Uses binomial success/failure evidence without a life-distribution duration credit.', 'Every unit can complete the full mission and no distribution is justified.', ['Target reliability, confidence, and allowed failures'], ['Required sample size or demonstrated reliability/confidence'], ['Independent Bernoulli outcomes at the mission time.'], String.raw`P(X\le f\mid n,R)=\sum_{i=0}^{f}{n\choose i}(1-R)^iR^{n-i}`, 'For zero failures, R = 0.90 and 90% confidence.', ['Solve Rⁿ ≤ 1 − 0.90 for n.', 'Round up.'], 'n ≥ ln(0.10)/ln(0.90) = 21.85, so 22 successful units are required.', 'No partial-duration credit is available; each success must reach the mission exposure.'),
  altMath('rdt-chisquared', 'Exponential Chi-Squared RDT', 'Links accumulated test time, allowed failures, confidence, and an exponential MTTF claim.', 'A constant failure rate is defensible during the demonstration window.', ['Total test time, failures, confidence, and target MTTF'], ['Required exposure or demonstrated MTTF/confidence'], ['Independent exponential lifetimes and correctly counted failures/exposure.'], String.raw`\theta_L=\frac{2T}{\chi^2_{2(r+1),\,C}}`, 'A test accumulates T = 10,000 unit-hours with zero failures; evaluate the one-sided lower MTTF at the selected confidence.', ['Use r = 0 in the displayed chi-square relation.', 'Use the application’s reported quantile convention.'], 'The result is a lower confidence claim on exponential MTTF, not a wear-out life.', 'Do not use the exponential model through an increasing-hazard wear-out region.'),
  altMath('rdt-bayesian', 'Non-Parametric Bayesian RDT', 'Updates a Beta prior for mission-time reliability with binomial test outcomes.', 'A transparent prior from expert judgment or relevant subsystem evidence is accepted.', ['Beta prior parameters or elicited evidence', 'Test successes and failures'], ['Beta posterior and reliability summaries'], ['Mission outcomes are Bernoulli and prior evidence is exchangeable with the test population.'], String.raw`R\mid data\sim\operatorname{Beta}(\alpha_0+s,\,\beta_0+f)`, 'Start with Beta(2,2), then observe 8 successes and 2 failures.', ['Add successes to α and failures to β.'], 'The posterior is Beta(10,4), with posterior mean 10/14 ≈ 0.714.', 'A strong optimistic prior can dominate a small test; disclose and sensitivity-check it.'),
  altMath('expected-failure-times', 'Expected Failure Times', 'Estimates median ordered failure times and their order-statistic probability bounds under a selected distribution.', 'Inspection timing or expected test progress must be planned.', ['Distribution, parameters, sample size, and confidence'], ['Median ordered failure times and probability-derived bounds'], ['The planning distribution describes the tested population.'], String.raw`p_i=\operatorname{median}\{\operatorname{Beta}(i,n-i+1)\},\qquad t_i=F^{-1}(p_i)`, 'Plan n = 10 units and the first ordered failure.', ['Compute the median of Beta(1,10).', 'Evaluate the selected inverse CDF at that probability.'], 'The first median-rank probability is 1−0.5^(1/10) ≈ 0.0670; its time depends on the chosen distribution.', 'These are planning order-statistic summaries, not guaranteed event dates.'),
  altMath('difference-detection', 'Difference Detection Matrix', 'Estimates test duration needed to distinguish two life designs for a selected metric.', 'A comparison test needs a power-aware duration screen.', ['Two distributions/design parameters, sample sizes, metric, confidence/power settings'], ['Duration matrix and cell details'], ['Simulation/approximation settings and candidate distributions represent the proposed test.'], String.raw`\Delta=\left|m_A-m_B\right|`, 'Design A has B10 = 900 h and B has B10 = 1,000 h.', ['Compute the target separation.', 'Use the matrix to find duration for the selected sample sizes.'], 'The life-metric difference to detect is 100 h; required duration is read from the computed cell.', 'A finite matrix result remains conditional on the assumed distributions and effect size.'),
  altMath('test-simulation', 'Reliability Test Simulation', 'Monte Carlo simulates outcomes under an assumed true distribution and censoring plan.', 'A candidate plan should be evaluated before hardware is committed.', ['Truth model, parameters, units, duration, repetitions, and seed'], ['Failure-count/outcome distribution and pass probability'], ['The simulated truth and operational rules represent the future test.'], String.raw`\widehat P(\mathrm{pass})=N_{pass}/N_{sim}`, 'Out of 10,000 simulated tests, 8,120 pass.', ['Divide passes by simulations.'], 'Estimated pass probability is 0.812; Monte Carlo standard error is about √[0.812×0.188/10000] = 0.0039.', 'Simulation precision does not address model misspecification.'),
  altMath('exponential-planner', 'Exponential Test Planner', 'Solves one of MTBF lower bound, total accumulated test time, or maximum allowable failures from the other two at a fixed input confidence.', 'A constant failure rate is defensible and exactly one of the three planning quantities is unknown.', ['Two of MTBF lower bound, total test duration, and allowable failures', 'Confidence level as a fixed input'], ['All three planning quantities, with the selected one solved'], ['Independent exponential lifetimes make unit exposures additive.'], String.raw`\theta_L=\frac{2T}{\chi^2_{2(f+1),\,C}}`, 'Five units each run 2,000 h, so their total test time is 10,000 unit-hours before any failure adjustment.', ['Enter total accumulated exposure—not unit count or calendar duration—as T.', 'Provide either the MTBF bound or allowable failures and solve for the remaining quantity.'], 'The result reports the one-sided exponential MTBF planning relation at the entered confidence.', 'The screen does not solve unit count, calendar duration, or confidence. Parallel exposure can shorten the calendar test but does not change total accumulated time; common-cause interruptions require separate treatment.'),
  altMath('test-duration', 'Fixed-Length Exponential Test Duration', 'Finds the smallest allowable-failure plan whose duration satisfies both consumer and producer risks.', 'A fixed-length exponential comparison is planned between required and design MTBF values.', ['Required MTBF, larger design MTBF, consumer risk, and producer risk'], ['Total test duration and allowable failures'], ['Counts are Poisson under constant failure rates and the stopping rule is fixed in advance.'], String.raw`T=\frac{\chi^2_{2(f+1),\,1-\beta_c}}{2}\,\theta_{required}`, 'Required MTBF is 1,000 h, design MTBF is 25,000 h, and both risks are 0.10.', ['Try f = 0, giving T = −ln(0.10)×1,000.', 'Verify producer rejection probability 1−exp(−T/25,000) is at most 0.10.'], 'T ≈ 2,302.6 h and f = 0 satisfy the example risks; the application searches f in increasing order.', 'The result is valid only for the fixed-length exponential/Poisson acceptance plan.'),
  altMath('zero-failure-sample-size', 'Zero-Failure Sample Size', 'Computes the sample needed for a no-failure claim, including optional Weibull credit for multiple mission lifetimes.', 'No failures are permitted and β plus duration credit are defensible.', ['Target reliability, confidence, mission-lifetime multiple L, and Weibull shape β'], ['Integer sample size'], ['Independent units complete L mission lifetimes under the stated Weibull model.'], String.raw`n=\left\lceil\frac{\log(1-C)}{L^{\beta}\log R}\right\rceil`, 'Demonstrate R = 0.99 at C = 0.90 with L = 1 and β = 1.', ['Substitute R, C, L, and β.', 'Round up.'], 'n = ceil[ln(0.1)/ln(0.99)] = 230.', 'Duration credit depends entirely on β; with no defensible shape, use one full mission and β = 1 only when the exponential assumption is justified.'),
  altMath('sprt', 'Sequential Sampling (SPRT)', 'Builds Wald binomial acceptance and rejection boundaries for a sequential attribute-sampling plan.', 'A sequential attribute plan must be agreed before testing begins.', ['Acceptable and unacceptable fractions defective, p₁ and p₂', 'Producer risk α and consumer risk β'], ['A chart of cumulative-failure acceptance and rejection boundaries through 100 tested units'], ['Outcomes will be independent Bernoulli trials, 0 < p₁ < p₂ < 1, and the plan will be followed as declared.'], String.raw`d_A(n)=s n-h_A,\qquad d_R(n)=s n+h_R`, 'At each cumulative sample size, compare the observed cumulative failures with the two plotted boundaries.', ['Build the chart before testing.', 'Accept the lot if cumulative failures fall at or below the acceptance boundary, reject if they reach or exceed the rejection boundary, and continue while they remain between the lines.'], 'The screen constructs the plan; it does not accept ordered outcomes or automatically issue a decision.', 'The continuous boundaries require an explicit integer-rounding convention in the executed test protocol. Unplanned peeking or continuing after a boundary is crossed invalidates the stated risks.'),
  altMath('one-proportion', 'One-Sample Proportion Interval', 'Estimates one observed pass fraction with an exact Clopper–Pearson confidence interval.', 'Binary outcomes from one population need an estimate and interval.', ['Successes, trials, and confidence'], ['Observed proportion and exact lower/upper bounds'], ['Trials are independent Bernoulli outcomes from one population.'], String.raw`\widehat p=x/n`, 'Eighteen of 20 units pass.', ['Compute 18/20.', 'Use beta-distribution quantiles for the exact interval.'], 'The observed proportion is 0.90; the reported exact bounds communicate its sampling uncertainty.', 'The interval is not a test against a target unless the target comparison is explicitly made and interpreted.'),
  altMath('two-proportion', 'Two-Proportion Test', 'Compares binary success proportions from two independent groups with a pooled two-sided z test or Fisher’s exact test for sparse tables.', 'Two designs, suppliers, or processes have independent pass/fail results.', ['Successes and totals for each group', 'Confidence level used to set the two-sided significance threshold'], ['Both sample proportions, observed difference, selected test method, test statistic when applicable, and p-value/significance decision'], ['Groups and trials are independent; paired or clustered outcomes require another model.'], String.raw`\widehat\Delta=\frac{x_1}{n_1}-\frac{x_2}{n_2}`, 'Design A passes 18/20 and B passes 14/20.', ['Compute both proportions and subtract.', 'Because the expected cell counts are adequate here, compare the pooled-z p-value with 1 minus the selected confidence.'], 'Observed difference is 0.90 − 0.70 = 0.20; the reported p-value assesses equality of the two proportions.', 'A non-significant result does not establish equivalence. When any pooled-null expected cell count is below five, Perdura reports Fisher’s exact test and no z statistic; this screen does not currently report a confidence interval for the difference.'),
  altMath('goodness-of-fit', 'Reliability Goodness of Fit', 'Fits the selected distribution and tests compatibility using either chi-squared bins or a Kolmogorov–Smirnov CDF distance.', 'A distribution assumption behind a test plan needs a diagnostic check.', ['At least five failure times', 'Distribution, chi-squared or KS method, confidence, and bootstrap replicate count'], ['Method-specific statistic, bootstrap-calibrated critical value and p-value, refit count, plus chi-squared bin diagnostics'], ['Independent observations come from one continuous population and the selected fitted family is a meaningful candidate.'], String.raw`X^2=\sum_j\frac{(O_j-E_j)^2}{E_j},\qquad D=\sup_x|F_n(x)-F_{\widehat\theta}(x)|`, 'For chi-squared, suppose four fitted-probability bins have observed counts (8, 12, 11, 9) and expected counts (10, 10, 10, 10).', ['Compute X² = 0.4 + 0.4 + 0.1 + 0.1 = 1.0.', 'Compare it with the refit-bootstrap distribution rather than an unadjusted textbook cutoff.'], 'The displayed bootstrap p-value is the fraction of refitted null samples at least as discrepant as the data; degrees of freedom and minimum expected count diagnose the chi-squared binning.', 'Failure to reject is not proof of fit. Perdura merges sparse chi-squared bins, declines inference if residual degrees of freedom vanish, and recalibrates both methods by simulating and refitting the selected family.'),
  altMath('degradation-nondestructive', 'Non-Destructive Degradation', 'Projects repeated unit-level measurements to a threshold using hierarchical or per-unit models.', 'The same units are measured repeatedly before physical failure is observed.', ['Unit IDs, times, measurements, threshold/direction, path and population models'], ['Projected first-passage life distribution and uncertainty'], ['The latent path model, threshold, and repeated-measure dependence represent the mechanism.'], String.raw`T_i=\inf\{t:g_i(t)\ \text{crosses the threshold}\}`, 'A linear latent path is g(t) = 2 + 0.5t and failure is above 12.', ['Solve 2 + 0.5t = 12.'], 'Projected crossing time is t = 20; population analysis combines unit paths rather than treating repeated rows as independent.', 'Residual measurement noise is not automatically damage-bearing process noise; model and threshold choice drive projection.'),
  altMath('degradation-destructive', 'Destructive Degradation', 'Fits a population degradation path when each specimen is measured once because measurement destroys it.', 'Different specimens are sacrificed at planned ages.', ['Time and measurement for each specimen', 'Path model, threshold/direction, and measurement distribution'], ['Population path, projected crossing, and uncertainty'], ['Specimens at each time are exchangeable samples from the same population.'], String.raw`g(t_f)=D_{crit}`, 'A fitted mean path is g(t) = 100 − 2t and failure is below 60.', ['Solve 100 − 2t = 60.'], 'Projected mean threshold crossing is t = 20; it is not a repeated-unit trajectory.', 'Pooling destructive observations cannot estimate within-unit path variability without additional assumptions.'),
  altMath('ess', 'ESS Screening', 'Computes thermal, vibration, or combined screening-strength curves and residual defect fractions with Perdura’s screening equations.', 'A production screen uses controlled thermal cycling, random vibration, or both.', ['Screen type, temperature range/cycles, vibration grms/minutes, incoming defect rate, and target strength'], ['Achieved/required screening strength, detected and residual defect fractions'], ['The implemented empirical screening-strength equations and defect population apply to production units.'], String.raw`SS_T=1-e^{-0.0017(\Delta T)^{1.9}N},\qquad SS_V=1-e^{-0.0046(g_{rms})^{1.71}h}`, 'A thermal screen uses ΔT = 10 and N = 10 cycles.', ['Substitute the cycle range and count into the thermal equation.'], 'SST = 1−exp[−0.0017×10^1.9×10] ≈ 0.7409.', 'These screening-strength equations are planning models; a screen can consume useful life or damage good units and must be validated.'),
  altMath('hass', 'HASS Screening', 'Builds precipitation settings midway between supplied operating and destruct limits, plus a detection-screen probability.', 'HALT limits exist and a production screen must be established and proof-tested.', ['Operating/destruct thermal and vibration limits, target precipitation strength, detection duration, and use MTBF'], ['Precipitation settings/cycles, screening strength, and detection probability'], ['Production hardware is comparable to HALT hardware and proof-of-screen validates safety.'], String.raw`P_{detect}=1-e^{-t_d/MTBF_{use}}`, 'Detection duration is 100 h and use MTBF is 1,000 h.', ['Evaluate the exponential detection expression.'], 'Pdetect = 1−exp(−0.1) ≈ 0.0952; precipitation settings are computed separately from the supplied limits.', 'Midpoint stresses and the detection equation are planning aids, not proof that a HASS profile is safe or effective.'),
  altMath('burn-in', 'Burn-In Design', 'Evaluates Weibull burn-in exposure, expected failures, and reliability/hazard conditional on surviving the burn-in.', 'A decreasing-hazard Weibull model (typically β < 1) is defensible for infant mortality.', ['Weibull η and β, units, duration, and acceleration factor'], ['Effective burn-in time, survival, expected failures, and post-burn-in mean residual life'], ['Burn-in conditions scale time by the entered AF and the Weibull model applies.'], String.raw`t_{eff}=AF\,t_b,\qquad E[N_f]=n\left\{1-e^{-(t_{eff}/\eta)^\beta}\right\}`, 'One hundred units with η = 1,000 h and β = 0.5 receive 100 h burn-in at AF = 1.', ['Compute effective time and Weibull failure probability.', 'Multiply by 100 units.'], 'Expected burn-in failures are 100×[1−exp(−√0.1)] ≈ 27.11.', 'Burn-in can be wasteful or harmful without a verified early-failure model and effective failure detection.'),
]

// ---------------------------------------------------------------------------
// System Modeling and Allocation
// ---------------------------------------------------------------------------

const systemTopics: HelpTopic[] = [
  mathTopic({
    moduleId: 'systemModeling', id: 'rbd', title: 'Reliability Block Diagram', aliases: ['RBD'],
    summary: 'Computes success probability from source-to-sink connectivity, component reliability, and optional common-cause groups.',
    useWhen: ['System success is naturally expressed by functioning paths.'], inputs: ['Source, sink, component blocks, connections, and component reliability models'],
    outputs: ['Exact network reliability, path display, and importance measures'], assumptions: ['Component events are independent except for explicitly modeled beta-factor groups.', 'The static mission success definition is correct.'],
    practice: ['Create one connected source-to-sink network.', 'Assign every component a reliability or supported distribution at mission time.', 'Model shared-cause groups explicitly.'],
    interpretation: ['Series components all must work; parallel paths provide redundancy.', 'Importance is conditional on the modeled architecture and probabilities.'],
    caution: 'Apparent redundancy is not independent when branches share power, software, environment, or maintenance dependencies.',
    equations: [equation(String.raw`R_{series}=\prod_iR_i,\qquad R_{parallel}=1-\prod_i(1-R_i)`)], related: ['systemModeling.fault-tree'],
    worked: example('Two parallel components', 'Two independent components each have R = 0.90 and either can provide success.', ['Compute both-fail probability (0.1)(0.1).', 'Subtract from one.'], 'Parallel reliability is 1 − 0.01 = 0.99.'),
  }),
  mathTopic({
    moduleId: 'systemModeling', id: 'fault-tree', title: 'Fault Tree Analysis', aliases: ['FTA', 'minimal cut sets'],
    summary: 'Computes a static coherent top-event probability from basic events and AND/OR logic, with exact, bound, rare-event, or simulation methods.',
    useWhen: ['System failure is most naturally decomposed into causal combinations.'], inputs: ['One top event, gates, basic-event probabilities or rates, exposure, and optional common-cause groups'],
    outputs: ['Top-event probability, minimal cut sets, importance, and method diagnostics'], assumptions: ['Static coherent AND/OR semantics apply.', 'Dependencies are absent except those explicitly represented.'],
    practice: ['Define event identities uniquely.', 'Use exact evaluation when feasible.', 'Review minimal cut sets and method status.'],
    interpretation: ['A minimal cut set is a smallest basic-event combination sufficient for the top event.', 'Rare-event sums are approximations when cut sets overlap or probabilities are not small.'],
    caution: 'PAND, XOR, and NOT are deliberately not approximated by static AND/OR logic; ordered or non-coherent behavior needs another model.',
    equations: [equation(String.raw`P(A\cup B)=P(A)+P(B)-P(A\cap B)`)], citations: [cite('nrc-fault-tree')], related: ['systemModeling.rbd', 'systemModeling.markov'],
    worked: example('OR gate', 'Two independent basic events have probabilities 0.01 and 0.02.', ['Use inclusion–exclusion.'], 'Top-event probability is 0.01 + 0.02 − 0.0002 = 0.0298.'),
  }),
  mathTopic({
    moduleId: 'systemModeling', id: 'markov', title: 'Markov Analysis', aliases: ['CTMC', 'Erlang phase type'],
    summary: 'Analyzes repairable state transitions with a continuous-time Markov chain or Erlang phase-type dwell approximation.',
    useWhen: ['Availability, reliability, repair, standby, or state-dependent transitions matter over time.'], inputs: ['States, types, transition rates, initial state, times, optional dwell shapes and rate CVs'],
    outputs: ['State probabilities, availability, reliability, MTTF, and optional uncertainty'], assumptions: ['CTMC rates are constant and exponential dwell is memoryless unless an Erlang dwell is selected.', 'Transition definitions are exhaustive and rates use one time unit.'],
    practice: ['Define up, degraded, and failed states.', 'Check every outgoing rate and initial state.', 'Use Erlang phases only when non-memoryless dwell is intended.'],
    interpretation: ['Availability allows repaired return to up states; reliability tracks avoidance of first failed-state entry.', 'Erlang k = 1 is exponential and CV = 1/√k.'],
    caution: 'A rate matrix cannot represent arbitrary duration dependence, repair queues, or shared resources without expanding the state model.',
    equations: [equation(String.raw`\mathbf p(t)=\mathbf p(0)e^{Qt}`), equation(String.raw`\operatorname{CV}_{Erlang}=1/\sqrt{k}`)],
    related: ['systemModeling.fault-tree'],
    worked: example('Two-state availability', 'Failure rate λ = 0.001 h⁻¹ and repair rate μ = 0.1 h⁻¹.', ['Use steady-state availability μ/(λ+μ).'], 'A∞ = 0.1/0.101 ≈ 0.9901; this is availability, not no-failure reliability.'),
  }),
]

const allocationSpecs = [
  ['equal', 'Equal apportionment', String.raw`R_i=R_{sys}^{1/n}`, 'Assigns every series subsystem the same reliability target.', 'For Rsys = 0.81 and n = 2, each target is √0.81 = 0.90.'],
  ['arinc', 'ARINC proportional allocation', String.raw`\lambda_i=\frac{\lambda_{i,0}}{\sum_j\lambda_{j,0}}\lambda_{sys}`, 'Allocates allowable system hazard in proportion to current or predicted subsystem rates.', 'For baseline rates 1 and 3 and λsys = 0.004 h⁻¹, allocations are 0.001 and 0.003 h⁻¹.'],
  ['agree', 'AGREE target-conserving allocation', String.raw`w_i=n_i/I_i,\qquad \lambda_i=\frac{w_i}{\sum_jw_j}\lambda_{sys}`, 'Normalizes complexity/importance weights so series targets conserve the system hazard.', 'For equal complexity with importances 1 and 0.5, weights are 1 and 2, so hazard shares are 1/3 and 2/3.'],
  ['feasibility', 'Feasibility-of-effort allocation', String.raw`\lambda_i=\frac{d_i}{\sum_jd_j}\lambda_{sys}`, 'Gives harder-to-improve subsystems a larger share of allowable hazard.', 'For difficulty ratings 2 and 8, the hazard shares are 0.2 and 0.8.'],
] as const

const allocationTopics = allocationSpecs.map(([id, title, latex, summary, result]) => mathTopic({
  moduleId: 'reliabilityAllocation', id, title, summary,
  useWhen: ['A top-level reliability or MTBF target must be apportioned across a series system.'],
  inputs: ['System target, mission time, subsystem rows, and method-specific weights'], outputs: ['Subsystem reliability, hazard, and MTBF targets plus product check'],
  assumptions: ['Subsystems form a series system.', 'Constant failure rates connect reliability, hazard, and MTBF.'],
  practice: ['Set the system requirement and mission time.', 'Enter every method-specific input.', 'Confirm achieved reliability equals the target.'],
  interpretation: ['An allocation is a design target, not a prediction.', 'Allowed subsystem hazards sum to the allowed system hazard.'],
  caution: 'Do not use the series/exponential allocation unchanged for redundant architectures or time-varying hazards.',
  equations: [equation(latex), equation(String.raw`\lambda_{sys}=-\ln(R_{sys})/t`)], related: ['prediction.system-blocks'],
  worked: example(`${title} calculation`, 'Allocate a target between two subsystems using the values in the result below.', ['Apply the displayed weighting equation.', 'Verify the allocated hazards sum or reliabilities multiply to the system target.'], result),
}))

// ---------------------------------------------------------------------------
// Failure Rate Prediction
// ---------------------------------------------------------------------------

const predictionStandards = [
  ['mil-hdbk-217f', 'MIL-HDBK-217F Notice 2', 'Electronic part-stress and Appendix A parts-count prediction using the handbook equations and environment/quality factors.', [cite('mil-hdbk-217f')], 'The handbook calculation is complete within Perdura’s documented model surface, but it remains a conditional planning prediction—not demonstrated reliability or a substitute for relevant field evidence.'],
  ['telcordia-sr332', 'Telcordia SR-332', 'Telecommunications-oriented component reliability prediction for the supported device categories.', [cite('telcordia-sr332')], 'This is a screening subset. Licensed tables, the complete Methods I–III workflow, field-data updating, and official-example parity are not implemented.'],
  ['217plus', '217Plus', 'Component prediction with the supported 217Plus base, stress, environment, quality, and process inputs.', [cite('217plus-2015')], 'This is a simplified screening proxy. It does not reproduce the licensed database, full failure-mode model, process assessment, or official-example parity.'],
  ['fides', 'FIDES Guide 2022', 'Mission- and process-informed electronic reliability prediction for the supported FIDES categories.', [cite('fides-guide'), cite('nasa-fides-pof')], 'This is a high-level screening implementation. The complete 2022 component tables, Pi Process audit, induced-factor workflow, and FIDES LAB parity are not implemented.'],
  ['nswc-98-le1', 'NSWC-98/LE1', 'Mechanical-component prediction for supported bearings, springs, valves, gears, seals, and related equipment.', [cite('nswc-98-le1')], 'Only selected component models are implemented, and identified modification factors are simplified; do not represent the result as full handbook conformance.'],
  ['eprd-2014', 'EPRD-2014', 'Empirical electronic-part failure rates selected by supported category, environment, and quality descriptors.', [cite('eprd-2014')], 'Perdura uses representative aggregate screening rates, not licensed record-level EPRD lookups, source-population filters, confidence bounds, or exact table extracts.'],
  ['nprd-2023', 'NPRD-2023', 'Empirical nonelectronic-part failure rates selected by supported category and application descriptors.', [cite('nprd-2023')], 'Perdura uses representative aggregate screening rates, not licensed record-level NPRD lookups, source-population filters, confidence bounds, or exact table extracts.'],
] as const

const predictionTopics: HelpTopic[] = [
  ...predictionStandards.map(([id, title, summary, citations, scopeNote]) => mathTopic({
    moduleId: 'prediction', id, title, summary,
    useWhen: [`The program requires ${title} and every line item maps to an implemented category.`],
    inputs: ['Parts, quantities, environments, and standard-specific stresses/factors'], outputs: ['Per-piece calculated rate, line contribution, system FPMH, MTBF, and methodology disclosure'],
    assumptions: ['Handbook categories and factors represent the equipment and mission.', 'Rates can be summed under the prediction’s constant-rate planning convention.'],
    practice: ['Select the standard before building the parts list.', 'Resolve every incompatible part.', 'Review factors, equations, warnings, and contribution—not only the total.'],
    interpretation: ['FPMH means failures per million hours.', 'The retained calculated rate remains visible when an override is applied.'],
    caution: scopeNote,
    equations: [equation(String.raw`\lambda_{system}=\sum_i q_i\lambda_i,\qquad MTBF=10^6/\lambda_{system}\ \text{(FPMH)}`)],
    citations: [...citations], related: ['prediction.system-blocks', 'prediction.mission-profile', 'prediction.derating'],
    worked: standardExample(`${title} system roll-up`, 'Line contributions are 0.40 and 0.60 FPMH, so system rate is 1.00 FPMH and the exponential MTBF is 1,000,000 h.'),
  })),
  mathTopic({
    moduleId: 'prediction', id: 'part-stress', title: 'Part-Stress prediction',
    summary: 'Calculates each part from its detailed electrical, thermal, quality, environment, package, and application factors.',
    useWhen: ['Design-specific stress and construction data are available.'], inputs: ['Part category, environment, quantity, and every required category parameter'],
    outputs: ['Base rate, factors, substitutions, effective per-piece rate, and line contribution'], assumptions: ['Input stresses and temperatures represent the intended operating condition.'],
    practice: ['Prefer measured or design-derived values over defaults.', 'Hover equation symbols to audit substituted numbers.', 'Check warnings and derating separately.'],
    interpretation: ['Multiplicative factor equations are category-specific.', 'Quantity changes contribution, not per-piece calculated rate.'],
    caution: 'Blank, defaulted, or unit-mismatched stress inputs can dominate the prediction while still producing a number.',
    equations: [equation(String.raw`\lambda_p=\lambda_b\prod_k\pi_k`)], citations: [cite('mil-hdbk-217f')], related: ['prediction.mil-hdbk-217f', 'prediction.derating'],
    worked: example('Factor multiplication', 'A category has λb = 0.02 FPMH and factors 2, 3, and 0.5.', ['Multiply base rate by all factors.'], 'Per-piece λp = 0.02×2×3×0.5 = 0.06 FPMH.'),
  }),
  mathTopic({
    moduleId: 'prediction', id: 'parts-count', title: 'Parts-Count prediction',
    summary: 'Uses handbook generic part-type, quality, and environment rates for early design estimates.',
    useWhen: ['Detailed part stresses are unavailable and the applicable handbook supplies a parts-count model.'], inputs: ['Part type, quality, environment, and quantity'],
    outputs: ['Generic per-piece rate and line/system totals'], assumptions: ['Generic catalog entries adequately represent the planned design.'],
    practice: ['Choose the closest exact catalog type.', 'Keep Appendix A use distinct from detailed part-stress calculations.', 'Replace with detailed data as the design matures.'],
    interpretation: ['Parts-count uncertainty is structural and is not shown merely by extra decimal places.'],
    caution: 'Do not mix generic and detailed rates for the same physical part or claim parts-count precision as design-specific evidence.',
    equations: [equation(String.raw`\lambda_{equipment}=\sum_iN_i\lambda_{g,i}\pi_{Q,i}`)], citations: [cite('mil-hdbk-217f')], related: ['prediction.part-stress'],
    worked: example('Parts-count line', 'Twenty identical catalog parts have generic adjusted rate 0.05 FPMH each.', ['Multiply rate by count.'], 'Line contribution is 20×0.05 = 1.0 FPMH.'),
  }),
  workflowTopic({
    moduleId: 'prediction', id: 'vita-51-1', title: 'ANSI/VITA 51.1 R2018 supplement', aliases: ['A/V51.1', 'VITA 51.1'],
    summary: 'Applies implemented A/V51.1 commercial-parts defaults, mappings, extensions, conversions, and alternate methods to MIL-HDBK-217F when enabled.',
    useWhen: ['The MIL-HDBK-217F analysis meets the supplement’s commercial known-pedigree and counterfeit-control prerequisites.'],
    inputs: ['Global checkbox, optional per-part choice, and A/V-specific parameters'], outputs: ['Supplemented factors/equations and a side-by-side base handbook trace where applicable'],
    assumptions: ['Checking the option asserts the stated pedigree and program controls.', 'The selected rule applies to the part category.'],
    practice: ['Read the prerequisite statement before enabling.', 'Use actual connector, thermal, package, or manufacturer data when known.', 'Review highlighted differences from base MIL results.'],
    interpretation: ['A/V51.1 supplements rather than replaces the base standard.', 'Per-part inherit/on/off choices resolve against the global setting.'],
    caution: 'Do not enable the supplement solely to obtain a lower rate; applicability and data provenance must be documented.',
    citations: [cite('vita-51-1'), cite('mil-hdbk-217f')], related: ['prediction.mil-hdbk-217f', 'pof.fracture'],
    walkthrough: example('Apply a supplement rule', 'A MIL prediction contains a supported COTS part and the program satisfies the pedigree prerequisites.', ['Enable A/V51.1 globally.', 'Confirm the part inherits or explicitly enables it.', 'Review highlighted factor/equation differences and the retained base result.'], 'The effective prediction uses the documented A/V rule while preserving base MIL traceability.'),
  }),
  mathTopic({
    moduleId: 'prediction', id: 'system-blocks', title: 'System Blocks, quantities, and duty cycle',
    summary: 'Organizes nested subassemblies and applies block quantity, exposure, environment, and optional final-rate overrides.',
    useWhen: ['Parts belong to repeated or duty-cycled subassemblies.'], inputs: ['Block hierarchy, quantity, duty cycle, operating/dormant environments, and notes'],
    outputs: ['Block subtotals and effective system contribution'], assumptions: ['Nested quantities and duty cycles describe actual exposure.', 'Environment-aware weighting is applicable to the selected standard.'],
    practice: ['Assign every part to the intended block.', 'Check compounded quantities/duties in nested blocks.', 'Document any block override.'],
    interpretation: ['Operating/dormant weighting is applied before quantity.', 'A block override supersedes descendant roll-up in the total but does not erase descendant calculations.'],
    caution: 'FIDES uses its mission/process model rather than the simple environment duty weighting used by other supported standards.',
    equations: [equation(String.raw`\lambda_{eff}=D\lambda_{op}+(1-D)\lambda_{dorm}`), equation(String.raw`\lambda_{block}=Q\sum_i\lambda_{i,eff}`)],
    related: ['prediction.overrides', 'prediction.mission-profile'],
    worked: example('Duty-weighted block', 'A block has λop = 2 FPMH, λdorm = 0.2 FPMH, duty D = 0.25, and quantity Q = 2.', ['Compute effective rate per block.', 'Apply block quantity.'], 'λeff = 0.25×2 + 0.75×0.2 = 0.65 FPMH; contribution = 2×0.65 = 1.30 FPMH.'),
  }),
  mathTopic({
    moduleId: 'prediction', id: 'overrides', title: 'Failure-rate overrides',
    summary: 'Replaces a part or block’s effective output with justified user data while retaining the handbook calculation for audit.',
    useWhen: ['Qualified field, supplier, or test evidence is more appropriate than the handbook output.'], inputs: ['Override toggle, final per-piece/per-block FPMH, and provenance note'],
    outputs: ['Effective overridden contribution plus retained calculated rate and factors'], assumptions: ['The external rate uses compatible units, population, environment, and mission basis.'],
    practice: ['Enable the toggle explicitly.', 'Enter the final rate, not a multiplier.', 'Record source, confidence, population, and adjustment basis.'],
    interpretation: ['Part quantity is applied after a per-piece override.', 'A block override replaces its descendant subtotal in the system total.'],
    caution: 'An override without provenance is unauditable; never use it merely to force a desired system total.',
    equations: [equation(String.raw`\lambda_{line}=q\,\lambda_{override}`)], related: ['prediction.system-blocks'],
    worked: example('Part override', 'A retained handbook result is 0.8 FPMH, but qualified field evidence supports 0.5 FPMH per piece and quantity is 3.', ['Enable override and enter 0.5.', 'Apply quantity.'], 'System contribution is 1.5 FPMH; the 0.8 FPMH handbook result remains visible.'),
  }),
  workflowTopic({
    moduleId: 'prediction', id: 'derating', title: 'Electrical and thermal derating',
    summary: 'Checks part stresses against the selected derating standard, severity level, or custom rules.',
    useWhen: ['Design stress margins must be screened alongside the failure-rate prediction.'], inputs: ['Parts and stress parameters', 'Derating standard/level or custom limits'],
    outputs: ['Per-rule OK, warning, or exceeds status and summary'], assumptions: ['Input stress ratios and temperatures represent worst intended conditions.'],
    practice: ['Choose the program’s derating standard and level.', 'Resolve every exceeds result or document disposition.', 'Re-run when stress inputs change.'],
    interpretation: ['Passing derating does not imply a target failure rate; it is a separate stress-margin check.'],
    caution: 'Categories with no applicable rule are not automatically compliant.', citations: [cite('mil-hdbk-217f')], related: ['prediction.part-stress'],
    walkthrough: example('Review one resistor', 'Applied-to-rated power ratio is 0.45 and the selected rule limit is 0.50.', ['Compare in the rule’s direction and units.', 'Review temperature limits separately.'], 'The power-ratio rule passes with 0.05 absolute margin; this does not replace the reliability prediction.'),
  }),
  mathTopic({
    moduleId: 'prediction', id: 'mission-profile', title: 'Mission Profile prediction',
    summary: 'Combines phase-specific durations, environments, and rates into total mission reliability.',
    useWhen: ['Equipment experiences materially different phases rather than one steady environment.'], inputs: ['Named phases, duration, environment, and applicable standard settings'],
    outputs: ['Phase rates, total duration, mission exposure, reliability, and equivalent rate'], assumptions: ['Constant rate is adequate within each phase and phases occur as entered.'],
    practice: ['Enter all phases in chronological or auditable order.', 'Map each phase to a valid standard environment.', 'Check total duration against the intended mission.'],
    interpretation: ['Exponential phase survivals multiply; cumulative hazards add.', 'A short harsh phase can dominate total exposure.'],
    caution: 'The mission profile does not model path dependence, repair, or wear accumulation unless the selected standard explicitly does so.',
    equations: [equation(String.raw`R_{mission}=\prod_j e^{-\lambda_jt_j}=e^{-\sum_j\lambda_jt_j}`)],
    related: ['prediction.system-blocks'],
    worked: example('Two-phase mission', 'Phase 1 is 100 h at λ = 1×10⁻⁶ h⁻¹; phase 2 is 10 h at λ = 10×10⁻⁶ h⁻¹.', ['Add phase hazards λt.', 'Exponentiate the negative total.'], 'Total hazard exposure is 0.0001 + 0.0001 = 0.0002; Rmission = exp(−0.0002) ≈ 0.999800.'),
  }),
]

// ---------------------------------------------------------------------------
// Physics of Failure
// ---------------------------------------------------------------------------

const pofSpecs = [
  ['arrhenius', 'Arrhenius', 'Thermally activated acceleration between use and test temperatures.', String.raw`AF=\exp\!\left[\frac{E_a}{k}\left(\frac1{T_u}-\frac1{T_t}\right)\right]`, 'Ea = 0.7 eV, Tuse = 55 °C, Ttest = 125 °C gives AF ≈ 77.7.', 'One thermally activated mechanism and activation energy apply.', [cite('nasa-fides-pof')]],
  ['eyring', 'Eyring', 'Adds a temperature power prefactor to thermally activated acceleration.', String.raw`AF=(T_t/T_u)^n\exp\!\left[\frac{E_a}{k}\left(\frac1{T_u}-\frac1{T_t}\right)\right]`, 'If Ea = 0 and Ttest/Tuse = 1.2 with n = 2, AF = 1.44.', 'The chosen Eyring exponent and activation energy apply.', [cite('nasa-fides-pof')]],
  ['coffin-manson', 'Coffin–Manson strain–life', 'Relates elastic and plastic strain amplitude to fatigue reversals.', String.raw`\frac{\Delta\epsilon}{2}=\frac{\sigma_f\prime}{E}(2N)^b+\epsilon_f\prime(2N)^c`, 'If the two terms at a candidate life are 0.002 and 0.003, total strain amplitude is 0.005.', 'Uniaxial constant-amplitude material constants and reversals are applicable.', [cite('nasa-nasalife', '§2.5, eqs. 24–27')]],
  ['norris-landzberg', 'Norris–Landzberg', 'Accelerates solder-joint thermal-cycle fatigue by range, frequency, and maximum temperature.', String.raw`AF=(\Delta T_t/\Delta T_u)^n(f_u/f_t)^m e^{E_a/k(1/T_{max,u}-1/T_{max,t})}`, 'With only ΔT ratio active, ratio 2 and n = 2 gives AF = 4.', 'Assembly construction and thermal-cycle mechanism match between conditions.', [cite('norris-landzberg-1969')]],
  ['sn', 'S–N Curve (Basquin)', 'Fits a log–log stress-life curve for constant-amplitude high-cycle fatigue.', String.raw`S=A N^b`, 'With A = 1000 MPa, b = −0.1, and N = 10⁶, S ≈ 251.2 MPa.', 'One Basquin regime applies and fitted b is negative.', [cite('nasa-nasalife', '§2.3–2.5 fatigue formulation')]],
  ['damage', 'Miner’s Rule', 'Accumulates cycle-fraction damage across load blocks, with optional nonlinear exponents.', String.raw`D=\sum_i(n_i/N_i)^{q_i}`, 'Blocks 500/1000 and 100/1000 with q = 1 give D = 0.6.', 'Damage accumulates by the selected rule; sequence effects are neglected.', [cite('nasa-miner', 'NASA-RP-310'), cite('nasa-nasalife', '§2.5, eq. 28')]],
  ['mean-stress', 'Mean-Stress Correction', 'Compares Goodman, Soderberg, and Gerber fatigue criteria at an operating stress point.', String.raw`n_{Goodman}^{-1}=\sigma_a/S_e+\sigma_m/S_u`, 'With σa/Se = 0.4 and σm/Su = 0.1, Goodman factor of safety is 1/0.5 = 2.', 'Material strengths and fatigue limit share units and the empirical criterion applies.', [cite('nasa-nasalife')]],
  ['peck', 'Peck temperature–humidity life', 'Models humidity- and temperature-driven time to failure.', String.raw`TTF=A\,RH^{-n}\exp(E_a/kT)`, 'At fixed temperature, doubling RH with n = 2 reduces modeled life by a factor of 4.', 'No condensation or mechanism change occurs and RH convention matches A.', [cite('nasa-fides-pof')]],
  ['hallberg-peck', 'Hallberg–Peck acceleration', 'Calculates temperature–humidity acceleration between test and use.', String.raw`AF=(RH_t/RH_u)^n e^{E_a/k(1/T_u-1/T_t)}`, 'At equal temperature, RH ratio 2 and n = 3 gives AF = 8.', 'The same humidity-temperature mechanism applies.', [cite('nasa-fides-pof')]],
  ['electromigration', 'Electromigration (Black)', 'Models conductor MTTF from current density and temperature.', String.raw`MTTF=A J^{-n}\exp(E_a/kT)`, 'At fixed temperature, doubling J with n = 2 divides modeled MTTF by 4.', 'Constants match J in A/cm², time units, material, and microstructure.', [cite('nasa-fides-pof')]],
  ['tddb', 'Time-Dependent Dielectric Breakdown', 'Models oxide-field and temperature acceleration with E or inverse-E field dependence.', String.raw`AF_E=e^{\gamma(E_t-E_u)}e^{E_a/k(1/T_u-1/T_t)}`, 'At equal temperature, γ = 2 cm/MV and Etest−Euse = 0.5 MV/cm gives AF = e¹ ≈ 2.718.', 'The selected E or 1/E mechanism and oxide technology apply.', [cite('nasa-fides-pof')]],
  ['creep', 'Creep Life (Larson–Miller)', 'Projects stress-rupture time using a Larson–Miller parameter relation.', String.raw`P=T\{C+\log_{10}(t_r)\}=a+b\log_{10}\sigma`, 'If P/T = 25 and C = 20, log10(tr) = 5 so tr = 100,000 selected time units.', 'Coefficients, stress, kelvin temperature, C, and time units share one calibration.', [cite('nasa-nasalife', '§2.6.1, eqs. 29–31')]],
  ['fracture', 'Fracture Mechanics', 'Screens critical crack size and integrates Paris, Walker, or Forman fatigue crack growth where selected.', String.raw`K_I=Y\sigma\sqrt{\pi a}`, 'With Y = 1, σ = 100 MPa, and a = 0.001 m, KI ≈ 5.60 MPa√m.', 'Linear-elastic fracture mechanics and geometry factor remain valid.', [cite('nasa-forman'), cite('nasa-nasalife')]],
  ['stress-strain', 'Stress–Strain (Ramberg–Osgood)', 'Separates elastic and plastic strain for a uniaxial material curve.', String.raw`\epsilon=\sigma/E+(\sigma/K)^{1/n}`, 'If elastic strain is 0.001 and plastic strain is 0.002, total strain is 0.003.', 'Material constants and stress use a consistent MPa basis and apply over the plotted range.', [cite('nasa-nasalife', '§2.8, eqs. 36–37')]],
] as const

const pofTopics = pofSpecs.map(([id, title, summary, latex, result, assumption, citations]) => mathTopic({
  moduleId: 'pof', id, title, summary,
  useWhen: ['The named physical mechanism is established and required material/model parameters are available.'],
  inputs: ['Model-specific loads, environment, material constants, and optional uncertainty specification'],
  outputs: ['Deterministic result, curves, validity warnings, and optional propagated uncertainty'],
  assumptions: [assumption, 'Inputs use the units labeled in the module.'],
  practice: ['Use the PoF wizard to confirm the mechanism.', 'Prefer calibrated material/component constants.', 'Enable uncertainty when parameter distributions are defensible.', 'Review validity warnings before using a projection.'],
  interpretation: ['The central output is conditional on the selected mechanism and constants.', 'Uncertainty bands propagate entered parameter uncertainty; they do not repair model-form uncertainty.'],
  caution: 'A physics equation outside its calibrated regime can be less credible than an empirical result despite appearing mechanistic.',
  equations: [equation(latex)], advanced: ['Check unit convention, extrapolation range, mechanism transitions, and sensitivity to uncertain exponents.'],
  citations: [...citations], related: ['pof.overview'],
  worked: example(`${title} calculation`, 'Use the simple numerical substitution stated below.', ['Substitute values into the displayed equation.', 'Preserve units and review model validity.'], result),
}))

// ---------------------------------------------------------------------------
// Reliability Growth
// ---------------------------------------------------------------------------

const growthTopics: HelpTopic[] = [
  mathTopic({
    moduleId: 'growth', id: 'crow-amsaa', title: 'Crow–AMSAA power-law NHPP', aliases: ['Crow AMSAA', 'PLP'],
    summary: 'Fits repairable-system recurrence events or grouped counts with a power-law non-homogeneous Poisson process.',
    useWhen: ['One repairable-system test history records recurrent failures under minimal repair.'], inputs: ['Exact cumulative event times or grouped interval counts', 'Termination rule, test end, estimator, confidence, and GoF level'],
    outputs: ['Scale λ, shape β, cumulative intensity, instantaneous ROCOF, MTBF metrics, trend test, intervals, and projections'],
    assumptions: ['Independent NHPP increments and minimal repair within the modeled phase.', 'Test termination and data mode are declared correctly.'],
    practice: ['Use recurrence times, not independent unit lifetimes.', 'Declare time- or failure-termination.', 'Review trend, goodness of fit, and projection diagnostics.'],
    interpretation: ['β < 1 is improving recurrence intensity, β = 1 is homogeneous Poisson, and β > 1 is deteriorating.', 'The estimator interpretation and a small-sample trend-test direction can differ.'],
    caution: 'Corrective-action delays, imperfect repair, phase changes, or mixed fleets require richer modeling or separate phases.',
    equations: [equation(String.raw`\Lambda(t)=\lambda t^{\beta},\qquad \rho(t)=\lambda\beta t^{\beta-1}`)],
    citations: [cite('mil-hdbk-189c')], related: ['growth.rocof', 'growth.mcf'],
    worked: example('Interpret β', 'A fit gives λ = 0.02 and β = 0.8 at t = 100.', ['Compute cumulative mean λt^β.', 'Compute instantaneous ROCOF λβt^(β−1).'], 'Λ(100) ≈ 0.796 and ρ(100) ≈ 0.00637 per time unit; β < 1 indicates decreasing modeled recurrence intensity.'),
  }),
  mathTopic({
    moduleId: 'growth', id: 'duane', title: 'Duane growth curve',
    summary: 'Describes cumulative MTBF growth with log–log regression.', useWhen: ['A descriptive growth visualization is desired and its regression limitations are acceptable.'],
    inputs: ['Cumulative recurrence times and optional evaluation time'], outputs: ['Duane slope/intercept, cumulative MTBF curve, and descriptive projection'],
    assumptions: ['A power relation is a useful empirical description over the plotted range.'],
    practice: ['Plot cumulative test time and cumulative MTBF on log scales.', 'Use Crow–AMSAA for an NHPP likelihood analysis.'],
    interpretation: ['Positive Duane slope describes improving cumulative MTBF.', 'It is a descriptive regression, not the same estimator or likelihood as Crow–AMSAA.'],
    caution: 'Cumulative points are statistically dependent; ordinary regression diagnostics do not create a recurrence-process model.',
    equations: [equation(String.raw`MTBF_c(t)=K t^{\alpha}`)], citations: [cite('mil-hdbk-189c')], related: ['growth.crow-amsaa'],
    worked: example('Duane projection', 'K = 10 and α = 0.3; evaluate at t = 1,000.', ['Compute 10×1000^0.3.'], 'Cumulative MTBF is approximately 79.43 time units.'),
  }),
  mathTopic({
    moduleId: 'growth', id: 'rocof', title: 'ROCOF and Laplace trend test', aliases: ['rate of occurrence of failures'],
    summary: 'Estimates recurrence rate and tests whether exact repairable-system events depart from a homogeneous Poisson trend.',
    useWhen: ['A single repairable-system recurrence history needs a trend screen.'], inputs: ['Failure times or interarrival times, test end, and confidence'],
    outputs: ['ROCOF summary, Laplace statistic, trend classification, and intervals'], assumptions: ['One repairable process, independent increments under the null, and correctly specified test end.'],
    practice: ['Use cumulative recurrence events from one system.', 'Include the final censoring exposure to test end.', 'Interpret test and effect direction together.'],
    interpretation: ['A directional p-value assesses timing concentration under the homogeneous-Poisson null.', 'Non-rejection is not evidence that the rate is exactly constant.'],
    caution: 'Pooling independent unit lifetimes or omitting event-free terminal exposure invalidates the recurrence trend test.',
    equations: [equation(String.raw`U=\frac{\sqrt{12n}}{T}\left(\frac1n\sum_{i=1}^{n}t_i-\frac T2\right)`)],
    citations: [cite('mil-hdbk-189c')], related: ['growth.crow-amsaa'],
    worked: example('Centered events', 'Two events occur at 25 and 75 during a test ending at 100.', ['Their mean time is 50.', 'Subtract T/2 = 50.'], 'The Laplace numerator is zero, so U = 0 for this symmetric example.'),
  }),
  mathTopic({
    moduleId: 'growth', id: 'mcf', title: 'Mean Cumulative Function', aliases: ['Nelson MCF', 'recurrent events'],
    summary: 'Estimates the population mean cumulative recurrence count from multiple independently censored system histories, with optional power-law fit.',
    useWhen: ['Multiple repairable systems have recurrent-event histories and different observation ends.'],
    inputs: ['System ID, event/censor record times or per-system histories, confidence method, and optional parametric fit'],
    outputs: ['Nonparametric MCF, intervals, risk counts, and optional power-law parameters'],
    assumptions: ['System histories are independent and censoring is independent of recurrence.', 'Event definitions are consistent; tied events precede endpoint censoring.'],
    practice: ['Keep each system identity intact.', 'Enter its observation end even if it has no events.', 'Use the nonparametric curve as primary and the power-law fit only when defensible.'],
    interpretation: ['MCF(t) is the expected cumulative event count per system by t.', 'Its slope is an average recurrence intensity, not a probability density.'],
    caution: 'Treating all fleet events as one Crow–AMSAA history loses the changing risk set and can bias the fleet interpretation.',
    equations: [equation(String.raw`\widehat M(t)=\sum_{t_j\le t}\frac{d_j}{Y_j}`)], citations: [cite('lawless-nadeau-1995')], related: ['growth.crow-amsaa', 'growth.rocof'],
    worked: example('One MCF step', 'At a recurrence time, two events occur while five systems remain under observation.', ['Add d/Y = 2/5 to the prior MCF.'], 'The MCF increases by 0.4 expected events per system.'),
  }),
]

export const RELIABILITY_HELP_TOPICS: HelpTopic[] = [
  ...lifeModeTopics,
  ...observationTopics,
  ...distributionTopics,
  ...specialTopics,
  ...otherLifeTopics,
  ...altTopics,
  ...systemTopics,
  ...allocationTopics,
  ...predictionTopics,
  ...pofTopics,
  ...growthTopics,
]
