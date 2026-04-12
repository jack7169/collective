export interface AssimilateOp {
  type: "copy" | "move" | "delete" | "hardlink" | "symlink";
  sourcePath: string;
  destPath?: string;
}

export type SandboxCommand =
  | { type: "promote-hub"; peerDir: string }
  | { type: "tag-original"; directory: string }
  | { type: "untag-original"; directory: string }
  | { type: "mark-delete"; directory: string; reason: string }
  | { type: "unmark-delete"; directory: string }
  | { type: "set-move-dest"; sourceDir: string; destDir: string }
  | { type: "set-keeper"; checksum: string; fileId: number }
  | { type: "clear-keeper"; checksum: string }
  | { type: "accept-suggestion"; checksum: string; fileId: number }
  | { type: "accept-all-suggestions"; suggestions: Array<{ checksum: string; fileId: number }> }
  | { type: "stage-assimilate-op"; sessionKey: string; op: AssimilateOp }
  | { type: "unstage-assimilate-op"; sessionKey: string; opIndex: number };

export interface DerivedSandboxState {
  promotedHubs: Set<string>;
  taggedOriginals: Set<string>;
  markedForDelete: Map<string, string>;
  moveDestinations: Map<string, string>;
  keepers: Map<string, number>;
  assimilateOps: Map<string, AssimilateOp[]>;
}

export function deriveState(commands: SandboxCommand[]): DerivedSandboxState {
  const state: DerivedSandboxState = {
    promotedHubs: new Set(),
    taggedOriginals: new Set(),
    markedForDelete: new Map(),
    moveDestinations: new Map(),
    keepers: new Map(),
    assimilateOps: new Map(),
  };

  for (const cmd of commands) {
    switch (cmd.type) {
      case "promote-hub":
        state.promotedHubs.add(cmd.peerDir);
        break;

      case "tag-original":
        state.taggedOriginals.add(cmd.directory);
        break;

      case "untag-original":
        state.taggedOriginals.delete(cmd.directory);
        break;

      case "mark-delete":
        state.markedForDelete.set(cmd.directory, cmd.reason);
        break;

      case "unmark-delete":
        state.markedForDelete.delete(cmd.directory);
        break;

      case "set-move-dest":
        state.moveDestinations.set(cmd.sourceDir, cmd.destDir);
        break;

      case "set-keeper":
        state.keepers.set(cmd.checksum, cmd.fileId);
        break;

      case "clear-keeper":
        state.keepers.delete(cmd.checksum);
        break;

      case "accept-suggestion":
        state.keepers.set(cmd.checksum, cmd.fileId);
        break;

      case "accept-all-suggestions":
        for (const { checksum, fileId } of cmd.suggestions) {
          if (!state.keepers.has(checksum)) {
            state.keepers.set(checksum, fileId);
          }
        }
        break;

      case "stage-assimilate-op": {
        const existing = state.assimilateOps.get(cmd.sessionKey) ?? [];
        state.assimilateOps.set(cmd.sessionKey, [...existing, cmd.op]);
        break;
      }

      case "unstage-assimilate-op": {
        const ops = state.assimilateOps.get(cmd.sessionKey);
        if (ops != null) {
          const updated = ops.filter((_, i) => i !== cmd.opIndex);
          state.assimilateOps.set(cmd.sessionKey, updated);
        }
        break;
      }
    }
  }

  return state;
}

export function commandLabel(cmd: SandboxCommand): string {
  switch (cmd.type) {
    case "promote-hub":
      return `Promote hub: ${cmd.peerDir.split("/").pop() ?? cmd.peerDir}`;

    case "tag-original":
      return `Tag original: ${cmd.directory.split("/").pop() ?? cmd.directory}`;

    case "untag-original":
      return `Untag original: ${cmd.directory.split("/").pop() ?? cmd.directory}`;

    case "mark-delete":
      return `Delete: ${cmd.directory.split("/").pop() ?? cmd.directory}`;

    case "unmark-delete":
      return `Unmark delete: ${cmd.directory.split("/").pop() ?? cmd.directory}`;

    case "set-move-dest":
      return `Move ${cmd.sourceDir.split("/").pop() ?? cmd.sourceDir} → ${cmd.destDir.split("/").pop() ?? cmd.destDir}`;

    case "set-keeper":
      return `Keep file #${cmd.fileId} (${cmd.checksum.slice(0, 8)})`;

    case "clear-keeper":
      return `Clear keeper: ${cmd.checksum.slice(0, 8)}`;

    case "accept-suggestion":
      return `Accept suggestion: keep file #${cmd.fileId} (${cmd.checksum.slice(0, 8)})`;

    case "accept-all-suggestions":
      return `Accept all suggestions (${cmd.suggestions.length})`;

    case "stage-assimilate-op":
      return `Stage ${cmd.op.type}: ${cmd.op.sourcePath.split("/").pop() ?? cmd.op.sourcePath}`;

    case "unstage-assimilate-op":
      return `Unstage op #${cmd.opIndex} from ${cmd.sessionKey}`;
  }
}
