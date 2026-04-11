import json
import logging
import multiprocessing
import os
import re
from typing import Iterator, Optional

from app.scanners.base import (
    DuplicateFileResult,
    ScannerBackend,
    ScanProgressInfo,
)

logger = logging.getLogger(__name__)


def _parse_size_string(size_str: str) -> Optional[int]:
    """Parse a human-readable size string like '28.2 GB' into bytes."""
    match = re.match(r"([\d.]+)\s*([KMGTP]?i?B?)", size_str.strip(), re.IGNORECASE)
    if not match:
        return None
    value = float(match.group(1))
    unit = match.group(2).upper().replace("I", "").rstrip("B")
    multipliers = {"": 1, "K": 1024, "M": 1024**2, "G": 1024**3, "T": 1024**4, "P": 1024**5}
    return int(value * multipliers.get(unit, 1))


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
            "--min", "4096",        # Skip tiny files (<4KB)
            "-f", "json",
            "-o", output_path,
        ])

        # Set thread pool to use all cores (fclones default is conservative)
        ncpu = multiprocessing.cpu_count()
        cmd.extend(["--threads", f"default:{ncpu},{ncpu}"])

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
                checksum = group.get("file_hash", group.get("hash", group.get("checksum", f"group_{group_idx}")))
                file_size = group.get("file_len", group.get("size", 0))
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
        # Strip ANSI escape codes
        line = re.sub(r"\x1b\[[0-9;]*[a-zA-Z]", "", line)
        line = re.sub(r"\x1b\[\?[0-9]*[a-zA-Z]", "", line)
        line = line.strip()
        if not line:
            return None

        # fclones progress bar with bracket animation:
        #   "01/6: Scanning files  [<===>  ]  12345"
        step_bracket = re.match(
            r"(\d+)/(\d+):\s*(.+?)\s*\[.*?\]\s*(\d+)", line
        )
        if step_bracket:
            step = int(step_bracket.group(1))
            total_steps = int(step_bracket.group(2))
            phase = step_bracket.group(3).strip()
            count = int(step_bracket.group(4))
            pct = ((step - 1) / total_steps) * 100
            return ScanProgressInfo(
                percent=round(pct, 1),
                message=f"Step {step}/{total_steps}: {phase} ({count:,} items)",
                total_files=count if step == 1 else None,
            )

        # fclones progress after bracket stripping — raw format becomes:
        #   "1461939  1/6: Scanning files" (count + whitespace + step)
        # or just "1/6: Scanning files   12345" (step first, count at end)
        # Handle: count then step/total
        count_step = re.match(r"(\d+)\s+(\d+)/(\d+):\s*(.+)", line)
        if count_step:
            count = int(count_step.group(1))
            step = int(count_step.group(2))
            total_steps = int(count_step.group(3))
            phase = count_step.group(4).strip()
            pct = ((step - 1) / total_steps) * 100
            return ScanProgressInfo(
                percent=round(pct, 1),
                message=f"Step {step}/{total_steps}: {phase} ({count:,} items)",
                total_files=count if step == 1 else None,
            )

        # Handle: step/total then text then count at end
        step_count = re.match(r"(\d+)/(\d+):\s*(.+?)\s+(\d{3,})\s*$", line)
        if step_count:
            step = int(step_count.group(1))
            total_steps = int(step_count.group(2))
            phase = step_count.group(3).strip()
            count = int(step_count.group(4))
            pct = ((step - 1) / total_steps) * 100
            return ScanProgressInfo(
                percent=round(pct, 1),
                message=f"Step {step}/{total_steps}: {phase} ({count:,} items)",
                total_files=count if step == 1 else None,
            )

        # Catch any remaining "N/M: phase" lines (no count visible)
        step_only = re.match(r"(\d+)/(\d+):\s*(.+)", line)
        if step_only:
            step = int(step_only.group(1))
            total_steps = int(step_only.group(2))
            phase = step_only.group(3).strip()
            # Strip leftover progress bar fragments from phase
            phase = re.sub(r"[\[\]<=>]+", "", phase).strip()
            if not phase:
                return None  # pure progress bar fragment
            pct = ((step - 1) / total_steps) * 100
            return ScanProgressInfo(
                percent=round(pct, 1),
                message=f"Step {step}/{total_steps}: {phase}",
            )

        # fclones percentage: "50.3%"
        pct_match = re.search(r"(\d+(?:\.\d+)?)\s*%", line)
        if pct_match:
            pct = float(pct_match.group(1))
            clean = re.sub(r"[\[\]<=>]+", "", line).strip()
            return ScanProgressInfo(percent=pct, message=clean[:100])

        # fclones log: "[timestamp] fclones: info: Found 56 (28.2 GB) files..."
        info_match = re.search(r"fclones:\s*\w+:\s*(.+)", line)
        if info_match:
            msg = info_match.group(1).strip()
            found_match = re.search(r"Found\s+([\d,]+)\s+\(([\d.]+\s*\w+)\)", msg)
            if found_match:
                count = int(found_match.group(1).replace(",", ""))
                size_bytes = _parse_size_string(found_match.group(2))
                return ScanProgressInfo(message=msg, total_files=count, total_size=size_bytes)
            scanned_match = re.search(r"Scanned\s+([\d,]+)", msg)
            if scanned_match:
                count = int(scanned_match.group(1).replace(",", ""))
                return ScanProgressInfo(message=msg, total_files=count)
            redundant_match = re.search(r"Found\s+([\d,]+)\s+.+?redundant", msg)
            if redundant_match:
                return ScanProgressInfo(percent=99.0, message=msg)
            return ScanProgressInfo(message=msg)

        # "Initializing" etc
        if line.lower() in ("initializing", ""):
            return ScanProgressInfo(message=line)

        # Skip pure progress bar fragments and short noise
        if re.match(r"^[\s\[\]<=>\-|#.]+$", line) or len(line) < 4:
            return None

        # Unknown line — return None so it goes to log_buffer instead
        return None
