import lren3Pack from "../company-packs/lren3-4q25/manifest.json";
import { expectations as lren3_4q25 } from "./lren3-4q25";
import type { Expectations } from "./types";

export interface CompanyPackManifest {
  id: string;
  companyId: number;
  ticker: string;
  companyName: string;
  quarter: string;
  status: string;
  sourceFile: string;
  sourceSha256: string;
  expectationsModule: string;
  minimumAssertions: {
    preApprovalCells: number;
    postRecalcCells: number;
    duplicatePairs: number;
    minExtractedValues: number;
  };
  humanGate: string;
  knownRisksCovered: string[];
}

export interface RegisteredCompanyPack {
  manifest: CompanyPackManifest;
  expectations: Expectations;
}

export const companyPacks: RegisteredCompanyPack[] = [
  {
    manifest: lren3Pack,
    expectations: lren3_4q25,
  },
];

export function findCompanyPack(ticker: string, quarter: string): RegisteredCompanyPack | undefined {
  return companyPacks.find(
    (pack) =>
      pack.manifest.ticker.toLowerCase() === ticker.toLowerCase() &&
      pack.manifest.quarter.toLowerCase() === quarter.toLowerCase(),
  );
}
