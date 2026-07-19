# MIL-HDBK-217F Notice 2 and ANSI/VITA 51.1 methodology

## Purpose and controlled sources

This document describes how Perdura translates the supplied reliability
prediction standards into executable, auditable calculations. It covers the
complete numerical implementation of MIL-HDBK-217F Notice 2 and the
calculation-affecting content of ANSI/VITA 51.1-2013 (R2018), including the
source ambiguities that required an explicit engineering interpretation.

The controlled references are:

| Reference | Controlled file | SHA-256 |
|---|---|---|
| MIL-HDBK-217F, Notice 2, 28 February 1995 | `docs/references/MIL-HDBK-217F-Notice2.pdf` | `e0df9c9ed1123a790a5b11e4b8dbbc27ff7edc338b417b0b3d6bff8295217f9b` |
| ANSI/VITA 51.1-2013 (R2018), reaffirmed 10 October 2018 | `docs/references/AV51DOT1-2013-R2018.pdf` | `444654fd15215fde6e7700a70ecbf1a82001cf368c93b6a1de28dafde072f214` |

The principal implementation is
`src/reliability/_mil_hdbk_217f_notice2.py`; the public import facade is
`src/reliability/MIL_HDBK_217F.py`. The API maps the same model names in
`gui/backend/routers/prediction.py`, and the Prediction UI exposes the exact
constructor inputs rather than a second set of approximate equations.

The companion [MIL-HDBK-217F coverage matrix](../standards/MIL-HDBK-217F-NOTICE-2-COVERAGE.md)
maps every clause and every one of the 217 Appendix A rows. This methodology
document concentrates on calculation logic, formulae, A/V51.1 behavior, and
engineering decisions.

## Result semantics and units

Unless a step says otherwise, every failure rate is in failures per million
operating hours (FPMH):

\[
1\ \mathrm{FPMH}=10^{-6}\ \mathrm{failures/hour}.
\]

For a line item with unit failure rate \(\lambda_p\), quantity \(N\), and an
explicit analyst multiplier \(m\), Perdura reports

\[
\lambda_{\mathrm{line}}=N m\lambda_p.
\]

For the series-system constant-rate roll-up,

\[
\lambda_{\mathrm{system}}=\sum_i\lambda_{\mathrm{line},i},\qquad
\mathrm{MTBF}=\frac{10^6}{\lambda_{\mathrm{system}}},\qquad
R(t)=\exp\!\left(-\frac{\lambda_{\mathrm{system}}t}{10^6}\right).
\]

MTBF and the exponential reliability expression describe a population in its
approximately constant-rate useful-life region. They are not component
wearout lives. A/V51.1 Appendix I makes this distinction explicit. The result
is a model-based planning estimate for relative design comparison, not an
observed or calibrated field failure rate unless representative test or field
data support that interpretation.

Every calculated part retains:

- controlled edition, clause, printed page, model, equation, and units;
- all selected factors and intermediate terms;
- a long-form substitution sequence;
- input assumptions, source repairs, applicability warnings, quantity, and
  multiplier; and
- when A/V51.1 is selected, the supplement edition and applicable rule IDs in
  addition to the underlying MIL source.

Inputs outside a source model's stated domain fail closed. Perdura does not
silently extrapolate past a table endpoint, invent a missing environment
factor, accept electrical overstress, or reuse a thermal approximation where
the handbook requires a dedicated analysis.

## Common mathematical conventions

The common Arrhenius factor is evaluated in degrees Celsius using
\(k=8.617\times10^{-5}\ \mathrm{eV/K}\):

\[
\pi_T=s\exp\left[-\frac{E_a}{k}
\left(\frac{1}{T+273}-\frac{1}{T_{\mathrm{ref}}}\right)\right].
\]

The scale \(s\), activation energy \(E_a\), and reference temperature are
model-specific. Exponents are range-checked before evaluation to prevent
floating-point overflow from being mistaken for a physical result.

The MIL microcircuit learning factor is implemented at its printed endpoints
and by its equation only between them:

\[
\pi_L=
\begin{cases}
2,&Y\le 0.1,\\
0.01\exp(5.35-0.35Y),&0.1<Y<2,\\
1,&Y\ge2.
\end{cases}
\]

A/V51.1 fixes \(\pi_L=1\) for its commercial **parts-count** microcircuit
default. Part-stress calculations retain the entered years-in-production
factor, as directed by A/V Suggestion 2.1.2-2.

Microcircuit quality choices retain their stable payload codes but are shown
with their 217F meaning: `S` is the Class-S family (\(\pi_Q=.25\)), `B` is the
Class-B family (\(\pi_Q=1\)), and `B-1` is the Section 1.2.1-compliant non-JAN
screening bucket (\(\pi_Q=2\)), not a modern MIL-STD-883 product class.
Commercial or unknown screening uses \(\pi_Q=10\) before any applicable A/V
known-pedigree adjustment. This basis is retained in result traceability.

## MIL-HDBK-217F Notice 2 formula catalog

### Sections 5 and 6: microcircuits and semiconductors

| Clause | Perdura model | Governing formula |
|---|---|---|
| 5.1–5.2 | `Microcircuit` | \(\lambda_p=(C_1\pi_T+C_2\pi_E+\lambda_{cyc})\pi_Q\pi_L\); \(\lambda_{cyc}=0\) except the EEPROM cycling contribution |
| 5.3 | `VHSICMicrocircuit` | \(\lambda_p=\lambda_{BD}\pi_{MFG}\pi_T\pi_{CD}+\lambda_{BP}\pi_E\pi_Q\pi_{PT}+\lambda_{EOS}\) |
| 5.4 | `GaAsMicrocircuit` | \(\lambda_p=(C_1\pi_T\pi_A+C_2\pi_E)\pi_L\pi_Q\) |
| 5.5 | `HybridMicrocircuit` | \(\lambda_p=[\sum N_c\lambda_c](1+0.2\pi_E)\pi_F\pi_Q\pi_L\) |
| 5.6 | `SurfaceAcousticWaveDevice` | \(\lambda_p=2.1\pi_Q\pi_E\) |
| 5.7 | `MagneticBubbleMemory` | \(\lambda_p=\lambda_1+\lambda_2\), with separate control/detection and storage terms |
| 6.1 | `Diode` | \(\lambda_p=\lambda_b\pi_T\pi_S\pi_C\pi_Q\pi_E\) |
| 6.2 | `HFDiode` | \(\lambda_p=\lambda_b\pi_T\pi_A\pi_R\pi_Q\pi_E\) |
| 6.3 | `BipolarTransistor` | \(\lambda_p=\lambda_b\pi_T\pi_A\pi_R\pi_S\pi_Q\pi_E\) |
| 6.4 | `FieldEffectTransistor` | \(\lambda_p=\lambda_b\pi_T\pi_A\pi_Q\pi_E\) |
| 6.5 | `UnijunctionTransistor` | \(\lambda_p=\lambda_b\pi_T\pi_Q\pi_E\) |
| 6.6 | `HFLowNoiseBipolarTransistor` | \(\lambda_p=\lambda_b\pi_T\pi_R\pi_S\pi_Q\pi_E\) |
| 6.7 | `HFPowerBipolarTransistor` | \(\lambda_p=\lambda_b\pi_T\pi_A\pi_M\pi_Q\pi_E\) |
| 6.8 | `GaAsFET` | \(\lambda_p=\lambda_b\pi_T\pi_A\pi_M\pi_Q\pi_E\) |
| 6.9 | `HighFrequencySiliconFET` | \(\lambda_p=\lambda_b\pi_T\pi_Q\pi_E\) |
| 6.10 | `Thyristor` | \(\lambda_p=\lambda_b\pi_T\pi_R\pi_S\pi_Q\pi_E\) |
| 6.11–6.12 | `Optoelectronic` | \(\lambda_p=\lambda_b\pi_T\pi_Q\pi_E\), with device/display-specific \(\lambda_b\) |
| 6.13 | `LaserDiode` | \(\lambda_p=\lambda_b\pi_T\pi_Q\pi_I\pi_A\pi_P\pi_E\) |

For Section 5 packages,

\[
C_2=aN_p^b,
\]

using the package-specific printed \(a,b\) pair. The equations are evaluated
for the entered pin count; they are not truncated at the largest displayed
table row.

The simplified VHSIC subterms include

\[
\pi_{CD}=0.64\frac{A}{0.21}\left(\frac{2}{X_s}\right)^2+0.36,
\quad
\lambda_{BP}=0.0022+1.72\times10^{-5}N_p,
\]

and

\[
\lambda_{EOS}=\frac{-\ln[1-0.00057\exp(-0.0002V_{TH})]}{0.00876}.
\]

EEPROM cycling is evaluated as

\[
\lambda_{cyc}=\left[A_1B_1+\frac{A_2B_2}{\pi_Q}\right]\pi_{ECC},
\]

with the technology-specific cycle, bit-count, temperature, lifetime, and ECC
terms from Section 5.2.

`memory_type="ccd"` is an explicit, source-traced mapping to the MOS DRAM
model. RADC-TR-80-237 Sections IV.E–F found no physical or available-data
basis for changing the then-current NMOS dynamic-RAM coefficients for CCD
memory. Perdura therefore uses the 217F NMOS DRAM table without applying the
later A/V DRAM complexity continuation. The source comparison was limited to
Intel 2416 field data and Fairchild F464 test data, and it explicitly excludes
soft errors from the catastrophic/drift failure-rate model.

Handbook thermal-resistance table values are identified as preliminary
estimates. The Section 6.14 helper requires either a named package-table row or
an explicit thermal resistance; it no longer invents a generic 70 °C/W value.
Measured, manufacturer, and detailed-analysis inputs require a source note.
Optional junction-temperature sensitivity is calculated only from
analyst-supplied low/base/high thermal-resistance values.

The semiconductor stress equations are retained exactly by family. Examples
include the low-frequency diode factor

\[
\pi_S=0.054\quad(S\le0.3),\qquad \pi_S=S^{2.43}\quad(S>0.3),
\]

the BJT stress factor \(\pi_S=0.045\exp(3.1S)\), and the PIN-diode rated-power
factor \(\pi_R=\max[0.5,0.326\ln(P_r)-0.25]\).

### Sections 7 through 11: tubes, lasers, and passives

| Clause | Perdura model | Governing formula |
|---|---|---|
| 7.1 | `ElectronTube` | \(\lambda_p=\lambda_b\pi_L\pi_E\) |
| 7.2 | `TravelingWaveTube` | \(\lambda_p=\lambda_b\pi_E\) |
| 7.3 | `Magnetron` | \(\lambda_p=\lambda_b\pi_U\pi_C\pi_E\) |
| 8.1 | `GasLaser` | \(\lambda_p=(\lambda_{MEDIA}+\lambda_{COUPLING})\pi_E\) |
| 8.2 | `SealedCO2Laser` | \(\lambda_p=\lambda_{MEDIA}\pi_O\pi_B\pi_E+10\pi_{OS}\pi_E\) |
| 8.3 | `FlowingCO2Laser` | \(\lambda_p=\lambda_{COUPLING}\pi_{OS}\pi_E\) |
| 8.4 | `SolidStateLaser` | \(\lambda_p=(\lambda_{PUMP}+\lambda_{MEDIA}+16.3\pi_C\pi_{OS})\pi_E\) |
| 9.1 | `Resistor` | \(\lambda_p=\lambda_b\pi_T\pi_P\pi_S\pi_Q\pi_E\) |
| 10.1–10.2 | `Capacitor` | \(\lambda_p=\lambda_b\pi_T\pi_C\pi_V\pi_{SR}\pi_Q\pi_E\) |
| 11.1 | `Transformer` | \(\lambda_p=\lambda_b\pi_T\pi_Q\pi_E\) |
| 11.2 | `InductorCoil` | \(\lambda_p=\lambda_b\pi_T\pi_Q\pi_E\) |

The resistor rated-power factor is \(\pi_P=P_r^{0.39}\). Its two stress
columns are \(0.71\exp(1.1S)\) and \(0.54\exp(2.04S)\); styles without a
stress factor use one.

Capacitor voltage stress can be derived from applied DC and RMS AC voltage:

\[
S=\frac{V_{DC}+\sqrt2V_{AC,rms}}{V_{rated}}.
\]

The style table selects one of

\[
\pi_C=C^{0.09}\ \text{or}\ C^{0.23}
\]

and

\[
\pi_V=1+(S/0.6)^5,\ 1+(S/0.6)^{10},\ 1+(S/0.6)^3,
\ 1+(S/0.6)^{17},\ \text{or}\ 1+(S/0.5)^3.
\]

The applicable tantalum styles also use the printed series-resistance band
factor \(\pi_{SR}\).

Inductive hot-spot temperature is

\[
T_{HS}=T_A+1.1\Delta T,
\]

where \(\Delta T\) is measured, taken from the MIL-C-39010 slash-sheet rule,
or calculated using the appropriate loss/area, loss/weight, or input-power/
weight equation. Space operation requires a dedicated thermal analysis.

### Sections 12 through 23: electromechanical and interconnection models

| Clause | Perdura model | Governing formula |
|---|---|---|
| 12.1 | `Motor` | \(\lambda_p=[\lambda_1/(A\alpha_B)+\lambda_2/(B\alpha_W)]10^6\) |
| 12.2 | `SynchroResolver` | \(\lambda_p=\lambda_b\pi_S\pi_N\pi_E\) |
| 12.3 | `ElapsedTimeMeter` | \(\lambda_p=\lambda_b\pi_T\pi_E\) |
| 13.1 | `Relay` | \(\lambda_p=\lambda_b\pi_L\pi_C\pi_{CYC}\pi_F\pi_Q\pi_E\) |
| 13.2 | `SolidStateRelay` | \(\lambda_p=0.029\pi_Q\pi_E\) |
| 14.1 | `Switch` | \(\lambda_p=\lambda_b\pi_L\pi_C\pi_Q\pi_E\) |
| 14.2 | `CircuitBreaker` | \(\lambda_p=0.34\pi_C\pi_U\pi_Q\pi_E\) |
| 15.1 | `Connector` | \(\lambda_p=\lambda_b\pi_T\pi_K\pi_Q\pi_E\); divide by two for one connector half |
| 15.2 | `ConnectorSocket` | \(\lambda_p=\lambda_b\pi_P\pi_Q\pi_E\) |
| 16.1 | `PlatedThroughHoleAssembly` | \(\lambda_p=\lambda_b[N_1\pi_C+N_2(\pi_C+13)]\pi_Q\pi_E\) |
| 16.2 | `SurfaceMountAssembly` | weakest-link thermal-fatigue model described below |
| 17.1 | `Connection` | \(\lambda_p=\lambda_b\pi_E\) |
| 18.1 | `Meter` | \(\lambda_p=\lambda_b\pi_A\pi_F\pi_Q\pi_E\) |
| 19.1 | `QuartzCrystal` | \(\lambda_p=0.013f^{0.23}\pi_Q\pi_E\) |
| 20.1 | `Lamp` | \(\lambda_p=0.074V_r^{1.29}\pi_U\pi_A\pi_E\) |
| 21.1 | `ElectronicFilter` | \(\lambda_p=\lambda_b\pi_Q\pi_E\) |
| 22.1 | `Fuse` | \(\lambda_p=0.010\pi_E\) |
| 23.1 | `MiscellaneousPart` | printed rate, with \(\pi_E\) where the selected row requires it |

For a relay or switch load ratio \(S\),

\[
\pi_L=\exp[(S/d)^2],
\]

where \(d=0.8,0.4,0.2\) for resistive, inductive, and lamp loads. Cycling,
contact form/count, construction, and environment remain separate factors.

For connectors,

\[
T_0=T_A+\Delta T,\qquad
\Delta T=a_g I^{1.85},
\]

where \(a_g\) is the contact-gauge coefficient; \(T_0\) drives the connector
Arrhenius term.

The MIL PTH complexity factor is

\[
\pi_C=0.65P^{0.63}.
\]

The Section 16.2 surface-mount strain and life calculation is

\[
\Delta\epsilon=\frac{d}{0.65h}
\left|\alpha_S\Delta T-\alpha_{CC}(\Delta T+T_{RISE})\right|10^{-6},
\]

\[
N_f=3.5(\Delta\epsilon)^{-2.26}\pi_{LC},\qquad
\alpha_{SMT}=\frac{N_f}{CR},\qquad
\lambda_{SMT}=\frac{ECF}{\alpha_{SMT}}10^6.
\]

All SMT components are evaluated conceptually and the largest strain range is
the controlling board-level contribution. It is added once, not once per
component.

## Appendix A parts-count method

The equipment equation is

\[
\lambda_{EQUIP}=\sum_iN_i(\lambda_g\pi_Q)_i,
\]

with \(\pi_L\) also applied to microcircuits. Perdura implements 217 distinct
Appendix A line-item recipes. Each recipe evaluates the corresponding
part-stress equation using the Appendix A default temperature, stress, package,
power, size, and environment assumptions, then applies the selected row's
quality and learning factor. This avoids treating rounded displayed values as
more precise than their governing equations.

## Appendix B detailed CMOS model

The detailed CMOS model sums seven time-dependent or constant mechanisms:

\[
\lambda_p(t)=\lambda_{OX}(t)+\lambda_{MET}(t)+\lambda_{HC}(t)+
\lambda_{CON}(t)+\lambda_{PAC}+\lambda_{ESD}+\lambda_{MIS}(t).
\]

Perdura inserts the handbook's printed lognormal density/rate expressions for
oxide, metallization, hot-carrier, and plastic-package wearout into the
Appendix B sum. These expressions are not the ordinary lognormal hazard
\(f(t)/S(t)\). Fabrication contamination, EOS/ESD, and miscellaneous defects
are included separately. Measured oxide/metal defect density, drain current,
and substrate current may replace the Appendix B derived relations. Relative
humidity is entered in percentage units, as used by the source equations.

The three QML mechanism factors are kept independent in the implementation.
Appendix B prints \(QML=2\) for oxide, \(QML=.2\) for metallization, and
\(QML=2\) for hot carrier, with `.5` for each non-QML branch. Perdura adopts
\(QML_{MET}=2.0\) as a disclosed engineering correction to the apparent
metallization decimal error because it matches the adjacent mechanisms and the
intended median-life direction of QML screening. Because Appendix B inserts a
density/rate expression rather than an ordinary hazard, increasing median life
does not guarantee a lower instantaneous contribution at every evaluation
time. Each result records the
printed value, adopted value, and alternate printed-literal metallization and
total rates; there is no user-selectable alternate calculation mode.

## What the A/V51.1 checkbox means

A/V51.1 is a subsidiary specification. Checking its global or per-part box
does not replace MIL-HDBK-217F: it selects the same MIL base equation and then
applies the A/V rule, table continuation, mapping, or permitted alternate
method for that part.

Checking the box also makes an explicit project assumption: commercial parts
are of known pedigree and the acquisition/manufacturing process has the
Appendix C counterfeit-parts controls. Without that evidence, the lower
commercial \(\pi_Q\) values are not justified.

Defaults are used only when better information is absent. Actual stress,
temperature, package, supplier quality, and usage inputs take priority. The
connector editor therefore has a specific switch for retaining known actual
inputs instead of the A/V module/CCA connector defaults. An explicit custom
\(\pi_Q\) also takes priority over an A/V default and is disclosed.

## A/V51.1 rule implementation

### General and integrated circuits

- Every prediction retains a stated temperature and environment.
- Commercial known-pedigree ICs use \(\pi_Q=1\).
- Commercial IC packages use the nonhermetic Section 5 package equation.
- Part-stress microcircuits retain the Section 5 years-in-production learning
  factor; the fixed \(\pi_L=1\) rule applies only to parts count.
- A case-to-junction or other temperature-rise calculation requires a named
  derivation source.
- A feature size below 130 nm emits the A/V recommendation to perform separate
  electromigration, TDDB, hot-carrier, and NBTI wearout analysis under VITA
  51.2 or an equivalent method.
- SDRAM maps to DRAM, NVSRAM maps to SRAM, and Flash maps to Flotox EEPROM.
- Section 5 \(C_2=aN_p^b\) continues beyond the displayed pin rows.
- Complexities beyond the last printed MIL/A/V band require an explicit,
  disclosed \(C_1\), rather than silent extrapolation.

A/V Table 2.1.2-1 is represented by these added upper bands:

| Device | Technology | Added upper bound and \(C_1\) |
|---|---|---|
| Linear | bipolar or MOS | 30,000: 0.08; 60,000: 0.10 |
| PLA/PAL | bipolar | 10,000: 0.084; 30,000: 0.168; 60,000: 0.336 |
| PLA/PAL | MOS | 30,000: 0.0136; 60,000: 0.0272 |
| Microprocessor | bipolar | 64 bits: 0.48; 128 bits: 0.96 |
| Microprocessor | MOS | 64 bits: 1.12; 128 bits: 2.24 |

The memory extensions are:

| Bits | MOS ROM | MOS PROM/UVPROM/EEPROM/EAPROM | MOS DRAM | MOS/BiMOS SRAM | Bipolar ROM/PROM | Bipolar SRAM |
|---:|---:|---:|---:|---:|---:|---:|
| 1M–4M | 0.0104 | 0.0136 | 0.020 | 0.124 | 0.150 | 0.084 |
| 4M–16M | 0.0208 | 0.0272 | 0.040 | 0.248 | 0.300 | 0.168 |
| 16M–64M | 0.0416 | 0.0544 | 0.080 | 0.496 | 0.600 | 0.336 |
| 64M–256M | 0.0832 | 0.1088 | 0.160 | 0.992 | 1.20 | 0.672 |

### Semiconductors and passives

- Commercial known-pedigree discrete semiconductors use \(\pi_Q=1\). If a
  model has an unknown voltage-stress factor, its standard default is 0.5.
- The Appendix D recommended MOSFET base rates are activated:
  \(\lambda_b=0.0012\) FPMH for low-frequency MOSFETs and
  \(\lambda_b=0.006\) FPMH for high-frequency MOSFETs. A/V characterizes both
  as 60% confidence recommendations, which the result discloses.
- Commercial resistors use \(\pi_Q=1\), except RM and RZ use 0.1. Unknown
  power ratio defaults to 0.5.
- Commercial capacitors use \(\pi_Q=1\), except CDR, PS, CKR, CSR, and CLR use
  0.1; CWR uses 0.1 only for \(C\ge0.1\ \mu\mathrm F\); and CCR uses 0.46.
  Unknown voltage ratio defaults to 0.5.
- A disclosed multiplier may represent the permitted functional credit for
  parallel capacitors. Perdura warns that excluded short or consequential
  failure modes must still be assessed.
- A/V names a PS construction but MIL-HDBK-217F has no PS calculation row.
  Perdura uses the CDR ceramic-chip equation for the horizontally stacked PS
  construction and explicitly identifies that mapping.
- Ferrite beads use the Section 11.2 fixed-inductor equation with
  \(\lambda_b=0.00003\), ambient temperature with no bead rise, and the
  Section 11 environment factor. \(\pi_Q=3\) is the recommended subsequent-use
  value; \(\pi_Q=1\) is retained only to reproduce the Appendix A row.

### Relays, switches, connectors, interconnection, and miscellaneous parts

| Part | Activated A/V default or mapping |
|---|---|
| Mechanical relay | commercial \(\pi_Q=1.5\) |
| Solid-state/time-delay relay | commercial \(\pi_Q=1\) |
| Switch | commercial \(\pi_Q=1\) |
| General module/CCA connector | \(\pi_Q=1\), rectangular, one connector half, at most 0.05 mating cycles per 1000 h |
| Commercial PTH interconnection assembly | \(\pi_Q=1\); active-only PTH count is permitted when excluded pins have no trace |
| Plastic BGA | \(\pi_{LC}=100\) |
| Ceramic BGA | \(\pi_{LC}=50\) |
| Panel meter | commercial \(\pi_Q=1\) |
| Quartz crystal | commercial \(\pi_Q=1\) |
| Oscillator | map to Section 19 quartz crystal, \(\pi_Q=1\) |
| Electronic filter | commercial \(\pi_Q=1\) |

### Appendix F PTH physics-of-failure method

With PTH method `auto`, the unchecked state uses MIL Section 16.1 and the
checked state uses the A/V Appendix F fatigue path. The entered geometry should
describe the smallest PTH in the hottest analyzed board region.

The areas are

\[
A_1=\frac{\pi}{4}[(h+d)^2-d^2],\qquad
A_2=\frac{\pi}{4}[d^2-(d-2t)^2].
\]

For an elastic trial stress below copper yield,

\[
\sigma=\frac{|\alpha_1-\alpha_2|\Delta T}
{1/E_2+A_2/(A_1E_1)},\qquad
\Delta\epsilon=\frac{\sigma}{E_2}.
\]

Above yield, Perdura uses the bilinear series-compliance form

\[
\sigma=\frac{|\alpha_1-\alpha_2|\Delta T+
S_y(E_2-E'_2)/(E_2E'_2)}
{1/E'_2+A_2/(A_1E_1)},
\]

\[
\Delta\epsilon=\frac{S_y}{E_2}+\frac{\sigma-S_y}{E'_2}.
\]

The expected cycles to failure are found by a monotonic, log-space bisection
of

\[
\Delta\epsilon=
\bar N_f^{-0.6}D_f^{0.75}+
0.9\frac{S_u}{E_2}
\left[\frac{\exp(D_f)}{0.36}\right]^
{0.1785\log_{10}(10^5/\bar N_f)}.
\]

Finally,

\[
\mathrm{FPMH}=\frac{10^6}{H_c\bar N_f}.
\]

The table supports epoxy-aramid, epoxy-glass/FR-4/G-10, epoxy-quartz,
polyimide-aramid, polyimide-glass, polyimide-quartz, and PTFE-glass. The
midpoint is used for a printed range unless measured \(E_1\) or z-axis CTE is
entered.

### MEMS oscillator proxy

A/V Appendix G treats the device as a 1–100-transistor analog MOS
microcircuit:

\[
C_1=0.01,\quad C_2=2.8\times10^{-4}(14)^{1.08},\quad
\pi_T=0.1\exp\left[-\frac{0.65}{k}
\left(\frac1{T_j+273}-\frac1{298}\right)\right],
\]

\[
\lambda_p=(C_1\pi_T+C_2\pi_E)\pi_Q\pi_L,\qquad
\pi_Q=\pi_L=1.
\]

The default 20°C ambient plus the Appendix G 30°C rise gives a 50°C junction
and reproduces 0.0095143705 FPMH, displayed as 0.0095 in the source. This is an
analog-microcircuit proxy, not a general MEMS wearout model. A/V provides no
numerical MEMS-hybrid model.

### Manufacturer-data conversions

For a Section 5 digital-logic manufacturer rate, Permission 2.3.4-1 is

\[
\lambda_p=\left[1+
\frac{\pi_T-\pi_{T,MFR}}{\pi_{T,MFR}}+
\frac{\pi_E-\pi_{E,MFR}}{\pi_{E,MFR}}
\right]\lambda_{B,MFR}.
\]

Perdura rejects a negative adjustment, which indicates that this relational
formula is unsuitable for the selected source/target pair and a documented
alternate conversion is required.

For the Appendix H parts-count method,

\[
\lambda_{target,MFR}=\lambda_{reference,MFR}
\frac{\lambda_{g,target}}{\lambda_{g,reference}}.
\]

Using the source example, \(0.002\) FPMH in GB and the MOS linear 14-pin row
converts to AUF as

\[
0.002\frac{0.1317320506}{0.0095143705}
=0.0276911753\ \mathrm{FPMH}.
\]

Manufacturer or field data remain analyst-supplied evidence. The result
records the source condition, conversion method, and factor as required by
A/V51.1. RAC Toolkit conversion factors are a permitted external alternative,
not reproduced in Perdura.

### Parts-count defaults

For commercial known-pedigree Appendix A microcircuits and discrete
semiconductors, checking A/V51.1 sets \(\pi_Q=1\). Microcircuits also use
\(\pi_L=1\). A/V Section 2.2 does not establish new parts-count quality
defaults for the other families, so their selected Appendix A quality remains
unchanged.

### Mixing models and methods

A/V recommends against replacing an available MIL model with a different
methodology. A different model is permitted for a technology absent from MIL,
which is the basis for the explicit ferrite, oscillator, MEMS, and Appendix F
paths.

A/V Rule 2.3.5-1 allows combining random-rate and wearout models only under the
VITA 51.2 mixing method. When a checked A/V PTH/SMT fatigue result is rolled up
with random-rate parts, Perdura emits a system warning: the arithmetic sum is
shown for visibility but must not be represented as a compliant mixed-method
MTBF without the separate VITA 51.2 analysis.

## Source inconsistencies and engineering adjustments

No source repair is silent. The result and regression tests identify each one.

1. MIL Section 8.3 prints a 0.01 kW flowing-CO2 table entry of 0.3, while
   \(\lambda_{COUPLING}=300P\) gives 3.0. Perdura follows the equation.
2. MIL Appendix A-9's switching-transformer row does not reconcile with any
   Section 11.1 category. Parts count uses the printed row; part stress uses
   Section 11.1.
3. Rounded Appendix A values can differ slightly from equation recomputation.
   Perdura evaluates the governing equation and uses explicit display-rounding
   tolerances in parity tests.
4. The Section 12.1 cumulative-failure scan has an apparent gap above 0.90.
   The terminal row is treated as the final band.
5. The low-resolution Appendix A capacitor scan resembles 20 µF for seven
   ceramic rows; all seven rates reconcile independently to 2.0 µF, which is
   implemented.
6. A/V Appendix F Equation 1.2 prints an area-modulus denominator that has the
   wrong dimensions for both stress and its following strain equation. Perdura
   restores the IPC-TR-579 series-compliance form and explicitly branches at
   yield. Directly executing the printed expression would produce reciprocal
   force units and a negative plastic-strain term for ordinary boards.
7. A/V identifies PS quality but MIL has no PS numerical model. The closest
   constituent CDR ceramic-chip equation is used and disclosed.
8. A/V Appendix G prints GB \(\pi_E=0.05\), but its own 0.0095 row and Appendix
   H's explicit recomputation require MIL's \(\pi_E=0.5\). Perdura uses 0.5.
9. Appendix G says to add a 30°C rise, while Appendix H labels the reproduced
   condition as a 50°C junction. The default 20°C ambient plus 30°C rise is
   used to reproduce the controlled example; both inputs remain editable.

## Verification evidence

Automated verification includes:

- all public MIL models, every resistor/capacitor style, every Appendix A row,
  and all Appendix B mechanisms;
- eight printed MIL worked examples;
- every A/V quality exception and its boundary, including CWR at exactly
  0.1 µF;
- every A/V IC complexity and memory-extension band;
- SDRAM, NVSRAM, and Flash mappings;
- both MOSFET base-rate recommendations;
- connector default/known-actual behavior and both BGA factors;
- an independent Appendix F geometry, bilinear stress, strain-life root, and
  FPMH recomputation;
- exact Appendix G and Appendix H example parity;
- global and per-part checkbox behavior, VITA-only categories, long-form
  traceability, methodology disclosure, and the mixed-method warning; and
- a production TypeScript build of the complete Prediction UI.

Run the focused evidence with:

```bash
PYTHONPATH=src .venv/bin/pytest -q tests/test_mil_hdbk_217f.py tests/test_vita_51_1.py
(cd gui/backend && PYTHONPATH=../../src ../../.venv/bin/pytest -q tests/test_mil_hdbk_217f_complete.py tests/test_standards_disclosure.py)
(cd gui/frontend && npm run build)
```

“Verified implementation” means the controlled clauses and examples above are
mapped and tested. It does not certify a supplier, prove that a 1995 empirical
model predicts a particular modern design, replace project tailoring, or
remove the need for independent review of a contractual reliability report.
