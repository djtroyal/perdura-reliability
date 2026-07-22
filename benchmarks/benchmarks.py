from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
for source_path in (ROOT, ROOT / "src"):
    value = str(source_path)
    if value not in sys.path:
        sys.path.insert(0, value)

from tools.performance_workloads import (
    descriptive_large,
    distribution_comparison,
    distribution_vector,
    weibull_fit,
)


class TimeScientificWorkloads:
    repeat = 3
    number = 1
    warmup_time = 0.25
    timeout = 300

    def time_distribution_vector_100k(self):
        distribution_vector()

    def time_descriptive_summary_10k(self):
        descriptive_large()

    def time_weibull_mle_250_observations(self):
        weibull_fit()

    def time_distribution_comparison_4_candidates(self):
        distribution_comparison()
