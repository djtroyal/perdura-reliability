"""
Probability plotting for reliability distributions.

Provides linearized probability plots for each distribution family,
with support for censored (suspended) data via rank adjustment.
"""

import numpy as np
import matplotlib.pyplot as plt
from reliability.Utils import median_rank_approximation, rank_adjustment, xy_transform


def _probability_plot(failures, right_censored, dist_name, dist=None, show_plot=True, label=None, **kwargs):
    """Generic probability plot implementation."""
    failures = np.asarray(failures, dtype=float)
    if right_censored is not None:
        right_censored = np.asarray(right_censored, dtype=float)

    x_transform, y_transform, x_label, y_label = xy_transform(dist_name)

    adj_ranks, n = rank_adjustment(failures, right_censored)
    median_ranks = median_rank_approximation(adj_ranks, n)

    sorted_failures = np.sort(failures)
    median_ranks = np.clip(median_ranks, 1e-10, 1 - 1e-10)

    # A location-shifted (3P) fit is linear on the paper of t - gamma, not t.
    g = float(getattr(dist, 'gamma', 0) or 0) if dist is not None else 0.0
    if g > 0:
        keep = sorted_failures > g
        sorted_failures = sorted_failures[keep]
        median_ranks = median_ranks[keep]
        x_label = x_label.replace('t', 't-γ')

    x_trans = x_transform(sorted_failures - g)
    y_trans = y_transform(median_ranks)

    if show_plot:
        plt.scatter(x_trans, y_trans, marker='.', color='blue', zorder=5,
                    label=label or 'Data')

        if dist is not None:
            lo = sorted_failures.min() * 0.8 if g == 0 else g + (sorted_failures.min() - g) * 0.5
            x_line = np.linspace(lo, sorted_failures.max() * 1.2, 200)
            x_line = x_line[x_line > g] if g > 0 or dist_name in (
                'Weibull', 'Weibull_2P', 'Weibull_3P',
                'Lognormal', 'Lognormal_2P', 'Lognormal_3P',
                'Gamma', 'Gamma_2P', 'Gamma_3P',
                'Loglogistic', 'Loglogistic_2P', 'Loglogistic_3P') else x_line
            cdf_vals = dist._cdf(x_line)
            cdf_vals = np.clip(cdf_vals, 1e-10, 1 - 1e-10)
            plt.plot(x_transform(x_line - g), y_transform(cdf_vals), 'r-',
                     label='Fitted distribution', zorder=3)

        plt.xlabel(x_label)
        plt.ylabel(y_label)
        plt.title(f'{dist_name} Probability Plot')
        plt.legend()
        plt.grid(True, alpha=0.3)

    return x_trans, y_trans


def Weibull_probability_plot(failures, right_censored=None, dist=None, show_plot=True, **kwargs):
    return _probability_plot(failures, right_censored, 'Weibull_2P', dist, show_plot, **kwargs)


def Normal_probability_plot(failures, right_censored=None, dist=None, show_plot=True, **kwargs):
    return _probability_plot(failures, right_censored, 'Normal_2P', dist, show_plot, **kwargs)


def Lognormal_probability_plot(failures, right_censored=None, dist=None, show_plot=True, **kwargs):
    return _probability_plot(failures, right_censored, 'Lognormal_2P', dist, show_plot, **kwargs)


def Exponential_probability_plot(failures, right_censored=None, dist=None, show_plot=True, **kwargs):
    return _probability_plot(failures, right_censored, 'Exponential_1P', dist, show_plot, **kwargs)


def Gamma_probability_plot(failures, right_censored=None, dist=None, show_plot=True, **kwargs):
    return _probability_plot(failures, right_censored, 'Gamma_2P', dist, show_plot, **kwargs)


def Loglogistic_probability_plot(failures, right_censored=None, dist=None, show_plot=True, **kwargs):
    return _probability_plot(failures, right_censored, 'Loglogistic_2P', dist, show_plot, **kwargs)


def Beta_probability_plot(failures, right_censored=None, dist=None, show_plot=True, **kwargs):
    return _probability_plot(failures, right_censored, 'Beta_2P', dist, show_plot, **kwargs)


def Gumbel_probability_plot(failures, right_censored=None, dist=None, show_plot=True, **kwargs):
    return _probability_plot(failures, right_censored, 'Gumbel_2P', dist, show_plot, **kwargs)
