import { equation, example, list, p, type HelpBlock, type HelpTopic } from '../types'

function topic(id: string, title: string, summary: string, inputs: string[], practice: HelpBlock[], interpretation: HelpBlock[], related: string[]): HelpTopic {
  return { id, moduleId: id.split('.')[0], title, summary, basics: { purpose: summary, inputs },
    sections: [
      { id: 'practice', title: 'Use the tool', depth: 'practice', blocks: practice },
      { id: 'interpretation', title: 'Interpret the result', depth: 'interpretation', blocks: interpretation },
    ], related, reviewed: '2026-11-21', exampleKind: 'worked' }
}

export const TOOLKIT_EXTENSION_TOPICS: HelpTopic[] = [
  topic('maintenance.lifetime-tools', 'Lifetime tools',
    'Calculate conditional survival tables, age-replacement rates and future first-failure counts from an inspection.',
    ['An adopted lifetime model or specified parameters', 'Current ages and additional durations', 'Replacement age and downtime, or inspection counts and a fixed Weibull shape'], [
      list(['Choose a current adopted Life Data model to reuse its parameters in project units.', 'Build an age-by-duration survival or failure table; export the displayed measure as CSV.', 'For mechanical replacement, enter Weibull scale or a failure percentile life such as L10. State corrective and preventive downtime for calendar rates.', 'For inspection prediction, enter original population N, failures X by age t1, future age t2, and candidate shapes. Review prior and shape sensitivity before transferring a survivor cohort to Fleet Forecast.']),
      equation(String.raw`P(T>a+d\mid T>a)=R(a+d)/R(a)`, { explanation: 'Additional duration starts after the survived current age.', citations: [{ id: 'nist-weibull-lifetime' }] }),
      example('Mechanical replacement rate', 'A Weibull lifetime has scale 50,000 hours and shape 1.3. Replacement occurs at failure or attained age 87,600 hours.',
        ['Compute F(87,600).', 'Integrate survival from zero to 87,600.', 'Divide the failure probability by expected cycle operating time.'],
        '20.61752860 corrective failures per million operating hours. The reciprocal is an equivalent average spacing under this replacement policy.'),
    ], [
      p('The conditional mean additional life is the survival-tail integral divided by current survival. A remaining percentile life answers a different question. Life Data displays both when an elapsed age is supplied.'),
      equation(String.raw`\lambda_{CM}=\frac{F(\tau)}{\int_0^\tau R(u)\,du}`, { explanation: 'The renewal rate assumes independent, as-good-as-new replacement cycles. Add expected corrective and preventive downtime to the denominator for calendar intensity.' }),
      p('Inspection intervals are conservative equal-tailed Bayesian posterior predictive intervals, conditional on each fixed shape and the displayed Beta prior on failure probability at the first inspection. They include count and parameter uncertainty, but do not estimate uncertainty in shape. Zero or all observed failures are supported; a finite plug-in scale is unavailable at those boundaries.', [{ id: 'scipy-beta-binomial' }]),
      p('Fleet Forecast distinguishes first failure from repeated renewals and supports ages, entry dates and retirement dates. The inspection handoff uses surviving units and a first-failure forecast; confirm the scenario before switching to repeated replacements.'),
    ], ['lifeData.overview', 'maintenance.overview']),
  topic('maintenance.inventory', 'Inventory planning',
    'Plan pooled part-number stock for a replenishment period or lifetime procurement.',
    ['Installed quantities and rates from a current Prediction scenario, or manual rows', 'Service target, existing depot stock and unit cost', 'Demand model and, where relevant, repairs, return times and cohort dates'], [
      list(['Load a calculated installed BOM to retain part identities and quantity rollups; imported rates already include their prediction duty.', 'Choose a service target for each part number or all part numbers together.', 'Select Poisson, overdispersed counts or Weibull renewal demand as justified by the application.', 'Review stock, purchases, cost and joint protection; export the plan with project provenance.']),
      example('A Poisson stock calculation', 'A part has mean demand one during the protected period and no existing depot stock.',
        ['For stock three, evaluate P(D≤3) for D~Poisson(1).', 'Compare with a 95% per-part service target.'],
        'Three spares give approximately 98.10% protection; two give 91.97%, so three is the smallest stock meeting 95%.'),
    ], [
      p('Per-part protection and joint protection are different objectives. Independent demand permits multiplication of service probabilities; unspecified dependence uses a conservative union bound. Minimum purchase cost searches an explicit bounded stock range for analytic demand.'),
      p('Lifetime simulation includes the entered cohort schedule, repair success, return pipeline and storage deterioration. Its reported Monte Carlo intervals quantify simulation precision conditional on supplied inputs. They do not cover uncertainty in failure models or operating forecasts.', [{ id: 'mil-hdbk-338b' }]),
      p('Refresh linked BOM rates when the source scenario changes, or deliberately detach a manual snapshot. Quantities are installed system totals; avoid applying hierarchy multipliers or duty factors twice.'),
    ], ['prediction.overview', 'maintenance.lifetime-tools']),
  topic('alt.field-mtbf', 'Aggregate field MTBF',
    'Estimate constant-rate MTBF from failures and aggregate exposure using the declared stopping design.',
    ['Failures, exposure or units × duration × duty', 'Fixed exposure or predeclared failure termination', 'Confidence level and one- or two-sided limits'], [
      p('Use fixed exposure for a homogeneous Poisson process, including repairable operation or replacement testing. Use failure termination only when the positive failure count was fixed before the test.', [{ id: 'nist-exponential-confidence' }]),
      example('Aggregate exposure', 'Ten units each contribute 100 operating hours and together have two failures.',
        ['Total exposure is 1,000 hours.', 'Divide exposure by the two failures.'], 'The MTBF point estimate is 500 hours; interval endpoints additionally depend on confidence level and stopping design.'),
    ], [
      p('Zero failures give rate estimate zero and no finite MTBF estimate or upper MTBF endpoint. A finite lower MTBF bound is still available. Rate endpoints reverse under reciprocation.'),
      p('A finite nonreplacement, time-truncated lifetime sample is not automatically an exact Poisson experiment. Retain the censoring information for Life Data analysis.'),
    ], ['alt.overview', 'lifeData.overview']),
  topic('alt.normal-summary', 'Normal summary inference',
    'Calculate intervals for a Normal mean from sample size, mean and standard deviation.',
    ['Sample size and sample mean', 'Sample standard deviation or known population sigma', 'Confidence level and sidedness'], [
      p('Choose sample standard deviation when it was estimated from the observations using the n−1 denominator. This uses Student t at every sample size.', [{ id: 'nist-eda-handbook' }]),
      example('Mean interval', 'Ten independent Normal observations have mean 100 and sample standard deviation 10.',
        ['Standard error is 10/√10.', 'Use the 97.5th percentile of t with 9 degrees of freedom for a two-sided 95% interval.'],
        'The mean interval is approximately 92.846 to 107.154.'),
    ], [
      p('Known population sigma uses the Normal pivot. These intervals describe a population mean, not a range containing 95% of individual lifetimes.'),
      p('The summary formulas require independent complete Normal observations. Censored lifetime summaries do not supply the same sufficient information.'),
    ], ['alt.overview', 'hypothesis.overview']),
  topic('alt.discrete-probability', 'Discrete probability and acceptance',
    'Evaluate exact binomial or finite-lot hypergeometric event probabilities and acceptance curves.',
    ['Binomial trials and defect probability, or lot size and integer defects', 'Event type and cutoff or interval', 'Acceptance count and quality risk points'], [
      p('Use binomial trials for independent outcomes with one defect probability. Use hypergeometric sampling for uniform draws without replacement from a finite lot.'),
      example('Acceptance probability', 'Inspect 10 independent units with defect probability 0.1 and accept at most one defect.',
        ['Sum the probabilities of zero and one defect.', 'Use the same acceptance count when drawing the operating characteristic.'],
        'The acceptance probability is 0.73609893.'),
    ], [
      p('Acceptance means D≤c and remains separate from the currently selected event probability. Inclusive interval endpoints are integer counts. Upper tails are evaluated directly to preserve small probabilities.', [{ id: 'nist-proportion-ci' }]),
      p('Finite-lot risk points report realized integer defect fractions. A sampled display table does not approximate the full-distribution event calculation.'),
    ], ['alt.one-proportion', 'alt.sequential']),
  topic('alt.sequential', 'Executed sequential tests',
    'Evaluate observed Bernoulli or exponential likelihood-ratio paths and the operating characteristics of a declared stopping rule.',
    ['Good and bad hypotheses', 'Producer and consumer risks', 'Observed sequence or failure exposures, horizon and terminal rule'], [
      p('Supply observations in order. The first boundary crossing stops the path; observations after that stop are reported as ignored.'),
      example('A Bernoulli path', 'Good defect probability is 0.1, bad probability is 0.2, and both risks are 0.05.',
        ['Each defect multiplies the bad/good likelihood ratio by two.', 'After two defects the ratio is four; the reject boundary is 19.'],
        'Continue sampling after those two observations if the declared horizon has not been reached.'),
    ], [
      p('At the horizon, an inconclusive outcome and a forced likelihood decision are different rules and have different achieved risks. Bernoulli OC and expected sample size use exact recursion; exponential OC uses seeded simulation with Monte Carlo uncertainty.'),
      p('Exponential acceptance can occur during event-free exposure. Nominal boundary risks are design inputs, not guarantees that the truncated procedure achieves those risks exactly.'),
    ], ['alt.sprt', 'alt.field-mtbf']),
  topic('systemModeling.lifecycle', 'System lifecycle calculations',
    'Extend a system model from mission survival to lifetime, replacement counts and operating availability under explicit repair assumptions.',
    ['A valid RBD, fault tree or specified system model', 'Time grid and repair or replacement policy', 'Simulation precision settings where required'], [
      p('Select the lifecycle calculation that matches the maintenance policy. Check whether a failed component or the complete system is restored and whether restoration is as good as new.'),
      example('Independent exponential series', 'Two independent nonrepairable components in series have rates 0.001 and 0.002 per hour.',
        ['Add the rates for first system failure.', 'Take the reciprocal of the resulting exponential rate.'],
        'The first-failure system mean is 333.333 hours. Component repair and whole-system replacement create different recurrent-event processes.'),
    ], [
      p('Survival concerns the first failure. Availability includes restoration, and expected failure counts include the selected renewal or repair process. A reciprocal instantaneous hazard is not generally a lifetime mean.', [{ id: 'mil-hdbk-338b' }]),
      p('Check the stated numerical convergence and Monte Carlo precision when available. Model assumptions, common causes and source-parameter uncertainty remain separate from numerical precision.'),
    ], ['systemModeling.overview', 'maintenance.lifetime-tools']),
]
