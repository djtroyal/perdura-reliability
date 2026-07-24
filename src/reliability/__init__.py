"""Public Perdura calculation package.

Read the release declaration as data before importing its module.  CPython's
timestamp-based bytecode cache uses integer-second mtime and source size; a
same-length version bump performed within one timestamp second can otherwise
make a stale ``_version.pyc`` report the previous release.
"""

from importlib.metadata import PackageNotFoundError, version as distribution_version
from pathlib import Path
import re


def _runtime_version() -> str:
    try:
        source = Path(__file__).with_name("_version.py").read_text(encoding="utf-8")
        match = re.fullmatch(r'__version__\s*=\s*"([^"]+)"\s*', source)
        if match:
            return match.group(1)
    except OSError:
        pass
    try:
        return distribution_version("perdura")
    except PackageNotFoundError:
        # Frozen/minimal environments may retain the module without source or
        # distribution metadata. This is the final compatibility fallback.
        from reliability._version import __version__ as stamped_version
        return stamped_version


__version__ = _runtime_version()

# Importing a submodule first still initializes this package. Normalize the
# declaration module in memory so ``reliability._version.__version__`` cannot
# expose a stale same-size bytecode cache to callers after package startup.
from reliability import _version as _version_module
_version_module.__version__ = __version__
del _version_module

from reliability import Distributions
from reliability import Fitters
from reliability import Grouped_life
from reliability import Special_models
from reliability import ALT_fitters
from reliability import Reliability_testing
from reliability import MIL_HDBK_217F
from reliability import MIL_STD_975M
from reliability import RADC_TR_84_254
from reliability import RADC_TR_85_91
from reliability import RL_TR_92_11
from reliability import Nonparametric
from reliability import Probability_plotting
from reliability import Repairable_systems
from reliability import Warranty
from reliability import SystemReliability
from reliability import FaultTree
from reliability import Utils
from reliability import Uncertainty
from reliability import Standards
from reliability import Dependencies
from reliability import Software_reliability
from reliability import Growth_planning
from reliability import Reliability_program
from reliability import AIAG_VDA_FMEA
