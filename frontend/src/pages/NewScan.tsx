import { useNavigate } from "react-router-dom";
import {
  ChevronDown,
  ChevronUp,
  Play,
} from "lucide-react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
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
import { toast } from "sonner";

const scanSchema = z.object({
  name: z.string().min(1, "Scan name is required").max(200),
  selectedPaths: z.array(z.string()).min(1, "Select at least one path"),
  depth: z.number().min(1).max(10),
  threads: z.number().min(0).max(16),
  customFlags: z.string().optional(),
});

type ScanFormData = z.infer<typeof scanSchema>;

export function NewScan() {
  const navigate = useNavigate();
  const createScan = useCreateScan();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useForm<ScanFormData>({
    resolver: zodResolver(scanSchema),
    defaultValues: {
      name: "",
      selectedPaths: [],
      depth: 5,
      threads: 0,
      customFlags: "",
    },
  });

  const selectedPaths = watch("selectedPaths");
  const threads = watch("threads");

  const onSubmit = async (data: ScanFormData) => {
    try {
      const scan = await createScan.mutateAsync({
        name: data.name.trim(),
        scanner: "fclones",
        target_paths: data.selectedPaths,
        scan_depth: data.depth,
        similarity_threshold: 10,
        scanner_flags: {
          ...(data.threads > 0 ? { threads: String(data.threads) } : {}),
          ...(data.customFlags?.trim() ? { custom: data.customFlags.trim() } : {}),
        },
      });
      toast.success("Scan started");
      navigate(`/scans/${scan.id}/progress`);
    } catch {
      toast.error("Failed to start scan");
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

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Scan name */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Scan Name</CardTitle>
            <CardDescription>Give this scan a descriptive name</CardDescription>
          </CardHeader>
          <CardContent>
            <Input
              placeholder="e.g., Media server cleanup"
              {...register("name")}
              className="h-10"
            />
            {errors.name && (
              <p className="text-xs text-destructive mt-1">{errors.name.message}</p>
            )}
          </CardContent>
        </Card>

        {/* Path picker */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Scan Paths</CardTitle>
            <CardDescription>Select directories to scan for duplicates</CardDescription>
          </CardHeader>
          <CardContent>
            <Controller
              name="selectedPaths"
              control={control}
              render={({ field }) => (
                <PathPicker
                  selectedPaths={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            {errors.selectedPaths && (
              <p className="text-xs text-destructive mt-1">{errors.selectedPaths.message}</p>
            )}
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
                <CardDescription>CPU threads, similarity depth, and custom flags</CardDescription>
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
                <Controller
                  name="threads"
                  control={control}
                  render={({ field }) => (
                    <Slider
                      value={[field.value]}
                      onValueChange={([v]) => field.onChange(v ?? 0)}
                      min={0}
                      max={16}
                      step={1}
                    />
                  )}
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
                  <Controller
                    name="depth"
                    control={control}
                    render={({ field }) => (
                      <span className="text-sm text-muted-foreground">{field.value}</span>
                    )}
                  />
                </div>
                <Controller
                  name="depth"
                  control={control}
                  render={({ field }) => (
                    <Slider
                      value={[field.value]}
                      onValueChange={([v]) => field.onChange(v ?? 5)}
                      min={1}
                      max={10}
                      step={1}
                    />
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  Directory depth for similarity grouping. Higher = more granular comparison.
                </p>
              </div>

              <Separator />

              {/* Custom flags */}
              <div className="space-y-3">
                <label className="text-sm font-medium">Custom Scanner Flags</label>
                <textarea
                  {...register("customFlags")}
                  placeholder="e.g., --min 1M --max 10G"
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
            disabled={createScan.isPending}
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
      </form>
    </div>
  );
}
