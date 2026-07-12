"""MIL-HDBK-217F Notice 2 reliability prediction.

Perdura implements the handbook's part-stress models in Sections 5–23, the
Appendix A Parts Count method, and the Appendix B detailed CMOS model.  The
implementation lives in a clause-oriented module so every result can expose
its source page, equation, substitutions, assumptions, and units.

The public symbols are re-exported here to retain the conventional package
import path::

    from reliability.MIL_HDBK_217F import Microcircuit, SystemFailureRate

The same public surface implements ANSI/VITA 51.1-2013 (R2018) as a
subsidiary specification when ``standard="VITA-51.1"`` is selected.  This
activates its commercial-part defaults, mappings, extensions, conversion
methods, and Appendix F PTH fatigue model while retaining the MIL base-model
trace.

References: MIL-HDBK-217F, Notice 2, 28 February 1995; ANSI/VITA
51.1-2013 (R2018).
"""

from reliability._mil_hdbk_217f_notice2 import *
from reliability._mil_hdbk_217f_notice2 import __all__
