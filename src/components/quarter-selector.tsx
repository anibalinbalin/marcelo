"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const QUARTERS = ["1Q26", "4Q25", "3Q25", "2Q25", "1Q25", "4Q24"] as const;

interface QuarterSelectorProps {
  value: string;
  onChange: (q: string) => void;
}

export function QuarterSelector({ value, onChange }: QuarterSelectorProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[120px]">
        <SelectValue placeholder="Quarter" />
      </SelectTrigger>
      <SelectContent>
        {QUARTERS.map((q) => (
          <SelectItem key={q} value={q}>
            {q}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
