# MIL-HDBK-217F Notice 2 implementation coverage

## Controlled source

- Document: `MIL-HDBK-217F, Notice 2`, 28 February 1995
- Local reference: [`../references/MIL-HDBK-217F-Notice2.pdf`](../references/MIL-HDBK-217F-Notice2.pdf)
- File length: 150 PDF pages
- SHA-256: `e0df9c9ed1123a790a5b11e4b8dbbc27ff7edc338b417b0b3d6bff8295217f9b`
- Implementation: `src/reliability/_mil_hdbk_217f_notice2.py`
- Public facade: `src/reliability/MIL_HDBK_217F.py`

The page references below are the handbook's printed page labels, not the PDF
viewer page number. Failure rates are in failures per million hours (FPMH)
unless an intermediate equation says otherwise.

The formula-level implementation narrative, all adopted source repairs, and
the complete ANSI/VITA 51.1-2013 (R2018) subsidiary implementation are in the
[MIL-HDBK-217F Notice 2 and ANSI/VITA 51.1 methodology](../methodology/mil-hdbk-217f-vita-51-1.md).

## Scope and interpretation

Perdura implements every numerical part-stress model in Sections 5 through
23, every calculation aid needed to derive a model input, all 217 distinct
Appendix A parts-count rows, and all seven Appendix B CMOS failure mechanisms.
Each result carries the handbook edition, section, printed page range, governing
equation, selected factors, substituted calculation steps, assumptions,
warnings, quantity, multiplier, and units.

“Complete” refers to the calculation content of this controlled handbook
edition. It does not certify the empirical accuracy of the 1995 source models
for a particular design, waive handbook tailoring, or turn the handbook into a
contractual requirement. Sections 1 through 4 contain scope, definitions, and
general guidance rather than additional numerical part models.

## Clause coverage matrix

| Clause | Handbook model | Perdura model or helper | Printed pages | Status |
|---|---|---|---|---|
| 5.1–5.2 | Monolithic digital, linear, PLA, microprocessor, ROM/PROM/UVPROM/EEPROM/EAPROM/DRAM/SRAM | `Microcircuit`; EEPROM cycling and ECC contribution | 5-1–5-7, 5-20–5-21 | Complete |
| 5.3 | VHSIC/VHSIC-like/VLSI CMOS simplified model | `VHSICMicrocircuit` | 5-7 | Complete |
| 5.4 | GaAs MMIC and digital IC | `GaAsMicrocircuit` | 5-8 | Complete |
| 5.5 | Hybrid microcircuit component summation | `HybridMicrocircuit` | 5-9 | Complete |
| 5.6 | Surface acoustic wave device | `SurfaceAcousticWaveDevice` | 5-10 | Complete |
| 5.7 | Magnetic bubble memory, control/detection and storage contributions | `MagneticBubbleMemory` | 5-11–5-12 | Complete |
| 5.10–5.12 | Quality, learning, junction temperature, hybrid die area and thermal path | Public microcircuit/hybrid thermal and screening helpers | 5-13–5-19 | Complete |
| 6.1 | Low-frequency diodes | `Diode` | 6-2–6-3 | Complete |
| 6.2 | High-frequency/microwave diodes | `HFDiode` | 6-4–6-5 | Complete |
| 6.3 | Low-frequency bipolar transistors | `BipolarTransistor` | 6-6–6-7 | Complete |
| 6.4 | Low-frequency silicon FETs | `FieldEffectTransistor` | 6-8 | Complete |
| 6.5 | Unijunction transistors | `UnijunctionTransistor` | 6-9 | Complete |
| 6.6 | Low-noise high-frequency bipolar transistors | `HFLowNoiseBipolarTransistor` | 6-10–6-11 | Complete |
| 6.7 | High-power high-frequency bipolar transistors | `HFPowerBipolarTransistor` | 6-12–6-13 | Complete |
| 6.8 | High-frequency GaAs FETs | `GaAsFET` | 6-14–6-15 | Complete |
| 6.9 | High-frequency silicon FETs | `HighFrequencySiliconFET` | 6-16 | Complete |
| 6.10 | Thyristors/SCRs | `Thyristor` | 6-17 | Complete |
| 6.11–6.12 | Photodevices, optical isolators, and displays | `Optoelectronic` | 6-18–6-20 | Complete |
| 6.13 | GaAs/AlGaAs and InGaAs/InGaAsP laser diodes | `LaserDiode` | 6-21–6-22 | Complete |
| 6.14 | Semiconductor junction-temperature calculation and package thermal table | `semiconductor_junction_temperature`; `SEMICONDUCTOR_THETA_JC` | 6-23–6-24 | Complete |
| 7.1 | Receiver, power, CRT, thyratron, CFA, gridded, vidicon, twystron, and klystron tubes | `ElectronTube` | 7-1–7-2 | Complete |
| 7.2 | Traveling-wave tubes | `TravelingWaveTube` | 7-3 | Complete |
| 7.3 | Pulsed and continuous-wave magnetrons | `Magnetron` | 7-4 | Complete |
| 8.1 | Helium-neon, helium-cadmium, and argon lasers | `GasLaser` | 8-2 | Complete |
| 8.2 | Sealed continuous-wave CO2 laser | `SealedCO2Laser` | 8-3 | Complete |
| 8.3 | Flowing CO2 laser | `FlowingCO2Laser` | 8-4 | Complete; source conflict disclosed below |
| 8.4 | Nd:YAG and ruby solid-state lasers | `SolidStateLaser` | 8-5–8-6 | Complete |
| 9.1 | All listed fixed, variable, network, chip, power, and thermistor resistor styles | `Resistor` | 9-1–9-3 | Complete |
| 10.1–10.2 | All listed capacitor styles; temperature, capacitance, voltage, and series-resistance factors | `Capacitor`; `capacitor_voltage_stress` | 10-1–10-7 | Complete |
| 11.1 | Flyback, audio, low/high-power pulse, and RF transformers | `Transformer` | 11-1–11-2 | Complete |
| 11.2 | Fixed and variable inductors/coils | `InductorCoil` | 11-3 | Complete |
| 11.3 | Five hot-spot temperature methods and MIL case-area table | `inductive_hotspot_temperature`; `MIL_T27_CASE_RADIATING_AREAS` | 11-4–11-6 | Complete |
| 12.1 | Sub-one-horsepower motor bearing/winding model, including weighted temperature profile | `Motor` | 12-1–12-3 | Complete |
| 12.2 | Synchros and resolvers | `SynchroResolver` | 12-4 | Complete |
| 12.3 | Elapsed-time meters | `ElapsedTimeMeter` | 12-5 | Complete |
| 13.1 | Mechanical relays and all printed application/construction rows | `Relay` | 13-1–13-2 | Complete |
| 13.2 | Solid-state, time-delay, and hybrid relay default models | `SolidStateRelay` | 13-3 | Complete |
| 14.1 | All printed switch types, including inductively rated switches | `Switch` | 14-1–14-2 | Complete |
| 14.2 | Magnetic, thermal, and thermal-magnetic circuit breakers | `CircuitBreaker` | 14-3 | Complete |
| 15.1 | Circular, card-edge, hexagonal, rack/panel, rectangular, RF, telephone, power, and triaxial connectors | `Connector`; insert-temperature helper | 15-1–15-3 | Complete |
| 15.2 | IC, relay, transistor, and tube/CRT sockets | `ConnectorSocket` | 15-3 | Complete |
| 16.1 | Printed-board and discrete-wiring plated-through-hole assemblies | `PlatedThroughHoleAssembly` | 16-1 | Complete |
| 16.2 | Surface-mount weakest-link thermal-fatigue model | `SurfaceMountAssembly` | 16-2–16-4 | Complete |
| 17.1 | All printed single-connection technologies | `Connection` | 17-1 | Complete |
| 18.1 | AC/DC panel meters | `Meter` | 18-1 | Complete |
| 19.1 | Quartz crystals | `QuartzCrystal` | 19-1 | Complete |
| 20.1 | AC/DC incandescent lamps | `Lamp` | 20-1 | Complete |
| 21.1 | All four printed non-tunable electronic-filter rows | `ElectronicFilter` | 21-1 | Complete |
| 22.1 | Fuses | `Fuse` | 22-1 | Complete |
| 23.1 | Vibrators, neon lamps, fiber items, microwave items, ferrites, phase shifters, dummy loads, and terminations | `MiscellaneousPart`; microwave attenuator cross-reference to resistor style RD | 23-1–23-2 | Complete |
| Appendix A | Parts-count method and every printed generic line-item row | `PartsCountPart`, `PartsCountPrediction`, `parts_count_catalog` | A-1–A-13 | Complete: 217 unique rows |
| Appendix B | Oxide, metallization, hot-carrier, contamination, package/humidity, EOS/ESD, and miscellaneous CMOS mechanisms | `DetailedCMOSMicrocircuit` | B-1–B-6 | Complete |

## Applicability and fail-closed rules

The implementation rejects inputs outside explicit handbook domains instead
of silently extrapolating. Examples include semiconductor frequency and power
ranges, laser current/flux/temperature limits, relay rated temperature,
capacitor overstress, the Section 11.3 case-area range, discrete-wiring layer
count, missing Cannon Launch factors, and the requirement for dedicated space
thermal analysis. Piecewise table endpoints are tested directly.

The GUI uses the same clause-level category names and constructor inputs as the
core API. It exposes all 217 Appendix A rows with row-specific quality choices,
the optional Section 12.1 motor temperature profile, Appendix B measured input
overrides, and every Appendix B relative-humidity input in the handbook's
percentage units.

## Source-document inconsistencies and adopted interpretations

These are source issues, not silent implementation approximations:

1. Section 8.3's printed 0.01 kW flowing-CO2 table entry is `0.3`, while the
   printed equation `lambda_COUPLING = 300 P` gives `3.0`. Perdura follows the
   equation and emits a warning in the result.
2. Appendix A-9 prints a switching-transformer generic-rate row that does not
   reconcile with any Section 11.1 transformer category. The parts-count model
   uses the printed A-9 row directly; the part-stress model uses Section 11.1.
3. Some Appendix A displayed generic rates differ slightly from recomputation
   because the handbook prints rounded values, notably high-frequency varactor
   and variable-coil rows. Perdura evaluates the governing part-stress equation
   from the printed Appendix A defaults and tests against the displayed rate
   with an explicit rounding tolerance.
4. The Section 12.1 effective-cumulative-failure scan leaves an apparent gap
   above 0.90 before the terminal `1.0` value. Perdura treats the terminal row
   as the final band so the piecewise function remains defined.
5. The Appendix A capacitor scan can make the CY/CYR/CK/CKR/CC/CCR/CDR default
   capacitance look like `20`; the seven printed generic rates independently
   reconcile to `2.0 µF`, which is the implemented value.

## Verification evidence

The dedicated test suites provide:

- constructor, finite-rate, traceability, and long-form checks for every public
  model;
- direct parity with eight printed handbook worked examples;
- independent recomputation of Appendix B humidity and mechanism summation;
- all resistor and capacitor styles, all named Section 7.1 tube rows, and all
  217 Appendix A recipes;
- representative Appendix A displayed-rate parity across every family;
- boundary, overstress, table-source/custom-source, environment, quantity,
  multiplier, and roll-up checks;
- backend contracts for every clause-level category and full long-form output;
- a production TypeScript build covering the complete Prediction UI.

Run the focused verification with:

```bash
PYTHONPATH=src .venv/bin/pytest -q tests/test_mil_hdbk_217f.py
(cd gui/backend && PYTHONPATH=../../src ../../.venv/bin/pytest -q tests/test_mil_hdbk_217f_complete.py)
(cd gui/frontend && npm run build)
```
