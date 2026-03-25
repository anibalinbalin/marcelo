"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ReviewTable,
  type ExtractedValueWithMapping,
} from "@/components/review-table";
import { ApprovalBar } from "@/components/approval-bar";
import { approveValues } from "@/app/actions/runs";
import {
  ArrowLeftIcon,
  AlertCircleIcon,
  CheckCircle2Icon,
  FileSpreadsheetIcon,
} from "lucide-react";

interface ReviewClientProps {
  company: { id: number; name: string; ticker: string };
  run: {
    id: number;
    quarter: string;
    status: string;
    approvedBy: string | null;
    approvedAt: string | null;
    outputFileUrl: string | null;
  };
  values: ExtractedValueWithMapping[];
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "pending":
      return (
        <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/25">
          Pending
        </Badge>
      );
    case "extracted":
    case "validated":
      return (
        <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/25">
          Ready for Review
        </Badge>
      );
    case "approved":
      return (
        <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/25">
          Approved
        </Badge>
      );
    case "error":
      return <Badge variant="destructive">Error</Badge>;
    case "cancelled":
      return <Badge variant="secondary">Cancelled</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

export function ReviewClient({ company, run, values }: ReviewClientProps) {
  const router = useRouter();
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(true);
  const [analystName, setAnalystName] = useState("");
  const [overrides, setOverrides] = useState<Map<number, string>>(new Map());
  const [isApproving, setIsApproving] = useState(false);
  const [localStatus, setLocalStatus] = useState(run.status);
  const [localApprovedBy, setLocalApprovedBy] = useState(run.approvedBy);

  // Group values by target sheet
  const sheets = useMemo(() => {
    const map = new Map<string, ExtractedValueWithMapping[]>();
    for (const v of values) {
      const existing = map.get(v.targetSheet) ?? [];
      existing.push(v);
      map.set(v.targetSheet, existing);
    }
    // Sort each sheet's values by targetRow
    for (const [, sheetValues] of map) {
      sheetValues.sort((a, b) => a.targetRow - b.targetRow);
    }
    return map;
  }, [values]);

  const sheetNames = useMemo(() => Array.from(sheets.keys()).sort(), [sheets]);

  // Counts
  const { passingCount, warningCount, failCount } = useMemo(() => {
    let passing = 0;
    let warning = 0;
    let fail = 0;
    for (const v of values) {
      switch (v.validationStatus) {
        case "pass":
          passing++;
          break;
        case "warning":
          warning++;
          break;
        case "fail":
          fail++;
          break;
        default:
          passing++; // Treat unvalidated as passing
      }
    }
    return { passingCount: passing, warningCount: warning, failCount: fail };
  }, [values]);

  const handleOverride = useCallback((id: number, value: string) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(id, value);
      return next;
    });
  }, []);

  const handleApprove = useCallback(async () => {
    if (!analystName.trim()) return;

    setIsApproving(true);
    try {
      const overrideList = Array.from(overrides.entries()).map(
        ([id, value]) => ({ id, value })
      );
      await approveValues(run.id, analystName.trim(), overrideList);
      setLocalStatus("approved");
      setLocalApprovedBy(analystName.trim());
      router.refresh();
    } catch {
      // Error handling -- could add toast here
    } finally {
      setIsApproving(false);
    }
  }, [analystName, overrides, run.id, router]);

  const handleDownload = useCallback(() => {
    if (run.outputFileUrl) {
      window.open(run.outputFileUrl, "_blank");
    } else {
      // Fallback: generate on-demand via the download API route
      window.open(`/api/download/${run.id}`, "_blank");
    }
  }, [run.outputFileUrl, run.id]);

  const isApproved = localStatus === "approved";

  return (
    <div className="flex min-h-screen flex-col pb-16">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-950">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-4">
          <Link
            href={`/companies/${company.id}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" />
            Back
          </Link>
          <div className="h-4 w-px bg-zinc-800" />
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold text-foreground">
                {company.name}
              </h1>
              <span className="font-[family-name:var(--font-geist-mono)] text-sm text-muted-foreground">
                {run.quarter}
              </span>
              <StatusBadge status={localStatus} />
            </div>
          </div>
        </div>
      </header>

      {/* Main content area */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-6">
        {/* Pending state */}
        {localStatus === "pending" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Extraction in progress...
            </p>
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-8 w-1/2" />
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-8 w-3/5" />
              <Skeleton className="h-8 w-4/5" />
            </div>
          </div>
        )}

        {/* Error state */}
        {localStatus === "error" && (
          <Alert variant="destructive">
            <AlertCircleIcon className="size-4" />
            <AlertTitle>Extraction Failed</AlertTitle>
            <AlertDescription>
              An error occurred during extraction. Please try uploading the
              report again.
            </AlertDescription>
          </Alert>
        )}

        {/* Approved state banner */}
        {isApproved && (
          <div className="mb-6 flex items-center gap-3 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-4 py-3">
            <CheckCircle2Icon className="size-5 text-emerald-400" />
            <div>
              <p className="text-sm font-medium text-emerald-400">
                Approved by {localApprovedBy}
              </p>
              {run.approvedAt && (
                <p className="text-xs text-muted-foreground">
                  {new Date(run.approvedAt).toLocaleString()}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Review UI (extracted/validated/approved states) */}
        {(localStatus === "extracted" ||
          localStatus === "validated" ||
          isApproved) &&
          values.length > 0 && (
            <div className="space-y-4">
              {/* Filter toggle */}
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {values.length} extracted values across {sheetNames.length}{" "}
                  sheets
                </p>
                <Button
                  variant={showFlaggedOnly ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setShowFlaggedOnly((prev) => !prev)}
                >
                  {showFlaggedOnly ? "Show flagged only" : "Show all"}
                </Button>
              </div>

              {/* Tabs by sheet */}
              <Tabs defaultValue={sheetNames[0]} className="w-full">
                <TabsList variant="line" className="mb-4">
                  {sheetNames.map((name) => (
                    <TabsTrigger key={name} value={name}>
                      <FileSpreadsheetIcon className="size-3.5" />
                      {name}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {sheetNames.map((name) => (
                  <TabsContent key={name} value={name}>
                    <ReviewTable
                      values={sheets.get(name) ?? []}
                      showFlaggedOnly={showFlaggedOnly}
                      onOverride={handleOverride}
                    />
                  </TabsContent>
                ))}
              </Tabs>
            </div>
          )}

        {/* Empty state -- no extraction data yet */}
        {(localStatus === "extracted" ||
          localStatus === "validated" ||
          isApproved) &&
          values.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <FileSpreadsheetIcon className="mb-4 size-12 text-zinc-700" />
              <h2 className="text-lg font-medium text-foreground">
                No extracted data
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Run extraction first. The extraction pipeline will be wired in a
                future update.
              </p>
            </div>
          )}
      </main>

      {/* Approval bar -- show when there are values and not in pending/error */}
      {values.length > 0 &&
        localStatus !== "pending" &&
        localStatus !== "error" && (
          <ApprovalBar
            passingCount={passingCount}
            warningCount={warningCount}
            failCount={failCount}
            analystName={analystName}
            onAnalystNameChange={setAnalystName}
            onApprove={handleApprove}
            onDownload={handleDownload}
            isApproved={isApproved || isApproving}
            isDownloadReady={isApproved}
          />
        )}
    </div>
  );
}
