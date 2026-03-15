import json
import logging
import re
from typing import Iterator, Optional

from app.scanners.base import (
    DuplicateFileResult,
    ScannerBackend,
    ScanProgressInfo,
)

logger = logging.getLogger(__name__)


class FclonesBackend(ScannerBackend):
    def build_command(
        self,
        target_paths: list[str],
        tagged_paths: Optional[list[str]],
        extra_flags: Optional[dict],
        output_path: str,
    ) -> list[str]:
        cmd = [
            "fclones",
            "group",
        ]

        all_paths = list(target_paths)
        if tagged_paths:
            all_paths.extend(tagged_paths)

        cmd.extend(all_paths)
        cmd.extend([
            "--cache",
            "-f", "json",
            "-o", output_path,
        ])

        if len(all_paths) > 1:
            cmd.append("--isolate")

        if extra_flags:
            for key, value in extra_flags.items():
                if value is True:
                    cmd.append(f"--{key}")
                elif value is not False and value is not None:
                    cmd.extend([f"--{key}", str(value)])

        return cmd

    def parse_output(self, output_path: str) -> Iterator[DuplicateFileResult]:
        try:
            with open(output_path, "r") as f:
                data = json.load(f)
        except (json.JSONDecodeError, FileNotFoundError) as e:
            logger.error("Failed to parse fclones output at %s: %s", output_path, e)
            return

        if isinstance(data, dict):
            groups = data.get("groups", data.get("duplicates", []))
        elif isinstance(data, list):
            groups = data
        else:
            logger.error("Unexpected fclones output format")
            return

        for group_idx, group in enumerate(groups):
            group_id = f"fclones_{group_idx}"

            if isinstance(group, dict):
                files = group.get("files", group.get("paths", []))
                checksum = group.get("hash", group.get("checksum", f"group_{group_idx}"))
                file_size = group.get("size", 0)
            elif isinstance(group, list):
                files = group
                checksum = f"group_{group_idx}"
                file_size = 0
            else:
                continue

            for file_idx, file_entry in enumerate(files):
                if isinstance(file_entry, dict):
                    path = file_entry.get("path", file_entry.get("name", ""))
                    size = file_entry.get("size", file_size)
                    mtime = file_entry.get("mtime", None)
                elif isinstance(file_entry, str):
                    path = file_entry
                    size = file_size
                    mtime = None
                else:
                    continue

                yield DuplicateFileResult(
                    checksum=str(checksum),
                    path=path,
                    size=size,
                    mtime=mtime,
                    is_original=(file_idx == 0),
                    group_id=group_id,
                )

    def parse_progress(self, line: str) -> Optional[ScanProgressInfo]:
        line = line.strip()

        scanned = re.match(r"Scanned\s+(\d+)\s+files?", line, re.IGNORECASE)
        if scanned:
            count = int(scanned.group(1))
            return ScanProgressInfo(
                message=f"Scanned {count} files",
                total_files=count,
            )

        hashing = re.match(r"Hashing.*?(\d+)%", line)
        if hashing:
            pct = float(hashing.group(1))
            return ScanProgressInfo(percent=pct, message=f"Hashing files ({pct:.0f}%)")

        grouping = re.match(r"Found\s+(\d+)\s+group", line, re.IGNORECASE)
        if grouping:
            count = int(grouping.group(1))
            return ScanProgressInfo(message=f"Found {count} duplicate groups")

        progress_pct = re.match(r"(\d+(?:\.\d+)?)%", line)
        if progress_pct:
            pct = float(progress_pct.group(1))
            return ScanProgressInfo(percent=pct, message=line)

        if line:
            return ScanProgressInfo(message=line)

        return None
