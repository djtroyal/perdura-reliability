"""Quantity-aware stress/strength request, with legacy unitless compatibility."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator

UNIT_FACTORS = {
    'time': {'seconds': 1, 'minutes': 60, 'hours': 3600, 'days': 86400,
             'weeks': 604800, 'months': 2629746, 'years': 31556952},
    'cycles': {'cycles': 1},
    'distance': {'mm': .001, 'cm': .01, 'm': 1, 'km': 1000,
                 'inches': .0254, 'feet': .3048, 'miles': 1609.344},
    'pressure': {'Pa': 1, 'kPa': 1000, 'MPa': 1e6, 'GPa': 1e9, 'bar': 1e5,
                 'psi': 6894.757293168, 'ksi': 6894757.293168},
    'force': {'N': 1, 'kN': 1000, 'MN': 1e6, 'lbf': 4.4482216152605},
    'dimensionless': {'1': 1},
}


class DatasetQuantity(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['time', 'cycles', 'distance', 'pressure', 'force', 'dimensionless', 'custom']
    unit: str

    @model_validator(mode='after')
    def valid_unit(self):
        self.unit = self.unit.strip()
        if not self.unit or (self.kind != 'custom' and self.unit not in UNIT_FACTORS[self.kind]):
            raise ValueError('Choose a supported quantity unit or a nonempty custom unit.')
        return self


def quantity_factor(source: DatasetQuantity, target: DatasetQuantity) -> float:
    if source.kind != target.kind:
        raise ValueError('Stress and strength must have compatible quantities.')
    if source.kind == 'custom':
        if source.unit != target.unit:
            raise ValueError('Custom quantities require the exact same unit label.')
        return 1.0
    return UNIT_FACTORS[source.kind][source.unit] / UNIT_FACTORS[target.kind][target.unit]


class StressStrengthRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    stress_distribution: str
    stress_params: dict[str, float]
    strength_distribution: str
    strength_params: dict[str, float]
    stress_quantity: DatasetQuantity | None = None
    strength_quantity: DatasetQuantity | None = None
    evaluation_quantity: DatasetQuantity | None = None

    @model_validator(mode='after')
    def compatible_quantities(self):
        if self.stress_quantity is None and self.strength_quantity is None:
            if self.evaluation_quantity is not None:
                raise ValueError('Supply both source quantities when choosing an evaluation unit.')
            return self
        if self.stress_quantity is None or self.strength_quantity is None:
            raise ValueError('Supply both stress and strength quantities.')
        target = self.evaluation_quantity or self.stress_quantity
        quantity_factor(self.stress_quantity, target)
        quantity_factor(self.strength_quantity, target)
        return self
