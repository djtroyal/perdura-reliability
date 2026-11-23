"""Shared system structure, lifetime and renewal calculations.

Static success at a point is kept distinct from first-passage survival. RBDs
compile to the same BDD operations used by the existing mission solver; static
FTA delegates gate semantics to FaultTreeAdvanced.
"""
from __future__ import annotations

import csv
import io
import math
import warnings
from functools import lru_cache

import numpy as np
from scipy import integrate, stats
from reliability.FaultTreeAdvanced import BDDManager, compile_graph, evaluate_static


class _SystemLifecycleInputError(ValueError):
    """Coded lifecycle constraints with ValueError compatibility for callers."""

    def __init__(self, code):
        self.code = code
        super().__init__({
            'positive_conditioning_required': 'A duration model with negative support requires explicit conditioning on positive time; clipping is not allowed.',
            'dynamic_fta': 'Repairable simulation accepts static FTA success logic; dynamic SPARE/PAND/SEQ/FDEP remains in the existing mission analysis.',
        }[code])


class Lifetime:
    """SciPy lifetime with explicit conditioning for real-support durations."""
    def __init__(self, kind, params, *, condition_positive=False, exposure_scale=1., require_positive=True):
        self.kind, self.params = kind, dict(params)
        self.exposure_scale = float(exposure_scale)
        if not math.isfinite(self.exposure_scale) or self.exposure_scale < 0:
            raise ValueError("Exposure scale must be nonnegative and finite.")
        p = self.params
        if any(not math.isfinite(float(v)) for v in p.values()):
            raise ValueError("Distribution parameters must be finite.")
        self.constant = None
        loc = float(p.get("gamma", 0.))
        if kind == "deterministic":
            self.constant = float(p.get("value", p.get("mean", 0.)))
            if self.constant <= 0:
                raise ValueError("Deterministic durations must be positive.")
            self.frozen = None
        elif kind == "exponential":
            rate = float(p.get("lambda", 1 / p["mean"] if p.get("mean", 0) > 0 else 0))
            if rate <= 0:
                raise ValueError("Exponential rate must be positive.")
            self.frozen = stats.expon(loc=loc, scale=1 / rate)
        elif kind == "weibull":
            self.frozen = stats.weibull_min(float(p["beta"]), loc=loc, scale=float(p.get("alpha", p.get("eta", 0))))
        elif kind == "lognormal":
            self.frozen = stats.lognorm(float(p["sigma"]), loc=loc, scale=math.exp(float(p["mu"])))
        elif kind == "gamma":
            self.frozen = stats.gamma(float(p["alpha"]), loc=loc, scale=float(p["beta"]))
        elif kind == "loglogistic":
            self.frozen = stats.fisk(float(p["beta"]), loc=loc, scale=float(p["alpha"]))
        elif kind == "beta":
            self.frozen = stats.beta(float(p["alpha"]), float(p["beta"]), scale=float(p.get("support_scale", 1)))
        elif kind == "normal":
            self.frozen = stats.norm(float(p["mu"]), float(p["sigma"]))
        elif kind == "gumbel":
            self.frozen = stats.gumbel_l(float(p["mu"]), float(p["sigma"]))
        else:
            raise ValueError(f"Unsupported lifetime {kind!r}.")
        self.condition_positive = bool(condition_positive)
        self.log_s0 = 0. if self.constant is not None else float(self.frozen.logsf(0))
        if self.constant is None:
            median = float(self.frozen.ppf(.5))
            if not math.isfinite(median) or not math.isfinite(self.log_s0):
                raise ValueError("Invalid or degenerate lifetime parameters.")
            low, _ = self.frozen.support()
            if low < 0 and not condition_positive and require_positive:
                raise _SystemLifecycleInputError('positive_conditioning_required')

    def sf(self, time):
        x = np.asarray(time) * self.exposure_scale
        if self.constant is not None:
            return np.asarray(x < self.constant, dtype=float)
        return np.exp(self.frozen.logsf(x) - (self.log_s0 if self.condition_positive else 0.))

    def cdf(self, time):
        """Retain tiny failure probabilities when survival rounds to one."""
        x = np.asarray(time) * self.exposure_scale
        if self.constant is not None:
            return np.asarray(x >= self.constant, dtype=float)
        return -np.expm1(self.frozen.logsf(x) - (self.log_s0 if self.condition_positive else 0.))

    def pdf(self, time):
        if self.constant is not None:
            raise ValueError("A deterministic lifetime has an atom, not an ordinary probability density.")
        if self.exposure_scale == 0:
            return 0.
        return float(np.exp(self.frozen.logpdf(time * self.exposure_scale)
                            - (self.log_s0 if self.condition_positive else 0.))) * self.exposure_scale

    def sample(self, rng):
        if self.exposure_scale == 0:
            return math.inf
        if self.constant is not None:
            return self.constant / self.exposure_scale
        # Inverse survival avoids rejection loops and has no clipping atom.
        probability = max(np.nextafter(0., 1.), float(rng.random()))
        if self.condition_positive:
            probability *= math.exp(self.log_s0)
        value = float(self.frozen.isf(probability)) / self.exposure_scale
        if not math.isfinite(value) or value <= 0:
            raise ValueError("A duration draw was nonpositive/nonfinite; review the model scale.")
        return value

    def scale(self):
        if self.exposure_scale == 0:
            return 1.
        if self.constant is not None:
            return self.constant / self.exposure_scale
        return float(self.frozen.isf(.5 * math.exp(self.log_s0))) / self.exposure_scale


class SystemStructure:
    def __init__(self, kind, nodes, edges, overrides=None):
        self.kind = kind
        self.nodes, self.edges = nodes, edges
        self.overrides = {int(k): bool(v) for k, v in (overrides or {}).items()}
        self.components = {}
        self.labels = {}
        for node in nodes:
            data = node.get("data") or {}
            if data.get("sourceError"):
                raise ValueError(str(data["sourceError"]))
            if data.get("systemReferenceBroken"):
                raise ValueError("The linked system item was deleted; relink or detach it before calculation.")
            if data.get("linkedAnalysisId") or (node.get("type") == "transfer" and any(data.get(k) for k in ("analysisId", "transferTo", "referenceAnalysisId"))):
                raise ValueError("Expand linked subsystem/transfer diagrams before lifecycle analysis; a mission-point result does not specify repairable dynamics.")
            if data.get("ccf_group"):
                raise ValueError("Lifecycle analysis requires explicit common-shock events; mission-only beta-factor dependence cannot define repair clocks.")
            if node.get("type") in ({"component"} if kind == "rbd" else {"basic", "undeveloped", "conditioning", "external"}):
                key = str(data.get("component_key") or node["id"]) if kind == "rbd" else str(data.get("event_key") or data.get("eventKey") or node["id"])
                if key in self.components:
                    fields = ("distribution", "dist_params", "mission_time", "exposure_time")
                    if any(self.components[key].get(f) != data.get(f) for f in fields):
                        raise ValueError(f"Repeated component {key!r} has inconsistent lifetime parameters.")
                self.components[key] = data
                self.labels[key] = str(data.get("label") or key)
        if not 1 <= len(self.components) <= 64:
            raise ValueError("Lifecycle analyses require 1 to 64 distinct components.")
        self.keys = sorted(self.components)
        if kind == "fta":
            # Normalize the event identity to the engine's canonical data key.
            normalized = [{**n, "data": {**(n.get("data") or {}),
                         **({"eventKey": (n.get("data") or {}).get("event_key")}
                            if (n.get("data") or {}).get("event_key") else {})}} for n in nodes]
            graph = compile_graph(normalized, edges)
            if graph.dynamic:
                raise _SystemLifecycleInputError('dynamic_fta')
            evaluated = evaluate_static(graph, {k: .5 for k in self.keys}, max_conditions=0)
            self.manager = evaluated.manager
            # FTA variables mean failure. Convert each variable to success so
            # every lifecycle state uses the same up=True convention.
            old = self.manager
            self.manager = BDDManager(old.variables, max_nodes=100000)
            @lru_cache(None)
            def invert(node):
                if node <= 1:
                    return 1 - node  # success = NOT top failure
                variable, low, high = old.nodes[node]
                return self.manager.mk(variable, invert(high), invert(low))
            self.root = invert(evaluated.roots[graph.root_id])
        elif kind == "rbd":
            self.manager = BDDManager(self.keys, max_nodes=100000)
            by_id = {node["id"]: node for node in nodes}
            if len(by_id) != len(nodes):
                raise ValueError("Diagram node IDs must be unique.")
            incoming = {key: [] for key in by_id}
            outgoing = {key: [] for key in by_id}
            for edge in edges:
                if edge["source"] not in by_id or edge["target"] not in by_id:
                    raise ValueError("A diagram edge references a missing node.")
                incoming[edge["target"]].append(edge["source"])
                outgoing[edge["source"]].append(edge["target"])
            sources = [n["id"] for n in nodes if n["type"] == "source"]
            sinks = [n["id"] for n in nodes if n["type"] == "sink"]
            if len(sources) != 1 or len(sinks) != 1:
                raise ValueError("An RBD requires one source and one sink.")
            values, waiting = {}, set(by_id)
            while waiting:
                ready = sorted(k for k in waiting if all(p in values for p in incoming[k]))
                if not ready:
                    raise ValueError("Lifecycle RBD must be acyclic.")
                for key in ready:
                    n = by_id[key]
                    children = [values[p] for p in incoming[key]]
                    if key == sources[0]:
                        value = 1
                    elif n["type"] == "kofn":
                        k = int((n.get("data") or {}).get("k", 0))
                        if not 1 <= k <= len(children):
                            raise ValueError("Voting threshold must be within the incoming branch count.")
                        value = self.manager.atleast(children, k)
                    else:
                        value = self.manager.fold("or", children, 0)
                        if n["type"] == "component":
                            cid = str((n.get("data") or {}).get("component_key") or key)
                            value = self.manager.apply("and", value, self.manager.variable(cid))
                        elif n["type"] not in {"source", "sink", "junction"}:
                            raise ValueError(f"Unsupported RBD node type {n['type']!r}.")
                    values[key] = value
                    waiting.remove(key)
            self.root = values[sinks[0]]
        else:
            raise ValueError("Model kind must be rbd or fta.")
        if self.overrides:
            if len(self.keys) > 12 or any(k < 0 or k >= 2 ** len(self.keys) for k in self.overrides):
                raise ValueError("State overrides require at most 12 components and valid stable state IDs.")
            for state, success in sorted(self.overrides.items()):
                terms = [self.manager.variable(k) for k in self.keys]
                condition = self.manager.fold("and", [v if state & (1 << i) else self.manager.negate(v)
                                                         for i, v in enumerate(terms)], 1)
                self.root = (self.manager.apply("or", self.root, condition) if success else
                             self.manager.apply("and", self.root, self.manager.negate(condition)))
        # Positive unateness can be established on the BDD without 2**n states.
        self.coherent = True
        for variable in self.manager.variables:
            idx = self.manager.order[variable]
            @lru_cache(None)
            def cofactor(node, bit):
                if node <= 1:
                    return node
                level, low, high = self.manager.nodes[node]
                if level == idx:
                    return high if bit else low
                return self.manager.mk(level, cofactor(low, bit), cofactor(high, bit))
            low, high = cofactor(self.root, False), cofactor(self.root, True)
            if self.manager.apply("and", low, self.manager.negate(high)) != 0:
                self.coherent = False

    def succeeds(self, working):
        node = self.root
        while node > 1:
            idx, low, high = self.manager.nodes[node]
            node = high if working[self.manager.variables[idx]] else low
        return bool(node)

    def probability(self, probabilities):
        return float(self.manager.probability(self.root, probabilities))

    def lifetime_probability(self, lifetimes, time, *, failure=False):
        """BDD weights from separate stable CDF/SF evaluations."""
        probabilities = {key: (float(life.cdf(time)), float(life.sf(time))) for key, life in lifetimes.items()}
        @lru_cache(None)
        def visit(node):
            if node <= 1:
                return float(1 - node if failure else node)
            variable, low, high = self.manager.nodes[node]
            q, r = probabilities[self.manager.variables[variable]]
            return q * visit(low) + r * visit(high)
        return visit(self.root)

    def density(self, lifetimes, time):
        """Analytic derivative of the multilinear BDD success probability."""
        weights = {key: (float(life.cdf(time)), float(life.sf(time)), life.pdf(time)) for key, life in lifetimes.items()}
        @lru_cache(None)
        def visit(node):
            if node <= 1:
                return float(node), 0.
            variable, low, high = self.manager.nodes[node]
            q, r, density = weights[self.manager.variables[variable]]
            a, da = visit(low); b, db = visit(high)
            # Avoid 0*infinity when an irrelevant branch has equal outcomes.
            influence = b - a
            return q*a + r*b, q*da + r*db - (density*influence if influence else 0.)
        return -visit(self.root)[1]

    def lifetimes(self, mission_time, condition_positive=False, require_positive=True):
        out = {}
        for key, data in self.components.items():
            kind = data.get("distribution")
            if not kind:
                raise ValueError(f"{self.labels[key]} needs a life distribution; fixed mission probabilities cannot define a lifetime.")
            override = data.get("mission_time") if self.kind == "rbd" else data.get("exposure_time")
            scale = float(override) / mission_time if override is not None else 1.
            out[key] = Lifetime(kind, data.get("dist_params") or {}, condition_positive=condition_positive,
                                exposure_scale=scale, require_positive=require_positive)
        return out

    def state_table(self, probabilities, max_states=4096, *, failure_probabilities=None):
        count = 2 ** len(self.keys)
        if count > max_states:
            raise ValueError(f"The complete table needs {count} rows, above the {max_states} limit. Exact BDD analysis remains available.")
        rows = []
        for state in range(count):
            working = {key: bool(state & (1 << i)) for i, key in enumerate(self.keys)}
            probability = math.prod(probabilities[k] if up else (failure_probabilities[k] if failure_probabilities is not None else 1 - probabilities[k]) for k, up in working.items())
            rows.append({"id": state, "working": working, "success": self.succeeds(working), "probability": probability})
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["state_id", *self.keys, "success", "probability"])
        for row in rows:
            writer.writerow([row["id"], *[int(row["working"][k]) for k in self.keys], int(row["success"]), row["probability"]])
        return {"keys": self.keys, "labels": self.labels, "rows": rows, "csv": output.getvalue(),
                "probability_sum": sum(row["probability"] for row in rows),
                "success_probability": sum(row["probability"] for row in rows if row["success"]),
                "coherent": self.coherent, "state_id_rule": "Bit i corresponds to keys[i]; 1 means working. IDs are stable for this component set."}


def system_renewal(structure, lifetimes, interval, *, policy="scheduled", downtime=0., include_mttf=True, rtol=1e-7):
    if policy not in {"scheduled", "age"} or interval <= 0 or downtime < 0:
        raise ValueError("Choose scheduled or failure-or-age renewal, a positive interval, and nonnegative restoration downtime.")
    if not structure.coherent or not structure.succeeds({k: True for k in structure.keys}):
        raise ValueError("A first-passage survival/renewal model must be coherent and initially successful; use state probabilities or repairable simulation for this logic.")
    if structure.succeeds({k: False for k in structure.keys}):
        raise ValueError("The system succeeds with all units failed, so a finite first-failure mean is not defined.")
    def survival(time):
        return structure.lifetime_probability(lifetimes, time)
    scale = max(d.scale() for d in lifetimes.values())
    def integral(stop, eps):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always", integrate.IntegrationWarning)
            value, error = integrate.quad(lambda x: survival(x * scale), 0, stop / scale,
                                          epsabs=eps, epsrel=eps, limit=250)
        if caught or not math.isfinite(value) or value < 0 or error > max(eps * 10, abs(value) * eps * 10):
            raise ValueError("System survival integration did not converge at the requested tolerance.")
        return value * scale, error * scale
    uptime, error = integral(interval, rtol)
    r = survival(interval)
    # Evaluate the complement directly through the BDD to avoid subtracting a
    # rounded-to-one success probability in a rare-event renewal calculation.
    failure = structure.lifetime_probability(lifetimes, interval, failure=True)
    cycle = (interval if policy == "scheduled" else uptime) + downtime
    mean_uptime = uptime / failure if failure > 0 else None
    mttf, mttf_error, status = None, None, "not_requested"
    if include_mttf:
        try:
            mttf, mttf_error = integral(math.inf, rtol)
            second, second_error = integral(math.inf, rtol / 4)
            if abs(second - mttf) > max(1e-10 * scale, 10 * (mttf_error + second_error)):
                raise ValueError("Tail integral changed beyond its estimated error.")
            mttf, mttf_error, status = second, max(second_error, abs(second - mttf)), "converged"
        except ValueError:
            mttf, mttf_error = None, None
            status = "unresolved_or_infinite"
    curve = []
    continuous = all(life.constant is None for life in lifetimes.values())
    for time in np.linspace(0, interval, 101):
        probability = survival(float(time))
        density = structure.density(lifetimes, float(time)) if continuous else None
        curve.append({"time": float(time), "reliability": probability,
                      "density": density if density is not None and math.isfinite(density) else None,
                      "hazard": density / probability if density is not None and math.isfinite(density) and probability > 0 else None})
    return {"interval": interval, "policy": policy, "restoration_downtime": downtime,
            "reliability": r, "failure_probability": failure, "restricted_mean": uptime,
            "mean_operating_time_per_failure": mean_uptime,
            "mean_calendar_time_per_failure": cycle / failure if failure > 0 else None,
            "failure_frequency_per_calendar_time": failure / cycle, "availability": uptime / cycle,
            "mttf": mttf, "mttf_status": status, "curve": curve,
            "numerical": {"method": "scaled_adaptive_quadrature", "relative_tolerance": rtol,
                          "restricted_mean_error_estimate": error, "mttf_error_estimate": mttf_error,
                          "note": "Quadrature error estimates are numerical diagnostics, not confidence intervals or rigorous tail bounds."},
            "assumptions": ["All components renew together to independent new lifetimes.",
                "No repairs occur within a mission cycle.",
                ("Scheduled policy: after failure, remain down until the fixed calendar interval; then restore for the specified downtime."
                 if policy == "scheduled" else "Failure-or-age policy: renew at first failure or attained age T, whichever comes first, plus restoration downtime."),
                "Infinite-horizon means are withheld if quadrature does not converge; a truncated mean is never labeled MTTF."]}
