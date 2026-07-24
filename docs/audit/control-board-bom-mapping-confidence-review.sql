-- Auditable snapshot for Control Board BOM mapping-confidence review.
-- Upstream file: docs/references/Control Board BOM.csv
-- Production classifier: gui/frontend/src/components/Prediction/bomImport.ts
-- Source commit: 3d0784f
-- Evaluation target: MIL-HDBK-217F, built-in mapping profile

CREATE TABLE summary (
  parsed_rows INTEGER NOT NULL,
  real_line_items INTEGER NOT NULL,
  high INTEGER NOT NULL,
  high_share REAL NOT NULL,
  medium INTEGER NOT NULL,
  low INTEGER NOT NULL,
  unmapped_real INTEGER NOT NULL,
  below_high_real INTEGER NOT NULL,
  below_high_share REAL NOT NULL
);

INSERT INTO summary VALUES
  (140, 139, 26, 0.1870503597, 102, 5, 6, 113, 0.8129496403);

CREATE TABLE confidence_gaps (
  confidence TEXT NOT NULL,
  mapped_category TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  winner_score INTEGER NOT NULL,
  matched_evidence TEXT NOT NULL,
  limiting_reason TEXT NOT NULL
);

INSERT INTO confidence_gaps VALUES
  ('Medium', 'Resistor', 53, 85, 'Resistor designator', 'RES/ERES abbreviation does not match the resistor description rule; score is 65 short of high.'),
  ('Medium', 'Capacitor', 37, 85, 'Capacitor designator', 'CAP CER abbreviation does not match the capacitor description rule; score is 65 short of high.'),
  ('Medium', 'Microcircuit', 9, 85, 'Integrated-circuit designator', 'Descriptions use device functions not covered by the generic IC vocabulary; score is 65 short of high.'),
  ('Unmapped', 'None', 7, 0, 'No rule', 'Six non-component/mechanical rows plus the trailing Total row have no supported classification.'),
  ('Medium', 'Connector', 3, 80, 'Connector designator', 'CONN abbreviation is not recognized; one P-designator row is actually a test point.'),
  ('Low', 'Motor', 2, 75, 'Motor designator', 'M-prefixed mounting holes are false-positive motors and lack corroborating description evidence.'),
  ('Low', 'Optoelectronic', 2, 95, 'LED description', 'Generic D-designator diode score is 80, leaving only a 15-point winning margin.'),
  ('Low', 'FET', 1, 100, 'MOSFET description', 'Generic Q-designator BJT score is 85, leaving only a 15-point winning margin.');

CREATE TABLE diagnostic_examples (
  source_row INTEGER NOT NULL,
  refdes TEXT NOT NULL,
  description TEXT NOT NULL,
  current_result TEXT NOT NULL,
  diagnosis TEXT NOT NULL
);

INSERT INTO diagnostic_examples VALUES
  (2, 'C1', 'CAP CER 4.7uF 25V X7R 1206 SMD', 'Capacitor · medium · 85', 'Correct family, missing CAP abbreviation evidence.'),
  (62, 'R1, R3', 'RES 4.7K OHM 1% 1/10W Thick Film', 'Resistor · medium · 85', 'Correct family, missing RES abbreviation evidence.'),
  (120, 'U4X, U4Y, U6', 'Low-Dropout Linear Voltage Regulator', 'Microcircuit · medium · 85', 'Correct prefix; regulator terminology supplies no second rule.'),
  (53, 'J40, J46, J47', 'CONN HDR 30POS', 'Connector · medium · 80', 'Correct family, missing CONN abbreviation evidence.'),
  (40, 'D4, D6, D7…', 'LED GRN DIFFUSE', 'Optoelectronic · low · 95', 'Specific LED evidence beats generic diode prefix by only 15 points.'),
  (61, 'Q100', 'MOSFET N-CH 200V', 'FET · low · 100', 'Specific MOSFET evidence beats generic BJT prefix by only 15 points.'),
  (58, 'M1–M10', 'MTG HOLE PLATED', 'Motor · low · 75', 'False positive from M prefix; this is not a handbook component.'),
  (118, 'TP1_GND…', 'TEST POINT THM BLK', 'Unmapped · 0', 'Non-component row needs an exclusion disposition, not a model.'),
  (141, '—', '—', 'Unmapped · 0', 'Trailing Total row should be filtered before classification.');

SELECT * FROM summary;
SELECT * FROM confidence_gaps ORDER BY row_count DESC;
SELECT * FROM diagnostic_examples ORDER BY source_row;
