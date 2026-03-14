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
