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
    errorMessage: string | null;
  };
  values: ExtractedValueWithMapping[];
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "pending":
      return (
        <Badge className="bg-info/15 text-info border-info/25">
          Pending
        </Badge>
      );
    case "extracted":
    case "validated":
      return (
        <Badge className="bg-warning/15 text-warning border-warning/25">
          Ready for Review
        </Badge>
      );
    case "approved":
      return (
        <Badge className="bg-success/15 text-success border-success/25">
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
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);
  const [analystName, setAnalystName] = useState("");
  const [overrides, setOverrides] = useState<Map<number, string>>(new Map());
  const [isApproving, setIsApproving] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<{
    message: string;
    details: string[];
  } | null>(null);
  const [cellsWritten, setCellsWritten] = useState<number | null>(null);
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

  const handleDownload = useCallback(async () => {
    setDownloadError(null);
    setCellsWritten(null);
    setIsDownloading(true);
    try {
      // Always route through /api/download so the server-side integrity
      // check runs on every download and we never ship a silently-broken
      // file. The pre-built blob is only used as a cache hint.
      const res = await fetch(`/api/download/${run.id}`);

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          details?: string[];
        };
        setDownloadError({
          message: body.error ?? `Download failed (HTTP ${res.status})`,
          details: body.details ?? [],
        });
        return;
      }

      const written = parseInt(res.headers.get("X-Cells-Written") ?? "0", 10);
      setCellsWritten(written);

      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="?([^";]+)"?/);
      const filename = match?.[1] ?? `${company.ticker}_${run.quarter}.xlsx`;

      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setDownloadError({
        message:
          err instanceof Error ? err.message : "Unexpected download error",
        details: [],
      });
    } finally {
      setIsDownloading(false);
    }
  }, [run.id, run.quarter, company.ticker]);

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
              {run.errorMessage ? (
                <>
                  <div className="font-mono text-xs break-all">{run.errorMessage}</div>
                  <div className="mt-2">Please try uploading the report again.</div>
                </>
              ) : (
                "An error occurred during extraction. Please try uploading the report again."
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Approved state banner */}
        {isApproved && (
          <div className="mb-6 flex items-center gap-3 rounded-lg border border-success/25 bg-success/5 px-4 py-3">
            <CheckCircle2Icon className="size-5 text-success" />
            <div>
              <p className="text-sm font-medium text-success">
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

        {/* Download success */}
        {cellsWritten !== null && !downloadError && (
          <Alert className="mb-6 border-success/25 bg-success/5">
            <CheckCircle2Icon className="size-4 text-success" />
            <AlertTitle className="text-success">Download complete</AlertTitle>
            <AlertDescription>
              {cellsWritten} values written to the PROJ sheet.
              If formulas still show old results, press{" "}
              <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-[family-name:var(--font-geist-mono)] text-xs">
                Ctrl+Alt+F9
              </kbd>{" "}
              in Excel to force recalculation.
            </AlertDescription>
          </Alert>
        )}

        {/* Download integrity failure */}
        {downloadError && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircleIcon className="size-4" />
            <AlertTitle>Download blocked - integrity check failed</AlertTitle>
            <AlertDescription>
              <div>{downloadError.message}</div>
              {downloadError.details.length > 0 && (
                <ul className="mt-2 list-disc pl-4 font-mono text-xs break-all">
                  {downloadError.details.slice(0, 6).map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                  {downloadError.details.length > 6 && (
                    <li>
                      ... and {downloadError.details.length - 6} more
                    </li>
                  )}
                </ul>
              )}
              <div className="mt-2 text-xs">
                This means one or more extracted values did not land in the
                output file. Re-upload the report to try again, or send this
                error to Anibal.
              </div>
            </AlertDescription>
          </Alert>
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
                  {showFlaggedOnly ? "Show all" : "Show flagged only"}
                </Button>
              </div>

              {/* Inline help when there are flagged rows */}
              {warningCount + failCount > 0 && (
                <p className="text-xs text-muted-foreground">
                  Rows flagged below failed an automated sanity check. The
                  reason appears under the status. Click the value to override
                  it with what the source document shows, or approve as-is if
                  the extracted value is correct.
                </p>
              )}

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
            isDownloadReady={!isDownloading}
          />
        )}
    </div>
  );
}
