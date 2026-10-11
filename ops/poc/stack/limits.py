"""The one limits file the preparer and these workers share: ``ops/poc/limits.json``.

It names the pinned Stack v2 dataset revision and the hard ceilings no request may exceed.
Raise a ceiling there and both Node and the workers see the same value.
"""

import json
import os

LIMITS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "limits.json")

with open(LIMITS_PATH, encoding="utf-8") as _stream:
    _LIMITS = json.load(_stream)

STACK_DATASET = _LIMITS["stack"]["dataset"]
STACK_REVISION = _LIMITS["stack"]["revision"]
CEILINGS = dict(_LIMITS["ceilings"])
