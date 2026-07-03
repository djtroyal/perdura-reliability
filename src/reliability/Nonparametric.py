"""
Non-parametric reliability estimators.

Provides Kaplan-Meier and Nelson-Aalen estimators with full support
for right-censored (suspended) data.
"""

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from scipy import stats as ss


class KaplanMeier:
    """Kaplan-Meier estimator for the survival function.

    Parameters
    ----------
    failures : array-like
        Failure times.
    right_censored : array-like, optional
        Suspension (right-censored) times.
    CI : float, optional
        Confidence interval (default 0.95).
    show_plot : bool, optional
        Whether to show the survival plot (default False).
    label : str, optional
        Label for the plot legend.
    """

    def __init__(self, failures, right_censored=None, CI=0.95, show_plot=False, label='Kaplan-Meier'):
        failures = np.asarray(failures, dtype=float)
        if right_censored is not None:
            right_censored = np.asarray(right_censored, dtype=float)
        else:
            right_censored = np.array([], dtype=float)

        self.CI = CI
        z = ss.norm.ppf(1 - (1 - CI) / 2)

        all_times = np.concatenate([failures, right_censored])
        event_type = np.concatenate([
            np.ones(len(failures)),
            np.zeros(len(right_censored))
        ])

        sort_idx = np.lexsort((1 - event_type, all_times))
        sorted_times = all_times[sort_idx]
        sorted_events = event_type[sort_idx]

        n_total = len(all_times)

        times = [0]
        survival = [1.0]
        ci_lower = [1.0]
        ci_upper = [1.0]
        greenwood_sum = 0

        at_risk = n_total
        current_s = 1.0

        i = 0
        while i < len(sorted_times):
            t = sorted_times[i]
            d = 0
            c = 0

            while i < len(sorted_times) and sorted_times[i] == t:
                if sorted_events[i] == 1:
                    d += 1
                else:
                    c += 1
                i += 1

            if d > 0:
                if at_risk > 0:
                    current_s *= (1 - d / at_risk)
                    if at_risk * (at_risk - d) > 0:
                        greenwood_sum += d / (at_risk * (at_risk - d))

                times.append(t)
                survival.append(current_s)

                # log(-log) (complementary log-log) confidence interval per
                # Kalbfleisch-Prentice: S^exp(±θ) with θ = z·sqrt(V)/ln(S).
                # Always inside (0,1) and better small-sample coverage than the
                # plain Greenwood ± interval (which needed clipping exactly
                # where users read the band).
                if 0 < current_s < 1:
                    theta = z * np.sqrt(greenwood_sum) / abs(np.log(current_s))
                    ci_lower.append(float(current_s ** np.exp(theta)))
                    ci_upper.append(float(current_s ** np.exp(-theta)))
                elif current_s >= 1:
                    ci_lower.append(1.0)
                    ci_upper.append(1.0)
                else:
                    ci_lower.append(0)
                    ci_upper.append(0)

            at_risk -= (d + c)

        self.results = pd.DataFrame({
            'time': times,
            'SF': survival,
            'CI_lower': ci_lower,
            'CI_upper': ci_upper,
        })

        if show_plot:
            self.plot(label=label)

    def plot(self, label='Kaplan-Meier', **kwargs):
        times = self.results['time'].values
        sf = self.results['SF'].values
        plt.step(times, sf, where='post', label=label, **kwargs)
        plt.fill_between(
            times,
            self.results['CI_lower'].values,
            self.results['CI_upper'].values,
            alpha=0.2, step='post'
        )
        plt.xlabel('Time')
        plt.ylabel('Survival Probability')
        plt.title('Kaplan-Meier Estimate')
        plt.legend()
        plt.ylim(0, 1.05)


class NelsonAalen:
    """Nelson-Aalen estimator for the cumulative hazard function.

    Parameters
    ----------
    failures : array-like
        Failure times.
    right_censored : array-like, optional
        Suspension (right-censored) times.
    CI : float, optional
        Confidence interval (default 0.95).
    show_plot : bool, optional
        Whether to show the cumulative hazard plot (default False).
    label : str, optional
        Label for the plot legend.
    """

    def __init__(self, failures, right_censored=None, CI=0.95, show_plot=False, label='Nelson-Aalen'):
        failures = np.asarray(failures, dtype=float)
        if right_censored is not None:
            right_censored = np.asarray(right_censored, dtype=float)
        else:
            right_censored = np.array([], dtype=float)

        self.CI = CI
        z = ss.norm.ppf(1 - (1 - CI) / 2)

        all_times = np.concatenate([failures, right_censored])
        event_type = np.concatenate([
            np.ones(len(failures)),
            np.zeros(len(right_censored))
        ])

        sort_idx = np.lexsort((1 - event_type, all_times))
        sorted_times = all_times[sort_idx]
        sorted_events = event_type[sort_idx]

        n_total = len(all_times)

        times = [0]
        chf = [0.0]
        ci_lower = [0.0]
        ci_upper = [0.0]
        variance_sum = 0

        at_risk = n_total
        current_chf = 0.0

        i = 0
        while i < len(sorted_times):
            t = sorted_times[i]
            d = 0
            c = 0

            while i < len(sorted_times) and sorted_times[i] == t:
                if sorted_events[i] == 1:
                    d += 1
                else:
                    c += 1
                i += 1

            if d > 0 and at_risk > 0:
                current_chf += d / at_risk
                variance_sum += d / (at_risk ** 2)

                times.append(t)
                chf.append(current_chf)

                # Log-transformed interval H·exp(±z·SE/H): the cumulative
                # hazard is positive and right-skewed, so the symmetric
                # interval under-covers and its clamped lower bound
                # degenerates at early times.
                se = np.sqrt(variance_sum)
                if current_chf > 0:
                    phi = np.exp(z * se / current_chf)
                    ci_lower.append(float(current_chf / phi))
                    ci_upper.append(float(current_chf * phi))
                else:
                    ci_lower.append(0.0)
                    ci_upper.append(0.0)

            at_risk -= (d + c)

        self.results = pd.DataFrame({
            'time': times,
            'CHF': chf,
            'CI_lower': ci_lower,
            'CI_upper': ci_upper,
        })

        self.results['SF'] = np.exp(-self.results['CHF'])

        if show_plot:
            self.plot(label=label)

    def plot(self, label='Nelson-Aalen', **kwargs):
        times = self.results['time'].values
        chf = self.results['CHF'].values
        plt.step(times, chf, where='post', label=label, **kwargs)
        plt.fill_between(
            times,
            self.results['CI_lower'].values,
            self.results['CI_upper'].values,
            alpha=0.2, step='post'
        )
        plt.xlabel('Time')
        plt.ylabel('Cumulative Hazard')
        plt.title('Nelson-Aalen Estimate')
        plt.legend()
