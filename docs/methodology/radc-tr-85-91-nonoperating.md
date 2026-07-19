# RADC-TR-85-91 nonoperating reliability methodology

## Purpose and status

Perdura uses RADC-TR-85-91, *Impact of Nonoperating Periods on Equipment
Reliability* (May 1985, accession AD-A158843), as a separately identified
source for electronic-part failure rates during nonoperating exposure. The
implementation covers the general equations in Appendix A Section 5.2.1 and
the component models in Sections 5.2.2 through 5.2.15.

This extension answers a narrow question: when a part spends a stated fraction
of calendar time operating and the balance nonoperating, what constant-rate
service-life estimate follows from combining the selected operating handbook
rate with the report's nonoperating rate? It is not a dormant multiplier on an
operating rate, a spacecraft model, or part of MIL-HDBK-217F Notice 2 itself.

The implemented source hierarchy is therefore:

1. MIL-HDBK-217F Notice 2, with ANSI/VITA 51.1 when selected, supplies the
   operating failure-rate calculation.
2. RADC-TR-85-91 supplies the nonoperating calculation only where its Appendix
   A model and domain match the part and exposure.
3. The two rates are combined on a calendar-time basis using the explicit
   operating fraction.

A supported result establishes verified transcription of the report within
the stated scope. It does not establish empirical validity for a particular
design, environment, storage program, or field population. The report itself
identifies some factors as preliminary, theoretical, or extrapolated, and
Perdura preserves that warning on every calculated result.

## Source control and authority

| Item | Recorded value |
|---|---|
| Source | RADC-TR-85-91, May 1985 |
| Title | *Impact of Nonoperating Periods on Equipment Reliability* |
| Accession | AD-A158843 (`ADA158843` in compact catalog form) |
| Issuing organization | Rome Air Development Center |
| Implemented material | Appendix A, Sections 5.2.1–5.2.15, pages A-1–A-72 |
| Local review file | `RADC-TR-85-91_MAY1985.pdf` |
| Recorded SHA-256 | `0a521f2b89e59dca1b0b6de464923c0ca320a1336f826a0e904a8de18175662d` |
| Repository policy | Metadata only; the newly supplied PDF is not distributed in Git |

The report is both MIL-HDBK-217F Appendix C reference 19 and the selected
primary source for Perdura's nonoperating extension. That lineage does not
make the extension MIL-HDBK-217F calculation content. The machine-readable
[evidence catalog](../standards/mil-hdbk-217f-evidence.json) records the source
identity, hash, review status, limitations, and relationship to the governing
handbook. The broader MIL-HDBK evidence program and the RADC extension retain
separate conformance and assurance statements.

The executable transcription is in
`src/reliability/RADC_TR_85_91.py`. Prediction-system mapping and service-life
integration are in `gui/backend/routers/_radc_nonoperating.py` and
`gui/backend/routers/prediction.py`. Source tables remain explicit data in the
core module; they are not represented by approximate regressions in the UI.

## Result semantics, notation, and time bases

The following symbols are used throughout this document:

| Symbol | Meaning | Unit |
|---|---|---|
| \(\lambda_O\) | operating failure rate from the selected operating method | failures per \(10^6\) operating hours |
| \(\lambda_N\) | RADC nonoperating failure rate | failures per \(10^6\) nonoperating hours |
| \(\lambda_S\) | operating-fraction-weighted service rate | failures per \(10^6\) calendar hours |
| \(\lambda_{Nb}\) | nonoperating base rate | failures per \(10^6\) nonoperating hours |
| \(\pi_{NT}\) | nonoperating temperature factor | dimensionless |
| \(\pi_{NQ}\) | nonoperating quality factor | dimensionless |
| \(\pi_{NE}\) | nonoperating environment factor | dimensionless |
| \(\pi_{cyc}\) | equipment power-cycling factor | dimensionless |
| \(N_c\) | equipment power cycles | cycles per 1,000 nonoperating hours |
| \(f_O\) | fraction of calendar time operating | dimensionless, \(0\le f_O\le1\) |
| \(T\) | entered ambient nonoperating temperature | degrees Celsius |

One FPMH is \(10^{-6}\) failures/hour. Each source-specific rate keeps its own
exposure basis until the service-life weighting is applied. Perdura does not
label \(\lambda_N\) as an operating FPMH value or label the weighted result as
a nonoperating-only rate.

### Section 5.2.1 reliability equations

For multiple nonoperating intervals, Appendix A equation (1) is

\[
R_N=\exp\left[-\frac{1}{10^6}\sum_i \lambda_{N,i}t_{N,i}\right].
\]

For operating and nonoperating fractions \(f_i\) that sum to one, equation (2)
is represented as

\[
\lambda_S=
\sum_{i\in O}f_i\lambda_{O,i}
+\sum_{j\in N}f_j\lambda_{N,j},
\qquad
\sum_i f_i=1.
\]

The Prediction interface uses the corresponding one-operating-state,
one-nonoperating-state form:

\[
\lambda_S=f_O\lambda_O+(1-f_O)\lambda_N.
\]

For explicit operating and nonoperating durations, equation (3) is

\[
R=\exp\left[-\frac{
\sum_i\lambda_{O,i}t_{O,i}+
\sum_j\lambda_{N,j}t_{N,j}}{10^6}\right].
\]

The rate blend assumes piecewise constant hazard within each exposure state.
It does not model a transient hazard at storage entry, storage exit, or
power-up beyond the source's average power-cycling factor.

## Applicable nonoperating environments

Perdura exposes the report's nonoperating environment vocabulary separately
from the MIL-HDBK-217F operating environments:

| Code | Description | Code | Description |
|---|---|---|---|
| `GB` | Ground, Benign | `GF` | Ground, Fixed |
| `GM` | Ground, Mobile | `Mp` | Manpack |
| `NSB` | Naval, Submarine | `NS` | Naval, Sheltered |
| `NU` | Naval, Unsheltered | `NH` | Naval, Hydrofoil |
| `NUU` | Naval, Undersea, Unsheltered | `ARW` | Airborne, Rotary Wing |
| `AIC` | Airborne, Inhabited, Cargo | `AIT` | Airborne, Inhabited, Trainer |
| `AIB` | Airborne, Inhabited, Bomber | `AIA` | Airborne, Inhabited, Attack |
| `AIF` | Airborne, Inhabited, Fighter | `AUC` | Airborne, Uninhabited, Cargo |
| `AUT` | Airborne, Uninhabited, Trainer | `AUB` | Airborne, Uninhabited, Bomber |
| `AUA` | Airborne, Uninhabited, Attack | `AUF` | Airborne, Uninhabited, Fighter |
| `MFF` | Missile, Free Flight | `MFA` | Airbreathing Missile, Flight |
| `USL` | Undersea, Launch | `ML` | Missile, Launch |
| `CL` | Cannon, Launch |  |  |

Section 4.5 says that every category except Space, Flight was considered for
nonoperating prediction. `SF` is therefore intentionally rejected even though
several Appendix A environment tables print an `SF = 1` placeholder. A printed
placeholder cannot override the report's textual applicability exclusion.

RADC-TR-85-229 is a different report containing spacecraft-specific,
time-varying procedures. Its decreasing on-orbit hazard is not interchangeable
with a constant `SF` factor, so Perdura neither applies the placeholder nor
silently substitutes that later model. Spacecraft nonoperating prediction
remains outside this implementation.

Some source tables omit a factor for a particular environment. In particular,
the laser and relay tables do not provide a `CL` factor. Those combinations are
unavailable rather than interpolated or borrowed from another family.

## Common validation conventions

- Inputs must be finite. Rates and exposure durations are nonnegative; counts
  that represent physical items are exact integers and Boolean values are not
  accepted as counts.
- Equipment cycling is constrained to the report domain of 0 through 50 cycles
  per 1,000 nonoperating hours.
- Microelectronic temperature models are constrained to 0–160 °C. Discrete
  devices use their own printed endpoints: 0–90 °C for germanium devices,
  0–130 °C for FETs, 0–135 °C for microwave detector/mixer devices, and
  0–160 °C for the other temperature-dependent discrete families.
- A requested value beyond a tabulated or stated domain is not extrapolated.
- Case boundaries omitted by the report remain unsupported. Perdura does not
  resolve them by rounding or selecting the more favorable adjacent case.
- Environment and quality values are selected from the exact table associated
  with the component family. Factors from a nearby operating model or another
  RADC family are not reused.

## Appendix A model catalog

### Section 5.2.2: microelectronic devices

#### Sections 5.2.2.1–5.2.2.5: monolithic digital, linear, and memory devices

All three monolithic models use

\[
\lambda_N=\lambda_{Nb}\pi_{NT}\pi_{NQ}\pi_{NE}\pi_{cyc}.
\]

The base-rate term is selected by device type:

\[
\lambda_{Nb,\mathrm{digital}}=
\begin{cases}
0.00029N_g^{0.477},&N_g\le3100,\\
0.014,&N_g>3100,
\end{cases}
\]

\[
\lambda_{Nb,\mathrm{linear}}=0.00021N_t^{0.887},
\qquad 4\le N_t\le1000,
\]

and

\[
\lambda_{Nb,\mathrm{memory}}=
\begin{cases}
0.0034,&\text{bipolar technology},\\
0.0017,&\text{MOS technology}.
\end{cases}
\]

The report's memory base rate is technology-based; entered memory capacity is
retained for traceability but does not alter that rate.

The common temperature expression is

\[
\pi_{NT}=K_1+K_2\exp\left[-A_n\left(
\frac{1}{T+273}-\frac{1}{298}\right)\right].
\]

| Technology family | \(A_n\) | \(K_1\) | \(K_2\) |
|---|---:|---:|---:|
| TTL / HTTL / DTL / ECL | 4813 | .91 | .09 |
| LTTL / STTL | 5261 | .90 | .10 |
| LSTTL | 5711 | .89 | .11 |
| IIL | 6607 | .86 | .14 |
| MNOS | 6607 | .61 | .39 |
| PMOS | 5711 | .68 | .32 |
| NMOS / CCD | 6159 | .65 | .35 |
| CMOS / CMOS-SOS | 7057 | .58 | .42 |
| Linear | 4748 | .50 | .50 |

The quality factors are `S = .53`, `B = 1.0`, `B-1 = 1.4`, `B-2 = 2.0`,
`C = 2.3`, `C-1 = 2.4`, `D = 2.5`, and `D-1 = 8.7`. The environment factor
comes from the hermetic or nonhermetic row set in Table 5.2.2.4-8.

For digital and memory devices,

\[
\pi_{cyc}=\begin{cases}1,&N_c<1,\\1+0.020N_c,&N_c\ge1,
\end{cases}
\]

while linear devices use

\[
\pi_{cyc}=\begin{cases}1,&N_c<1,\\1+0.031N_c,&N_c\ge1.
\end{cases}
\]

Linear devices must use the linear technology coefficients; non-linear device
types cannot use them. Digital gate count must be at least one, and linear
transistor count must remain within the source range.

#### Section 5.2.2.6: hybrid microcircuits

Let

\[
D=N_D+N_T+1.8N_{IC}.
\]

The base rate is

\[
\lambda_{Nb}=A\exp(b_1N_D+b_2N_T+b_3N_{IC}),
\]

with the source cases:

| Case | Domain | \(A\) | \(b_1\) | \(b_2\) | \(b_3\) |
|---|---|---:|---:|---:|---:|
| I | \(D<12.2\) | .000817 | .45 | .45 | .81 |
| II | \(D>12.2\) | .013 | .033 | .033 | .059 |

The report does not define the exact boundary \(D=12.2\); Perdura rejects it.
The final model is

\[
\lambda_N=\lambda_{Nb}\pi_{NQ}\pi_{NE},
\]

with quality factors `S = .53`, `B = 1.0`, and `D = 8.6`. Capacitors,
packaged and substrate resistors, substrate, and interconnections are treated
as included in the fitted base rate. At least one counted device is required.

#### Section 5.2.2.7: magnetic bubble memory

The implementation retains the report's two structures. Define

\[
N_g=N_{transfer}+N_{dissipative}+N_{major},
\qquad
N_L=N_{major}+N_{minor}.
\]

Then

\[
\lambda_{Nb1}=0.0015N_g^{0.477},
\]

\[
\lambda_{N1}=\lambda_{Nb1}\pi_{NT}\pi_{NE},
\qquad
\lambda_{N2}=0.0089N_L\pi_{NT}\pi_{NE},
\]

and

\[
\lambda_N=\lambda_{N1}+\lambda_{N2}.
\]

Both structures use the NMOS/CCD temperature factor and the nonhermetic
microelectronic environment table. At least one major loop is required.

### Section 5.2.3: discrete semiconductors

Transistor and diode families use

\[
\lambda_N=\lambda_{Nb}\pi_{NT}\pi_{NE}\pi_{NQ}\pi_{cyc}.
\]

Group X optoelectronic devices omit temperature and cycling:

\[
\lambda_N=\lambda_{Nb}\pi_{NE}\pi_{NQ}.
\]

The Table 5.2.3-1 base-rate transcription is:

| Group | Part types | \(\lambda_{Nb}\) (FPMH) |
|---|---|---:|
| I | silicon NPN, silicon PNP | .00027 |
| I | germanium NPN, germanium PNP | .00040 |
| II | FET | .00039 |
| III | unijunction | .0013 |
| IV | silicon general-purpose diode | .00017 |
| IV | germanium general-purpose diode | .00042 |
| V | Zener/avalanche diode | .00040 |
| VI | thyristor | .00063 |
| VII | microwave detector, microwave mixer | .0027 |
| VIII | IMPATT, Gunn, varactor, PIN, step-recovery, tunnel | .0027 |
| IX | microwave transistor | .041 |
| X | LED | .00016 |
| X | single isolator | .00070 |
| X | dual isolator | .00089 |
| X | phototransistor | .00038 |
| X | photodiode | .00029 |
| X | alphanumeric display | .00025 |

For the temperature-dependent families, with \(T_K=T+273\),

\[
\pi_{NT}=\exp\left[-A_t\left(\frac{1}{T_K}-\frac{1}{298}\right)
+\left(\frac{T_K}{T_M}\right)^P\right].
\]

| Parameter family | \(A_t\) | \(T_M\) | \(P\) | maximum \(T\) (°C) |
|---|---:|---:|---:|---:|
| Silicon NPN | 3356 | 448 | 10.5 | 160 |
| Silicon PNP | 3541 | 448 | 14.2 | 160 |
| Germanium PNP | 4403 | 373 | 20.8 | 90 |
| Germanium NPN | 4482 | 373 | 19.0 | 90 |
| FET | 3423 | 448 | 13.8 | 130 |
| Unijunction | 4040 | 448 | 13.8 | 160 |
| Silicon general-purpose diode | 4399 | 448 | 17.7 | 160 |
| Germanium general-purpose diode | 5829 | 373 | 22.5 | 90 |
| Zener/avalanche | 3061 | 448 | 14.0 | 160 |
| Thyristor | 4311 | 448 | 9.6 | 160 |
| Microwave detector/mixer | 2738 | 423 | 16.6 | 135 |
| Special microwave diode | 3423 | 448 | 13.8 | 160 |
| Microwave transistor | 5700 | 623 | 20.0 | 160 |

Transistor families use

\[
\pi_{cyc}=\begin{cases}1,&N_c<1,\\1+0.050N_c,&N_c\ge1,
\end{cases}
\]

and diode families use

\[
\pi_{cyc}=\begin{cases}1,&N_c<0.6,\\1+0.083N_c,&N_c\ge0.6.
\end{cases}
\]

Quality factors are `JANTXV = .57`, `JANTX = 1.0`, `JAN = 3.6`,
`Lower, Hermetic = 13.0`, and `Plastic = 23.0`. Environment factors are
selected by groups I–X from Table 5.2.3-5.

Perdura evaluates the printed continuous temperature equation. The rounded
source tables print 1.00 at 25 °C for cases where that equation evaluates
slightly above one; the equation, not the rounded display value, governs the
calculation.

### Section 5.2.4: electronic-vacuum and microwave tubes

The model is

\[
\lambda_N=\lambda_{Nb}\pi_{NE}.
\]

| Tube type | \(\lambda_{Nb}\) (FPMH) |
|---|---:|
| Receiver triode/tetrode/pentode | .0040 |
| Receiver power rectifier | .0090 |
| CRT | .013 |
| Thyratron | .32 |
| Vidicon | .049 |
| Crossed-field amplifier | 1.29 |
| Pulsed gridded | 1.03 |
| Transmitting triode/tetrode/pentode | .56 |
| Transmitting under 200 kW at 200 MHz or 2 kW average | 1.61 |
| Twystron | 2.60 |
| Magnetron | 1.02 |
| Continuous-wave klystron | 1.20 |
| Low-power klystron | .19 |
| Pulsed klystron | 1.15 |
| Traveling-wave tube | .69 |

The environment factor is read from Table 5.2.4-2. The `NS` value is 29; it
was confirmed by visual source review because the PDF text layer drops that
row.

### Section 5.2.5: laser-peculiar items

Laser models are functional, not piece-part, models. Supporting electronics
and mechanical devices must be predicted separately. With \(N_{op}\) equal to
the number of active optical surfaces, the implemented equations are:

| Laser type | Equation |
|---|---|
| Helium-neon | \(\lambda_N=.11\pi_{NE}\) |
| Argon-ion | \(\lambda_N=.61\pi_{NE}\) |
| Sealed CO₂ | \(\lambda_N=(.65+.013N_{op})\pi_{NE}\) |
| Flowing CO₂ | \(\lambda_N=.039N_{op}\pi_{NE}\) |
| Solid state | \(\lambda_N=(.062+.021N_{op})\pi_{NE}\) |

The three surface-dependent models require at least one active optical
surface. The environment factor is selected from Table 5.2.5-1. The report
does not supply a `CL` laser factor, so that environment is unavailable.

### Section 5.2.6: resistors

The resistor equation is

\[
\lambda_N=\lambda_{Nb}\pi_{NE}\pi_{NQ}\pi_{cyc}.
\]

| Environment family | MIL styles | \(\lambda_{Nb}\) (FPMH) |
|---|---|---:|
| Fixed composition | `RC`, `RCR` | .000063 |
| Fixed film | `RN`, `RD`, `RL`, `RLR` | .00010 |
| Film network | `RZ` | .00043 |
| Fixed wirewound | `RW`, `RB`, `RBR`, `RE`, `RWR`, `RER` | .00057 |
| Thermistor | `RTH` | .0027 |
| Variable nonwirewound | `RV`, `RJ`, `RVC`, `RQ`, `RJR` | .0052 |
| Variable wirewound | `RA`, `RP`, `RR`, `RK` | .0052 |
| Variable wirewound | `RT`, `RTR` | .00099 |

Quality factors are `S = .15`, `R = .28`, `P = .52`, `M = 1.0`,
`MIL-SPEC = 2.4`, and `Lower = 4.4`. The environment factor is selected by
the family above from Table 5.2.6-2. Cycling is

\[
\pi_{cyc}=\begin{cases}1,&N_c<0.8,\\1+0.063N_c,&N_c\ge0.8.
\end{cases}
\]

Table 5.2.6-2 prohibits styles `RP` and `RK` in `NU`, `AUC`, `AUT`, `AUB`,
`AUA`, `AUF`, `MFF`, `MFA`, `USL`, `ML`, and `CL`; Perdura rejects those
combinations.

### Section 5.2.7: capacitors

The capacitor equation is

\[
\lambda_N=\lambda_{Nb}\pi_{NE}\pi_{NQ}\pi_{cyc}.
\]

| Environment family | MIL styles | \(\lambda_{Nb}\) (FPMH) |
|---|---|---:|
| Paper/plastic film | `CP`, `CZ`, `CA`, `CPV`, `CH`, `CQ`, `CQR`, `CHR`, `CFR`, `CRH` | .0011 |
| Mica/glass | `CM`, `CB`, `CMR` | .00075 |
| Mica/glass | `CY`, `CYR` | .00045 |
| Ceramic | `CC`, `CCR`, `CK`, `CKR` | .00039 |
| Aluminum electrolytic | `CE`, `CU` | .0064 |
| Tantalum nonsolid | `CL`, `CLR` | .0064 |
| Tantalum solid | `CSR` | .00018 |
| Variable | `CV` | .012 |
| Variable | `CT` | .015 |
| Variable | `PC` | .0038 |
| Variable | `CG` | .046 |

Quality factors are `T = .05`, `S = .10`, `R = .23`, `P = .46`,
`M = 1.0`, `L = 1.7`, `MIL-SPEC = 2.5`, and `Lower = 5.3`. The environment
factor is selected by family from Table 5.2.7-2. Cycling is

\[
\pi_{cyc}=\begin{cases}1,&N_c<0.3,\\1+0.16N_c,&N_c\ge0.3.
\end{cases}
\]

The source prohibition marks make style `CG` unavailable in `MFF`, `MFA`,
`USL`, and `ML`. The marks stop before `CL`; Perdura retains the printed `CL`
variable-capacitor environment factor of 930 rather than extending the
prohibition beyond the table.

### Section 5.2.8: transformers and RF coils

The model is

\[
\lambda_N=\lambda_{Nb}\pi_{NQ}\pi_{NE}\pi_{cyc}.
\]

| Family | Part type | \(\lambda_{Nb}\) (FPMH) |
|---|---|---:|
| Transformer | Audio transformer | .000055 |
| Transformer | Power transformer | .00028 |
| Transformer | High-power pulse transformer | .00028 |
| Transformer | Low-power pulse transformer | .000055 |
| Transformer | IF/RF discriminator transformer | .00028 |
| Coil | RF coil, fixed/variable | .00015 |
| Coil | RF coil, molded ER | .00015 |

Quality factors are `S = .06`, `R = .15`, `P = .38`, `M = 1.0`,
`MIL-SPEC = 3.1`, and `Lower = 11.0`. Table 5.2.8-2 limits `S`, `R`, `P`, and
`M` to coils; transformer requests using those levels are rejected.

Transformers use

\[
\pi_{cyc}=\begin{cases}1,&N_c\le0.05,\\1+0.75N_c,&N_c>0.05,
\end{cases}
\]

and coils use

\[
\pi_{cyc}=\begin{cases}1,&N_c\le0.1,\\1+0.38N_c,&N_c>0.1.
\end{cases}
\]

Transformer and coil environment factors come from their distinct rows in
Table 5.2.8-3.

### Section 5.2.9: sub-horsepower rotating devices

Section 5.2.9 supplies tabulated average rates rather than a factor product:

| Part type | \(\lambda_N\) (FPMH) |
|---|---:|
| Motor | .045 |
| Synchro | .14 |
| Resolver | .14 |
| Elapsed-time meter | 1.2 |

The motor row applies only to AC or DC motors rated below one horsepower.

### Section 5.2.10: relays

The relay equation is

\[
\lambda_N=\lambda_{Nb}\pi_{NQ}\pi_{NE}.
\]

The base rate is `.0004` for a hermetic relay at any contact voltage. For a
nonhermetic relay it is `.010` below 50 mV and `.002` above 50 mV. The source
does not assign the exact 50 mV boundary; Perdura rejects that value.

Quality factors are `Established Reliability = .46`, `MIL-SPEC = 1.0`, and
`Lower = 4.2`. The environment factor comes from Table 5.2.10-3. `CL` has no
reported factor and is unavailable.

### Section 5.2.11: switches

The switch equation is

\[
\lambda_N=\lambda_{Nb}\pi_{NQ}\pi_{NE}.
\]

The base rate is `.030` below 50 mV and `.006` above 50 mV. As in the relay
table, exactly 50 mV is not defined and is rejected. The quality factors are
`Established Reliability = .46`, `MIL-SPEC = 1.0`, and `Lower = 4.2`; the
environment factor comes from Table 5.2.11-3.

### Section 5.2.12: connectors

The connector equation is

\[
\lambda_N=\lambda_{Nb}\pi_{NE}.
\]

Circular, coaxial, and power connectors use \(\lambda_{Nb}=.00044\) FPMH.
Rack-and-panel and printed-wiring-board connectors use
\(\lambda_{Nb}=.0029\) FPMH. The environment factor comes from Table
5.2.12-2.

### Section 5.2.13: plated-through-hole interconnection assemblies

The assembly equation is

\[
\lambda_N=\lambda_{Nb}N_{PTH}\pi_{NE}.
\]

| Technology | \(\lambda_{Nb}\) per functional PTH (FPMH) |
|---|---:|
| Double-sided soldered printed wiring | .0000014 |
| Multilayer soldered printed wiring | .0000028 |
| Discrete wiring with electroless-deposited PTH | .0000089 |

At least one functional PTH is required. The count includes nonsoldered
functional via holes, as directed by the report. The environment factor comes
from Table 5.2.13-2.

### Section 5.2.14: connections without PTHs

For an assembly containing one or more connection technologies,

\[
\lambda_N=\pi_{NE}\sum_i N_i\lambda_{Nb,i}.
\]

| Connection technology | \(\lambda_{Nb}\) per connection (FPMH) |
|---|---:|
| Hand solder | .000089 |
| Crimp | .000013 |
| Weld | .0000017 |
| Solderless wrap | .00000012 |
| Wrapped and soldered | .0000048 |
| Clip termination | .0000041 |
| Reflow solder | .0000024 |

The environment factor comes from Table 5.2.14-2. At least one connection is
required. The report treats the supporting structure that holds connections
and parts as having zero nonoperating rate; Perdura records that as an
assumption rather than adding an unreferenced contribution.

### Section 5.2.15: miscellaneous parts

Most Section 5.2.15 entries are tabulated averages:

| Part type | \(\lambda_N\) (FPMH) |
|---|---:|
| Vibrator | 3.3 |
| Quartz crystal | .039 |
| Fuse | .0014 |
| Neon lamp | .029 |
| Incandescent lamp | .11 |
| Single fiber-optic connector | .014 |
| Meter | 1.4 |
| Circuit breaker | .29 |
| Microwave fixed element | 0 |
| Microwave variable element | .014 |
| Microwave ferrite device | .043 |
| Dummy load | .011 |
| Termination | .010 |

Fixed directional couplers, fixed stubs, and fixed cavities are represented as
zero because the table describes their contribution as negligible. This is a
source interpretation, not a claim that failure is physically impossible.

Single-fiber cable uses

\[
\lambda_N=.014L,
\]

where \(L\) is positive fiber length in kilometers. An attenuator delegates to
the complete Section 5.2.6 style `RD` resistor calculation, including its
quality, environment, and cycling factors, as directed by the Table 5.2.15-1
footnote.

## Exact mapping from Prediction parts

The operating and nonoperating sources do not share a one-to-one taxonomy.
Automatic mapping is allowed only when the operating category and its stored
parameters establish the RADC type exactly. Otherwise, Perdura requires an
explicit `nonoperating_params` value or reports the service calculation as
unavailable. It never chooses a model from a similar-sounding label.

| Operating Prediction input | Automatic RADC mapping and required detail |
|---|---|
| Monolithic microcircuit | Linear maps to linear technology. Digital, PLA, and microprocessor require exact RADC technology. Memory requires exact technology except explicit CCD memory, which maps to the NMOS/CCD family. Package must establish hermeticity; only exact historical quality mappings are automatic. |
| Hybrid microcircuit | Requires explicit diode, transistor, and integrated-circuit counts. |
| Bubble memory | Requires the four RADC gate/loop counts; temperature and environment come from the nonoperating exposure. |
| Discrete semiconductor | FET, unijunction, thyristor, certain HF types, and identifiable optoelectronic devices map directly. Generic diode/BJT and ambiguous HF devices require the exact Table 5.2.3-1 `part_type`. Quality must have an exact RADC counterpart. |
| Tube | Traveling-wave tube and magnetron map directly. Other tube categories map only from a recognized tube subtype or an explicit RADC `tube_type`. |
| Laser | Helium-neon, argon-ion, sealed CO₂, flowing CO₂, and solid-state categories map directly; the last three retain their active-optical-surface count. |
| Resistor or capacitor | The report's MIL style is used directly. Only exact quality correspondences are automatic. |
| Transformer or coil | Recognized transformer construction maps to the corresponding RADC row; RF coil maps to the coil row. Exact quality restrictions still apply. |
| Motor, synchro/resolver, elapsed-time meter | Maps to the corresponding Section 5.2.9 average-rate row. |
| Relay | Requires explicit hermetic/nonhermetic package and contact voltage; the operating relay model does not establish them. |
| Switch | Requires explicit contact voltage. |
| Connector | Recognized circular, RF coaxial, power, rack/panel, and card-edge constructions map to the five RADC rows; other construction needs explicit detail. |
| PTH assembly | Double-sided, multilayer, or discrete-wiring technology must be established. Automated plus hand-soldered PTH counts form the default functional count, which may be explicitly corrected. |
| Connection | Recognized hand-solder, wrapped-and-soldered, crimp, weld, solderless-wrap, clip, or reflow construction maps to one counted connection. |
| Crystal, fuse, meter, circuit breaker | Maps directly to the corresponding Section 5.2.15 average. |
| Generic miscellaneous part or lamp | Requires the exact Section 5.2.15 `part_type`. Fiber length and attenuator inputs are required where applicable. |

Quality mappings are deliberately family-specific. For example, an operating
commercial resistor may map to RADC `Lower`, but an unrecognized semiconductor
quality is not converted to the same word. Similarly, a generic `MOS` or
`bipolar` description is insufficient where the RADC temperature table
distinguishes TTL, LTTL/STTL, LSTTL, IIL, MNOS, PMOS, NMOS/CCD, CMOS/SOS, and
linear technologies.

### Explicit model selection

An analyst may set `nonoperating_params.model` to one of the stable model IDs:

`microelectronic_device`, `hybrid_microcircuit`,
`magnetic_bubble_memory`, `discrete_semiconductor`, `tube`, `laser`,
`resistor`, `capacitor`, `inductive_device`, `rotating_device`, `relay`,
`switch`, `connector`, `pth_assembly`, `connections`, or
`miscellaneous_part`.

Explicit selection bypasses only automatic taxonomy mapping. It does not
bypass source validation. The model still requires its family-specific
parameters, allowed choices, count domains, temperature domain, environment,
and table boundaries. Exposure context is injected only for factors the chosen
model actually uses:

- environment for all environment-dependent models;
- temperature for monolithic microelectronics, bubble memory, and
  temperature-dependent discrete semiconductors; and
- cycling for monolithic microelectronics, applicable discrete
  semiconductors, resistors, capacitors, inductive devices, and attenuators.

An explicitly supplied model parameter takes precedence over the inherited
exposure value and remains visible in the result inputs.

## Hierarchy, quantity, and service-life integration

System Blocks carry `operating_fraction`, operating environment,
nonoperating environment, nonoperating temperature, cycles per 1,000
nonoperating hours, and quantity. Nonoperating context is required whenever
the effective operating fraction is below one; zero cycles must be entered as
an explicit zero rather than inferred from an empty field.

For nested blocks, operating fractions multiply:

\[
f_{O,\mathrm{effective}}=\prod_{b\in\mathrm{ancestry}}f_{O,b}.
\]

Environment, temperature, and cycle context inherit from the nearest block
that explicitly defines them. Block and part quantities are applied after the
unit service rate is calculated. They do not modify \(f_O\) or any RADC factor.

The RADC blend is enabled only for MIL-HDBK-217F Prediction and mission
calculations. A nonoperating fraction on Telcordia, 217Plus, FIDES, or another
operating method is rejected because this implementation does not establish a
source-authorized cross-standard blend.

The output labels keep the time bases distinct:

- `operating_failure_rate_fpmh`: operating handbook rate;
- `nonoperating_failure_rate_fpmh`: RADC or documented user rate;
- `service_failure_rate_fpmh`: calendar-time weighted result; and
- `rate_time_basis = calendar_hours`: explicit basis of the service result.

Mission phases apply the same equation within each phase. Phase duration,
operating fraction, operating environment, and complete nonoperating context
are explicit; missing nonoperating support makes the affected service result
unavailable rather than rerunning the operating model under another
environment.

## Overrides and fail-closed behavior

There are three separate override levels, each with different semantics:

1. A **nonoperating-rate override** replaces only \(\lambda_N\) in the
   service-life equation. Enabling it requires a nonnegative rate, a source
   type (`measured`, `manufacturer`, `qualification_test`,
   `engineering_estimate`, or `other`), and a nonempty source note. The
   operating handbook result is retained.
2. A **piece-part output override** replaces the final unit service rate after
   the operating and nonoperating calculation. The calculated service rate and
   override status remain in traceability.
3. A **System Block output override** replaces that block's rolled-up service
   result. Descendant calculations remain visible but do not contribute again
   above the overriding block.

If a mixed-exposure part has no exact RADC mapping and no documented
nonoperating override, Perdura returns the operating result but marks the
part's service rate unavailable. An included unavailable part makes its
containing roll-up and the system service rate unavailable unless an
applicable part or block output override supplies the missing effective rate.
This prevents an incomplete total from being presented as a complete system
prediction.

Fully operating parts have no required \(\lambda_N\); their service rate is
the operating rate. A zero nonoperating rate is accepted only when it is a
source-defined table result or a documented override, not as a fallback.

## Disclosed source interpretations and repairs

| Location | Source issue | Adopted implementation |
|---|---|---|
| Section 4.5 and Appendix A environment tables | The prose excludes satellite applications, while several tables print `SF = 1`. | Reject `SF`; do not substitute a constant spacecraft rate. |
| Section 5.2.3 Tables 5.2.3-2/3 | Rounded tables show 1.00 at 25 °C where the printed continuous equation is slightly above one. | Evaluate the continuous equation and disclose the rounding difference. |
| Section 5.2.6 RCR worked example | Prose prints `.00063`; Table 5.2.6-1, the example substitution, and the printed final result use `.000063`. | Use `.000063`, following the table, substitution, and result. |
| Section 5.2.8 power-transformer worked example | Prose names \(\pi_{NE}=5.1\) at `GF`; Table 5.2.8-3 and the example product use 5.7. | Use 5.7, following the table and numerical product. |
| Section 5.2.10 environment table | Heading is misprinted as Table 5.2.5-1. | Identify it as Table 5.2.10-3 from the section context. |
| Section 5.2.4 tube `NS` row | PDF text extraction omits the row. | Use visually reviewed source value 29. |
| Section 5.2.7 style `CG` | Prohibition markers cover `MFF`, `MFA`, `USL`, and `ML`, then stop; `CL` prints 930. | Enforce only the marked prohibitions and retain `CL = 930`. |
| Sections 5.2.10–5.2.11 | Voltage cases are printed below and above 50 mV, not at 50 mV. | Reject exactly 50 mV. |
| Section 5.2.2.6 | Hybrid cases are printed below and above \(D=12.2\), not at 12.2. | Reject exactly 12.2. |

These are disclosed source interpretations, not silent corrections to the
report. Each affected calculation adds a warning where applicable.

## Result traceability contract

Every supported core result is immutable and contains:

- `failure_rate` and the explicit
  `nonoperating_failure_rate_fpmh` alias;
- `model`, normalized `inputs`, selected `factors`, assumptions, and warnings;
- a long-form sequence of symbols, descriptions, source expressions,
  numerical substitutions, intermediate values, and units; and
- source, document number, accession, report section, Appendix pages, table
  IDs, governing equation, unit, authority role, support status, assurance
  status, applicability, conformance scope, and source-model maturity.

The Prediction adapter adds the requested operating category and the exact
automatic or explicit mapping description. Unsupported results retain source,
requested category, reason, attempted explicit inputs, and
`support_status = unavailable`; they are not converted to a numerical zero.

The standard trace states:

- authority role: related primary nonoperating extension;
- conformance scope: RADC-TR-85-91 Appendix A, not MIL-HDBK-217F Notice 2;
- applicability: nonoperating electronic equipment except satellite
  applications; and
- maturity: mixed empirical, preliminary, theoretical, and extrapolated
  factors.

## Verification strategy

The independent test oracle is `tests/test_radc_tr_85_91.py`. Verification is
source-facing rather than a comparison with the operating MIL implementation:

- all 17 printed Appendix A numerical examples represented in the report are
  reproduced within explicit absolute tolerances;
- the Section 5.2.1 reliability, service-rate, and combined-reliability
  equations are checked independently;
- every Section 5.2.9 and 5.2.15 tabulated average exposed by the implementation
  is checked directly;
- selected quality and environment cells across different table families are
  checked to ensure one family is not accidentally reused for another;
- the RCR, transformer, tube `NS`, and capacitor `CG` interpretations are
  locked by regression tests;
- `SF`, missing `CL` factors, exact omitted boundaries, prohibited
  style/environment pairs, quality restrictions, and temperature/cycling
  endpoints are tested to fail closed; and
- the immutable long-form result and its source fields are contract-tested.

The report does not provide a formal conformance test suite. Printed worked
examples and independent equation/table oracles therefore form the available
transcription evidence. Passing them demonstrates agreement with the reviewed
report; it does not quantify predictive accuracy or uncertainty for field use.

The evidence catalog's broader program-level assurance state remains the
controlling status for the overall MIL-HDBK-217F implementation. RADC-specific
tests do not erase unrelated open findings in that program.

## Known limitations and deferred work

- The model is constant-rate within each operating or nonoperating exposure.
  It does not model duration-dependent storage aging, recovery, degradation,
  shock at state transitions, common-cause exposure, or uncertainty in the
  factors.
- The report's preliminary, theoretical, and extrapolated factors are used as
  printed. Perdura does not recalibrate them to contemporary technologies or
  claim that 1985 populations represent current production.
- Satellite and `SF` applications are excluded. A future spacecraft feature
  would require a separately scoped implementation and validation of the
  time-varying RADC-TR-85-229 procedures.
- Functional laser models do not replace separate calculations for supporting
  electronics and mechanical items.
- Section 5.2.9 motor rates cover only sub-horsepower AC/DC motors.
- The negligible microwave-fixed-element entry is represented numerically as
  zero only because that is the report's table interpretation.
- The service-life blend is a point estimate. It does not propagate
  uncertainty from \(\lambda_O\), \(\lambda_N\), \(f_O\), temperature,
  cycling, source data, or model selection.
- Explicit user overrides can complete an otherwise unsupported roll-up, but
  their validity is the analyst's responsibility. Source type and source note
  provide provenance, not independent verification.
- Historical Appendix C coverage is incomplete. Missing antecedent reports
  reduce lineage evidence but do not alter an unambiguous equation in the
  reviewed RADC-TR-85-91 source.

## Reproduction and maintenance controls

Run the focused source-oracle suite with:

```bash
pytest -q tests/test_radc_tr_85_91.py
```

Run the evidence-policy guard with:

```bash
python tools/check_reference_evidence.py
```

A change to an equation, source table, mapping rule, allowed environment,
boundary, source interpretation, or result trace must update the corresponding
test and this document. A new source may not silently widen applicability or
replace a printed RADC factor; changes must follow the evidence precedence and
metadata-only reference policy described in
[MIL-HDBK-217F source evidence and lineage](../standards/MIL-HDBK-217F-EVIDENCE.md).
