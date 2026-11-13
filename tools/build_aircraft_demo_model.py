#!/usr/bin/env python3
"""Build the illustrative Aircraft architecture used by the bundled project.

This is a generic twin-electric utility-aircraft teaching example, not an actual
aircraft design, certification analysis, or source of equipment failure rates.
Its systems taxonomy is informed by FAA PHAK chapter 7 and NASA's X-57 technical
topics; the architecture and allocations below are authored demo assumptions.
The hydraulic pump hazard profile is retained solely for the existing example
calculations. All identities and layout coordinates are deterministic.

The builder deliberately needs no previous demo contents. ``existing_model`` is
accepted for callers that rebuild an existing project; rebuilding an already
updated Aircraft model produces the same result.
"""

from __future__ import annotations

import argparse
from copy import deepcopy
import json
from pathlib import Path
from typing import Any


def build_aircraft_model(existing_model: dict[str, Any] | None = None) -> dict[str, Any]:
    """Return a complete version-4 canonical System Model, through L4 and below."""
    del existing_model
    model: dict[str, Any] = {
        "version": 4, "id": "system-demo-aircraft", "name": "Aircraft",
        "revision": "A", "root_instance_id": "aircraft",
        "modes": [
            {"id": "run", "name": "Cruise", "description": "Normal powered flight and continuous system operation."},
            {"id": "takeoff", "name": "Takeoff and climb", "description": "High propulsion demand and initial climb."},
            {"id": "landing", "name": "Approach and landing", "description": "Approach, landing-gear deployment, and ground braking."},
            {"id": "standby", "name": "Standby", "description": "Energized readiness with low-demand equipment available."},
            {"id": "ground", "name": "Ground service", "description": "Ground inspection, functional checks, and maintenance."},
        ],
        "definitions": [], "instances": [], "externals": [], "resources": [],
        "interfaces": [], "function_links": [], "propagation_rules": [],
        "propagation_assertions": [], "diagrams": [],
    }
    definitions: dict[str, dict] = {}
    instances: dict[str, dict] = {}
    functions: dict[tuple[str, str], dict] = {}
    primary: dict[str, str] = {}
    pending_inputs: list[tuple[str, str, Any]] = []
    outputs: dict[tuple[str, str], tuple[str, str]] = {}
    external_outputs: dict[str, tuple[str, str]] = {}
    resources: dict[str, dict] = {}

    def resource(ident: str, name: str, category: str, quantity: str = "", unit: str = "") -> str:
        value = {"id": ident, "name": name, "category": category}
        if quantity:
            value["quantity"] = quantity
        if unit:
            value["unit"] = unit
        resources[ident] = value
        model["resources"].append(value)
        return ident

    def block(ident: str, name: str, parent: str | None, *, kind: str | None = None,
              description: str = "", definition_id: str | None = None, quantity: int = 1) -> str:
        depth = 1
        cursor = parent
        while cursor:
            depth += 1
            cursor = instances[cursor].get("parent_instance_id")
        kind = kind or ("system" if depth <= 2 else "subsystem" if depth == 3 else "component")
        definition = {
            "id": definition_id or f"definition-{ident}", "name": name, "kind": kind,
            "classification": kind, "revision": "A", "description": description,
            "part_number": "", "manufacturer": "", "category": "Illustrative aircraft equipment",
            "properties": {}, "analysis_profiles": [], "ports": [], "functions": [],
            "failure_modes": [], "child_slots": [],
        }
        instance = {
            "id": ident, "definition_id": definition["id"], "name": name,
            "quantity": quantity, "reference_designators": [], "mode_ids": [],
            "function_overrides": [], "failure_mode_overrides": [], "legacy_refs": [],
            "origin": "definition_slot" if parent else "ad_hoc", "definition_revision": "A",
            "properties": {}, "profile_overrides": [],
            "source_metadata": {"example": True, "indenture_level": depth},
        }
        if parent:
            instance.update(parent_instance_id=parent, slot_id=f"slot-{ident}")
            definitions[parent]["child_slots"].append({
                "id": f"slot-{ident}", "definition_id": definition["id"], "name": name, "quantity": quantity,
            })
        definitions[ident] = definition
        instances[ident] = instance
        model["definitions"].append(definition)
        model["instances"].append(instance)
        return ident

    def function(ident: str, action: str, output: tuple[str, str] | None = None,
                 inputs: tuple[Any, ...] = (), *, fid: str = "perform", role: str = "transform",
                 output_id: str | None = None, output_io: str = "out", state_verb: str = "maintain",
                 function_type: str = "primary", failure: str = "", failure_id: str | None = None,
                 deviation: str = "absent") -> None:
        io: list[dict] = []
        if role == "maintain_state":
            structured = {"role": role, "action": action, "state_verb": state_verb, "io": io}
        else:
            assert output is not None, ident
            rid = resource(output_id or f"resource-{ident}-{fid}", *output)
            io.append({"id": output_io, "resource_id": rid, "direction": "output"})
            outputs[ident, fid] = (rid, output_io)
            structured = {"role": role, "action": action, "io": io}
        value = {"id": fid, "description": f"{state_verb.capitalize()} {action}" if role == "maintain_state" else action,
                 "function_type": function_type, "mode_ids": [], "port_ids": [], "definition": structured}
        definitions[ident]["functions"].append(value)
        functions[ident, fid] = value
        primary.setdefault(ident, fid)
        pending_inputs.extend((ident, fid, item) for item in inputs)
        if failure:
            definitions[ident]["failure_modes"].append({
                "id": failure_id or f"failure-{ident}-{fid}", "function_id": fid,
                "description": failure, "deviation_id": deviation, "mode_ids": [],
            })

    def maintain(ident: str, condition: str, **kwargs: Any) -> None:
        function(ident, condition, role="maintain_state", **kwargs)

    def external(ident: str, name: str, kind: str, output: tuple[str, str] | None = None,
                 *, sink_category: str | None = None, description: str = "") -> None:
        port = {"id": "terminal", "name": output[0] if output else name,
                "interface_type": output[1] if output else sink_category or "physical",
                "direction": "output" if output else "input", "description": description, "properties": {}}
        if output:
            port["resource_id"] = resource(f"resource-{ident}-terminal", *output)
            external_outputs[ident] = (port["resource_id"], "terminal")
        model["externals"].append({"id": ident, "name": name, "kind": kind,
                                   "description": description, "ports": [port]})

    block("aircraft", "Aircraft", None,
          description="Illustrative twin-electric utility aircraft. This example demonstrates traceable systems, functions, interfaces, and linked reliability analyses; it is not a certified aircraft design or validated aircraft reliability prediction.")
    instances["aircraft"]["source_metadata"].update({
        "assumptions": "Generic educational architecture; all equipment and operational allocations are illustrative. Pump hazard data are demonstration inputs, not flight-qualified data.",
        "references": [
            "https://www.faa.gov/regulationspolicies/handbooksmanuals/aviation/phak/chapter-7-aircraft-systems",
            "https://www.nasa.gov/directorates/armd/x-57-technical-papers/",
        ],
    })
    function("aircraft", "Convert pilot intent into controlled aircraft motion",
             ("Controlled aircraft motion", "physical"),
             ("propulsion", "flight-controls", "avionics", "airframe"), fid="fly-aircraft")

    # L2 systems are deliberately declared together, providing a clear top-level overview.
    for ident, name, description in [
        ("propulsion", "Propulsion System", "Independent left and right electric propulsion channels."),
        ("electrical-power", "Electrical Power System", "Stored energy, protected high-voltage distribution, and essential low-voltage power."),
        ("flight-controls", "Flight Control and Actuation System", "Pilot-command processing and powered aerodynamic surface actuation."),
        ("avionics", "Avionics and Crew Interface System", "Navigation, aircraft-state sensing, communications, and crew information."),
        ("pump-system", "Hydraulic Power System", "Redundant electric pumps, fluid conditioning, and a pressure-regulating controller."),
        ("landing-gear", "Landing Gear and Braking System", "Gear deployment, ground steering, and controlled wheel braking."),
        ("airframe", "Airframe and Structural System", "Wing, empennage, and fuselage structure supporting aircraft loads."),
        ("thermal-environmental", "Thermal and Environmental System", "Equipment coolant circulation and cabin-air conditioning."),
    ]:
        block(ident, name, "aircraft", description=description,
              definition_id="def-pump-system" if ident == "pump-system" else None)

    external("pilot", "Flight Crew", "person", ("Pilot flight and ground-control commands", "human_machine"),
             description="The crew defines flight-path, propulsion, gear, and braking intent.")
    external("atmosphere", "Ambient Atmosphere", "environment", ("Ambient airflow", "material"),
             description="External airflow available to aerodynamic surfaces and environmental equipment.")
    external("navigation-signals", "Navigation Signal Environment", "environment", ("Satellite navigation signals", "information"))
    external("radio-station", "Ground Radio Station", "adjacent_system", ("Air-ground communications", "information"))
    external("operating-environment", "Operating Environment", "environment", sink_category="physical",
             description="Receives the aircraft's controlled motion; illustrative system boundary.")
    external("runway", "Runway Surface", "environment", sink_category="physical",
             description="Structural ground-contact relation, with no fabricated resource flow.")

    # Propulsion: L3 channel assemblies, with inverter, motor, and propeller at L4.
    function("propulsion", "Combine the two propulsion channels into commanded net thrust",
             ("Net propulsive thrust", "physical"), ("propulsion-left", "propulsion-right"),
             failure="Available thrust is below commanded thrust", deviation="insufficient")
    for side, label in [("left", "Left"), ("right", "Right")]:
        channel = f"propulsion-{side}"
        block(channel, f"{label} Propulsion Channel", "propulsion", kind="assembly")
        function(channel, f"Deliver controlled {side} propulsion thrust", (f"{label} propulsion thrust", "physical"),
                 (f"propeller-{side}",))
        block(f"inverter-{side}", f"{label} Motor Inverter", channel)
        function(f"inverter-{side}", "Convert protected DC power into commanded motor phase power",
                 (f"{label} motor phase power", "energy"),
                 (("electrical-power", "supply-high-voltage"), "flight-command-computer"),
                 failure="Motor phase power is unavailable")
        block(f"motor-{side}", f"{label} Propulsion Motor", channel)
        function(f"motor-{side}", "Convert motor phase power into shaft torque", (f"{label} motor shaft torque", "physical"),
                 (f"inverter-{side}", ("thermal-environmental", "supply-equipment-coolant")), failure="Motor cannot develop commanded shaft torque")
        block(f"propeller-{side}", f"{label} Propeller Assembly", channel)
        function(f"propeller-{side}", "Convert shaft torque and ambient airflow into thrust", (f"{label} propeller thrust", "physical"),
                 (f"motor-{side}", "@atmosphere"), failure="Propeller thrust is below demand", deviation="insufficient")

    # ESPS: uniquely owned output resources make both distribution voltages explicit.
    function("electrical-power", "Supply protected essential low-voltage electrical power",
             ("Essential 28 V DC power", "energy"), ("low-voltage-conversion",), fid="supply-essential-power")
    function("electrical-power", "Supply protected high-voltage propulsion and equipment power",
             ("Protected high-voltage DC power", "energy"), ("hv-distribution",), fid="supply-high-voltage")
    block("energy-storage", "Battery Energy Storage", "electrical-power")
    function("energy-storage", "Combine independently protected battery channels", ("Stored-energy DC supply", "energy"),
             ("battery-pack-a", "battery-pack-b"))
    for side in ("a", "b"):
        block(f"battery-pack-{side}", f"Battery Pack {side.upper()}", "energy-storage")
        function(f"battery-pack-{side}", "Release stored electrochemical energy as DC power",
                 (f"Battery {side.upper()} DC power", "energy"), role="source",
                 failure="Battery channel cannot deliver electrical energy")
    block("battery-containment", "Battery Containment and Isolation", "energy-storage")
    maintain("battery-containment", "battery enclosure integrity and separation", state_verb="contain",
             failure="Battery enclosure no longer contains a local fault")
    block("hv-distribution", "High-Voltage Distribution", "electrical-power")
    function("hv-distribution", "Route protected high-voltage power to aircraft loads",
             ("Distributed high-voltage power", "energy"), ("hv-busbar",))
    block("main-contactor", "Main Isolation Contactor", "hv-distribution")
    function("main-contactor", "Connect stored energy through the isolation contactor",
             ("Switched high-voltage power", "energy"), ("energy-storage",), failure="Contactor fails open")
    block("hv-busbar", "Protected High-Voltage Bus", "hv-distribution")
    function("hv-busbar", "Distribute switched DC power across protected feeder branches",
             ("Protected feeder power", "energy"), ("main-contactor",), failure="High-voltage distribution is interrupted")
    block("low-voltage-conversion", "Essential DC Conversion", "electrical-power")
    function("low-voltage-conversion", "Combine redundant regulated low-voltage supplies",
             ("Regulated essential DC supply", "energy"), ("dc-converter-a", "dc-converter-b"))
    for side in ("a", "b"):
        block(f"dc-converter-{side}", f"Essential DC Converter {side.upper()}", "low-voltage-conversion")
        function(f"dc-converter-{side}", "Convert high-voltage DC into regulated low-voltage DC",
                 (f"Converter {side.upper()} regulated 28 V DC", "energy"), ("hv-distribution",),
                 failure="Low-voltage converter output is unavailable")

    # Flight-control commands and physical actuation are separate resources.
    function("flight-controls", "Convert aircraft-control commands into aerodynamic control moments",
             ("Commanded aircraft control moments", "physical"), ("control-command", "surface-actuation"))
    block("control-command", "Flight Command Management", "flight-controls")
    function("control-command", "Coordinate surface and propulsion control demands",
             ("Coordinated flight-control demands", "information"), ("flight-command-computer", "actuator-controller"))
    block("flight-command-computer", "Flight Command Computer", "control-command")
    function("flight-command-computer", "Resolve crew intent and measured aircraft state into control demands",
             ("Aircraft control demands", "information"), ("@pilot", "navigation-suite", "electrical-power"),
             failure="Flight-control demand is incorrect", deviation="incorrect")
    block("actuator-controller", "Surface Actuator Controller", "control-command")
    function("actuator-controller", "Schedule hydraulic actuator commands from flight-control demands",
             ("Surface actuator commands", "information"), ("flight-command-computer", "electrical-power"))
    block("surface-actuation", "Aerodynamic Surface Actuation", "flight-controls")
    function("surface-actuation", "Combine powered surface deflections into aircraft control moments",
             ("Aerodynamic surface control moments", "physical"), ("aileron-actuator", "elevator-actuator", "rudder-actuator"))
    for ident, name, output in [
        ("aileron-actuator", "Aileron Actuator", "Aileron deflection torque"),
        ("elevator-actuator", "Elevator Actuator", "Elevator deflection torque"),
        ("rudder-actuator", "Rudder Actuator", "Rudder deflection torque"),
    ]:
        block(ident, name, "surface-actuation")
        function(ident, "Convert hydraulic pressure and actuator commands into controlled surface motion",
                 (output, "physical"), ("pump-system", "actuator-controller"),
                 failure="Actuator cannot achieve commanded surface position")

    # Avionics: immediate cross-system interfaces include power, commands, and health.
    function("avionics", "Provide navigation and aircraft-status information to flight operations",
             ("Flight guidance and aircraft status", "information"), ("navigation-suite", "crew-interface"))
    block("navigation-suite", "Navigation and Air Data", "avionics")
    function("navigation-suite", "Fuse navigation, attitude, and air-data measurements",
             ("Aircraft navigation and state estimate", "information"), ("gnss-receiver", "air-data-computer", "inertial-unit"))
    block("gnss-receiver", "GNSS Receiver", "navigation-suite")
    function("gnss-receiver", "Resolve received navigation signals into position and velocity",
             ("Navigation position and velocity", "information"), ("@navigation-signals", "electrical-power"))
    block("air-data-computer", "Air Data Computer", "navigation-suite")
    function("air-data-computer", "Measure ambient airflow to derive aircraft air data",
             ("Airspeed and pressure-altitude data", "information"), ("@atmosphere", "electrical-power"),
             failure="Air-data output is biased", deviation="incorrect")
    block("inertial-unit", "Inertial Measurement Unit", "navigation-suite")
    function("inertial-unit", "Measure aircraft motion and calculate attitude",
             ("Aircraft attitude and acceleration", "information"), ("aircraft", "electrical-power"),
             failure="Attitude information is unavailable")
    block("crew-interface", "Crew Information and Communications", "avionics")
    function("crew-interface", "Combine cockpit information and communications for the crew",
             ("Crew operational information", "information"), ("crew-display", "radio-transceiver", "maintenance-recorder"))
    block("crew-display", "Cockpit Multifunction Display", "crew-interface")
    function("crew-display", "Present navigation and hydraulic-system status to the crew",
             ("Displayed flight and system information", "human_machine"),
             ("navigation-suite", ("b1", "MFN-2", "hydraulic-status", "MIF-2"), "electrical-power"))
    block("radio-transceiver", "Air-Ground Radio", "crew-interface")
    function("radio-transceiver", "Process air-ground communications for crew use",
             ("Crew radio information", "information"), ("@radio-station", "@pilot", "electrical-power"))
    block("maintenance-recorder", "Aircraft Health Recorder", "crew-interface")
    function("maintenance-recorder", "Record equipment health for maintenance review",
             ("Recorded equipment health", "information"), (("b1", "MFN-1"), "electrical-power"))

    # Hydraulics preserves analysis-linked IDs from the former pump-only example.
    function("pump-system", "Supply conditioned hydraulic pressure to aircraft actuators and brakes",
             ("Aircraft hydraulic pressure supply", "material"), ("hydraulic-distribution",),
             fid="supply-demand", output_id="pump-system-supply-out-resource", output_io="supply-out",
             failure="Aircraft hydraulic pressure is insufficient", deviation="insufficient")
    block("hydraulic-supply", "Redundant Hydraulic Supply", "pump-system")
    function("hydraulic-supply", "Combine pump flow and accumulator reserve into hydraulic supply",
             ("Combined hydraulic pump supply", "material"), ("pump-a", "pump-b", "hydraulic-accumulator"))
    for side in ("a", "b"):
        ident = f"pump-{side}"
        block(ident, f"Hydraulic Pump {side.upper()}", "hydraulic-supply", definition_id="def-pump" if side == "a" else None,
              description="Illustrative electrically driven hydraulic pump with the retained demonstration hazard model.")
        instances[ident]["reference_designators"] = [f"P-{side.upper()}"]
        instances[ident]["legacy_refs"] = [f"rbd:f0:component:{'c3' if side == 'a' else 'c4'}"]
        function(ident, "Convert electrical power and reservoir fluid into commanded pressurized flow",
                 (f"Pump {side.upper()} pressurized fluid", "material"),
                 ("electrical-power", "hydraulic-reservoir", ("b1", "DFN-3", "command-in", "controller-command" if side == "a" else None)),
                 fid="move-fluid", output_id=f"pump-{side}-discharge-resource", output_io="discharge",
                 failure="No fluid flow", failure_id="no-flow")
        definitions[ident]["ports"] = [{"id": "discharge", "name": "Discharge", "interface_type": "material",
                                          "direction": "output", "description": "Pressurized fluid outlet", "properties": {}}]
        definitions[ident]["functions"][0]["port_ids"] = ["discharge"]
        definitions[ident]["functions"][0]["definition"]["io"][-1]["port_id"] = "discharge"
        definitions[ident]["analysis_profiles"] = [{
            "id": "pump-reliability", "name": "Illustrative pump constant-hazard model",
            "domain": "reliability", "adapter_id": "reliability.constant-hazard", "adapter_version": 1,
            "status": "draft", "mode_ids": ["run"],
            "source_ref": "Educational example input; not aircraft qualification or service data.",
            "values": {"failure_rate": {"kind": "number", "value": 2e-5, "unit": "failures/hour"}},
        }]
    block("hydraulic-reservoir", "Hydraulic Reservoir", "hydraulic-supply")
    function("hydraulic-reservoir", "Provide stored hydraulic fluid to the pump inlets",
             ("Reservoir hydraulic fluid", "material"), role="source", failure="Usable fluid inventory is lost")
    block("hydraulic-accumulator", "Hydraulic Accumulator", "hydraulic-supply")
    function("hydraulic-accumulator", "Store pump-delivered fluid energy and buffer pressure transients",
             ("Buffered hydraulic fluid reserve", "material"), ("pump-a", "pump-b"),
             failure="Accumulator provides insufficient reserve", deviation="insufficient")
    block("hydraulic-distribution", "Hydraulic Conditioning and Distribution", "pump-system")
    function("hydraulic-distribution", "Deliver clean pressure-controlled fluid to aircraft consumers",
             ("Conditioned hydraulic delivery", "material"), ("hydraulic-manifold",))
    block("hydraulic-filter", "Pressure-Line Filter", "hydraulic-distribution")
    function("hydraulic-filter", "Remove contamination from pump-delivered hydraulic fluid",
             ("Filtered pressurized hydraulic fluid", "material"), ("hydraulic-supply",),
             failure="Filter restricts hydraulic flow", deviation="insufficient")
    block("hydraulic-manifold", "Hydraulic Delivery Manifold", "hydraulic-distribution")
    function("hydraulic-manifold", "Distribute conditioned hydraulic fluid to the common delivery manifold",
             ("Manifold hydraulic pressure", "material"), ("hydraulic-filter",))
    block("pressure-relief-valve", "Pressure Relief Valve", "hydraulic-distribution")
    maintain("pressure-relief-valve", "delivery pressure within the protective relief limit", state_verb="protect",
             failure="Relief valve does not protect against excess pressure")
    block("b1", "Hydraulic Controller Assembly", "pump-system", kind="assembly")
    function("b1", "Regulate hydraulic pressure by commanding the pump drives",
             ("Pump control command", "information"),
             (("power-connector", "DFN-1", "power-in", "power-to-controller"),
              ("pressure-sensor", "DFN-2", "pressure-in", "DIF-2")),
             fid="DFN-3", output_id="b1-command-out-resource", output_io="command-out")
    function("b1", "Detect loss of continuity in the controller power path",
             ("Detected controller power health", "information"),
             (("hydraulic-voltage-monitor", "perform", "health-in", "MIF-1"),),
             fid="MFN-1", function_type="monitoring", output_id="b1-MFN-1-result-io-resource", output_io="MFN-1-result-io",
             failure="Power continuity degrades during operation", failure_id="MFC-1", deviation="failure_deviation:absent")
    function("b1", "Issue safe-state and maintenance status from detected power faults",
             ("Safe-state command and maintenance indication", "information"), (("b1", "MFN-1"),),
             fid="MFN-2", function_type="system_response", output_id="b1-safe-out-resource", output_io="safe-out")
    block("power-connector", "Controller Power Connector", "b1")
    function("power-connector", "Deliver protected 28 V DC power through the connector",
             ("Qualified controller 28 V DC power", "energy"),
             (("electrical-power", "supply-essential-power", "power-in", "DIF-1"),),
             fid="DFN-1", output_id="power-connector-power-out-resource", output_io="power-out",
             failure="Power path opens intermittently", failure_id="DFC-1", deviation="failure_deviation:absent")
    maintain("power-connector", "secure contact", fid="DFN-4", function_type="supporting",
             failure="Fretting corrosion at the connector contacts", failure_id="DFC-3", deviation="failure_deviation:absent")
    block("pressure-sensor", "Hydraulic Pressure Sensor", "b1")
    function("pressure-sensor", "Measure delivery manifold pressure", ("Discharge pressure feedback", "information"),
             ("hydraulic-manifold", "electrical-power"), fid="DFN-2", function_type="monitoring",
             output_id="pressure-sensor-pressure-out-resource", output_io="pressure-out",
             failure="Pressure output is biased high", failure_id="DFC-2", deviation="failure_deviation:absent")
    block("hydraulic-voltage-monitor", "Controller Voltage Monitor", "b1")
    function("hydraulic-voltage-monitor", "Measure controller power-path continuity",
             ("Controller power-path health indication", "information"), (("power-connector", "DFN-1"),))
    for ident, name, quantity in [("demo-part-1", "Microprocessor", 1),
                                  ("demo-part-2", "Bias Resistors", 24),
                                  ("demo-part-3", "Decoupling Caps", 16)]:
        block(ident, name, "b1", kind="piece_part", quantity=quantity,
              description="Piece-part detail retained for the linked illustrative controller failure-rate prediction.")

    # Gear deployment and brake metering share the aircraft hydraulic interface.
    function("landing-gear", "Provide commanded landing, steering, and braking support",
             ("Controlled ground-support forces", "physical"), ("gear-deployment", "wheel-braking"))
    block("gear-deployment", "Gear Deployment and Steering", "landing-gear")
    function("gear-deployment", "Position the landing gear and orient the nose wheel",
             ("Commanded gear and steering motion", "physical"), ("gear-actuator", "nose-steering"))
    block("gear-actuator", "Landing Gear Actuator", "gear-deployment")
    function("gear-actuator", "Convert hydraulic pressure into commanded gear deployment",
             ("Landing gear deployment motion", "physical"), ("pump-system", "@pilot"),
             failure="Landing gear fails to extend")
    block("gear-downlock", "Landing Gear Downlock", "gear-deployment")
    maintain("gear-downlock", "the deployed landing gear in its locked position", state_verb="secure",
             failure="Landing gear does not remain locked")
    block("nose-steering", "Nose-Wheel Steering Actuator", "gear-deployment")
    function("nose-steering", "Convert hydraulic pressure and crew demand into nose-wheel steering",
             ("Nose-wheel steering torque", "physical"), ("pump-system", "@pilot"))
    block("wheel-braking", "Wheel and Brake Assembly", "landing-gear", kind="assembly")
    function("wheel-braking", "Deliver controlled wheel-braking torque", ("Aircraft wheel-braking torque", "physical"),
             ("wheel-brakes",))
    block("brake-metering-valve", "Brake Metering Valve", "wheel-braking")
    function("brake-metering-valve", "Meter hydraulic pressure according to crew braking demand",
             ("Metered brake hydraulic pressure", "material"), ("pump-system", "@pilot"),
             failure="Brake pressure is not supplied")
    block("wheel-brakes", "Wheel Brake Units", "wheel-braking")
    function("wheel-brakes", "Convert metered hydraulic pressure into wheel-braking torque",
             ("Wheel brake reaction torque", "physical"), ("brake-metering-valve",),
             failure="Braking torque is below demand", deviation="insufficient")
    block("wheel-tires", "Wheel and Tire Assemblies", "wheel-braking")
    maintain("wheel-tires", "wheel-to-runway contact and rolling support", state_verb="support")

    # Resource-free structural relations remain distinct from aerodynamic loads.
    function("airframe", "Carry aerodynamic forces through the aircraft load-bearing structure",
             ("Supported aircraft aerodynamic loads", "physical"), ("wing-assembly", "empennage"))
    block("wing-assembly", "Wing Assembly", "airframe", kind="assembly")
    function("wing-assembly", "Develop and transmit wing aerodynamic lift", ("Wing aerodynamic lift", "physical"),
             ("wing-panels",))
    block("wing-box", "Primary Wing Box", "wing-assembly")
    maintain("wing-box", "wing bending and torsional structural integrity", state_verb="support",
             failure="Wing structural load path is degraded", deviation="insufficient")
    block("wing-panels", "Wing Aerodynamic Panels", "wing-assembly")
    function("wing-panels", "Turn ambient airflow into aerodynamic wing lift", ("Wing-panel lift force", "physical"),
             ("@atmosphere", "aileron-actuator"))
    block("wing-attachment", "Wing-to-Fuselage Attachments", "wing-assembly")
    maintain("wing-attachment", "wing-to-fuselage attachment integrity", state_verb="secure")
    block("empennage", "Empennage Assembly", "airframe", kind="assembly")
    function("empennage", "Develop tail forces for aircraft stability and control", ("Tail stability and control forces", "physical"),
             ("horizontal-tail", "vertical-tail"))
    block("horizontal-tail", "Horizontal Tail", "empennage")
    function("horizontal-tail", "Turn airflow and elevator motion into pitch-control force",
             ("Horizontal-tail pitch force", "physical"), ("@atmosphere", "elevator-actuator"))
    block("vertical-tail", "Vertical Tail", "empennage")
    function("vertical-tail", "Turn airflow and rudder motion into yaw-control force",
             ("Vertical-tail yaw force", "physical"), ("@atmosphere", "rudder-actuator"))
    block("tail-attachment", "Empennage Attachments", "empennage")
    maintain("tail-attachment", "empennage attachment integrity", state_verb="secure")
    block("fuselage", "Fuselage and Cabin Structure", "airframe", kind="assembly")
    maintain("fuselage", "occupant and equipment support throughout the aircraft", state_verb="support")
    block("fuselage-shell", "Fuselage Shell", "fuselage")
    maintain("fuselage-shell", "fuselage structural integrity", state_verb="support")
    block("cabin-floor", "Cabin Floor Structure", "fuselage")
    maintain("cabin-floor", "cabin equipment and occupant load support", state_verb="support")
    block("payload-restraints", "Payload Restraints", "fuselage")
    maintain("payload-restraints", "payload restraint within the cabin", state_verb="secure")

    function("thermal-environmental", "Deliver temperature-conditioned ventilation air to the aircraft cabin",
             ("Conditioned aircraft cabin air", "material"), ("cabin-environment",))
    function("thermal-environmental", "Supply temperature-conditioned coolant to aircraft equipment",
             ("Aircraft equipment coolant supply", "material"), ("liquid-cooling",), fid="supply-equipment-coolant")
    block("liquid-cooling", "Equipment Liquid Cooling", "thermal-environmental")
    function("liquid-cooling", "Deliver temperature-conditioned coolant to propulsion equipment",
             ("Temperature-conditioned equipment coolant", "material"), ("coolant-radiator",))
    block("coolant-pump", "Equipment Coolant Pump", "liquid-cooling")
    function("coolant-pump", "Circulate coolant using essential electrical power",
             ("Circulating equipment coolant", "material"), ("coolant-reservoir", "electrical-power"),
             failure="Equipment coolant circulation is lost")
    block("coolant-reservoir", "Equipment Coolant Reservoir", "liquid-cooling")
    function("coolant-reservoir", "Provide stored coolant to the circulation pump",
             ("Stored equipment coolant", "material"), role="source")
    block("coolant-radiator", "Coolant Heat Exchanger", "liquid-cooling")
    function("coolant-radiator", "Reject coolant heat to forced ambient airflow",
             ("Cooled equipment coolant", "material"), ("coolant-pump", "radiator-fan"))
    block("radiator-fan", "Heat Exchanger Fan", "liquid-cooling")
    function("radiator-fan", "Drive ambient airflow across the coolant heat exchanger",
             ("Forced heat-exchanger airflow", "material"), ("electrical-power", "@atmosphere"))
    block("cabin-environment", "Cabin Air Management", "thermal-environmental")
    function("cabin-environment", "Deliver cabin airflow using measured cabin temperature",
             ("Managed cabin ventilation air", "material"), ("cabin-blower", "cabin-temperature-sensor"))
    block("cabin-heater", "Cabin Air Heater", "cabin-environment")
    function("cabin-heater", "Heat incoming air with available electrical energy",
             ("Temperature-conditioned intake air", "material"), ("electrical-power", "@atmosphere"))
    block("cabin-blower", "Cabin Ventilation Blower", "cabin-environment")
    function("cabin-blower", "Move conditioned intake air into the cabin",
             ("Cabin ventilation airflow", "material"), ("cabin-heater", "electrical-power"))
    block("cabin-temperature-sensor", "Cabin Temperature Sensor", "cabin-environment")
    function("cabin-temperature-sensor", "Measure cabin ventilation temperature",
             ("Cabin temperature feedback", "information"), ("cabin-blower", "electrical-power"))

    def add_flow(source: dict, target: dict, rid: str, ident: str) -> None:
        source_block = {key: source[key] for key in ("instance_id", "external_id", "port_id") if key in source}
        target_block = {key: target[key] for key in ("instance_id", "external_id", "port_id") if key in target}
        if source.get("instance_id") and source.get("instance_id") == target.get("instance_id"):
            model["function_links"].append({
                "id": ident, "source": {"instance_id": source["instance_id"], "function_id": source["function_id"]},
                "target": {"instance_id": target["instance_id"], "function_id": target["function_id"]},
                "relationship": "provides_input", "generated": True, "mode_ids": [],
                "rationale": "The consuming function uses this function's output resource within the same installed block.",
            })
            return
        model["interfaces"].append({
            "id": ident, "name": resources[rid]["name"], "interface_type": resources[rid]["category"],
            "source": source_block, "target": target_block, "directionality": "directed", "linkage": "direct",
            "strength": "strong", "nature": "required", "interface_detail": "Illustrative authored resource connection.",
            "flow_description": resources[rid]["name"], "operating_condition": "",
            "source_function_ids": [source["function_id"]] if "function_id" in source else [],
            "target_function_ids": [target["function_id"]] if "function_id" in target else [],
            "mode_ids": [], "properties": {},
            "transfers": [{"id": f"{ident}-transfer", "kind": "flow", "resource_id": rid,
                           "source": source, "target": target, "mode_ids": []}],
        })

    for target_id, target_fid, spec in pending_inputs:
        if isinstance(spec, str):
            source_id, source_fid, input_id, edge_id = spec, None, None, None
        else:
            source_id, *remaining = spec
            source_fid, input_id, edge_id = (remaining + [None, None, None])[:3]
        if source_id.startswith("@"):
            external_id = source_id[1:]
            rid, port_id = external_outputs[external_id]
            source = {"kind": "external", "external_id": external_id, "port_id": port_id}
            source_id = external_id
        else:
            source_fid = source_fid or primary[source_id]
            rid, source_io = outputs[source_id, source_fid]
            source = {"kind": "function", "instance_id": source_id, "function_id": source_fid, "io_id": source_io}
        input_id = input_id or f"in-{source_id}-{source_fid or 'terminal'}"
        target = {"kind": "function", "instance_id": target_id, "function_id": target_fid, "io_id": input_id}
        functions[target_id, target_fid]["definition"]["io"].insert(-1, {
            "id": input_id, "resource_id": rid, "direction": "input",
        })
        add_flow(source, target, rid, edge_id or f"flow-{source_id}-{target_id}-{target_fid}")

    # Every non-root function supports one explicit immediate-parent function.
    parent_allocations = {
        "energy-storage": "supply-high-voltage", "hv-distribution": "supply-high-voltage",
        "liquid-cooling": "supply-equipment-coolant", "hydraulic-voltage-monitor": "MFN-1",
    }
    for (ident, fid), _ in functions.items():
        parent = instances[ident].get("parent_instance_id")
        if parent:
            model["function_links"].append({
                "id": f"support-{ident}-{fid}", "relationship": "decomposes_to",
                "source": {"instance_id": parent, "function_id": parent_allocations.get(ident, primary[parent])},
                "target": {"instance_id": ident, "function_id": fid}, "mode_ids": [],
                "rationale": f"The {instances[ident]['name']} function supports {instances[parent]['name']} at its immediate parent indenture.",
            })

    # Preserve explicit hydraulic dependencies used by the linked example FMEA.
    for ident, source, target, relation, rationale in [
        ("DFL-1", ("power-connector", "DFN-1"), ("b1", "DFN-3"), "enables", "Pressure regulation requires qualified controller power."),
        ("DFL-2", ("pressure-sensor", "DFN-2"), ("b1", "DFN-3"), "provides_input", "Pressure feedback closes the hydraulic control loop."),
        ("DFL-3", ("power-connector", "DFN-1"), ("power-connector", "DFN-4"), "depends_on", "Power-path continuity depends on secure contact."),
        ("MFL-1", ("b1", "MFN-1"), ("b1", "MFN-2"), "enables", "Detected power degradation initiates safe-state status."),
    ]:
        model["function_links"].append({"id": ident, "source": {"instance_id": source[0], "function_id": source[1]},
            "target": {"instance_id": target[0], "function_id": target[1]}, "relationship": relation,
            "rationale": rationale, "mode_ids": []})

    rid, io = outputs["aircraft", "fly-aircraft"]
    add_flow({"kind": "function", "instance_id": "aircraft", "function_id": "fly-aircraft", "io_id": io},
             {"kind": "external", "external_id": "operating-environment", "port_id": "terminal"}, rid, "aircraft-motion")
    for ident, source_id, target_id in [
        ("wing-structural-attachment", "wing-attachment", "fuselage-shell"),
        ("tail-structural-attachment", "tail-attachment", "fuselage-shell"),
        ("wheel-ground-contact", "wheel-tires", "@runway"),
    ]:
        target = ({"kind": "external", "external_id": target_id[1:], "port_id": "terminal"}
                  if target_id.startswith("@") else {"kind": "block", "instance_id": target_id, "function_id": primary[target_id]})
        source = {"kind": "block", "instance_id": source_id, "function_id": primary[source_id]}
        model["interfaces"].append({
            "id": ident, "name": ident.replace("-", " ").capitalize(), "interface_type": "physical",
            "source": {"instance_id": source_id},
            "target": {"external_id": target_id[1:], "port_id": "terminal"} if target_id.startswith("@") else {"instance_id": target_id},
            "directionality": "undirected", "linkage": "direct", "strength": "strong", "nature": "required",
            "interface_detail": "Structural relationship only; no resource ownership or automatic failure propagation is implied.",
            "flow_description": "", "operating_condition": "", "mode_ids": [], "properties": {},
            "source_function_ids": [primary[source_id]], "target_function_ids": [] if target_id.startswith("@") else [primary[target_id]],
            "transfers": [{"id": f"{ident}-relation", "kind": "relation", "source": source, "target": target, "mode_ids": []}],
        })

    # Reusable pump definition with narrow per-occurrence output bindings.
    pump_b = definitions["pump-b"]
    pump_a = definitions["pump-a"]
    pump_a["name"] = "Electric Hydraulic Pump"
    pump_a["description"] = "Reusable illustrative electrically driven pump; each installed pump owns its discharge resource."
    pump_b_io = pump_b["functions"][0]["definition"]["io"]
    instances["pump-b"]["definition_id"] = pump_a["id"]
    instances["pump-b"]["function_overrides"] = [{"function_id": "move-fluid", "resource_bindings": {
        item["id"]: item["resource_id"] for item in pump_b_io
    }}]
    model["definitions"].remove(pump_b)
    for slot in definitions["hydraulic-supply"]["child_slots"]:
        if slot["id"] == "slot-pump-b":
            slot["definition_id"] = pump_a["id"]

    # Visible-by-default overview: all descendants exist inside collapsed L2 blocks.
    l2 = [item for item in model["instances"] if item.get("parent_instance_id") == "aircraft"]
    children: dict[str, list[dict]] = {}
    for item in model["instances"]:
        children.setdefault(item.get("parent_instance_id", ""), []).append(item)
    nodes = [{"instance_id": "aircraft", "x": 0, "y": 0, "width": 1480, "height": 760, "expanded": True}]

    def layout_descendants(parent: str, origin_x: float, origin_y: float) -> None:
        for number, child in enumerate(children.get(parent, [])):
            if definitions[child["id"]]["kind"] == "piece_part":
                continue
            x, y = origin_x + 28 + (number % 2) * 240, origin_y + 76 + (number // 2) * 112
            nodes.append({"instance_id": child["id"], "x": x, "y": y,
                          "width": 216, "height": 76, "expanded": False})
            layout_descendants(child["id"], x, y)

    for number, item in enumerate(l2):
        x, y = 60 + (number % 4) * 350, 80 + (number // 4) * 300
        nodes.append({"instance_id": item["id"], "x": x, "y": y, "width": 280, "height": 112, "expanded": False})
        layout_descendants(item["id"], x, y)
    for number, actor in enumerate(model["externals"]):
        nodes.append({"external_id": actor["id"], "x": -260 if number < 4 else 1500,
                      "y": 60 + (number % 4) * 170, "width": 210, "height": 76, "expanded": False})
    model["diagrams"] = [{
        "id": "diagram-1", "name": "Aircraft System Interfaces", "scope_instance_id": "aircraft",
        "density": "standard", "connectorStyle": "curved",
        "layoutOptions": {"mode": "normal", "preserveGateOrder": True, "preserveEventOrder": True, "optimizeLabelGeometry": False},
        "boundary": {"label": "Aircraft", "x": -300, "y": -40, "width": 2100, "height": 900},
        "viewport": {"x": 0, "y": 0, "zoom": 0.75}, "snap_to_grid": True,
        "mode_ids": [], "nodes": nodes, "hidden_instance_ids": [],
    }]
    # Illustrative design intent is deliberately unverified. These records teach
    # derivation/allocation without inventing qualification evidence or limits.
    def requirement(ident: str, statement: str, block_id: str, criteria: str,
                    parent: str = "", function_id: str = "") -> dict[str, Any]:
        allocation = {"system_model_id": model["id"], "instance_id": block_id}
        if function_id:
            allocation["function_id"] = function_id
        return {
            "id": ident, "statement": statement, "requirement_type": "functional",
            "measure": "", "target": "", "unit": "", "acceptance_criteria": criteria,
            "operating_condition": "", "source": "Illustrative aircraft design intent",
            "owner": "", "confidence": "", "verification_method": "analysis",
            "evidence_ids": [], "special_characteristic": "", "lifecycle": "draft",
            "derived_from_ids": [parent] if parent else [], "allocations": [allocation],
            "mode_ids": ["run", "takeoff", "landing"], "mission_profile": "",
            "failure_definition": "", "supporting_analyses": [],
        }

    model["requirements"] = [
        requirement("REQ-AIRCRAFT-CONTROL", "The aircraft shall translate crew intent into controlled aircraft motion.",
                    "aircraft", "Demonstrate traceability from crew commands through propulsion and control-surface functions to aircraft motion.",
                    function_id="fly-aircraft"),
        requirement("REQ-PROPULSION-COMMAND", "The propulsion system shall provide thrust in response to aircraft control demands.",
                    "propulsion", "Show a complete command, electrical-power, and thrust path for each propulsion channel.",
                    "REQ-AIRCRAFT-CONTROL", "perform"),
        requirement("REQ-ESSENTIAL-POWER", "The electrical power system shall supply the essential DC loads required for controlled flight.",
                    "electrical-power", "Review every essential load against its allocated supply, interfaces, and failure response.",
                    "REQ-AIRCRAFT-CONTROL", "supply-essential-power"),
        requirement("REQ-LEFT-MOTOR-CONVERSION", "The left motor shall convert supplied phase power into commanded shaft torque.",
                    "motor-left", "Demonstrate the phase-power input, torque output, and associated failure-mode coverage for the installed left motor.",
                    "REQ-PROPULSION-COMMAND", "perform"),
    ]
    model["verification_cases"] = [{
        "id": f"VER-{item['id'][4:]}", "objective": f"Review {item['id']}",
        "requirement_ids": [item["id"]], "failure_chain_ids": [], "method": "analysis",
        "level": "System" if item["id"] == "REQ-AIRCRAFT-CONTROL" else "Allocated item",
        "sample_size": "", "acceptance_criteria": item["acceptance_criteria"], "owner": "",
        "status": "planned", "evidence_link_ids": [], "mode_ids": item["mode_ids"],
        "outcome": "not_assessed", "assessment": "", "reviewed_by": "", "reviewed_at": "",
        "reviewed_fingerprint": "", "reviewed_revision": "",
    } for item in model["requirements"]]
    model["verification_evidence"] = []
    return deepcopy(model)


def validate_aircraft_model(model: dict[str, Any]) -> dict[str, Any]:
    """Validate both stored references and complete function/resource allocations."""
    import sys
    root = Path(__file__).resolve().parents[1]
    sys.path[:0] = [str(root / "src"), str(root / "gui" / "backend")]
    from reliability.FMEA_readiness import architecture_context, architecture_findings
    from reliability.SystemDefinition import validate_system_definition
    from system_definition_schemas import SystemDefinitionModel

    parsed = SystemDefinitionModel.model_validate(model).model_dump()
    validation = validate_system_definition(parsed)
    findings = architecture_findings(parsed, architecture_context(parsed, {"scope_instance_id": "aircraft"}))
    if not validation["valid"] or findings:
        raise ValueError(json.dumps({"validation": validation, "readiness": findings}, indent=2))
    return validation


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="Write the canonical model JSON to this path; otherwise print it.")
    parser.add_argument("--validate", action="store_true", help="Check the strict server schema and complete architecture readiness.")
    args = parser.parse_args()
    model = build_aircraft_model()
    if args.validate:
        validate_aircraft_model(model)
    text = json.dumps(model, indent=2) + "\n"
    if args.output:
        args.output.write_text(text)
    else:
        print(text, end="")


if __name__ == "__main__":
    main()
