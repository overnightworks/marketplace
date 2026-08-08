from __future__ import annotations

import json
import os
import shlex
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
HOOK = REPOSITORY_ROOT / "plugins" / "atelier" / "hooks" / "pre_commit_gate.sh"


class PreCommitGateTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name)
        self.session_root = self._repository("session-root")
        self.target_root = self._repository("target root")
        self.log = self.root / "calls.log"
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self._write_fake_git()
        self._write_fake_uv()

    def test_git_dash_c_commit_gates_only_the_named_repository(self) -> None:
        command = shlex.join(
            ["git", "-C", str(self.target_root), "-c", "user.name=Agent", "commit", "-m", "change"]
        )

        result = self._run_hook(command)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self._uv_working_directories(), [self.target_root])

    def test_commit_words_inside_python_heredoc_do_not_start_the_gate(self) -> None:
        command = "python3 - <<'PY'\nmessage = 'git commit is data'\nprint(message)\nPY"

        result = self._run_hook(command)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.log.exists())

    def test_direct_commit_gates_and_blocks_in_the_session_repository(self) -> None:
        result = self._run_hook("git commit; echo not-run", uv_exit_code=1)

        self.assertEqual(result.returncode, 2)
        self.assertIn("Atelier commit gate failed", result.stderr)
        self.assertEqual(self._uv_working_directories(), [self.session_root])

    def _repository(self, name: str) -> Path:
        repository = self.root / name
        repository.mkdir()
        (repository / "uv.lock").write_text("", encoding="utf-8")
        (repository / "noxfile.py").write_text("def lint(session):\n    pass\n", encoding="utf-8")
        return repository

    def _write_fake_git(self) -> None:
        script = textwrap.dedent(
            """\
            #!/usr/bin/env python3
            import os
            import sys
            from pathlib import Path

            arguments = sys.argv[1:]
            log = Path(os.environ["HOOK_TEST_LOG"])
            with log.open("a", encoding="utf-8") as stream:
                stream.write("git\\t" + os.getcwd() + "\\t" + repr(arguments) + "\\n")
            if "-C" in arguments:
                directory = arguments[arguments.index("-C") + 1]
            else:
                directory = os.getcwd()
            print(Path(directory).resolve())
            """
        )
        self._executable("git", script)

    def _write_fake_uv(self) -> None:
        script = textwrap.dedent(
            """\
            #!/usr/bin/env python3
            import os
            import sys
            from pathlib import Path

            log = Path(os.environ["HOOK_TEST_LOG"])
            with log.open("a", encoding="utf-8") as stream:
                stream.write("uv\\t" + os.getcwd() + "\\t" + repr(sys.argv[1:]) + "\\n")
            raise SystemExit(int(os.environ["HOOK_TEST_UV_EXIT"]))
            """
        )
        self._executable("uv", script)

    def _executable(self, name: str, body: str) -> None:
        path = self.bin / name
        path.write_text(body, encoding="utf-8")
        path.chmod(0o755)

    def _run_hook(self, command: str, *, uv_exit_code: int = 0) -> subprocess.CompletedProcess[str]:
        payload = json.dumps(
            {
                "cwd": str(self.session_root),
                "hook_event_name": "PreToolUse",
                "tool_name": "Bash",
                "tool_input": {"command": command},
            }
        )
        environment = os.environ.copy()
        environment.update(
            {
                "PATH": f"{self.bin}{os.pathsep}{environment['PATH']}",
                "HOOK_TEST_LOG": str(self.log),
                "HOOK_TEST_UV_EXIT": str(uv_exit_code),
            }
        )
        return subprocess.run(
            [str(HOOK)],
            input=payload,
            text=True,
            capture_output=True,
            cwd=self.session_root,
            env=environment,
            check=False,
        )

    def _uv_working_directories(self) -> list[Path]:
        return [
            Path(line.split("\t", 2)[1])
            for line in self.log.read_text(encoding="utf-8").splitlines()
            if line.startswith("uv\t")
        ]


if __name__ == "__main__":
    unittest.main()
