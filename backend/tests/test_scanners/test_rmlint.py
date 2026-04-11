import json
import os
import tempfile

import pytest

from app.scanners.base import DuplicateDirResult, DuplicateFileResult
from app.scanners.rmlint import RmlintBackend


class TestRmlintBuildCommand:
    def test_basic_command(self):
        backend = RmlintBackend()
        cmd = backend.build_command(
            target_paths=["/data/share1"],
            tagged_paths=None,
            extra_flags=None,
            output_path="/tmp/output.json",
        )
        assert "rmlint" in cmd
        assert "-D" in cmd
        assert "-g" in cmd
        assert "/data/share1" in cmd
        assert "/tmp/output.json" in " ".join(cmd)

    def test_tagged_paths(self):
        backend = RmlintBackend()
        cmd = backend.build_command(
            target_paths=["/data/share1"],
            tagged_paths=["/data/share2"],
            extra_flags=None,
            output_path="/tmp/output.json",
        )
        assert "//" in cmd
        assert "--keep-all-tagged" in cmd
        share1_idx = cmd.index("/data/share1")
        sep_idx = cmd.index("//")
        share2_idx = cmd.index("/data/share2")
        assert share1_idx < sep_idx < share2_idx

    def test_extra_flags(self):
        backend = RmlintBackend()
        cmd = backend.build_command(
            target_paths=["/data"],
            tagged_paths=None,
            extra_flags={"max-size": "1G", "hidden": True},
            output_path="/tmp/out.json",
        )
        assert "--max-size" in cmd
        assert "1G" in cmd
        assert "--hidden" in cmd


class TestRmlintParseOutput:
    def test_parse_duplicate_files(self, tmp_path):
        output = [
            {"type": "header", "description": "rmlint output"},
            {"type": "original", "path": "/data/a/file.txt", "size": 1000, "checksum": "abc123", "mtime": 1234567890.0},
            {"type": "duplicate_file", "path": "/data/b/file.txt", "size": 1000, "checksum": "abc123", "mtime": 1234567890.0},
            {"type": "footer", "total_files": 2},
        ]
        output_file = tmp_path / "output.json"
        output_file.write_text(json.dumps(output))

        backend = RmlintBackend()
        results = list(backend.parse_output(str(output_file)))

        assert len(results) == 2
        assert isinstance(results[0], DuplicateFileResult)
        assert results[0].is_original is True
        assert results[0].checksum == "abc123"
        assert isinstance(results[1], DuplicateFileResult)
        assert results[1].is_original is False

    def test_parse_empty_output(self, tmp_path):
        output_file = tmp_path / "empty.json"
        output_file.write_text("[]")

        backend = RmlintBackend()
        results = list(backend.parse_output(str(output_file)))
        assert results == []

    def test_parse_missing_file(self):
        backend = RmlintBackend()
        results = list(backend.parse_output("/nonexistent/path.json"))
        assert results == []


class TestRmlintParseProgress:
    def test_traversing(self):
        backend = RmlintBackend()
        progress = backend.parse_progress("Traversing '/data/share1'...")
        assert progress is not None
        assert "Traversing" in progress.message

    def test_scanning(self):
        backend = RmlintBackend()
        progress = backend.parse_progress("Now fingerprinting files...")
        assert progress is not None
        assert "fingerprinting" in progress.message.lower()

    def test_file_count(self):
        backend = RmlintBackend()
        progress = backend.parse_progress("500/1000 files processed")
        assert progress is not None
        assert progress.percent == 50.0
        assert progress.total_files == 1000

    def test_irrelevant_line(self):
        backend = RmlintBackend()
        progress = backend.parse_progress("some random text")
        assert progress is None
