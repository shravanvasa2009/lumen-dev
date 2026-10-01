import json
from pathlib import Path

# Shared with packages/core/src/config.ts (§10.2); the Jest parity test fails if they differ.
CONFIG_PATH = Path(__file__).with_name("dsp_config.json")
DSP_CONFIG = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
