import { useNavigate } from "react-router-dom";
import { useDeleteScan } from "@/api/scans";
import { ConfirmDialog } from "./ConfirmDialog";

interface DeleteScanDialogProps {
  scanId: string | number | null;
  onClose: () => void;
  navigateOnSuccess?: string;
  onSuccess?: () => void;
}

export function DeleteScanDialog({
  scanId,
  onClose,
  navigateOnSuccess,
  onSuccess,
}: DeleteScanDialogProps) {
  const deleteScan = useDeleteScan();
  const navigate = useNavigate();

  return (
    <ConfirmDialog
      open={scanId !== null}
      onOpenChange={(open) => {
        if (!open && !deleteScan.isPending) onClose();
      }}
      title="Delete Scan"
      description={
        deleteScan.isPending
          ? "Deleting scan data... This may take a moment for large scans."
          : "Are you sure? This will delete the scan and all its results."
      }
      confirmLabel={deleteScan.isPending ? "Deleting..." : "Delete"}
      variant="destructive"
      isPending={deleteScan.isPending}
      onConfirm={() => {
        if (scanId && !deleteScan.isPending) {
          deleteScan.mutate(String(scanId), {
            onSuccess: () => {
              onClose();
              onSuccess?.();
              if (navigateOnSuccess) navigate(navigateOnSuccess);
            },
          });
        }
      }}
    />
  );
}
