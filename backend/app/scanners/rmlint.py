import json
import logging
import re
from typing import Iterator, Optional

from app.scanners.base import (
    DuplicateDirResult,
    DuplicateFileResult,
    ScannerBackend,
    ScanProgressInfo,
)

logger = logging.getLogger(__name__)


class RmlintBackend(ScannerBackend):
    def build_command(
        self,
        target_paths: list[str],
        tagged_paths: Optional[list[str]],
        extra_flags: Optional[dict],
        output_path: str,
    ) -> list[str]:
        cmd = [
            "rmlint",
            "-D",
            "-g",
            "--no-with-color",
            "-o", f"json:{output_path}",
            "-T", "none +dd +df",
            "-a", "xxhash",          # fast non-crypto hash (10x+ faster than blake2b)
        ]

        if extra_flags:
            for key, value in extra_flags.items():
                if value is True:
                    cmd.append(f"--{key}")
                elif value is not False and value is not None:
                    cmd.extend([f"--{key}", str(value)])

        if tagged_paths:
            cmd.extend(target_paths)
            cmd.append("//")
            cmd.extend(tagged_paths)
            cmd.append("--keep-all-tagged")
        else:
            cmd.extend(target_paths)

        return cmd

    def parse_output(self, output_path: str) -> Iterator[DuplicateFileResult | DuplicateDirResult]:
        try:
            with open(output_path, "r") as f:
                data = json.load(f)
        except (json.JSONDecodeError, FileNotFoundError) as e:
            logger.error("Failed to parse rmlint output at %s: %s", output_path, e)
            return

        current_group_id = None
        group_counter = 0

        for entry in data:
            entry_type = entry.get("type", "")

            if entry_type in ("header", "footer"):
                continue

            if entry_type in ("duplicate_dir", "original_dir"):
                is_orig = entry.get("is_original", entry_type == "original_dir")
                if is_orig:
                    group_counter += 1
                    current_group_id = f"dir_{group_counter}"

                yield DuplicateDirResult(
                    group_id=current_group_id or f"dir_{group_counter}",
                    path=entry.get("path", ""),
                    file_count=entry.get("n_children", 0),
                    total_size=entry.get("size", 0),
                    is_original=is_orig,
                )

            elif entry_type in ("duplicate_file", "original"):
                is_orig = entry.get("is_original", entry_type == "original")
                if is_orig:
                    group_counter += 1
                    current_group_id = f"file_{group_counter}"

                checksum = entry.get("checksum", "")
                yield DuplicateFileResult(
                    checksum=checksum,
                    path=entry.get("path", ""),
                    size=entry.get("size", 0),
                    mtime=entry.get("mtime", None),
                    is_original=is_orig,
                    group_id=current_group_id or f"file_{group_counter}",
                )

            elif entry_type == "part_of_directory":
                checksum = entry.get("checksum", "")
                yield DuplicateFileResult(
                    checksum=checksum,
                    path=entry.get("path", ""),
                    size=entry.get("size", 0),
                    mtime=entry.get("mtime", None),
                    is_original=entry.get("is_original", False),
                    group_id=current_group_id or f"file_{group_counter}",
                )

    def parse_progress(self, line: str) -> Optional[ScanProgressInfo]:
        # Strip ANSI escape codes
        line = re.sub(r"\x1b\[[0-9;]*[a-zA-Z]", "", line)
        line = re.sub(r"\x1b\[\?[0-9]*[a-zA-Z]", "", line)
        line = line.strip()
        if not line:
            return None

        # rmlint traversal: "Traversing (17629 usable files / 0 + 123 ignored files / folders)"
        traversal_full = re.search(
            r"Traversing\s*\((\d+)\s+usable files\s*/\s*(\d+)\s*\+\s*(\d+)\s+ignored",
            line
        )
        if traversal_full:
            files = int(traversal_full.group(1))
            dirs = int(traversal_full.group(3))  # "ignored folders" ≈ dir count
            return ScanProgressInfo(
                message=f"Traversing: {files:,} files, {dirs:,} dirs",
                total_files=files,
                total_dirs=dirs,
            )

        # Simpler traversal (just file count)
        traversal_simple = re.search(r"Traversing\s*\((\d+)\s+usable files", line)
        if traversal_simple:
            files = int(traversal_simple.group(1))
            return ScanProgressInfo(message=f"Traversing: {files:,} files", total_files=files)

        # Traversing a path
        traversal_path = re.search(r"Traversing\s+'?([^'(]+)'?", line)
        if traversal_path:
            return ScanProgressInfo(message=f"Traversing {traversal_path.group(1).strip()}")

        # Phase indicators
        scanning = re.search(r"Now (fingerprinting|hashing|scanning|preprocessing|merging)", line, re.IGNORECASE)
        if scanning:
            return ScanProgressInfo(message=f"{scanning.group(1).capitalize()} files...")

        # Progress bar percentage: look for a percentage in the line
        pct_match = re.search(r"(\d+(?:\.\d+)?)\s*%", line)
        if pct_match:
            pct = float(pct_match.group(1))
            return ScanProgressInfo(
                percent=min(round(pct, 1), 99.0),
                message=line[:100],
            )

        # File count patterns: "123/456 files" or "123 files"
        count_match = re.search(r"(\d+)\s*/\s*(\d+)\s*files", line)
        if count_match:
            current = int(count_match.group(1))
            total = int(count_match.group(2))
            pct = (current / total * 100) if total > 0 else 0
            return ScanProgressInfo(
                percent=round(pct, 1),
                message=f"Processing {current}/{total} files",
                total_files=total,
            )

        # Summary lines
        total_match = re.search(r"In total\s+(\d+)\s+files.*?(\d+)\s+are\s+duplicates.*?(\d+)\s+groups", line)
        if total_match:
            return ScanProgressInfo(
                message=line[:150],
                total_files=int(total_match.group(1)),
            )

        # Size summary
        size_match = re.search(r"equals\s+([\d.]+\s*\w+)\s+of duplicates", line)
        if size_match:
            return ScanProgressInfo(message=f"Found {size_match.group(1)} of duplicates")

        # Any other non-empty content from rmlint
        if len(line) > 3 and ("duplicate" in line.lower() or "lint" in line.lower()
                               or "scanning" in line.lower() or "=>" in line):
            return ScanProgressInfo(message=line[:150])

        return None
