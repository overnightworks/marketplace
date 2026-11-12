"""Import an entry point that is a file rather than a package: a `scripts/` script or a plugin hook."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIRECTORY = REPOSITORY_ROOT / "scripts"
HOOKS_DIRECTORY = REPOSITORY_ROOT / "plugins" / "atelier" / "hooks"


def load_script(name: str, directory: Path = SCRIPTS_DIRECTORY) -> ModuleType:
    if str(directory) not in sys.path:  # a script run for real finds its siblings through its own directory
        sys.path.insert(0, str(directory))
    spec = importlib.util.spec_from_file_location(f"{name}_under_test", directory / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module
