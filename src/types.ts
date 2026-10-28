export type Profile = Record<string, number | null>;
export type Metric = "hamming" | "absolute" | "weighted";
export interface Scheme {
  id: string;
  name: string;
  organism: string;
  description: string;
  version: string;
  loci: string[];
  aliases?: Record<string, string>;
  weights?: Record<string, number>;
  metadataFields: string[];
  visualization: { accent: string };
  synthetic?: boolean;
}
export interface Sample {
  sample_id: string;
  profile: Profile;
  metadata: Record<string, string | number | null>;
}
export interface Isolate {
  isolate_id: string;
  organism: string;
  scheme: string;
  profile: Profile;
  lineage?: string;
  clade?: string;
  country?: string;
  host?: string;
  year?: number;
  accession?: string;
  latitude?: number;
  longitude?: number;
  metadata: Record<string, unknown>;
}
export interface Comparison {
  distance: number;
  normalizedDistance: number;
  matchingLoci: number;
  comparedLoci: number;
  missingLoci: number;
  exact: boolean;
}
export interface Match extends Comparison {
  isolate: Isolate;
}
export interface Vote {
  label: string | null;
  confidence: number;
  supportingIsolates: number;
  labeledIsolates: number;
  totalIsolates: number;
  distribution: { label: string; support: number; count: number }[];
}
export interface Analysis {
  sample: Sample;
  matches: Match[];
  eligibleReferences: number;
  excludedReferences: number;
  completeness: number;
  lineage: Vote;
  clade: Vote;
}
export interface Run {
  schemaVersion: 1;
  createdAt: string;
  scheme: Scheme;
  metric: Metric;
  minOverlap: number;
  referenceName: string;
  referenceCount: number;
  warnings: string[];
  results: Analysis[];
}
