import bimboaPack from "../company-packs/bimboa-1q26/manifest.json";
import centPack from "../company-packs/cent-4q25/manifest.json";
import enelchilePack from "../company-packs/enelchile-3q25/manifest.json";
import kimberPack from "../company-packs/kimber-4q25/manifest.json";
import regionalPack from "../company-packs/regional-4q25/manifest.json";
import lren3Pack from "../company-packs/lren3-4q25/manifest.json";
import ntco3Pack from "../company-packs/ntco3-4q25/manifest.json";
import grumabPack from "../company-packs/grumab-1q26/manifest.json";

import { expectations as bimboa_1q26 } from "./bimboa-1q26";
import { expectations as cent_4q25 } from "./cent-4q25";
import { expectations as enelchile_3q25 } from "./enelchile-3q25";
import { expectations as kimber_4q25 } from "./kimber-4q25";
import { expectations as regional_4q25 } from "./regional-4q25";
import { expectations as lren3_4q25 } from "./lren3-4q25";
import { expectations as ntco3_4q25 } from "./ntco3-4q25";
import { expectations as grumab_1q26 } from "./grumab-1q26";

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
  { manifest: bimboaPack, expectations: bimboa_1q26 },
  { manifest: centPack, expectations: cent_4q25 },
  { manifest: enelchilePack, expectations: enelchile_3q25 },
  { manifest: kimberPack, expectations: kimber_4q25 },
  { manifest: regionalPack, expectations: regional_4q25 },
  { manifest: lren3Pack, expectations: lren3_4q25 },
  { manifest: ntco3Pack, expectations: ntco3_4q25 },
  { manifest: grumabPack, expectations: grumab_1q26 },
];

export function findCompanyPack(ticker: string, quarter: string): RegisteredCompanyPack | undefined {
  return companyPacks.find(
    (pack) =>
      pack.manifest.ticker.toLowerCase() === ticker.toLowerCase() &&
      pack.manifest.quarter.toLowerCase() === quarter.toLowerCase(),
  );
}
