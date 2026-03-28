import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronDown,
  ChevronUp,
  Play,
} from "lucide-react";
import { useCreateScan } from "@/api/scans";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { PathPicker } from "@/components/scan/PathPicker";

export function NewScan() {
  const navigate = useNavigate();
  const createScan = useCreateScan();

  const [name, setName] = useState("");
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [depth, setDepth] = useState(5);
  const [threads, setThreads] = useState(0); // 0 = all cores
  const [customFlags, setCustomFlags] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || selectedPaths.length === 0) return;

    try {
      const scan = await createScan.mutateAsync({
        name: name.trim(),
        scanner: "fclones",
        target_paths: selectedPaths,
        scan_depth: depth,
        // Low threshold to capture everything — user filters post-scan
        similarity_threshold: 10,
        scanner_flags: {
          ...(threads > 0 ? { threads: String(threads) } : {}),
          ...(customFlags.trim() ? { custom: customFlags.trim() } : {}),
        },
      });
      navigate(`/scans/${scan.id}/progress`);
    } catch {
      // Error handled by mutation state
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New Scan</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Select directories to scan for duplicate files and similar directories.
          Uses multi-threaded hashing with automatic directory similarity analysis.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Scan name */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Scan Name</CardTitle>
            <CardDescription>
              Give this scan a descriptive name
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Input
              placeholder="e.g., Media server cleanup"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-10"
              required
            />
          </CardContent>
        </Card>

        {/* Path picker */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Scan Paths</CardTitle>
            <CardDescription>
              Select directories to scan for duplicates
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PathPicker
              selectedPaths={selectedPaths}
              onChange={setSelectedPaths}
            />
          </CardContent>
        </Card>

        {/* Advanced options */}
        <Card>
          <CardHeader>
            <button
              type="button"
              className="flex w-full items-center justify-between"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              <div className="text-left">
                <CardTitle className="text-base">Advanced Options</CardTitle>
                <CardDescription>
                  CPU threads, similarity depth, and custom flags
                </CardDescription>
              </div>
              {showAdvanced ? (
                <ChevronUp className="h-5 w-5 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-5 w-5 text-muted-foreground" />
              )}
            </button>
          </CardHeader>
          {showAdvanced && (
            <CardContent className="space-y-6">
              {/* CPU Threads */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">CPU Threads</label>
                  <span className="text-sm text-muted-foreground">
                    {threads === 0 ? "All cores" : threads}
                  </span>
                </div>
                <Slider
                  value={[threads]}
                  onValueChange={([v]) => setThreads(v ?? 0)}
                  min={0}
                  max={16}
                  step={1}
                />
                <p className="text-xs text-muted-foreground">
                  Number of CPU threads for file hashing. 0 = use all available cores.
                </p>
              </div>

              <Separator />

              {/* Scan depth */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Similarity Depth</label>
                  <span className="text-sm text-muted-foreground">
                    {depth}
                  </span>
                </div>
                <Slider
                  value={[depth]}
                  onValueChange={([v]) => setDepth(v ?? 5)}
                  min={1}
                  max={10}
                  step={1}
                />
                <p className="text-xs text-muted-foreground">
                  Directory depth for similarity grouping. Higher = more
                  granular comparison of nested folders.
                </p>
              </div>

              <Separator />

              {/* Custom flags */}
              <div className="space-y-3">
                <label className="text-sm font-medium">Custom Scanner Flags</label>
                <textarea
                  value={customFlags}
                  onChange={(e) => setCustomFlags(e.target.value)}
                  placeholder="e.g., --min-size 1M --max-size 10G"
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Additional flags passed to the scanner. See fclones documentation for options.
                </p>
              </div>
            </CardContent>
          )}
        </Card>

        {/* Submit */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {selectedPaths.length === 0
              ? "Select at least one path to scan"
              : `${selectedPaths.length} path${selectedPaths.length > 1 ? "s" : ""} selected`}
          </p>
          <Button
            type="submit"
            size="lg"
            disabled={
              !name.trim() ||
              selectedPaths.length === 0 ||
              createScan.isPending
            }
          >
            {createScan.isPending ? (
              "Starting scan..."
            ) : (
              <>
                <Play className="h-5 w-5" />
                Start Scan
              </>
            )}
          </Button>
        </div>

        {createScan.isError && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            Failed to start scan. Please check your configuration and try again.
          </div>
        )}
      </form>
    </div>
  );
}
