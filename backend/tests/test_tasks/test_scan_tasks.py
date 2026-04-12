import os

import pytest

from app.scanners.parser import normalize_path, truncate_to_depth


class TestNormalizePath:
    def test_valid_path(self, setup_test_dirs):
        data_dir, _ = setup_test_dirs
        test_dir = data_dir / "test"
        test_dir.mkdir()

        # Monkey-patch settings for test
        os.environ["COLLECTIVE_DATA_DIR"] = str(data_dir)

        from app.config import get_settings
        get_settings.cache_clear()
        result = normalize_path(str(test_dir))
        assert result == str(test_dir.resolve())

    def test_outside_data_dir(self, setup_test_dirs):
        os.environ["COLLECTIVE_DATA_DIR"] = str(setup_test_dirs[0])
        from app.config import get_settings
        get_settings.cache_clear()

        with pytest.raises(ValueError, match="outside DATA_DIR"):
            normalize_path("/etc/passwd")


class TestTruncateToDepth:
    def test_shallow_path(self):
        assert truncate_to_depth("/data", 3) == "/data"

    def test_deep_path(self):
        result = truncate_to_depth("/data/share1/movies/genre/title", 3)
        assert result == "/data/share1/movies"

    def test_exact_depth(self):
        result = truncate_to_depth("/data/share1/movies", 3)
        assert result == "/data/share1/movies"

    def test_zero_depth(self):
        result = truncate_to_depth("/data/share1/movies", 0)
        assert result == "/data/share1/movies"


# Ensure config dir exists before importing scan_tasks (triggers huey init)
os.makedirs(os.environ.get("COLLECTIVE_CONFIG_DIR", "/tmp/collective_test"), exist_ok=True)

from app.tasks.scan_tasks import build_similarity_index
from app.scanners.base import DuplicateFileResult


class TestBuildSimilarityIndex:
    def test_groups_by_parent(self):
        records = [
            DuplicateFileResult(checksum="aaa", path="/mnt/data/dir1/f1.txt", size=100, mtime=None, is_original=True, group_id="g0"),
            DuplicateFileResult(checksum="bbb", path="/mnt/data/dir1/f2.txt", size=200, mtime=None, is_original=False, group_id="g1"),
            DuplicateFileResult(checksum="aaa", path="/mnt/data/dir2/f1.txt", size=100, mtime=None, is_original=False, group_id="g0"),
        ]
        dir_checksums, checksum_to_size, dir_total_size = build_similarity_index(records, abs_depth=None)
        assert dir_checksums["/mnt/data/dir1"] == {"aaa", "bbb"}
        assert dir_checksums["/mnt/data/dir2"] == {"aaa"}
        assert checksum_to_size["aaa"] == 100
        assert checksum_to_size["bbb"] == 200
        assert dir_total_size["/mnt/data/dir1"] == 300
        assert dir_total_size["/mnt/data/dir2"] == 100

    def test_respects_depth(self):
        records = [
            DuplicateFileResult(checksum="aaa", path="/mnt/data/a/b/c/f.txt", size=50, mtime=None, is_original=True, group_id="g0"),
            DuplicateFileResult(checksum="aaa", path="/mnt/data/x/y/z/f.txt", size=50, mtime=None, is_original=False, group_id="g0"),
        ]
        # abs_depth=5 means truncate parent to 5 path segments:
        # /mnt/data/a/b/c -> ["", "mnt", "data", "a", "b"] (5 parts) -> /mnt/data/a/b
        dir_checksums, checksum_to_size, dir_total_size = build_similarity_index(records, abs_depth=5)
        assert "/mnt/data/a/b" in dir_checksums
        assert "/mnt/data/x/y" in dir_checksums
        assert "/mnt/data/a/b/c" not in dir_checksums
