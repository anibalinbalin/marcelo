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
}: ApprovalBarProps) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-6">
        {/* Left: Counts */}
        <div className="flex items-center gap-3 text-sm tabular-nums">
          <span className="text-success">
            {passingCount} passing
          </span>
          <span className="text-muted-foreground/40">|</span>
          <span className="text-warning">
            {warningCount} warnings
          </span>
          <span className="text-muted-foreground/40">|</span>
          <span className="text-destructive">
            {failCount} failures
          </span>
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
            disabled={isApproved || !analystName.trim()}
            size="lg"
          >
            <CheckCircleIcon className="size-4" data-icon="inline-start" />
            {isApproved ? "Approved" : "Approve All Passing"}
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
