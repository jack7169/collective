import json

import pytest

from app.scanners.base import DuplicateFileResult
from app.scanners.fclones import FclonesBackend, _parse_size_string


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

    def test_extra_flags_passed(self):
        backend = FclonesBackend()
        cmd = backend.build_command(
            target_paths=["/data/share1"],
            tagged_paths=None,
            extra_flags={"threads": "4", "min": "1K"},
            output_path="/tmp/output.json",
        )
        assert "--threads" in cmd
        assert "4" in cmd
        assert "--min" in cmd


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

    def test_parse_v035_format(self, tmp_path):
        """fclones 0.35 uses file_len/file_hash instead of size/hash, files as strings."""
        output = {
            "header": {
                "version": "0.35.0",
                "stats": {"total_file_size": 12, "redundant_file_size": 6},
            },
            "groups": [
                {
                    "file_len": 500,
                    "file_hash": "deadbeef123",
                    "files": ["/data/a/doc.txt", "/data/b/doc.txt"],
                }
            ],
        }
        output_file = tmp_path / "output.json"
        output_file.write_text(json.dumps(output))

        backend = FclonesBackend()
        results = list(backend.parse_output(str(output_file)))
        assert len(results) == 2
        assert results[0].checksum == "deadbeef123"
        assert results[0].size == 500
        assert results[1].size == 500
        assert results[0].is_original is True
        assert results[1].is_original is False
        assert results[0].path == "/data/a/doc.txt"

    def test_parse_missing_file(self):
        backend = FclonesBackend()
        results = list(backend.parse_output("/nonexistent.json"))
        assert results == []

    def test_parse_output_uses_orjson(self, tmp_path):
        """Verify parse_output works with orjson (same output as json.load)."""
        import orjson
        output_file = tmp_path / "output.json"
        data = {
            "header": {},
            "groups": [
                {
                    "hash": "abc123",
                    "file_len": 100,
                    "files": [
                        {"path": "/mnt/user/a/file1.txt", "modified": "2026-01-01T00:00:00"},
                        {"path": "/mnt/user/b/file1.txt", "modified": "2026-01-01T00:00:00"},
                    ]
                }
            ]
        }
        output_file.write_bytes(orjson.dumps(data))
        backend = FclonesBackend()
        results = list(backend.parse_output(str(output_file)))
        assert len(results) == 2
        assert results[0].checksum == "abc123"
        assert results[0].is_original is True
        assert results[1].is_original is False
        assert results[0].size == 100


class TestParseSizeString:
    def test_gigabytes(self):
        assert _parse_size_string("28.2 GB") == int(28.2 * 1024**3)

    def test_megabytes(self):
        assert _parse_size_string("512 MB") == 512 * 1024**2

    def test_kilobytes(self):
        assert _parse_size_string("100 KB") == 100 * 1024

    def test_terabytes(self):
        assert _parse_size_string("1.5 TB") == int(1.5 * 1024**4)

    def test_bytes(self):
        assert _parse_size_string("1024 B") == 1024

    def test_no_unit(self):
        assert _parse_size_string("500") == 500

    def test_gib_format(self):
        assert _parse_size_string("10 GiB") == 10 * 1024**3

    def test_invalid(self):
        assert _parse_size_string("not a size") is None


class TestFclonesParseProgress:
    def test_scanned_files(self):
        backend = FclonesBackend()
        progress = backend.parse_progress("[2024-01-01] fclones: info: Scanned 500 files")
        assert progress is not None
        assert progress.total_files == 500

    def test_percentage(self):
        backend = FclonesBackend()
        progress = backend.parse_progress("Hashing: 75%")
        assert progress is not None
        assert progress.percent == 75.0

    def test_found_with_size_extracts_total_size(self):
        backend = FclonesBackend()
        progress = backend.parse_progress(
            "[2024-01-01] fclones: info: Found 56 (28.2 GB) files with same size"
        )
        assert progress is not None
        assert progress.total_files == 56
        assert progress.total_size == int(28.2 * 1024**3)

    def test_step_bracket_format(self):
        backend = FclonesBackend()
        progress = backend.parse_progress("01/6: Scanning files  [<===>  ]  12345")
        assert progress is not None
        assert progress.total_files == 12345
        assert "Step 1/6" in progress.message

    def test_step_only_format(self):
        backend = FclonesBackend()
        progress = backend.parse_progress("3/6: Hashing")
        assert progress is not None
        assert "Step 3/6" in progress.message
        assert progress.percent == pytest.approx((2 / 6) * 100, abs=0.1)

    def test_empty_line(self):
        backend = FclonesBackend()
        assert backend.parse_progress("") is None
        assert backend.parse_progress("  ") is None
