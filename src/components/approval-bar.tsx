"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircleIcon, DownloadIcon } from "lucide-react";

interface ApprovalBarProps {
  passingCount: number;
  warningCount: number;
  failCount: number;
  analystName: string;
  onAnalystNameChange: (name: string) => void;
  onApprove: () => void;
  onDownload: () => void;
  isApproved: boolean;
  isDownloadReady: boolean;
  hasBlockingFailures?: boolean;
}

export function ApprovalBar({
  passingCount,
  warningCount,
  failCount,
  analystName,
  onAnalystNameChange,
  onApprove,
  onDownload,
  isApproved,
  isDownloadReady,
  hasBlockingFailures = false,
}: ApprovalBarProps) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-6">
        {/* Left: Counts — only color non-zero values */}
        <div className="flex items-center gap-3 text-sm tabular-nums">
          <span className={passingCount > 0 ? "text-success" : "text-muted-foreground"}>
            {passingCount} passing
          </span>
          {warningCount > 0 && (
            <>
              <span className="text-muted-foreground/30">·</span>
              <span className="text-warning">
                {warningCount} warning{warningCount === 1 ? "" : "s"}
              </span>
            </>
          )}
          {failCount > 0 && (
            <>
              <span className="text-muted-foreground/30">·</span>
              <span className="text-destructive">
                {failCount} failure{failCount === 1 ? "" : "s"}
              </span>
            </>
          )}
        </div>

        {/* Center: Analyst name */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            Analyst:
          </span>
          <Input
            value={analystName}
            onChange={(e) => onAnalystNameChange(e.target.value)}
            placeholder="Your name"
            disabled={isApproved}
            className="h-8 w-40 text-sm"
          />
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          <Button
            onClick={onApprove}
            disabled={isApproved || !analystName.trim() || hasBlockingFailures}
            size="lg"
          >
            <CheckCircleIcon className="size-4" data-icon="inline-start" />
            {isApproved ? "Approved" : "Approve Reviewed Values"}
          </Button>
          <Button
            variant="outline"
            onClick={onDownload}
            disabled={!isDownloadReady || !isApproved}
            size="lg"
          >
            <DownloadIcon className="size-4" data-icon="inline-start" />
            Download Excel
          </Button>
        </div>
      </div>
    </div>
  );
}
