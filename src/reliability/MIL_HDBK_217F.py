"""
Electronic failure rate prediction per MIL-HDBK-217F Notice 2, with an
ANSI/VITA 51.1 adjustment mode for COTS hardware.

Implements the part stress analysis method for the most common part
categories. Each part class computes a predicted failure rate ``lambda_p``
in failures per million hours (FPMH) as a product of a base failure rate
and pi factors:

- ``Microcircuit``           lambda_p = (C1*piT + C2*piE) * piQ * piL
- ``Diode``                  lambda_p = lb * piT * piS * piC * piQ * piE
- ``BipolarTransistor``      lambda_p = lb * piT * piA * piR * piS * piQ * piE
- ``FieldEffectTransistor``  lambda_p = lb * piT * piA * piQ * piE
- ``Resistor``               lambda_p = lb * piR * piQ * piE
- ``Capacitor``              lambda_p = lb * piT * piC * piV * piSR * piQ * piE
- ``GenericPart``            user-supplied lambda_p (vendor data or other
                             MIL-HDBK-217F sections not modelled here)

``SystemFailureRate`` rolls a parts list up to a system failure rate, MTBF,
and mission reliability (series system, constant failure rates).

ANSI/VITA 51.1 mode
-------------------
ANSI/VITA 51.1 ("Reliability Prediction MIL-HDBK-217 Subsidiary
Specification") amends MIL-HDBK-217F with standardized assumptions that
remove known pessimism for modern screened COTS parts. Passing
``standard='VITA-51.1'`` to a part applies the adjustments in
``VITA_51_1_PI_Q`` (reduced quality factors for commercial/plastic parts)
and forces the microcircuit learning factor piL to 1.0 (mature production).

.. note::
   The numeric values in ``VITA_51_1_PI_Q`` are representative of common
   VITA 51.1 practice. The standard itself is a licensed document; for
   formal deliverables, verify/override these factors against your copy of
   ANSI/VITA 51.1 (every part accepts an explicit ``pi_Q`` override, and
   the module-level tables may be edited).

All temperatures are in degrees Celsius. Stress ratios are operating /
rated (dimensionless, 0-1).

References: MIL-HDBK-217F Notice 2 (28 Feb 1995); ANSI/VITA 51.1-2013.
"""

import numpy as np

FPMH = "failures per 10^6 hours"
BOLTZMANN_EV = 8.617e-5  # eV/K

# MIL-HDBK-217F environment codes (Table 3-2)
ENVIRONMENTS = ['GB', 'GF', 'GM', 'NS', 'NU', 'AIC', 'AIF',
                'AUC', 'AUF', 'ARW', 'SF', 'MF', 'ML', 'CL']

ENVIRONMENT_DESCRIPTIONS = {
    'GB': 'Ground, Benign', 'GF': 'Ground, Fixed', 'GM': 'Ground, Mobile',
    'NS': 'Naval, Sheltered', 'NU': 'Naval, Unsheltered',
    'AIC': 'Airborne, Inhabited Cargo', 'AIF': 'Airborne, Inhabited Fighter',
    'AUC': 'Airborne, Uninhabited Cargo', 'AUF': 'Airborne, Uninhabited Fighter',
    'ARW': 'Airborne, Rotary Wing', 'SF': 'Space, Flight',
    'MF': 'Missile, Flight', 'ML': 'Missile, Launch', 'CL': 'Cannon, Launch',
}

STANDARDS = ('MIL-HDBK-217F', 'VITA-51.1')

# Representative ANSI/VITA 51.1 quality-factor adjustments for screened
# COTS parts (see module docstring caveat). Keyed by part category, then
# by the 217F quality level being adjusted.
VITA_51_1_PI_Q = {
    'microcircuit': {'commercial': 2.0},
    'diode': {'plastic': 3.0, 'lower': 3.0},
    'transistor': {'plastic': 3.0, 'lower': 3.0},
    'resistor': {'commercial': 3.0, 'non-ER': 3.0},
    'capacitor': {'commercial': 3.0, 'non-ER': 3.0},
}


def _check_environment(environment):
    if environment not in ENVIRONMENTS:
        raise ValueError(f"environment must be one of {ENVIRONMENTS}, "
                         f"got '{environment}'")


def _check_standard(standard):
    if standard not in STANDARDS:
        raise ValueError(f"standard must be one of {STANDARDS}, "
                         f"got '{standard}'")


def _check_stress(value, name):
    if not 0 <= value <= 1:
        raise ValueError(f"{name} must be a ratio between 0 and 1, got {value}")


def _env_table(values):
    return dict(zip(ENVIRONMENTS, values))


def arrhenius_pi_T(T_junction, Ea, scale=1.0, T_ref=298.0):
    """Arrhenius temperature factor:
    scale * exp(-Ea/k * (1/(T+273) - 1/T_ref))."""
    return scale * np.exp(-Ea / BOLTZMANN_EV
                          * (1.0 / (T_junction + 273.0) - 1.0 / T_ref))


class _Part:
    """Base for all 217F parts. Subclasses set failure_rate (FPMH per
    part), pi_factors (dict), and category."""

    category = 'part'

    def __init__(self, name=None, quantity=1):
        if quantity < 1 or int(quantity) != quantity:
            raise ValueError("quantity must be a positive integer")
        self.name = name or self.__class__.__name__
        self.quantity = int(quantity)
        self.failure_rate = 0.0
        self.pi_factors = {}

    @property
    def total_failure_rate(self):
        return self.failure_rate * self.quantity

    def __repr__(self):
        return (f"{self.__class__.__name__}(name='{self.name}', "
                f"failure_rate={self.failure_rate:.6f} FPMH, "
                f"quantity={self.quantity})")


# ---------------------------------------------------------------------------
# Microcircuits (MIL-HDBK-217F section 5.1)
# ---------------------------------------------------------------------------

# C1 die complexity failure rates: (upper_complexity_bound, C1)
_C1_DIGITAL = {
    'bipolar': [(100, 0.0025), (1000, 0.0050), (3000, 0.010),
                (10000, 0.020), (30000, 0.040), (60000, 0.080)],
    'mos': [(100, 0.010), (1000, 0.020), (3000, 0.040),
            (10000, 0.080), (30000, 0.16), (60000, 0.29)],
}
_C1_LINEAR = [(100, 0.010), (300, 0.020), (1000, 0.040), (10000, 0.060)]
_C1_MICROPROCESSOR = {
    'bipolar': [(8, 0.060), (16, 0.12), (32, 0.24)],
    'mos': [(8, 0.14), (16, 0.28), (32, 0.56)],
}

# C2 package factors: C2 = a * Np^b
_C2_PACKAGE = {
    'hermetic_dip': (2.8e-4, 1.08),   # solder/weld seal DIP, PGA, SMT
    'glass_dip': (9.0e-5, 1.51),
    'flatpack': (3.0e-5, 1.82),
    'can': (3.0e-5, 2.01),
    'nonhermetic': (3.6e-4, 1.08),    # nonhermetic DIP, PGA, SMT
}

_PI_E_MICROCIRCUIT = _env_table([0.5, 2.0, 4.0, 4.0, 6.0, 4.0, 5.0,
                                 5.0, 8.0, 8.0, 0.5, 5.0, 12.0, 220.0])
_PI_Q_MICROCIRCUIT = {'S': 0.25, 'B': 1.0, 'B-1': 2.0, 'commercial': 10.0}

# Activation energies (eV) for piT
_EA_MICROCIRCUIT = {
    ('digital', 'mos'): 0.35,
    ('digital', 'bipolar'): 0.40,
    ('microprocessor', 'mos'): 0.35,
    ('microprocessor', 'bipolar'): 0.40,
    ('linear', 'mos'): 0.65,
    ('linear', 'bipolar'): 0.65,
}


def _lookup_band(table, value, what):
    for bound, c1 in table:
        if value <= bound:
            return c1
    raise ValueError(f"{what} = {value} exceeds the maximum supported "
                     f"value of {table[-1][0]}")


class Microcircuit(_Part):
    """Monolithic microcircuit (217F 5.1):
    lambda_p = (C1*piT + C2*piE) * piQ * piL.

    Parameters
    ----------
    device_type : 'digital' | 'linear' | 'microprocessor'
    technology : 'mos' | 'bipolar'
    complexity : int
        Gate count (digital), transistor count (linear), or bus width in
        bits (microprocessor).
    pins : int
        Package pin count (for C2).
    package : str
        One of 'hermetic_dip', 'glass_dip', 'flatpack', 'can', 'nonhermetic'.
    T_junction : float
        Worst-case junction temperature, deg C.
    quality : 'S' | 'B' | 'B-1' | 'commercial'
    years_in_production : float
        Production maturity for the learning factor piL.
    environment : str
        217F environment code (see ENVIRONMENTS).
    standard : 'MIL-HDBK-217F' | 'VITA-51.1'
    pi_Q : float, optional
        Explicit quality factor override.
    """

    category = 'microcircuit'

    def __init__(self, device_type='digital', technology='mos',
                 complexity=1000, pins=16, package='nonhermetic',
                 T_junction=50.0, quality='commercial',
                 years_in_production=2.0, environment='GB',
                 standard='MIL-HDBK-217F', pi_Q=None,
                 name=None, quantity=1):
        super().__init__(name=name, quantity=quantity)
        _check_environment(environment)
        _check_standard(standard)

        if device_type == 'digital':
            if technology not in _C1_DIGITAL:
                raise ValueError("technology must be 'mos' or 'bipolar'")
            C1 = _lookup_band(_C1_DIGITAL[technology], complexity, 'gate count')
        elif device_type == 'linear':
            C1 = _lookup_band(_C1_LINEAR, complexity, 'transistor count')
        elif device_type == 'microprocessor':
            if technology not in _C1_MICROPROCESSOR:
                raise ValueError("technology must be 'mos' or 'bipolar'")
            C1 = _lookup_band(_C1_MICROPROCESSOR[technology], complexity,
                              'bus width (bits)')
        else:
            raise ValueError("device_type must be 'digital', 'linear', "
                             "or 'microprocessor'")

        if package not in _C2_PACKAGE:
            raise ValueError(f"package must be one of {list(_C2_PACKAGE)}")
        a, b = _C2_PACKAGE[package]
        C2 = a * pins ** b

        Ea = _EA_MICROCIRCUIT[(device_type,
                               technology if technology in ('mos', 'bipolar')
                               else 'mos')]
        pi_T = arrhenius_pi_T(T_junction, Ea, scale=0.1)

        if quality not in _PI_Q_MICROCIRCUIT:
            raise ValueError(f"quality must be one of {list(_PI_Q_MICROCIRCUIT)}")
        if pi_Q is None:
            pi_Q = _PI_Q_MICROCIRCUIT[quality]
            if standard == 'VITA-51.1':
                pi_Q = VITA_51_1_PI_Q['microcircuit'].get(quality, pi_Q)

        if standard == 'VITA-51.1':
            pi_L = 1.0  # mature production assumed for fielded COTS
        else:
            pi_L = max(1.0, 0.01 * np.exp(5.35 - 0.35 * years_in_production))

        pi_E = _PI_E_MICROCIRCUIT[environment]

        self.pi_factors = {'C1': C1, 'C2': round(C2, 6), 'pi_T': round(float(pi_T), 6),
                           'pi_E': pi_E, 'pi_Q': pi_Q, 'pi_L': round(float(pi_L), 4)}
        self.failure_rate = float((C1 * pi_T + C2 * pi_E) * pi_Q * pi_L)


# ---------------------------------------------------------------------------
# Diodes, low frequency (217F 6.1)
# ---------------------------------------------------------------------------

# type: (lambda_b, T-coefficient for piT, voltage stress applies)
_DIODE_TYPES = {
    'general_purpose': (0.0038, 3091, True),
    'switching': (0.0010, 3091, True),
    'power_rectifier': (0.0030, 3091, True),
    'fast_recovery_rectifier': (0.069, 3091, True),
    'schottky': (0.0030, 3091, True),
    'zener_regulator': (0.0020, 1925, False),
    'voltage_reference': (0.0020, 1925, False),
    'transient_suppressor': (0.0013, 3091, False),
}

_PI_E_DISCRETE = _env_table([1.0, 6.0, 9.0, 9.0, 19.0, 13.0, 29.0,
                             20.0, 43.0, 24.0, 0.5, 14.0, 32.0, 320.0])
_PI_Q_DISCRETE = {'JANTXV': 0.7, 'JANTX': 1.0, 'JAN': 2.4,
                  'lower': 5.5, 'plastic': 8.0}
_PI_C_CONTACT = {'bonded': 1.0, 'spring': 2.0}


def _discrete_pi_Q(category, quality, standard, pi_Q):
    if quality not in _PI_Q_DISCRETE:
        raise ValueError(f"quality must be one of {list(_PI_Q_DISCRETE)}")
    if pi_Q is not None:
        return pi_Q
    q = _PI_Q_DISCRETE[quality]
    if standard == 'VITA-51.1':
        q = VITA_51_1_PI_Q[category].get(quality, q)
    return q


class Diode(_Part):
    """Low-frequency diode (217F 6.1):
    lambda_p = lb * piT * piS * piC * piQ * piE.

    voltage_stress is applied reverse voltage / rated reverse voltage
    (ignored for regulator/reference/suppressor types). contact is
    'bonded' (metallurgical) or 'spring'.
    """

    category = 'diode'

    def __init__(self, diode_type='general_purpose', T_junction=50.0,
                 voltage_stress=0.5, contact='bonded', quality='plastic',
                 environment='GB', standard='MIL-HDBK-217F', pi_Q=None,
                 name=None, quantity=1):
        super().__init__(name=name, quantity=quantity)
        _check_environment(environment)
        _check_standard(standard)
        _check_stress(voltage_stress, 'voltage_stress')
        if diode_type not in _DIODE_TYPES:
            raise ValueError(f"diode_type must be one of {list(_DIODE_TYPES)}")
        if contact not in _PI_C_CONTACT:
            raise ValueError("contact must be 'bonded' or 'spring'")

        lam_b, t_coeff, stress_applies = _DIODE_TYPES[diode_type]
        pi_T = np.exp(-t_coeff * (1.0 / (T_junction + 273.0) - 1.0 / 298.0))
        if stress_applies:
            pi_S = voltage_stress ** 2.43 if voltage_stress > 0.3 else 0.054
        else:
            pi_S = 1.0
        pi_C = _PI_C_CONTACT[contact]
        pi_Q = _discrete_pi_Q('diode', quality, standard, pi_Q)
        pi_E = _PI_E_DISCRETE[environment]

        self.pi_factors = {'lambda_b': lam_b, 'pi_T': round(float(pi_T), 6),
                           'pi_S': round(float(pi_S), 6), 'pi_C': pi_C,
                           'pi_Q': pi_Q, 'pi_E': pi_E}
        self.failure_rate = float(lam_b * pi_T * pi_S * pi_C * pi_Q * pi_E)


# ---------------------------------------------------------------------------
# Transistors (217F 6.3 bipolar, 6.4 FET — low frequency)
# ---------------------------------------------------------------------------

class BipolarTransistor(_Part):
    """Low-frequency bipolar transistor (217F 6.3):
    lambda_p = lb * piT * piA * piR * piS * piQ * piE.

    rated_power in watts; voltage_stress = VCE applied / VCEO rated.
    """

    category = 'transistor'

    def __init__(self, application='switching', rated_power=0.5,
                 voltage_stress=0.5, T_junction=50.0, quality='plastic',
                 environment='GB', standard='MIL-HDBK-217F', pi_Q=None,
                 name=None, quantity=1):
        super().__init__(name=name, quantity=quantity)
        _check_environment(environment)
        _check_standard(standard)
        _check_stress(voltage_stress, 'voltage_stress')
        if application not in ('linear', 'switching'):
            raise ValueError("application must be 'linear' or 'switching'")
        if rated_power <= 0:
            raise ValueError("rated_power must be > 0")

        lam_b = 0.00074
        pi_T = np.exp(-2114 * (1.0 / (T_junction + 273.0) - 1.0 / 298.0))
        pi_A = 1.5 if application == 'linear' else 0.7
        pi_R = max(rated_power, 0.1) ** 0.37
        pi_S = 0.045 * np.exp(3.1 * voltage_stress)
        pi_Q = _discrete_pi_Q('transistor', quality, standard, pi_Q)
        pi_E = _PI_E_DISCRETE[environment]

        self.pi_factors = {'lambda_b': lam_b, 'pi_T': round(float(pi_T), 6),
                           'pi_A': pi_A, 'pi_R': round(float(pi_R), 6),
                           'pi_S': round(float(pi_S), 6), 'pi_Q': pi_Q,
                           'pi_E': pi_E}
        self.failure_rate = float(lam_b * pi_T * pi_A * pi_R * pi_S
                                  * pi_Q * pi_E)


_FET_PI_A = {'linear': 1.5, 'switching': 0.7, 'power_2_5W': 2.0,
             'power_5_50W': 4.0, 'power_50_250W': 8.0, 'power_gt_250W': 10.0}
_FET_LAMBDA_B = {'mosfet': 0.012, 'jfet': 0.0045}


class FieldEffectTransistor(_Part):
    """Low-frequency FET (217F 6.4):
    lambda_p = lb * piT * piA * piQ * piE."""

    category = 'transistor'

    def __init__(self, fet_type='mosfet', application='switching',
                 T_junction=50.0, quality='plastic', environment='GB',
                 standard='MIL-HDBK-217F', pi_Q=None,
                 name=None, quantity=1):
        super().__init__(name=name, quantity=quantity)
        _check_environment(environment)
        _check_standard(standard)
        if fet_type not in _FET_LAMBDA_B:
            raise ValueError("fet_type must be 'mosfet' or 'jfet'")
        if application not in _FET_PI_A:
            raise ValueError(f"application must be one of {list(_FET_PI_A)}")

        lam_b = _FET_LAMBDA_B[fet_type]
        pi_T = np.exp(-1925 * (1.0 / (T_junction + 273.0) - 1.0 / 298.0))
        pi_A = _FET_PI_A[application]
        pi_Q = _discrete_pi_Q('transistor', quality, standard, pi_Q)
        pi_E = _PI_E_DISCRETE[environment]

        self.pi_factors = {'lambda_b': lam_b, 'pi_T': round(float(pi_T), 6),
                           'pi_A': pi_A, 'pi_Q': pi_Q, 'pi_E': pi_E}
        self.failure_rate = float(lam_b * pi_T * pi_A * pi_Q * pi_E)


# ---------------------------------------------------------------------------
# Resistors (217F 9.1 composition, 9.2 film)
# ---------------------------------------------------------------------------

_PI_E_RESISTOR = {
    'film': _env_table([1.0, 2.0, 8.0, 4.0, 14.0, 4.0, 8.0,
                        10.0, 18.0, 19.0, 0.2, 10.0, 28.0, 510.0]),
    'composition': _env_table([1.0, 3.0, 8.0, 5.0, 13.0, 5.0, 8.0,
                               12.0, 19.0, 18.0, 0.5, 8.0, 22.0, 330.0]),
}
_PI_Q_RESISTOR = {'S': 0.03, 'R': 0.1, 'P': 0.3, 'M': 1.0,
                  'non-ER': 5.0, 'commercial': 15.0}
# resistance factor piR: (upper bound in ohms, piR)
_PI_R_RESISTANCE = [(1e5, 1.0), (1e6, 1.1), (1e7, 1.6), (np.inf, 2.5)]


class Resistor(_Part):
    """Fixed resistor (217F 9.1/9.2): lambda_p = lb * piR * piQ * piE.

    style: 'film' (MIL-R-10509/22684 etc.) or 'composition' (MIL-R-11).
    power_stress = operating power / rated power. T_ambient in deg C.
    """

    category = 'resistor'

    def __init__(self, style='film', resistance=10e3, power_stress=0.5,
                 T_ambient=40.0, quality='commercial', environment='GB',
                 standard='MIL-HDBK-217F', pi_Q=None,
                 name=None, quantity=1):
        super().__init__(name=name, quantity=quantity)
        _check_environment(environment)
        _check_standard(standard)
        _check_stress(power_stress, 'power_stress')
        if resistance <= 0:
            raise ValueError("resistance must be > 0")
        if style not in _PI_E_RESISTOR:
            raise ValueError("style must be 'film' or 'composition'")

        T_K = T_ambient + 273.0
        S = power_stress
        if style == 'composition':
            lam_b = (4.5e-9 * np.exp(12.0 * T_K / 343.0)
                     * np.exp((S / 0.6) * (T_K / 273.0)))
        else:  # film
            lam_b = (3.25e-4 * np.exp((T_K / 343.0) ** 3)
                     * np.exp(S * (T_K / 273.0)))

        pi_R = _lookup_band(_PI_R_RESISTANCE, resistance, 'resistance')
        if quality not in _PI_Q_RESISTOR:
            raise ValueError(f"quality must be one of {list(_PI_Q_RESISTOR)}")
        if pi_Q is None:
            pi_Q = _PI_Q_RESISTOR[quality]
            if standard == 'VITA-51.1':
                pi_Q = VITA_51_1_PI_Q['resistor'].get(quality, pi_Q)
        pi_E = _PI_E_RESISTOR[style][environment]

        self.pi_factors = {'lambda_b': round(float(lam_b), 8), 'pi_R': pi_R,
                           'pi_Q': pi_Q, 'pi_E': pi_E}
        self.failure_rate = float(lam_b * pi_R * pi_Q * pi_E)


# ---------------------------------------------------------------------------
# Capacitors (217F section 10, Notice 2 model)
# ---------------------------------------------------------------------------

# style: (lambda_b, Ea for piT, capacitance exponent, voltage-stress exponent)
_CAPACITOR_STYLES = {
    'ceramic': (0.00099, 0.35, 0.09, 5),
    'tantalum_solid': (0.00040, 0.15, 0.23, 17),
    'aluminum_electrolytic': (0.00012, 0.35, 0.23, 5),
    'plastic_film': (0.00051, 0.15, 0.09, 6),
}
_PI_E_CAPACITOR = _env_table([1.0, 2.0, 9.0, 5.0, 15.0, 4.0, 12.0,
                              20.0, 40.0, 29.0, 0.5, 12.0, 30.0, 570.0])
_PI_Q_CAPACITOR = {'S': 0.03, 'R': 0.1, 'P': 0.3, 'M': 1.0, 'L': 1.5,
                   'non-ER': 3.0, 'commercial': 10.0}
# Tantalum series-resistance factor: (min ohms per volt, piSR)
_PI_SR_TANTALUM = [(0.8, 0.66), (0.6, 1.0), (0.4, 1.3),
                   (0.2, 2.0), (0.1, 2.7), (0.0, 3.3)]


class Capacitor(_Part):
    """Fixed capacitor (217F section 10):
    lambda_p = lb * piT * piC * piV * piSR * piQ * piE.

    capacitance in microfarads; voltage_stress = applied / rated voltage;
    circuit_resistance in ohms per volt (tantalum_solid only, sets piSR).
    """

    category = 'capacitor'

    def __init__(self, style='ceramic', capacitance=0.1, voltage_stress=0.5,
                 T_ambient=40.0, circuit_resistance=1.0, quality='commercial',
                 environment='GB', standard='MIL-HDBK-217F', pi_Q=None,
                 name=None, quantity=1):
        super().__init__(name=name, quantity=quantity)
        _check_environment(environment)
        _check_standard(standard)
        _check_stress(voltage_stress, 'voltage_stress')
        if capacitance <= 0:
            raise ValueError("capacitance must be > 0 (microfarads)")
        if style not in _CAPACITOR_STYLES:
            raise ValueError(f"style must be one of {list(_CAPACITOR_STYLES)}")

        lam_b, Ea, c_exp, v_exp = _CAPACITOR_STYLES[style]
        pi_T = arrhenius_pi_T(T_ambient, Ea)
        pi_C = capacitance ** c_exp
        pi_V = (voltage_stress / 0.6) ** v_exp + 1.0

        if style == 'tantalum_solid':
            pi_SR = next(sr for bound, sr in _PI_SR_TANTALUM
                         if circuit_resistance > bound or bound == 0.0)
        else:
            pi_SR = 1.0

        if quality not in _PI_Q_CAPACITOR:
            raise ValueError(f"quality must be one of {list(_PI_Q_CAPACITOR)}")
        if pi_Q is None:
            pi_Q = _PI_Q_CAPACITOR[quality]
            if standard == 'VITA-51.1':
                pi_Q = VITA_51_1_PI_Q['capacitor'].get(quality, pi_Q)
        pi_E = _PI_E_CAPACITOR[environment]

        self.pi_factors = {'lambda_b': lam_b, 'pi_T': round(float(pi_T), 6),
                           'pi_C': round(float(pi_C), 6),
                           'pi_V': round(float(pi_V), 6), 'pi_SR': pi_SR,
                           'pi_Q': pi_Q, 'pi_E': pi_E}
        self.failure_rate = float(lam_b * pi_T * pi_C * pi_V * pi_SR
                                  * pi_Q * pi_E)


# ---------------------------------------------------------------------------
# Generic / user-specified parts and the system rollup
# ---------------------------------------------------------------------------

class GenericPart(_Part):
    """A part with a user-supplied failure rate in FPMH (e.g. vendor data,
    field data, or a MIL-HDBK-217F section not modelled here)."""

    category = 'generic'

    def __init__(self, failure_rate, name=None, quantity=1):
        super().__init__(name=name, quantity=quantity)
        if failure_rate < 0:
            raise ValueError("failure_rate must be >= 0")
        self.failure_rate = float(failure_rate)
        self.pi_factors = {}


class SystemFailureRate:
    """Series-system rollup of a 217F parts list.

    Attributes
    ----------
    total_failure_rate : float
        Sum of part failure rates x quantities, FPMH.
    mtbf : float
        Mean time between failures, hours (1e6 / total_failure_rate).
    """

    def __init__(self, parts):
        if not parts:
            raise ValueError("parts list must not be empty")
        self.parts = list(parts)
        self.total_failure_rate = float(
            sum(p.total_failure_rate for p in self.parts))
        self.mtbf = (np.inf if self.total_failure_rate == 0
                     else 1e6 / self.total_failure_rate)

    def reliability(self, t_hours):
        """Mission reliability R(t) = exp(-lambda * t) for constant
        failure rate. t_hours may be scalar or array."""
        t = np.asarray(t_hours, dtype=float)
        R = np.exp(-self.total_failure_rate * t / 1e6)
        return float(R) if R.ndim == 0 else R

    @property
    def results(self):
        """Per-part breakdown as a list of dicts."""
        rows = []
        for p in self.parts:
            contribution = (p.total_failure_rate / self.total_failure_rate
                            if self.total_failure_rate > 0 else 0.0)
            rows.append({
                'name': p.name, 'category': p.category,
                'quantity': p.quantity,
                'failure_rate': round(p.failure_rate, 6),
                'total_failure_rate': round(p.total_failure_rate, 6),
                'contribution': round(contribution, 4),
                'pi_factors': p.pi_factors,
            })
        return rows

    def __repr__(self):
        return (f"SystemFailureRate(total={self.total_failure_rate:.4f} FPMH, "
                f"MTBF={self.mtbf:.1f} h, parts={len(self.parts)})")
