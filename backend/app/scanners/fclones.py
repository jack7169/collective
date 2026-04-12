"""fclones scanner backend."""
import orjson
import logging
import os
import re
from typing import Iterator, Optional

from app.scanners.base import (
    DuplicateDirResult,
    DuplicateFileResult,
    ScannerBackend,
    ScanProgressInfo,
)

logger = logging.getLogger(__name__)

# Precompiled regexes for progress parsing
_RE_ANSI = re.compile(r"\x1b\[[0-9;]*[a-zA-Z]")
_RE_ANSI2 = re.compile(r"\x1b\[\?[0-9]*[a-zA-Z]")
# Match: "6/6: Grouping by contents  [====>  ]  9.8 GB / 97.8 GB"
_RE_BYTE_PROGRESS = re.compile(
    r"(\d+)/(\d+):\s*(.+?)\s*\[.*?\]\s*([\d.]+)\s*(B|KB|MB|GB|TB)\s*/\s*([\d.]+)\s*(B|KB|MB|TB)"
)
# Match: "1/6: Scanning files  [<===>  ]  12345"
_RE_STEP_COUNT = re.compile(r"(\d+)/(\d+):\s*(.+?)\s*\[.*?\]\s*(\d+)")
# Match: "1/6: Scanning files"
_RE_STEP_ONLY = re.compile(r"(\d+)/(\d+):\s*(.+)")
# Match fclones info log lines
_RE_INFO = re.compile(r"fclones:\s*\w+:\s*(.+)")

_SIZE_MULTIPLIERS = {"B": 1, "KB": 1024, "MB": 1024**2, "GB": 1024**3, "TB": 1024**4}


def _parse_size_string(s: str) -> int:
    m = re.match(r"([\d.]+)\s*(B|KB|MB|GB|TB)", s.strip(), re.IGNORECASE)
    if m:
        return int(float(m.group(1)) * _SIZE_MULTIPLIERS.get(m.group(2).upper(), 1))
    return 0


class FclonesBackend(ScannerBackend):
    def build_command(
        self,
        target_paths: list[str],
        tagged_paths: Optional[list[str]],
        extra_flags: Optional[dict],
        output_path: str,
    ) -> list[str]:
        cmd = ["fclones", "group"]
        cmd.extend(target_paths)
        cmd.extend(["--format", "json", "-o", output_path])

        if extra_flags:
            min_size = extra_flags.get("min_size")
            if min_size:
                cmd.extend(["--min", str(min_size)])
            max_size = extra_flags.get("max_size")
            if max_size:
                cmd.extend(["--max", str(max_size)])
            exclude = extra_flags.get("exclude_patterns", [])
            for pattern in exclude:
                cmd.extend(["--exclude", pattern])
            depth = extra_flags.get("depth")
            if depth:
                cmd.extend(["--depth", str(depth)])

        # Always use cache for faster re-scans
        cmd.append("--cache")
        return cmd

    def parse_output(self, output_path: str) -> Iterator[DuplicateFileResult | DuplicateDirResult]:
        with open(output_path, "rb") as f:
            try:
                data = orjson.loads(f.read())
            except (orjson.JSONDecodeError, ValueError):
                logger.error("Failed to parse fclones output: %s", output_path)
                return

        header = data.get("header", {})
        groups = data.get("groups", []) if isinstance(data, dict) else data

        for group_idx, group in enumerate(groups):
            files = group.get("files", [])
            if not files:
                continue

            checksum = group.get("hash", f"group_{group_idx}")
            file_size = group.get("file_len", 0)
            group_id = f"g{group_idx}"

            for file_idx, file_entry in enumerate(files):
                path = file_entry if isinstance(file_entry, str) else file_entry.get("path", "")
                mtime = None
                if isinstance(file_entry, dict) and "modified" in file_entry:
                    try:
                        from datetime import datetime
                        mtime = datetime.fromisoformat(file_entry["modified"]).timestamp()
                    except (ValueError, TypeError):
                        pass

                yield DuplicateFileResult(
                    checksum=checksum,
                    path=path,
                    size=file_size,
                    mtime=mtime,
                    is_original=(file_idx == 0),
                    group_id=group_id,
                )

    def parse_progress(self, line: str) -> Optional[ScanProgressInfo]:
        """Parse fclones progress output into structured progress info.

        fclones has 6 steps. Steps 1-5 are near-instant. Step 6 (content
        hashing) is where all the time goes and reports byte-level progress
        like "6/6: Grouping by contents [====>] 9.8 GB / 97.8 GB".

        We extract the byte ratio from step 6 for accurate progress, and
        treat steps 1-5 as 0-5% of scanner progress.
        """
        # Strip ANSI escape codes
        line = _RE_ANSI.sub("", line)
        line = _RE_ANSI2.sub("", line)
        line = line.strip()
        if not line:
            return None

        # fclones often concatenates multiple progress updates on one line
        # via carriage returns. Take the LAST step/progress on the line.
        # Split on common step patterns and take the last meaningful one.
        segments = re.split(r"(?=\d/\d+:)", line)
        if len(segments) > 1:
            # Use the last segment that looks like a step
            line = segments[-1].strip()

        # Priority 1: Byte-level progress (step 6 typically)
        # "6/6: Grouping by contents  [====>  ]  9.8 GB / 97.8 GB"
        byte_match = _RE_BYTE_PROGRESS.search(line)
        if byte_match:
            step = int(byte_match.group(1))
            total_steps = int(byte_match.group(2))
            phase = byte_match.group(3).strip()
            current_bytes = float(byte_match.group(4)) * _SIZE_MULTIPLIERS.get(byte_match.group(5).upper(), 1)
            total_bytes = float(byte_match.group(6)) * _SIZE_MULTIPLIERS.get(byte_match.group(7).upper(), 1)

            if total_bytes > 0:
                # Steps 1-5 get 0-5%, step 6 gets 5-100% based on bytes
                byte_pct = current_bytes / total_bytes
                if step == total_steps:
                    pct = 5.0 + byte_pct * 95.0
                else:
                    pct = (step - 1) / total_steps * 5.0

                current_str = f"{byte_match.group(4)} {byte_match.group(5)}"
                total_str = f"{byte_match.group(6)} {byte_match.group(7)}"
                return ScanProgressInfo(
                    percent=round(pct, 1),
                    message=f"Step {step}/{total_steps}: {phase} ({current_str} / {total_str})",
                )

        # Priority 2: Step with item count
        # "1/6: Scanning files  [<===>  ]  12345"
        step_match = _RE_STEP_COUNT.match(line)
        if step_match:
            step = int(step_match.group(1))
            total_steps = int(step_match.group(2))
            phase = step_match.group(3).strip()
            count = int(step_match.group(4))
            # Steps 1-5 are near-instant: map to 0-5%
            pct = min(5.0, (step / total_steps) * 5.0)
            return ScanProgressInfo(
                percent=round(pct, 1),
                message=f"Step {step}/{total_steps}: {phase} ({count:,} items)",
                total_files=count if step <= 2 else None,
            )

        # Priority 3: Step without count
        step_only = _RE_STEP_ONLY.match(line)
        if step_only:
            step = int(step_only.group(1))
            total_steps = int(step_only.group(2))
            phase = step_only.group(3).strip()
            phase = re.sub(r"[\[\]<=>]+", "", phase).strip()
            if not phase:
                return None
            pct = min(5.0, (step / total_steps) * 5.0)
            return ScanProgressInfo(
                percent=round(pct, 1),
                message=f"Step {step}/{total_steps}: {phase}",
            )

        # Priority 4: fclones info log lines (structured events)
        info_match = _RE_INFO.search(line)
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
            if "redundant" in msg:
                return ScanProgressInfo(percent=99.0, message=msg)
            return ScanProgressInfo(message=msg[:100])

        return None
