import type { HelpBlock, HelpCitationRef, HelpTopic } from '../types'
import { equation, example, list, note, p } from '../types'

interface ExampleSpec {
  title: string
  scenario: string
  steps: string[]
  result: string
  caution?: string
}

interface TopicSpec {
  moduleId: 'hypothesis' | 'dataAnalysis' | 'sixSigma'
  leaf: string
  title: string
  summary: string
  useWhen: string[]
  inputs: string[]
  outputs: string[]
  assumptions?: string[]
  workflow: string
  interpretation: string[]
  advanced: string
  example: ExampleSpec
  exampleKind?: 'worked' | 'walkthrough'
  latex?: string
  equationExplanation?: string
  symbols?: { symbol: string; meaning: string; unit?: string }[]
  citations?: string[]
  aliases?: string[]
  keywords?: string[]
  related?: string[]
}

const citationRefs = (ids: string[] = []): HelpCitationRef[] => ids.map(id => ({ id }))

/**
 * Keep every leaf article structurally consistent: the first screen is brief,
 * while practice, interpretation, theory, and sources are progressively opened.
 */
const makeTopic = (spec: TopicSpec): HelpTopic => {
  const citations = spec.citations?.length ? spec.citations : ['nist-eda-handbook']
  const practiceBlocks: HelpBlock[] = [p(spec.workflow)]
  if (spec.latex) {
    practiceBlocks.push(equation(spec.latex, {
      explanation: spec.equationExplanation,
      symbols: spec.symbols,
      citations: citationRefs(citations),
    }))
  }
  practiceBlocks.push(example(
    spec.example.title,
    spec.example.scenario,
    spec.example.steps,
    spec.example.result,
    spec.example.caution,
  ))

  return {
    id: `${spec.moduleId}.${spec.leaf}`,
    moduleId: spec.moduleId,
    title: spec.title,
    summary: spec.summary,
    aliases: spec.aliases,
    keywords: spec.keywords,
    basics: {
      purpose: spec.summary,
      useWhen: spec.useWhen,
      inputs: spec.inputs,
      outputs: spec.outputs,
      assumptions: spec.assumptions,
    },
    sections: [
      { id: 'practice', title: 'How to use it', depth: 'practice', defaultOpen: false, blocks: practiceBlocks },
      { id: 'interpretation', title: 'Interpret the result', depth: 'interpretation', blocks: [list(spec.interpretation)] },
      { id: 'advanced', title: 'Assumptions and deeper guidance', depth: 'advanced', blocks: [note('caution', spec.advanced)] },
      {
        id: 'references', title: 'References', depth: 'references',
        blocks: [p('Method references and implementation context.', citationRefs(citations))],
      },
    ],
    related: spec.related,
    reviewed: '2026-07-17',
    exampleKind: spec.exampleKind ?? 'worked',
  }
}

// ---------------------------------------------------------------------------
// Hypothesis tests — exact keys from Hypothesis/TESTS plus selection guidance
// ---------------------------------------------------------------------------

const hypothesisSpecs: TopicSpec[] = [
  {
    moduleId: 'hypothesis', leaf: 'test_selection', title: 'Choosing a Hypothesis Test',
    summary: 'Choose a test from the question, data relationship, measurement scale, and defensible assumptions—not from the observed p-value.',
    useWhen: ['You know the engineering question but not which test matches it.'],
    inputs: ['Outcome type', 'Number of groups', 'Independent or paired observations', 'Distribution and variance considerations'],
    outputs: ['A candidate test and explicit assumption checklist'],
    workflow: 'First distinguish numeric outcomes from counts. For numeric outcomes, identify one sample, independent groups, repeated measurements, or crossed factors. Use the wizard as guidance, then verify assumptions against the study design.',
    interpretation: ['Parametric tests target means under model assumptions.', 'Rank tests target distributional or location differences and do not automatically become tests of medians.', 'A non-significant result is not proof that groups are equivalent.'],
    advanced: 'Choose the analysis before inspecting outcomes where possible. If equivalence, non-inferiority, multiplicity control, or a complex random-effects structure is the real goal, the listed tests may not answer the engineering question.',
    example: { title: 'Matched before/after measurements', scenario: 'Ten valves are measured before and after an adjustment.', steps: ['Outcome is numeric.', 'Each after-value is linked to the same valve.', 'Inspect the paired differences; use paired t when their mean model is reasonable, otherwise consider signed-rank.'], result: 'The unit of analysis is the ten within-valve differences, not two independent samples.' },
    exampleKind: 'walkthrough', related: ['hypothesis.paired_t', 'hypothesis.wilcoxon_signed_rank'],
  },
  {
    moduleId: 'hypothesis', leaf: 'one_sample_t', title: 'One-sample t-test',
    summary: 'Tests whether the population mean of one numeric sample differs from a specified value.',
    useWhen: ['Comparing a measured mean with a target or historical reference.'], inputs: ['At least two independent numeric observations', 'Null mean', 'Alternative and significance level'], outputs: ['t statistic, degrees of freedom, p-value, confidence interval, and effect size'],
    assumptions: ['Independent observations', 'Approximately normal sampling distribution of the mean; investigate outliers for small samples'],
    workflow: 'Enter the sample and null mean, choose a directional alternative only when it was justified in advance, and read the confidence interval together with the test.',
    latex: 't=\\frac{\\bar{x}-\\mu_0}{s/\\sqrt{n}},\\qquad df=n-1', equationExplanation: 'The discrepancy from the null mean is scaled by its estimated standard error.',
    symbols: [{ symbol: '\\bar{x}', meaning: 'sample mean' }, { symbol: '\\mu_0', meaning: 'null mean' }, { symbol: 's', meaning: 'sample standard deviation' }, { symbol: 'n', meaning: 'sample size' }],
    interpretation: ['The confidence interval shows effect sizes compatible with the data.', 'Statistical significance does not establish practical importance.', 'A large p-value can reflect low precision.'],
    advanced: 'With small, strongly skewed samples or influential outliers, the t reference distribution may be unreliable. Do not silently discard observations; investigate their cause and report sensitivity.',
    example: { title: 'Mean versus target', scenario: 'Measurements 9, 10, and 11 are tested against μ₀ = 9.', steps: ['Mean = 10 and s = 1.', 'SE = 1/√3 = 0.577.', 't = 1.732 with 2 df.'], result: 'The two-sided p-value is about 0.225: this tiny sample does not establish a mean different from 9.' },
  },
  {
    moduleId: 'hypothesis', leaf: 'two_sample_t', title: 'Two-sample t-test', aliases: ['Welch t-test'],
    summary: 'Compares the means of two independent numeric groups; Welch’s unequal-variance form is the default.',
    useWhen: ['Two unrelated groups have a numeric outcome.'], inputs: ['Two independent samples', 'Alternative, confidence, and optional equal-variance choice'], outputs: ['Mean difference, t statistic, degrees of freedom, p-value, confidence interval, and effect size'],
    assumptions: ['Independent observations within and between groups', 'Means are adequately represented by the sampling model'],
    workflow: 'Keep Welch’s form unless a common-variance model is substantively justified. Compare the estimated difference and interval, not only the decision at α.',
    latex: 't=\\frac{\\bar{x}_A-\\bar{x}_B}{\\sqrt{s_A^2/n_A+s_B^2/n_B}}',
    interpretation: ['The sign follows Group A minus Group B.', 'An interval spanning zero is compatible with no mean difference.', 'Unequal sample sizes make variance and outlier diagnostics especially important.'],
    advanced: 'Selecting the pooled-variance option because a preliminary variance test is non-significant creates an unstable two-stage procedure. Welch’s method is generally the safer default.',
    example: { title: 'Independent group means', scenario: 'Group A is 8, 9, 10; Group B is 4, 5, 6.', steps: ['Means are 9 and 5; both sample SDs are 1.', 'Welch SE = √(1/3 + 1/3) = 0.816.', 't = 4.899 with 4 df.'], result: 'The two-sided p-value is about 0.008; the estimated mean difference is 4.' },
  },
  {
    moduleId: 'hypothesis', leaf: 'paired_t', title: 'Paired t-test',
    summary: 'Tests whether the mean within-pair difference is zero.',
    useWhen: ['Before/after readings or deliberately matched units.'], inputs: ['Two equal-length, correctly aligned numeric columns'], outputs: ['Mean and SD of differences, t statistic, p-value, confidence interval, and effect size'],
    assumptions: ['Pairs are independent of other pairs', 'Within-pair differences—not raw columns—have a suitable mean model'],
    workflow: 'Verify row alignment, define the subtraction direction, and inspect the distribution of paired differences before testing.',
    latex: 't=\\frac{\\bar{d}}{s_d/\\sqrt{n}}', symbols: [{ symbol: 'd', meaning: 'first value minus second value within each pair' }],
    interpretation: ['The estimate is the average paired change.', 'Pairing removes between-unit variation only when the links are real and correct.', 'Reversing column order reverses the effect sign, not the two-sided p-value.'],
    advanced: 'Missing one member of a pair removes that pair. Treating repeated measurements as independent understates uncertainty and answers a different question.',
    example: { title: 'Before-minus-after change', scenario: 'Pairs are (10,8), (12,11), and (9,7).', steps: ['Differences are 2, 1, 2.', 'Mean difference = 1.667; SD = 0.577.', 't = 5.00 with 2 df.'], result: 'The two-sided p-value is about 0.038; the estimated first-minus-second change is 1.67.' },
    related: ['hypothesis.wilcoxon_signed_rank'],
  },
  {
    moduleId: 'hypothesis', leaf: 'mann_whitney', title: 'Mann–Whitney U', aliases: ['Wilcoxon rank-sum'],
    summary: 'Compares the rank distributions of two independent groups.',
    useWhen: ['Two independent ordinal or numeric groups where a mean-based model is unsuitable.'], inputs: ['Two independent samples', 'Alternative and significance level'], outputs: ['U statistic, p-value, and direction/effect summary'],
    assumptions: ['Independent observations', 'A pure location-shift interpretation needs similarly shaped distributions'],
    workflow: 'Enter independent groups and interpret the statistic as a probability/rank comparison unless distribution shapes support a location-shift statement.',
    latex: 'U_A=R_A-\\frac{n_A(n_A+1)}{2}', symbols: [{ symbol: 'R_A', meaning: 'sum of pooled ranks for Group A' }],
    interpretation: ['A significant result indicates differing distributions, not automatically differing medians.', 'The reported direction is defined relative to Group A.', 'Ties and small samples affect the reference calculation.'],
    advanced: 'Rank methods do not repair dependent sampling or confounding. If spread or shape differs, report plots and avoid reducing the result to a median comparison.',
    example: { title: 'Separated ranks', scenario: 'Group A is 5, 6, 7; Group B is 1, 2, 3.', steps: ['All A observations rank above all B observations.', 'R_A = 15 and U_A = 9.', 'For nA = nB = 3, the exact two-sided p-value is 0.10.'], result: 'The ordering is complete, but six observations still provide weak two-sided evidence.' },
  },
  {
    moduleId: 'hypothesis', leaf: 'wilcoxon_signed_rank', title: 'Wilcoxon Signed-Rank',
    summary: 'Tests paired differences using their signs and ranks.',
    useWhen: ['Paired numeric or ordinal changes are unsuitable for a paired-mean test.'], inputs: ['Two aligned, equal-length samples'], outputs: ['Wilcoxon test statistic and p-value'],
    assumptions: ['Independent pairs', 'A symmetric difference distribution is needed for the usual location-shift interpretation'],
    workflow: 'Compute differences in the intended direction, check zeros and symmetry, then use signed ranks to test a central shift.',
    latex: 'W^+=\\sum_{d_i>0}r_i,\\qquad W^-=\\sum_{d_i<0}r_i',
    interpretation: ['The test uses magnitude ranks as well as signs.', 'The displayed two-sided statistic does not by itself encode effect direction; inspect and report the paired differences.', 'Zero differences and ties reduce effective information.'],
    advanced: 'This is not merely a nonparametric paired t-test: it targets a signed-rank symmetry model. For highly asymmetric changes, a sign test or interval method may better match the question.',
    example: { title: 'Three positive changes', scenario: 'Paired differences are 1, 2, and 3.', steps: ['Positive ranks sum to 6; negative ranks sum to 0.', 'The smaller rank sum is 0.', 'The exact two-sided p-value is 0.25.'], result: 'All changes have the same sign, but three pairs are insufficient for significance at 0.05.' },
    related: ['hypothesis.paired_t'],
  },
  {
    moduleId: 'hypothesis', leaf: 'kruskal_wallis', title: 'Kruskal–Wallis H',
    summary: 'Extends rank-based independent-group comparison to three or more groups.',
    useWhen: ['Comparing multiple independent groups without a defensible normal equal-variance mean model.'], inputs: ['Two or more independent groups'], outputs: ['H statistic, degrees of freedom, p-value, and group summaries'],
    assumptions: ['Independent observations', 'Similar shapes are needed to call the result a location shift'],
    workflow: 'Run the omnibus rank test first; if it is informative, plan separate multiplicity-adjusted pairwise analyses to locate differences.',
    latex: 'H=\\frac{12}{N(N+1)}\\sum_j\\frac{R_j^2}{n_j}-3(N+1)',
    interpretation: ['The omnibus p-value says at least one rank distribution differs.', 'It does not identify which groups differ.', 'Perdura does not generate pairwise follow-ups on this screen; any external follow-up must preserve multiplicity control.'],
    advanced: 'Sparse groups, many ties, or strongly different shapes can weaken the chi-square approximation and location interpretation.',
    example: { title: 'Three ordered groups', scenario: 'Groups are (1,2), (5,6), and (9,10).', steps: ['Rank sums are 3, 7, and 11.', 'H = 4.57 with 2 df.', 'The asymptotic p-value is about 0.102.'], result: 'The groups are ordered, but two observations per group do not establish an omnibus difference.' },
  },
  {
    moduleId: 'hypothesis', leaf: 'friedman', title: 'Friedman Test',
    summary: 'Compares three or more repeated conditions using within-subject ranks.',
    useWhen: ['The same subjects or blocks are measured under each condition and a repeated-measures mean model is unsuitable.'], inputs: ['Equal-length condition columns aligned by subject/block'], outputs: ['Friedman statistic, p-value, and condition summaries'],
    assumptions: ['Blocks are independent', 'Every row links the same subject or block across conditions'],
    workflow: 'Arrange one condition per group with rows aligned by subject. Interpret the omnibus test before planning any separate pairwise follow-up.',
    latex: 'Q=\\frac{12}{nk(k+1)}\\sum_jR_j^2-3n(k+1)',
    interpretation: ['The test asks whether condition rank distributions differ after blocking.', 'It does not estimate a mean change.', 'Perdura does not generate condition-pair follow-ups on this screen; a significant omnibus result needs a separately planned multiplicity-adjusted paired comparison.'],
    advanced: 'Incomplete profiles are not interchangeable with a complete Friedman layout. A mixed model may be preferable when missingness or covariance modeling matters.',
    example: { title: 'Consistent condition ordering', scenario: 'Three subjects score conditions A=(1,2,1), B=(2,3,2), C=(3,4,3).', steps: ['Each subject ranks A < B < C.', 'Q = 6 with 2 df.', 'The chi-square p-value is about 0.050.'], result: 'The repeated ordering is just at the conventional 5% boundary; inspect effect size and design context.' },
  },
  {
    moduleId: 'hypothesis', leaf: 'one_way_anova', title: 'One-Way ANOVA',
    summary: 'Tests equality of means across independent groups for one factor and reports Tukey follow-up comparisons.',
    useWhen: ['A numeric outcome is compared across two or more independent factor levels.'], inputs: ['Independent groups', 'Significance level'], outputs: ['ANOVA decomposition, F statistic, p-value, effect size, and pairwise comparisons'],
    assumptions: ['Independent residuals', 'Adequate normal residual model', 'Comparable group variances for the implemented classical F test'],
    workflow: 'Inspect group distributions, run the omnibus F test, then use the reported pairwise comparisons only in the context of the familywise procedure.',
    latex: 'F=\\frac{MS_{between}}{MS_{within}}',
    interpretation: ['A significant F test means not all group means are equal.', 'Tukey results identify compatible pairwise differences while controlling the family.', 'Effect size and intervals matter beyond α.'],
    advanced: 'Severe heteroscedasticity, imbalance, outliers, or dependence can invalidate the classical F reference. Do not use repeated measurements as independent groups.',
    example: { title: 'Three group means', scenario: 'Groups are (1,2,3), (4,5,6), and (7,8,9).', steps: ['Group means are 2, 5, and 8.', 'MSbetween = 27 and MSwithin = 1.', 'F = 27 with df = (2,6).'], result: 'The omnibus p-value is about 0.001; pairwise intervals locate the differences.' },
    citations: ['scheffe-anova-1959'],
  },
  {
    moduleId: 'hypothesis', leaf: 'factorial_anova', title: 'Factorial ANOVA (1–3 way)',
    summary: 'Fits main effects and all interactions for one, two, or three crossed categorical factors.',
    useWhen: ['A numeric response is observed across a full crossed factorial arrangement.'], inputs: ['Response column', 'One to three factor columns', 'Significance level'], outputs: ['ANOVA table for main effects and interactions, coefficients, and partial eta-squared'],
    assumptions: ['Independent residuals', 'Appropriate linear-model residual and variance assumptions', 'Observed factor combinations support the requested effects'],
    workflow: 'Name response and factor columns, fit the full hierarchy, and interpret the highest-order supported interaction before lower-order main effects.',
    latex: 'y=\\mu+\\alpha_i+\\beta_j+(\\alpha\\beta)_{ij}+\\varepsilon',
    interpretation: ['An interaction means one factor’s effect depends on another factor level.', 'When interaction is important, isolated main-effect averages can mislead.', 'Sparse or missing cells reduce estimability.'],
    advanced: 'The implemented full-factor model is not a random-effects or repeated-measures model. Confounded, nested, or unbalanced observational data require careful design-specific reasoning.',
    example: { title: 'Two-factor interaction', scenario: 'Temperature changes mean strength by +2 at low pressure and +8 at high pressure.', steps: ['Fit temperature, pressure, and temperature×pressure.', 'Compare the interaction F test before main effects.', 'Plot cell means to expose the changing temperature effect.'], result: 'The +6 difference-of-differences is the interaction contrast; a main-effect-only explanation would hide it.' },
    citations: ['scheffe-anova-1959'], related: ['hypothesis.mixed_anova'],
  },
  {
    moduleId: 'hypothesis', leaf: 'rm_anova', title: 'Repeated-Measures ANOVA', aliases: ['RM-ANOVA'],
    summary: 'Tests a single within-subject factor while accounting for repeated observations on each subject.',
    useWhen: ['Each subject has a complete numeric profile across conditions.'], inputs: ['Subjects × conditions matrix', 'Significance level'], outputs: ['Condition F test, effect size, Mauchly diagnostic, epsilon corrections, and ANOVA table'],
    assumptions: ['Independent subjects', 'Complete aligned profiles', 'Sphericity for uncorrected multi-condition inference'],
    workflow: 'Paste one row per subject and one column per condition. Check the sphericity status and use the reported corrected inference when appropriate.',
    latex: 'F=\\frac{MS_{condition}}{MS_{condition\\times subject}}',
    interpretation: ['The condition test asks whether repeated-condition means are equal.', 'Greenhouse–Geisser or Huynh–Feldt corrections reduce degrees of freedom when sphericity is doubtful.', 'This screen does not generate pairwise condition contrasts; separately planned follow-ups require multiplicity control.'],
    advanced: 'Mauchly’s test has limited power in small samples and is undefined with only two conditions. Corrections address the F reference, not missing profiles or an incorrect subject linkage.',
    example: { title: 'Three repeated conditions', scenario: 'Four subjects each improve by roughly 2 units from condition A to B and another 2 from B to C.', steps: ['Enter four rows and three condition columns.', 'Fit the within-subject condition effect.', 'Review corrected p-values if the covariance diagnostic rejects sphericity.'], result: 'Subject baselines are separated from the consistent within-subject increase; inference is based on repeated contrasts.' },
    citations: ['mauchly-1940', 'greenhouse-geisser-1959', 'huynh-feldt-1976'], related: ['hypothesis.friedman'],
  },
  {
    moduleId: 'hypothesis', leaf: 'mixed_anova', title: 'Mixed ANOVA',
    summary: 'Analyzes one between-subject factor and one within-subject factor from complete long-format profiles.',
    useWhen: ['Groups of subjects are repeatedly measured across common conditions.'], inputs: ['Value, subject, between-factor, and within-factor columns'], outputs: ['Between, within, and interaction tests with covariance and inference diagnostics'],
    assumptions: ['Subjects belong to one between group', 'Each subject has a complete repeated profile', 'The implemented pooled REML covariance and Wald/F approximations suit the design'],
    workflow: 'Verify each subject’s group is constant and each profile contains every within level. Interpret the group×condition interaction before averaged effects.',
    latex: 'y_{gsi}=\\mu+G_g+S_{s(g)}+W_i+(GW)_{gi}+\\varepsilon_{gsi}',
    interpretation: ['The interaction asks whether change across conditions differs by group.', 'A between-group effect averages over within conditions.', 'Model warnings and covariance conditioning are part of the result.'],
    advanced: 'This workflow is not a general-purpose mixed-model builder. Incomplete profiles, extra random effects, unequal schedules, or complex covariance structures need a dedicated longitudinal model.',
    example: { title: 'Treatment-by-time change', scenario: 'Control changes from 10 to 11 while treatment changes from 10 to 15.', steps: ['Encode subject IDs, group, time, and response in long format.', 'Fit group, time, and group×time.', 'Read the interaction as (15−10)−(11−10) = 4.'], result: 'The numerical interaction contrast is 4 units; its uncertainty determines whether differential change is supported.' },
    citations: ['fitzmaurice-laird-ware-2011'], related: ['hypothesis.factorial_anova', 'hypothesis.rm_anova'],
  },
  {
    moduleId: 'hypothesis', leaf: 'chi_square_gof', title: 'Chi-Square Goodness-of-Fit',
    summary: 'Tests whether observed category counts agree with an expected categorical distribution.',
    useWhen: ['One count vector is compared with specified expected proportions or counts.'], inputs: ['Observed counts', 'Expected counts or default equal allocation'], outputs: ['Chi-square statistic, degrees of freedom, p-value, category count, and sparse-count warning'],
    assumptions: ['Independent counted units', 'Mutually exclusive categories', 'Expected counts large enough for the chi-square approximation'],
    workflow: 'Enter counts and explicit expectations when equal frequencies are not the scientific null. The screen reports the omnibus test; calculate category contributions separately if the overall result needs localization.',
    latex: '\\chi^2=\\sum_i\\frac{(O_i-E_i)^2}{E_i}',
    interpretation: ['A significant result says the full count pattern differs from expectation.', 'The screen does not display category residuals or contribution terms.', 'The test does not explain the process that caused the difference.'],
    advanced: 'Sparse expected cells make the asymptotic reference unreliable. Combine categories only when scientifically defensible, not merely to obtain significance.',
    example: { title: 'Three expected equal categories', scenario: 'Observed counts are 50, 30, 20; expected counts are 33.33 each.', steps: ['Compute contributions 8.33, 0.33, and 5.33.', 'Sum to χ² = 14.0.', 'df = 2.'], result: 'The p-value is about 0.0009, indicating strong disagreement with equal allocation.' },
  },
  {
    moduleId: 'hypothesis', leaf: 'chi_square_independence', title: 'Chi-Square Independence',
    summary: 'Tests association between two categorical variables in a contingency table.',
    useWhen: ['Rows and columns represent two categorical variables counted on independent units.'], inputs: ['Nonnegative contingency-table counts'], outputs: ['Chi-square statistic, degrees of freedom, p-value, Cramér’s V, and sparse-cell warning'],
    assumptions: ['Independent units', 'One cell per unit', 'Expected counts adequate for the asymptotic test'],
    workflow: 'Enter the table with meaningful row and column categories. The screen reports an omnibus association and effect-size summary, not cell-level expected counts or residuals.',
    latex: 'E_{ij}=\\frac{R_iC_j}{N},\\qquad V=\\sqrt{\\frac{\\chi^2}{N\\min(r-1,c-1)}}',
    interpretation: ['Significance establishes association, not causation.', 'Cramér’s V summarizes strength but not direction.', 'To localize the association, calculate and multiplicity-review expected counts or residual contributions outside this screen.'],
    advanced: 'Matched pairs, clustered counts, survey weights, and very sparse tables violate this simple contingency analysis. Consider an exact or model-based alternative.',
    example: { title: 'A 2×2 association', scenario: 'Counts are [[30,10],[10,30]].', steps: ['Row and column totals are each 40.', 'Every expected count is 20.', 'Uncorrected χ² = 20 and Cramér’s V = 0.50.'], result: 'The table shows a strong association; the exact displayed statistic can reflect the implementation’s 2×2 continuity correction.' },
  },
  {
    moduleId: 'hypothesis', leaf: 'binomial_test', title: 'Binomial Test',
    summary: 'Performs an exact test of one observed success proportion against a specified probability.',
    useWhen: ['A fixed number of independent binary trials share a null success probability.'], inputs: ['Successes', 'Trials', 'Null proportion', 'Alternative and significance level'], outputs: ['Observed proportion, exact p-value, and test decision'],
    assumptions: ['Binary outcomes', 'Independent trials', 'Common success probability under the null'],
    workflow: 'Define “success” before entering the count, choose the alternative in advance, and pair the test with an interval for plausible proportions.',
    latex: 'P(X=k)=\\binom{n}{k}p_0^k(1-p_0)^{n-k}',
    interpretation: ['The exact p-value is discrete and need not equal α at the boundary.', 'Failure to reject does not prove the null probability.', 'The effect is the observed proportion minus the null proportion.'],
    advanced: 'Overdispersion, dependence, varying exposure, or changing success probabilities invalidate the common-binomial model. A beta-binomial or regression model may be needed.',
    example: { title: 'Eight successes in ten trials', scenario: 'Test 8/10 against p₀ = 0.5, two-sided.', steps: ['Observed proportion = 0.80.', 'Sum binomial outcomes at least as unlikely as the observation.', 'Exact two-sided p = 0.1094.'], result: 'The estimate is 0.30 above the null, but ten trials do not reject p = 0.5 at α = 0.05.' },
    citations: ['nist-proportion-ci'],
  },
]

// ---------------------------------------------------------------------------
// Statistical Modeling — all 12 Descriptive views
// ---------------------------------------------------------------------------

const descriptiveSpecs: TopicSpec[] = [
  {
    moduleId: 'dataAnalysis', leaf: 'summary', title: 'Summary Statistics',
    summary: 'Summarizes center, spread, shape, quantiles, missingness, and normality diagnostics for each column.',
    useWhen: ['Beginning any data review or checking a transformed/generated column.'], inputs: ['Shared Statistical Modeling dataset'], outputs: ['Counts, mean, SD, quartiles, CV, skewness, kurtosis, and normality diagnostic'],
    assumptions: ['Rows represent the intended observational units', 'Units and missing-value meaning are known'],
    workflow: 'Start here, verify n and missingness, then compare robust summaries (median and IQR) with mean and SD before choosing a model.',
    latex: '\\bar{x}=\\frac{1}{n}\\sum_i x_i,\\qquad s=\\sqrt{\\frac{\\sum_i(x_i-\\bar{x})^2}{n-1}}',
    interpretation: ['Mean and SD are sensitive to outliers.', 'Median and IQR describe center and spread robustly.', 'CV is meaningful only with a substantively meaningful nonzero mean and ratio scale.'],
    advanced: 'A normality p-value is a diagnostic, not an automatic model selector: tiny samples have little power and large samples detect inconsequential departures.',
    example: { title: 'Five measurements', scenario: 'Values are 2, 3, 3, 4, and 8.', steps: ['Mean = 4.', 'Median = 3.', 'The upper value pulls the mean above the median.'], result: 'Report both center measures and inspect the distribution before treating 4 as typical.' },
  },
  {
    moduleId: 'dataAnalysis', leaf: 'histogram', title: 'Histogram',
    summary: 'Bins one numeric column to show its empirical shape and concentration.',
    useWhen: ['Checking modality, skew, gaps, tails, or possible data-entry errors.'], inputs: ['Numeric column', 'Optional bin count'], outputs: ['Bin edges and counts'],
    workflow: 'Select the analysis column and compare a few defensible bin widths; apparent peaks that vanish with small bin changes are weak evidence.',
    latex: 'c_j=\\sum_i I(b_j\\le x_i<b_{j+1})',
    interpretation: ['Area/count represents observations, not a fitted probability model.', 'Skew and heavy tails can undermine mean/normal assumptions.', 'Bin choice can create or hide visual structure.'],
    advanced: 'Do not infer a distribution family from a small histogram alone. Pair it with ECDF, QQ, and subject-matter limits.',
    example: { title: 'Bin sensitivity', scenario: 'Ten values cluster near 10 and two near 20.', steps: ['Plot with 4 bins.', 'Repeat with 8 bins.', 'Confirm the high pair remains isolated.'], result: 'A persistent separated pair merits source-data investigation; it is not automatically removable.' },
  },
  {
    moduleId: 'dataAnalysis', leaf: 'boxplot', title: 'Boxplot',
    summary: 'Displays median, quartiles, whiskers, and candidate outliers for a numeric column.',
    useWhen: ['Comparing robust location and spread or screening unusual values.'], inputs: ['One numeric analysis column'], outputs: ['Quartiles, IQR, whiskers, and plotted points'],
    workflow: 'Read the box as the middle 50% of data and use individual points as investigation prompts, not deletion commands.',
    latex: 'IQR=Q_3-Q_1',
    interpretation: ['The center line is the median.', 'Whiskers are display rules, not population limits.', 'A point beyond 1.5 IQR can be valid process behavior.'],
    advanced: 'Small samples produce unstable quartiles; multimodality is often hidden. Use a violin, raincloud, or raw data alongside the box.',
    example: { title: 'Candidate high outlier', scenario: 'Values are 1, 2, 2, 3, 10.', steps: ['Compute Q1, median, and Q3.', 'Compare 10 with the upper IQR fence.', 'Check the original record and process context.'], result: 'The plot flags 10 for investigation; its disposition requires evidence outside the boxplot.' },
  },
  {
    moduleId: 'dataAnalysis', leaf: 'violin', title: 'Violin Plot',
    summary: 'Mirrors a smoothed density estimate to reveal distribution shape.',
    useWhen: ['Shape and possible multimodality matter more than a compact five-number summary.'], inputs: ['Numeric column'], outputs: ['Kernel-smoothed density silhouette'],
    workflow: 'Use the silhouette to locate broad concentration, then verify features against raw points and other bandwidth-sensitive views.',
    latex: '\\hat f_h(x)=\\frac{1}{nh}\\sum_i K\\!\\left(\\frac{x-x_i}{h}\\right)',
    interpretation: ['Width represents estimated density, not uncertainty.', 'Long thin tails can be driven by a few observations.', 'Modes depend on smoothing bandwidth.'],
    advanced: 'A violin can suggest data where none were observed because the kernel smooths beyond points. It is descriptive, not a goodness-of-fit test.',
    example: { title: 'Two clusters', scenario: 'Readings cluster near 5 and 9.', steps: ['Inspect the violin for two bulges.', 'Confirm both clusters in the raw values.', 'Check whether batches or operating modes explain them.'], result: 'Two stable bulges motivate stratification; they do not by themselves prove a two-component population.' },
  },
  {
    moduleId: 'dataAnalysis', leaf: 'raincloud', title: 'Raincloud Plot',
    summary: 'Combines distribution density, a compact box summary, and individual observations.',
    useWhen: ['You want shape and actual-data context in one view.'], inputs: ['Numeric column'], outputs: ['Density, quartile summary, and jittered raw points'],
    workflow: 'Read raw points first, then use the box and density as complementary summaries of the same observations.',
    interpretation: ['Point density exposes sample size and discreteness.', 'The cloud is smoothed and bandwidth-dependent.', 'Jitter separates overlapping points but does not change their values.'],
    advanced: 'Dense samples can overplot and sparse samples can make the density unstable. Avoid using visual area as a formal probability comparison.',
    example: { title: 'Repeated measurements', scenario: 'Twelve integer scores include five repeated 7s.', steps: ['Raw points reveal the repeated value.', 'The box locates the middle half.', 'The cloud shows overall concentration.'], result: 'Together the layers distinguish true discreteness from a smooth-looking summary.' },
  },
  {
    moduleId: 'dataAnalysis', leaf: 'scatter', title: 'Scatter Matrix',
    summary: 'Shows pairwise relationships among numeric columns across the shared dataset.', aliases: ['pair plot'],
    useWhen: ['Screening predictors for form, clusters, outliers, and collinearity.'], inputs: ['Two or more numeric columns'], outputs: ['Pairwise scatter panels'],
    workflow: 'Scan for nonlinear form, changing spread, clusters, and influential points before selecting features or transformations.',
    interpretation: ['Slope-like patterns indicate association, not causation.', 'Clusters can reflect an omitted categorical factor.', 'Near-duplicate predictors can destabilize coefficient estimates.'],
    advanced: 'Multiple visual scans invite false discoveries. Confirm suspected relationships with held-out analysis and study context.',
    example: { title: 'Hidden batches', scenario: 'Pressure and output form two parallel point clouds.', steps: ['Locate the two clouds.', 'Color or stratify by batch outside this view if known.', 'Avoid fitting one intercept blindly.'], result: 'The geometry suggests a batch effect worth modeling; it is not proof of its source.' },
  },
  {
    moduleId: 'dataAnalysis', leaf: 'correlation', title: 'Correlation Matrix',
    summary: 'Quantifies pairwise linear association among numeric columns.',
    useWhen: ['Screening linear relationships and redundant predictors.'], inputs: ['Two or more numeric columns with paired complete observations'], outputs: ['Pairwise correlation coefficients and heatmap'],
    workflow: 'Use correlation with scatter plots; investigate both strong correlations and surprising near-zero values.',
    latex: 'r=\\frac{\\sum_i(x_i-\\bar{x})(y_i-\\bar{y})}{\\sqrt{\\sum_i(x_i-\\bar{x})^2\\sum_i(y_i-\\bar{y})^2}}',
    interpretation: ['r measures linear association on [−1,1].', 'Near zero does not rule out nonlinear dependence.', 'A single influential point can dominate r.'],
    advanced: 'Correlation among time-trending variables can be spurious, and pairwise deletion can make matrix entries use different rows.',
    example: { title: 'Perfect rescaling', scenario: 'x = (1,2,3) and y = (2,4,6).', steps: ['Center both columns.', 'Their standardized deviations align exactly.', 'Compute r = 1.'], result: 'The variables are perfectly linearly associated; this alone says nothing about causality.' },
  },
  {
    moduleId: 'dataAnalysis', leaf: 'qq', title: 'Normal QQ Plot', aliases: ['quantile-quantile plot'],
    summary: 'Compares ordered sample values with theoretical normal quantiles.',
    useWhen: ['Assessing whether a normal location-scale model is plausible, especially in the tails.'], inputs: ['Numeric column'], outputs: ['Ordered observations against normal reference quantiles'],
    workflow: 'Look for systematic curvature rather than demanding every point lie on the line, especially at small n.',
    latex: 'x_{(i)}\\;\\text{ versus }\\;\\Phi^{-1}\\!\\left(\\frac{i-0.5}{n}\\right)',
    interpretation: ['An approximately straight pattern supports a normal shape.', 'S-shaped curvature suggests tail mismatch.', 'Isolated endpoints can indicate outliers or heavy tails.'],
    advanced: 'A QQ plot is a diagnostic, not proof of normality. Dependence and mixtures can create patterns that require process context.',
    example: { title: 'Right-tail departure', scenario: 'Most values follow a line but the two largest bend sharply upward.', steps: ['Inspect the upper quantiles.', 'Verify the source observations.', 'Assess robust or transformed analysis.'], result: 'The upper tail is heavier than a normal model would predict for these data.' },
    citations: ['nist-ks'],
  },
  {
    moduleId: 'dataAnalysis', leaf: 'ecdf', title: 'Empirical CDF', aliases: ['ECDF'],
    summary: 'Shows the observed fraction of values at or below every threshold without binning.',
    useWhen: ['Reading empirical percentiles, threshold exceedance, or full distribution shape.'], inputs: ['Numeric column'], outputs: ['Stepwise cumulative distribution'],
    workflow: 'At a threshold x, read the vertical value as the observed fraction ≤ x; one minus that value is the empirical exceedance fraction.',
    latex: '\\hat F_n(x)=\\frac{1}{n}\\sum_{i=1}^n I(x_i\\le x)',
    interpretation: ['Every observation contributes a step of 1/n.', 'Flat regions are observed gaps.', 'The ECDF avoids histogram-bin choices.'],
    advanced: 'The raw ECDF has sampling uncertainty, especially in the tails. Do not extrapolate beyond observed values without a model.',
    example: { title: 'Threshold fraction', scenario: 'Values are 2, 4, 5, 9.', steps: ['At x = 5, three values are ≤ 5.', 'Compute F̂(5) = 3/4.', 'Exceedance fraction = 1/4.'], result: 'The empirical probability at or below 5 is 0.75.' },
    citations: ['nist-ks'],
  },
  {
    moduleId: 'dataAnalysis', leaf: 'runchart', title: 'Run Chart',
    summary: 'Plots a numeric series in row order to reveal shifts, trends, cycles, and unusual observations.',
    useWhen: ['Collection order carries process or time meaning.'], inputs: ['Numeric column in correct order'], outputs: ['Ordered series with center reference and run context'],
    workflow: 'Preserve collection order, identify known interventions, and use the plot to generate process hypotheses before applying control limits.',
    interpretation: ['Long runs on one side of center suggest a shift.', 'Trends can indicate drift.', 'A run chart does not provide SPC control limits.'],
    advanced: 'Autocorrelation and seasonality can mimic special-cause patterns. Use the SPC module when a Phase-I/Phase-II control-chart workflow is intended.',
    example: { title: 'Step change', scenario: 'The first ten values center near 20 and the next ten near 25.', steps: ['Plot in acquisition order.', 'Mark the transition time.', 'Check maintenance or material changes near that point.'], result: 'A persistent level shift is visible; causal attribution still requires process evidence.' },
    citations: ['nist-process-stability'], related: ['sixSigma.spc_i_mr'],
  },
  {
    moduleId: 'dataAnalysis', leaf: 'frequency', title: 'Frequency Table',
    summary: 'Counts distinct categories or numeric bins and reports their proportions.',
    useWhen: ['Summarizing categorical prevalence or the discrete distribution of a column.'], inputs: ['Selected column', 'Optional numeric bin count'], outputs: ['Values/bins, counts, proportions, and cumulative proportions'],
    workflow: 'Use exact categories for categorical data; only bin numeric values when the bin boundaries have a clear descriptive purpose.',
    latex: '\\hat p_j=\\frac{n_j}{N}',
    interpretation: ['Counts show sample support; proportions ease comparison.', 'Rare categories can be real and operationally important.', 'Binning loses within-bin detail.'],
    advanced: 'Percentages from small denominators are volatile. Always retain or display counts and clarify how missing values are treated.',
    example: { title: 'Defect categories', scenario: 'Counts are scratch=8, dent=2, other=0.', steps: ['Total N = 10.', 'Scratch proportion = 0.80.', 'Dent proportion = 0.20.'], result: 'The table describes this sample; uncertainty remains around population proportions.' },
    citations: ['nist-proportion-ci'],
  },
  {
    moduleId: 'dataAnalysis', leaf: 'contingency', title: 'Contingency Table',
    summary: 'Cross-tabulates two categorical columns to expose joint counts and conditional patterns.',
    useWhen: ['Exploring association between two categorical variables before formal testing.'], inputs: ['Row category column', 'Column category column'], outputs: ['Cross-tabulated counts and totals'],
    workflow: 'Compare row- or column-conditional proportions, not raw counts alone when marginal totals differ.',
    latex: '\\hat p_{j\\mid i}=\\frac{n_{ij}}{n_{i+}}',
    interpretation: ['Cell counts show the joint distribution.', 'Different marginal totals can make counts visually misleading.', 'A table is descriptive until paired with a suitable inferential design.'],
    advanced: 'Sparse cells, structural zeros, repeated observations, and sampling weights need methods beyond a simple cross-tabulation.',
    example: { title: 'Conditional defect rates', scenario: 'Line A has 5 defects in 100 units; Line B has 4 in 40.', steps: ['Raw counts are similar.', 'Rates are 5% and 10%.', 'Compare conditional proportions rather than 5 versus 4.'], result: 'Line B has the larger observed rate despite fewer defects.' },
    related: ['hypothesis.chi_square_independence'],
  },
]

// ---------------------------------------------------------------------------
// Regression & ML workflow, governance concepts, and all active candidates
// ---------------------------------------------------------------------------

const modelingConceptSpecs: TopicSpec[] = [
  {
    moduleId: 'dataAnalysis', leaf: 'regression_ml_workflow', title: 'Regression & ML Workflow',
    summary: 'Moves from prepared data through comparable nested validation, model inspection, finalization, and scoring.',
    useWhen: ['Predicting a numeric target or class label from selected features.'], inputs: ['Shared dataset', 'Target, features, task, validation structure, candidate models, and selection metric'], outputs: ['Readiness checks, out-of-sample leaderboard, diagnostics, finalized model asset, and predictions'],
    workflow: 'Prepare the data and validation structure first. Compare compatible candidates under one evaluation recipe, inspect the recommended and plausible alternatives, finalize without changing that recipe, then score rows matching the saved schema.',
    interpretation: ['Leaderboard metrics are out-of-sample estimates under the selected split structure.', 'Recommendation means best on the chosen metric, not universally best.', 'Full-sample coefficient inference is separate from predictive validation.'],
    advanced: 'Feature engineering, imputation, tuning, calibration, and threshold selection must stay inside training folds to prevent leakage. The final asset is conditional on the evaluated data and recipe.',
    example: { title: 'From dataset to asset', scenario: 'A numeric target and five predictors are available for 200 units.', steps: ['Choose regression and a split strategy matching how future units arrive.', 'Compare eligible candidates using RMSE.', 'Inspect residuals and interval width; finalize the selected recipe.', 'Score new rows with the same feature schema.'], result: 'The saved asset records the validation contract and selected parameters used for prediction.' },
    exampleKind: 'walkthrough', citations: ['sklearn-cross-validation', 'scikit-learn-user-guide'], related: ['dataAnalysis.validation', 'dataAnalysis.finalization'],
  },
  {
    moduleId: 'dataAnalysis', leaf: 'validation', title: 'Validation and Model Comparison',
    summary: 'Estimates candidate performance out of sample while tuning inside the evaluation structure.',
    useWhen: ['Comparing models or tuning parameters before finalization.'], inputs: ['Random, stratified, group, or time split structure', 'Tuning budget, seed, metric, and confidence'], outputs: ['Nested-validation leaderboard, fold results, metric intervals, diagnostics, and recommendation'],
    workflow: 'Match the split strategy to the future prediction boundary: keep related groups together and preserve order for forecasting-like tasks. Rank on one preselected metric.',
    latex: '\\widehat{R}_{CV}=\\frac{1}{K}\\sum_{k=1}^K L\\!\\left(y_k,\\hat f^{(-k)}(x_k)\\right)',
    interpretation: ['Metric intervals show evaluation uncertainty.', 'Small rank differences may not be meaningful.', 'Use secondary metrics as guardrails, not post-hoc reasons to redefine the winner.'],
    advanced: 'Random folds are optimistic when records from the same unit leak across folds or time order matters. Nested tuning is more expensive because each outer assessment contains an inner selection process.',
    example: { title: 'Grouped validation', scenario: 'Five measurements come from each of 40 devices.', steps: ['Choose device ID as the group column.', 'Keep every device wholly in one fold.', 'Compare models on predictions for unseen devices.'], result: 'The score estimates generalization to new devices rather than new rows from known devices.' },
    citations: ['sklearn-cross-validation'],
  },
  {
    moduleId: 'dataAnalysis', leaf: 'calibration', title: 'Probability Calibration',
    summary: 'Aligns classification probabilities with observed event frequencies using none, sigmoid, or isotonic calibration.',
    useWhen: ['Probability quality matters for risk, cost, or threshold decisions—not only class labels.'], inputs: ['Binary classification candidates', 'Calibration choice', 'Out-of-fold probability evidence'], outputs: ['Calibration diagnostics, Brier/log-loss context, calibration state, and probabilities'],
    workflow: 'Choose calibration before comparison, inspect reliability curves and proper scoring metrics, and retain “none” when data are too sparse to support an extra mapping.',
    latex: '\\operatorname{Brier}=\\frac{1}{n}\\sum_i(p_i-y_i)^2',
    interpretation: ['A calibrated 0.8 should correspond to about 80% positives among similar cases.', 'Calibration can improve probability meaning without improving ranking.', 'Isotonic is flexible but needs more data than sigmoid.'],
    advanced: 'Calibration must be learned without seeing the assessment labels. A visually smooth curve from few cases is not strong evidence, especially near probabilities 0 and 1.',
    example: { title: 'Overconfident classifier', scenario: 'Among 20 cases assigned about 0.8 probability, only 12 are positive.', steps: ['Observed frequency is 0.60.', 'The uncalibrated probabilities are overconfident in this region.', 'Evaluate a preselected calibration method within validation.'], result: 'Calibration seeks probability-frequency agreement; it does not guarantee causal or transportable risk.' },
    citations: ['sklearn-calibration'],
  },
  {
    moduleId: 'dataAnalysis', leaf: 'finalization', title: 'Finalizing a Model',
    summary: 'Refits an evaluated model recipe on eligible full data and packages it with schema, metrics, diagnostics, and reproducibility metadata.',
    useWhen: ['A leaderboard candidate has been evaluated and accepted for downstream scoring.'], inputs: ['Unchanged evaluation recipe', 'Selected eligible model and parameters'], outputs: ['Versioned model asset, model card, artifact or rebuild recipe, and optional ONNX export'],
    workflow: 'Select an eligible leaderboard row and finalize without altering target, features, split recipe, model parameters, calibration, or threshold policy. If any changed, rerun comparison.',
    interpretation: ['Finalization does not create a new unbiased performance estimate.', 'Saved metrics remain the out-of-sample evaluation evidence.', 'Artifact availability and parity status describe portability.'],
    advanced: 'The guard against changed parameters prevents an unevaluated fit from inheriting another recipe’s metrics. Re-evaluate after every material modeling choice change.',
    example: { title: 'Recipe mismatch', scenario: 'SVM wins with C=1 and RBF kernel, then C is changed to 10.', steps: ['The selected parameters no longer match the evaluation.', 'Finalization is refused.', 'Rerun comparison with C=10 included, then finalize its result.'], result: 'Only the evaluated recipe is eligible to inherit the reported validation evidence.' },
    exampleKind: 'walkthrough', citations: ['sklearn-cross-validation'], related: ['dataAnalysis.validation'],
  },
  {
    moduleId: 'dataAnalysis', leaf: 'prediction', title: 'Scoring and Prediction',
    summary: 'Applies a finalized model asset to new rows that satisfy its recorded feature schema.',
    useWhen: ['Generating individual or batch predictions from a finalized asset.'], inputs: ['Finalized model', 'Rows containing required features with compatible values'], outputs: ['Predictions, class probabilities when available, and prediction intervals when supported'],
    workflow: 'Load or select the asset, map each required feature, validate units and category meanings, score, then export batch results with the asset identifier.',
    interpretation: ['A prediction is conditional on the fitted model and supplied features.', 'Probabilities are meaningful only to the extent calibration and population transport hold.', 'Intervals quantify implemented uncertainty, not every source of future error.'],
    advanced: 'Schema compatibility cannot detect unit changes, sensor drift, or population shift. Monitor input distributions and realized outcomes after deployment.',
    example: { title: 'Schema-safe batch score', scenario: 'An asset expects temperature °C and pressure kPa.', steps: ['Supply both named columns.', 'Convert any °F or psi source data before scoring.', 'Retain asset ID beside predictions.'], result: 'Rows are technically and semantically aligned with the model’s training schema.' },
    exampleKind: 'walkthrough', citations: ['scikit-learn-user-guide'],
  },
]

interface ModelHelpSpec {
  leaf: string
  title: string
  summary: string
  task: string
  mechanism: string
  interpretation: string
  advanced: string
  scenario: string
  steps: string[]
  result: string
  latex?: string
  citations?: string[]
  aliases?: string[]
}

const modelHelpSpecs: ModelHelpSpec[] = [
  { leaf: 'linear', title: 'Linear (OLS)', summary: 'Fits an additive linear mean model and provides separate full-sample coefficient inference.', task: 'Numeric regression with an approximately linear conditional mean.', mechanism: 'Estimate coefficients by minimizing the sum of squared residuals.', interpretation: 'Each coefficient is an adjusted expected change per feature unit when the other included features are held fixed.', advanced: 'Residual form, variance, independence, leverage, and collinearity govern whether coefficient inference is credible.', scenario: 'For y = 2 + 3x at x = 4.', steps: ['Use intercept 2 and slope 3.', 'Compute 2 + 3×4.'], result: 'The fitted prediction is 14.', latex: '\\hat y=\\beta_0+\\sum_j\\beta_jx_j' },
  { leaf: 'ridge', title: 'Ridge (L2)', summary: 'Shrinks linear coefficients with an L2 penalty to stabilize correlated or high-dimensional fits.', task: 'Numeric regression where prediction and coefficient stability matter.', mechanism: 'Minimize squared error plus α times the sum of squared coefficients.', interpretation: 'Increasing α generally shrinks coefficients toward zero but does not perform exact feature selection.', advanced: 'Scaling is essential because the penalty acts on coefficient magnitude; α must be selected inside validation.', scenario: 'Two correlated predictors have OLS coefficients 5 and −4.', steps: ['Fit a positive α within tuning.', 'Observe both coefficients shrink while remaining nonzero.'], result: 'The ridge fit trades some training bias for potentially lower out-of-sample variance.', latex: '\\min_\\beta\\;\\lVert y-X\\beta\\rVert_2^2+\\alpha\\lVert\\beta\\rVert_2^2' },
  { leaf: 'lasso', title: 'Lasso (L1)', summary: 'Uses an L1 penalty that can set linear coefficients exactly to zero.', task: 'Numeric regression with a sparse predictive representation.', mechanism: 'Minimize squared error plus α times the absolute coefficient sum.', interpretation: 'Zero coefficients identify the support selected at that α, not proven irrelevant variables.', advanced: 'Correlated features can exchange selection across samples. The optional complementary-pairs stability selector is separate from the displayed full-sample α fit and does not produce post-selection confidence intervals.', scenario: 'Five standardized predictors include one strong signal.', steps: ['Tune α within validation.', 'Inspect nonzero coefficients.', 'If enabled, compare with the separate stability-support output.'], result: 'A sparse candidate can predict well, but support uncertainty remains.', latex: '\\min_\\beta\\;\\lVert y-X\\beta\\rVert_2^2+\\alpha\\lVert\\beta\\rVert_1', citations: ['sklearn-lasso'] },
  { leaf: 'elastic_net', title: 'Elastic Net (L1+L2)', summary: 'Combines sparse L1 selection with stabilizing L2 shrinkage.', task: 'Numeric regression with correlated predictors and a desired sparse fit.', mechanism: 'Mix L1 and L2 penalties using the L1 ratio.', interpretation: 'L1 ratio 1 approaches lasso; ratio 0 approaches ridge and disables sparse stability selection.', advanced: 'Both α and mixing ratio affect the selected support and must be validated. Sparse-support statements remain conditional on the selection process.', scenario: 'A pair of correlated sensors measures the same signal.', steps: ['Tune α and L1 ratio.', 'Compare validation error and selected coefficients.', 'Check support stability if using a positive L1 ratio.'], result: 'Elastic Net may retain grouped correlated signals more stably than pure lasso.', latex: '\\min_\\beta\\;\\lVert y-X\\beta\\rVert_2^2+\\alpha[\\rho\\lVert\\beta\\rVert_1+(1-\\rho)\\lVert\\beta\\rVert_2^2]' },
  { leaf: 'polynomial', title: 'Polynomial Regression', summary: 'Fits a curved polynomial relationship for one numeric predictor.', task: 'Single-predictor numeric regression with smooth curvature.', mechanism: 'Expand x into powers through the chosen degree and fit the resulting linear coefficients.', interpretation: 'The fitted curve, not an isolated high-order coefficient, is usually the meaningful object.', advanced: 'High degrees extrapolate erratically and can fit noise. Choose degree inside validation and avoid predictions far outside observed x.', scenario: 'Fit y = 1 + 2x + x² and score x = 3.', steps: ['Compute x² = 9.', 'Evaluate 1 + 6 + 9.'], result: 'The curve predicts 16.', latex: '\\hat y=\\beta_0+\\beta_1x+\\cdots+\\beta_dx^d' },
  { leaf: 'logistic', title: 'Logistic Regression', summary: 'Models a binary class probability through an additive log-odds relationship.', task: 'Binary classification with numeric predictors and interpretable odds ratios.', mechanism: 'Fit coefficients so the logistic transform maps linear scores to probabilities.', interpretation: 'exp(βj) is the conditional odds multiplier for a one-unit feature increase.', advanced: 'Separation, nonlinear effects, interactions, class imbalance, and calibration can make naïve odds-ratio interpretation unreliable.', scenario: 'An intercept-only model has β₀ = 0.', steps: ['Compute exp(0)=1.', 'Convert odds 1 to probability 1/(1+1).'], result: 'The predicted positive probability is 0.5.', latex: 'P(Y=1\\mid x)=\\frac{1}{1+e^{-(\\beta_0+x^T\\beta)}}' },
  { leaf: 'decision_tree', title: 'Decision Tree', summary: 'Fits a single CART tree using recursive feature splits.', task: 'Regression or classification needing a readable nonlinear rule structure.', mechanism: 'Choose splits that improve node purity or squared-error fit.', interpretation: 'A prediction follows one root-to-leaf path; importance summarizes split usage, not causal influence.', advanced: 'Unlimited depth can overfit and trees are unstable to small data changes. Validate depth and inspect leaf sample support.', scenario: 'A tree splits temperature at 80 °C.', steps: ['A row at 90 follows the high branch.', 'A pressure split then selects its terminal leaf.'], result: 'The leaf estimate becomes the prediction for rows following that rule path.' },
  { leaf: 'random_forest', title: 'Random Forest', summary: 'Averages many bootstrapped, feature-randomized trees.', task: 'General-purpose nonlinear regression or classification on tabular data.', mechanism: 'Decorrelate trees through row and feature sampling, then average or vote.', interpretation: 'Permutation importance measures predictive dependence under the evaluated data, not mechanism or causality.', advanced: 'Forests can obscure extrapolation, correlated-feature importance, and minority-class errors. Evaluate task-specific metrics and calibration.', scenario: 'Three regression trees predict 8, 10, and 12.', steps: ['Average their predictions.', 'Compute (8+10+12)/3.'], result: 'The forest prediction is 10.' },
  { leaf: 'gradient_boosting', title: 'Gradient Boosting', summary: 'Builds a sequence of trees that corrects earlier residual or loss errors.', task: 'High-accuracy nonlinear regression or classification on tabular data.', mechanism: 'Add weak trees stage by stage in the negative-loss-gradient direction.', interpretation: 'Stages and learning behavior jointly control fit complexity; importance remains predictive rather than causal.', advanced: 'Too many aggressive stages overfit. Tuning and all preprocessing must remain inside validation folds.', scenario: 'The initial prediction is 10 and a new stage contributes +1.5.', steps: ['Start from 10.', 'Add the stage correction.'], result: 'The updated prediction is 11.5.', latex: 'F_m(x)=F_{m-1}(x)+\\eta h_m(x)' },
  { leaf: 'hist_gradient_boosting', title: 'Histogram Gradient Boosting', summary: 'Uses binned feature values to fit regularized boosted trees efficiently.', task: 'Medium-to-large tabular regression or classification problems.', mechanism: 'Bin continuous features, then build sequential loss-reducing trees from histogram summaries.', interpretation: 'Predictions have the same boosted additive form, while binning changes speed and split granularity.', advanced: 'Efficiency does not remove tuning, leakage, calibration, or extrapolation concerns. Fine distinctions inside a bin are unavailable to a split.', scenario: 'Temperatures 70.1–70.9 share one learned bin.', steps: ['Map each value to the same bin.', 'Apply the same candidate split behavior within that bin.'], result: 'Histogram binning speeds training while limiting split resolution.' },
  { leaf: 'adaboost', title: 'AdaBoost', summary: 'Sequentially emphasizes observations poorly handled by previous weak learners.', task: 'Regression or classification where a weighted weak-learner ensemble is suitable.', mechanism: 'Increase influence of difficult cases and combine learners by their fitted weights.', interpretation: 'Later learners concentrate on prior errors; this can expose hard structure or chase noise.', advanced: 'Mislabeled points and outliers can receive excessive influence. Compare robust alternatives and inspect fold diagnostics.', scenario: 'A misclassified case receives increased weight.', steps: ['Fit the first weak learner.', 'Upweight its error.', 'Fit the next learner to the revised weights.'], result: 'The ensemble spends more capacity on the previously missed case.' },
  { leaf: 'chaid', title: 'CHAID', summary: 'Builds a multiway classification tree from chi-square category associations.', task: 'Classification where categorical multi-branch segmentation is useful.', mechanism: 'Merge statistically similar categories and split using chi-square evidence.', interpretation: 'Branches describe conditional class patterns within the fitted tree, not causal segments.', advanced: 'Repeated testing, sparse categories, and unstable merges make validation essential. In Perdura, CHAID is classification-only.', scenario: 'Three material categories have different failure-class proportions.', steps: ['Test category association with the target.', 'Merge statistically similar material levels.', 'Create a multiway split for distinct groups.'], result: 'Each resulting branch predicts from its observed class mix.' },
  { leaf: 'svm', title: 'Support Vector Machine', aliases: ['SVM', 'SVR', 'SVC'], summary: 'Fits a maximum-margin predictor, optionally in a nonlinear kernel space.', task: 'Scaled regression or classification with complex boundaries.', mechanism: 'Balance margin width and training violations using C and the selected kernel.', interpretation: 'C controls violation penalty; kernel choice controls the representable boundary.', advanced: 'Scaling is mandatory for meaningful distances and kernels. Probability outputs require separate calibration and large datasets can be costly.', scenario: 'Two classes are separated by a line with a wide empty band.', steps: ['Locate the closest observations from each class.', 'Place the boundary halfway between supporting margins.'], result: 'The support vectors determine the fitted maximum-margin separator.', latex: '\\min_{w,b}\\;\\frac12\\lVert w\\rVert^2+C\\sum_i\\xi_i' },
  { leaf: 'knn', title: 'k-Nearest Neighbors', aliases: ['KNN'], summary: 'Predicts from the outcomes of nearby training observations.', task: 'Regression or classification with locally similar cases and a meaningful distance.', mechanism: 'Find the k nearest scaled feature vectors and average or vote.', interpretation: 'Small k is flexible and noisy; large k smooths across broader neighborhoods.', advanced: 'Distance degrades with irrelevant dimensions, extrapolation, mixed scales, and sparse regions. Tune k inside validation.', scenario: 'The three nearest regression outcomes are 9, 10, and 14.', steps: ['Choose k=3.', 'Average the neighboring outcomes.'], result: 'The KNN prediction is 11.' },
  { leaf: 'mlp', title: 'MLP Neural Network', aliases: ['multilayer perceptron', 'neural net'], summary: 'Fits a feed-forward nonlinear network with one or more hidden layers.', task: 'Regression or classification with sufficient data for flexible nonlinear interactions.', mechanism: 'Compose weighted affine layers and nonlinear activations, optimized iteratively.', interpretation: 'Predictive diagnostics and permutation effects are usually more useful than individual weights.', advanced: 'MLPs are scale-sensitive, stochastic, data-hungry, and can fail to converge. Validate architecture and heed convergence warnings.', scenario: 'A one-unit hidden activation has weight 2 and output bias 1.', steps: ['Multiply activation 1 by weight 2.', 'Add output bias 1.'], result: 'That simplified output node produces 3 before any task-specific output transform.', latex: 'h=\\phi(W_1x+b_1),\\qquad \\hat y=g(W_2h+b_2)' },
]

const modelTopics: HelpTopic[] = modelHelpSpecs.map(model => makeTopic({
  moduleId: 'dataAnalysis', leaf: model.leaf, title: model.title, summary: model.summary,
  aliases: model.aliases, useWhen: [model.task],
  inputs: ['Selected target and compatible features', 'Model parameters evaluated under the current validation recipe'],
  outputs: ['Out-of-sample metrics, diagnostics, selected parameters, explanations, and finalization eligibility'],
  assumptions: ['Training examples represent the intended prediction task', 'Validation boundaries prevent leakage'],
  workflow: `${model.mechanism} Compare this candidate under the same validation recipe and selection metric as every other eligible model.`,
  latex: model.latex,
  interpretation: [model.interpretation, 'Inspect uncertainty, fold consistency, and diagnostics before accepting a leaderboard rank.'],
  advanced: model.advanced,
  example: { title: `${model.title} illustration`, scenario: model.scenario, steps: model.steps, result: model.result },
  citations: model.citations ?? ['scikit-learn-user-guide'],
  related: ['dataAnalysis.validation', 'dataAnalysis.finalization'],
}))

// ---------------------------------------------------------------------------
// Six Sigma — capability, MSA, all SPC charts, and all DOE designs/workflows
// ---------------------------------------------------------------------------

const sixSigmaCoreSpecs: TopicSpec[] = [
  {
    moduleId: 'sixSigma', leaf: 'capability', title: 'Process Capability',
    summary: 'Compares stable-process variation and location with engineering specification limits using within and overall estimates.',
    useWhen: ['A measurement process and specification limits are defined and process stability can be assessed.'],
    inputs: ['Ordered measurements', 'At least one specification limit', 'Optional target', 'Rational subgroup size', 'Stability status and bootstrap count'],
    outputs: ['Cp/Cpk, Pp/Ppk, Cpm, ppm/Z estimates, stability decision, normality diagnostic, and non-normal sensitivity results'],
    assumptions: ['Specification limits are engineering requirements, not estimated control limits', 'Capability decisions require demonstrated stability', 'Normal-model indices need a defensible distribution model'],
    workflow: 'Preserve collection order, supply rational subgroup size, and assess stability first. Read Cp/Cpk from within variation and Pp/Ppk from overall variation; use non-normal sensitivity when the normal model is challenged.',
    latex: 'C_p=\\frac{USL-LSL}{6\\sigma_w},\\qquad C_{pk}=\\min\\!\\left(\\frac{USL-\\bar{x}}{3\\sigma_w},\\frac{\\bar{x}-LSL}{3\\sigma_w}\\right)',
    interpretation: ['Cp describes potential spread fit; Cpk also reflects off-centering.', 'Pp/Ppk use overall sample variation and describe observed long-term performance.', 'Perdura withholds a decision-grade conclusion when stability is not demonstrated.'],
    advanced: 'Capability is conditional on process state, measurement-system adequacy, distribution model, and rational subgrouping. A large index cannot compensate for an unstable process or wrong specification.',
    example: { title: 'Centered capable process', scenario: 'LSL=9, USL=11, mean=10, and within σ=0.25.', steps: ['Tolerance width = 2.', '6σ = 1.5, so Cp = 1.333.', 'Both one-sided distances are 1, so Cpk = 1/0.75 = 1.333.'], result: 'The centered within-model indices are 1.33, subject to stability and distribution diagnostics.' },
    citations: ['nist-process-stability'], related: ['sixSigma.spc', 'sixSigma.msa'],
  },
  {
    moduleId: 'sixSigma', leaf: 'msa_anova', title: 'Gage R&R — ANOVA',
    summary: 'Uses a balanced crossed random-effects ANOVA to separate part, operator, interaction, and repeatability variation.',
    useWhen: ['Every operator measures every part with equal replication.'],
    inputs: ['Part, operator, trial, and measurement columns', 'Tolerance and study-variation multiplier when applicable'],
    outputs: ['ANOVA table, variance components, study variation, %GRR, ndc, and plots'],
    assumptions: ['Complete balanced crossed design', 'Independent residual measurement errors', 'Parts span the intended process range'],
    workflow: 'Confirm crossed balance before running. Inspect the part×operator interaction before collapsing components and judge %GRR together with tolerance use and number of distinct categories.',
    latex: 'Y_{ijk}=\\mu+P_i+O_j+(PO)_{ij}+\\varepsilon_{ijk}',
    interpretation: ['Repeatability is within-cell equipment variation.', 'Reproducibility includes operator and retained interaction components.', 'Large part-to-part variation is desirable for discrimination but does not make the gage accurate.'],
    advanced: 'Negative method-of-moments components are constrained for reporting and signal limited information. Use REML for incomplete, unequal, or nested studies.',
    example: { title: 'Variance-component rollup', scenario: 'Repeatability SD=0.20, operator SD=0.10, and interaction SD=0.05.', steps: ['Square and sum: 0.04+0.01+0.0025=0.0525.', 'Take the square root.', 'GRR SD=0.229.'], result: 'Compare 6×0.229 with tolerance and total study variation; do not add SDs directly.' },
    citations: ['nist-gage-rr', 'nist-variance-components'], related: ['sixSigma.msa_reml', 'sixSigma.msa_crossed'],
  },
  {
    moduleId: 'sixSigma', leaf: 'msa_xbar_r', title: 'Gage R&R — Average & Range (Xbar-R)',
    summary: 'Estimates repeatability and reproducibility from cell ranges and operator averages in a balanced crossed study.',
    useWhen: ['A classical balanced crossed study needs the compact average-and-range method.'],
    inputs: ['Complete crossed part/operator/trial measurements'], outputs: ['Range-based variance estimates, %GRR, ndc, control summaries, and Xbar-R details'],
    assumptions: ['Balanced crossed layout', 'Adequate repeated trials per cell', 'Range constants match subgroup size'],
    workflow: 'Use only for complete crossed data. Review ranges for repeatability, then operator-average differences for reproducibility.',
    latex: '\\hat\\sigma_e=\\frac{\\bar R}{d_2}',
    interpretation: ['Rbar estimates short-term equipment spread.', 'The Xbar signal can show whether part differences dominate measurement noise.', 'Range estimates are less statistically efficient than ANOVA/REML with richer data.'],
    advanced: 'Xbar-R cannot represent incomplete cells or a nested topology and gives less direct interaction modeling. Prefer ANOVA or REML when design structure warrants it.',
    example: { title: 'Two-trial repeatability', scenario: 'Average within-cell range is 0.40 with two trials, where d₂≈1.128.', steps: ['Divide 0.40 by 1.128.', 'Estimated repeatability SD≈0.355.'], result: 'Study variation from repeatability alone is 6×0.355≈2.13 when the multiplier is 6.' },
    citations: ['nist-gage-rr'], related: ['sixSigma.msa_anova'],
  },
  {
    moduleId: 'sixSigma', leaf: 'msa_reml', title: 'Gage R&R — REML Variance Components', aliases: ['restricted maximum likelihood'],
    summary: 'Estimates measurement-system variance components for unbalanced, incomplete crossed, or nested studies with optimizer diagnostics and intervals.',
    useWhen: ['Replication is unequal, some crossed cells are absent, or parts are nested within operators.'],
    inputs: ['Part, operator, trial, measurement, and crossed/nested topology'], outputs: ['REML components, raw/constrained estimates, optimizer status, intervals, %GRR, ndc, and design diagnostics'],
    assumptions: ['Specified random-effects topology matches sampling', 'Independent modeled random effects and residuals', 'Sufficient replication identifies requested components'],
    workflow: 'Declare crossed or nested topology before fitting. Require optimizer convergence, review component intervals/boundaries, and treat weakly identified components cautiously.',
    latex: '\\ell_R(\\theta)=-\\frac12[\\log|V|+\\log|X^TV^{-1}X|+y^TPy]+C',
    interpretation: ['REML accounts for fixed-effect estimation when fitting variance components.', 'A boundary estimate near zero may mean a small component or weak information.', 'Multiple successful starts strengthen—but do not prove—optimizer reliability.'],
    advanced: 'REML does not rescue a design with no replication for a component. Results depend on the random-effects and covariance specification; inspect topology and estimability diagnostics.',
    example: { title: 'Incomplete crossed study', scenario: 'Three operators measure most, but not all, of the same ten parts with unequal replicate counts.', steps: ['Select crossed topology and REML.', 'Verify cells and replication in design diagnostics.', 'Require converged starts and inspect component intervals.'], result: 'REML uses the available unbalanced observations without pretending the classical balanced ANOVA formulas apply.' },
    citations: ['nist-variance-components', 'nist-gage-rr'], related: ['sixSigma.msa_crossed', 'sixSigma.msa_nested'],
  },
  {
    moduleId: 'sixSigma', leaf: 'msa_crossed', title: 'Crossed Gage R&R Design',
    summary: 'A design in which the same parts are measured by multiple operators, enabling operator and part×operator separation.',
    useWhen: ['Parts can be measured repeatedly and circulated among operators.'], inputs: ['Shared part IDs across operators', 'Repeated trials'], outputs: ['A study topology suitable for ANOVA, Xbar-R, or REML depending on balance'],
    workflow: 'Sample parts across the operating range, randomize measurement order where practical, blind previous readings, and have every operator measure the same part set.',
    interpretation: ['Crossing identifies whether operators respond differently to the same parts.', 'Balanced complete crossing enables all three implemented methods.', 'Shared part IDs must truly refer to the same physical units.'],
    advanced: 'Time drift, destructive measurement, learning, and non-random part selection can confound operator or repeatability components.',
    example: { title: 'Balanced crossed plan', scenario: '10 parts, 3 operators, and 2 trials.', steps: ['Every operator measures all 10 parts twice.', 'Total observations = 10×3×2.', 'Randomize the 60 measurement events.'], result: 'The 60-row design supports classical crossed ANOVA and Xbar-R as well as REML.' },
    exampleKind: 'walkthrough', citations: ['nist-gage-rr'], related: ['sixSigma.msa_anova', 'sixSigma.msa_xbar_r'],
  },
  {
    moduleId: 'sixSigma', leaf: 'msa_nested', title: 'Nested Gage R&R Design',
    summary: 'A design in which each operator measures a different part set, so parts are nested within operator.',
    useWhen: ['Measurement is destructive or the same physical part cannot be shared.'], inputs: ['Operator-specific part IDs and repeated trials', 'Nested topology'], outputs: ['A REML variance-component analysis appropriate to parts-within-operator'],
    workflow: 'Ensure each nested part has repeats within its operator, select Nested topology, and use REML; ANOVA and Xbar-R are intentionally unavailable for this layout.',
    interpretation: ['Part and operator differences are less separable than in a crossed study.', 'Comparable part sampling across operators is crucial.', 'Operator effects can be confounded with operator-specific part populations.'],
    advanced: 'Nested design is a compromise, not a naming change. If operator-specific part sets differ systematically, reproducibility estimates include that sampling difference.',
    example: { title: 'Destructive-test plan', scenario: 'Three operators each receive ten unique specimens and measure each specimen twice where feasible.', steps: ['Use unique part IDs within operator.', 'Declare parts nested within operator.', 'Fit REML and inspect identifiability.'], result: 'The topology reflects that no specimen is shared; crossed formulas must not be used.' },
    exampleKind: 'walkthrough', citations: ['nist-variance-components'], related: ['sixSigma.msa_reml'],
  },
]

interface SpcHelpSpec {
  leaf: string
  title: string
  summary: string
  input: string
  center: string
  latex: string
  scenario: string
  steps: string[]
  result: string
  advanced: string
}

const spcHelpSpecs: SpcHelpSpec[] = [
  { leaf: 'spc_i_mr', title: 'I-MR Chart', summary: 'Monitors individual continuous observations and their successive moving ranges.', input: 'One ordered measurement per sampling occasion', center: 'The I chart tracks location and the MR chart tracks short-term successive variation.', latex: '\\hat\\sigma=\\bar{MR}/d_2,\\qquad UCL_I=\\bar x+3\\hat\\sigma', scenario: 'Mean=10 and average moving range=0.20.', steps: ['For moving ranges of two, d₂=1.128.', 'σ̂=0.20/1.128=0.177.', 'I limits are about 10±0.532.'], result: 'The illustrative I-chart limits are 9.468 and 10.532.', advanced: 'Successive observations should represent a stable sampling cadence. Strong autocorrelation makes moving-range limits misleading.' },
  { leaf: 'spc_xbar_r', title: 'Xbar-R Chart', summary: 'Monitors subgroup means and ranges for small rational subgroups.', input: 'Ordered subgroups with two or more continuous measurements', center: 'The Xbar chart detects location shifts; the R chart checks within-subgroup range stability.', latex: 'UCL_{\\bar X}=\\bar{\\bar X}+A_2\\bar R,\\qquad UCL_R=D_4\\bar R', scenario: 'Subgroup size 5, grand mean 10, and Rbar=1.', steps: ['For n=5, A₂=0.577 and D₄=2.114.', 'Xbar limits are 10±0.577.', 'R UCL=2.114.'], result: 'Xbar limits are 9.423–10.577 and range limits are 0–2.114.', advanced: 'Subgroups must be rational: within-subgroup variation should represent short-term common causes, not arbitrary batches.' },
  { leaf: 'spc_xbar_s', title: 'Xbar-S Chart', summary: 'Monitors subgroup means and standard deviations, especially for larger subgroups.', input: 'Ordered equal-structure subgroups of continuous measurements', center: 'The Xbar chart tracks location and the S chart tracks within-subgroup standard deviation.', latex: 'UCL_{\\bar X}=\\bar{\\bar X}+A_3\\bar S,\\qquad UCL_S=B_4\\bar S', scenario: 'Subgroup size 5, grand mean 10, and Sbar=0.5.', steps: ['For n=5, A₃≈1.427 and B₄≈2.089.', 'Mean-chart half-width≈0.714.', 'S UCL≈1.045.'], result: 'Illustrative Xbar limits are about 9.287–10.714; S LCL is 0 and UCL about 1.045.', advanced: 'S-chart constants assume the usual within-subgroup model. Very small subgroups are often better summarized by ranges.' },
  { leaf: 'spc_p', title: 'p Chart', summary: 'Monitors the fraction nonconforming when inspected sample sizes may vary.', input: 'Nonconforming count and inspected size for each period', center: 'The center is pooled fraction nonconforming; limits can vary with sample size.', latex: 'UCL_i=\\bar p+3\\sqrt{\\frac{\\bar p(1-\\bar p)}{n_i}}', scenario: 'Pooled pbar=0.02 with n=100 per sample.', steps: ['SE=√(0.02×0.98/100)=0.014.', 'Add three SE to center.', 'Truncate the negative lower limit at zero.'], result: 'Approximate limits are 0 to 0.062.', advanced: 'Changing opportunity mix, dependence, overdispersion, or inconsistent defect definitions can produce false signals under a binomial model.' },
  { leaf: 'spc_np', title: 'np Chart', summary: 'Monitors the number nonconforming for a constant inspected sample size.', input: 'Nonconforming count and the same sample size for every period', center: 'The center is n times the pooled fraction nonconforming.', latex: 'UCL=n\\bar p+3\\sqrt{n\\bar p(1-\\bar p)}', scenario: 'n=100 and pooled pbar=0.05.', steps: ['Center=5 nonconforming.', 'SD=√4.75=2.179.', 'Compute 5±3×2.179 and truncate below zero.'], result: 'Approximate limits are 0 to 11.54 nonconforming.', advanced: 'Use a p chart when sample size varies. Counts must be units nonconforming, not multiple defects on one unit.' },
  { leaf: 'spc_c', title: 'c Chart', summary: 'Monitors defect counts when the inspection opportunity is constant.', input: 'One nonnegative defect count for each equal inspection unit', center: 'A Poisson model uses the average count as both center and variance estimate.', latex: 'UCL=\\bar c+3\\sqrt{\\bar c}', scenario: 'Average count cbar=4.', steps: ['√4=2.', 'Compute 4±6.', 'Truncate the lower limit at zero.'], result: 'Approximate c-chart limits are 0 to 10 defects.', advanced: 'If inspected area, time, or opportunity varies, use a u chart. Clustering or excess zeros can violate the Poisson model.' },
  { leaf: 'spc_u', title: 'u Chart', summary: 'Monitors defects per unit when inspection opportunity varies.', input: 'Defect count and inspection size/opportunity for each period', center: 'The pooled defects-per-unit rate is compared with size-specific limits.', latex: 'UCL_i=\\bar u+3\\sqrt{\\frac{\\bar u}{n_i}}', scenario: 'Average ubar=0.10 defects/unit and opportunity n=50.', steps: ['SE=√(0.10/50)=0.0447.', 'Upper limit=0.10+3×0.0447.', 'Truncate lower limit below zero.'], result: 'Approximate limits are 0 to 0.234 defects per unit.', advanced: 'Opportunity units must be comparable. Rate changes driven by product mix or inspection intensity require stratification or a richer count model.' },
]

const spcTopics: HelpTopic[] = spcHelpSpecs.map(chart => makeTopic({
  moduleId: 'sixSigma', leaf: chart.leaf, title: chart.title, summary: chart.summary,
  useWhen: [chart.input], inputs: [chart.input, 'Phase-I data or separate Phase-I baseline for Phase II'],
  outputs: ['Center line, control limits, rule violations, workflow status, and retained/excluded baseline context'],
  assumptions: ['Observations follow the intended time order', 'The chart’s continuous/binomial/Poisson sampling model is appropriate'],
  workflow: `Choose Phase I to establish and refine a stable baseline, or Phase II to monitor new data against frozen baseline limits. ${chart.center}`,
  latex: chart.latex,
  interpretation: ['A control-chart signal is evidence to investigate a special cause, not proof of a particular cause.', 'Control limits describe process behavior and are not specification limits.', 'Read both subcharts when the chart has location and variation panels.'],
  advanced: chart.advanced,
  example: { title: `${chart.title} limits`, scenario: chart.scenario, steps: chart.steps, result: chart.result },
  citations: ['nist-spc', 'nist-process-stability'], related: ['sixSigma.spc', 'sixSigma.capability'],
}))

interface DoeHelpSpec {
  leaf: string
  title: string
  summary: string
  use: string
  structure: string
  interpretation: string
  advanced: string
  scenario: string
  steps: string[]
  result: string
  latex?: string
  citations?: string[]
}

const doeHelpSpecs: DoeHelpSpec[] = [
  { leaf: 'doe_full_factorial_2level', title: 'Full Factorial (2-level)', summary: 'Runs every low/high combination for k factors.', use: 'Estimating all effects in a modest-size two-level experiment.', structure: 'Generate 2^k coded combinations, then randomize or block according to the physical experiment.', interpretation: 'Main effects and interactions are unaliased when the full design and model are supported.', advanced: 'Without replication, pure error is unavailable and a full effect model can be saturated. Center points are needed to diagnose curvature.', scenario: 'Three factors A, B, and C.', steps: ['Compute 2³.', 'Generate every ±1 combination.'], result: 'The design contains 8 treatment runs before replication or added center points.', latex: 'N=2^k' },
  { leaf: 'doe_fractional_factorial_2level', title: 'Fractional Factorial (2-level)', summary: 'Uses a defined fraction of the full two-level design to screen more factors with fewer runs.', use: 'Screening when a full 2^k design exceeds the run budget.', structure: 'Specify generators such as D=ABC or a fraction; inspect the defining relation and aliases before running.', interpretation: 'An estimated effect represents its alias chain unless higher-order terms are assumed negligible.', advanced: 'Resolution and alias assumptions are scientific commitments. A fraction cannot reveal two aliased active effects separately without augmentation.', scenario: 'Four factors with generator D=ABC.', steps: ['Run the 2³ basic-factor combinations.', 'Set D to the product ABC.', 'Defining relation is I=ABCD.'], result: 'Eight runs form a resolution-IV half fraction of the 16-run full design.' },
  { leaf: 'doe_plackett_burman', title: 'Plackett–Burman Design', summary: 'Provides economical orthogonal main-effect screening in validated multiples-of-four run sizes.', use: 'Finding a few likely important factors among many when interactions are assumed negligible.', structure: 'Select factors within a supported 4–64 run construction and use the randomized run order.', interpretation: 'Main-effect estimates are orthogonal but generally aliased with combinations of two-factor interactions.', advanced: 'Plackett–Burman is a screening design, not an interaction-resolution design. Follow active factors with a higher-resolution or optimization experiment.', scenario: 'Screen seven factors.', steps: ['Choose the 8-run construction.', 'Assign one factor to each available column.', 'Randomize physical run order.'], result: 'Seven main effects are screened in 8 runs under the negligible-interaction assumption.', citations: ['plackett-burman-1946'] },
  { leaf: 'doe_box_behnken', title: 'Box–Behnken Design', summary: 'Fits a quadratic response surface using edge-midpoint combinations and center runs without cube corners.', use: 'Three to seven continuous factors when extreme simultaneous settings are undesirable.', structure: 'Generate paired ±1 settings while other factors remain at center, plus replicated center points.', interpretation: 'Linear, quadratic, and two-factor interaction terms describe local response curvature.', advanced: 'The design does not test cube corners; prediction there is extrapolation relative to its support. Preserve enough center replication for pure error.', scenario: 'Three factors with three center runs.', steps: ['Use 12 edge-midpoint treatment runs.', 'Add 3 center replicates.'], result: 'The generated experiment has 15 runs.', citations: ['nist-response-surface'] },
  { leaf: 'doe_central_composite', title: 'Central Composite Design (CCD)', summary: 'Combines factorial, axial, and center points for quadratic response-surface modeling.', use: 'Sequential optimization after important continuous factors are known.', structure: 'Choose rotatable, orthogonal, face-centered, or custom axial distance and add center points.', interpretation: 'Axial points identify pure quadratic curvature; factorial points estimate interactions.', advanced: 'Axial settings can exceed safe factor bounds. Face-centered designs stay within bounds but change rotatability and precision geometry.', scenario: 'Three factors with a full factorial core and three centers.', steps: ['Factorial core: 8 runs.', 'Axial points: 2×3=6.', 'Add 3 center runs.'], result: 'The CCD has 17 runs before any additional replication.', citations: ['nist-response-surface'] },
  { leaf: 'doe_simplex_lattice', title: 'Simplex Lattice', summary: 'Places mixture compositions on an evenly spaced {q,m} lattice whose components sum to one.', use: 'Fitting a mixture response over the full simplex with a chosen polynomial degree.', structure: 'Select q components and lattice degree m; generated proportions are multiples of 1/m and sum to one.', interpretation: 'Mixture effects describe changing one component only by redistributing others.', advanced: 'Ordinary factorial interpretations do not apply because mixture components are constrained. Process-variable effects require a combined design.', scenario: 'Three components with degree m=2.', steps: ['Count lattice points C(q+m−1,m).', 'Compute C(4,2)=6.'], result: 'The design contains the three pure blends and three 50/50 binary blends.', latex: 'N=\\binom{q+m-1}{m}', citations: ['scheffe-mixtures-1958'] },
  { leaf: 'doe_simplex_centroid', title: 'Simplex Centroid', summary: 'Uses equal-proportion centroids of every nonempty subset of mixture components.', use: 'A compact canonical mixture design emphasizing pure, binary, and higher-order blends.', structure: 'For each nonempty component subset, set included components to equal proportions and all others to zero.', interpretation: 'The design supports canonical mixture terms conditional on the chosen component region.', advanced: 'Pure components may be infeasible in real formulations; use constraints or extreme vertices when the full simplex is not allowed.', scenario: 'Three mixture components.', steps: ['Count nonempty subsets: 2³−1.', 'Include 3 pure, 3 binary 50/50, and one 1/3 blend.'], result: 'The simplex-centroid design has 7 compositions.', latex: 'N=2^q-1', citations: ['scheffe-mixtures-1958'] },
  { leaf: 'doe_extreme_vertices', title: 'Extreme Vertices Mixture Design', summary: 'Generates vertices of a mixture region constrained by component lower/upper bounds and sum-to-one.', use: 'Mixture experiments where pure blends or parts of the simplex are infeasible.', structure: 'Enter compatible lower and upper bounds for every component; generated vertices define the feasible polytope.', interpretation: 'Inference and optimization are conditional on the bounded region actually explored.', advanced: 'Feasible bounds do not guarantee adequate interior model support. Add design points or replication when vertex-only geometry is insufficient.', scenario: 'Three components each bounded from 0.1 to 0.8.', steps: ['Enforce x1+x2+x3=1.', 'Set one component to 0.8 and the others to 0.1.', 'Permute the high component.'], result: 'The simplest bounded region has vertices (0.8,0.1,0.1) and its three permutations.', citations: ['scheffe-mixtures-1958'] },
  { leaf: 'doe_full_factorial_general', title: 'Full Factorial (General)', summary: 'Runs the Cartesian product of all specified factor levels.', use: 'Categorical or multilevel factors where every combination is required.', structure: 'Provide the level count for each factor; the generator constructs every combination.', interpretation: 'The design supports cell-mean comparisons and interactions represented by the observed combinations.', advanced: 'Run count grows multiplicatively. Numeric factor levels are not automatically a response-surface model; analysis must match factor meaning and replication.', scenario: 'Factor A has 2 levels and B has 3.', steps: ['Multiply level counts.', '2×3=6 combinations.'], result: 'The full factorial contains 6 treatment combinations before replication.', latex: 'N=\\prod_{j=1}^k L_j' },
  { leaf: 'doe_taguchi', title: 'Taguchi Orthogonal Array', summary: 'Generates a supported standard L4, L8, L9, L12, L16, L18, or L27 orthogonal array.', use: 'A predefined economical robust-design or main-effect screening layout matches factor levels and objectives.', structure: 'Choose a supported array and assign factors only to compatible columns/levels.', interpretation: 'Orthogonality supports separated assigned main effects under the array’s alias assumptions.', advanced: 'An orthogonal array is not automatically a complete Taguchi robust-design analysis. Noise-factor strategy, interactions, and signal-to-noise objectives must be planned explicitly.', scenario: 'Three two-level factors use L8.', steps: ['Select the L8 array.', 'Assign A, B, and C to compatible columns.', 'Randomize execution where the physical design permits.'], result: 'Eight orthogonal runs estimate assigned main effects under the chosen column plan.' },
]

const doeTopics: HelpTopic[] = doeHelpSpecs.map(design => makeTopic({
  moduleId: 'sixSigma', leaf: design.leaf, title: design.title, summary: design.summary,
  useWhen: [design.use], inputs: ['Factor names and design-specific levels, generators, bounds, or array settings', 'Replicates per design point, randomization seed, and optional blocks'],
  outputs: ['Generated run table, coded/natural factor columns, design metadata, power screen, and analysis-ready response column'],
  assumptions: ['The physical randomization, factor ranges, and experimental unit match the generated design'],
  workflow: design.structure,
  latex: design.latex,
  interpretation: [design.interpretation, 'Record actual run conditions and deviations; the generated table alone does not guarantee a valid experiment.'],
  advanced: design.advanced,
  example: { title: `${design.title} size`, scenario: design.scenario, steps: design.steps, result: design.result },
  citations: design.citations ?? ['nist-response-surface'], related: ['sixSigma.doe_analysis', 'sixSigma.doe_power', 'sixSigma.doe_blocking'],
}))

const doeWorkflowSpecs: TopicSpec[] = [
  {
    moduleId: 'sixSigma', leaf: 'doe_analysis', title: 'DOE Response Analysis',
    summary: 'Adds run responses and fits an analysis appropriate to supported two-level factorial, response-surface, or mixture design metadata.',
    useWhen: ['The generated experiment has been executed and one response is available for every run.'], inputs: ['Run table, complete response vector, design metadata, and model choice'], outputs: ['Effects/terms, fit statistics, aliases, residuals, main/interaction plots, lack-of-fit or design diagnostics, and supported optimum/stationary summaries'],
    assumptions: ['Responses remain aligned with actual run IDs', 'The selected model is estimable from the design', 'Residual assumptions are adequate for inferential outputs'],
    workflow: 'Enter responses in run-table order, choose the supported model, and inspect rank/alias and residual diagnostics before reading p-values or optimization summaries.',
    latex: 'y=X\\beta+\\varepsilon',
    interpretation: ['Two-level “effect” is twice the coded coefficient.', 'Saturated designs lack residual degrees of freedom; Lenth screening is heuristic.', 'A reported optimum or stationary point is conditional on the fitted region and model.'],
    advanced: 'Do not optimize an aliased, rank-deficient, extrapolating, or visibly misspecified surface. Confirmation runs are new evidence, not optional decoration.',
    example: { title: 'Known 2³ effects', scenario: 'Responses follow y=50+8A+1B+5C+3AC plus small noise.', steps: ['Fit main effects and two-factor interactions.', 'Coded coefficient A≈8 implies effect≈16.', 'C≈5 implies effect≈10; AC≈3 implies interaction effect≈6.'], result: 'A and C dominate, with a material A×C interaction; residual diagnostics determine whether the model is adequate.' },
    citations: ['nist-response-surface'],
  },
  {
    moduleId: 'sixSigma', leaf: 'doe_power', title: 'DOE Power Planning',
    summary: 'Screens whether the generated design has enough information to detect an entered standardized coefficient at the chosen alpha and target power.',
    useWhen: ['Planning run count, replication, or a detectable effect before executing the experiment.'], inputs: ['Standardized coefficient', 'Significance level', 'Target power', 'Generated design/model context'], outputs: ['Design-specific power metadata or planning warning'],
    assumptions: ['The standardized effect and error scale are realistic planning values', 'The tested term is estimable under the design'],
    workflow: 'Enter the smallest effect worth detecting, not an optimistic expected effect. Generate the design and compare its power screen with the target before committing resources.',
    latex: '\\text{Power}=P_{\\beta=\\beta_1}(\\text{reject }H_0)',
    interpretation: ['Power is conditional on effect, noise, alpha, model, and design geometry.', 'Failure to reach target motivates more runs, replication, reduced model scope, or a larger detectable-effect threshold.', 'Post-hoc power does not replace an effect interval.'],
    advanced: 'A single standardized coefficient is a planning abstraction; nuisance interactions, missing runs, heteroscedasticity, and model selection can reduce realized sensitivity.',
    example: { title: 'Planning sensitivity', scenario: 'Target power is 0.80 at α=0.05 for standardized coefficient 0.5.', steps: ['Generate the candidate design.', 'Read its power screen.', 'If below 0.80, increase information before execution rather than redefining success afterward.'], result: 'The planning decision is whether the proposed design can detect the predeclared practically important signal.' },
  },
  {
    moduleId: 'sixSigma', leaf: 'doe_blocking', title: 'DOE Blocking',
    summary: 'Assigns runs to blocks so known nuisance changes can be separated from treatment comparisons where the design permits.',
    useWhen: ['The experiment must span batches, days, lots, chambers, or other known nuisance strata.'], inputs: ['Number of blocks, block seed, generated treatment design, and physical restriction'], outputs: ['Block assignments and analysis diagnostics about block estimability/confounding'],
    assumptions: ['Treatments can be randomized within blocks', 'Block is a nuisance effect rather than a treatment of primary interest'],
    workflow: 'Choose blocks from the physical execution constraint, not from outcomes. Randomize within each block and preserve the block column with measured responses.',
    latex: 'y_{ij}=\\mu+\\tau_i+\\gamma_j+\\varepsilon_{ij}',
    interpretation: ['Blocking can remove nuisance variation and improve precision.', 'Treatment contrasts confounded with blocks cannot be separately estimated.', 'A block effect is contextual, not automatically a process improvement lever.'],
    advanced: 'Too many small blocks consume degrees of freedom and can confound important effects. Review the generated blocking diagnostic before running the experiment.',
    example: { title: 'Two-day experiment', scenario: 'Eight treatment runs must be split across two days.', steps: ['Create two four-run blocks.', 'Balance treatment contrasts across days where possible.', 'Randomize the four runs within each day.'], result: 'Day-to-day shift can be modeled separately if it is not confounded with the treatment effects of interest.' },
    citations: ['nist-blocking'],
  },
]

const landingSpecs: TopicSpec[] = [
  {
    moduleId: 'dataAnalysis', leaf: 'descriptive', title: 'Descriptive Statistics',
    summary: 'Explores the shared dataset through complementary numerical and graphical views before formal modeling.',
    useWhen: ['Beginning data analysis, validating imported data, or investigating model diagnostics.'],
    inputs: ['Shared Statistical Modeling dataset', 'Selected analysis column or column pair where required'],
    outputs: ['Summary tables and selected distribution, relationship, count, and sequence views'],
    workflow: 'Begin with Summary, then select multiple views that address shape, relationships, or order. No single plot establishes data quality or a distribution model.',
    interpretation: ['Use raw-data context beside aggregates.', 'Match each view to numeric, categorical, paired, or ordered data.', 'Unexpected patterns should trigger source and process checks.'],
    advanced: 'Exploratory findings are hypotheses, not confirmatory evidence. Reusing the same data to discover and test a pattern makes nominal p-values optimistic.',
    example: { title: 'First-pass exploration', scenario: 'A dataset contains time, temperature, pressure, and yield.', steps: ['Review Summary for missingness and units.', 'Use run chart for yield in time order.', 'Use scatter and correlation for numeric relationships.', 'Use histogram, ECDF, and QQ for yield shape.'], result: 'The views establish a defensible modeling starting point without hiding observations.' },
    exampleKind: 'walkthrough', related: ['dataAnalysis.summary', 'dataAnalysis.regression_ml_workflow'],
  },
  {
    moduleId: 'dataAnalysis', leaf: 'modeling', title: 'Regression & Machine Learning',
    summary: 'Compares compatible predictive candidates under a unified out-of-sample evaluation contract and packages an accepted recipe for scoring.',
    useWhen: ['A defined target must be explained or predicted from available features.'],
    inputs: ['Prepared shared dataset', 'Target and features', 'Task, split strategy, candidates, metric, tuning, and confidence settings'],
    outputs: ['Readiness report, nested-validation leaderboard, diagnostics, finalized asset, and scored predictions'],
    workflow: 'Proceed through Prepare, Compare, Inspect, Finalize, and Predict. Changes to an evaluated recipe require comparison again before finalization.',
    interpretation: ['Eligibility depends on task and data types.', 'The recommendation is tied to the selected metric and validation design.', 'Predictive performance and coefficient inference answer different questions.'],
    advanced: 'A model can validate well yet fail after population, measurement, policy, or prevalence shift. Preserve a monitoring and revalidation plan with the asset.',
    example: { title: 'Classification workflow', scenario: 'Predict pass/fail from test measurements.', steps: ['Choose classification and a split matching future units.', 'Compare all eligible candidates.', 'Inspect confusion, ROC/PR, calibration, and subgroup-relevant errors.', 'Finalize the unchanged selected recipe.'], result: 'The asset carries its schema, validation evidence, threshold/calibration policy, and reproducibility record.' },
    exampleKind: 'walkthrough', citations: ['sklearn-cross-validation', 'sklearn-calibration'], related: ['dataAnalysis.validation', 'dataAnalysis.finalization'],
  },
  {
    moduleId: 'sixSigma', leaf: 'msa', title: 'Measurement System Analysis (Gage R&R)',
    summary: 'Determines how much observed variation comes from repeatability, reproducibility, and part-to-part differences.',
    useWhen: ['Before capability, SPC, or experiments rely on a measurement system.'],
    inputs: ['Part/operator/trial measurements', 'Study topology and method', 'Optional tolerance and multiplier'],
    outputs: ['Variance components, %study variation, %tolerance, ndc, design diagnostics, and plots'],
    workflow: 'Choose crossed versus nested from the physical study, then choose ANOVA/Xbar-R only for complete balanced crossed data or REML for unbalanced/nested data.',
    interpretation: ['Low GRR supports discrimination but does not prove calibration accuracy.', 'ndc summarizes category resolution under the fitted variation model.', 'Use plots to locate part, operator, and repeatability patterns.'],
    advanced: 'A study spanning too narrow a part range distorts percent-of-study metrics, while a wide range can mask poor tolerance performance. Plan both purpose and sampling deliberately.',
    example: { title: 'Method decision', scenario: 'Some operators missed measurements on shared parts.', steps: ['Topology remains crossed because parts are shared.', 'Classical balance is broken.', 'Choose REML and inspect convergence/design diagnostics.'], result: 'The method follows the observed topology and balance rather than forcing a classical table.' },
    exampleKind: 'walkthrough', citations: ['nist-gage-rr', 'nist-variance-components'], related: ['sixSigma.msa_anova', 'sixSigma.msa_reml'],
  },
  {
    moduleId: 'sixSigma', leaf: 'spc', title: 'Statistical Process Control',
    summary: 'Uses Phase-I baselines and Phase-II monitoring charts to distinguish routine variation from signals requiring investigation.',
    useWhen: ['Ordered process data are available and the sampling model matches an implemented chart.'],
    inputs: ['Ordered measurements or counts', 'Chart type', 'Phase workflow and optional separate baseline'],
    outputs: ['Center lines, limits, rule violations, baseline status, and monitoring status'],
    workflow: 'Choose the chart from continuous versus attribute data, subgroup structure, sample-size behavior, and defect versus defective meaning. Establish a stable Phase-I baseline before freezing limits for Phase II.',
    interpretation: ['Signals prompt investigation; absence of signals is not proof of capability.', 'Specification limits answer conformance, while control limits answer stability.', 'Variation-chart signals can invalidate location-chart interpretation.'],
    advanced: 'Rational subgrouping, independence, count opportunity, and baseline curation are part of the model. Automated signal removal never replaces documented cause investigation.',
    example: { title: 'Chart selection', scenario: 'Each hour, 100 units are inspected and the number of nonconforming units is recorded.', steps: ['Outcome is units nonconforming, not defect events.', 'Sample size is constant.', 'Choose an np chart; use p if hourly n varies.'], result: 'The chart matches a binomial count with constant opportunity.' },
    exampleKind: 'walkthrough', citations: ['nist-spc', 'nist-process-stability'], related: ['sixSigma.spc_np', 'sixSigma.spc_p'],
  },
  {
    moduleId: 'sixSigma', leaf: 'doe', title: 'Design of Experiments',
    summary: 'Generates randomized experimental run plans, screens power and blocking, and analyzes responses using design-aware models.',
    useWhen: ['You can deliberately vary inputs to learn effects, interactions, curvature, or mixture behavior.'],
    inputs: ['Experimental objective, factors/ranges, constraints, replicates per design point, run budget, randomization, blocks, and power target'],
    outputs: ['Run table, design metadata/diagnostics, response analysis, effects, plots, and supported optimization summaries'],
    workflow: 'Use the design wizard or choose from screening, response-surface, mixture, general factorial, and robust arrays. Validate physical feasibility, randomize execution, record responses by run, then analyze with design metadata intact.',
    interpretation: ['Design choice determines which effects are estimable and aliased.', 'Randomization protects treatment comparisons from time/order bias.', 'Replication estimates pure error; center points help detect curvature.'],
    advanced: 'A mathematically generated design can still be physically confounded or unsafe. Pilot factor ranges, define the experimental unit, and predeclare primary responses and confirmation runs.',
    example: { title: 'Screen then optimize', scenario: 'Seven possible process factors but only a few are expected to matter.', steps: ['Use an economical screening design under explicit interaction assumptions.', 'Confirm active factors in a higher-resolution follow-up.', 'Use CCD or Box–Behnken to map local curvature.', 'Run confirmation settings.'], result: 'Sequential experiments spend runs where information is most valuable while preserving inferential clarity.' },
    exampleKind: 'walkthrough', citations: ['plackett-burman-1946', 'nist-response-surface', 'nist-blocking'], related: ['sixSigma.doe_plackett_burman', 'sixSigma.doe_central_composite'],
  },
]

export const STATISTICS_HELP_TOPICS: HelpTopic[] = [
  ...landingSpecs.map(makeTopic),
  ...hypothesisSpecs.map(makeTopic),
  ...descriptiveSpecs.map(makeTopic),
  ...modelingConceptSpecs.map(makeTopic),
  ...modelTopics,
  ...sixSigmaCoreSpecs.map(makeTopic),
  ...spcTopics,
  ...doeTopics,
  ...doeWorkflowSpecs.map(makeTopic),
]
