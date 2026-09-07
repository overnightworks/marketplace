"""Import a `scripts/` entry point, which is a file rather than a package."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType


SCRIPTS_DIRECTORY = Path(__file__).resolve().parents[1] / "scripts"


def load_script(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        f"{name}_under_test", SCRIPTS_DIRECTORY / f"{name}.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module
