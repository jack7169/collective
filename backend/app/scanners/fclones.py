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
        # Strip ANSI escape codes and progress bar animation chars
        line = re.sub(r"\x1b\[[0-9;]*[a-zA-Z]", "", line)
        line = re.sub(r"\x1b\[\?[0-9]*[a-zA-Z]", "", line)
        line = line.strip()
        if not line:
            return None

        # fclones progress bar: "01/6: Scanning files  [<===>  ]  12345"
        step_match = re.match(
            r"(\d+)/(\d+):\s*(.+?)\s*\[.*?\]\s*(\d+)", line
        )
        if step_match:
            step = int(step_match.group(1))
            total_steps = int(step_match.group(2))
            phase = step_match.group(3).strip()
            count = int(step_match.group(4))
            # Estimate percent from step (each step ~equal weight)
            pct = ((step - 1) / total_steps) * 100
            return ScanProgressInfo(
                percent=round(pct, 1),
                message=f"Step {step}/{total_steps}: {phase} ({count:,} files)",
                total_files=count if step == 1 else None,
            )

        # fclones percentage: "50.3%" or "Hashing 50%"
        pct_match = re.search(r"(\d+(?:\.\d+)?)\s*%", line)
        if pct_match:
            pct = float(pct_match.group(1))
            return ScanProgressInfo(percent=pct, message=line[:100])

        # fclones log: "[timestamp] fclones: info: Found 56 (28.2 GB) files..."
        info_match = re.search(r"fclones:\s*\w+:\s*(.+)", line)
        if info_match:
            msg = info_match.group(1).strip()
            # Extract file counts from info messages
            found_match = re.search(r"Found\s+([\d,]+)\s+\(([\d.]+\s*\w+)\)", msg)
            if found_match:
                count = int(found_match.group(1).replace(",", ""))
                return ScanProgressInfo(message=msg, total_files=count)
            scanned_match = re.search(r"Scanned\s+([\d,]+)", msg)
            if scanned_match:
                count = int(scanned_match.group(1).replace(",", ""))
                return ScanProgressInfo(message=msg, total_files=count)
            redundant_match = re.search(r"Found\s+([\d,]+)\s+.+?redundant", msg)
            if redundant_match:
                return ScanProgressInfo(percent=99.0, message=msg)
            return ScanProgressInfo(message=msg)

        # Skip pure progress bar fragments
        if re.match(r"^[\s\[\]<=>\-|#.]+$", line):
            return None
        # Skip "Initializing" and other very short lines
        if len(line) < 4:
            return None

        return ScanProgressInfo(message=line[:100])
