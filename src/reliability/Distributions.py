"""
Probability distributions for reliability engineering.

Each distribution class provides PDF, CDF, SF (survival function),
HF (hazard function), CHF (cumulative hazard function), quantile,
random_samples, and statistical properties.
"""

import numpy as np
from scipy import stats as ss
from scipy.special import gamma as gamma_func
from abc import ABC, abstractmethod
import matplotlib.pyplot as plt
from reliability.Utils import generate_X_array


class _Distribution(ABC):
    """Abstract base class for all reliability distributions."""

    @abstractmethod
    def _pdf(self, x):
        ...

    @abstractmethod
    def _cdf(self, x):
        ...

    def _sf(self, x):
        return 1 - self._cdf(x)

    def _logpdf(self, x):
        """Log probability density evaluated without first forming the PDF."""
        x = np.asarray(x, dtype=float)
        scipy_dist = getattr(self, '_scipy', None)
        if scipy_dist is not None:
            return scipy_dist.logpdf(x)

        pdf = np.asarray(self._pdf(x), dtype=float)
        with np.errstate(divide='ignore', invalid='ignore'):
            return np.log(pdf)

    def _logsf(self, x):
        """Log survival probability evaluated without first forming the SF."""
        x = np.asarray(x, dtype=float)
        scipy_dist = getattr(self, '_scipy', None)
        if scipy_dist is not None:
            return scipy_dist.logsf(x)

        sf = np.asarray(self._sf(x), dtype=float)
        with np.errstate(divide='ignore', invalid='ignore'):
            return np.log(sf)

    def _hf(self, x):
        logpdf = self._logpdf(x)
        logsf = self._logsf(x)
        outside_support = np.isneginf(logpdf) & np.isneginf(logsf)
        with np.errstate(over='ignore', invalid='ignore'):
            hazard = np.exp(logpdf - logsf)
        # Preserve the historical value outside a bounded distribution's
        # support, where both density and survival are exactly zero.
        return np.where(outside_support, 0.0, hazard)

    def _chf(self, x):
        return -self._logsf(x)

    @abstractmethod
    def quantile(self, q):
        ...

    @abstractmethod
    def random_samples(self, n, seed=None):
        ...

    @property
    @abstractmethod
    def mean(self):
        ...

    @property
    @abstractmethod
    def variance(self):
        ...

    @property
    def standard_deviation(self):
        return np.sqrt(self.variance)

    @property
    def median(self):
        return self.quantile(0.5)

    @property
    def stats(self):
        import pandas as pd
        return pd.DataFrame({
            'Statistic': ['Mean', 'Median', 'Variance', 'Std Dev'],
            'Value': [self.mean, self.median, self.variance, self.standard_deviation]
        })

    def PDF(self, xvals=None, show_plot=False, **kwargs):
        x = generate_X_array(self, xvals)
        y = self._pdf(x)
        if show_plot:
            plt.plot(x, y, **kwargs)
            plt.xlabel('t')
            plt.ylabel('PDF')
            plt.title(f'PDF - {self.name}')
        return y if xvals is not None else (x, y)

    def CDF(self, xvals=None, show_plot=False, **kwargs):
        x = generate_X_array(self, xvals)
        y = self._cdf(x)
        if show_plot:
            plt.plot(x, y, **kwargs)
            plt.xlabel('t')
            plt.ylabel('CDF')
            plt.title(f'CDF - {self.name}')
        return y if xvals is not None else (x, y)

    def SF(self, xvals=None, show_plot=False, **kwargs):
        x = generate_X_array(self, xvals)
        y = self._sf(x)
        if show_plot:
            plt.plot(x, y, **kwargs)
            plt.xlabel('t')
            plt.ylabel('Survival Function')
            plt.title(f'SF - {self.name}')
        return y if xvals is not None else (x, y)

    def logPDF(self, xvals=None):
        """Return log-density values, including finite extreme-tail values."""
        x = generate_X_array(self, xvals)
        y = self._logpdf(x)
        return y if xvals is not None else (x, y)

    def logSF(self, xvals=None):
        """Return log-survival values without survival-probability underflow."""
        x = generate_X_array(self, xvals)
        y = self._logsf(x)
        return y if xvals is not None else (x, y)

    def HF(self, xvals=None, show_plot=False, **kwargs):
        x = generate_X_array(self, xvals)
        y = self._hf(x)
        if show_plot:
            plt.plot(x, y, **kwargs)
            plt.xlabel('t')
            plt.ylabel('Hazard Function')
            plt.title(f'HF - {self.name}')
        return y if xvals is not None else (x, y)

    def CHF(self, xvals=None, show_plot=False, **kwargs):
        x = generate_X_array(self, xvals)
        y = self._chf(x)
        if show_plot:
            plt.plot(x, y, **kwargs)
            plt.xlabel('t')
            plt.ylabel('Cumulative Hazard')
            plt.title(f'CHF - {self.name}')
        return y if xvals is not None else (x, y)

    def plot(self, xvals=None):
        x = generate_X_array(self, xvals)
        fig, axes = plt.subplots(2, 3, figsize=(14, 8))
        fig.suptitle(str(self))

        axes[0, 0].plot(x, self._pdf(x))
        axes[0, 0].set_title('PDF')
        axes[0, 0].set_xlabel('t')

        axes[0, 1].plot(x, self._cdf(x))
        axes[0, 1].set_title('CDF')
        axes[0, 1].set_xlabel('t')

        axes[0, 2].plot(x, self._sf(x))
        axes[0, 2].set_title('SF')
        axes[0, 2].set_xlabel('t')

        axes[1, 0].plot(x, self._hf(x))
        axes[1, 0].set_title('HF')
        axes[1, 0].set_xlabel('t')

        axes[1, 1].plot(x, self._chf(x))
        axes[1, 1].set_title('CHF')
        axes[1, 1].set_xlabel('t')

        axes[1, 2].axis('off')
        stats_text = f"Mean: {self.mean:.4f}\nMedian: {self.median:.4f}\nVariance: {self.variance:.4f}\nStd Dev: {self.standard_deviation:.4f}"
        axes[1, 2].text(0.1, 0.5, stats_text, transform=axes[1, 2].transAxes,
                        fontsize=12, verticalalignment='center', family='monospace')

        plt.tight_layout()
        return fig


class Weibull_Distribution(_Distribution):
    """Weibull distribution (2P or 3P).

    Parameters
    ----------
    eta : float
        Scale parameter (characteristic life). Must be > 0.
    beta : float
        Shape parameter. Must be > 0.
    gamma : float, optional
        Location parameter (default 0). Must be >= 0.
    """

    def __init__(self, eta, beta, gamma=0):
        if eta <= 0:
            raise ValueError("eta must be > 0")
        if beta <= 0:
            raise ValueError("beta must be > 0")
        if gamma < 0:
            raise ValueError("gamma must be >= 0")
        self.eta = eta
        self.beta = beta
        self.gamma = gamma
        self.name = 'Weibull_2P' if gamma == 0 else 'Weibull_3P'
        self.num_params = 2 if gamma == 0 else 3
        self._scipy = ss.weibull_min(c=beta, scale=eta, loc=gamma)

    @classmethod
    def _from_params(cls, params):
        if len(params) == 2:
            return cls(eta=params[0], beta=params[1])
        return cls(eta=params[0], beta=params[1], gamma=params[2])

    def _pdf(self, x):
        x = np.asarray(x, dtype=float)
        return self._scipy.pdf(x)

    def _cdf(self, x):
        x = np.asarray(x, dtype=float)
        return self._scipy.cdf(x)

    def _sf(self, x):
        x = np.asarray(x, dtype=float)
        return self._scipy.sf(x)

    def quantile(self, q):
        return self._scipy.ppf(q)

    def random_samples(self, n, seed=None):
        return self._scipy.rvs(size=n, random_state=seed)

    @property
    def mean(self):
        return self._scipy.mean()

    @property
    def variance(self):
        return self._scipy.var()

    def __repr__(self):
        if self.gamma == 0:
            return f"Weibull_2P(eta={self.eta}, beta={self.beta})"
        return f"Weibull_3P(eta={self.eta}, beta={self.beta}, gamma={self.gamma})"


class Exponential_Distribution(_Distribution):
    """Exponential distribution (1P or 2P).

    Parameters
    ----------
    Lambda : float
        Rate parameter (failure rate). Must be > 0.
    gamma : float, optional
        Location parameter (default 0). Must be >= 0.
    """

    def __init__(self, Lambda, gamma=0):
        if Lambda <= 0:
            raise ValueError("Lambda must be > 0")
        if gamma < 0:
            raise ValueError("gamma must be >= 0")
        self.Lambda = Lambda
        self.gamma = gamma
        self.name = 'Exponential_1P' if gamma == 0 else 'Exponential_2P'
        self.num_params = 1 if gamma == 0 else 2
        self._scipy = ss.expon(scale=1.0 / Lambda, loc=gamma)

    @classmethod
    def _from_params(cls, params):
        if len(params) == 1:
            return cls(Lambda=params[0])
        return cls(Lambda=params[0], gamma=params[1])

    def _pdf(self, x):
        return self._scipy.pdf(np.asarray(x, dtype=float))

    def _cdf(self, x):
        return self._scipy.cdf(np.asarray(x, dtype=float))

    def _sf(self, x):
        return self._scipy.sf(np.asarray(x, dtype=float))

    def quantile(self, q):
        return self._scipy.ppf(q)

    def random_samples(self, n, seed=None):
        return self._scipy.rvs(size=n, random_state=seed)

    @property
    def mean(self):
        return self._scipy.mean()

    @property
    def variance(self):
        return self._scipy.var()

    def __repr__(self):
        if self.gamma == 0:
            return f"Exponential_1P(Lambda={self.Lambda})"
        return f"Exponential_2P(Lambda={self.Lambda}, gamma={self.gamma})"


class Normal_Distribution(_Distribution):
    """Normal distribution.

    Parameters
    ----------
    mu : float
        Mean (location parameter).
    sigma : float
        Standard deviation (scale parameter). Must be > 0.
    """

    def __init__(self, mu, sigma):
        if sigma <= 0:
            raise ValueError("sigma must be > 0")
        self.mu = mu
        self.sigma = sigma
        self.name = 'Normal_2P'
        self.num_params = 2
        self._scipy = ss.norm(loc=mu, scale=sigma)

    @classmethod
    def _from_params(cls, params):
        return cls(mu=params[0], sigma=params[1])

    def _pdf(self, x):
        return self._scipy.pdf(np.asarray(x, dtype=float))

    def _cdf(self, x):
        return self._scipy.cdf(np.asarray(x, dtype=float))

    def _sf(self, x):
        return self._scipy.sf(np.asarray(x, dtype=float))

    def quantile(self, q):
        return self._scipy.ppf(q)

    def random_samples(self, n, seed=None):
        return self._scipy.rvs(size=n, random_state=seed)

    @property
    def mean(self):
        return self.mu

    @property
    def variance(self):
        return self.sigma ** 2

    def __repr__(self):
        return f"Normal_2P(mu={self.mu}, sigma={self.sigma})"


class Lognormal_Distribution(_Distribution):
    """Lognormal distribution (2P or 3P).

    Parameters
    ----------
    mu : float
        Mean of the log of the data.
    sigma : float
        Standard deviation of the log of the data. Must be > 0.
    gamma : float, optional
        Location parameter (default 0). Must be >= 0.
    """

    def __init__(self, mu, sigma, gamma=0):
        if sigma <= 0:
            raise ValueError("sigma must be > 0")
        if gamma < 0:
            raise ValueError("gamma must be >= 0")
        self.mu = mu
        self.sigma = sigma
        self.gamma = gamma
        self.name = 'Lognormal_2P' if gamma == 0 else 'Lognormal_3P'
        self.num_params = 2 if gamma == 0 else 3
        self._scipy = ss.lognorm(s=sigma, scale=np.exp(mu), loc=gamma)

    @classmethod
    def _from_params(cls, params):
        if len(params) == 2:
            return cls(mu=params[0], sigma=params[1])
        return cls(mu=params[0], sigma=params[1], gamma=params[2])

    def _pdf(self, x):
        return self._scipy.pdf(np.asarray(x, dtype=float))

    def _cdf(self, x):
        return self._scipy.cdf(np.asarray(x, dtype=float))

    def _sf(self, x):
        return self._scipy.sf(np.asarray(x, dtype=float))

    def quantile(self, q):
        return self._scipy.ppf(q)

    def random_samples(self, n, seed=None):
        return self._scipy.rvs(size=n, random_state=seed)

    @property
    def mean(self):
        return self._scipy.mean()

    @property
    def variance(self):
        return self._scipy.var()

    def __repr__(self):
        if self.gamma == 0:
            return f"Lognormal_2P(mu={self.mu}, sigma={self.sigma})"
        return f"Lognormal_3P(mu={self.mu}, sigma={self.sigma}, gamma={self.gamma})"


class Gamma_Distribution(_Distribution):
    """Gamma distribution (2P or 3P).

    Parameters
    ----------
    alpha : float
        Shape parameter. Must be > 0.
    beta : float
        Scale parameter. Must be > 0.
    gamma : float, optional
        Location parameter (default 0). Must be >= 0.
    """

    def __init__(self, alpha, beta, gamma=0):
        if alpha <= 0:
            raise ValueError("alpha must be > 0")
        if beta <= 0:
            raise ValueError("beta must be > 0")
        if gamma < 0:
            raise ValueError("gamma must be >= 0")
        self.alpha = alpha
        self.beta = beta
        self.gamma = gamma
        self.name = 'Gamma_2P' if gamma == 0 else 'Gamma_3P'
        self.num_params = 2 if gamma == 0 else 3
        self._scipy = ss.gamma(a=alpha, scale=beta, loc=gamma)

    @classmethod
    def _from_params(cls, params):
        if len(params) == 2:
            return cls(alpha=params[0], beta=params[1])
        return cls(alpha=params[0], beta=params[1], gamma=params[2])

    def _pdf(self, x):
        return self._scipy.pdf(np.asarray(x, dtype=float))

    def _cdf(self, x):
        return self._scipy.cdf(np.asarray(x, dtype=float))

    def _sf(self, x):
        return self._scipy.sf(np.asarray(x, dtype=float))

    def quantile(self, q):
        return self._scipy.ppf(q)

    def random_samples(self, n, seed=None):
        return self._scipy.rvs(size=n, random_state=seed)

    @property
    def mean(self):
        return self._scipy.mean()

    @property
    def variance(self):
        return self._scipy.var()

    def __repr__(self):
        if self.gamma == 0:
            return f"Gamma_2P(alpha={self.alpha}, beta={self.beta})"
        return f"Gamma_3P(alpha={self.alpha}, beta={self.beta}, gamma={self.gamma})"


class Loglogistic_Distribution(_Distribution):
    """Log-logistic distribution (2P or 3P).

    Parameters
    ----------
    alpha : float
        Scale parameter. Must be > 0.
    beta : float
        Shape parameter. Must be > 0.
    gamma : float, optional
        Location parameter (default 0). Must be >= 0.
    """

    def __init__(self, alpha, beta, gamma=0):
        if alpha <= 0:
            raise ValueError("alpha must be > 0")
        if beta <= 0:
            raise ValueError("beta must be > 0")
        if gamma < 0:
            raise ValueError("gamma must be >= 0")
        self.alpha = alpha
        self.beta = beta
        self.gamma = gamma
        self.name = 'Loglogistic_2P' if gamma == 0 else 'Loglogistic_3P'
        self.num_params = 2 if gamma == 0 else 3
        self._scipy = ss.fisk(c=beta, scale=alpha, loc=gamma)

    @classmethod
    def _from_params(cls, params):
        if len(params) == 2:
            return cls(alpha=params[0], beta=params[1])
        return cls(alpha=params[0], beta=params[1], gamma=params[2])

    def _pdf(self, x):
        return self._scipy.pdf(np.asarray(x, dtype=float))

    def _cdf(self, x):
        return self._scipy.cdf(np.asarray(x, dtype=float))

    def _sf(self, x):
        return self._scipy.sf(np.asarray(x, dtype=float))

    def quantile(self, q):
        return self._scipy.ppf(q)

    def random_samples(self, n, seed=None):
        return self._scipy.rvs(size=n, random_state=seed)

    @property
    def mean(self):
        return self._scipy.mean()

    @property
    def variance(self):
        return self._scipy.var()

    def __repr__(self):
        if self.gamma == 0:
            return f"Loglogistic_2P(alpha={self.alpha}, beta={self.beta})"
        return f"Loglogistic_3P(alpha={self.alpha}, beta={self.beta}, gamma={self.gamma})"


class Beta_Distribution(_Distribution):
    """Beta distribution.

    Parameters
    ----------
    alpha : float
        Shape parameter a. Must be > 0.
    beta : float
        Shape parameter b. Must be > 0.
    """

    def __init__(self, alpha, beta):
        if alpha <= 0:
            raise ValueError("alpha must be > 0")
        if beta <= 0:
            raise ValueError("beta must be > 0")
        self.alpha = alpha
        self.beta = beta
        self.name = 'Beta_2P'
        self.num_params = 2
        self._scipy = ss.beta(a=alpha, b=beta)

    @classmethod
    def _from_params(cls, params):
        return cls(alpha=params[0], beta=params[1])

    def _pdf(self, x):
        return self._scipy.pdf(np.asarray(x, dtype=float))

    def _cdf(self, x):
        return self._scipy.cdf(np.asarray(x, dtype=float))

    def _sf(self, x):
        return self._scipy.sf(np.asarray(x, dtype=float))

    def quantile(self, q):
        return self._scipy.ppf(q)

    def random_samples(self, n, seed=None):
        return self._scipy.rvs(size=n, random_state=seed)

    @property
    def mean(self):
        return self._scipy.mean()

    @property
    def variance(self):
        return self._scipy.var()

    def __repr__(self):
        return f"Beta_2P(alpha={self.alpha}, beta={self.beta})"


class Gumbel_Distribution(_Distribution):
    """Gumbel distribution (minimum extreme value / Type I).

    Parameters
    ----------
    mu : float
        Location parameter.
    sigma : float
        Scale parameter. Must be > 0.
    """

    def __init__(self, mu, sigma):
        if sigma <= 0:
            raise ValueError("sigma must be > 0")
        self.mu = mu
        self.sigma = sigma
        self.name = 'Gumbel_2P'
        self.num_params = 2
        self._scipy = ss.gumbel_l(loc=mu, scale=sigma)

    @classmethod
    def _from_params(cls, params):
        return cls(mu=params[0], sigma=params[1])

    def _pdf(self, x):
        return self._scipy.pdf(np.asarray(x, dtype=float))

    def _cdf(self, x):
        return self._scipy.cdf(np.asarray(x, dtype=float))

    def _sf(self, x):
        return self._scipy.sf(np.asarray(x, dtype=float))

    def quantile(self, q):
        return self._scipy.ppf(q)

    def random_samples(self, n, seed=None):
        return self._scipy.rvs(size=n, random_state=seed)

    @property
    def mean(self):
        return self._scipy.mean()

    @property
    def variance(self):
        return self._scipy.var()

    def __repr__(self):
        return f"Gumbel_2P(mu={self.mu}, sigma={self.sigma})"


# Mapping from distribution name strings to classes
DISTRIBUTION_CLASSES = {
    'Weibull_2P': Weibull_Distribution,
    'Weibull_3P': Weibull_Distribution,
    'Exponential_1P': Exponential_Distribution,
    'Exponential_2P': Exponential_Distribution,
    'Normal_2P': Normal_Distribution,
    'Lognormal_2P': Lognormal_Distribution,
    'Lognormal_3P': Lognormal_Distribution,
    'Gamma_2P': Gamma_Distribution,
    'Gamma_3P': Gamma_Distribution,
    'Loglogistic_2P': Loglogistic_Distribution,
    'Loglogistic_3P': Loglogistic_Distribution,
    'Beta_2P': Beta_Distribution,
    'Gumbel_2P': Gumbel_Distribution,
}

ALL_DISTRIBUTION_NAMES = list(DISTRIBUTION_CLASSES.keys())
