"""
Electronic failure rate prediction per MIL-HDBK-217F Notice 2, with an
ANSI/VITA 51.1 adjustment mode for COTS hardware.

Implements the part stress analysis method for all part categories in
Sections 5-23 of the handbook. Each part class computes a predicted
failure rate ``lambda_p`` in failures per million hours (FPMH) as a
product of a base failure rate and pi factors.

Part categories
---------------
- ``Microcircuit``           Section 5.1: lambda_p = (C1*piT + C2*piE) * piQ * piL
- ``Diode``                  Section 6.1: lambda_p = lb * piT * piS * piC * piQ * piE
- ``HFDiode``                Section 6.5: lambda_p = lb * piT * piA * piR * piQ * piE
- ``BipolarTransistor``      Section 6.3: lambda_p = lb * piT * piA * piR * piS * piQ * piE
- ``FieldEffectTransistor``  Section 6.4: lambda_p = lb * piT * piA * piQ * piE
- ``GaAsFET``                Section 6.8: lambda_p = lb * piT * piA * piM * piQ * piE
- ``UnijunctionTransistor``  Section 6.10: lambda_p = lb * piT * piQ * piE
- ``Thyristor``              Section 6.2: lambda_p = lb * piT * piR * piS * piQ * piE
- ``Optoelectronic``         Section 6.11-6.13: lambda_p = lb * piT * piQ * piE
- ``Tube``                   Section 7: various models
- ``Laser``                  Section 8: lambda_p = lb * piT * piI * piA * piU * piE
- ``Resistor``               Section 9: lambda_p = lb * piT * piP * piS * piR * piQ * piE
- ``Capacitor``              Section 10: lambda_p = lb * piT * piC * piV * piSR * piQ * piE
- ``InductiveDevice``        Section 11: lambda_p = lb(T) * piQ * piE
- ``RotatingDevice``         Section 12: various models
- ``Relay``                  Section 13.1: lambda_p = lb * piL * piC * piCYC * piF * piQ * piE
- ``SolidStateRelay``        Section 13.2: lambda_p = lb * piT * piS * piQ * piE
- ``Switch``                 Section 14.1: lambda_p = lb * piL * piQ * piE
- ``CircuitBreaker``         Section 14.2: lambda_p = lb * piC * piU * piQ * piE
- ``Connector``              Section 15: lambda_p = lb * piT * piK * piP * piQ * piE
- ``PCB``                    Section 16: lambda_p = lb * piQ * piE
- ``Connection``             Section 17: lambda_p = lb * piE
- ``Meter``                  Section 18: lambda_p = lb * piF * piQ * piE
- ``QuartzCrystal``          Section 19: lambda_p = 0.013*f^0.23 * piQ * piE
- ``Lamp``                   Section 20: lambda_p = lb(V) * piU * piE
- ``ElectronicFilter``       Section 21: lambda_p = 0.022 * piQ * piE
- ``Fuse``                   Section 22: lambda_p = 0.010 * piE
- ``CustomPart``             user-supplied exponential/Weibull rate
- ``GenericPart``            user-supplied lambda_p

``SystemFailureRate`` rolls a parts list up to a system failure rate,
MTBF, and mission reliability (series system, constant failure rates).

ANSI/VITA 51.1 mode
-------------------
ANSI/VITA 51.1 ("Reliability Prediction MIL-HDBK-217 Subsidiary
Specification") amends MIL-HDBK-217F with standardized assumptions that
remove known pessimism for modern screened COTS parts. Passing
``standard='VITA-51.1'`` to a part applies the adjustments in
``VITA_51_1_PI_Q`` and forces the microcircuit learning factor piL to 1.0.

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
    """Base for all 217F parts."""

    category = 'part'

    def __init__(self, name=None, quantity=1, multiplier=1.0):
        if quantity < 1 or int(quantity) != quantity:
            raise ValueError("quantity must be a positive integer")
        if multiplier <= 0:
            raise ValueError("multiplier must be > 0")
        self.name = name or self.__class__.__name__
        self.quantity = int(quantity)
        self.multiplier = float(multiplier)
        self._base_failure_rate = 0.0
        self.pi_factors = {}

    @property
    def failure_rate(self):
        return self._base_failure_rate * self.multiplier

    @failure_rate.setter
    def failure_rate(self, value):
        self._base_failure_rate = float(value)

    @property
    def total_failure_rate(self):
        return self.failure_rate * self.quantity

    def __repr__(self):
        return (f"{self.__class__.__name__}(name='{self.name}', "
                f"failure_rate={self.failure_rate:.6f} FPMH, "
                f"quantity={self.quantity})")


# ===================================================================
# Section 5 — Microcircuits
# ===================================================================

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
_C1_MEMORY = {
    'bipolar': [(16000, 0.0085), (64000, 0.017), (256000, 0.034),
                (1000000, 0.068)],
    'mos': [(16000, 0.0060), (64000, 0.012), (256000, 0.024),
            (1000000, 0.048)],
}

_C2_PACKAGE = {
    'hermetic_dip': (2.8e-4, 1.08),
    'glass_dip': (9.0e-5, 1.51),
    'flatpack': (3.0e-5, 1.82),
    'can': (3.0e-5, 2.01),
    'nonhermetic': (3.6e-4, 1.08),
}

_PI_E_MICROCIRCUIT = _env_table([0.5, 2.0, 4.0, 4.0, 6.0, 4.0, 5.0,
                                 5.0, 8.0, 8.0, 0.5, 5.0, 12.0, 220.0])
_PI_Q_MICROCIRCUIT = {'S': 0.25, 'B': 1.0, 'B-1': 2.0, 'commercial': 10.0}

_EA_MICROCIRCUIT = {
    ('digital', 'mos'): 0.35,
    ('digital', 'bipolar'): 0.40,
    ('microprocessor', 'mos'): 0.35,
    ('microprocessor', 'bipolar'): 0.40,
    ('linear', 'mos'): 0.65,
    ('linear', 'bipolar'): 0.65,
    ('memory', 'mos'): 0.35,
    ('memory', 'bipolar'): 0.40,
}


def _lookup_band(table, value, what):
    for bound, c1 in table:
        if value <= bound:
            return c1
    raise ValueError(f"{what} = {value} exceeds the maximum supported "
                     f"value of {table[-1][0]}")


class Microcircuit(_Part):
    """Monolithic microcircuit (217F 5.1-5.4):
    lambda_p = (C1*piT + C2*piE) * piQ * piL.

    Parameters
    ----------
    device_type : 'digital' | 'linear' | 'microprocessor' | 'memory'
    technology : 'mos' | 'bipolar'
    complexity : int
        Gate count (digital), transistor count (linear), bus width in
        bits (microprocessor), or bit count (memory).
    pins : int
    package : str
    T_junction : float
    quality : 'S' | 'B' | 'B-1' | 'commercial'
    years_in_production : float
    environment : str
    standard : 'MIL-HDBK-217F' | 'VITA-51.1'
    pi_Q : float, optional
    """

    category = 'microcircuit'

    def __init__(self, device_type='digital', technology='mos',
                 complexity=1000, pins=16, package='nonhermetic',
                 T_junction=50.0, quality='commercial',
                 years_in_production=2.0, environment='GB',
                 standard='MIL-HDBK-217F', pi_Q=None,
                 name=None, quantity=1, multiplier=1.0):
        super().__init__(name=name, quantity=quantity, multiplier=multiplier)
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
        elif device_type == 'memory':
            if technology not in _C1_MEMORY:
                raise ValueError("technology must be 'mos' or 'bipolar'")
            C1 = _lookup_band(_C1_MEMORY[technology], complexity,
                              'bit count')
        else:
            raise ValueError("device_type must be 'digital', 'linear', "
                             "'microprocessor', or 'memory'")

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
            pi_L = 1.0
        else:
            pi_L = max(1.0, 0.01 * np.exp(5.35 - 0.35 * years_in_production))

        pi_E = _PI_E_MICROCIRCUIT[environment]

        self.pi_factors = {'C1': C1, 'C2': round(C2, 6), 'pi_T': round(float(pi_T), 6),
                           'pi_E': pi_E, 'pi_Q': pi_Q, 'pi_L': round(float(pi_L), 4)}
        self.failure_rate = float((C1 * pi_T + C2 * pi_E) * pi_Q * pi_L)


# Section 5.5 — Hybrid Microcircuits
_PI_E_HYBRID = _PI_E_MICROCIRCUIT

class HybridMicrocircuit(_Part):
    """Hybrid microcircuit (217F 5.5):
    lambda_p = [sum(Ni * lambda_ci)] * (1 + 0.2*piE) * piF * piQ * piL.

    sum_Ni_lambda_ci is the pre-computed sum of (quantity x failure rate)
    of all die elements in the hybrid.
    """

    category = 'microcircuit'

    def __init__(self, sum_Ni_lambda_ci=0.01, T_junction=50.0,
                 quality='commercial', years_in_production=2.0,
                 environment='GB', standard='MIL-HDBK-217F', pi_Q=None,
                 function_factor=1.0,
                 name=None, quantity=1, multiplier=1.0):
        super().__init__(name=name, quantity=quantity, multiplier=multiplier)
        _check_environment(environment)
        _check_standard(standard)

        if quality not in _PI_Q_MICROCIRCUIT:
            raise ValueError(f"quality must be one of {list(_PI_Q_MICROCIRCUIT)}")
        if pi_Q is None:
            pi_Q = _PI_Q_MICROCIRCUIT[quality]
            if standard == 'VITA-51.1':
                pi_Q = VITA_51_1_PI_Q['microcircuit'].get(quality, pi_Q)

        if standard == 'VITA-51.1':
            pi_L = 1.0
        else:
            pi_L = max(1.0, 0.01 * np.exp(5.35 - 0.35 * years_in_production))

        pi_E = _PI_E_HYBRID[environment]
        pi_F = max(function_factor, 1.0)

        self.pi_factors = {'sum_Ni_lambda_ci': round(sum_Ni_lambda_ci, 8),
                           'pi_E': pi_E, 'pi_F': pi_F,
                           'pi_Q': pi_Q, 'pi_L': round(float(pi_L), 4)}
        self.failure_rate = float(
            sum_Ni_lambda_ci * (1.0 + 0.2 * pi_E) * pi_F * pi_Q * pi_L)


# ===================================================================
# Section 6 — Semiconductors
# ===================================================================

# --- 6.1 Low-frequency diodes ---

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
        q = VITA_51_1_PI_Q.get(category, {}).get(quality, q)
    return q


class Diode(_Part):
    """Low-frequency diode (217F 6.1):
    lambda_p = lb * piT * piS * piC * piQ * piE."""

    category = 'diode'

    def __init__(self, diode_type='general_purpose', T_junction=50.0,
                 voltage_stress=0.5, contact='bonded', quality='plastic',
                 environment='GB', standard='MIL-HDBK-217F', pi_Q=None,
                 name=None, quantity=1, multiplier=1.0):
        super().__init__(name=name, quantity=quantity, multiplier=multiplier)
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


# --- 6.5 HF / Microwave diodes ---

_HF_DIODE_TYPES = {
    'varactor': 0.0020,
    'step_recovery': 0.0025,
    'gunn': 0.0055,
    'impatt': 0.014,
    'tunnel': 0.0025,
    'pin': 0.0014,
    'mixer': 0.0020,
    'detector': 0.0020,
}

_PI_E_HF_DIODE = _env_table([1.0, 6.0, 9.0, 9.0, 19.0, 13.0, 29.0,
                              20.0, 43.0, 24.0, 0.5, 14.0, 32.0, 320.0])

_HF_DIODE_PI_A = {'oscillator': 2.5, 'mixer': 2.0, 'detector': 1.0,
                   'amplifier': 1.5, 'switch': 1.0}


class HFDiode(_Part):
    """HF/microwave diode (217F 6.5):
    lambda_p = lb * piT * piA * piR * piQ * piE.

    rated_power in watts; application affects piA.
    """

    category = 'hf_diode'

    def __init__(self, diode_type='varactor', application='detector',
                 rated_power=0.5, T_junction=50.0, quality='plastic',
                 environment='GB', standard='MIL-HDBK-217F', pi_Q=None,
                 name=None, quantity=1, multiplier=1.0):
        super().__init__(name=name, quantity=quantity, multiplier=multiplier)
        _check_environment(environment)
        _check_standard(standard)
        if diode_type not in _HF_DIODE_TYPES:
            raise ValueError(f"diode_type must be one of {list(_HF_DIODE_TYPES)}")
        if application not in _HF_DIODE_PI_A:
            raise ValueError(f"application must be one of {list(_HF_DIODE_PI_A)}")

        lam_b = _HF_DIODE_TYPES[diode_type]
        pi_T = np.exp(-3091 * (1.0 / (T_junction + 273.0) - 1.0 / 298.0))
        pi_A = _HF_DIODE_PI_A[application]
        pi_R = max(rated_power, 0.1) ** 0.37
        pi_Q = _discrete_pi_Q('diode', quality, standard, pi_Q)
        pi_E = _PI_E_HF_DIODE[environment]

        self.pi_factors = {'lambda_b': lam_b, 'pi_T': round(float(pi_T), 6),
                           'pi_A': pi_A, 'pi_R': round(float(pi_R), 6),
                           'pi_Q': pi_Q, 'pi_E': pi_E}
        self.failure_rate = float(lam_b * pi_T * pi_A * pi_R * pi_Q * pi_E)


# --- 6.3 Bipolar transistors (low frequency) ---

class BipolarTransistor(_Part):
    """Low-frequency bipolar transistor (217F 6.3):
    lambda_p = lb * piT * piA * piR * piS * piQ * piE."""

    category = 'transistor'

    def __init__(self, application='switching', rated_power=0.5,
                 voltage_stress=0.5, T_junction=50.0, quality='plastic',
                 environment='GB', standard='MIL-HDBK-217F', pi_Q=None,
                 name=None, quantity=1, multiplier=1.0):
        super().__init__(name=name, quantity=quantity, multiplier=multiplier)
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


# --- 6.4 FET (low frequency, Si) ---

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
                 name=None, quantity=1, multiplier=1.0):
        super().__init__(name=name, quantity=quantity, multiplier=multiplier)
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


# --- 6.8/6.9 GaAs FET (microwave) ---

_GAAS_FET_LAMBDA_B = {'low_power': 0.052, 'power': 0.20}
_GAAS_FET_PI_A = {'low_noise': 0.5, 'driver': 1.0, 'power': 4.0, 'switch': 0.5}
_GAAS_FET_PI_M = {'jfet': 1.0, 'mesfet': 2.0, 'hemt': 2.0, 'phemt': 2.0}


class GaAsFET(_Part):
    """GaAs FET / MMIC (217F 6.8-6.9):
    lambda_p = lb * piT * piA * piM * piQ * piE."""

    category = 'gaas_fet'

    def __init__(self, power_class='low_power', application='low_noise',
                 matching='mesfet', T_junction=50.0, quality='plastic',
                 environment='GB', standard='MIL-HDBK-217F', pi_Q=None,
                 name=None, quantity=1, multiplier=1.0):
        super().__init__(name=name, quantity=quantity, multiplier=multiplier)
        _check_environment(environment)
        _check_standard(standard)
        if power_class not in _GAAS_FET_LAMBDA_B:
            raise ValueError(f"power_class must be one of {list(_GAAS_FET_LAMBDA_B)}")
        if application not in _GAAS_FET_PI_A:
            raise ValueError(f"application must be one of {list(_GAAS_FET_PI_A)}")
        if matching not in _GAAS_FET_PI_M:
            raise ValueError(f"matching must be one of {list(_GAAS_FET_PI_M)}")

        lam_b = _GAAS_FET_LAMBDA_B[power_class]
        pi_T = np.exp(-4485 * (1.0 / (T_junction + 273.0) - 1.0 / 298.0))
        pi_A = _GAAS_FET_PI_A[application]
        pi_M = _GAAS_FET_PI_M[matching]
        pi_Q = _discrete_pi_Q('transistor', quality, standard, pi_Q)
        pi_E = _PI_E_DISCRETE[environment]

        self.pi_factors = {'lambda_b': lam_b, 'pi_T': round(float(pi_T), 6),
                           'pi_A': pi_A, 'pi_M': pi_M, 'pi_Q': pi_Q,
                           'pi_E': pi_E}
        self.failure_rate = float(lam_b * pi_T * pi_A * pi_M * pi_Q * pi_E)


# --- 6.10 Unijunction transistor ---

class UnijunctionTransistor(_Part):
    """Unijunction transistor (217F 6.10):
    lambda_p = lb * piT * piQ * piE."""

    category = 'transistor'

    def __init__(self, T_junction=50.0, quality='plastic', environment='GB',
                 standard='MIL-HDBK-217F', pi_Q=None,
                 name=None, quantity=1, multiplier=1.0):
        super().__init__(name=name, quantity=quantity, multiplier=multiplier)
        _check_environment(environment)
        _check_standard(standard)

        lam_b = 0.0083
        pi_T = np.exp(-2114 * (1.0 / (T_junction + 273.0) - 1.0 / 298.0))
        pi_Q = _discrete_pi_Q('transistor', quality, standard, pi_Q)
        pi_E = _PI_E_DISCRETE[environment]

        self.pi_factors = {'lambda_b': lam_b, 'pi_T': round(float(pi_T), 6),
                           'pi_Q': pi_Q, 'pi_E': pi_E}
        self.failure_rate = float(lam_b * pi_T * pi_Q * pi_E)


# --- 6.2 Thyristors / SCR ---

class Thyristor(_Part):
    """Thyristor / SCR (217F 6.2):
    lambda_p = lb * piT * piR * piS * piQ * piE."""

    category = 'thyristor'

    def __init__(self, rated_current=1.0, voltage_stress=0.5, T_junction=50.0,
                 quality='plastic', environment='GB', standard='MIL-HDBK-217F',
                 pi_Q=None, name=None, quantity=1, multiplier=1.0):
        super().__init__(name=name, quantity=quantity, multiplier=multiplier)
        _check_environment(environment)
        _check_standard(standard)
        _check_stress(voltage_stress, 'voltage_stress')
        if rated_current <= 0:
            raise ValueError("rated_current must be > 0")

        lam_b = 0.0022
        pi_T = np.exp(-3082 * (1.0 / (T_junction + 273.0) - 1.0 / 298.0))
        pi_R = max(rated_current, 0.05) ** 0.40
        pi_S = max(voltage_stress, 0.3) ** 1.9
        pi_Q = _discrete_pi_Q('transistor', quality, standard, pi_Q)
        pi_E = _PI_E_DISCRETE[environment]

        self.pi_factors = {'lambda_b': lam_b, 'pi_T': round(float(pi_T), 6),
                           'pi_R': round(float(pi_R), 6),
                           'pi_S': round(float(pi_S), 6),
                           'pi_Q': pi_Q, 'pi_E': pi_E}
        self.failure_rate = float(lam_b * pi_T * pi_R * pi_S * pi_Q * pi_E)


# --- 6.11-6.13 Optoelectronics ---

_OPTO_LAMBDA_B = {
    'led': 0.00023,
    'photodiode': 0.0010,
    'phototransistor': 0.0055,
    'optocoupler': 0.013,
    'alphanumeric_display': 0.00043,
}


class Optoelectronic(_Part):
    """Optoelectronic device (217F 6.11-6.13):
    lambda_p = lb * piT * piQ * piE."""

    category = 'optoelectronic'

    def __init__(self, device='led', T_junction=50.0, quality='plastic',
                 environment='GB', standard='MIL-HDBK-217F', pi_Q=None,
                 name=None, quantity=1, multiplier=1.0):
        super().__init__(name=name, quantity=quantity, multiplier=multiplier)
        _check_environment(environment)
        _check_standard(standard)
        if device not in _OPTO_LAMBDA_B:
            raise ValueError(f"device must be one of {list(_OPTO_LAMBDA_B)}")

        lam_b = _OPTO_LAMBDA_B[device]
        pi_T = np.exp(-2790 * (1.0 / (T_junction + 273.0) - 1.0 / 298.0))
        pi_Q = _discrete_pi_Q('transistor', quality, standard, pi_Q)
        pi_E = _PI_E_DISCRETE[environment]

        self.pi_factors = {'lambda_b': lam_b, 'pi_T': round(float(pi_T), 6),
                           'pi_Q': pi_Q, 'pi_E': pi_E}
        self.failure_rate = float(lam_b * pi_T * pi_Q * pi_E)


# ===================================================================
# Section 7 — Tubes (electron devices)
# ===================================================================

_TUBE_TYPES = {
    'triode': 0.0060,
    'tetrode': 0.0080,
    'pentode': 0.010,
    'klystron': 0.10,
    'traveling_wave_tube': 0.60,
    'magnetron': 2.5,
    'crt': 0.020,
    'vidicon': 0.040,
    'thyratron': 0.30,
    'cross_field_amplifier': 1.5,
}

_PI_E_TUBE = _env_table([1.0, 2.0, 10.0, 6.0, 16.0, 5.0, 8.0,
                         9.0, 12.0, 22.0, 0.5, 14.0, 32.0, 320.0])

_TUBE_PI_U = {'continuous': 1.0, 'pulsed': 0.7}


class Tube(_Part):
    """Vacuum tube / electron device (217F Section 7):
    lambda_p = lb * piU * piA * piE.

    For most types, piU = piA = 1. Magnetrons and CFA use piU (usage)
    and piA (application). TWT and klystron use cumulative hours.
    """

    category = 'tube'

    def __init__(self, tube_type='pentode', usage='continuous',
                 utilization_factor=1.0,
                 environment='GB', standard='MIL-HDBK-217F', pi_Q=None,
                 name=None, quantity=1, multiplier=1.0):
        super().__init__(name=name, quantity=quantity, multiplier=multiplier)
        _check_environment(environment)
        _check_standard(standard)
        if tube_type not in _TUBE_TYPES:
            raise ValueError(f"tube_type must be one of {list(_TUBE_TYPES)}")

        lam_b = _TUBE_TYPES[tube_type]
        pi_E = _PI_E_TUBE[environment]

        pi_U = 1.0
        if tube_type in ('magnetron', 'cross_field_amplifier', 'traveling_wave_tube'):
            pi_U = _TUBE_PI_U.get(usage, 1.0)

        pi_A = max(utilization_factor, 0.1)

        self.pi_factors = {'lambda_b': lam_b, 'pi_U': pi_U,
                           'pi_A': round(float(pi_A), 4), 'pi_E': pi_E}
        self.failure_rate = float(lam_b * pi_U * pi_A * pi_E)


# ===================================================================
# Section 8 — Lasers
# ===================================================================

_LASER_TYPES = {
    'helium_neon': 0.50,
    'argon': 3.0,
    'carbon_dioxide': 1.5,
    'solid_state_nd_yag': 2.0,
    'semiconductor_cw': 0.030,
    'semiconductor_pulsed': 0.020,
}

_PI_E_LASER = _env_table([1.0, 4.0, 12.0, 6.0, 16.0, 5.0, 8.0,
                          10.0, 14.0, 20.0, 0.5, 10.0, 24.0, 300.0])

_LASER_PI_I = {'single_mode': 1.0, 'multimode': 1.5, 'q_switched': 3.0}
_LASER_PI_A = {'communications': 1.0, 'rangefinding': 2.0, 'tracking': 1.5,
               'weapons': 4.0, 'illumination': 1.0, 'display': 1.0}


class Laser(_Part):
    """Laser device (217F Section 8):
    lambda_p = lb * piT * piI * piA * piU * piE.

    T_case is case temperature (deg C); piI depends on mode structure;
    piA depends on application; piU is a utilization duty-cycle factor
    (0-1 range, 1 = continuous).
    """

    category = 'laser'

    def __init__(self, laser_type='semiconductor_cw', mode='single_mode',
                 application='communications', T_case=40.0, duty_cycle=1.0,
                 environment='GB', standard='MIL-HDBK-217F', pi_Q=None,
                 name=None, quantity=1, multiplier=1.0):
        super().__init__(name=name, quantity=quantity, multiplier=multiplier)
        _check_environment(environment)
        _check_standard(standard)
        if laser_type not in _LASER_TYPES:
            raise ValueError(f"laser_type must be one of {list(_LASER_TYPES)}")
        if mode not in _LASER_PI_I:
            raise ValueError(f"mode must be one of {list(_LASER_PI_I)}")
        if application not in _LASER_PI_A:
            raise ValueError(f"application must be one of {list(_LASER_PI_A)}")

        lam_b = _LASER_TYPES[laser_type]

        if laser_type.startswith('semiconductor'):
            pi_T = np.exp(-4635 * (1.0 / (T_case + 273.0) - 1.0 / 298.0))
        else:
            pi_T = np.exp(-1925 * (1.0 / (T_case + 273.0) - 1.0 / 298.0))

        pi_I = _LASER_PI_I[mode]
        pi_A = _LASER_PI_A[application]
        pi_U = max(duty_cycle, 0.1)
        pi_E = _PI_E_LASER[environment]

        self.pi_factors = {'lambda_b': lam_b, 'pi_T': round(float(pi_T), 6),
                           'pi_I': pi_I, 'pi_A': pi_A,
                           'pi_U': round(float(pi_U), 4), 'pi_E': pi_E}
        self.failure_rate = float(lam_b * pi_T * pi_I * pi_A * pi_U * pi_E)


# ===================================================================
# Section 9 — Resistors
# ===================================================================

# style: (description, lambda_b, Ea_eV, piS_column)
# piS_column 1: 0.71*exp(1.1*S)  (composition / film)
# piS_column 2: 0.54*exp(2.04*S) (wirewound / thermistor)
_RESISTOR_STYLES = {
    'RC': ('Composition, Fixed', 0.0037, 0.2, 1),
    'RCR': ('Composition, Fixed, ER', 0.0037, 0.2, 1),
    'RL': ('Film, Fixed', 0.0023, 0.2, 1),
    'RLR': ('Film, Fixed, ER', 0.0023, 0.2, 1),
    'RN': ('Film, Fixed, High Stability', 0.0023, 0.2, 1),
    'RNR': ('Film, Fixed, High Stability, ER', 0.0023, 0.2, 1),
    'RNC': ('Film, Noninsulated, ER', 0.0023, 0.2, 1),
    'RD': ('Film, Power', 0.0065, 0.2, 1),
    'RM': ('Film, Chip', 0.0024, 0.2, 1),
    'RZ': ('Film, Network, Fixed', 0.0023, 0.2, 1),
    'RW': ('Wirewound, Fixed', 0.0085, 0.08, 2),
    'RWR': ('Wirewound, Fixed, ER', 0.0085, 0.08, 2),
    'RE': ('Wirewound, Power', 0.014, 0.08, 2),
    'RER': ('Wirewound, Power, ER', 0.014, 0.08, 2),
    'RB': ('Wirewound, Power, Accurate', 0.023, 0.08, 2),
    'RBR': ('Wirewound, Power, Accurate, ER', 0.023, 0.08, 2),
    'RTH': ('Thermistor', 0.0085, 0.08, 2),
    'RT': ('Variable, Composition', 0.013, 0.2, 1),
    'RJ': ('Variable, Composition, Non-ER', 0.013, 0.2, 1),
    'RR': ('Variable, Film', 0.013, 0.2, 1),
    'RVC': ('Variable, Composition, Non-ER', 0.013, 0.2, 1),
    'RVR': ('Variable, Film, Non-ER', 0.013, 0.2, 1),
    'RA': ('Variable, Wirewound', 0.016, 0.08, 2),
    'RK': ('Variable, Wirewound, Power', 0.016, 0.08, 2),
    'RP': ('Variable, Wirewound, Precision', 0.028, 0.08, 2),
    'RQ': ('Variable, Wirewound, ER', 0.028, 0.08, 2),
    # Backward-compatible aliases
    'film': ('Film, Fixed (alias)', 0.0023, 0.2, 1),
    'composition': ('Composition, Fixed (alias)', 0.0037, 0.2, 1),
    'wirewound': ('Wirewound, Fixed (alias)', 0.0085, 0.08, 2),
    'wirewound_power': ('Wirewound, Power (alias)', 0.014, 0.08, 2),
    'chip': ('Film, Chip (alias)', 0.0024, 0.2, 1),
    'network': ('Film, Network (alias)', 0.0023, 0.2, 1),
    'thermistor': ('Thermistor (alias)', 0.0085, 0.08, 2),
    'variable_film': ('Variable, Film (alias)', 0.013, 0.2, 1),
    'variable_wirewound': ('Variable, Wirewound (alias)', 0.016, 0.08, 2),
    'variable_composition': ('Variable, Composition (alias)', 0.013, 0.2, 1),
}

_RESISTOR_VARIABLE_STYLES = {
    'RT', 'RJ', 'RR', 'RVC', 'RVR', 'RA', 'RK', 'RP', 'RQ',
    'variable_film', 'variable_wirewound', 'variable_composition',
}

# piR — resistance factor (same for all fixed resistor styles)
_PI_R_RESISTANCE = [(1e5, 1.0), (1e6, 1.1), (1e7, 1.6), (np.inf, 2.5)]

_PI_Q_RESISTOR = {'S': 0.03, 'R': 0.1, 'P': 0.3, 'M': 1.0,
                  'non-ER': 5.0, 'commercial': 15.0}

_PI_E_RESISTOR_FILM = _env_table([1.0, 2.0, 8.0, 4.0, 14.0, 4.0, 8.0,
                                  10.0, 18.0, 19.0, 0.2, 10.0, 28.0, 510.0])
_PI_E_RESISTOR_COMPOSITION = _env_table([1.0, 3.0, 8.0, 5.0, 13.0, 5.0, 8.0,
                                         12.0, 19.0, 18.0, 0.5, 8.0, 22.0, 330.0])
_PI_E_RESISTOR_WIREWOUND = _env_table([1.0, 2.0, 10.0, 5.0, 17.0, 6.0, 8.0,
                                       14.0, 18.0, 25.0, 0.3, 14.0, 36.0, 660.0])
_PI_E_RESISTOR_THERMISTOR = _env_table([1.0, 3.0, 13.0, 6.0, 19.0, 7.0, 10.0,
                                        14.0, 22.0, 28.0, 0.5, 16.0, 42.0, 770.0])

def _resistor_pi_E(style, environment):
    if style in ('RTH', 'thermistor'):
        return _PI_E_RESISTOR_THERMISTOR[environment]
    _, _, Ea, piS_col = _RESISTOR_STYLES[style]
    if piS_col == 2 and style not in ('RTH', 'thermistor'):
        return _PI_E_RESISTOR_WIREWOUND[environment]
    if style.startswith('RC') or style == 'composition':
        return _PI_E_RESISTOR_COMPOSITION[environment]
    return _PI_E_RESISTOR_FILM[environment]


class Resistor(_Part):
    """Fixed or variable resistor (217F Section 9):
    lambda_p = lb * piT * piP * piS * piR * piQ * piE.

    Parameters
    ----------
    style : str
        MIL-R designation ('RC', 'RL', 'RW', 'RM', 'RTH', etc.) or a
        backward-compatible alias ('film', 'composition', 'wirewound',
        'chip', 'thermistor', 'variable_film', 'variable_wirewound',
        'variable_composition', 'wirewound_power', 'network').
    resistance : float
        Nominal resistance in ohms (for piR factor).
    power_stress : float
        Ratio of operating power to rated power (0-1). Sets piS.
    rated_power : float
        Rated power dissipation in watts (for piP factor).
    T_ambient : float
        Ambient temperature in deg C.
    n_taps : int
        Number of taps (variable resistors only; sets piTAPS).
    quality : str
    environment : str
    """

    category = 'resistor'

    def __init__(self, style='film', resistance=10e3, power_stress=0.5,
                 rated_power=0.5, T_ambient=40.0, n_taps=0,
                 quality='commercial', environment='GB',
                 standard='MIL-HDBK-217F', pi_Q=None,
                 name=None, quantity=1, multiplier=1.0):
        super().__init__(name=name, quantity=quantity, multiplier=multiplier)
        _check_environment(environment)
        _check_standard(standard)
        _check_stress(power_stress, 'power_stress')
        if resistance <= 0:
            raise ValueError("resistance must be > 0")
        if rated_power <= 0:
            raise ValueError("rated_power must be > 0")
        if style not in _RESISTOR_STYLES:
            raise ValueError(f"style must be one of {list(_RESISTOR_STYLES)}")

        _desc, lam_b, Ea, piS_col = _RESISTOR_STYLES[style]

        pi_T = arrhenius_pi_T(T_ambient, Ea)
        pi_P = rated_power ** 0.39

        S = power_stress
        if piS_col == 1:
            pi_S = 0.71 * np.exp(1.1 * S)
        else:
            pi_S = 0.54 * np.exp(2.04 * S)

        pi_R = _lookup_band(_PI_R_RESISTANCE, resistance, 'resistance')

        pi_TAPS = 1.0
        is_variable = style in _RESISTOR_VARIABLE_STYLES
        if is_variable and n_taps > 0:
            pi_TAPS = n_taps ** 1.5

        if quality not in _PI_Q_RESISTOR:
            raise ValueError(f"quality must be one of {list(_PI_Q_RESISTOR)}")
        if pi_Q is None:
            pi_Q = _PI_Q_RESISTOR[quality]
            if standard == 'VITA-51.1':
                pi_Q = VITA_51_1_PI_Q['resistor'].get(quality, pi_Q)

        pi_E = _resistor_pi_E(style, environment)

        self.pi_factors = {
            'lambda_b': lam_b, 'pi_T': round(float(pi_T), 6),
            'pi_P': round(float(pi_P), 6), 'pi_S': round(float(pi_S), 6),
            'pi_R': pi_R, 'pi_Q': pi_Q, 'pi_E': pi_E,
        }
        rate = lam_b * pi_T * pi_P * pi_S * pi_R * pi_Q * pi_E
        if is_variable and n_taps > 0:
            self.pi_factors['pi_TAPS'] = round(float(pi_TAPS), 4)
            rate *= pi_TAPS
        self.failure_rate = float(rate)


# ===================================================================
# Section 10 — Capacitors
# ===================================================================

# style: (description, lambda_b, Ea_eV, cap_exponent, voltage_exponent, has_piSR)
_CAPACITOR_STYLES = {
    'CP': ('Plastic, Fixed', 0.00051, 0.15, 0.09, 6, False),
    'CPV': ('Plastic, Film, Fixed', 0.00051, 0.15, 0.09, 6, False),
    'CA': ('Ceramic, General Purpose', 0.00099, 0.35, 0.09, 5, False),
    'CK': ('Ceramic, General Purpose, ER', 0.00099, 0.35, 0.09, 5, False),
    'CKR': ('Ceramic, ER', 0.00099, 0.35, 0.09, 5, False),
    'CDR': ('Ceramic, Chip, ER', 0.00099, 0.35, 0.09, 5, False),
    'CB': ('Ceramic, Bypass', 0.00099, 0.35, 0.09, 5, False),
    'CQ': ('Glass, Fixed', 0.00035, 0.30, 0.09, 10, False),
    'CQR': ('Glass, Fixed, ER', 0.00035, 0.30, 0.09, 10, False),
    'CY': ('Glass, Fixed', 0.00035, 0.30, 0.09, 10, False),
    'CYR': ('Glass, Fixed, ER', 0.00035, 0.30, 0.09, 10, False),
    'CM': ('Mica, Fixed, ER', 0.00023, 0.20, 0.09, 3, False),
    'CMR': ('Mica, Fixed, ER', 0.00023, 0.20, 0.09, 3, False),
    'CV': ('Mica, Fixed, Button', 0.00023, 0.20, 0.09, 3, False),
    'CFR': ('Paper/Plastic, Hermetic, ER', 0.00066, 0.20, 0.09, 3, False),
    'CRH': ('Paper/Plastic, Metallized, Hermetic', 0.00066, 0.20, 0.09, 3, False),
    'CHR': ('Metallized Plastic/Paper, Hermetic', 0.00066, 0.20, 0.09, 3, False),
    'CSR': ('Tantalum, Solid, ER', 0.00040, 0.15, 0.23, 17, True),
    'CWR': ('Tantalum, Solid, Chip, ER', 0.00040, 0.15, 0.23, 17, True),
    'CS': ('Tantalum, Solid', 0.00040, 0.15, 0.23, 17, True),
    'CL': ('Tantalum, Wet', 0.00040, 0.15, 0.23, 17, True),
    'CLR': ('Tantalum, Wet, ER', 0.00040, 0.15, 0.23, 17, True),
    'CU': ('Aluminum Electrolytic, Fixed', 0.00012, 0.35, 0.23, 5, False),
    'CUR': ('Aluminum Electrolytic, Dry', 0.00012, 0.35, 0.23, 5, False),
    'CE': ('Aluminum Electrolytic', 0.00012, 0.35, 0.23, 5, False),
    'PC': ('Variable, Piston, Ceramic', 0.00099, 0.35, 0.09, 5, False),
    'CT': ('Variable, Trimmer', 0.00099, 0.35, 0.09, 5, False),
    'CG': ('Variable, Air/Vacuum', 0.00013, 0.35, 0.09, 3, False),
    # Backward-compatible aliases
    'ceramic': ('Ceramic (alias)', 0.00099, 0.35, 0.09, 5, False),
    'tantalum_solid': ('Tantalum, Solid (alias)', 0.00040, 0.15, 0.23, 17, True),
    'tantalum_wet': ('Tantalum, Wet (alias)', 0.00040, 0.15, 0.23, 17, True),
    'aluminum_electrolytic': ('Aluminum Electrolytic (alias)', 0.00012, 0.35, 0.23, 5, False),
    'plastic_film': ('Plastic Film (alias)', 0.00051, 0.15, 0.09, 6, False),
    'mica': ('Mica (alias)', 0.00023, 0.20, 0.09, 3, False),
    'glass': ('Glass (alias)', 0.00035, 0.30, 0.09, 10, False),
    'paper': ('Paper/Plastic, Hermetic (alias)', 0.00066, 0.20, 0.09, 3, False),
    'variable_ceramic': ('Variable, Ceramic (alias)', 0.00099, 0.35, 0.09, 5, False),
    'variable_air': ('Variable, Air/Vacuum (alias)', 0.00013, 0.35, 0.09, 3, False),
}

_PI_E_CAPACITOR = _env_table([1.0, 2.0, 9.0, 5.0, 15.0, 4.0, 12.0,
                              20.0, 40.0, 29.0, 0.5, 12.0, 30.0, 570.0])
_PI_Q_CAPACITOR = {'S': 0.03, 'R': 0.1, 'P': 0.3, 'M': 1.0, 'L': 1.5,
                   'non-ER': 3.0, 'commercial': 10.0}
_PI_SR_TANTALUM = [(0.8, 0.66), (0.6, 1.0), (0.4, 1.3),
                   (0.2, 2.0), (0.1, 2.7), (0.0, 3.3)]


class Capacitor(_Part):
    """Fixed or variable capacitor (217F Section 10):
    lambda_p = lb * piT * piC * piV * piSR * piQ * piE.

    Parameters
    ----------
    style : str
        MIL-C designation ('CA', 'CK', 'CSR', 'CU', etc.) or a
        backward-compatible alias ('ceramic', 'tantalum_solid',
        'aluminum_electrolytic', 'plastic_film', 'mica', 'glass',
        'paper', 'tantalum_wet', 'variable_ceramic', 'variable_air').
    capacitance : float
        Capacitance in microfarads.
    voltage_stress : float
        Ratio of applied voltage to rated voltage (0-1).
    T_ambient : float
        Ambient temperature in deg C.
    circuit_resistance : float
        Ohms per volt (tantalum styles only, for piSR).
    quality : str
    environment : str
    """

    category = 'capacitor'

    def __init__(self, style='ceramic', capacitance=0.1, voltage_stress=0.5,
                 T_ambient=40.0, circuit_resistance=1.0, quality='commercial',
                 environment='GB', standard='MIL-HDBK-217F', pi_Q=None,
                 name=None, quantity=1, multiplier=1.0):
        super().__init__(name=name, quantity=quantity, multiplier=multiplier)
        _check_environment(environment)
        _check_standard(standard)
        _check_stress(voltage_stress, 'voltage_stress')
        if capacitance <= 0:
            raise ValueError("capacitance must be > 0 (microfarads)")
        if style not in _CAPACITOR_STYLES:
            raise ValueError(f"style must be one of {list(_CAPACITOR_STYLES)}")

        _desc, lam_b, Ea, c_exp, v_exp, has_sr = _CAPACITOR_STYLES[style]
        pi_T = arrhenius_pi_T(T_ambient, Ea)
        pi_C = capacitance ** c_exp
        pi_V = (voltage_stress / 0.6) ** v_exp + 1.0

        if has_sr:
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


# ===================================================================
# Section 11 — Inductive devices (transformers, coils)
# ===================================================================

_PI_E_INDUCTIVE = _env_table([1.0, 6.0, 12.0, 5.0, 16.0, 6.0, 8.0,
                              7.0, 9.0, 24.0, 0.5, 13.0, 34.0, 610.0])
_PI_Q_INDUCTIVE = {'S': 0.03, 'R': 0.1, 'P': 0.3, 'M': 1.0,
                   'MIL-SPEC': 1.0, 'lower': 3.0, 'commercial': 7.5}
_INDUCTIVE_LAMBDA_B = {'transformer': 0.0018, 'inductor': 0.000030}


class InductiveDevice(_Part):
    """Transformer or inductor/coil (217F 11.1/11.2):
    lambda_p = lb(T_hotspot) * piQ * piE with the Class-A insulation
    hot-spot temperature model lb = A * exp(((T_HS+273)/329)^15.6).
    """

    category = 'inductive'

    def __init__(self, device='transformer', T_hotspot=60.0,
                 quality='commercial', environment='GB',
                 standard='MIL-HDBK-217F', pi_Q=None,
                 name=None, quantity=1, multiplier=1.0):
        super().__init__(name=name, quantity=quantity, multiplier=multiplier)
        _check_environment(environment)
        _check_standard(standard)
        if device not in _INDUCTIVE_LAMBDA_B:
            raise ValueError(f"device must be one of {list(_INDUCTIVE_LAMBDA_B)}")

        A = _INDUCTIVE_LAMBDA_B[device]
        lam_b = A * np.exp(((T_hotspot + 273.0) / 329.0) ** 15.6)
        if quality not in _PI_Q_INDUCTIVE:
            raise ValueError(f"quality must be one of {list(_PI_Q_INDUCTIVE)}")
        if pi_Q is None:
            pi_Q = _PI_Q_INDUCTIVE[quality]
            if standard == 'VITA-51.1':
                pi_Q = min(pi_Q, 3.0)
        pi_E = _PI_E_INDUCTIVE[environment]

        self.pi_factors = {'lambda_b': round(float(lam_b), 8),
                           'pi_Q': pi_Q, 'pi_E': pi_E}
        self.failure_rate = float(lam_b * pi_Q * pi_E)


# ===================================================================
# Section 12 — Rotating devices (motors, synchros, resolvers)
# ===================================================================

_PI_E_ROTATING = _env_table([1.0, 2.0, 6.0, 3.0, 9.0, 4.0, 6.0,
                             6.0, 10.0, 12.0, 1.0, 7.0, 18.0, 200.0])

_ROTATING_TYPES = {
    'motor_ac': ('AC motor', 10.0),
    'motor_dc': ('DC motor', 5.4),
    'motor_ac_fractional': ('AC motor, fractional HP', 4.2),
    'synchro': ('Synchro/Resolver', 3.2),
    'elapsed_time_meter': ('Elapsed time meter', 24.0),
    # Backward-compatible aliases
    'motor': ('Motor (alias)', 5.4),
    'fan_blower': ('Fan/Blower (alias)', 4.0),
    'pump': ('Pump (alias)', 5.0),
}


class RotatingDevice(_Part):
    """Motor, synchro, resolver, or elapsed time meter (217F Section 12):
    lambda_p = lb * piE.

    The full 217F Section 12 bearing/winding Weibull model computes
    lambda from separate bearing and winding failure modes. This
    implementation uses the simplified constant-rate model which is
    adequate for system-level prediction. For detailed motor analysis,
    use CustomPart with the Weibull model.
    """

    category = 'rotating'

    def __init__(self, device='fan_blower', environment='GB',
                 standard='MIL-HDBK-217F', pi_Q=None,
                 name=None, quantity=1, multiplier=1.0):
        super().__init__(name=name, quantity=quantity, multiplier=multiplier)
        _check_environment(environment)
        _check_standard(standard)
        if device not in _ROTATING_TYPES:
            raise ValueError(f"device must be one of {list(_ROTATING_TYPES)}")

        _desc, lam_b = _ROTATING_TYPES[device]
        pi_E = _PI_E_ROTATING[environment]
        self.pi_factors = {'lambda_b': lam_b, 'pi_E': pi_E}
        self.failure_rate = float(lam_b * pi_E)


# ===================================================================
# Section 13 — Relays
# ===================================================================

# --- 13.1 Mechanical relays ---

_PI_E_RELAY = _env_table([1.0, 2.0, 15.0, 8.0, 27.0, 7.0, 9.0,
                          11.0, 12.0, 46.0, 0.5, 25.0, 66.0, 1000.0])
_PI_Q_RELAY = {'MIL-SPEC': 1.0, 'lower': 3.0, 'commercial': 6.0}
_RELAY_LOAD = {'resistive': 1.0, 'inductive': 2.0, 'lamp': 3.0}

# piC — contact form factor
_RELAY_CONTACT_FORM = {
    'SPST': 1.0,
    'DPST': 2.0,
    'SPDT': 1.5,
    'DPDT': 4.25,
    '3PST': 3.0,
    '4PST': 4.0,
    '6PDT': 12.75,
}

# piF — application/construction factor
_RELAY_APPLICATION = {
    'general_purpose': 1.0,
    'sensitive': 0.5,
    'polarized': 1.5,
    'vibration_resistant': 2.0,
    'high_speed': 3.0,
    'latching': 1.5,
    'reed': 0.4,
    'mercury_wetted': 0.8,
    'magnetic_latching': 1.5,
    'thermal': 2.5,
    'solid_state_coupled': 0.1,
}

# Temperature-dependent base failure rate for mechanical relays
_RELAY_LAMBDA_B_TABLE = [
    (125, 0.0060), (150, 0.010), (175, 0.020),
    (200, 0.040), (250, 0.10), (300, 0.30),
]


class Relay(_Part):
    """Electromechanical relay (217F Section 13.1):
    lambda_p = lb * piL * piC * piCYC * piF * piQ * piE.

    Parameters
    ----------
    load : str
        'resistive', 'inductive', or 'lamp'. Sets piL.
    contact_form : str
        'SPST', 'DPST', 'SPDT', 'DPDT', '3PST', '4PST', '6PDT'. Sets piC.
    cycles_per_hour : float
        Operating cycles per hour. Sets piCYC.
    application : str
        Relay construction/application type. Sets piF.
    T_ambient : float
        Ambient temperature in deg C (for base rate selection).
    quality : str
    environment : str
    """

    category = 'relay'

    def __init__(self, load='resistive', contact_form='DPDT',
                 cycles_per_hour=1.0, application='general_purpose',
                 T_ambient=40.0, quality='commercial', environment='GB',
                 standard='MIL-HDBK-217F', pi_Q=None,
                 name=None, quantity=1, multiplier=1.0):
        super().__init__(name=name, quantity=quantity, multiplier=multiplier)
        _check_environment(environment)
        _check_standard(standard)
        if load not in _RELAY_LOAD:
            raise ValueError(f"load must be one of {list(_RELAY_LOAD)}")
        if contact_form not in _RELAY_CONTACT_FORM:
            raise ValueError(f"contact_form must be one of {list(_RELAY_CONTACT_FORM)}")
        if application not in _RELAY_APPLICATION:
            raise ValueError(f"application must be one of {list(_RELAY_APPLICATION)}")
        if cycles_per_hour < 0:
            raise ValueError("cycles_per_hour must be >= 0")

        lam_b = 0.0060
        for bound, rate in _RELAY_LAMBDA_B_TABLE:
            if T_ambient <= bound:
                lam_b = rate
                break

        pi_L = _RELAY_LOAD[load]
        pi_C = _RELAY_CONTACT_FORM[contact_form]
        pi_CYC = max(0.1, cycles_per_hour / 10.0)
        pi_F = _RELAY_APPLICATION[application]

        if quality not in _PI_Q_RELAY:
            raise ValueError(f"quality must be one of {list(_PI_Q_RELAY)}")
        if pi_Q is None:
            pi_Q = _PI_Q_RELAY[quality]
            if standard == 'VITA-51.1':
                pi_Q = min(pi_Q, 3.0)
        pi_E = _PI_E_RELAY[environment]

        self.pi_factors = {'lambda_b': lam_b, 'pi_L': pi_L,
                           'pi_C': pi_C,
                           'pi_CYC': round(float(pi_CYC), 4),
                           'pi_F': pi_F,
                           'pi_Q': pi_Q, 'pi_E': pi_E}
        self.failure_rate = float(
            lam_b * pi_L * pi_C * pi_CYC * pi_F * pi_Q * pi_E)


# --- 13.2 Solid state relays ---

_PI_E_SS_RELAY = _env_table([1.0, 3.0, 12.0, 6.0, 20.0, 8.0, 12.0,
                             14.0, 18.0, 32.0, 0.5, 18.0, 48.0, 800.0])


class SolidStateRelay(_Part):
    """Solid state relay (217F Section 13.2):
    lambda_p = lb * piT * piS * piQ * piE.

    voltage_stress = applied voltage / rated voltage.
    """

    category = 'ss_relay'

    def __init__(self, voltage_stress=0.5, T_junction=50.0,
                 quality='commercial', environment='GB',
                 standard='MIL-HDBK-217F', pi_Q=None,
                 name=None, quantity=1, multiplier=1.0):
        super().__init__(name=name, quantity=quantity, multiplier=multiplier)
        _check_environment(environment)
        _check_standard(standard)
        _check_stress(voltage_stress, 'voltage_stress')

        lam_b = 0.40
        pi_T = np.exp(-2790 * (1.0 / (T_junction + 273.0) - 1.0 / 298.0))
        pi_S = voltage_stress ** 2.0 if voltage_stress > 0.3 else 0.1
        pi_Q_val = 1.0 if pi_Q is None else pi_Q
        if pi_Q is None and quality in _PI_Q_RELAY:
            pi_Q_val = _PI_Q_RELAY[quality]
            if standard == 'VITA-51.1':
                pi_Q_val = min(pi_Q_val, 3.0)
        pi_E = _PI_E_SS_RELAY[environment]

        self.pi_factors = {'lambda_b': lam_b, 'pi_T': round(float(pi_T), 6),
                           'pi_S': round(float(pi_S), 6),
                           'pi_Q': pi_Q_val, 'pi_E': pi_E}
        self.failure_rate = float(lam_b * pi_T * pi_S * pi_Q_val * pi_E)


# ===================================================================
# Section 14 — Switches
# ===================================================================

# --- 14.1 Switches ---

_PI_E_SWITCH = _env_table([1.0, 3.0, 18.0, 8.0, 29.0, 10.0, 18.0,
                           13.0, 22.0, 46.0, 0.5, 25.0, 67.0, 1200.0])
_PI_Q_SWITCH = {'MIL-SPEC': 1.0, 'commercial': 20.0}
_SWITCH_LAMBDA_B = {
    'toggle': 0.0010, 'pushbutton': 0.0010,
    'sensitive': 0.10, 'rotary': 0.0067,
    'thumbwheel': 0.0067, 'rocker': 0.0010,
    'slide': 0.0040, 'dip': 0.0040,
}


class Switch(_Part):
    """Switch (217F Section 14.1):
    lambda_p = lb * piL * piCYC * piQ * piE.

    load_stress = operating current / rated current;
    piL = exp((S/0.8)^2). cycles_per_hour adds piCYC factor.
    """

    category = 'switch'

    def __init__(self, switch_type='toggle', load_stress=0.5,
                 cycles_per_hour=0.0,
                 quality='commercial', environment='GB',
                 standard='MIL-HDBK-217F', pi_Q=None,
                 name=None, quantity=1, multiplier=1.0):
        super().__init__(name=name, quantity=quantity, multiplier=multiplier)
        _check_environment(environment)
        _check_standard(standard)
        _check_stress(load_stress, 'load_stress')
        if switch_type not in _SWITCH_LAMBDA_B:
            raise ValueError(f"switch_type must be one of {list(_SWITCH_LAMBDA_B)}")

        lam_b = _SWITCH_LAMBDA_B[switch_type]
        pi_L = np.exp((load_stress / 0.8) ** 2)

        pi_CYC = 1.0
        if cycles_per_hour > 0:
            pi_CYC = max(1.0, cycles_per_hour / 10.0)

        if quality not in _PI_Q_SWITCH:
            raise ValueError(f"quality must be one of {list(_PI_Q_SWITCH)}")
        if pi_Q is None:
            pi_Q = _PI_Q_SWITCH[quality]
            if standard == 'VITA-51.1':
                pi_Q = min(pi_Q, 8.0)
        pi_E = _PI_E_SWITCH[environment]

        self.pi_factors = {'lambda_b': lam_b, 'pi_L': round(float(pi_L), 6),
                           'pi_CYC': round(float(pi_CYC), 4),
                           'pi_Q': pi_Q, 'pi_E': pi_E}
        self.failure_rate = float(lam_b * pi_L * pi_CYC * pi_Q * pi_E)


# --- 14.2 Circuit breakers ---

_PI_E_BREAKER = _env_table([1.0, 3.0, 18.0, 8.0, 29.0, 10.0, 18.0,
                            13.0, 22.0, 46.0, 0.5, 25.0, 67.0, 1200.0])
_PI_Q_BREAKER = {'MIL-SPEC': 1.0, 'commercial': 20.0}
_BREAKER_CONSTRUCTION = {'magnetic': 1.0, 'thermal': 2.0,
                         'thermal_magnetic': 3.0}
_BREAKER_USE = {'primary_power': 1.0, 'control_protection': 2.0,
                'auxiliary': 0.5}


class CircuitBreaker(_Part):
    """Circuit breaker (217F Section 14.2):
    lambda_p = lb * piC * piU * piQ * piE.

    construction: 'magnetic', 'thermal', or 'thermal_magnetic'.
    use: 'primary_power', 'control_protection', or 'auxiliary'.
    """

    category = 'circuit_breaker'

    def __init__(self, construction='thermal_magnetic', use='primary_power',
                 quality='commercial', environment='GB',
                 standard='MIL-HDBK-217F', pi_Q=None,
                 name=None, quantity=1, multiplier=1.0):
        super().__init__(name=name, quantity=quantity, multiplier=multiplier)
        _check_environment(environment)
        _check_standard(standard)
        if construction not in _BREAKER_CONSTRUCTION:
            raise ValueError(
                f"construction must be one of {list(_BREAKER_CONSTRUCTION)}")
        if use not in _BREAKER_USE:
            raise ValueError(f"use must be one of {list(_BREAKER_USE)}")

        lam_b = 0.020
        pi_C = _BREAKER_CONSTRUCTION[construction]
        pi_U = _BREAKER_USE[use]
        if quality not in _PI_Q_BREAKER:
            raise ValueError(f"quality must be one of {list(_PI_Q_BREAKER)}")
        if pi_Q is None:
            pi_Q = _PI_Q_BREAKER[quality]
        pi_E = _PI_E_BREAKER[environment]

        self.pi_factors = {'lambda_b': lam_b, 'pi_C': pi_C,
                           'pi_U': pi_U, 'pi_Q': pi_Q, 'pi_E': pi_E}
        self.failure_rate = float(lam_b * pi_C * pi_U * pi_Q * pi_E)


# ===================================================================
# Section 15 — Connectors
# ===================================================================

_PI_E_CONNECTOR = _env_table([1.0, 1.0, 8.0, 5.0, 13.0, 3.0, 5.0,
                              8.0, 12.0, 19.0, 0.5, 10.0, 27.0, 490.0])
_PI_Q_CONNECTOR = {'MIL-SPEC': 1.0, 'commercial': 2.0}

_CONNECTOR_TYPES = {
    'circular': 0.011,
    'rack_panel': 0.012,
    'pcb_edge': 0.019,
    'ic_socket': 0.0055,
    'rf_coaxial': 0.0042,
    'fiber_optic': 0.013,
    'power': 0.014,
    'triaxial': 0.0066,
}


class Connector(_Part):
    """Connector (217F Section 15):
    lambda_p = lb * piT * piK * piP * piQ * piE.

    piK from mating/unmating frequency; piP from pin count.
    """

    category = 'connector'

    def __init__(self, connector_type='circular', pins=25, T_insert=40.0,
                 matings_per_1000h=0.5, quality='commercial',
                 environment='GB', standard='MIL-HDBK-217F', pi_Q=None,
                 name=None, quantity=1, multiplier=1.0):
        super().__init__(name=name, quantity=quantity, multiplier=multiplier)
        _check_environment(environment)
        _check_standard(standard)
        if pins < 1:
            raise ValueError("pins must be >= 1")
        if matings_per_1000h < 0:
            raise ValueError("matings_per_1000h must be >= 0")
        if connector_type not in _CONNECTOR_TYPES:
            raise ValueError(
                f"connector_type must be one of {list(_CONNECTOR_TYPES)}")

        lam_b = _CONNECTOR_TYPES[connector_type]
        pi_T = np.exp(-0.14 / BOLTZMANN_EV
                      * (1.0 / (T_insert + 273.0) - 1.0 / 298.0))
        if matings_per_1000h <= 0.05:
            pi_K = 1.0
        elif matings_per_1000h <= 0.5:
            pi_K = 1.5
        elif matings_per_1000h <= 5:
            pi_K = 2.0
        elif matings_per_1000h <= 50:
            pi_K = 3.0
        else:
            pi_K = 4.0
        pi_P = np.exp(((pins - 1) / 23.0) ** 0.51)

        if quality not in _PI_Q_CONNECTOR:
            raise ValueError(
                f"quality must be one of {list(_PI_Q_CONNECTOR)}")
        if pi_Q is None:
            pi_Q = _PI_Q_CONNECTOR[quality]
        pi_E = _PI_E_CONNECTOR[environment]

        self.pi_factors = {'lambda_b': lam_b, 'pi_T': round(float(pi_T), 6),
                           'pi_K': pi_K, 'pi_P': round(float(pi_P), 6),
                           'pi_Q': pi_Q, 'pi_E': pi_E}
        self.failure_rate = float(
            lam_b * pi_T * pi_K * pi_P * pi_Q * pi_E)


# ===================================================================
# Section 16 — Printed circuit boards / interconnection assemblies
# ===================================================================

_PI_E_PCB = _env_table([1.0, 2.0, 5.0, 4.0, 11.0, 4.0, 5.0,
                        7.0, 12.0, 16.0, 0.5, 9.0, 24.0, 450.0])
_PI_Q_PCB = {'MIL-SPEC': 1.0, 'commercial': 2.0}

_PCB_COMPLEXITY = {
    'single_sided': 0.00041,
    'double_sided': 0.00050,
    'multilayer_small': 0.00066,
    'multilayer_medium': 0.0010,
    'multilayer_large': 0.0020,
}


class PCB(_Part):
    """Printed circuit board / interconnection assembly (217F Section 16):
    lambda_p = lb * piQ * piE.

    complexity sets the base failure rate; defaults to double_sided.
    """

    category = 'pcb'

    def __init__(self, complexity='double_sided', quality='commercial',
                 environment='GB', standard='MIL-HDBK-217F', pi_Q=None,
                 name=None, quantity=1, multiplier=1.0):
        super().__init__(name=name, quantity=quantity, multiplier=multiplier)
        _check_environment(environment)
        _check_standard(standard)
        if complexity not in _PCB_COMPLEXITY:
            raise ValueError(
                f"complexity must be one of {list(_PCB_COMPLEXITY)}")

        lam_b = _PCB_COMPLEXITY[complexity]
        if quality not in _PI_Q_PCB:
            raise ValueError(f"quality must be one of {list(_PI_Q_PCB)}")
        if pi_Q is None:
            pi_Q = _PI_Q_PCB[quality]
        pi_E = _PI_E_PCB[environment]

        self.pi_factors = {'lambda_b': lam_b, 'pi_Q': pi_Q, 'pi_E': pi_E}
        self.failure_rate = float(lam_b * pi_Q * pi_E)


# ===================================================================
# Section 17 — Connections
# ===================================================================

_CONNECTION_LAMBDA_B = {
    'hand_solder': 0.0013,
    'wave_solder': 0.00014,
    'reflow_solder': 0.000069,
    'crimp': 0.00026,
    'weld': 0.000015,
    'wire_wrap': 0.0000035,
    'clip_termination': 0.00026,
    'solderless_wrap': 0.00026,
}
_PI_E_CONNECTION = _env_table([1.0, 2.0, 7.0, 5.0, 13.0, 5.0, 8.0,
                               16.0, 28.0, 19.0, 0.5, 10.0, 26.0, 450.0])


class Connection(_Part):
    """Interconnection (217F Section 17): lambda_p = lb * piE.
    Use quantity for the number of connections (e.g. solder joints)."""

    category = 'connection'

    def __init__(self, connection_type='reflow_solder', environment='GB',
                 standard='MIL-HDBK-217F', pi_Q=None,
                 name=None, quantity=1, multiplier=1.0):
        super().__init__(name=name, quantity=quantity, multiplier=multiplier)
        _check_environment(environment)
        _check_standard(standard)
        if connection_type not in _CONNECTION_LAMBDA_B:
            raise ValueError(
                f"connection_type must be one of {list(_CONNECTION_LAMBDA_B)}")

        lam_b = _CONNECTION_LAMBDA_B[connection_type]
        pi_E = _PI_E_CONNECTION[environment]
        self.pi_factors = {'lambda_b': lam_b, 'pi_E': pi_E}
        self.failure_rate = float(lam_b * pi_E)


# ===================================================================
# Section 18 — Meters
# ===================================================================

_PI_E_METER = _env_table([1.0, 2.0, 10.0, 6.0, 16.0, 5.0, 8.0,
                          8.0, 11.0, 22.0, 0.5, 13.0, 34.0, 610.0])
_PI_Q_METER = {'MIL-SPEC': 1.0, 'commercial': 3.4}
_METER_FUNCTION = {'elapsed_time': 10.0, 'panel_ac': 100.0,
                   'panel_dc': 100.0, 'panel_frequency': 100.0,
                   'digital_multimeter': 50.0}


class Meter(_Part):
    """Meter / panel meter (217F Section 18):
    lambda_p = lb * piF * piQ * piE.

    function sets piF (the meter function factor).
    """

    category = 'meter'

    def __init__(self, function='panel_dc', quality='commercial',
                 environment='GB', standard='MIL-HDBK-217F', pi_Q=None,
                 name=None, quantity=1, multiplier=1.0):
        super().__init__(name=name, quantity=quantity, multiplier=multiplier)
        _check_environment(environment)
        _check_standard(standard)
        if function not in _METER_FUNCTION:
            raise ValueError(
                f"function must be one of {list(_METER_FUNCTION)}")

        lam_b = 0.090
        pi_F = _METER_FUNCTION[function]
        if quality not in _PI_Q_METER:
            raise ValueError(f"quality must be one of {list(_PI_Q_METER)}")
        if pi_Q is None:
            pi_Q = _PI_Q_METER[quality]
        pi_E = _PI_E_METER[environment]

        self.pi_factors = {'lambda_b': lam_b, 'pi_F': pi_F,
                           'pi_Q': pi_Q, 'pi_E': pi_E}
        self.failure_rate = float(lam_b * pi_F * pi_Q * pi_E)


# ===================================================================
# Section 19 — Quartz crystals
# ===================================================================

_PI_Q_CRYSTAL = {'MIL-SPEC': 1.0, 'lower': 2.1}
_PI_E_CRYSTAL = _env_table([1.0, 3.0, 10.0, 6.0, 16.0, 12.0, 17.0,
                            22.0, 28.0, 23.0, 0.5, 13.0, 32.0, 500.0])


class QuartzCrystal(_Part):
    """Quartz crystal (217F Section 19):
    lambda_p = 0.013 * f^0.23 * piQ * piE, f in MHz."""

    category = 'crystal'

    def __init__(self, frequency_mhz=10.0, quality='MIL-SPEC',
                 environment='GB', standard='MIL-HDBK-217F', pi_Q=None,
                 name=None, quantity=1, multiplier=1.0):
        super().__init__(name=name, quantity=quantity, multiplier=multiplier)
        _check_environment(environment)
        _check_standard(standard)
        if frequency_mhz <= 0:
            raise ValueError("frequency_mhz must be > 0")
        if quality not in _PI_Q_CRYSTAL:
            raise ValueError(f"quality must be one of {list(_PI_Q_CRYSTAL)}")

        lam_b = 0.013 * frequency_mhz ** 0.23
        if pi_Q is None:
            pi_Q = _PI_Q_CRYSTAL[quality]
        pi_E = _PI_E_CRYSTAL[environment]
        self.pi_factors = {'lambda_b': round(float(lam_b), 6),
                           'pi_Q': pi_Q, 'pi_E': pi_E}
        self.failure_rate = float(lam_b * pi_Q * pi_E)


# ===================================================================
# Section 20 — Lamps
# ===================================================================

_LAMP_PI_U = {'continuous': 1.0, 'intermittent': 0.72, 'rare': 0.10}
_PI_E_LAMP = _env_table([1.0, 2.0, 3.0, 3.0, 4.0, 4.0, 4.0,
                         5.0, 6.0, 5.0, 0.5, 6.0, 27.0, 450.0])


class Lamp(_Part):
    """Incandescent lamp (217F Section 20):
    lambda_p = 0.074 * V^1.29 * piU * piE, V = rated voltage."""

    category = 'lamp'

    def __init__(self, rated_voltage=28.0, utilization='continuous',
                 environment='GB', standard='MIL-HDBK-217F', pi_Q=None,
                 name=None, quantity=1, multiplier=1.0):
        super().__init__(name=name, quantity=quantity, multiplier=multiplier)
        _check_environment(environment)
        _check_standard(standard)
        if rated_voltage <= 0:
            raise ValueError("rated_voltage must be > 0")
        if utilization not in _LAMP_PI_U:
            raise ValueError(f"utilization must be one of {list(_LAMP_PI_U)}")

        lam_b = 0.074 * rated_voltage ** 1.29
        pi_U = _LAMP_PI_U[utilization]
        pi_E = _PI_E_LAMP[environment]
        self.pi_factors = {'lambda_b': round(float(lam_b), 6), 'pi_U': pi_U,
                           'pi_E': pi_E}
        self.failure_rate = float(lam_b * pi_U * pi_E)


# ===================================================================
# Section 21 — Electronic filters
# ===================================================================

_PI_Q_FILTER = {'MIL-SPEC': 1.0, 'commercial': 2.9}
_PI_E_FILTER = _env_table([1.0, 2.0, 6.0, 4.0, 9.0, 7.0, 9.0,
                           11.0, 13.0, 11.0, 0.8, 12.0, 27.0, 490.0])


class ElectronicFilter(_Part):
    """Electronic filter (217F Section 21):
    lambda_p = 0.022 * piQ * piE."""

    category = 'filter'

    def __init__(self, quality='commercial', environment='GB',
                 standard='MIL-HDBK-217F', pi_Q=None,
                 name=None, quantity=1, multiplier=1.0):
        super().__init__(name=name, quantity=quantity, multiplier=multiplier)
        _check_environment(environment)
        _check_standard(standard)
        if quality not in _PI_Q_FILTER:
            raise ValueError(f"quality must be one of {list(_PI_Q_FILTER)}")

        lam_b = 0.022
        if pi_Q is None:
            pi_Q = _PI_Q_FILTER[quality]
        pi_E = _PI_E_FILTER[environment]
        self.pi_factors = {'lambda_b': lam_b, 'pi_Q': pi_Q, 'pi_E': pi_E}
        self.failure_rate = float(lam_b * pi_Q * pi_E)


# ===================================================================
# Section 22 — Fuses
# ===================================================================

_PI_E_FUSE = _env_table([1.0, 2.0, 8.0, 5.0, 11.0, 9.0, 12.0,
                         15.0, 18.0, 16.0, 0.9, 10.0, 21.0, 230.0])


class Fuse(_Part):
    """Fuse (217F Section 22): lambda_p = 0.010 * piE."""

    category = 'fuse'

    def __init__(self, environment='GB', standard='MIL-HDBK-217F', pi_Q=None,
                 name=None, quantity=1, multiplier=1.0):
        super().__init__(name=name, quantity=quantity, multiplier=multiplier)
        _check_environment(environment)
        _check_standard(standard)
        lam_b = 0.010
        pi_E = _PI_E_FUSE[environment]
        self.pi_factors = {'lambda_b': lam_b, 'pi_E': pi_E}
        self.failure_rate = float(lam_b * pi_E)


# ===================================================================
# Section 23 — Miscellaneous parts
# ===================================================================

_MISC_TYPES = {
    'surface_acoustic_wave': 2.1,
    'piezoelectric_crystal': 0.013,
    'heater': 10.0,
    'battery': 0.010,
    'centrifuge': 50.0,
}
_PI_E_MISC = _env_table([1.0, 3.0, 10.0, 6.0, 16.0, 5.0, 8.0,
                         9.0, 12.0, 22.0, 0.5, 14.0, 32.0, 320.0])
_PI_Q_MISC = {'MIL-SPEC': 1.0, 'commercial': 2.0}


class MiscellaneousPart(_Part):
    """Miscellaneous part (217F Section 23):
    lambda_p = lb * piQ * piE.

    Covers surface acoustic wave devices, piezoelectric crystals,
    heaters, batteries, centrifuges, and other parts not in Sections 5-22.
    """

    category = 'miscellaneous'

    def __init__(self, part_type='battery', quality='commercial',
                 environment='GB', standard='MIL-HDBK-217F', pi_Q=None,
                 name=None, quantity=1, multiplier=1.0):
        super().__init__(name=name, quantity=quantity, multiplier=multiplier)
        _check_environment(environment)
        _check_standard(standard)
        if part_type not in _MISC_TYPES:
            raise ValueError(
                f"part_type must be one of {list(_MISC_TYPES)}")

        lam_b = _MISC_TYPES[part_type]
        if quality not in _PI_Q_MISC:
            raise ValueError(f"quality must be one of {list(_PI_Q_MISC)}")
        if pi_Q is None:
            pi_Q = _PI_Q_MISC[quality]
        pi_E = _PI_E_MISC[environment]

        self.pi_factors = {'lambda_b': lam_b, 'pi_Q': pi_Q, 'pi_E': pi_E}
        self.failure_rate = float(lam_b * pi_Q * pi_E)


# ===================================================================
# Custom, generic parts and system rollup
# ===================================================================

class CustomPart(_Part):
    """User-defined part: constant (exponential) failure rate or Weibull.

    For ``model='exponential'`` supply ``failure_rate`` in FPMH.
    For ``model='weibull'`` supply ``eta`` (characteristic life, hours),
    ``beta`` (shape), and ``eval_time`` (hours).
    """

    category = 'custom'

    def __init__(self, model='exponential', failure_rate=None,
                 eta=None, beta=None, eval_time=None,
                 name=None, quantity=1, multiplier=1.0):
        super().__init__(name=name, quantity=quantity, multiplier=multiplier)
        if model == 'exponential':
            if failure_rate is None or failure_rate < 0:
                raise ValueError("failure_rate (FPMH, >= 0) is required for "
                                 "the exponential model")
            self.pi_factors = {'model': 'exponential'}
            self.failure_rate = float(failure_rate)
        elif model == 'weibull':
            if eta is None or eta <= 0:
                raise ValueError("eta (hours, > 0) is required for the "
                                 "weibull model")
            if beta is None or beta <= 0:
                raise ValueError("beta (> 0) is required for the weibull model")
            if eval_time is None or eval_time <= 0:
                raise ValueError("eval_time (hours, > 0) is required for the "
                                 "weibull model")
            rate = 1e6 * (eval_time / eta) ** beta / eval_time
            self.pi_factors = {'model': 'weibull', 'eta': float(eta),
                               'beta': float(beta),
                               'eval_time': float(eval_time)}
            self.failure_rate = float(rate)
        else:
            raise ValueError("model must be 'exponential' or 'weibull'")


class GenericPart(_Part):
    """A part with a user-supplied failure rate in FPMH."""

    category = 'generic'

    def __init__(self, failure_rate, name=None, quantity=1, multiplier=1.0):
        super().__init__(name=name, quantity=quantity, multiplier=multiplier)
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
        """Mission reliability R(t) = exp(-lambda * t)."""
        t = np.asarray(t_hours, dtype=float)
        R = np.exp(-self.total_failure_rate * t / 1e6)
        return float(R) if R.ndim == 0 else R

    @property
    def results(self):
        rows = []
        for p in self.parts:
            contribution = (p.total_failure_rate / self.total_failure_rate
                            if self.total_failure_rate > 0 else 0.0)
            rows.append({
                'name': p.name, 'category': p.category,
                'quantity': p.quantity,
                'multiplier': p.multiplier,
                'failure_rate': round(p.failure_rate, 6),
                'total_failure_rate': round(p.total_failure_rate, 6),
                'contribution': round(contribution, 4),
                'pi_factors': p.pi_factors,
            })
        return rows

    def __repr__(self):
        return (f"SystemFailureRate(total={self.total_failure_rate:.4f} FPMH, "
                f"MTBF={self.mtbf:.1f} h, parts={len(self.parts)})")
