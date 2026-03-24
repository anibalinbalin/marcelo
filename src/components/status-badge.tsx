import { Badge } from "@/components/ui/badge";

const STATUS_CONFIG: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string; className?: string }> = {
  pending: { variant: "secondary", label: "Pending" },
  extracted: { variant: "outline", label: "Extracted", className: "text-yellow-500 border-yellow-500/30" },
  validated: { variant: "outline", label: "Validated", className: "text-blue-400 border-blue-400/30" },
  approved: { variant: "default", label: "Approved", className: "bg-emerald-600 text-white" },
  written: { variant: "default", label: "Written", className: "bg-emerald-700 text-white" },
  error: { variant: "destructive", label: "Error" },
  cancelled: { variant: "secondary", label: "Cancelled", className: "line-through opacity-60" },
};

export function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? { variant: "secondary" as const, label: status };
  return (
    <Badge variant={config.variant} className={config.className}>
      {config.label}
    </Badge>
  );
}
