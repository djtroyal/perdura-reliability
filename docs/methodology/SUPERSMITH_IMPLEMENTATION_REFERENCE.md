# SuperSMITH Reliability Analysis — Implementation Reference

**Purpose:** A source-backed reference for designing and building a new reliability-analysis tool. It compiles the full investigated method inventory, mathematical models, recovered native arithmetic, source locations, validation examples, proposed software contracts, and unresolved algorithms.

**Reference version:** SuperSMITH 6.0.0.126, identified by the supplied installer manifest. **Investigation date:** 2026-11-20. **REA version:** 6.10.1. **Document revision:** 1.

**Scope:** The investigation was static; SuperSMITH was not executed. Original VB6 project files, source filenames, and source-line mappings were not recovered. The native assembly is decoded executable code. Python files are analyst translations or mathematical reconstructions. This document supports implementation of many standard methods, but is not a complete compatibility specification for every proprietary SuperSMITH algorithm.

There are **83 catalog entries**, including grouped variants, supporting calculators, an explicitly unimplemented model, and a general-theory entry. This is not a count of 83 independent implemented algorithms. The 51 tutorial references provide corroboration and are not an additional algorithm count.

The document includes core equations, every catalog entry, key code, original normal-function coefficients, and validation inputs. This is an imported investigation reference: its `analysis/` links and installer references refer to the original investigation bundle, which is not included in this repository. They are not repository-local evidence links. Perdura's independent implementation scope and validation are documented in [standard-lifetime-methods.md](standard-lifetime-methods.md).

## Contents

1. [Evidence levels and investigation scope](#evidence)
2. [Artifact identity and source map](#artifacts)
3. [Shared mathematical specification](#mathematics)
4. [Recovered native code and supplied sample code](#native)
5. [Complete method catalog](#catalog)
6. [Proposed architecture and data contracts](#architecture)
7. [Numerical and statistical implementation policies](#policies)
8. [Validation cases and acceptance criteria](#validation)
9. [Documentation defects and unresolved algorithms](#unknowns)
10. [Suggested delivery sequence](#delivery)
11. [Reproducibility and evidence maintenance](#reproduction)
12. [Appendix A: Tutorial and dataset references](#examples)
13. [Appendix B: Further code-navigation locations](#navigation)
14. [Appendix C: Recovered normal-function coefficients](#coefficients)

<a id="evidence"></a>

## 1. Evidence levels and investigation scope

| Label | Meaning | Use when building a new tool |
|---|---|---|
| Native arithmetic observed | Particular instructions, constants and branches were inspected in the executable. | Reproduce the identified calculation if desired, retaining its stated limits. |
| D — Documented | Bundled help states a formula, algorithm description or capability. | Implement the described mathematics; do not infer unmentioned optimizer or boundary behavior. |
| A — Algebraic restatement | A standard mathematical expression derived from the documented model. | Use as an independently specified implementation, not a claim of exact compatibility. |
| U — Undisclosed | A capability is named but its exact equation/calibration was not recovered. | Record the gap, use a clearly named alternative, or acquire further evidence. |
| Proposed design | Architecture, API, numerical policies and delivery choices introduced for the new tool. | Recommendations, not observations about SuperSMITH. |

`D` does not mean every numerical detail is disclosed. Read each entry's limitations. Supplemental “reference algebra” remains explanatory mathematics, not recovered source code.

The investigation combined actual REA PE-import inspection, desktop-artifact inspection and objdump observations with local CAB extraction, static disassembly, unchanged-byte slicing, help/tutorial extraction, and independent arithmetic checks. Local shell results are distinct from REA Evidence.

REA's whole-executable disassembly encountered output/transport limits. Focused derived-object disassemblies subsequently captured six selected native routines completely. This does not establish whole-program control-flow coverage. Ghidra, Hopper, IDA and Kuna were unavailable; objdump remained usable through REA.

The package is a native 32-bit Windows application using the VB6 runtime. It is not a JavaScript source tree. The bundled help describes version 6 as consolidating Weibull, Visual and YBath into `smithw.exe`. The `smithv.exe` and `smithy.exe` stubs select Visual and YBath with `-pv` and `-py`. That statement is documented, not demonstrated by executing the stubs. Source: [help line 439](analysis/sources-help.html#L439).

<a id="artifacts"></a>

## 2. Artifact identity and source map

| Artifact | Bytes | SHA-256 |
| --- | --- | --- |
| [smithw.CAB](smithw.CAB) | 6,984,952 | `8c6794701179982451295195d9d7e3f74f39177a3ea7bfc835f2dac21dde6a03` |
| [Setup.lst](Setup.lst) | 2,781 | `ccae76a86bf354a54113bde546e197f9b84cdb87ff15a5f8916486896e16536e` |
| [analysis/extracted/smithw.exe](analysis/extracted/smithw.exe) | 12,132,352 | `3ac018a75541d47f7975bc04afcb71d285158025354371aa078542184f6aa19a` |
| [analysis/extracted/sshelp.ztf](analysis/extracted/sshelp.ztf) | 4,928,971 | `310c4ff5a143dcd69292591cc1d0c1dda41650e5c4baf15f33ea32b2eeee45a8` |

`Setup.lst` line 49 reports version 6.0.0.126. Executable entry address is `0x00462C78`. The original `.text` section begins at VA `0x00401000`, file offset `0x00001000`, size `0x00B8E6B0`. For the recovered slices:

```text
original_virtual_address = original_file_offset + 0x00400000
```

This mapping is specific to these sections and this executable. The SHA-256 establishes identity; filename and reported version alone do not.

| Resource | Purpose |
|---|---|
| [Readable help](analysis/help/sshelp-readable.txt) | 6,744 extracted text lines. |
| [Help line/byte map](analysis/help/sshelp-line-map.tsv) | Original physical records and exact byte locations. |
| [Help with line anchors](analysis/sources-help.html) | Inspectable citations used below. |
| [Method evidence table](analysis/help-methods.tsv) | 83 entries, status, limitations and source provenance. |
| [Enriched catalog](analysis/methods-enriched.json) | Added reference algebra, explicitly qualified. |
| [Native byte manifest](analysis/binary/native-math-manifest.json) | Addresses, original offsets, lengths, raw/wrapper hashes and imports. |
| [Native translation](analysis/binary/reconstructed_math.py) | Recovered numeric arithmetic; reads original coefficients. |
| [General mathematical reference](analysis/mathematical_reference.py) | Standard model and workflow reconstructions. |
| [Compact REA bundle](analysis/rea-evidence-compact.json) | 21 original Evidence records; omits two large whole-executable disassembly records. |
| [Full REA bundle](analysis/rea-evidence.json) | All 23 records, including the large disassembly observations. |
| [REA evidence index](analysis/rea-evidence-index.json) | IDs, paths, operations and compact-bundle membership. |
| [Tutorial provenance](analysis/reference/provenance.json) | Original/extracted document and dataset identities. |
| [HTML companion](analysis/SuperSmith-reliability-analysis.html) | Searchable method report. |

Byte offsets are zero-based/end-exclusive. Readable and original physical lines are one-based. Some ZTF equations are picture records omitted by text extraction, and some Symbol-font characters retain legacy encodings. Absence of a text formula is not proof that an original formula image is absent.

<a id="mathematics"></a>

## 3. Shared mathematical specification

### 3.1 Notation and units

| Symbol | Meaning |
|---|---|
| $t,a,\Delta$ | Lifetime/exposure, current age, additional exposure in consistent units. |
| $F,R,f,h$ | Failure CDF, survival $1-F$, density $dF/dt$, hazard $f/R$. |
| $H(t)$ | Ordinary cumulative hazard $-\ln R(t)$, distinct from SuperSMITH's incompletely specified ACH diagnostic. |
| $\eta,\beta,t_0$ | Weibull scale, shape and location; scale and shape are positive. |
| $\mu,\sigma$ | Normal mean and positive standard deviation. |
| $Med,SigF$ | Lognormal parameters $e^{\mu_{\log}}$, $e^{\sigma_{\log}}$; $SigF>1$. |
| $\xi,\delta$ | Gumbel location and positive scale. Help sometimes calls $\xi$ a shape factor. |
| $n,r$ | Sample count and failure count under the selected method's frequency/censoring convention. |
| $C,\alpha$ | Confidence and $1-C$. |
| $\Phi,\phi,\Gamma$ | Standard normal CDF/density and gamma function. |
| $M(t),\rho(t)$ | Expected cumulative recurrent events and instantaneous intensity. |

Public model formulas use natural logarithms. Native Weibull code also uses base-10 intermediates and converts with $\ln 10$; that is a numerical detail, not a different probability model.

### 3.2 Lifetime models

For Weibull let $x=(t-t_0)/\eta>0$, $A=x^\beta$:

$$
F=1-e^{-A},\quad R=e^{-A},\quad
f=\frac{\beta}{\eta}x^{\beta-1}e^{-A},\quad
h=\frac{\beta}{\eta}x^{\beta-1}.
$$

$$
B_p=t_0+\eta[-\ln(1-p)]^{1/\beta},\qquad
E[T]=t_0+\eta\Gamma(1+1/\beta).
$$

Two-parameter Weibull sets $t_0=0$; Exponential fixes $\beta=1$; Rayleigh fixes $\beta=2$. The Rayleigh scale here is Weibull-compatible $\eta$, not the alternative parameter $\sigma_R=\eta/\sqrt{2}$.

For a new tool, explicitly define ideal support as $F=0,R=1$ at or below $t_0$. Density/hazard limits at $t_0$ differ for shapes below, equal to and above one. This proposed support policy is not a reconstruction of every native boundary path.

| Family | CDF | Quantile |
|---|---|---|
| Normal | $\Phi((t-\mu)/\sigma)$ | $\mu+\sigma\Phi^{-1}(p)$ |
| Lognormal, optional shift | $\Phi((\ln(t-t_0)-\ln Med)/\ln SigF)$ | $t_0+Med\,SigF^{\Phi^{-1}(p)}$ |
| Lower Gumbel | $1-\exp[-\exp((t-\xi)/\delta)]$ | $\xi+\delta\ln[-\ln(1-p)]$ |
| Upper Gumbel | $\exp[-\exp(-(t-\xi)/\delta)]$ | $\xi-\delta\ln[-\ln p]$ |

For lognormal, `Med` is the median of $T-t_0$, not its arithmetic mean. The mean is $t_0+Med\exp[(\ln SigF)^2/2]$. See M001–M011 for source references and fixed-parameter variants.

### 3.3 Mixtures and competing risks

Define $A_j=(t/\eta_j)^{\beta_j}\ge0$. The help instead uses $W_j=-A_j$; keep the sign convention consistent.

| Model | Survival |
|---|---|
| W4 competing risks | $R=e^{-(A_1+A_2)}$ |
| W5B susceptible fraction plus common risk | $R=e^{-A_2}[(1-u)+ue^{-A_1}]$ |
| W7 infant/bathtub mixture | $R=e^{-(A_c+A_w)}[(1-u)+ue^{-A_i}]$ |
| W3B affected-fraction approximation | $R=(1-u)+ue^{-A_1}$ |
| W5E exclusive populations | $R=ue^{-A_1}+(1-u)e^{-A_2}$, **documented theory/planned here** |

Require $0\le u\le1$. Density is $-dR/dt$; hazard is $f/R$. W4 hazards add. W5B/W7 use conditional survivor weights and are not the sum of all unweighted hazards.

The general theory is $R(t)=\sum_g u_g\exp[-\sum_{j\in g}A_j(t)]$, with weights summing to one. Arbitrary mixtures exceed the documented 4/5/7-parameter solver scope. Mixture fits and quantiles usually need numerical solutions; exact optimizer/stopping choices remain unknown.

### 3.4 Likelihood and censoring

For independent observations with frequency $w_i$:

| Observation | Log-likelihood contribution |
|---|---|
| Exact failure $t_i$ | $w_i\ln f(t_i)$ |
| Right censor $c_i$ | $w_i\ln R(c_i)$ |
| Discovery/left censor by $r_i$ | $w_i\ln F(r_i)$ |
| Interval failure $(l_i,r_i]$ | $w_i\ln[F(r_i)-F(l_i)]$ |

Sum and maximize over free parameters. A suspension is not a failure at its censor time. Recurrent histories and repeated inspections of the same cohort are not automatically independent lifetime records.

Standard unshifted Weibull equations for exact failures plus right censoring, $r=\sum_{\rm fail}w_i>0$:

$$
\widehat\eta^\beta=\frac{\sum_{\rm all}w_i t_i^\beta}{r},
\qquad
0=\frac1\beta+\frac{\sum_{\rm fail}w_i\ln t_i}{r}
-\frac{\sum_{\rm all}w_i t_i^\beta\ln t_i}
       {\sum_{\rm all}w_i t_i^\beta}.
$$

These are mathematical derivations, not the recovered optimizer. Fixed-$\beta$ WeiBayes uses the first equation. All-censored data do not give an ordinary finite scale MLE; a known-shape zero-failure lower confidence scale is instead:

$$
\eta_L=\left[\frac{\sum_iw_i t_i^\beta}{-\ln(1-C)}\right]^{1/\beta}.
$$

Do not use those profile equations unchanged for interval data, unknown $t_0$, or arbitrary mixtures.

### 3.5 Rank regression and plotting positions

For Weibull, $X_i=\ln(t_i-t_0)$, $Y_i=\ln[-\ln(1-p_i)]$. Let $S_{xy}=\sum(X_i-\bar X)(Y_i-\bar Y)$, similarly $S_{xx},S_{yy}$.

- X-on-Y: $b=S_{xy}/S_{yy}$, $\beta=1/b$, $\ln\eta=\bar X-b\bar Y$.
- Y-on-X: $\beta=S_{xy}/S_{xx}$, $\ln\eta=\bar X-\bar Y/\beta$.

SuperSMITH documents precise-data `rr` as X-on-Y and grouped default regression as Y-on-X. `rrs` reverses the standard direction. Inspection-direction wording varies across help sections; make the new-tool setting explicit.

| Complete uncensored rank | Plotting probability |
|---|---|
| Benard | $(i-0.3)/(n+0.4)$ |
| Mean | $i/(n+1)$ |
| Hazen | $(i-0.5)/n$ |
| Blom | $(i-3/8)/(n+1/4)$ |
| Exact median | Inverse Beta CDF at 0.5, parameters $i,n+1-i$ |

These standard formulas do not recover suspension-adjusted ranks or ties. Kaplan–Meier ranks come from the product-limit estimate.

### 3.6 Nonparametric survival and recurrent events

Standard exact-risk-set product-limit and Greenwood variance:

$$
\widehat R(t)=\prod_{t_j\le t}(1-d_j/n_j),\qquad
\widehat{\operatorname{Var}}[\widehat R(t)]
=\widehat R(t)^2\sum_{t_j\le t}\frac{d_j}{n_j(n_j-d_j)}.
$$

The tutorial also documents an actuarial interval-withdrawal adjustment using half the interval suspensions in the denominator. Keep that convention separate from exact event-time KM. The current mathematical reference implements exact risk sets, not that interval correction.

Nelson's standard MCF is $\widehat M(t)=\sum_{t_j\le t}d_j/Y_j$, where $Y_j$ counts observed systems and $d_j$ counts events or cost. Preserve unit identity and repeated repairs.

### 3.7 Growth models

Crow–AMSAA models counts, not a lifetime CDF:

$$
M(t)=\lambda t^\beta,\qquad \rho(t)=\lambda\beta t^{\beta-1}.
$$

Ordinary point-event, time-terminated NHPP MLE:

$$
\widehat\beta=\frac{n}{\sum_i\ln(T/t_i)},\qquad
\widehat\lambda=\frac{n}{T^{\widehat\beta}}.
$$

Grouped likelihood uses Poisson increments $\Delta M_j$. IEC corrections, occurrence-terminated cases and repeated-equipment variants are separate and not fully recovered. A Crow shape parameter and a Weibull shape parameter describe different data/model structures.

### 3.8 Uncertainty and comparison

General reference mathematics:

- Information matrix $I=-\partial^2\ell/\partial\theta\partial\theta^T$, covariance approximately $I^{-1}$, transformed variance approximately $\nabla g^T I^{-1}\nabla g$. This is not the exact three Fisher variants.
- LR region $2[\ell(\widehat\theta)-\ell(\theta)]\le\chi^2_{k,C}$ under the method's assumptions; `lr1`/`lr2` use one/two degrees of freedom.
- Set comparison $LR=2(\ell_{\rm separate}-\ell_{\rm pooled})$; Fulton Factor calibration remains proprietary/unrecovered.
- Exact binomial bounds invert Beta CDFs with explicit endpoint/sidedness conventions.
- Parametric/pivotal simulation must reproduce the observation scheme and refit the model; refit failures are part of the algorithm.
- Assurance is the locus where requested reliability equals confidence.

Boundary weights, unidentified mixture components, or freely shifted models may violate ordinary LR regularity. Choosing an independent bootstrap calibration is a new design decision, not evidence for SuperSMITH's proprietary correction.

### 3.9 Forecasting, replacement and demonstration

For a survivor aged $a$, first-failure probability over $\Delta$ is $q=1-R(a+\Delta)/R(a)$. Summing these probabilities gives expected first failures in a fixed fleet, not a complete renewal forecast or probability of at least one event.

Standard age-replacement theory:

$$
C(\tau)=\frac{C_fF(\tau)+C_pR(\tau)}{\int_0^\tau R(u)\,du},
\qquad
MTBF_{\rm failures}=\frac{\int_0^\tau R(u)\,du}{F(\tau)}.
$$

These assume identically distributed new lives after replacement and the stated costs. The application's quadrature, cost options and renewal rules remain unresolved.

Zero-failure Weibull test duration, known shape:

$$
t=\eta\left[\frac{-\ln(1-C)}n\right]^{1/\beta}.
$$

Distribution-free zero-failure demonstration requires
$n=\lceil\ln(1-C)/\ln R_{\rm required}\rceil$.
Fixed-time independent tests allowing $k$ failures use a binomial acceptance sum. Stopping rules and withdrawals require separate treatment.

For independent identical system components: series $R_i^N$; parallel $1-(1-R_i)^N$; $k$-of-$N$, $\sum_{j=k}^N{N\choose j}R_i^j(1-R_i)^{N-j}$. These do not represent common-cause failure or repairable availability.

<a id="native"></a>

## 4. Recovered native code and supplied sample code

| Diagnostic identity | Start VA | Original file offset | Bytes | Code |
| --- | --- | --- | --- | --- |
| `fdWblCdf` | `0xe90e20` | `0xa90e20` | 1920 | [weibull_cdf.asm](analysis/binary/weibull_cdf.asm) |
| `fd1mExp` | `0xe83aa0` | `0xa83aa0` | 784 | [one_minus_exp.asm](analysis/binary/one_minus_exp.asm) |
| `fdCDF2WPlotY` | `0xe915a0` | `0xa915a0` | 336 | [weibull_plot_transform.asm](analysis/binary/weibull_plot_transform.asm) |
| `fdLn1Mx` | `0xe89b20` | `0xa89b20` | 1440 | [ln_one_minus_x.asm](analysis/binary/ln_one_minus_x.asm) |
| `fdNormCDF routine:` | `0xe8a8a0` | `0xa8a8a0` | 1984 | [normal_cdf.asm](analysis/binary/normal_cdf.asm) |
| `fdNormZ` | `0xe8b060` | `0xa8b060` | 2352 | [normal_quantile.asm](analysis/binary/normal_quantile.asm) |

The ELF `.o` wrappers contain unchanged executable byte slices at the original addresses. They are analysis containers, not shipped files. Synthetic object symbols are not original source symbols. Calls outside each slice remain external.

### 4.1 Actual Weibull instructions

```asm
0x00e90f73  fld   QWORD PTR [ecx]       ; t
0x00e90f75  fsub  QWORD PTR [edx]       ; t - t0
0x00e90f83  fdiv  QWORD PTR [eax]       ; (t - t0) / eta
0x00e90fa1  call  DWORD PTR [0x401368]  ; __vbaPowerR8; beta pushed earlier
0x00e90fa7  fchs                       ; -((t-t0)/eta)^beta
0x00e90fa9  fstp  QWORD PTR [ebp-0x30] ; W
```

Parameter names in the comments are analyst interpretations. The named power import is at IAT VA `0x401368`. See [weibull_cdf.asm](analysis/binary/weibull_cdf.asm), lines 89–175 and the later probability branches.

### 4.2 Detailed recovered arithmetic and limits

The following retained notes include the exact native locations, small-argument continued fraction, normal approximation boundaries, and unimplemented error paths. Whitespace formatting is retained from the investigation.

```text
STATIC NATIVE MATH FINDINGS

Scope and provenance
The original artifact is analysis/extracted/smithw.exe, SHA-256
3ac018a75541d47f7975bc04afcb71d285158025354371aa078542184f6aa19a.
The file contains native Intel x86 instructions using VB6 runtime imports;
there are no COFF source/function symbols. The .text mapping in the original
PE is VA = file offset + 0x400000 for all slices below. Original VB source
filenames, line numbers, parameter names and source code have not been recovered.

The *.asm files are local GNU objdump output plus analyst comments naming
imports and decoding constant doubles from the original image. ELF *.o wrappers
contain unchanged byte slices mapped at the original VA; they are analysis
artifacts, not original shipped files. The wrapper-relative synthetic symbol
names in objdump are NOT original software symbols. The manifest records the
original file identity, exact offsets, raw hashes, and wrapper hashes. Parent
REA inspection of wrappers should be read together with this provenance.

1. Weibull 2P/3P CDF
Containing native routine: VA 0xe90e20..0xe915a0 (end exclusive), file offset
0xa90e20, length1920. Diagnostic string fdWblCdf at original file offset
0xbb020 / VA0x4bb020 is referenced by mov edx,0x4bb020 at VA0xe914db.

Nominal interior arithmetic:
  W = -((t-t0)/eta)^beta
  F(t) = 1-exp(W)

Observed 3P division/power: VA0xe90f63..0xe90fa9 (weibull_cdf.asm line89).
Observed 2P division/power: VA0xe91042..0xe91083 (line151).
__vbaPowerR8 is a named import, IAT VA0x401368; call at0xe9107b (line171).
The t,eta,beta,t0 names above are analyst meanings inferred from the operands
and diagnostic identity; original compiled arguments are by-reference pointers
at [ebp+8], [ebp+0xc], [ebp+0x10], [ebp+0x14].

Numerical detail: the routine also calculates beta*(log10(t-t0)-log10(eta)),
and multiplies by ln(10)=2.30258509299405 for an output plotting ordinate.
It selects the fd1mExp helper via call0xe9119f for log10(q)>-4, q=-W.
For smaller q it uses a series, an even smaller-probability first term, and
scientific-notation string handling. The series recurrence is visible at
0xe912bd..0xe91322: term*=W/n; stop when sum+term==sum; otherwise sum+=term.
The loop bound is100 terms. Reconstructed_math.py deliberately represents only
the interior formula and helper, not every tiny-probability or error path.
The original shift check uses |t0|>1e-5; boundary behavior for t<=t0 is not
fully reconstructed and should not be claimed to match an idealized CDF.

2. Accurate 1-exp(x) helper
Routine VA0xe83aa0..0xe83db0; diagnostic fd1mExp string VA0x4ba7b8,
reference instruction VA0xe83d2e. Detailed arithmetic is in one_minus_exp.asm
line61 onward and reconstructed_math.py line26.

For |x|>0.01, it computes 1-exp(x). For |x|<=0.01, the stored constants and
floating-point operations implement this continued fraction:
  d = 14 + x*x/18
  d = 10 + x*x/d
  d = 6 + x*x/d
  d = 2 - x + x*x/d
  result = -2*x/d
This avoids subtraction cancellation near zero. The original runtime import
used for exp is recorded by ordinal586 (IAT0x40103c); its role is inferred
from the numerical algorithm/diagnostic naming, not a named PE import.

3. Weibull plotting transform
Routine VA0xe915a0..0xe916f0; diagnostic fdCDF2WPlotY atVA0x4bb048,
reference0xe91677. The core (weibull_plot_transform.asm line47) calls
fdLn1Mx(p) at0xe89b20, changes its sign, then calls runtime ordinal587
atIAT0x401048. The inferred mathematical operation is ln(-ln(1-p)).
The fdLn1Mx routine is retained separately; not every numeric safeguard in it
has been translated. A generic log1p substitute is marked as such in the
Python normal-quantile translation.

4. Standard normal CDF
Routine VA0xe8a8a0..0xe8b060; label fdNormCDF routine: atVA0x4bad48,
reference0xe8af41. See normal_cdf.asm and reconstructed_math.py line49.
Observed domain clipping: z>10 ->1; z<-37 ->0.
Set a=abs(z), E=exp(-a*a/2), phi=0.398942280401433*E.

For a<=5.03, Q(a)=E*P6(a)/P7(a), using Horner evaluation. Coefficients
are directly read from original doubles atVA0x4560b8..0x456088 for P6
(descending address = descending polynomial degree), and0x456080..0x456048
for P7. Full values are annotated in normal_cdf.asm.

For 5.03<a<=8, the denominator is initialized as
  d=a+5.55776850037765/(a+2.50440865608421)
then d=a+3.03675451056799/d; d=a+2.00053522446876/d;
d=a+1.00000184225207/d; Q=phi/d.
For a>8, substitute constants4.57862024689392,1.55374860627633,
3.00540899739,2.00002630497464,1.00000002624654 respectively.
Finally Phi(z)=1-Q(a) when z>0, otherwise Q(a).

5. Standard normal quantile
Routine VA0xe8b060..0xe8b990; fdNormZ label atVA0x4bad9c referenced0xe8b7c7.
See normal_quantile.asm and reconstructed_math.py line74. The executable
uses piecewise rational polynomials with constants read directly from the
original image, not iterative root-finding in this routine.

For .075<p<=.925, q=p-.5, r=.180625-q*q, z=q*A7(r)/B7(r).
For upper tail .925<p<=.99999999999, r=sqrt(-ln(1-p))-1.6 and z=C7(r)/D7(r).
For p>.99999999999, r=sqrt(-ln(1-p))-5 and z=E7(r)/F7(r).
The lower tail uses sqrt(-ln(p))-1.6 for1e-11<p<=.075 and
sqrt(-ln(p))-5 below that, with corresponding negative sign.
The source coefficient address ranges and exact Horner order are executable
in reconstructed_math.py. Input rejection, Variant conversion, original
logarithm helper details, and error/logging paths are not emulated.

Verification limits
math-translation-checks.json compares the analyst translations against Python
math.expm1/scipy.special.ndtr/ndtri:401 helper points,1010 CDF points,701
quantile points. Max absolute errors are1.7347e-18,1.1102e-16,2.1316e-14.
This validates the arithmetic reconstruction, NOT runtime execution of the
SuperSMITH application or every caller/analysis method.

Additional location index
diagnostic-code-locations.tsv records125 exact diagnostic/string references,
including WeibayesCalc (containing frame0xcc3730), DuaneMle (0xc2ea10),
MleSolve (0xea5880), and MDMLE (0xf33370). These are navigation candidates
with explicit evidence status, not proof that their complete mathematical
implementation has been recovered. Generic UI strings can have many callers.
```

### 4.3 Readable translation

The following is the complete retained arithmetic translation before its test runner. It is not original VB6 source. Appendix C embeds the coefficient values, so a new implementation can store those values directly instead of reading this particular executable. The original input conversion, errors and x87 evaluation are not reproduced.

```python
"""Analyst translation of selected native arithmetic, NOT original VB source.

Normal CDF/quantile coefficients are read directly from smithw.exe. This
translation omits the VB error/logging/Variant conversion paths and emulates
arithmetic in Python binary64 rather than the original x87 environment.
It is not evidence that the application was executed.
"""
from pathlib import Path
import math
import struct
import json

EXE = Path(__file__).resolve().parents[1]/'extracted/smithw.exe'
BINARY = EXE.read_bytes()

def d(va):
    return struct.unpack_from('<d', BINARY, va-0x400000)[0]

def poly(start, end, x, final_one=False):
    """Horner evaluation of the descending-address coefficient sequence."""
    value = d(start)
    for address in range(start-8, end-1, -8):
        value = value*x + d(address)
    return value*x+1 if final_one else value

def one_minus_exp(x):
    """fd1mExp interior numeric path, VA 0xe83b64..0xe83ce4."""
    if abs(x) > .01:
        return 1-math.exp(x)
    xx = x*x
    denominator = 14 + xx/18
    denominator = 10 + xx/denominator
    denominator = 6 + xx/denominator
    denominator = 2 - x + xx/denominator
    return -2*x/denominator

def weibull_cdf_interior(t, eta, beta, t0=0):
    """Core interior formula; not an emulation of all fdWblCdf branches.

    The binary additionally has shift tolerance, very small probability
    series/string branches, output plot ordinate, and VB error handling.
    3P arithmetic: VA 0xe90f63..0xe90fa9.
    2P arithmetic: VA 0xe91042..0xe91083.
    fd1mExp call: 0xe9119f (selected by log10(q) > -4).
    """
    q = ((t-t0)/eta)**beta
    return one_minus_exp(-q)

def normal_cdf(z):
    """fdNormCDF numeric path, VA 0xe8a965..0xe8adbf."""
    if z > 10:
        return 1.
    if z < -37:
        return 0.
    x = abs(z)
    exponent = math.exp(-.5*x*x)
    phi = exponent*d(0x456118)
    if x > 8:
        den = x + d(0x456108)/(x+d(0x456110))
        den = x + d(0x456100)/den
        den = x + d(0x4560f8)/den
        den = x + d(0x4560f0)/den
        tail = phi/den
    elif x > 5.03:
        den = x + d(0x4560d8)/(x+d(0x4560e0))
        den = x + d(0x4560d0)/den
        den = x + d(0x4560c8)/den
        den = x + d(0x4560c0)/den
        tail = phi/den
    else:
        tail = exponent*poly(0x4560b8,0x456088,x)/poly(0x456080,0x456048,x)
    return 1-tail if z>0 else tail

def normal_quantile(p):
    """fdNormZ interior piecewise rational calculation, VA e8b1ea..e8b774.

    Uses math.log1p for the upper-tail log; original code calls fdLn1Mx.
    This does not emulate the original input validation/error pathways.
    """
    if not 0 < p < 1:
        raise ValueError('interior reconstruction requires 0 < p < 1')
    if p > .99999999999:
        r=math.sqrt(-math.log1p(-p))-5
        return poly(0x456388,0x456350,r)/poly(0x456348,0x456318,r,True)
    if p > .925:
        r=math.sqrt(-math.log1p(-p))-1.6
        return poly(0x456308,0x4562d0,r)/poly(0x4562c8,0x456298,r,True)
    if p > .075:
        q=p-.5
        r=.180625-q*q
        return q*poly(0x456280,0x456248,r)/poly(0x456240,0x456210,r,True)
    if p > 1e-11:
        r=math.sqrt(-math.log(p))-1.6
        return -poly(0x456308,0x4562d0,r)/poly(0x4562c8,0x456298,r,True)
    r=math.sqrt(-math.log(p))-5
    return -poly(0x456388,0x456350,r)/poly(0x456348,0x456318,r,True)
```

### 4.4 Actual shipped sample code

```vb
Randomize Timer
For iwi% = 1 To iwin%
    iwrand = Rnd()
    iweta = iweta0
    iw = iweta * (-Log(iwrand)) ^ (1 / iwbeta)
    iwtotaltime1 = iwtotaltime1 + iw
Next iwi%
```

This samples $T=\eta(-\ln U)^{1/\beta}$, with sample settings `beta=3`, `eta0=1000`, `N=100`. Additional scenarios vary scale as `eta0+i*eta0/(0.5*N)` and `eta0-i*eta0/(1.1*N)`, then accumulate event times. Changing scales do not automatically define an identically distributed renewal process.

Sources: [standalone VBA text](smithdat/Monte-Carlo-of-Simple-Weibull-in-Excel-Macro-Code.txt) and [Module1](analysis/reference/mc-Module1.bas), lines 23–43. Module1 was extracted from `mc.xlsm -> xl/vbaProject.bin -> VBA/Module1`, compressed source offset `0xD67` inside that stream. This is tutorial code, not application source.

### 4.5 Native REA evidence IDs

**weibull_cdf:** complete observation `ev_c5c587a0b74733677cefc4cf1544f9973c4a007819c6dfebf91436a9620c40c1`; summary view `ev_ea305f71cb9c7ec0813e4915c0789461e6144f82445d36bae36879f4251e4585`; input [weibull_cdf.o](analysis/binary/weibull_cdf.o).

**one_minus_exp:** complete observation `ev_0c31004808fb575a5fa7b6b561ce502d81d0b962b25b27605681cf247310d5b5`; summary view `ev_7503d85eed2e06d6514fb41e182c3383a94b454bcbdeb79b53190ec84ba14585`; input [one_minus_exp.o](analysis/binary/one_minus_exp.o).

**weibull_plot_transform:** complete observation `ev_7b58b953db8d3a8c5b6e7698d605946b61589423080de0696e61cbc3ed6fb671`; summary view `ev_3585e4e56d1f2795c5bf6cc471af164cde5826764cd7b2601b1476ed4857ced2`; input [weibull_plot_transform.o](analysis/binary/weibull_plot_transform.o).

**ln_one_minus_x:** complete observation `ev_db03fc26d41c14345f06ad4184380525ac5762ba24293d9d1e4e93480b1d4ace`; summary view `ev_f80f4e2338bb133554f672f04253dd524cee3026ec8d31c67a8ff9c792c1b23e`; input [ln_one_minus_x.o](analysis/binary/ln_one_minus_x.o).

**normal_cdf:** complete observation `ev_1bc52834f96a083d43ba2bf5d9a2c1bfd566ea5aba27f95c951bef8f973af2d4`; summary view `ev_2515045ffc594434cd48c9224f3ce0b2620b05c28a4510e96f5dfe38e20bdbc8`; input [normal_cdf.o](analysis/binary/normal_cdf.o).

**normal_quantile:** complete observation `ev_845f5d444fec9115696e6f65c822f40f723fb5c1395f6976ae8af39ef33887ab`; summary view `ev_5868f1f9cf50c8d25d3b654758aff4d480b1f73e224c265ce51d8f878eb013f9`; input [normal_quantile.o](analysis/binary/normal_quantile.o).

<a id="catalog"></a>

## 5. Complete method catalog

Entries preserve the stable IDs from the retained inventory. A documented algorithm may still have an undisclosed optimizer, finite-sample correction or boundary convention. “Reference algebra” remains an independent interpretation, not exact executable recovery.

Unimplemented and theoretical entries are retained to prevent a described model from being mistaken for a shipped solver. Method IDs can be used as implementation issue or test-plan references.

### Distributions

<a id="method-m001"></a>

#### M001 — Weibull 2-parameter

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
W=-(t/eta)^beta; w=(beta/t)W; F=1-exp(W); f=-w exp(W); h=-w; Bp=eta[-ln(1-p)]^(1/beta)
```

**Limits and unresolved details:** Positive support; branch handling at t=0 is not exposed in help.

**Source:** bundled help [lines 2999-3021](analysis/sources-help.html#L2999). Original `sshelp.ztf` physical lines: `125574-125616`; byte ranges `[start,end)`: `3448169-3451290`.

<a id="method-m002"></a>

#### M002 — Weibull 3-parameter

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
F=1-exp(-((t-t0)/eta)^beta); Bp=t0+eta[-ln(1-p)]^(1/beta); search t0 maximizing correlation or likelihood
```

**Limits and unresolved details:** Requires support t>t0; exact search tolerances undisclosed.

**Source:** bundled help [lines 3022-3030](analysis/sources-help.html#L3022), [lines 1557-1560](analysis/sources-help.html#L1557). Original `sshelp.ztf` physical lines: `125619-125749;91321-91327`; byte ranges `[start,end)`: `3451296-3458112;2406231-2407961`.

<a id="method-m003"></a>

#### M003 — Exponential

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Beta=1; F=1-exp(-t/eta); f=exp(-t/eta)/eta; lambda=1/eta
```

**Limits and unresolved details:** Calculator prose has erroneous exp(-f/T); dedicated model and example imply exp(-f*T).

**Source:** bundled help [lines 2829-2855](analysis/sources-help.html#L2829), [lines 855-857](analysis/sources-help.html#L855). Original `sshelp.ztf` physical lines: `122145-122181;80382-80386`; byte ranges `[start,end)`: `3373571-3375847;2029350-2030077`.

<a id="method-m004"></a>

#### M004 — Rayleigh

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Beta=2; F=1-exp(-(t/eta)^2); f=2t exp(-(t/eta)^2)/eta^2
```

**Limits and unresolved details:** Uses Weibull eta parameterization, not the alternative Rayleigh sigma parameterization.

**Source:** bundled help [lines 2982-2996](analysis/sources-help.html#L2982). Original `sshelp.ztf` physical lines: `125537-125564`; byte ranges `[start,end)`: `3446164-3447777`.

<a id="method-m005"></a>

#### M005 — Normal

**Documented status:** provided. **Evidence basis:** A.

**Mathematics or documented algorithm:**

```text
F=Phi((t-mu)/sigma), f=phi((t-mu)/sigma)/sigma
```

**Limits and unresolved details:** Standard form from named model and documented scaling; equation graphics omitted by text extractor. CDF numeric approximation code not disclosed.

**Source:** bundled help [lines 638-653](analysis/sources-help.html#L638), [lines 2929-2934](analysis/sources-help.html#L2929). Original `sshelp.ztf` physical lines: `68373-68397;125339-125475`; byte ranges `[start,end)`: `1813460-1817722;3433537-3441010`.

<a id="method-m006"></a>

#### M006 — Lognormal and optional t0

**Documented status:** provided. **Evidence basis:** A.

**Mathematics or documented algorithm:**

```text
z=(ln(t-t0)-ln(Med))/ln(SigF); F=Phi(z); f=phi(z)/((t-t0)ln(SigF)); Med=exp(muLog), SigF=exp(sigmaLog)
```

**Limits and unresolved details:** SigF>1. Standard normalized form; help equation graphics omitted.

**Source:** bundled help [lines 2915-2928](analysis/sources-help.html#L2915), [lines 1586](analysis/sources-help.html#L1586). Original `sshelp.ztf` physical lines: `122289-125333;91379-91379`; byte ranges `[start,end)`: `3384061-3433516;2417333-2418270`.

<a id="method-m007"></a>

#### M007 — Gumbel lower

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
z=(t-Xi)/Del; F=1-exp(-exp(z)); f=exp(z-exp(z))/Del; Bp=Xi+Del ln(-ln(1-p))
```

**Limits and unresolved details:** Xi is location despite shape-factor wording in model section; Del>0.

**Source:** bundled help [lines 2856-2870](analysis/sources-help.html#L2856). Original `sshelp.ztf` physical lines: `122184-122211`; byte ranges `[start,end)`: `3375859-3377246`.

<a id="method-m008"></a>

#### M008 — Gumbel upper

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
z=(t-Xi)/Del; F=exp(-exp(-z)); f=exp(-z-exp(-z))/Del; Bp=Xi-Del ln(-ln(p))
```

**Limits and unresolved details:** Del>0.

**Source:** bundled help [lines 2871-2879](analysis/sources-help.html#L2871). Original `sshelp.ztf` physical lines: `122214-122237`; byte ranges `[start,end)`: `3377261-3378394`.

<a id="method-m009"></a>

#### M009 — WeiBayes fixed-beta Weibull

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Fix beta and solve eta by MLE; icon produces marker line; equation-label route also supports regression/grouped/interval fits
```

**Reference algebra / interpretation — not exact executable recovery:**

Known β, r failures: η̂=(Σ_all tᵢ^β/r)^(1/β). With zero failures, lower confidence C: ηL=(Σtᵢ^β/[-ln(1-C)])^(1/β). Nonzero-failure confidence conventions remain unrecovered.

**Limits and unresolved details:** With failures confidence uses Nelson chi-square; with zero failures confidence uses Weibayes appendix; exact confidence formula not printed.

**Source:** bundled help [lines 1576-1585](analysis/sources-help.html#L1576), [lines 2997-2998](analysis/sources-help.html#L2997). Original `sshelp.ztf` physical lines: `91361-91377;125569-125571`; byte ranges `[start,end)`: `2411046-2417330;3447795-3448163`.

<a id="method-m010"></a>

#### M010 — WeiBest zero-failure median

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
WeiBayes zero-failure calculation with confidence=50%; 63.2% corresponds to one imminent failure
```

**Reference algebra / interpretation — not exact executable recovery:**

WeiBest sets C=0.5 in ηL=(Σtᵢ^β/[-ln(1-C)])^(1/β).

**Limits and unresolved details:** Not an additional probability family.

**Source:** bundled help [lines 1581](analysis/sources-help.html#L1581). Original `sshelp.ztf` physical lines: `91369-91369`; byte ranges `[start,end)`: `2413354-2415331`.

<a id="method-m011"></a>

#### M011 — LogNormalB fixed-SigF

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Fix SigF from prior analysis and solve Med; same label route as one-parameter Weibayes
```

**Reference algebra / interpretation — not exact executable recovery:**

ln(T-t₀)~N(μ,σ²), σ=ln(SigF) fixed; optimize μ only. For complete data, μ̂=mean ln(tᵢ-t₀), Med=exp(μ̂). Censored data require likelihood optimization.

**Limits and unresolved details:** SigF must exceed one.

**Source:** bundled help [lines 1586](analysis/sources-help.html#L1586). Original `sshelp.ztf` physical lines: `91379-91379`; byte ranges `[start,end)`: `2417333-2418270`.

### Fitting

<a id="method-m012"></a>

#### M012 — Rank regression rr

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Least squares on transformed probability plot; default X-on-Y for precise data; Y-on-X for grouped
```

**Reference algebra / interpretation — not exact executable recovery:**

For Weibull Xᵢ=ln(tᵢ-t₀), Yᵢ=ln[-ln(1-pᵢ)]. Let Sxy=Σ(X-X̄)(Y-Ȳ). X-on-Y slope b=Sxy/Syy; β=1/b, ln η=X̄-bȲ.

**Limits and unresolved details:** Original exact rank-adjustment/censoring routine not disclosed.

**Source:** bundled help [lines 1229-1230](analysis/sources-help.html#L1229), [lines 3197-3217](analysis/sources-help.html#L3197). Original `sshelp.ztf` physical lines: `90837-90839;126645-127930`; byte ranges `[start,end)`: `2350021-2351224;3513223-3572967`.

<a id="method-m013"></a>

#### M013 — Special rank regression rrs

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Reverse standard regression direction: precise data Y-on-X, grouped data X-on-Y
```

**Reference algebra / interpretation — not exact executable recovery:**

Y-on-X: β=Sxy/Sxx; intercept a=Ȳ-βX̄; η=exp(-a/β). The program reverses default direction for the special mode.

**Limits and unresolved details:** Help's inspect-direction wording is inconsistent with default inspect paragraph.

**Source:** bundled help [lines 1257](analysis/sources-help.html#L1257). Original `sshelp.ztf` physical lines: `90880-90880`; byte ranges `[start,end)`: `2357311-2357969`.

<a id="method-m014"></a>

#### M014 — Benard median-rank plotting position

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
p=(i-0.3)/(n+0.4) for complete sample
```

**Limits and unresolved details:** Censored adjusted ranks need separate algorithm not printed here.

**Source:** bundled help [lines 1906-1908](analysis/sources-help.html#L1906), [lines 1230](analysis/sources-help.html#L1230). Original `sshelp.ztf` physical lines: `92551-92554;90839-90839`; byte ranges `[start,end)`: `2490115-2490947;2350350-2351224`.

<a id="method-m015"></a>

#### M015 — Exact binomial median; mean; Hazen; Blom; Kaplan-Meier ranks

**Documented status:** provided. **Evidence basis:** U.

**Mathematics or documented algorithm:**

```text
Selectable br,mr,hr,nr,kr plotting positions; default Benard rr
```

**Reference algebra / interpretation — not exact executable recovery:**

Uncensored ranks: mean i/(n+1); Hazen (i-0.5)/n; Blom (i-3/8)/(n+1/4); exact median BetaCDF⁻¹(0.5;i,n+1-i). These standard equations do not recover suspension-adjusted ranks, ties, or numeric quantile evaluation.

**Limits and unresolved details:** Help names methods but does not print all rank formulas.

**Source:** bundled help [lines 1195-1201](analysis/sources-help.html#L1195), [lines 1230](analysis/sources-help.html#L1230), [lines 993-994](analysis/sources-help.html#L993). Original `sshelp.ztf` physical lines: `90790-90796;90839-90839;84457-84458`; byte ranges `[start,end)`: `2344390-2344603;2350350-2351224;2141628-2141882`.

<a id="method-m016"></a>

#### M016 — Maximum likelihood

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Iteratively maximize probability/density of observed failures and surviving censor times; log formulation
```

**Reference algebra / interpretation — not exact executable recovery:**

ℓ(θ)=Σ_failure ln fθ(tᵢ)+Σ_right-censored ln[1-Fθ(cᵢ)]. θ̂ maximizes ℓ. For 2P Weibull, η̂^β=Σ_all tᵢ^β/r and 1/β+mean_failure ln(t)-[Σ_all tᵢ^β ln(tᵢ)]/[Σ_all tᵢ^β]=0.

**Limits and unresolved details:** General likelihood equation is a picture; optimizer and stopping tolerances not disclosed.

**Source:** bundled help [lines 1231](analysis/sources-help.html#L1231), [lines 3218-3228](analysis/sources-help.html#L3218). Original `sshelp.ztf` physical lines: `90841-90841;127932-138985`; byte ranges `[start,end)`: `2351227-2352344;3572970-3712215`.

<a id="method-m017"></a>

#### M017 — RBA median/mean, Barringer, normal corrections

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
C4=sqrt(2/(N-1))*Gamma(N/2)/Gamma((N-1)/2); Weibull/Gumbel slope factors C4^3.5 (median), C4^6 (mean), C4^3.52 (Barringer); Barringer intercept C4^-0.217; normal sigma factor sqrt(N/(N-1))/C4; optional sqrt(N/(N-1))
```

**Limits and unresolved details:** Gamma notation is algebraic conversion of printed half-integer factorials; N counts failures/intervals/discoveries, not suspensions. Legacy factors have censoring limitations.

**Source:** bundled help [lines 1221](analysis/sources-help.html#L1221), [lines 1232-1237](analysis/sources-help.html#L1232), [lines 3248](analysis/sources-help.html#L3248). Original `sshelp.ztf` physical lines: `90824-90824;90843-90850;143479-143479`; byte ranges `[start,end)`: `2346915-2348372;2352347-2352764;3929348-3929664`.

<a id="method-m018"></a>

#### M018 — RBAjjm

**Documented status:** provided/default. **Evidence basis:** U.

**Mathematics or documented algorithm:**

```text
Adjust MLE beta and eta for small sample bias including suspensions
```

**Limits and unresolved details:** Explicitly proprietary; exact adjustment equation not disclosed in help.

**Source:** bundled help [lines 1222](analysis/sources-help.html#L1222), [lines 3238-3241](analysis/sources-help.html#L3238). Original `sshelp.ztf` physical lines: `90826-90826;143243-143249`; byte ranges `[start,end)`: `2348375-2348647;3916283-3918246`.

<a id="method-m019"></a>

#### M019 — JLF justified likelihood

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Approximate JLF=L(x,p1,p2/RBA)^FF/[L(x,p1hat,(p2/RBA)hat)^(FF-1) exp(Vjllf)]
```

**Limits and unresolved details:** Fulton Factor and Vjllf correction values not disclosed; approximation only.

**Source:** bundled help [lines 1238-1245](analysis/sources-help.html#L1238). Original `sshelp.ztf` physical lines: `90852-90861`; byte ranges `[start,end)`: `2352767-2353552`.

<a id="method-m020"></a>

#### M020 — Sherwin inspection option 1

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
For each tied inspection time retain only highest plotting-position point in tie stack, then regress
```

**Reference algebra / interpretation — not exact executable recovery:**

Retain the top cumulative plotting position for each group tied at an inspection time, then regress the transformed coordinates. This treats the recorded time as an upper bound.

**Limits and unresolved details:** Assumes true times rounded up to inspection time.

**Source:** bundled help [lines 1246](analysis/sources-help.html#L1246). Original `sshelp.ztf` physical lines: `90863-90863`; byte ranges `[start,end)`: `2353555-2354555`.

<a id="method-m021"></a>

#### M021 — Probit grouped count (prob2) and percent (prob3)

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Plot cumulative failure proportions rather than median ranks; count mode p=d/n, percentage mode user provides p; fit transformed regression
```

**Reference algebra / interpretation — not exact executable recovery:**

At inspection tⱼ use pⱼ=dⱼ/nⱼ (or supplied cumulative percentage), transform through the chosen distribution probability scale, and regress. No standard-normal-only restriction is implied by the name Probit.

**Limits and unresolved details:** Same-item and destructive independent inspection have different count interpretations.

**Source:** bundled help [lines 1248-1255](analysis/sources-help.html#L1248). Original `sshelp.ztf` physical lines: `90867-90876`; byte ranges `[start,end)`: `2354985-2357102`.

<a id="method-m022"></a>

#### M022 — Interval MLE (intv5)

**Documented status:** provided. **Evidence basis:** A.

**Mathematics or documented algorithm:**

```text
Likelihood contributions: exact f(t), right-censored 1-F(t), left-censored F(t), interval F(b)-F(a), raised to frequency counts
```

**Reference algebra / interpretation — not exact executable recovery:**

Exact failure: ln f(t); right censor: ln[1-F(c)]; left-censored discovery: ln F(r); interval (l,r]: ln[F(r)-F(l)]. Sum terms, including frequency weights, and maximize. Numerical optimizer remains unknown.

**Limits and unresolved details:** Contributions are mathematical restatement of documented data semantics; numerical implementation not exposed.

**Source:** bundled help [lines 1331-1343](analysis/sources-help.html#L1331). Original `sshelp.ztf` physical lines: `90971-90987`; byte ranges `[start,end)`: `2363601-2366116`.

### Nonparametric

<a id="method-m023"></a>

#### M023 — Kaplan-Meier/product-limit

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
R_j=R_(j-1)*(n_j-d_j)/n_j; F_j=1-R_j; may subsequently fit continuous probit model to these estimates
```

**Limits and unresolved details:** Grouped actuarial option subtracts half suspensions from exposure count; not identical to exact-time KM.

**Source:** bundled help [lines 2880-2914](analysis/sources-help.html#L2880), [lines 1309-1313](analysis/sources-help.html#L1309). Original `sshelp.ztf` physical lines: `122239-122286;90943-90947`; byte ranges `[start,end)`: `3378403-3384049;2360652-2362000`.

### Diagnostics

<a id="method-m024"></a>

#### M024 — Correlation r; r-squared; CCC

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
CCC is 10th percentile of simulated correlation; compare r^2-CCC^2 or threshold r^2>=CCC^2
```

**Reference algebra / interpretation — not exact executable recovery:**

r=Sxy/√(Sxx Syy); simple linear r²=r×r. For nonlinear mixtures the documented interpretation is explained variation, not automatically this same formula.

**Limits and unresolved details:** Regression only; coefficient interpretation differs for nonlinear mixtures.

**Source:** bundled help [lines 1366-1374](analysis/sources-help.html#L1366), [lines 3255-3277](analysis/sources-help.html#L3255). Original `sshelp.ztf` physical lines: `91021-91036;143691-143729`; byte ranges `[start,end)`: `2369411-2372678;3939845-3945760`.

<a id="method-m025"></a>

#### M025 — pve goodness-of-fit approximation

**Documented status:** provided. **Evidence basis:** U.

**Mathematics or documented algorithm:**

```text
Model maps distribution/sample size/correlation to percentile of Monte Carlo correlation; anchored at pve=10 at CCC
```

**Limits and unresolved details:** Proprietary fitted approximation not printed.

**Source:** bundled help [lines 1363-1374](analysis/sources-help.html#L1363), [lines 3272-3277](analysis/sources-help.html#L3272). Original `sshelp.ztf` physical lines: `91015-91036;143718-143729`; byte ranges `[start,end)`: `2367916-2372678;3942969-3945760`.

<a id="method-m026"></a>

#### M026 — prr Monte Carlo goodness-of-fit

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
prr=100*(number of simulated correlations below observed correlation)/(simulation count)
```

**Reference algebra / interpretation — not exact executable recovery:**

Monte Carlo reference: simulate and refit B samples, compare observed fit statistic with the empirical distribution. Exact tail, ties, and finite-B correction remain software-specific.

**Limits and unresolved details:** Fresh simulations; documented simulated suspensions are Type II.

**Source:** bundled help [lines 1374](analysis/sources-help.html#L1374), [lines 3279](analysis/sources-help.html#L3279). Original `sshelp.ztf` physical lines: `91036-91036;143733-143733`; byte ranges `[start,end)`: `2372411-2372678;3945789-3946459`.

<a id="method-m027"></a>

#### M027 — Anderson-Darling pAD

**Documented status:** provided. **Evidence basis:** U.

**Mathematics or documented algorithm:**

```text
Compute A^2 from normalized empirical/theoretical probability distance and map to pAD; original 2P Weibull/Gumbel and modified normal/lognormal/3P variants
```

**Reference algebra / interpretation — not exact executable recovery:**

Standard complete-sample AD reference: A²=-n-(1/n)Σᵢ(2i-1){ln F(tᵢ)+ln[1-F(tₙ₊₁₋ᵢ)]}. The app’s fitted-parameter/censoring adjustment and pAD calibration are unknown.

**Limits and unresolved details:** No pAD for censored/discovery/interval data; exact adjustments not printed.

**Source:** bundled help [lines 1364-1370](analysis/sources-help.html#L1364), [lines 844](analysis/sources-help.html#L844). Original `sshelp.ztf` physical lines: `91017-91030;80361-80361`; byte ranges `[start,end)`: `2368563-2371843;2025320-2025538`.

<a id="method-m028"></a>

#### M028 — Distribution analysis and LRM

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Compare likelihood across 2P models; likelihood-ratio test for 3P versus best 2P; regression uses pve or r^2-CCC^2; LRM default 50%
```

**Limits and unresolved details:** Active life vs dimension model group governs candidates; normal optionally added to life models.

**Source:** bundled help [lines 1377-1413](analysis/sources-help.html#L1377), [lines 1226-1227](analysis/sources-help.html#L1226). Original `sshelp.ztf` physical lines: `91042-91104;90832-90833`; byte ranges `[start,end)`: `2373380-2380143;2349088-2349556`.

<a id="method-m029"></a>

#### M029 — Set/design comparison LR and modified LR

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
LR=2*(sum logL_separate-logL_merged); modified LR=FF*LR; compare to chi-square or compare confidence contours
```

**Limits and unresolved details:** FF formula not disclosed; pff is confidence/difference indication with high values indicating difference, not conventional upper-tail p.

**Source:** bundled help [lines 882-901](analysis/sources-help.html#L882). Original `sshelp.ztf` physical lines: `80430-80456`; byte ranges `[start,end)`: `2037194-2040741`.

<a id="method-m030"></a>

#### M030 — Mixture model selection

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Compare LL by chi-square LR with parameter-count difference; prefer lower complexity when improvement under threshold; require n_occurrence*u>=3
```

**Limits and unresolved details:** No LR on regression mixtures; equal-parameter models compared by LL. Check n*u safeguard rather than raw best LL alone.

**Source:** bundled help [lines 1414-1480](analysis/sources-help.html#L1414). Original `sshelp.ztf` physical lines: `91106-91190`; byte ranges `[start,end)`: `2380146-2389251`.

### Confidence

<a id="method-m031"></a>

#### M031 — Fisher matrix fm variants

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Use second partial derivatives of log likelihood/information matrix; variants original partial Gumbel, Weibull Full, Gumbel Full (standard)
```

**Reference algebra / interpretation — not exact executable recovery:**

General information-matrix principle: I(θ̂)=-∂²ℓ/∂θ∂θᵀ; Cov(θ̂)≈I⁻¹; Var[g(θ̂)]≈∇gᵀI⁻¹∇g. This does not specify the program’s three derivative/transform variants.

**Limits and unresolved details:** Exact algebra not printed; small-sample bias acknowledged.

**Source:** bundled help [lines 1513-1514](analysis/sources-help.html#L1513). Original `sshelp.ztf` physical lines: `91239-91240`; byte ranges `[start,end)`: `2393763-2395024`.

<a id="method-m032"></a>

#### M032 — Likelihood-ratio lr1/lr2 contours

**Documented status:** provided. **Evidence basis:** A.

**Mathematics or documented algorithm:**

```text
Contour 2*(logLhat-logL(theta))=chi2_quantile(confidence,df), df=1 or 2; JLF when RBA active
```

**Limits and unresolved details:** Exact contour traversal/tolerances not disclosed.

**Source:** bundled help [lines 1515-1516](analysis/sources-help.html#L1515). Original `sshelp.ztf` physical lines: `91242-91244`; byte ranges `[start,end)`: `2395027-2397473`.

<a id="method-m033"></a>

#### M033 — Beta-binomial bi and probit pr

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Binomial-derived bounds per occurrence/group; grouped bounds vertical, precise-data bounds horizontal
```

**Reference algebra / interpretation — not exact executable recovery:**

Standard exact binomial reference for d failures/n trials: pL=BetaCDF⁻¹(α/2;d,n-d+1), pU=BetaCDF⁻¹(1-α/2;d+1,n-d), with endpoint exceptions. The software’s rank-to-life and one/two-sided conventions remain unverified.

**Limits and unresolved details:** Exact quantile/endpoint conventions not printed.

**Source:** bundled help [lines 1517](analysis/sources-help.html#L1517), [lines 1521](analysis/sources-help.html#L1521). Original `sshelp.ztf` physical lines: `91246-91246;91254-91254`; byte ranges `[start,end)`: `2397476-2397947;2399333-2399487`.

<a id="method-m034"></a>

#### M034 — Monte Carlo mc and pivotal pv

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Simulate/refit distributions; percentile/pivotal confidence bounds for parameters and B-values; optional t0 re-estimation
```

**Limits and unresolved details:** Help details pv but not distinct mc pivot/algorithm; pv is only documented method including Weibull t0 uncertainty.

**Source:** bundled help [lines 1508-1523](analysis/sources-help.html#L1508). Original `sshelp.ztf` physical lines: `91229-91258`; byte ranges `[start,end)`: `2391010-2400344`.

<a id="method-m035"></a>

#### M035 — Normal regression nr

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Regression residual percentile standard deviations with Student-t statistic
```

**Reference algebra / interpretation — not exact executable recovery:**

General regression reference: prediction/mean-fit uncertainty uses residual standard error and a Student-t quantile; the exact percentile variance and degrees-of-freedom convention are not recovered.

**Limits and unresolved details:** Complete normal samples only, no suspensions.

**Source:** bundled help [lines 1520](analysis/sources-help.html#L1520). Original `sshelp.ztf` physical lines: `91252-91252`; byte ranges `[start,end)`: `2399094-2399330`.

<a id="method-m036"></a>

#### M036 — Greenwood gw

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Kaplan-Meier confidence based on Greenwood variance
```

**Reference algebra / interpretation — not exact executable recovery:**

Standard Greenwood variance: Var[R̂(t)]≈R̂(t)²Σ_{tⱼ≤t} dⱼ/[nⱼ(nⱼ-dⱼ)]. App interval correction, confidence transform, and endpoint handling remain unknown.

**Limits and unresolved details:** Explicit variance formula not printed.

**Source:** bundled help [lines 1522](analysis/sources-help.html#L1522). Original `sshelp.ztf` physical lines: `91256-91256`; byte ranges `[start,end)`: `2399490-2399671`.

<a id="method-m037"></a>

#### M037 — Assurance

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Locus of points with reliability level equal to confidence level
```

**Limits and unresolved details:** Depends on selected distribution, fit and confidence method.

**Source:** bundled help [lines 1528](analysis/sources-help.html#L1528). Original `sshelp.ztf` physical lines: `91268-91268`; byte ranges `[start,end)`: `2402072-2402747`.

<a id="method-m038"></a>

#### M038 — PLRD partial likelihood ratio density

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Assign fractional weights to parameter pairs on likelihood grid inside confidence region
```

**Reference algebra / interpretation — not exact executable recovery:**

Generic grid normalization would be wⱼ=L(θⱼ)/ΣL(θₖ), but this is not established as the program’s PLRD rule; do not substitute it for the unresolved implementation.

**Limits and unresolved details:** Normalization and grid rules not disclosed; partial since bounded parameter range.

**Source:** bundled help [lines 1524](analysis/sources-help.html#L1524). Original `sshelp.ztf` physical lines: `91260-91260`; byte ranges `[start,end)`: `2400347-2401102`.

### Mixtures

<a id="method-m039"></a>

#### M039 — SSW partition 4P wm

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Split ordered data; observations on other side become suspensions; choose partition by likelihood; F=1-(1-F1)(1-F2)
```

**Limits and unresolved details:** Distinct partition fitting strategy from YBath joint fit; help warns suspensions can count in both groups.

**Source:** bundled help [lines 1702-1704](analysis/sources-help.html#L1702), [lines 3115-3120](analysis/sources-help.html#L3115). Original `sshelp.ztf` physical lines: `92229-92233;125889-125899`; byte ranges `[start,end)`: `2444842-2446021;3469421-3470738`.

<a id="method-m040"></a>

#### M040 — YBath 4P competing risk

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
F=1-exp(W1+W2); f=-(w1+w2)exp(W1+W2); h=-(w1+w2)
```

**Limits and unresolved details:** Fits rr,rrs,MLE; two beta and two eta values.

**Source:** bundled help [lines 3121-3136](analysis/sources-help.html#L3121), [lines 1706](analysis/sources-help.html#L1706). Original `sshelp.ztf` physical lines: `125902-126030;92237-92237`; byte ranges `[start,end)`: `3470744-3477979;2446553-2447505`.

<a id="method-m041"></a>

#### M041 — YBath 5P competing risk plus susceptible batch

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
F=1-u exp(W1+W2)-(1-u)exp(W2); f=-u(w1+w2)exp(W1+W2)-(1-u)w2 exp(W2)
```

**Limits and unresolved details:** Five parameters; subpopulation identifiability matters.

**Source:** bundled help [lines 3137-3151](analysis/sources-help.html#L3137), [lines 1708](analysis/sources-help.html#L1708). Original `sshelp.ztf` physical lines: `126033-126332;92241-92241`; byte ranges `[start,end)`: `3477985-3494437;2447569-2447648`.

<a id="method-m042"></a>

#### M042 — YBath 7P bathtub

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
F=1-u exp(Wi+Wc+Wx)-(1-u)exp(Wc+Wx); f=-u(wi+wc+wx)exp(Wi+Wc+Wx)-(1-u)(wc+wx)exp(Wc+Wx)
```

**Limits and unresolved details:** Six Weibull parameters plus u; help erroneously calls bathtub a PDF, though hazard is intended.

**Source:** bundled help [lines 3171-3185](analysis/sources-help.html#L3171), [lines 1709](analysis/sources-help.html#L1709). Original `sshelp.ztf` physical lines: `126484-126626;92243-92243`; byte ranges `[start,end)`: `3502902-3511121;2447651-2447748`.

<a id="method-m043"></a>

#### M043 — Partial affected/batch W3B and detection

**Documented status:** provided via partial-percent workflow. **Evidence basis:** A.

**Mathematics or documented algorithm:**

```text
F_population=u*F_susceptible; rescale probability axis by affected percentage; detect using present-risk discrepancy, MLE-vs-RR slope, or nonparametric occurrence/suspension comparison
```

**Limits and unresolved details:** YBath explicitly does not directly fit W3B; help at 3111 has erroneous missing (1-u) term. Some checks need >=20 failures and >=20 suspensions.

**Source:** bundled help [lines 1711-1716](analysis/sources-help.html#L1711), [lines 3103-3114](analysis/sources-help.html#L3103). Original `sshelp.ztf` physical lines: `92247-92257;125864-125887`; byte ranges `[start,end)`: `2447938-2452795;3467900-3469418`.

<a id="method-m044"></a>

#### M044 — Exclusive-OR W5E

**Documented status:** explicitly planned/not provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
F=1-u exp(W1)-(1-u)exp(W2)
```

**Limits and unresolved details:** Do not count as implemented YBath fit.

**Source:** bundled help [lines 3161-3170](analysis/sources-help.html#L3161). Original `sshelp.ztf` physical lines: `126459-126482`; byte ranges `[start,end)`: `3501241-3502894`.

<a id="method-m045"></a>

#### M045 — General arbitrary population-risk mixtures

**Documented status:** theory only beyond provided 4/5/7P models. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
F=1-sum_g u_g*exp(sum_(k in group g) W_k), sum_g u_g=1
```

**Limits and unresolved details:** General theory does not establish arbitrary-model fitting capability.

**Source:** bundled help [lines 3040-3102](analysis/sources-help.html#L3040). Original `sshelp.ztf` physical lines: `125767-125861`; byte ranges `[start,end)`: `3459492-3467894`.

### Forecasting

<a id="method-m046"></a>

#### M046 — Abernethy present and future risk

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Estimate present event count and future events from individual ages/distribution; supports fleet additions, removals, renewal, replacements, usage and warranty limits
```

**Reference algebra / interpretation — not exact executable recovery:**

Without replacement, a survivor aged aᵢ has future-failure probability qᵢ(Δ)=1-R(aᵢ+Δ)/R(aᵢ); expected first failures Σqᵢ. This alone is not the documented Abernethy renewal/RBA algorithm. Documented Event Probability accumulates from 0; Standard starts at 0.5; RBA1 reports integers.

**Limits and unresolved details:** Exact present-risk RBA and time-stepping routine not disclosed; standard adds 0.5 versus Event Probability, RBA1 shows integers.

**Source:** bundled help [lines 1755-1809](analysis/sources-help.html#L1755). Original `sshelp.ztf` physical lines: `92325-92411`; byte ranges `[start,end)`: `2461255-2477249`.

<a id="method-m047"></a>

#### M047 — Conditional remaining life

**Documented status:** provided. **Evidence basis:** A.

**Mathematics or documented algorithm:**

```text
P(T<=a+d given T>a)=[F(a+d)-F(a)]/[1-F(a)]; Weibull can invert probability for d
```

**Reference algebra / interpretation — not exact executable recovery:**

For Weibull R(a+d)/R(a)=R*: d=η[(a/η)^β-ln R*]^(1/β)-a. For lognormal evaluate the survival ratio numerically.

**Limits and unresolved details:** Conditional probability is algebraic restatement; provided for Weibull/lognormal.

**Source:** bundled help [lines 875](analysis/sources-help.html#L875), [lines 1751](analysis/sources-help.html#L1751). Original `sshelp.ztf` physical lines: `80416-80416;92317-92317`; byte ranges `[start,end)`: `2034467-2034937;2459701-2460164`.

<a id="method-m048"></a>

#### M048 — Crow-AMSAA/Duane power-law growth

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
M(t)=lambda*t^beta; rho(t)=lambda*beta*t^(beta-1); regression, MLE or IEC modified MLE
```

**Reference algebra / interpretation — not exact executable recovery:**

Standard time-terminated, point-event NHPP MLE: β̂=n/Σln(T/tᵢ), λ̂=n/T^β̂. Grouped log-likelihood: Σ[ΔNⱼ ln ΔMⱼ-ΔMⱼ-ln(ΔNⱼ!)]. These identify the general model; the IEC unbiased/failure-terminated/multiple-equipment corrections remain unresolved.

**Limits and unresolved details:** Grouped, failure-terminated and time-terminated solution variants. Exact IEC estimator correction not printed.

**Source:** bundled help [lines 2782-2828](analysis/sources-help.html#L2782), [lines 2027-2078](analysis/sources-help.html#L2027). Original `sshelp.ztf` physical lines: `122069-122141;92793-92881`; byte ranges `[start,end)`: `3363894-3373556;2509997-2524293`.

<a id="method-m049"></a>

#### M049 — Crow growth diagnostics/confidence

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Cramer-von Mises GOF, significant growth/degradation tests; IEC or pivotal MC confidence; CCC/p-value
```

**Limits and unresolved details:** Exact statistic/correction equations not printed.

**Source:** bundled help [lines 2047-2060](analysis/sources-help.html#L2047). Original `sshelp.ztf` physical lines: `92825-92846`; byte ranges `[start,end)`: `2511868-2518933`.

<a id="method-m050"></a>

#### M050 — Crow transformed outputs

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
MTBF=1/rho; AVAL=MTBF/(MTBF+MTTR); SURV=1-rho for one-shot trials; EXPR uses exp(-rho*exposure) snapshot
```

**Reference algebra / interpretation — not exact executable recovery:**

RATEᵢ=λβt^(β-1); RATEcum=λt^(β-1); MTBF=1/RATE; EXPR=exp(-RATE·exposure) under the documented frozen-rate approximation; SURV=1-RATE for one-shot trials; AVAL=MTBF/(MTBF+MTTR).

**Limits and unresolved details:** EXPR for changing rho is explicitly a frozen-rate snapshot assumption.

**Source:** bundled help [lines 2069-2073](analysis/sources-help.html#L2069). Original `sshelp.ztf` physical lines: `92864-92872`; byte ranges `[start,end)`: `2520933-2522657`.

<a id="method-m051"></a>

#### M051 — Fulton Risk

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Future occurrence forecast from Crow-AMSAA fit with operating population, production/usage and cost options
```

**Reference algebra / interpretation — not exact executable recovery:**

Basic power-law projection is M(t+Δ)-M(t). Fleet exposure, cost, renewal, and population changes add software-specific logic not recovered here.

**Limits and unresolved details:** Distinct from individual-age Abernethy model; detailed recurrence not disclosed.

**Source:** bundled help [lines 2109-2124](analysis/sources-help.html#L2109). Original `sshelp.ztf` physical lines: `92937-92988`; byte ranges `[start,end)`: `2530358-2536094`.

<a id="method-m052"></a>

#### M052 — Nelson recurrent-event MCF

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Nonparametric mean cumulative event/cost count by equipment age, keeping equipment identifiers and censoring
```

**Reference algebra / interpretation — not exact executable recovery:**

Standard event/cost MCF: M̂(t)=Σ_{tⱼ≤t} dⱼ/Yⱼ, where Yⱼ is the number of observed systems and dⱼ counts events or costs. Repeated events on the same unit remain in the history.

**Limits and unresolved details:** Exact variance/confidence implementation not printed; changelog confirms MCF confidence.

**Source:** bundled help [lines 2090-2108](analysis/sources-help.html#L2090), [lines 2935-2981](analysis/sources-help.html#L2935). Original `sshelp.ztf` physical lines: `92898-92934;125477-125533`; byte ranges `[start,end)`: `2526352-2530352;3441019-3446155`.

### Maintenance

<a id="method-m053"></a>

#### M053 — Optimum age replacement

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Evaluate cost/time/item over candidate replacement intervals and choose minimum; also report failure rate, MTBF and replacement rate
```

**Reference algebra / interpretation — not exact executable recovery:**

Standard age-replacement reference: minimize C(τ)=[Cf F(τ)+Cp R(τ)]/∫₀^τ R(u)du. Planned-renewal failure MTBF=∫₀^τR(u)du/F(τ). These are model references; app discretization, cost additions, and objective details remain unknown.

**Limits and unresolved details:** Cost-rate equation not printed; help restricts view to eta.

**Source:** bundled help [lines 1665-1683](analysis/sources-help.html#L1665). Original `sshelp.ztf` physical lines: `92163-92199`; byte ranges `[start,end)`: `2439987-2442900`.

<a id="method-m054"></a>

#### M054 — Block replacement

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Replace in calendar/mileage blocks instead of individual age; compare cost/time
```

**Reference algebra / interpretation — not exact executable recovery:**

Standard block-replacement reference: [Cp+Cf m(τ)]/τ, m(t)=F(t)+∫₀^t m(t-u)dF(u). Assumptions and the app’s renewal solver are not recovered.

**Limits and unresolved details:** Renewal-cost computational formula not disclosed.

**Source:** bundled help [lines 1676](analysis/sources-help.html#L1676). Original `sshelp.ztf` physical lines: `92185-92185`; byte ranges `[start,end)`: `2441224-2441541`.

### Testing

<a id="method-m055"></a>

#### M055 — WeiBayes/reliability demonstration planning

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Solve test time, sample quantity or demonstrated reliability for known Weibull slope/normal or lognormal spread, allowable failures and confidence; binomial if spread unknown
```

**Reference algebra / interpretation — not exact executable recovery:**

Zero-failure Weibull: t=η[-ln(1-C)/n]^(1/β). Distribution-free zero-failure test: n≥ln(1-C)/ln(Rrequired), rounded up. For allowable failures k, choose t/n so P(Bin(n,Fnull(t))≤k)≤1-C.

**Limits and unresolved details:** Example beta=2,n=3,zero failures,90% confidence yields t/eta=0.876. Exact formulas not printed.

**Source:** bundled help [lines 1718-1754](analysis/sources-help.html#L1718). Original `sshelp.ztf` physical lines: `92262-92323`; byte ranges `[start,end)`: `2453264-2461252`.

<a id="method-m056"></a>

#### M056 — Consumer and producer risk/pass probability

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Consumer risk=1-confidence; compute acceptance probability for true/spec characteristic-life ratio; producer risk=complement
```

**Reference algebra / interpretation — not exact executable recovery:**

For n tests and k permitted failures, Ppass=Σ_{j=0}^k C(n,j)Ftrue(t)^j[1-Ftrue(t)]^(n-j). Producer risk=1-Ppass. Consumer risk is the permitted null-model acceptance probability.

**Limits and unresolved details:** General acceptance summation not printed.

**Source:** bundled help [lines 1746-1747](analysis/sources-help.html#L1746). Original `sshelp.ztf` physical lines: `92307-92309`; byte ranges `[start,end)`: `2458434-2458895`.

<a id="method-m057"></a>

#### M057 — Sudden-death test planning

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Estimate test-time reduction with beta, number of setups and items per setup
```

**Reference algebra / interpretation — not exact executable recovery:**

For m independent identical Weibull specimens, Rmin(t)=R(t)^m, ηmin=η m^(-1/β); E[Tmin]=η m^(-1/β)Γ(1+1/β). The app’s full test setup/time-saving calculation remains unrecovered.

**Limits and unresolved details:** Exact expected-order-statistic equations not printed.

**Source:** bundled help [lines 1748](analysis/sources-help.html#L1748). Original `sshelp.ztf` physical lines: `92311-92311`; byte ranges `[start,end)`: `2458898-2459124`.

<a id="method-m058"></a>

#### M058 — Sica-Luko correction

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Infer first-failure test duration from a known later failure for sudden-death testing
```

**Limits and unresolved details:** Exact correction factors not disclosed.

**Source:** bundled help [lines 1749](analysis/sources-help.html#L1749). Original `sshelp.ztf` physical lines: `92313-92313`; byte ranges `[start,end)`: `2459127-2459469`.

<a id="method-m059"></a>

#### M059 — Additional time by Fulton / Wang

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Fulton advances suspension ages until Weibayes requirement met; Wang adjusts remaining tests after early withdrawals
```

**Reference algebra / interpretation — not exact executable recovery:**

Known-β zero-failure equivalent exposure obeys Σtᵢ^β≥-ln(1-C)ηrequired^β. Advancing ages or changing remaining test lengths can meet that target; the named allocation rules are not fully recovered.

**Limits and unresolved details:** No failures allowed; exact redistribution formula not printed.

**Source:** bundled help [lines 1752-1754](analysis/sources-help.html#L1752). Original `sshelp.ztf` physical lines: `92319-92323`; byte ranges `[start,end)`: `2460167-2461252`.

<a id="method-m060"></a>

#### M060 — LFAIL, RSUSP and Dauser shift

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
LFAIL incorporates known failure count with unknown ages; RSUSP maximum all-right-suspension shift; Dauser uses mean failure time, failure percentage and known-age slope
```

**Limits and unresolved details:** Exact shift equations not printed.

**Source:** bundled help [lines 1583-1585](analysis/sources-help.html#L1583). Original `sshelp.ztf` physical lines: `91373-91377`; byte ranges `[start,end)`: `2415792-2417330`.

### Accelerated testing

<a id="method-m061"></a>

#### M061 — PFEV/covariate and S-N analysis

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Fit parameters or B-values y against engineering variable x: linear y=a+b*x, exponential y=a*b^x, power y=a*x^b, Arrhenius y=a*b^(1/x); optionally common slope across sets
```

**Reference algebra / interpretation — not exact executable recovery:**

Typical PFEV forms: q(x)=a+bx, q(x)=a x^b, q(x)=a exp(bx), q(T)=a exp(b/T); multivariate ln q=a₀+Σbⱼgⱼ(xⱼ), gⱼ=xⱼ or 1/Tⱼ. Fits may target a distribution parameter or quantile. Unit/temperature conversions and weighting are software-specific.

**Limits and unresolved details:** At most min(sets-1,9) covariates; linear/power restricted to one variable. Scalar equations documented in curve-fit section; multivariate combination, weighting and optimizer not exposed.

**Source:** bundled help [lines 1990-2026](analysis/sources-help.html#L1990), [lines 1608-1615](analysis/sources-help.html#L1608). Original `sshelp.ztf` physical lines: `92730-92791;91423-91437`; byte ranges `[start,end)`: `2501740-2509994;2420615-2422181`.

<a id="method-m062"></a>

#### M062 — Probabilistic Miner's Rule

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Accumulate contributions of different load levels and return equivalent reliability for complete load spectrum
```

**Reference algebra / interpretation — not exact executable recovery:**

Classical Miner reference is D=Σnⱼ/Nⱼ. It is only conceptual background: the app’s probabilistic reliability composition is not established by this equation.

**Limits and unresolved details:** Exact equivalent-exposure/reliability accumulation equation not printed.

**Source:** bundled help [lines 2004](analysis/sources-help.html#L2004), [lines 2014-2021](analysis/sources-help.html#L2014). Original `sshelp.ztf` physical lines: `92758-92758;92770-92779`; byte ranges `[start,end)`: `2502973-2503767;2505723-2507263`.

<a id="method-m063"></a>

#### M063 — Step stress / step utilization

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Iteratively solve constant-load life model from total times and supplied load sequence; Monte Carlo search with seed control
```

**Reference algebra / interpretation — not exact executable recovery:**

A common constant-shape cumulative-exposure model uses equivalent age ΣΔtⱼ ηref/η(stressⱼ), then a reference lifetime CDF. This is not verified as SuperSMITH’s exact step-stress objective and must not be substituted for it.

**Limits and unresolved details:** Help explicitly says not rigorously field-verified; convergence and objective undisclosed.

**Source:** bundled help [lines 2022-2023](analysis/sources-help.html#L2022). Original `sshelp.ztf` physical lines: `92781-92783`; byte ranges `[start,end)`: `2507266-2508684`.

<a id="method-m064"></a>

#### M064 — Step-load test sequence planning

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Choose stress sequence from life requirement, stress range, unit count and step count
```

**Limits and unresolved details:** Exact planning optimization undisclosed.

**Source:** bundled help [lines 1750](analysis/sources-help.html#L1750). Original `sshelp.ztf` physical lines: `92315-92315`; byte ranges `[start,end)`: `2459472-2459698`.

<a id="method-m065"></a>

#### M065 — Vasan-Fulton former usage to test ratio FUTR

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Linked 3P fits to field-used units failing in lab; negative t0 represents consumed life; ratio field usage / magnitude of linked t0 estimates acceleration
```

**Limits and unresolved details:** Help describes ratio and negative t0 but does not print sign convention.

**Source:** bundled help [lines 2024](analysis/sources-help.html#L2024), [lines 1566](analysis/sources-help.html#L1566). Original `sshelp.ztf` physical lines: `92785-92785;91339-91339`; byte ranges `[start,end)`: `2508687-2509713;2409618-2410640`.

### Process reliability

<a id="method-m066"></a>

#### M066 — Barringer Process Reliability BPR

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
TP=sum outputs; RL=sum deficits below reliability change point vs production line; EUL=sum production/nameplate gaps; TL=RL+EUL; NP=sum nameplate outputs at ranks; effectiveness=TP/NP
```

**Limits and unresolved details:** Line and change-point fitting/automatic crossing described; exact proprietary RI slope mapping not disclosed.

**Source:** bundled help [lines 1810-1903](analysis/sources-help.html#L1810). Original `sshelp.ztf` physical lines: `92414-92542`; byte ranges `[start,end)`: `2477261-2489901`.

<a id="method-m067"></a>

#### M067 — BPR automatic one-click / reliability index

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Reliability from last data crossing of production lower confidence line; RI=BPR*slope-related value; automatic nameplate beta rounds to 25,65,or 1.5*production beta above65
```

**Limits and unresolved details:** RI slope transformation not printed; these are BPR features, not new lifetime distributions.

**Source:** bundled help [lines 1845-1883](analysis/sources-help.html#L1845). Original `sshelp.ztf` physical lines: `92462-92518`; byte ranges `[start,end)`: `2480792-2488561`.

### Data quality

<a id="method-m068"></a>

#### M068 — Tarum missing-data estimate

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Add left failures/discoveries or middle failures until boundary point meets fit; add upper suspensions; refit; compare gap correction to MC thresholds
```

**Limits and unresolved details:** Needs expected missingness, >=100 events recommended, 20% addition limit optional; MLE directly handles only lower gap, middle/upper via RR.

**Source:** bundled help [lines 1904-1989](analysis/sources-help.html#L1904). Original `sshelp.ztf` physical lines: `92545-92726`; byte ranges `[start,end)`: `2489912-2501726`.

### System reliability

<a id="method-m069"></a>

#### M069 — Series/parallel/k-of-n identical items

**Documented status:** provided. **Evidence basis:** A.

**Mathematics or documented algorithm:**

```text
Rseries=Ri^n; Rparallel=1-(1-Ri)^n; Rkofn=sum_(j=k..n) C(n,j)Ri^j(1-Ri)^(n-j)
```

**Reference algebra / interpretation — not exact executable recovery:**

Independent identical components: series Rs=Ri^N; parallel Rs=1-(1-Ri)^N; k-of-n Rs=Σ_{j=k}^N C(N,j)Ri^j(1-Ri)^(N-j).

**Limits and unresolved details:** Standard independence formulas inferred from documented system definitions; no unequal-item or dependency model claimed.

**Source:** bundled help [lines 903](analysis/sources-help.html#L903). Original `sshelp.ztf` physical lines: `80460-80460`; byte ranges `[start,end)`: `2041025-2041777`.

### Interference

<a id="method-m070"></a>

#### M070 — Stress-strength, life-usage, random sum/difference

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Monte Carlo sample pairs; failure probability=count(strength-load<0)/pair_count; retain sum or difference distribution
```

**Reference algebra / interpretation — not exact executable recovery:**

Pfailure=P(load>strength)=∫Fstrength(l)fload(l)dl for independent variables. Monte Carlo estimates (1/B)Σ1[Lb>Sb]. Sums/differences are formed per sampled pair and then analyzed.

**Limits and unresolved details:** Multipliers and partial-tail sampling supported.

**Source:** bundled help [lines 864-875](analysis/sources-help.html#L864). Original `sshelp.ztf` physical lines: `80400-80416`; byte ranges `[start,end)`: `2032748-2034937`.

<a id="method-m071"></a>

#### M071 — Tail-based acceleration

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Fs/Ft approximately Ffull/Fpartial; Rs approximately 1-Ft*Ffull/Fpartial
```

**Limits and unresolved details:** Approximate extrapolation from matching full and tail-sampled interference models.

**Source:** bundled help [lines 867-873](analysis/sources-help.html#L867). Original `sshelp.ztf` physical lines: `80405-80412`; byte ranges `[start,end)`: `2033425-2034207`.

<a id="method-m072"></a>

#### M072 — Competing-mode occurrence ratio

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Random-point comparison of two failure-time mechanisms estimates proportion A before B
```

**Reference algebra / interpretation — not exact executable recovery:**

For independent competing modes, P(A first)=∫fA(t)RB(t)dt; simulate paired times and count TA<TB. Numeric integration/MC details in the app remain unknown.

**Limits and unresolved details:** Exact sampler details not printed.

**Source:** bundled help [lines 876](analysis/sources-help.html#L876). Original `sshelp.ztf` physical lines: `80418-80418`; byte ranges `[start,end)`: `2034940-2035191`.

### Simulation

<a id="method-m073"></a>

#### M073 — Monte Carlo inverse-transform samples

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Weibull t=eta[-ln(1-U)]^(1/beta); precise quantile samples and random draws for programmed distributions; censoring early/internal/late/random/TypeII
```

**Limits and unresolved details:** Random generator implementation not disclosed.

**Source:** bundled help [lines 3010-3011](analysis/sources-help.html#L3010), [lines 784](analysis/sources-help.html#L784), [lines 813-819](analysis/sources-help.html#L813). Original `sshelp.ztf` physical lines: `125601-125602;69136-69136;69183-69195`; byte ranges `[start,end)`: `3449695-3450018;1846158-1846752;1853518-1856526`.

<a id="method-m074"></a>

#### M074 — Bootstrap sample-from-sample

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Resample existing observations with replacement
```

**Reference algebra / interpretation — not exact executable recovery:**

Bootstrap reference: sample n observations with replacement from the empirical sample, refit, repeat. App handling of censoring/multiple data columns is not fully recovered.

**Limits and unresolved details:** Small-sample limitations noted in glossary.

**Source:** bundled help [lines 805](analysis/sources-help.html#L805), [lines 814](analysis/sources-help.html#L814). Original `sshelp.ztf` physical lines: `69165-69165;69185-69185`; byte ranges `[start,end)`: `1850824-1850975;1854474-1855085`.

<a id="method-m075"></a>

#### M075 — DDP, FBF, LRT, MEP, ODT, MPV, SFD analyses

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Distribution power and rejection rates; likelihood-ratio calibration; sample minima/maxima; outlier tests; distributions of fitted parameters/quantiles; sample export
```

**Limits and unresolved details:** FBF and ODT are named without detailed algorithm; several outputs use same sampling engine.

**Source:** bundled help [lines 797-811](analysis/sources-help.html#L797). Original `sshelp.ztf` physical lines: `69157-69179`; byte ranges `[start,end)`: `1850383-1853315`.

### Calculators

<a id="method-m076"></a>

#### M076 — Binomial probability

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Evaluate P(X<=k) and P(X=k) for N trials and probability p
```

**Reference algebra / interpretation — not exact executable recovery:**

P(X=j)=C(n,j)p^j(1-p)^(n-j), P(X≤k)=Σ_{j=0}^k P(X=j).

**Limits and unresolved details:** Underlying summation implementation not printed.

**Source:** bundled help [lines 845-846](analysis/sources-help.html#L845). Original `sshelp.ztf` physical lines: `80363-80365`; byte ranges `[start,end)`: `2025541-2026474`.

<a id="method-m077"></a>

#### M077 — Poisson count probability

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
One expected-count parameter; compute count probability/CDF
```

**Reference algebra / interpretation — not exact executable recovery:**

P(X=j)=exp(-μ)μ^j/j!, P(X≤k)=Σ_{j=0}^k exp(-μ)μ^j/j!.

**Limits and unresolved details:** Underlying recurrence not printed.

**Source:** bundled help [lines 879-880](analysis/sources-help.html#L879). Original `sshelp.ztf` physical lines: `80424-80426`; byte ranges `[start,end)`: `2036006-2036966`.

<a id="method-m078"></a>

#### M078 — Chi-square / Student-t / gamma / normal

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Chi-square percentiles and normalized option; Student-t CDF; gamma for Weibull means; normal tail probabilities
```

**Limits and unresolved details:** Chi-square is documented piecewise linear, precise at common low-dof percentiles and approximate elsewhere.

**Source:** bundled help [lines 847-863](analysis/sources-help.html#L847), [lines 902](analysis/sources-help.html#L902). Original `sshelp.ztf` physical lines: `80367-80398;80458-80458`; byte ranges `[start,end)`: `2026482-2032745;2040744-2041022`.

<a id="method-m079"></a>

#### M079 — Weibull mean, eta conversion and planned-renewal MTBF

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Mean=eta*Gamma(1+1/beta); convert inversely; planned-renewal MTBF given interval
```

**Reference algebra / interpretation — not exact executable recovery:**

E[T]=ηΓ(1+1/β); η=E[T]/Γ(1+1/β). Under age replacement at τ, failure MTBF=∫₀^τR(t)dt/F(τ); exact software integration not recovered.

**Limits and unresolved details:** Planned-renewal formula not printed.

**Source:** bundled help [lines 859-861](analysis/sources-help.html#L859), [lines 877](analysis/sources-help.html#L877). Original `sshelp.ztf` physical lines: `80390-80394;80420-80420`; byte ranges `[start,end)`: `2030257-2030940;2035194-2035589`.

<a id="method-m080"></a>

#### M080 — Outlier extreme-point p-value

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Test lowest/highest values against 90% extremeness criterion
```

**Reference algebra / interpretation — not exact executable recovery:**

Known-distribution order-statistic reference: P(min≤x)=1-[1-F(x)]^n; P(max≥x)=1-F(x)^n. App fitted-model corrections are unresolved.

**Limits and unresolved details:** Exact fitted-model/order-statistic adjustment not disclosed.

**Source:** bundled help [lines 878](analysis/sources-help.html#L878). Original `sshelp.ztf` physical lines: `80422-80422`; byte ranges `[start,end)`: `2035592-2036003`.

### Quality capability

<a id="method-m081"></a>

#### M081 — Quality Limit Comparison cPk and ppm

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Use any programmed distribution's PDF/CDF with specification limits and report cPk or ppm
```

**Reference algebra / interpretation — not exact executable recovery:**

Defect fraction p=F(LSL)+1-F(USL); ppm=10^6 p. For normal-only reference Cpk=min[(USL-μ)/(3σ),(μ-LSL)/(3σ)]. The app’s nonnormal index convention remains unknown.

**Limits and unresolved details:** Tail probability implied, but exact non-normal cPk convention not disclosed.

**Source:** bundled help [lines 525-542](analysis/sources-help.html#L525). Original `sshelp.ztf` physical lines: `68205-68232`; byte ranges `[start,end)`: `1794116-1797005`.

### Auxiliary plots

<a id="method-m082"></a>

#### M082 — CDF/PDF/RDF/hazard and ACH

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
PDF=dF/dt; RDF=1-F; HDF=PDF/RDF; ACH model/data comparison for mixture/batch detection
```

**Reference algebra / interpretation — not exact executable recovery:**

Ordinary cumulative hazard is H(t)=-ln R(t), but the program’s Aggregate Cumulative Hazard (ACH) is a separately documented diagnostic and its exact construction is unresolved.

**Limits and unresolved details:** ACH aggregation and data-point smoothing algorithm not printed; do not equate automatically with ordinary cumulative hazard.

**Source:** bundled help [lines 525-544](analysis/sources-help.html#L525). Original `sshelp.ztf` physical lines: `68205-68236`; byte ranges `[start,end)`: `1794116-1797246`.

### General curve fitting

<a id="method-m083"></a>

#### M083 — Linear/polynomial/power/exponential/Arrhenius fits

**Documented status:** provided. **Evidence basis:** D.

**Mathematics or documented algorithm:**

```text
Least squares: power Y=aX^b, exponential Y=ab^X, Arrhenius Y=ab^(1/X); polynomial orders 1 through 9
```

**Limits and unresolved details:** Supporting engineering regression, not distinct reliability distributions.

**Source:** bundled help [lines 1600-1616](analysis/sources-help.html#L1600). Original `sshelp.ztf` physical lines: `91410-91439`; byte ranges `[start,end)`: `2420230-2422464`.

<a id="architecture"></a>

## 6. Proposed architecture and data contracts

This section is a recommended design for the new tool, not a recovered SuperSMITH architecture.

### 6.1 Layers and responsibilities

| Layer | Responsibility | Examples |
|---|---|---|
| Observation/import | Preserve censoring, units, repeated-unit identity and source representation. | CSV, legacy W/V files, grouped inspections, warranty matrices. |
| Probability kernels | Stable distribution and quantile evaluation. | Weibull, normal, lognormal, Gumbel, mixtures. |
| Estimation | Regress, maximize likelihood, calculate nonparametric estimates. | RRX/RRY, interval MLE, KM, MCF. |
| Uncertainty/diagnostics | Quantify uncertainty without silently changing estimator. | LR, information matrix, simulation, GOF. |
| Applied workflows | Use models under explicit operational assumptions. | Test planning, forecasts, replacement, PFEV. |
| Results/provenance | Preserve inputs, algorithm version and diagnostics. | Reproducible exports and saved analyses. |
| Presentation | Expose model assumptions, output units and method choices. | Probability, survival, growth and cost plots. |

Select distribution, estimator, rank method, confidence method and operational workflow independently. Avoid one overloaded “Weibull analysis” setting that silently changes several of them.

### 6.2 Observation contracts

```typescript
type LifetimeObservation =
  | { kind: "failure"; time: number; count: number }
  | { kind: "right_censored"; time: number; count: number }
  | { kind: "left_censored"; upper: number; count: number }
  | { kind: "interval_censored"; lower: number; upper: number; count: number };

type LifetimeDataset = {
  observations: LifetimeObservation[];
  exposureUnit: string;
  sourceId: string;
};

type InspectionGroup = {
  age: number;
  failures: number;
  examined: number;
  withdrawn?: number;
  cohortId?: string;
};

type RecurrentUnitHistory = {
  unitId: string;
  observationStart: number;
  observationEnd: number;
  events: { age: number; cost?: number; mode?: string }[];
};

type GrowthObservation = {
  cumulativeExposure: number;
  cumulativeEvents: number;
};
```

Use integer counts for replicated specimens; arbitrary statistical weights need a separate definition. Check finite values, positive counts, interval ordering, distribution support, consistent units and cohort identity. Observation-start fields do not by themselves implement left truncation; implement or reject it explicitly.

Legacy negative numbers may indicate suspensions or actual negative measurements, depending on distribution/settings. Resolve this in the adapter, preserve the original representation, and use explicit censoring fields internally.

Grouped data must distinguish repeated observation of the same cohort from independent destructive samples or supplied cumulative percentages. These imply different risk sets and likelihoods. Warranty import should preserve production month, service age, production quantities and repeated-repair semantics.

### 6.3 Probability interface

```typescript
interface Distribution<P> {
  validateParameters(parameters: P): void;
  support(parameters: P): { lower: number; upper: number };
  cdf(x: number, parameters: P): number;
  logCdf(x: number, parameters: P): number;
  survival(x: number, parameters: P): number;
  logSurvival(x: number, parameters: P): number;
  pdf(x: number, parameters: P): number;
  logPdf(x: number, parameters: P): number;
  quantile(p: number, parameters: P): number;
}
```

Separate growth APIs expose $M(t)$ and $\rho(t)$, which are counts/rates rather than probabilities. Derived survival or frozen-rate reliability transforms must declare their interpretation and units.

### 6.4 Fit requests and results

```typescript
type FitRequest = {
  model: string;
  estimator: string; // e.g. mle, rank_x_on_y, rank_y_on_x
  fixedParameters: Record<string, number>;
  rankMethod?: string;
  observationConvention: string;
  optimizer?: {
    maxIterations: number;
    absoluteTolerance: number;
    relativeTolerance: number;
    initialValues?: Record<string, number>;
  };
};

type FitResult = {
  model: string;
  estimator: string;
  algorithmVersion: string;
  parameters: Record<string, number>;
  status: "converged" | "nonconverged" | "not_identifiable" | "invalid_input";
  objective?: { name: string; value: number };
  effectiveCounts: Record<string, number>;
  diagnostics: { code: string; message: string }[];
  assumptions: string[];
  inputDigest: string;
  seed?: string;
  evidenceReferences?: string[];
};
```

Confidence results should separately record method, sidedness, confidence, coordinate scale, transformations, simulation trials, successful refits, PRNG/version and seed. Distinguish pointwise curve bounds, simultaneous bounds, parameter regions and prediction intervals.

Unsupported proprietary methods should have an explicit capability status. Do not expose bootstrap, ordinary MLE or unmodified LR under `RBAjjm`, `PVE`, `JLF` or `Fulton Factor` names without establishing those algorithms.

### 6.5 Result provenance

Save the input digest, normalized data and units, selected parameterization and estimator, all settings, censoring/tie convention, exclusions, convergence diagnostics, uncertainty configuration and random seed. Identify standard independent methods separately from documented or native-verified legacy behavior.

Stable catalog IDs such as `M016` can bind an implementation to its reference. They identify documentation entries, not original function IDs.

<a id="policies"></a>

## 7. Numerical and statistical implementation policies

These are proposed requirements for the new tool, not expanded compatibility claims.

### 7.1 Stable arithmetic

1. Use `-expm1(-A)` for Weibull CDF and `log1p(-p)` in quantiles. Calculate log-survival directly as `-A`.
2. Provide direct normal/lognormal survival and log-survival; subtracting a rounded CDF from one loses upper-tail information.
3. Evaluate mixture sums with log-sum-exp where needed.
4. Compute interval log-probability with stable log differences. For $a=\log F(r),b=\log F(l)$, use $a+\log(1-\exp(b-a))$ with a stable `log1mexp` helper. In upper tails use $R(l)-R(r)$ instead when better conditioned.
5. Use log-gamma for C4 and gamma ratios; half-integer factorials and large sample sizes require more than integer factorial code.
6. Use log-space weighted power sums for wide Weibull exposure ranges. Normalize units for conditioning and convert parameters back.
7. Use bracketed monotone root finding for quantiles and profile-shape equations where applicable; report failed brackets or invalid objectives.
8. Define an open-unit-interval sampling policy for logarithmic inverse transforms. A generated zero cannot silently be passed to `log(U)`.

### 7.2 Estimation and identifiability

All-censored general lifetime fits, too few effective failures, zero regression variance, and impossible support should produce explicit statuses. Distinguish an ordinary MLE from a zero-failure confidence bound.

Constrain positive scale/shape and mixture weights, enforce shifted support, and report the objective/search region. Mixtures may have label switching, boundary solutions and multiple maxima. A defined presentation ordering and multiple starts can help, but do not establish identifiability.

Keep the best candidate and its diagnostics if useful, but do not mark a failed optimizer as converged. A correlation-maximizing shift search is different from a likelihood-maximizing shift search.

### 7.3 Bias and confidence conventions

The legacy C4 formulas use a particular effective-count convention excluding suspensions; that convention is not universal for every estimator or bound. Named mean/median/normal corrections and RBAjjm must remain separate.

The RBApb help mentions slope/intercept adjustment, while its changelog mentions eta. Multiplying a transformed linear intercept is not equivalent to multiplying eta. Resolve that mapping before asserting exact compatibility.

Simulation-based intervals must reproduce censoring and fixed/free parameters, including whether $t_0$ is refitted. Record failed refits and their handling instead of invisibly discarding them. Confidence coverage checks must account for Monte Carlo uncertainty.

### 7.4 Forecast and repair assumptions

Differentiate first failures, total recurrent events, probability of at least one event and cost. Expected counts may exceed one; probabilities may not.

State whether repair is perfect renewal, minimal repair or another model. Lifetime renewal is not Crow–AMSAA NHPP. For independent first failures, expected count is a sum of conditional probabilities, while fleet no-failure probability is a product of conditional survivals.

Preserve calendar time, individual age and operating exposure as distinct quantities. Calendar block replacement differs from individual age replacement. Adding expected counts across modes does not itself give system survival.

### 7.5 Presentation

Display distribution parameterization, estimator, rank method and confidence method with each result. Distinguish lognormal `Med/SigF` from log-space mean/standard deviation and instantaneous intensity from cumulative average rate.

Define the direction of every p-value-like output. PVE, `prr` and `pff` are not interchangeable with each other or automatically with a conventional p-value. Ordinary cumulative hazard is not established as SuperSMITH ACH. Label bathtub hazard as hazard, not PDF.

<a id="validation"></a>

## 8. Validation cases and acceptance criteria

### 8.1 Retained numeric examples

These are independent mathematical reconstructions or translated-code checks, not output captured from running SuperSMITH.

| Case | Inputs | Expected value |
|---|---|---|
| Weibull at characteristic life | $t=1000,\eta=1000,\beta=3$ | $F=0.6321205588285577$ |
| Fixed-beta WeiBayes | Fail 300; censor 100,200,400,500; $\beta=3.5$ | $\eta=578.8317364864017$ |
| Zero-failure Weibull test | $n=3,\eta=500,\beta=2,C=0.9$ | 438.0434808130777 time units per specimen |
| Zero-failure binomial test | $R=0.999,C=0.9$ | 2,302 specimens |
| Remaining life | $a=24,\eta=72,\beta=2.6,R_*=0.95$ | 6.673097508738255 additional months |
| KM | $(age,d,n)=(6,4,5000),(10,13,4996),(17,28,4983),(21,37,4955)$ | Final $R=0.9836$ |
| Nelson toy MCF | Increments $1/3,1/3,2/3,1/2$ | 1.8333333333333333 |
| Poisson 90% quantile | Mean 8 | First integer CDF crossing at 12 |
| Poisson CDF | Mean 10, $k=15$ | 0.9512595966960213 |
| Normal quantile | $p=0.025$ | Approximately -1.959963984540054 |
| Correct affected-fraction boundary | $u=0.25,t=0$ | $F=0$; erroneous printed formula yields 0.75 |

Sources: [reference checks](analysis/reference-checks.json), [tutorial checks](analysis/reference/analytic-example-checks.json), [translation checks](analysis/binary/math-translation-checks.json).

### 8.2 Retained native-translation checks

| Translated function | Points | Maximum observed absolute difference |
|---|---|---|
| $1-e^x$ helper | 401 | $1.734723475976807\times10^{-18}$ |
| Normal CDF | 1,010 | $1.1102230246251565\times10^{-16}$ |
| Normal quantile | 701 | $2.1316282072803006\times10^{-14}$ |

Checks include approximation boundaries and very small lower-tail quantiles. They are finite checks, not global error proofs. Python binary64 and original x87 evaluation can differ; runtime conversion and error paths were omitted.

### 8.3 Proposed new-tool validation

| Area | Acceptance checks |
|---|---|
| Kernels | Monotonicity, probability range, support, quantile round trips, density/CDF consistency, logarithmic tails and parameter limits. |
| Parameterization | Weibull/exponential/Rayleigh equivalence, shifted quantiles, lognormal median/factor conversion and Gumbel direction. |
| Fitting | Known examples, simulation recovery, frequency versus expanded data, unit scaling, fixed-parameter constraints and convergence diagnostics. |
| Censoring | Exact/right/left/interval terms, event/censor ties under a declared rule, all-censored data and impossible observations. |
| Regression | X-on-Y versus Y-on-X, every rank method and explicit tie/suspension behavior. |
| Nonparametric | Hand-computed risk sets, endpoint events, actuarial withdrawal convention and recurrent-unit costs. |
| Mixtures | Weights 0/1, equal-component reductions, monotone CDF, quantile inversion and weak identification. |
| Growth | Known power-law parameters, grouped increments, termination differences and dimensionally valid transforms. |
| Confidence | Coverage under the intended observation scheme, sidedness, fixed/free parameters and failed-refit accounting. |
| Forecasts | Counts versus probabilities, renewal versus minimal repair, fleet changes and exposure conversions. |
| Test planning | Reinsert solved time/count into the acceptance inequality; integer rounding and allowable-failure cases. |
| Reproducibility | Same input/method/PRNG version and seed reproduce the declared result level. |

Choose tolerances according to numerical scale and conditioning. Absolute CDF agreement alone does not verify relative tail accuracy. Coverage experiments need trial counts and uncertainty rather than exact nominal percentages from finite trials.

All six retained code slices were checked against original bytes/hashes. Six REA native references and 162 HTML-report links were validated previously. Markdown link/coverage checks are recorded separately for this compilation.

<a id="unknowns"></a>

## 9. Documentation defects and unresolved algorithms

### 9.1 Known discrepancies

| Issue | Evidence | Treatment |
|---|---|---|
| Batch CDF printed as $1-u e^{-A}$ | Help 3111 and tutorial p57; wrong $F(0)=1-u$. | Consistent population CDF is $u(1-e^{-A})$. This is a documentation correction, not a demonstrated binary defect. |
| Exponential calculator prints `exp(-f/T)` | Help 855–857; rate units and example require `exp(-f*T)`. | Use dimensionally consistent exponential reliability. |
| Bathtub described as PDF | Help near 3186. | Treat usual bathtub shape as hazard; keep density separate. |
| W5E described mathematically | Help 3161–3170 marks it planned/unimplemented. | Do not count it as a confirmed solver; a new implementation is an extension. |
| Poisson printed result | Help 0.95125696 versus exact 0.9512595966960213. | Preserve the discrepancy; do not tune accurate arithmetic to match it. |
| Defaults vary across sections | Older RBA recommendations and inspection wording. | Save explicit method/version choices rather than inferring one default. |

### 9.2 Exact compatibility gaps

| Algorithm | Known | Still unresolved |
|---|---|---|
| RBAjjm | Small-sample shape/scale correction including suspensions. | Formula and censoring dependence. |
| RBApb | C4 powers. | Exact parameter/intercept mapping. |
| Fulton Factor / JLF | Purpose, approximate JLF expression. | Calibration, Vjllf and complete finite-sample behavior. |
| PVE, pAD, CCC | Interpretation and simulation context. | Tables, interpolation, censoring/fitted-parameter corrections and exact calibration. |
| Ranks | Named complete-sample methods. | Suspension adjustment, ties and quantile conventions. |
| Fisher variants / PLRD | Information/likelihood principles. | Derivatives, transforms, grids, normalization and endpoints. |
| IEC growth | Model, grouped/time/failure termination choices. | Corrections, repeated-equipment equations, intervals and tests. |
| Abernethy / Fulton forecasts | Workflow inputs and some half-event conventions. | Renewal recurrence, time steps, present-risk RBA and population changes. |
| Maintenance | Interval/cost comparison. | Quadrature, optimization and complete block-renewal rules. |
| Sica–Luko / Dauser / RSUSP / LFAIL | Input-output descriptions and examples. | Complete formulas and edge cases. |
| PMR / step stress / FUTR | Engineering workflow. | Objective, exposure accumulation, search, unit/sign conventions. |
| BPR index / automatic fitting | Loss categories and broad procedure. | RI slope transform, automatic thresholds and complete fitting. |
| ACH / outlier correction | Diagnostic purpose. | Exact construction and fitted-model calibration. |
| Native numeric boundaries | Selected arithmetic paths. | Full argument/error behavior, tiny-probability branches and callers. |

There is no retained executable-output golden dataset because SuperSMITH was not run. Future compatibility observations should bind exact artifact, inputs, settings and output. Keep those observations separate from standard mathematics and translated-arithmetic checks.

<a id="delivery"></a>

## 10. Suggested delivery sequence

This is a proposed implementation sequence, not completed new-tool work.

| Stage | Scope | Exit criteria |
|---|---|---|
| 1. Foundations | Schemas, units, lifetime kernels, quantiles/logs, binomial/Poisson/system calculators. | Boundary/tail tests, parameterization and provenance documented. |
| 2. Basic lifetime analysis | Complete/right-censored MLE, WeiBayes, rank regression, explicit rank choices, KM/grouped inputs. | Independent examples; explicit degeneracy and observation conventions. |
| 3. Uncertainty | Clearly named independent intervals, LR/information matrix, simulation and GOF. | Coverage checks, sidedness, failed-refit accounting, reproducible seeds. |
| 4. Growth and operations | Standard Crow–AMSAA, MCF, remaining life, test plans, first-failure forecasting, age replacement. | Counts/probabilities/units and repair assumptions remain distinct. |
| 5. Advanced analysis | Interval and shifted fits, mixtures, PFEV, warranty adapters and repair/renewal workflows. | Identifiability, optimization and observation policies validated. |
| 6. Legacy compatibility | Proprietary RBAjjm, FF/JLF, IEC variants, PVE, BPR RI, PMR and forecast corrections. | Exact evidence or independently named alternatives; no unsupported compatibility labels. |

A useful first release can implement standard methods without reproducing every proprietary label. Legacy arithmetic compatibility can be a separate mode if later evidence justifies it.

<a id="reproduction"></a>

## 11. Reproducibility and evidence maintenance

Original package bytes remain unchanged; analysis outputs are separate under `analysis/`.

| Task | Resource |
|---|---|
| Inspect byte provenance | [native-math-manifest.json](analysis/binary/native-math-manifest.json) |
| Reproduce native slicing | [extract_native_math.py](analysis/binary/extract_native_math.py) |
| Extract readable help | [extract_help.py](analysis/help/extract_help.py) |
| Rebuild help inventory | [build_inventory.py](analysis/help/build_inventory.py) |
| Inspect tutorial extraction/cases | [build_reference_index.py](analysis/reference/build_reference_index.py) |
| Rebuild HTML/enriched catalog | [build_report.py](analysis/build_report.py) |
| Rebuild this document | [build_markdown_reference.py](analysis/build_markdown_reference.py) |

From the workspace root, these commands check the retained arithmetic and rebuild documentation; none executes SuperSMITH:

```bash
python analysis/mathematical_reference.py
python analysis/binary/reconstructed_math.py
python analysis/build_markdown_reference.py
```

The general reference uses Python's standard library. The translation comparison runner additionally uses NumPy/SciPy and reads coefficients from the extracted executable. Wrapper reproduction uses GNU objcopy/objdump. These commands do not imply dependency installation or particular package-version recommendations.

REA Evidence was exported before reset. IDs remain in the bundles, but a fresh REA session needs imported Evidence before using IDs as live references. A textual ID does not restore session state.

For revisions, retain method IDs, record new artifact identity and evidence type, and update validation/gap entries. If help extraction changes, regenerate line mappings and links together. Original byte ranges are specific to the original help hash.

<a id="examples"></a>

## Appendix A. Tutorial and dataset references

These 51 references corroborate or qualify catalog entries. Printed equations are not proof of a provided solver. W5E's explicit unimplemented status takes precedence over tutorial mixture illustrations, and the batch-CDF defect is corrected mathematically in Section 9.

The tutorial's ±10% Crow–AMSAA uncertainty exercise does not establish an implemented uncertainty engine. Classroom thought experiments are not software features solely because they appear in the supplied tutorial.

### A01. Weibull 2P/3P, Normal, Lognormal, Gumbel lower/upper

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 87. **Evidence:** documented capability.

Distribution family inventory and shifted Weibull examples; formulas mostly in help, not this tutorial.

### A02. Weibull inverse-transform Monte Carlo

**Source:** [analysis/reference/mc-Module1.bas](analysis/reference/mc-Module1.bas), line 27. **Evidence:** actual supplied Excel VBA source.

T = eta*(-ln U)^(1/beta), U=Rnd(); beta=3 eta0=1000 N=100.

### A03. Monte Carlo variable scale / renewal sums

**Source:** [analysis/reference/mc-Module1.bas](analysis/reference/mc-Module1.bas), line 34. **Evidence:** actual supplied Excel VBA source.

eta_i=eta0+i*eta0/(0.5*N); alternatively eta_i=eta0-i*eta0/(1.1*N); S_i=S_(i-1)+T_i.

### A04. Rank regression (rr), MLE, modified MLE RBAjjm

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 613. **Evidence:** documented fitting methods.

Explicit menu paths and output comparisons; MLE not expected to interpolate plotting positions.

### A05. Weibull likelihood example

**Source:** [analysis/reference/PlotsNotInHandbook.txt](analysis/reference/PlotsNotInHandbook.txt), line 117. **Evidence:** documented numeric likelihood example; displayed rounded products have minor inconsistency.

For three exact failures at 20,40,60: L=f(20)f(40)f(60); eta45.17172 beta2.738571 gives L≈3.56661e-6, lnL≈-12.5439.

### A06. Three-parameter shift / optimum t0

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 650. **Evidence:** documented fitting option.

Weibull location t0; distribution comparison against 2P Weibull and lognormal.

### A07. WeiBayes fixed beta with failures

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 799. **Evidence:** documented output; formula is analytic reconstruction.

Times[-100,-200,300,-400,-500], fixed beta3.5: eta≈578. Conditional fixed-beta MLE equation eta=(sum(t_i^beta)/r)^(1/beta) reproduces.

### A08. WeiBayes zero failures

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 812. **Evidence:** documented output; formula is analytic reconstruction.

Same times all censored, beta3.5: eta≈578 at 63.2% confidence. eta_lower=(sum(t_i^beta)/(-ln(1-C)))^(1/beta).

### A09. Dauser shift

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 823. **Evidence:** documented method; equation unresolved.

GEARS.W 20 failures eta10670 beta3.642 plus 1980 unknown-age suspensions gives eta≈34087. Exact implementation not shown.

### A10. Inspection option 1 and coarse-data handling

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 839. **Evidence:** documented algorithm description.

Use top plotted point per repeated inspection-time group in regression.

### A11. Grouped/probit data (quantity and percentage formats)

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 875. **Evidence:** documented algorithm description.

Regression in y direction since inspection times more accurate; fit actual percentages. Probit2 count/group-size versus Probit3 supplied percentages (line2388).

### A12. Kaplan-Meier actuarial warranty method

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 982. **Evidence:** documented behavior, full recursion not printed.

Actuarial correction subtracts half suspensions from denominator; unsuitable for renewal data.

### A13. Interval-censored maximum likelihood

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 2197. **Evidence:** documented method, likelihood formula not printed here.

Occurrences/suspensions/discoveries/intervals supported; example eta8.53 beta0.553.

### A14. SSW partition mixture

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 903. **Evidence:** documented optimization method.

Try partitions and select via modified likelihood ratio; SSW4 competing-risk MLE.

### A15. YBath 4P competing risks

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 2670. **Evidence:** explicit documentation equation.

W_j=(t/eta_j)^beta_j; F=1-exp(-W_a-W_b).

### A16. YBath 5P exclusive mixture

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 2645. **Evidence:** explicit documentation equation.

F=u*F_a+(1-u)*F_b = 1-u*exp(-W_a)-(1-u)*exp(-W_b).

**Qualification:** Documented theory; W5E is planned/not provided. See [M044](#method-m044).

### A17. YBath 5P partial competing risks

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 1600. **Evidence:** explicit documentation equation.

F=1-u*exp(-W_a-W_b)-(1-u)*exp(-W_b).

### A18. YBath 7P bathtub

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 2695. **Evidence:** explicit documentation equation.

F=1-u*exp(-W_i-W_c-W_w)-(1-u)*exp(-W_c-W_w).

### A19. YBath batch/subset

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 2646. **Evidence:** documented capability; conflicting formula.

Printed F=1-u exp(-W_a) conflicts with plotted upper asymptote and F(0)=0; likely typo. Verify help or code.

**Resolution:** Consistent affected-fraction CDF is `u*(1-exp(-A))`; binary behavior was not verified.

### A20. YBath fitting and model selection

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 1629. **Evidence:** documented methods; model identifiability warnings.

rr/rrs/mle choices; likelihood-ratio comparison 2P/4P/5P/7P; minimum sample guidance.

### A21. Design comparison / modified likelihood ratio

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 931. **Evidence:** documented capability; adjustment formula absent.

Fulton Factor pff small-sample adjustment, modified contour overlap.

### A22. Fisher-matrix, modified likelihood-contour confidence

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 1013. **Evidence:** documented capability; exact calculations absent.

Modified Fisher Matrix bounds and modified likelihood contours at requested confidence.

### A23. Pivotal Monte Carlo confidence

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 1670. **Evidence:** documented methodology.

MC confidence with optional locked seed; precision improves proportional to 1/sqrt(trials).

### A24. PVE model-fit assessment / Monte Carlo goodness of fit

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 1361. **Evidence:** documented methodology; proprietary approximation absent.

pve% models sampling rank of fit correlation; simulated prr-value cross-checks.

### A25. Parameter uncertainty Monte Carlo

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 1644. **Evidence:** documented workflow.

Simulate sets, refit parameters, examine distribution of beta/eta/r/B-lives.

### A26. Life-usage / strength-stress interference

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 1046. **Evidence:** documented MC algorithm.

Failure if usage > life; MC example Weibull life eta2000 beta6 versus Lognormal usage median500 sigmafactor1.4.

### A27. Convolution / sum of random lifetimes

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 1068. **Evidence:** documented MC algorithm.

T_total=T_initiation+T_growth; simulated sum then fit and read B1.

### A28. Tolerance stackup / random difference

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 1548. **Evidence:** documented MC algorithm; analytic reconstruction matches examples.

D=Hole-Shaft; Monte Carlo failure P(D<required clearance). Normal analytic check Phi(-(104-100-c)/sqrt(1.5^2+1^2)).

### A29. Binomial calculator / demonstration sampling

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 1081. **Evidence:** documented output; equation analytically reconstructed.

No failures: n>=ln(1-C)/ln(R); R=.999 C=.9 gives ceil=2302.

### A30. Poisson event-count calculator

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 1095. **Evidence:** documented output; equation analytically reconstructed.

P(N<=k)=sum(j=0..k)exp(-mu)*mu^j/j!; mu8 first k with CDF>=.9 is12.

### A31. Abernethy risk failure forecast

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 453. **Evidence:** documented capability; exact integrator absent.

Forecast cumulative/interval failures with fleet ages, renewal, production, usage and warranty limits.

### A32. Independent system failure forecasts

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 1123. **Evidence:** documented procedure.

Compute mode risk functions separately, then sum expected occurrence curves.

### A33. Optimum replacement

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 485. **Evidence:** documented capability; objective formula absent here.

Compare planned/unplanned replacement costs and select best interval; warranty and replacement forecasts available.

### A34. Warranty matrix analysis

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 1158. **Evidence:** documented algorithmic options.

MOP x MIS triangular claims; age-based Weibull Inspect1 vs calendar/exposure Crow-AMSAA.

### A35. Crow-AMSAA / Duane / IEC fit

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 972. **Evidence:** documented capability; formula elsewhere.

CA Lambda=.01521 beta=.933 for bomber; cumulative/instantaneous rate transforms.

### A36. Crow-AMSAA reliability of one-shot devices

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 2305. **Evidence:** documented transformed model.

Survival transform and instantaneous reliability; 70 firings9 failures fit lambda.696 beta.602 gives instantaneous reliability≈.92256.

### A37. Crow-AMSAA change/cusp Barringer plot

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 2496. **Evidence:** documented capability.

Fit pre/post change segments and use Barringer fit display.

### A38. Nelson recurrent-event MCF / cost

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 1885. **Evidence:** documented output; recursion reconstructed from example.

Sort by age, identify equipment and suspension; sum event count or cost divided by current risk set. Toy MCF=1/3+1/3+2/3+1/2=1.8333.

### A39. Aggregate cumulative hazard (ACH)

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 1228. **Evidence:** documented diagnostic; equation absent here.

Graph model-data compatibility; MLE line passes final point whereas rr need not.

### A40. Barringer process reliability

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 1242. **Evidence:** documented procedure.

Fit production and nameplate Weibull lines; quantify areas/gaps for cutback/crash losses, efficiency/utilization.

### A41. Accelerated testing PFEV / multivariable covariates

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 958. **Evidence:** documented regression model.

Characteristic life parameter as function of load; Power Fit example; up to number-of-sets minus1 engineering variables.

### A42. Step-stress analysis

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 1290. **Evidence:** documented model; exact exposure rule not printed.

Entered stress/time schedule transformed to equivalent constant-stress life; beta≈2.5 for example.

### A43. Vasan-Fulton FUTR

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 1335. **Evidence:** documented capability; optimizer absent.

Combine prior usage and subsequent lab test lives to infer usage/test equivalence; example .209 years per test hour.

### A44. Degradation / deterioration PFEV

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 2251. **Evidence:** documented model.

Lognormal measurement distributions; Median depends exponentially on inspection time; common SigmaFactor; solve time for threshold percentile.

### A45. Life remaining / conditional survival

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 1853. **Evidence:** documented result; equation analytic reconstruction.

Solve R(a+d)/R(a)=target; Weibull eta72 beta2.6, a24,target.95 gives ≈6 additional months.

### A46. Test substantiation / producer-consumer risks

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 1984. **Evidence:** documented results; equation analytic reconstruction; allowable-failure details need help.

Zero-failure equal tests t=eta*(-ln(1-C)/n)^(1/beta); n3 beta2 eta500 C.9 gives438h.

### A47. Sudden-death and Sica-Luko correction

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 2440. **Evidence:** documented numeric algorithm examples; formula absent.

Each lot first failure plus survivors; multi-failure correction estimates first event. For m4 beta2.4, order2 factor.709994, order3 factor.5201768.

### A48. Tarum missing-data estimator

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 2359. **Evidence:** documented method.

Estimate lower/middle/upper missing counts, add at boundary, optimize model fit; cable example adds67 points at61 months.

### A49. Benard plotting positions / missing-data correction

**Source:** [analysis/reference/MissingData2022.txt](analysis/reference/MissingData2022.txt), line 55. **Evidence:** explicit documented equation.

P_i=(i-.3)/(n+.4); missing early/middle points alter order and total; add boundary discoveries and upper suspensions.

### A50. Quality limits / PPM / Ppk

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 1818. **Evidence:** documented capability.

Distribution tail probabilities below lower + above upper limits; convert to PPM/Ppk with optional shift.

### A51. AIAG usage profile suspension estimation

**Source:** [analysis/reference/PlayTIME-Tutorial-Booklet.txt](analysis/reference/PlayTIME-Tutorial-Booklet.txt), line 1389. **Evidence:** documented workflow.

Scale histogram counts to fleet survivors and mileage values to service duration; merge with failures.

<a id="navigation"></a>

## Appendix B. Further code-navigation locations

These labels occur in instructions; containing frames are inferred from standard prologues. Except for the separately inspected numeric slices, this is navigation evidence, not mathematical recovery or runtime reachability. The [125-reference index](analysis/binary/diagnostic-code-locations.tsv) and [full local disassembly](analysis/binary/smithw-full.asm) remain available.

| Label | Candidate frame VA | Reference instruction VA | String VA | Full assembly line |
| --- | --- | --- | --- | --- |
| `LOGLYKMLE()` | `0x9a4920` | `0x9b007f` | `0x47dfc0` | 2108019 |
| `LOGLYKMLE()` | `0x9d8b50` | `0x9dc874` | `0x47dfc0` | 2147960 |
| `Fn_Gamma` | `0x9fd2e0` | `0x9fdc7d` | `0x47ec90` | 2184580 |
| `Fn_Chi2CDF` | `0xa06270` | `0xa067ee` | `0x47ecd8` | 2194664 |
| `DuaneMle` | `0xc2ea10` | `0xc34d92` | `0x484764` | 2791202 |
| `DuaneMleSub2` | `0xc356e0` | `0xc366eb` | `0x48477c` | 2792984 |
| `WeibayesCalc` | `0xcc3730` | `0xcc4673` | `0x4857f0` | 2938164 |
| `WeibayesCalcSub` | `0xcc60d0` | `0xcc6615` | `0x4858e0` | 2940641 |
| `LOGLYKMLE()` | `0xd6aaa0` | `0xd72d28` | `0x47dfc0` | 3128478 |
| `fdchi2CDF` | `0xe87e50` | `0xe898c4` | `0x4ba37c` | 3416069 |
| `fdNormCDF` | `0xe8a8a0` | `0xe8ae12` | `0x4babf8` | 3417440 |
| `fdNormZ` | `0xe8b060` | `0xe8b7c7` | `0x4bad9c` | 3418072 |
| `fdWblCdf` | `0xe90e20` | `0xe914db` | `0x4bb020` | 3423826 |
| `fdCDF2WPlotY` | `0xe915a0` | `0xe91677` | `0x4bb048` | 3423933 |
| `MleSolve` | `0xea5880` | `0xeae6e8` | `0x4bbc0c` | 3452681 |
| `MDMLE` | `0xf33370` | `0xf34c32` | `0x4bcd2c` | 3589492 |

<a id="coefficients"></a>

## Appendix C. Recovered normal-function coefficients

Values are decoded directly from the original executable's stored binary64 constants. This appendix makes the numeric reference usable without reading the binary again. Addresses and byte patterns are specific to the identity in Section 2.

Rows are in Horner evaluation order: initialize from the first coefficient, then multiply by the argument and add each next coefficient. Marked quantile denominators append a final `value = value*argument + 1.0`. Merely using these coefficients in binary64 does not reproduce x87/runtime error behavior.

### Normal CDF numerator P6

| Virtual address | Stored binary64 value | Original little-endian bytes |
| --- | --- | --- |
| `0x004560b8` | `0.035262496599891099` | `defb570bed0da23f` |
| `0x004560b0` | `0.70038306444368803` | `1fa78ebe8969e63f` |
| `0x004560a8` | `6.3739622035316499` | `236fa8f2ef7e1940` |
| `0x004560a0` | `33.912866078382997` | `3124b0cbd8f44040` |
| `0x00456098` | `112.079291497871` | `3c8da51c13055c40` |
| `0x00456090` | `221.21359616993101` | `f28ca2c7d5a66b40` |
| `0x00456088` | `220.206867912376` | `e5c774a99e866b40` |

### Normal CDF denominator P7

| Virtual address | Stored binary64 value | Original little-endian bytes |
| --- | --- | --- |
| `0x00456080` | `0.088388347648318405` | `ca3b7f669ea0b63f` |
| `0x00456078` | `1.7556671631826399` | `117d88733617fc3f` |
| `0x00456070` | `16.064177579207001` | `9dd41bf16d103040` |
| `0x00456068` | `86.780732202946098` | `9aa53384f7b15540` |
| `0x00456060` | `296.56424877967402` | `2078ba2907897240` |
| `0x00456058` | `637.333633378831` | `7717fa47abea8340` |
| `0x00456050` | `793.82651251994798` | `4a9798b29cce8840` |
| `0x00456048` | `440.413735824752` | `e5c774a99e867b40` |

### Normal quantile central numerator A7

| Virtual address | Stored binary64 value | Original little-endian bytes |
| --- | --- | --- |
| `0x00456280` | `2509.0809287301199` | `58927d6f299aa340` |
| `0x00456278` | `33430.575583588099` | `e0452e6bd252e040` |
| `0x00456270` | `67265.770927008707` | `208fb7551c6cf040` |
| `0x00456268` | `45921.953931549899` | `2e759b863e6ce640` |
| `0x00456260` | `13731.693765509501` | `33e74ecdd8d1ca40` |
| `0x00456258` | `1971.59095030655` | `c6c013225dce9e40` |
| `0x00456250` | `133.14166789178401` | `61431a8b88a46040` |
| `0x00456248` | `3.3871328727963701` | `7def9e1ed9180b40` |

### Normal quantile central denominator B7

After the stored coefficients, apply `value = value*argument + 1.0`.

| Virtual address | Stored binary64 value | Original little-endian bytes |
| --- | --- | --- |
| `0x00456240` | `5226.4952788528499` | `644b98ca7e6ab440` |
| `0x00456238` | `28729.085735721899` | `6aaeb17c450edc40` |
| `0x00456230` | `39307.895800092701` | `bdf464aa7c31e340` |
| `0x00456228` | `21213.7943015866` | `6752d6d572b7d440` |
| `0x00456220` | `5394.1960214247501` | `9ec8752e3212b540` |
| `0x00456218` | `687.187007492058` | `f8b3c8fd7e798540` |
| `0x00456210` | `42.313330701600897` | `b31a6e381b284540` |

### Normal quantile moderate-tail numerator C7

| Virtual address | Stored binary64 value | Original little-endian bytes |
| --- | --- | --- |
| `0x00456308` | `0.00077454501427834095` | `e5acb7c05a61493f` |
| `0x00456300` | `0.022723844989269201` | `6cec456ceb44973f` |
| `0x004562f8` | `0.241780725177451` | `455cb8b9abf2ce3f` |
| `0x004562f0` | `1.27045825245237` | `b9755308cc53f43f` |
| `0x004562e8` | `3.6478483247632001` | `ba023d1acb2e0d40` |
| `0x004562e0` | `5.7694972214606901` | `69256214f7131740` |
| `0x004562d8` | `4.6303378461565501` | `a0b1ca4877851240` |
| `0x004562d0` | `1.4234371107496799` | `5a52e9fd65c6f63f` |

### Normal quantile moderate-tail denominator D7

After the stored coefficients, apply `value = value*argument + 1.0`.

| Virtual address | Stored binary64 value | Original little-endian bytes |
| --- | --- | --- |
| `0x004562c8` | `1.05075007164442e-09` | `f33964683f0d123e` |
| `0x004562c0` | `0.00054759380849953498` | `2c27dfbf8cf1413f` |
| `0x004562b8` | `0.0151986665636165` | `d817ab7e7a208f3f` |
| `0x004562b0` | `0.14810397642747999` | `3df0943312f5c23f` |
| `0x004562a8` | `0.68976733498510001` | `c98533f29212e63f` |
| `0x004562a0` | `1.6763848301838` | `226652e678d2fa3f` |
| `0x00456298` | `2.0531916266377599` | `4ba446bbef6c0040` |

### Normal quantile extreme-tail numerator E7

| Virtual address | Stored binary64 value | Original little-endian bytes |
| --- | --- | --- |
| `0x00456388` | `2.01033439929229e-07` | `9abf93d674fb8a3e` |
| `0x00456380` | `2.71155556874349e-05` | `31e059ccc66efc3e` |
| `0x00456378` | `0.0012426609473880799` | `4c534208195c543f` |
| `0x00456370` | `0.0265321895265761` | `e04e3b19412b9b3f` |
| `0x00456368` | `0.29656057182850498` | `d1555231d9fad23f` |
| `0x00456360` | `1.78482653991729` | `3fa41f46a68efc3f` |
| `0x00456358` | `5.4637849111641099` | `fe4f876eeada1540` |
| `0x00456350` | `6.6579046435010998` | `22e53ec1b1a11a40` |

### Normal quantile extreme-tail denominator F7

After the stored coefficients, apply `value = value*argument + 1.0`.

| Virtual address | Stored binary64 value | Original little-endian bytes |
| --- | --- | --- |
| `0x00456348` | `2.0442631033899401e-15` | `91c1f8f1bf69e23c` |
| `0x00456340` | `1.4215117583164499e-07` | `efb940f74614833e` |
| `0x00456338` | `1.8463183175100501e-05` | `b17463492c5cf33e` |
| `0x00456330` | `0.00078686913114561297` | `d4c59d97bcc8493f` |
| `0x00456328` | `0.014875361290850601` | `22461532f9768e3f` |
| `0x00456320` | `0.136929880922736` | `02443418eb86c13f` |
| `0x00456318` | `0.59983220655588798` | `7fd7c74fd331e33f` |

Horner evaluator:

```python
def horner(coefficients, x, append_one=False):
    value = coefficients[0]
    for coefficient in coefficients[1:]:
        value = value*x + coefficient
    return value*x + 1.0 if append_one else value
```

This is arithmetic scaffolding for Section 4's branches, not a complete probability-library implementation. Apply the stated argument domains, tail transforms and verification limits.
