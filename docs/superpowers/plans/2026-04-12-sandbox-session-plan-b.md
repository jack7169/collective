# Sandbox Session — Plan B: Component Rewiring

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewire all existing components to use sandbox commands instead of direct API calls and local state — so every user decision flows through the unified undo/redo command stack.

**Architecture:** Components call `session.execute({ type: "..." })` instead of calling APIs directly or managing local state. Derived state from the sandbox replaces `useKeeperSelection`, local `promotedHubs`, and local `taggedPaths`. `TagMoveDialog` becomes a command builder. `ReviewApplyDialog` and `useKeeperSelection` are deleted.

**Tech Stack:** React context (`useSandbox` hook), existing sandbox command types from Plan A

**Depends on:** Plan A (complete — sandbox infrastructure is deployed)

---

## File Structure

| File | Action | Change |
|---|---|---|
| `frontend/src/components/results/SimilarDirectoriesTab.tsx` | Modify | Use sandbox for promotedHubs, taggedOriginals; remove local state |
| `frontend/src/components/results/DirectoryHubCard.tsx` | Modify | Add mark-delete on peers; sandbox-aware tag/promote |
| `frontend/src/components/results/TagMoveDialog.tsx` | Modify | Stage commands instead of executing API calls |
| `frontend/src/components/results/DuplicateGroupsList.tsx` | Modify | Replace useKeeperSelection with useSandbox |
| `frontend/src/hooks/useKeeperSelection.ts` | Delete | Replaced by sandbox derived state |
| `frontend/src/components/results/ReviewApplyDialog.tsx` | Delete | Replaced by SessionSummaryBar |

---

### Task 1: Rewire SimilarDirectoriesTab to Use Sandbox

**Files:**
- Modify: `frontend/src/components/results/SimilarDirectoriesTab.tsx`

- [ ] **Step 1: Read the current file**

Read `frontend/src/components/results/SimilarDirectoriesTab.tsx` to understand all state and callbacks.

- [ ] **Step 2: Replace local state with sandbox**

Replace the imports — add `useSandbox`:

```typescript
import { useSandbox } from "@/hooks/useSandboxSession";
```

Remove the import for `useTagOriginals` and `useTaggedOriginals` from `@/api/results` (these are no longer called directly).

In the component body, add:

```typescript
const session = useSandbox();
```

**Remove these local state declarations:**
- `const [promotedHubs, setPromotedHubs] = useState<Set<string>>(new Set());`

**Remove these hooks:**
- `const { data: tagData } = useTaggedOriginals(scanId);`
- `const tagMutation = useTagOriginals(scanId);`
- `const taggedPaths = useMemo(() => new Set(tagData?.tagged_paths ?? []), [tagData]);`

**Replace with sandbox-derived equivalents:**
- `taggedPaths` → `session.derived.taggedOriginals`
- `promotedHubs` → `session.derived.promotedHubs`

**Update `groupIntoHubs` call:**

```typescript
const hubs = useMemo(() => {
  const prefs = session.derived.promotedHubs;
  const grouped = groupIntoHubs(pairs, prefs.size > 0 ? prefs : undefined);
  // ... existing sort logic unchanged
  return grouped;
}, [pairs, sortBy, session.derived.promotedHubs]);
```

**Update `handleSkipMove`:**

```typescript
const handleSkipMove = (hubDir: string) => {
  session.execute({ type: "tag-original", directory: hubDir });
};
```

**Update `handlePromotePeer`:**

```typescript
const handlePromotePeer = (peerDir: string) => {
  session.execute({ type: "promote-hub", peerDir });
};
```

**Update `isTagged` prop on DirectoryHubCard:**

```typescript
isTagged={session.derived.taggedOriginals.has(hub.directory)}
```

**Keep `handleTagMove` unchanged** — it opens the TagMoveDialog which we'll rewire in Task 3.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/jackf/Documents/Development/Collective/frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Verify frontend builds**

Run: `cd /Users/jackf/Documents/Development/Collective/frontend && npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/results/SimilarDirectoriesTab.tsx
git commit -m "refactor(sandbox): SimilarDirectoriesTab uses sandbox for promote/tag"
```

---

### Task 2: Add Mark-for-Delete on DirectoryHubCard Peers

**Files:**
- Modify: `frontend/src/components/results/DirectoryHubCard.tsx`

- [ ] **Step 1: Read the current file**

Read `frontend/src/components/results/DirectoryHubCard.tsx` to understand the peer row rendering.

- [ ] **Step 2: Add sandbox integration and mark-delete button**

Add import:

```typescript
import { useSandbox } from "@/hooks/useSandboxSession";
import { Trash2 } from "lucide-react";  // add to existing lucide import
```

In the component body:

```typescript
const session = useSandbox();
```

On each peer row (inside the `hub.peers.map` block), add a "Mark for Delete" button next to the promote button. Find the promote button (the `ArrowUpToLine` button) and add BEFORE it:

```typescript
{session.derived.markedForDelete.has(peer.directory) ? (
  <Button
    variant="ghost"
    size="sm"
    className="text-xs shrink-0 text-destructive"
    onClick={(e) => {
      e.stopPropagation();
      session.execute({ type: "unmark-delete", directory: peer.directory });
    }}
    title="Unmark — will not be deleted"
  >
    <Trash2 className="h-3.5 w-3.5" />
  </Button>
) : (
  <Button
    variant="ghost"
    size="sm"
    className="text-xs shrink-0 text-muted-foreground hover:text-destructive"
    onClick={(e) => {
      e.stopPropagation();
      session.execute({
        type: "mark-delete",
        directory: peer.directory,
        reason: `Duplicate of ${hub.directory}`,
      });
    }}
    title="Mark for deletion"
  >
    <Trash2 className="h-3.5 w-3.5" />
  </Button>
)}
```

Also add a visual indicator on the peer row when it's marked for deletion. On the peer row's outer div, add a conditional class:

```typescript
className={cn(
  "px-5 py-3.5 cursor-pointer hover:bg-accent/50 transition-colors",
  session.derived.markedForDelete.has(peer.directory) && "bg-destructive/5 border-l-2 border-destructive/30"
)}
```

- [ ] **Step 3: Verify TypeScript compiles and builds**

Run: `cd /Users/jackf/Documents/Development/Collective/frontend && npx tsc --noEmit && npm run build 2>&1 | tail -5`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/results/DirectoryHubCard.tsx
git commit -m "feat(sandbox): mark-for-delete on hub peers with visual indicator"
```

---

### Task 3: TagMoveDialog Becomes a Command Builder

**Files:**
- Modify: `frontend/src/components/results/TagMoveDialog.tsx`

- [ ] **Step 1: Read the current file**

Read `frontend/src/components/results/TagMoveDialog.tsx` fully.

- [ ] **Step 2: Replace API execution with sandbox commands**

The current dialog creates a mutation that calls 3 API endpoints (tag originals, create move action, create delete actions for peers). Replace this with sandbox commands.

Add import:

```typescript
import { useSandbox } from "@/hooks/useSandboxSession";
```

In the component body:

```typescript
const session = useSandbox();
```

**Replace the `executeMutation`** (which called APIs) with a simple handler:

```typescript
const handleApply = () => {
  // Tag hub as original
  session.execute({ type: "tag-original", directory: hubDirectory });

  // Set move destination (if selected)
  if (dest) {
    session.execute({ type: "set-move-dest", sourceDir: hubDirectory, destDir: dest });
  }

  // Mark all peers for deletion
  for (const peer of peers) {
    session.execute({
      type: "mark-delete",
      directory: peer.directory,
      reason: `Duplicate of ${hubDirectory}`,
    });
  }

  onOpenChange(false);
};
```

**Remove the `useMutation` import** and `useQueryClient` import (no longer needed).
**Remove the `executeMutation` state** and all references to `executeMutation.isPending`, `executeMutation.isSuccess`.

**Simplify the dialog content** — remove the success state (no async operation, commands are instant). Remove the loading state. The dialog just shows: source, destination picker, preview, and a "Confirm" button that stages the commands and closes.

**Update the confirm button:**

```typescript
<Button onClick={handleApply} disabled={!dest}>
  <FolderOutput className="h-4 w-4" />
  Stage Move & Delete
</Button>
```

Change the button text from "Move & Delete Peers" to "Stage Move & Delete" — nothing executes until the user commits the session.

- [ ] **Step 3: Verify TypeScript compiles and builds**

Run: `cd /Users/jackf/Documents/Development/Collective/frontend && npx tsc --noEmit && npm run build 2>&1 | tail -5`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/results/TagMoveDialog.tsx
git commit -m "refactor(sandbox): TagMoveDialog stages commands instead of executing"
```

---

### Task 4: Rewire DuplicateGroupsList to Use Sandbox

**Files:**
- Modify: `frontend/src/components/results/DuplicateGroupsList.tsx`

This is the most complex rewiring — it replaces `useKeeperSelection` with sandbox commands.

- [ ] **Step 1: Read the current file**

Read `frontend/src/components/results/DuplicateGroupsList.tsx` fully. Pay close attention to how `useKeeperSelection` is used — every call to `selection.setKeeper()`, `selection.clearKeeper()`, etc. needs to become a `session.execute()` call.

- [ ] **Step 2: Replace useKeeperSelection with useSandbox**

Add import:

```typescript
import { useSandbox } from "@/hooks/useSandboxSession";
```

Remove import of `useKeeperSelection` from `@/hooks/useKeeperSelection`.
Remove import of `ReviewApplyDialog` from `./ReviewApplyDialog`.

Replace the `useKeeperSelection` call:

```typescript
// OLD:
const selection = useKeeperSelection(groups);
// NEW:
const session = useSandbox();
```

**Replace all selection method calls:**

- `selection.setKeeper(checksum, fileId)` → `session.execute({ type: "set-keeper", checksum, fileId })`
- `selection.clearKeeper(checksum)` → `session.execute({ type: "clear-keeper", checksum })`
- `selection.acceptSuggestion(checksum)` → find the suggestion's fileId and `session.execute({ type: "accept-suggestion", checksum, fileId: suggestion.suggestedFileId })`
- `selection.acceptAllSuggestions()` → build the suggestions array and `session.execute({ type: "accept-all-suggestions", suggestions: [...] })`

**Replace selection state reads:**

- `selection.keepers` → `session.derived.keepers`
- `selection.decisions` → compute inline or via useMemo from `session.derived.keepers` and `groups`
- `selection.resolvedCount` → `session.derived.keepers.size`
- `selection.totalReclaimable` → compute from derived keepers + groups data
- `selection.totalDeleteFiles` → compute from derived keepers + groups data
- `selection.unresolvedSuggestionCount` → compute from suggestions not in keepers

**Handle suggestions:** The `suggestMutation` and `selection.updateSuggestions()` pattern stays, but suggestions are stored locally (useState) since they're server-computed recommendations, not user decisions. Only the acceptance of a suggestion becomes a sandbox command.

Keep a local `suggestions: Map<string, SuggestedKeeper>` state for the suggestion data from the API. When user accepts, dispatch the sandbox command.

**Remove the ReviewApplyDialog** rendering and its props. The "Apply to Disk" flow is now handled by the SessionSummaryBar's "Commit" button (already wired in Plan A).

**Remove the `executeMutation`** that created delete actions — no longer needed, handled by atomic commit.

**Keep the toolbar stats** (resolved count, reclaimable space) but compute from sandbox derived state.

- [ ] **Step 3: Verify TypeScript compiles and builds**

Run: `cd /Users/jackf/Documents/Development/Collective/frontend && npx tsc --noEmit && npm run build 2>&1 | tail -5`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/results/DuplicateGroupsList.tsx
git commit -m "refactor(sandbox): DuplicateGroupsList uses sandbox for keeper decisions"
```

---

### Task 5: Delete useKeeperSelection and ReviewApplyDialog

**Files:**
- Delete: `frontend/src/hooks/useKeeperSelection.ts`
- Delete: `frontend/src/components/results/ReviewApplyDialog.tsx`

- [ ] **Step 1: Verify no remaining imports**

Search the codebase for any remaining references:

```bash
cd /Users/jackf/Documents/Development/Collective/frontend && grep -r "useKeeperSelection\|ReviewApplyDialog" src/ --include="*.ts" --include="*.tsx"
```

Expected: No results (all references removed in Tasks 1-4).

If references remain, they must be removed before proceeding.

- [ ] **Step 2: Delete the files**

```bash
rm frontend/src/hooks/useKeeperSelection.ts
rm frontend/src/components/results/ReviewApplyDialog.tsx
```

- [ ] **Step 3: Verify frontend builds**

Run: `cd /Users/jackf/Documents/Development/Collective/frontend && npm run build 2>&1 | tail -5`
Expected: Build succeeds with no errors

- [ ] **Step 4: Commit**

```bash
git add -u frontend/src/hooks/useKeeperSelection.ts frontend/src/components/results/ReviewApplyDialog.tsx
git commit -m "chore: delete useKeeperSelection and ReviewApplyDialog (replaced by sandbox)"
```

---

### Task 6: Build Frontend, Deploy, and Verify

**Files:** None (deployment)

- [ ] **Step 1: Run full frontend build**

```bash
cd /Users/jackf/Documents/Development/Collective/frontend && npm run build
```

- [ ] **Step 2: Run backend tests**

```bash
cd /Users/jackf/Documents/Development/Collective/backend && python -m pytest tests/ -v 2>&1 | tail -10
```

- [ ] **Step 3: Push**

```bash
git push origin main
```

- [ ] **Step 4: Deploy**

```bash
rsync -avz --exclude=node_modules --exclude=.git --exclude=__pycache__ --exclude='*.pyc' --exclude=dist --exclude=.venv /Users/jackf/Documents/Development/Collective/ root@192.168.50.45:/tmp/collective-build/
ssh root@192.168.50.45 "cd /tmp/collective-build && docker build --no-cache -f docker/Dockerfile -t collective:latest ."
ssh root@192.168.50.45 "docker stop collective && docker rm collective && docker run -d --name collective --restart unless-stopped -p 8080:8080 -v /mnt/user:/mnt/user -v /mnt/user/appdata/collective:/data collective:latest"
```

- [ ] **Step 5: Verify**

```bash
ssh root@192.168.50.45 "docker logs collective --tail 15 2>&1"
curl -s http://192.168.50.45:8080/api/system/health | python3 -m json.tool
```

Expected: All processes running, health OK.

- [ ] **Step 6: Test the sandbox flow**

Open a completed scan in the browser. Test:
1. Similar Directories tab → click "Promote" on a peer → summary bar appears with "1 change"
2. Click undo → summary bar disappears
3. Click redo → summary bar reappears
4. Tag & Move → select destination → "Stage Move & Delete" → summary bar shows multiple changes
5. Duplicate Files tab → pick a keeper → summary bar updates
6. Refresh page → session restored from backend/localStorage
