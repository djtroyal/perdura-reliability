# Derating standards audit and source plan

**Audit date:** 18 July 2026
**Status:** synthetic presets withdrawn; source-specific historical profiles implemented with explicit exclusions

## Result

Perdura's former `MIL-STD-975`, `NAVSEA`, and `ECSS` presets were synthetic,
generic three-level tables. They were not clause- or row-level reproductions of
the named documents and cannot be repaired by changing a few values. The
old selector and tables are therefore removed. NAVSEA and ECSS remain
unavailable and must not be described as implementations, compliant profiles,
or verified screening extracts of those standards. `MIL-STD-975M` is instead
available as a new, exact, canceled-historical Appendix A profile; it is not a
compatibility alias for the removed generic selector.

This is a provenance decision as well as a numerical one. The named sources use
device subtypes, several simultaneous stresses, temperature margins or absolute
temperatures, environmental and quality classes, mission duration, transients,
and source-specific exceptions. Collapsing them into one voltage, current,
power, and temperature row per broad component family changes the method.

User-authored custom limits remain a user-defined method. They carry no external
standards-conformance claim and need project approval and recorded provenance.

The subsequently supplied MIL-STD-975M base issue and Notices 1-3 establish a
real, single-level historical Appendix A rulebook. It is implemented under
its exact `MIL-STD-975M` identity, edition, and canceled status—not under the
former generic `MIL-STD-975 / NASA` label.  The supplied RADC-TR-84-254 and
RL-TR-92-11 reports are implemented as separate historical technical-report
methods; neither is a promulgated military standard or a supplement to
MIL-STD-975M.

## Why the former tables were rejected

The audit found material conflicts with the reviewed local government guidance.
Examples include:

| Former generic rule | Reviewed local cross-check | Consequence |
|---|---|---|
| Resistor power `50/60/80%` by level | Rome Toolkit Topic D1 generally gives `50/50/50%`, with separate resistor technologies and different temperature margins. | The broad row changes both the numerical limits and the applicable technology. |
| Capacitor voltage `50/60/70%` | Film/mica/glass is `50/60/60%`; electrolytic and variable-capacitor families use materially different rules. | One capacitor row is not a faithful transcription. |
| Diode reverse voltage `60/70/80%` | Many Rome diode rows use `70/70/70%`, alongside current, power, and junction-temperature limits. | The rule omits governing concurrent stresses. |
| Thyristor current `50/60/70%` | Rome gives `50/70/70%` for on-state current and also constrains off-state voltage and junction temperature. | The Level II result and the decision surface are wrong. |
| Microcircuit supply ratio `0.90/0.95/1.00` | Rome expresses supply voltage as a `+/-3%` or `+/-5%` tolerance band, not as a maximum stress ratio. | The quantity and comparison operator were misinterpreted. |
| One absolute-temperature check | Several source rows specify degrees below the manufacturer's maximum rating; others specify an absolute junction or channel temperature. | Comparing every temperature as an absolute maximum is dimensionally wrong. |
| Broad aliases such as circuit breaker to switch or laser to generic optoelectronics | The source supplies distinct rules for these device types. | Aliasing erases source-specific parameters and limits. |

These examples are sufficient to reject the table design; they are not a
complete transcription of any source.

## Reviewed local evidence

The following files are present in the analyst's local reference directory.
Their presence does not make them a current standard, and no public document
listed in the next section should be inferred to be present locally.

### Rome Laboratory Reliability Engineer's Toolkit

- Local file: `docs/references/Rome_Laboratory_Reliability_Engineers_Toolkit.pdf`
- SHA-256: `8ea85b2d1536c33b77c4e8191cc8d00592eabab1b4b08c11f15ea164fc15c815`
- Reviewed location: Topic D1, printed pages 37-43, PDF pages 45-51.
- Table D1-1 selects Level I, II, or III from reliability challenge, repair,
  safety, size/weight, and life-cycle scores.
- Table D1-2 supplies subtype-specific electrical, thermal, mechanical, and
  application limits for capacitors, connectors, diodes, fiber optics,
  inductors, lamps, microcircuits, optoelectronics, relays, resistors,
  transistors, tubes, rotating devices, SAW devices, and switches.

The toolkit is a government engineering application guide, not a formally
issued derating standard. It can support a distinctly named historical
`Rome Toolkit (1993)` profile after complete transcription and table-oracle
testing. It cannot be relabeled as MIL-STD-975M, NAVSEA, ECSS, or current NASA
conformance.

### RADC Reliability Engineer's Toolkit (1988)

- Local file: `docs/references/RADC_Reliability_Engineers_Toolkit.pdf`
- SHA-256: `2e137b2790eb97e428b380e053c02408ffb2531dbc1b6f55705d8baf0ce1c136`
- Reviewed location: July 1988 edition, Topic D1, beginning on printed page 41.

This earlier application guide directs the reader to AFSC Pamphlet 800-27,
*Parts Derating Guidelines*. It is useful lineage evidence, but the toolkit
does not make the missing pamphlet unnecessary and does not create a
standards-conformance claim.

### MIL-STD-975M and Notices 1-3

- Local base file: `docs/references/MIL-STD-975M.pdf`
- Base SHA-256: `65c6c329df8f3279573ace3aa6fb9f7690646897a7df2bb288cb468eac7cf15b`
- Notices 1-3 SHA-256: `8e354307ec49f67b38c8673c8df41c2029c82ad4848db3fd0b79c9de642e9c3b`,
  `7419f317e2f0bdedeaeb7cf051fb44b66b1e9a119cb71429fd37578da410a795`, and
  `6821afc1e11abdd290447fe6a4a36dade8900387f77475e6bff28813878b95d6`
- Reviewed location: Appendix A, printed A.3-A.37, base PDF 444-478.

Appendix A supplies one set of maximum recommended stresses for 16 commodity
sections.  It is not a Level I/II/III method.  Notices 1 and 2 do not change
Appendix A; Notice 3 canceled MIL-STD-975M without replacement on 5 May 1998.
The implementation therefore retains the full canceled-historical label and
fails closed where the source itself delegates or omits a calculation.

### MIL-HDBK-978B Volume I pulse delegation

- Reviewed official NASA copy: *NASA Parts Application Handbook*,
  MIL-HDBK-978B, Volume I, 1 March 1988.
- Reviewed-copy SHA-256:
  `7ad4d29529fa42b24676fc3e22f178c2d2c099617c15fab15af8db536aa453be`.
- Reviewed locations: resistor-general section 3.1.6.2, printed 3-12–3-13
  (PDF 158–159); fixed-composition section 3.2.5.2, printed 3-23–3-24
  (PDF 169–170); and established-reliability fixed-film section 3.3.5.3,
  printed 3-31 (PDF 177).

Appendix A.24 delegates pulse and irregular-waveform applications to this
handbook or to manufacturer data. Perdura now carries the Appendix A.24
time-average power calculation into those applications and executes only the
handbook limits whose construction and applicability are explicit. The
reviewed PDF remains metadata-only and is not force-added to the repository.

### RADC-TR-84-254

- Local file: `docs/references/RADC-TR-84-254.pdf`
- SHA-256: `0c0b17d09e0eb1a5126efa05afc6e33562ae22201382b3ce1191e163f69dea0d`
- Identity: RADC-TR-84-254 / ADA153744, December 1984.
- Reviewed locations: Tables 1-10, printed 5-12; thermal-model sections and
  appendices described in the source ledger below.

This contractor final report proposed a future military-standard framework. It
was not itself promulgated as a standard. Tables 1-9 are implemented as a
separately named historical advanced-device profile. Table 10 has an unassigned exact
500 MHz boundary and prints input power in dimensionless `dB`; those cases must
fail closed.  The report also depends on AFSC Pamphlet 800-27 for hybrid
constituent parts and on RADC-TR-82-177 for established parts.

The thermal material is research guidance, not a compliance oracle.  Among
other defects, section 5.4 prints heat flow as `theta * delta-T` while defining
thermal resistance as `theta = L/(kA)`; the dimensionally correct relationship
is `delta-T/theta`.  The internal model is explicitly a ballpark estimate and
substantially underpredicts the report's measured average thermal resistance.

### RL-TR-92-11

- Local file: `docs/references/RL-TR-92-11.pdf`
- SHA-256: `1dfb5dd71a0503a72cdfe19bafc4777bf0216e0f32855e05d44e8dfec09d9625`
- Identity: RL-TR-92-11 / ADA253334, February 1992.

This report extends AFSC Pamphlet 800-27 for advanced technologies.  Its
ASIC/VHSIC, memory, microwave, power-semiconductor, optoelectronic, passive,
and SAW final criteria are implemented as a separate historical technical-report
profile. They are not merged with MIL-STD-975M, RADC-TR-84-254, or Rome
Toolkit rows merely because the component names overlap.  RL-TR-92-11's
five-source comparison used MIL-STD-975H (June 1989), not the supplied 1994
Revision M; Revision M can corroborate later NASA practice but cannot recreate
that historical comparison.

## Implemented rule, equation, and disposition map

Each enabled source uses a dedicated input bag that records the selected
profile and source family. Prediction inputs and values entered for another
profile are never silently substituted. A required value that is missing,
ambiguous, delegated to another document, or outside the source's stated
domain produces `not_evaluated` or `unsupported`; neither state can produce a
passing assessment. Every normalized result preserves its source locator and
operator; evaluated numerical checks also emit the actual value, selected
limit, margin, formula, and input substitution.

### MIL-STD-975M Appendix A

The implementation covers every numbered Appendix A commodity section. A
section whose source supplies no executable rule remains visible and fails
closed rather than disappearing from the coverage count.

| Appendix A section | Implemented calculation | Source limitation or disposition |
|---|---|---|
| 3.1 Capacitors | Exact CCR, CKS, CKR, CDR, CYR, CRH, CHS, CLR25/27/35/37/79/81, CSR, CSS, and CWR rows; $V_{DC}+V_{AC,peak}\le f(T)V_{rated}$, including linear high-temperature interpolation, temperature caps, the below-10-V application rule, and effective-circuit-resistance condition. | A missing style-specific resistance or parts-specialist approval fails closed. |
| 3.2 Connectors | Strict source-example comparisons $V_{DWV}>4V_{application}$ and $T_{insert}>T_{ambient}+\Delta T_{ohmic}+50\,^{\circ}\mathrm C$. | The source's strict “greater than” wording is retained; equality does not pass. |
| 3.3 Crystals and crystal oscillators | Oscillator crystal current is limited to 50% of rating, or 75% only when startup time is explicitly critical; individual oscillator components must also be verified. | The section states that there are no approved standalone crystals, so those cases are unsupported. |
| 3.4 Diodes | Subtype-specific simultaneous voltage, current, surge, and power ratios; voltage-regulator/reference current equations; $T_j\le125\,^{\circ}\mathrm C$. | Only rows printed for the selected diode subtype are applied; absent required stress pairs fail closed. |
| 3.5 EMI filters | $I\le0.5I_{rated,operating}$, $V\le0.5V_{rated,operating}$, and $T_a\le85\,^{\circ}\mathrm C$. | Reference ratings are operating ratings, not absolute maxima. |
| 3.6 Inductors | Exact MIL-C-39010 and MIL-C-15305 insulation-class temperatures, winding-rise calculation, 10 °C hotspot allowance, $V_{application}\le0.5V_{DWV}$, and the source example's 100% rated-current ceiling. | Custom devices outside an 85–130 °C rating require project-parts-engineer guidance. The source's literal $0.75T_{rated}$ Celsius rule is retained with a dimensional warning. |
| 3.7 Linear microcircuits | Every device-row ratio for supply, power, input/output voltage, output and short-circuit current; $V_{input}\le V_{supply}$ where applicable; $T_j\le100\,^{\circ}\mathrm C$. | The exact operational-amplifier, differential-amplifier, comparator, sense-amplifier, current-amplifier, regulator, and analog-switch distinctions are preserved. |
| 3.8 Digital microcircuits | Technology-specific output/fanout, supply, clock, and open-collector/drain ratios; $V_{input}\le V_{supply}$ and $T_j\le100\,^{\circ}\mathrm C$. | Where the table gives no reduced supply factor, the implementation requires a strict value below the absolute maximum. Radiation cases require separate verification. |
| 3.9 Protective devices | Fuse table factors and $f(T)=f_{25}-0.005\max(T-25,0)$; circuit-breaker load factors 0.75/0.75/0.40/0.20/0.10 and $T_a\le T_{specified,max}-20\,^{\circ}\mathrm C$. | Fuse construction/mounting and circuit-breaker trip-curve, load, series-resistance, and thermal obligations are enforced. |
| 3.10 Relays | $I_{allowed}=I_{rated}F_TF_RF_L$ using the exact temperature, operating-rate, and load-class bands, including source constraints on on/off time and carry-only use. | The printed factor product is not capped at one; continuous temperatures use documented half-open versions of integer-ended bands. |
| 3.11 Resistors | Exact style-specific piecewise-linear power curves; $P_{allowed}=f(T)P_{nominal}$ and, for DC/regular AC, $V_{allowed}=\min(0.8V_{spec,max},\sqrt{P_{allowed}R_{active}})$. Pulse/irregular cases retain the time-average-power check and the MIL-HDBK-978B 3.1.6.2 maximum-voltage, continuous-overpower-fault, temperature-rise, and steep-wavefront duties. Low-duty RCR uses $V_{peak}\le2\,RCWV$; low-duty RNC/RNR/RNN/RLR use $V_{peak}\le1.4\,RCWV$, and those fixed-film styles also use $P_{peak}\le4P_{maximum}$. | Waveform selection is explicit. The RCR approximate 30–40× caution is not invented as a hard boundary: ratios $\le30$ are conservatively outside its trigger region, ratios above 30 through 40 are `not_evaluated`, and ratios above 40 require an explicit engineering-caution review. Irregular and other manufacturer-specific envelopes remain `not_evaluated`. |
| 3.12 Switches | The section is represented in the profile. | Its pages are reserved and contain no approved switch or numerical limit; all switch assessments are unsupported. |
| 3.13 Thermistors | PTC: $P\le\min(0.5P_{rated},P_{detailed})$; NTC: $P\le50\delta$ and $T_{part}\le100\,^{\circ}\mathrm C$; both use $V\le0.8\sqrt{P_{rated}R}$. | The prose and worked example govern where the scanned NTC graph is internally awkward; the interpretation is disclosed in the result. |
| 3.14 Transformers | Exact MIL-T-27 and MIL-T-21038 insulation-class temperatures, winding-rise calculation, 10 °C hotspot allowance, and $V_{application}\le0.5V_{DWV}$. | Appendix A does not supply a transformer-current derating check. The table/example DWV interpretation governs conflicting criteria prose; frequency and normal winding voltage are not independently derated. |
| 3.15 Transistors | $P\le0.50P_{rated}$, $I\le0.75I_{rated}$, $V_{DC}+V_{AC,peak}+V_{transient}\le0.75V_{rated}$, $T_j\le125\,^{\circ}\mathrm C$, and power-MOSFET $V_{GS}\le0.60V_{GS,rated}$. | A supplier safe-operating-area verification is mandatory and is not reconstructed from generic data. |
| 3.16 Wire and cable | Exact AWG single-wire current table; $I_{allowed}=I_{single}F_{bundle}F_{insulation}$ and $V_{DWV}\ge2V_{application}$, where $F_{bundle}=1$ for one wire, $(29-N)/28$ for 2–15 wires, and 0.5 above 15 wires. | The current table is restricted to round single conductors in a helical bundle at 70 °C and $10^{-9}$–$10^{-6}$ torr. Ribbon/flat or other bundle cases require project data. |

For the two winding families, the implemented copper-resistance rise equation
is

$$
\Delta T_{winding}=\frac{R_{hot}-R_{initial}}{R_{initial}}
\left(T_{initial}+234.5\right)-\left(T_{shutdown}-T_{initial}\right),
$$

with $|T_{shutdown}-T_{initial}|\le5\,^{\circ}\mathrm C$, followed by
$T_{operating}=T_{ambient}+\Delta T_{winding}+10\,^{\circ}\mathrm C$.
Fiber-optic/photonics parts appear in the broader document scope but have no
Appendix A numerical rule, so they are explicitly unsupported.

### RADC-TR-84-254 Tables 1–10

Levels I, II, and III are selected manually for Tables 1–9. The report's
ground/flight/space mapping is guidance, not an automatic environment-to-level
conversion. The transcribed limits are:

| Source table | Transcribed rows (Levels I / II / III) | Additional disposition |
|---|---|---|
| Table 1, hybrid | $T_j$: 85/100/110 °C; thick-film density: 50/50/50 W/in²; thin-film density: 40/40/40 W/in². Above 100 °C case temperature, $P_{limit}=P_{base}-(T_{case}-100)$ and the printed strict comparison is retained. | Every constituent must separately satisfy AFSCP 800-27. Completion and outcome are explicit obligations because that rulebook is not local. |
| Table 2, complex IC | $T_j$: 85/100/125 °C; supply ratio: 0.75/0.80/0.85; output-current ratio: 0.70/0.75/0.80; digital bipolar fanout and frequency: 0.70/0.75/0.80 and 0.75/0.80/0.90; MOS/CMOS: 0.80/0.80/0.90 and 0.80/0.80/0.80. | The normative table's 125 °C Level III value governs a conflicting 110 °C narrative value. The MOS row is used for CMOS because the section includes CMOS but prints no separate row. |
| Table 3, RAM/ROM | $T_j$: 85/100/125 °C; supply ratio: 0.75/0.80/0.85; output-current ratio: 0.70/0.75/0.80. | No unprinted digital rows are inferred. |
| Table 4, bubble memory | Ambient operating temperature: 85/85/85 °C. | External support-device checks must be separately declared complete and passing. |
| Tables 5–6, GaAs FET and microwave transistor/IMPATT/Gunn | $T_j$: 95/105/125 °C; power ratio: 0.50/0.60/0.70; breakdown-voltage ratio: 0.60/0.70/0.70. | Each table retains its own model identity even though the numerical rows match. |
| Tables 7–8, varactor/step-recovery/PIN/tunnel and silicon detector/mixer | $T_j$: 95/105/125 °C; power ratio: 0.50/0.60/0.70; breakdown-voltage ratio: 0.70/0.70/0.70. | Device groupings are source-defined and are not broadened by aliases. |
| Table 9, germanium detector/mixer | $T_j$: 75/90/105 °C; power ratio: 0.50/0.60/0.70; breakdown-voltage ratio: 0.70/0.70/0.70. | The report's warning that germanium devices are not recommended is emitted with the numerical result. |
| Table 10, SAW | Operating temperature: 125 °C; no Levels I–III. | The source defines only $f<500$ and $f>500$ MHz, leaving exactly 500 MHz undefined, and labels the power limits 18/13 “dB” without a reference. The absolute-power check is therefore always `not_evaluated`; the implementation does not silently reinterpret dB as dBm. |

The report's application prose is evaluated alongside those table rows rather
than being reduced to tooltip-only advice. Every model requires an explicit
declaration of whether the high-reliability recommendation in §2.1.2 applies;
when it does, complete testing, screening, and burn-in must be affirmed.
Model-specific controls then cover hybrid supply-voltage and ESD precautions;
complex-IC signal-noise and supply-deviation controls; RAM/ROM specification
tolerances and conditional dynamic-RAM refresh; bubble-memory tolerances;
supplier voltage limits for the high-stress microwave group; transient/ESD
safeguards for detector/mixers; and SAW surrounding-device thermal stability,
frequency stability, and ESD control. GaAs-FET transient/ESD hazards,
low-power-diode stress cautions, germanium non-recommendation, and the source's
technology-specific IC hazards remain visible warnings where the report gives
no objective acceptance threshold.

Native results preserve two independent axes: `compliance_status` records any
evaluated source exceedance, while `coverage_status` records missing or
unevaluated obligations. The single convenience `status` cannot therefore
hide incomplete coverage merely because another numeric row also failed.

The report's thermal sections remain non-acceptance research guidance. In
particular, section 5.4 defines $\theta=L/(kA)$ but prints heat flow as
$\theta\Delta T$; dimensional consistency requires $\Delta T/\theta$. Its
internal model is described as a ballpark estimate and underpredicts the
report's measured average, so it is not used to turn a table failure into a
pass.

### RL-TR-92-11 final criteria

RL-TR-92-11 Levels I–III are also a manual criticality selection. Perdura
executes the directly applicable final criteria, not the intermediate
reliability-model derivations used to develop them:

| Final table | Implemented scope | Governing calculations and obligations |
|---|---|---|
| 4-7 | MOS and bipolar, digital and linear ASIC/VHSIC | Count domains, supply limits, input/frequency/output/fanout percentages, and junction temperature. MOS supply uses the equations below; bipolar supply uses ±3/5/5% tolerance plus the supplier window. Section 4.4's application controls and aluminum-metallization current-density rule are separately traced. |
| 4-11 | 8-, 16-, and 32-bit MOS and bipolar microprocessors | MOS 8-bit supply maxima are 10/11/13 V; MOS 16/32-bit use count equations. Bipolar parts use ±3/5/5% tolerance. Frequency, output, fanout, temperature, count, supplier bounds, and applicable section 4.4 controls are enforced. |
| 4-15 | MOS EEPROM, other MOS PROM, and bipolar PROM | Maximum 1,000,000 bits; MOS supply equations; exact-integer EEPROM write-cycle equations and supplier ratings; bipolar tolerance; MOS frequency 80/80/90% and bipolar frequency 80/90/90%; output, junction-temperature, and section 4.4 checks. |
| 5-3 | GaAs MIMIC | Channel-temperature limit is selected from the four active-element ($\le100$ or $>100$) and passive-element ($\le10$ or $>10$) rows, then constrained by the supplier maximum. Report p. 96's inert-cavity and electrical-test-overstress controls are explicit obligations. |
| 6-4, 6-7, 6-9 | Silicon bipolar, GaAs MESFET, and silicon MOSFET power devices | Exact temperature, rated-power, breakdown-voltage, and bipolar SOA voltage/current percentages; supplier temperature-adjusted SOA, application design margins, and Figure 6-4 thermal-cycle verification are external obligations. ESD and heat-sink statements remain guidance. |
| 7-3 | Silicon bipolar and GaAs RF pulse devices, including multitransistor packages | Table 7-3 electrical limits, application design margins, and Figure 6-4 cycling are implemented. Section 7 does **not** import the power-device supplier-SOA gate or impose a separate package-assembly acceptance gate. A documented design-required voltage/power departure remains `not_evaluated` because note 4 supplies no alternate limit; temperature and silicon SOA current remain mandatory. |
| 8-2 | Photo transistors, APDs, PIN photodiodes, optocouplers, injection lasers, and LEDs | Exact table rows plus the 3 dB APD-gain and ILD-output margins, 15% optocoupler CTR allowance and drive-current control, ILD pulse/power/seal conditions, and LED current-limiting/rectified-AC peak controls on report p. 130. |
| 9-2 | RM chip resistors and CDR/CWR chip capacitors | Exact table rows plus strict chip-resistor limits $T_{film}<150\,^{\circ}\mathrm C$, voltage stress $<2$ V/mil, and power density $<200$ W/in²; conditional pulse/trimming/high-frequency controls; and $V_{AC,peak}+V_{DC}\le V_{derated,max}$. The ±12% ceramic and ±8% tantalum design allowances are enforced. The MIL-STD-198E cross-reference is expanded into explicit transient, AC/pulse, current/time-constant, heating, environment, insulation-resistance, CDR dielectric/silver/CTE, and CWR intended-use advisory checks. |
| 10-2 | SAW devices | 18 dBm below 500 MHz, 13 dBm above 500 MHz, and 125 °C at all three levels. Exactly 500 MHz is unsupported because the table defines neither branch. Hermetic integrity and below-rated-maximum shock, vibration, and temperature-cycle obligations are explicit. |

For MOS ASIC/VHSIC, 16/32-bit MOS microprocessors, and MOS PROMs, the
source's supply limit has the form $V_{max}=C/N^p$. The exact Level I/II/III
expressions are retained:

| Device | Level I | Level II | Level III |
|---|---:|---:|---:|
| MOS digital ASIC, gates $G$ | $129/G^{0.320}$ | $173/G^{0.347}$ | $157/G^{0.323}$ |
| MOS linear ASIC, transistors $TR$ | $200/TR^{0.315}$ | $189/TR^{0.311}$ | $210/TR^{0.347}$ |
| 16-bit MOS processor, gates $G$ | $606/G^{0.440}$ | $760/G^{0.462}$ | $698/G^{0.438}$ |
| 32-bit MOS processor, gates $G$ | $642/G^{0.442}$ | $627/G^{0.448}$ | $696/G^{0.438}$ |
| MOS EEPROM, bits $B$ | $65.2/B^{0.183}$ | $85.3/B^{0.199}$ | $85.3/B^{0.178}$ |
| Other MOS PROM, bits $B$ | $66/B^{0.178}$ | $71.1/B^{0.176}$ | $83.3/B^{0.175}$ |

EEPROM write-cycle maxima are $1.26\times10^8/B^{0.660}$ at Level I,
$6.94\times10^7/B^{0.470}$ at Level II, and 300,000 at Level III. Formula
limits are never evaluated outside their published count domain, and a
calculated voltage cannot pass unless it also produces a feasible window at
or above the supplier minimum and the applied supply remains within both
supplier bounds.

The report's current-density prose on p. 87 and Figure 4-34 on p. 88 are
internally inconsistent below approximately 51.913 °C: the graph uses an
ordinate in MA/cm² and plots above 0.5 MA/cm², while the prose says to select
the smaller of the equation and $5\times10^5$ A/cm². Perdura checks the
conservative
$\min(366\times10^6/T_C^{1.67},5\times10^5)$ A/cm² value and also emits an
`unsupported` contradiction row. Figure 4-34 is explicitly a 10,000-hour
curve; other required durations remain unsupported because the report gives no
duration transformation.

The following other source defects and delegations remain visible: Table 4-7 gives
a 10,000-transistor Level III ceiling for MOS-linear ASICs while Appendix A-1
prints 60,000, so values above 10,000 are unsupported; supplier temperature,
supply, write-cycle, safe-operating-area, and thermal-cycle limits must be
provided or externally verified; section 9 reports insufficient evidence to
develop a hybrid deposited-film-resistor rule, so that model is unsupported.
Intermediate derivation tables, Appendix B program listings, and graphical
on/off-cycle interpolation are not acceptance oracles and are not automated.

RL-TR-92-11 report p. 134 says the MIL-STD-198E capacitor precautions
“should” be followed. The reviewed MIL-STD-198E foreword, however, explicitly
identifies its application information and performance characteristics as
nonmandatory guidance. Perdura therefore removed the former opaque
`mil_std_198e_precautions_verified` failure gate. Each applicable precaution
is now reported separately: a resolved advisory contributes complete coverage;
an absent, contradictory, or adverse advisory remains `not_evaluated` without
being mislabeled as a mandatory-limit violation. The hard RL equation remains
$V_{AC,peak}+V_{DC}\le0.60V_{rated}$ at every level.

The reviewed MIL-STD-198E source map is:

- Foreword p. iii: application information is guidance, not mandatory.
- §6.5(d), printed pp. 15–16: peak applied voltage, including short
  transients, should not exceed the applicable rating.
- §6.5(h)–(i), p. 16, and §6.5(k)–(l), p. 17: peak charge/discharge
  current and time constant, internal heating/ambient, environment, and
  insulation resistance at temperature require application review.
- §6.5(w), p. 17: AC/pulse service needs special ratings or test evidence.
- §703.1, p. 703.1: CWR intended use assumes an AC component small relative
  to the DC rating and available supplemental moisture protection. No numeric
  definition of “small” is invented. The approximate 55%-at-125 °C point is
  not interpolated because the RL table already imposes a stricter 85 °C
  ceiling and 60% voltage limit.
- §903.1, p. 903.1, as replaced by Notice 2: CDR dielectric variation,
  humidity/contamination, pure-silver migration under humidity plus DC, and
  substrate thermal-expansion compatibility are explicit review topics. The
  printed alloy and solder compositions are example mitigations, not mandatory
  recipes.

Notice 1 changes only non-chip CSR §701; Notice 2 expands CDR styles and
surface-mount use without materially changing those precautions; Notice 3
cancels MIL-STD-198E on 14 July 1999 and preserves its information in
guidance-only MIL-HDBK-198. DLA-retrieved hashes are recorded in the evidence
catalog and executable traceability; the dynamically stamped DLA PDFs remain
metadata-only.

Reviewed retrieval records: DLA [base issue](https://quicksearch.dla.mil/WMX/Default.aspx?token=52308),
[Notice 1](https://quicksearch.dla.mil/WMX/Default.aspx?token=52306), and
[Notice 2](https://quicksearch.dla.mil/WMX/Default.aspx?token=52307), plus the
[Notice 3 archive record](https://everyspec.com/MIL-STD/MIL-STD-0100-0299/MIL-STD-198E_23327/).

### Verification strategy

The RADC-TR-84-254 and RL-TR-92-11 profiles are checked against separately
maintained source-cell fixtures rather than examples generated from the
implementation itself. The RADC-TR-84-254 suite enumerates every cell in
Tables 1–10, manual-level semantics, conditional applicability, and the two
Table 10 ambiguities. The RL-TR-92-11 suite compares every executable catalog
row against the separately reviewed immutable fixture
`tests/data/rl_tr_92_11_final_table_oracle.json`, which records the document
hash, table, pages, operator, and Level I/II/III cells. It also exercises formula
golden values, application-note obligations, count domains,
contradictory/undefined boundaries, and the unsupported hybrid row.
The RL suite additionally locks the MIL-STD-198E notice disposition, granular
advisory applicability, the separation of advisory coverage from mandatory
compliance, and the dominance of RL's stricter CWR limits.

The MIL-STD-975M suite enumerates all capacitor styles, linear- and
digital-microcircuit rows, resistor curve anchors, winding classes, wire
gauges/factors, subtype rules, and strict/inclusive boundaries. Its pinned
source-cell fixture is `tests/data/mil_std_975m_oracle.json`; it records the
document hash, pages, operators, and key table/curve cells independently of
the executable constants. A second source-review pass is complete for that
fixture's declared numeric-cell and curve-anchor scope. This is not a
complete-model-coverage claim: detailed footnotes, applicability and
delegation conditions, the winding-temperature equation, bundle formula, and
worked examples remain separate clause-test and traceability evidence. All
three suites exercise missing, invalid, and nonfinite input behavior plus
immutable, serializable audit output.

### RADC Reliability Engineer's Toolkit lineage

- July 1988 issue: `docs/references/RADC_Reliability_Engineers_Toolkit.pdf`,
  SHA-256
  `2e137b2790eb97e428b380e053c02408ffb2531dbc1b6f55705d8baf0ce1c136`.
  Topic D1, printed pages 41-45, was reviewed.
- Later technical-report issue: `docs/references/RADC-TR-89-171_1989.pdf`,
  SHA-256
  `64c19bb339d508e14d19610eff73c173405334ab21083c84e69f8dabd1d2146d`.
- April 1993 Rome Laboratory update:
  `docs/references/Rome_Laboratory_Reliability_Engineers_Toolkit.pdf`, SHA-256
  `8ea85b2d1536c33b77c4e8191cc8d00592eabab1b4b08c11f15ea164fc15c815`.
  Topic D1 begins at printed p. 37 and supplies a five-factor manual-level
  rubric plus summary technology-specific rows.

The July 1988 Toolkit is a distinct precursor to RADC-TR-89-171, not a
duplicate scan. The 1993 Toolkit is a later, explicitly updated issue and
lists RL-TR-92-11 as advanced-technology background. All three are useful
historical cross-checks, but no summary is silently substituted for an enabled
primary-source profile.

### MIL-HDBK-338B

- Local file: `docs/references/MILHDBK338B.pdf`
- SHA-256: `a88ac9678bf2a432859425edd2602fc935cdbc12db4a849e64a0b7d640c196d9`
- Reviewed location: Section 7.3 and Tables 7.3-1 and 7.3-2, printed pages
  7-30 through 7-32, PDF pages 276-278.

MIL-HDBK-338B identifies principal stress parameters by component family and
prints only a sample set of transistor limits attributed to a Rome Laboratory
part-derating guide. It is expressly guidance, not a complete table authority or
a citable contractual requirement. Its sample transistor rows corroborate the
Rome lineage but cannot validate all component families.

### Thermal and lineage cross-checks

- `RADC-TR-82-172_1982.pdf`, SHA-256
  `fd0f44b9b3d479998f132f36a283343e4b3197e88e073505382c945bd1d47141`,
  provides thermal-analysis support. Table 2-3 and Chapter 3 require
  junction/hotspot analysis in mission and environmental context and caution
  against universal temperature limits. It is not a derating rulebook.
- `RADC-TR-88-97.pdf`, SHA-256
  `4733a4e33f0f6ffe89be67d66681f581c7f3f64a428bef4f7767aca91d752b6b`,
  records selected semiconductor factors attributed to MIL-HDBK-338 and
  RADC-TR-84-254. It is a cross-check, not complete authority.
- `RADC-TR-88-110_1988.pdf`, SHA-256
  `e5cbc74db6ddd854579c0f310668fa39e12a739b992151fc9d56497bc9da9485`,
  explicitly places operational derating outside its scope and directs the
  reader to RADC-TR-82-177 and RADC-TR-84-254.

MIL-HDBK-217F Notice 2, ANSI/VITA 51.1, and MIL-STD-883L were also checked for
scope. They are prediction or test-method authorities, not substitutes for a
complete design-derating rulebook. No operational derating table should be
invented from their failure-rate or test-stress factors.

## Additional public official sources identified

These sources can guide future separately named profiles. Unlike the reviewed
metadata-only MIL-HDBK-978B and MIL-STD-198E sources above, the items in this
list have not been transcribed into an enabled Perdura profile.

- [ECSS-Q-ST-30-11C Rev.2](https://ecss.nl/standard/ecss-q-st-30-11c-rev-2-derating-eee-components-23-june-2021/),
  dated 23 June 2021, is the current official ECSS derating source. It
  supersedes Rev.1 and contains technology- and application-specific rules,
  including conditional temperature and mission-duration logic.
- [NASA EEE-INST-002](https://nepp.nasa.gov/pages/EEE-INST-002.cfm),
  NASA/TP-2003-212242 with the April 2008 Addendum 1 incorporation, distributes
  selection, screening, qualification, and derating requirements across
  device-specific sections. It is not one generic table.
- [MSFC-STD-3012A](https://standards.nasa.gov/standard/MSFC/MSFC-STD-3012),
  dated 14 February 2012, is an active MSFC parts-management standard. NASA's
  official record states that portions were based on the defunct
  MIL-STD-975M. It is a center-specific source and must be labeled as such.
- [NASA-STD-8739.10](https://standards.nasa.gov/node/1926), dated 13 June
  2017, is the active agency EEE parts-assurance framework. It does not by
  itself supply a replacement numerical derating table for Perdura.
- [NAVSEA SD-18](https://www.navsea.navy.mil/Home/Warfare-Centers/NSWC-Crane/Resources/SD-18/)
  is an official, public, technology-specific parts guidance system with
  quality- and environment-dependent derating pages. SD-18 is not equivalent
  to TE000-AB-GTP-010 and does not validate the former generic NAVSEA preset.
- The [DLA ASSIST MIL-STD-975 record](https://quicksearch.dla.mil/qsDocDetails.aspx?ident_number=36072)
  independently corroborates the reviewed local Revision M and cancellation
  Notice 3 identities.
- NASA's public [NASA-STD-8739.11 tutorial overview](https://ntrs.nasa.gov/citations/20250008275)
  and [standards-update presentation](https://ntrs.nasa.gov/citations/20240015570)
  describe an agency-wide, device-section framework. The audit did not locate
  a controlled published issue in NASA's standards catalog; presentations and
  tutorials are not a substitute for that issue.

## References still requested

Please supply controlled, complete copies (including change pages, notices,
appendices, and revision history) of the following where available:

1. **AFSCP 800-27**, *Acquisition Management: Part Derating Guidelines*,
   5 December 1983. This is the primary constituent/established-part dependency
   cited by both supplied technical reports.
2. **RADC-TR-82-177**, *Reliability Parts Derating Guidelines*, June 1982,
   AD-A120367.
3. **ESD-TR-85-148**, *Derated Application of Parts for ESD System
   Development. Revision*, March 1985, AD-A153299.
4. **ESD-TR-83-197**, AD-A133880, including its complete title page,
   appendices, and change history.
5. **NAVAIR/Navy AS-4613**, *Application and Derating Requirements for
   Electronic Components, General Specification for*, 30 July 1976. “NASC” in
   the RL report is command shorthand, not a different document identifier.
6. **NAVSEA TE000-AB-GTP-010**, September 1985, for the exact historical
   RL-TR-92-11 comparison lineage. **Revision 2**, March 1999, is a later
   source and is additionally requested only if Perdura should implement a
   separately labeled Rev. 2 profile.
7. **MIL-HDBK-251**, 19 January 1978, complete issue and notices.
8. **MIL-T-27E, Amendment 2**, and **MIL-T-21038D, Amendments 2–3 plus
   Supplement 1**, for independent verification of the winding-rise and
   insulation-class semantics incorporated by the 1994 Appendix A.
9. **MIL-HDBK-217D**, 15 January 1982, and **Notice 1**, 13 June 1983. The
    notice is specifically needed to reproduce RL-TR-92-11's historical
    reliability-model baseline.
10. **KSC-PLN-5406**, *Design and Development Electrical, Electronic,
    Electromechanical (EEE) Parts Plan*, 22 October 2013, but only if a
    separately labeled Kennedy Space Center profile is desired.
11. **NASA-STD-8739.11**, the controlled issue and all changes, when it is
    published or otherwise made available. The public material located during
    this audit consists of development/update presentations and tutorials, not
    a controlled standard copy.
12. **MIL-C-55365**, the issue, notices, and specification sheets applicable
    to MIL-STD-198E §703 CWR02/03/04/06, for an independent check of the
    underlying tantalum-chip ratings and qualification conditions.
13. **MIL-C-55681**, the issue, notices, and specification sheets applicable
    to MIL-STD-198E Notice 2 §903 CDR01–04, CDR11–14, and CDR26–35, for an
    independent check of the underlying ceramic-chip ratings and qualification
    conditions.

Items 12–13 do not change RL-TR-92-11's published 60%/85 °C screening
limits. They are requested to verify the rating basis that the historical
application guidance tells the designer to obtain from the detailed
specification.

Note that the supplied `RADC-TR-82-172_1982.pdf` is the *RADC Thermal Guide
for Reliability Engineers*. It is useful thermal-analysis evidence, but it is
not the still-requested **RADC-TR-82-177** parts-derating guide; the similar
report numbers must not be treated as interchangeable.

The following additional RL-TR-92-11 comparison-lineage sources are also
requested for a complete provenance cross-check, even though the executable
final-table profile does not depend on them at runtime:

- **GSFC PPL-18**, October 1986.
- **NAVMAT P-4855-1A**.
- **MIL-STD-2174(AS)**, July 1976.
- **MIL-STD-975H (NASA)**, June 1989—the NASA issue actually used by
  RL-TR-92-11, rather than the later Revision M.
- **MIL-STD-1547A**, December 1987.

RL-TR-92-11 also identifies two proprietary OEM sources as “A” and “B.” Their
identity/content is not recoverable from the supplied public report; they are
recorded as unavailable rather than reconstructed. MIL-STD-975M with Notices
1–3, RADC-TR-84-254, and RL-TR-92-11 have now been supplied and removed from
the request list; the relevant MIL-HDBK-978B and MIL-STD-198E sections were
reviewed from pinned public copies. Their availability does not eliminate the
remaining primary-source blockers identified above.

## Completion criteria for each future or expanded profile

A source-specific profile can be enabled only after all of the following are
complete:

1. Pin the authority, document identifier, edition, date, change notices, and
   intended application scope.
2. Map every applicable clause, table row, note, exception, footnote, and
   tailoring decision to an immutable internal rule identifier.
3. Preserve device technology and construction distinctions; do not use a
   broad alias unless the source itself authorizes it.
4. Encode the physical quantity, units, reference rating, comparison operator,
   temperature semantics, interpolation rule, simultaneous-stress rule, and
   conditional applicability for each limit.
5. Fail closed when a required rating, construction, environment, quality
   class, mission duration, transient condition, or tailoring decision is
   absent.
6. Validate every transcribed row against an independent table oracle and test
   boundaries, interpolation, unit conversion, missing-input behavior, and
   all source examples when provided.
7. Emit the source locator, input substitution, applicable rule, actual stress,
   allowable stress, margin, assumptions, and warnings with every result.
8. Keep historical, center-specific, and current profiles separate. Similar
   ancestry is not permission to merge their values or names.

The enabled historical profiles pass these gates for the bounded calculation
scope stated above; their exclusions remain fail-closed. Until the same gates
pass for another source, Perdura may provide Custom rules and clearly
identified guidance but must not present a standards-branded calculation.
