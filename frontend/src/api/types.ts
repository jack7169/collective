export interface Scan {
  id: number;
  saved_scan_id?: number | null;
  name: string;
  status: "pending" | "running" | "parsing" | "analyzing" | "completed" | "failed" | "cancelled" | "interrupted";
  scanner: "rmlint" | "fclones";
  target_paths: string[];
  tagged_paths?: string[] | null;
  scanner_flags?: Record<string, unknown> | null;
  scan_depth?: number | null;
  similarity_threshold: number;
  total_files?: number | null;
  total_dirs?: number | null;
  total_size?: number | null;
  duplicates_found?: number | null;
  space_recoverable?: number | null;
  started_at?: string | null;
  completed_at?: string | null;
  error_message?: string | null;
  created_at: string;
  progress_percent?: number | null;
  progress_message?: string | null;
  interrupted_phase?: string | null;
}

export interface ScanStats {
  scan_id: number;
  total_files: number;
  total_duplicates: number;
  space_recoverable: number;
  similar_directory_pairs: number;
  top_groups_by_size: Array<{ group_id: string; file_count: number; total_size: number }>;
  scan_status: string;
  scan_total_files: number | null;
  scan_total_size: number | null;
}

export interface CreateScanRequest {
  name: string;
  scanner: "rmlint" | "fclones";
  target_paths: string[];
  tagged_paths?: string[];
  scan_depth?: number;
  similarity_threshold?: number;
  scanner_flags?: Record<string, unknown>;
}

export interface ScanProgress {
  scan_id: number;
  status: string;
  progress_percent: number | null;
  progress_message: string | null;
  total_files: number | null;
  total_dirs: number | null;
  total_size: number | null;
  duplicates_found: number | null;
  elapsed_seconds: number | null;     // Current run
  total_elapsed_seconds: number | null; // All runs combined
  started_at: string | null;
}

export interface DuplicateFile {
  id: number;
  scan_id: number;
  checksum: string;
  path: string;
  size: number;
  mtime: number | null;
  is_original: boolean;
  group_id: string | null;
}

export interface DirectorySimilarity {
  id: number;
  scan_id: number;
  dir_a: string;
  dir_b: string;
  files_a: number;
  files_b: number;
  shared_files: number;
  shared_size: number;
  size_a: number;
  size_b: number;
  jaccard_similarity: number;
  a_subset_pct: number;
  b_subset_pct: number;
  structural_similarity?: number | null;
  unique_to_a: number;
  unique_to_b: number;
  relationship?: string | null;
}

export interface DirectorySimilarityFilters {
  min_similarity?: number;
  sort_by?: string;
  sort_order?: "asc" | "desc";
  relationship?: string;
  page?: number;
  per_page?: number;
}

export interface CompareResult {
  dir_a: string;
  dir_b: string;
  shared_files: CompareFile[];
  only_in_a: CompareFile[];
  only_in_b: CompareFile[];
  shared_size: number;
  only_a_size: number;
  only_b_size: number;
}

export interface CompareFile {
  name: string;
  path: string;
  size: number;
  mtime: string;
  checksum: string;
}

export interface Action {
  id: number;
  scan_id?: number | null;
  similarity_id?: number | null;
  action_type: string;
  source_path: string;
  dest_path?: string | null;
  status: "planned" | "dry_run" | "confirmed" | "executing" | "completed" | "failed";
  dry_run_output?: string | null;
  files_affected?: number | null;
  bytes_affected?: number | null;
  error_message?: string | null;
  notes?: string | null;
  created_at: string;
  executed_at?: string | null;
}

export interface CreateActionRequest {
  scan_id?: number;
  action_type: string;
  source_path: string;
  dest_path?: string;
  notes?: string;
}

export interface BrowseResult {
  path: string;
  entries: BrowseEntry[];
}

export interface BrowseEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  mtime: string;
}

export interface SystemHealth {
  status: string;
  scanners: Record<string, boolean>;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

// Tree diff types for side-by-side directory comparison
export interface TreeDiffNode {
  name: string;
  status: "both" | "only_a" | "only_b";
  is_dir: boolean;
  size_a?: number;
  size_b?: number;
  match?: "size_match" | "name_only";
  similarity?: number;
  children?: TreeDiffNode[];
}

export interface TreeDiffResult {
  dir_a: string;
  dir_b: string;
  tree: TreeDiffNode[];
  stats: {
    both: number;
    only_a: number;
    only_b: number;
  };
}

// File operations for filesystem management
export interface FileOperation {
  operation: "move" | "copy" | "delete" | "hardlink" | "symlink";
  source_path: string;
  dest_path?: string;
}

export interface FileOpResult {
  source: string;
  dest?: string;
  operation: string;
  status: "success" | "error" | "dry_run";
  message?: string;
}

// Grouped duplicate files for Czkawka-style view
export interface DuplicateFileInGroup {
  id: number;
  path: string;
  size: number;
  mtime: number | null;
  is_original: boolean;
}

export interface DuplicateGroup {
  checksum: string;
  group_id: string | null;
  file_count: number;
  total_size: number;
  files: DuplicateFileInGroup[];
}

// Assimilate session types
export interface AssimilateSession {
  id: number;
  scan_id: number;
  name: string;
  status: "working" | "previewing" | "committing" | "committed" | "failed";
  dir_a: string;
  dir_b: string;
  staged_operations: StagedOperation[];
  warnings_acknowledged: string[];
  preview_result: AssimilatePreview | null;
  created_at: string | null;
  updated_at: string | null;
  committed_at: string | null;
  error_message: string | null;
  files_affected: number | null;
  bytes_affected: number | null;
}

export interface StagedOperation {
  type: "copy" | "move" | "delete";
  source: string;
  dest?: string;
  description?: string;
}

export interface AssimilatePreview {
  operations_count: number;
  operations: StagedOperation[];
  checksums_total: number;
  checksums_preserved: number;
  checksums_lost: number;
  warnings: AssimilateWarning[];
  all_acknowledged: boolean;
  bytes_affected: number;
  ready_to_commit: boolean;
}

export interface AssimilateWarning {
  checksum: string;
  files: string[];
  acknowledged: boolean;
}

// Scheduler types (legacy — kept for compat)
export interface ScanSchedule {
  id: number;
  name: string;
  scanner: "rmlint" | "fclones";
  target_paths: string[];
  tagged_paths?: string[];
  interval: "hourly" | "daily" | "weekly" | "monthly" | "once";
  interval_value: number;
  similarity_threshold: number;
  scan_depth?: number;
  enabled: boolean;
  last_run?: string;
  scheduled_at?: string;
}

// Saved Scans — persistent scan configs with scheduling
export interface SavedScan {
  id: number;
  name: string;
  description?: string | null;
  scanner: string;
  target_paths: string[];
  tagged_paths?: string[] | null;
  scanner_flags?: Record<string, unknown> | null;
  scan_depth?: number | null;
  similarity_threshold: number;
  schedule_enabled: boolean;
  schedule_interval?: string | null;
  schedule_interval_value: number;
  schedule_day_of_week?: number | null;
  schedule_hour: number;
  last_run_at?: string | null;
  next_run_at?: string | null;
  last_scan_id?: number | null;
  total_runs: number;
  last_total_files?: number | null;
  last_duplicates_found?: number | null;
  last_space_recoverable?: number | null;
  created_at: string;
  updated_at?: string | null;
}
