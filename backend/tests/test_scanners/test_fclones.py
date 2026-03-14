import json

import pytest

from app.scanners.base import DuplicateFileResult
from app.scanners.fclones import FclonesBackend


class TestFclonesBuildCommand:
    def test_basic_command(self):
        backend = FclonesBackend()
        cmd = backend.build_command(
            target_paths=["/data/share1"],
            tagged_paths=None,
            extra_flags=None,
            output_path="/tmp/output.json",
        )
        assert "fclones" in cmd
        assert "group" in cmd
        assert "/data/share1" in cmd
        assert "--cache" in cmd
        assert "--threads" in cmd

    def test_multiple_paths_adds_isolate(self):
        backend = FclonesBackend()
        cmd = backend.build_command(
            target_paths=["/data/share1", "/data/share2"],
            tagged_paths=None,
            extra_flags=None,
            output_path="/tmp/output.json",
        )
        assert "--isolate" in cmd

    def test_single_path_no_isolate(self):
        backend = FclonesBackend()
        cmd = backend.build_command(
            target_paths=["/data/share1"],
            tagged_paths=None,
            extra_flags=None,
            output_path="/tmp/output.json",
        )
        assert "--isolate" not in cmd


class TestFclonesParseOutput:
    def test_parse_groups_dict_format(self, tmp_path):
        output = {
            "groups": [
                {
                    "hash": "abc123",
                    "size": 1000,
                    "files": [
                        {"path": "/data/a/file.txt", "size": 1000},
                        {"path": "/data/b/file.txt", "size": 1000},
                    ],
                }
            ]
        }
        output_file = tmp_path / "output.json"
        output_file.write_text(json.dumps(output))

        backend = FclonesBackend()
        results = list(backend.parse_output(str(output_file)))
        assert len(results) == 2
        assert results[0].is_original is True
        assert results[1].is_original is False
        assert results[0].checksum == "abc123"

    def test_parse_list_format(self, tmp_path):
        output = [
            {
                "hash": "def456",
                "size": 500,
                "files": ["/data/a/f.txt", "/data/b/f.txt"],
            }
        ]
        output_file = tmp_path / "output.json"
        output_file.write_text(json.dumps(output))

        backend = FclonesBackend()
        results = list(backend.parse_output(str(output_file)))
        assert len(results) == 2

    def test_parse_missing_file(self):
        backend = FclonesBackend()
        results = list(backend.parse_output("/nonexistent.json"))
        assert results == []


class TestFclonesParseProgress:
    def test_scanned_files(self):
        backend = FclonesBackend()
        progress = backend.parse_progress("Scanned 500 files")
        assert progress is not None
        assert progress.total_files == 500

    def test_percentage(self):
        backend = FclonesBackend()
        progress = backend.parse_progress("Hashing: 75%")
        assert progress is not None
        assert progress.percent == 75.0
