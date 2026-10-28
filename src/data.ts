import Papa from "papaparse";
import type { Isolate, Profile, Sample, Scheme } from "./types";

export const MAX_BYTES = 10 * 1024 * 1024;
const reserved = new Set(["__proto__", "prototype", "constructor"]);
const metadataNames = new Set([
  "key",
  "organism",
  "scheme",
  "lineage",
  "clade",
  "country",
  "host",
  "year",
  "accession",
  "latitude",
  "longitude",
  "metadata",
]);
const idNames = [
  "sample_id",
  "isolate_id",
  "access_number",
  "sample",
  "strain",
  "isolate",
  "id",
];
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const safeName = (v: unknown): v is string =>
  typeof v === "string" &&
  !!v.trim() &&
  v.length <= 200 &&
  !reserved.has(v.toLowerCase());
const key = (v: string) => v.trim().toLowerCase();

function coordinates(value: Record<string, unknown>, context: string) {
  const fields = ["latitude", "longitude"] as const;
  const present = fields.map(
    (field) => value[field] != null && String(value[field]).trim() !== "",
  );
  if (!present.some(Boolean)) return {};
  if (!present.every(Boolean))
    throw new Error(`${context}: provide both latitude and longitude.`);
  const result: { latitude?: number; longitude?: number } = {};
  for (const field of fields) {
    const raw = value[field];
    const number =
      typeof raw === "number" ||
      (typeof raw === "string" &&
        /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw.trim()))
        ? Number(raw)
        : NaN;
    if (
      !Number.isFinite(number) ||
      Math.abs(number) > (field === "latitude" ? 90 : 180)
    )
      throw new Error(`${context}: invalid ${field}.`);
    result[field] = number;
  }
  return result;
}

export function validateScheme(value: unknown): Scheme {
  if (
    !plain(value) ||
    !["id", "name", "organism", "version"].every((k) => safeName(value[k]))
  )
    throw new Error("Scheme needs id, name, organism, and version.");
  const loci = value.loci;
  if (
    !Array.isArray(loci) ||
    !loci.length ||
    loci.length > 100 ||
    !loci.every(safeName) ||
    new Set(loci.map(key)).size !== loci.length
  )
    throw new Error("Scheme needs 1–100 unique locus names.");
  if (loci.some((l) => metadataNames.has(key(l)) || idNames.includes(key(l))))
    throw new Error(
      "Locus names cannot use reserved metadata or sample ID columns.",
    );
  const aliases = value.aliases ?? {};
  const weights = value.weights ?? {};
  if (
    !plain(aliases) ||
    !Object.entries(aliases).every(
      ([a, b]) => safeName(a) && typeof b === "string" && loci.includes(b),
    )
  )
    throw new Error("Aliases must map names to canonical loci.");
  const names = new Map(loci.map((l) => [key(l), l]));
  for (const [a, b] of Object.entries(aliases)) {
    if (
      metadataNames.has(key(a)) ||
      idNames.includes(key(a)) ||
      (names.has(key(a)) && names.get(key(a)) !== b)
    )
      throw new Error(`Ambiguous or reserved alias: ${a}.`);
    names.set(key(a), b as string);
  }
  if (
    !plain(weights) ||
    !Object.entries(weights).every(
      ([l, w]) =>
        loci.includes(l) &&
        typeof w === "number" &&
        Number.isFinite(w) &&
        w > 0 &&
        w <= 1000,
    )
  )
    throw new Error(
      "Weights must be positive numbers up to 1000, keyed by canonical locus.",
    );
  if (
    value.metadataFields !== undefined &&
    (!Array.isArray(value.metadataFields) ||
      !value.metadataFields.every(safeName))
  )
    throw new Error("metadataFields must be an array of names.");
  if (
    (value.metadataFields as string[] | undefined)?.some((m) =>
      names.has(key(m)),
    )
  )
    throw new Error("Metadata fields cannot overlap locus names.");
  return {
    id: value.id as string,
    name: value.name as string,
    organism: value.organism as string,
    version: value.version as string,
    description: typeof value.description === "string" ? value.description : "",
    loci,
    aliases: aliases as Record<string, string>,
    weights: weights as Record<string, number>,
    metadataFields: (value.metadataFields ?? []) as string[],
    visualization: {
      accent:
        plain(value.visualization) &&
        typeof value.visualization.accent === "string" &&
        /^#[0-9a-f]{6}$/i.test(value.visualization.accent)
          ? value.visualization.accent
          : "#197968",
    },
    synthetic: value.synthetic === true,
  };
}

function canonical(name: string, scheme: Scheme) {
  return (
    scheme.loci.find((l) => key(l) === key(name)) ??
    Object.entries(scheme.aliases ?? {}).find(
      ([a]) => key(a) === key(name),
    )?.[1]
  );
}
function allele(value: unknown, context: string): number | null {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" &&
      /^(?:|NA|N\/A|ND|NAN|NULL|\?|-)$/i.test(value.trim()))
  )
    return null;
  const raw =
    typeof value === "number"
      ? String(value)
      : typeof value === "string"
        ? value.trim().replace(/u$/i, "")
        : "";
  if (
    !/^\d+(?:\.\d+)?$/.test(raw) ||
    !Number.isFinite(Number(raw)) ||
    Number(raw) > 1000000
  )
    throw new Error(
      `${context}: expected a nonnegative numeric allele or a missing-value marker; received “${String(value).slice(0, 40)}”.`,
    );
  return Number(raw);
}

export function readCSV(text: string) {
  if (new TextEncoder().encode(text).length > MAX_BYTES)
    throw new Error("File exceeds the 10 MB limit.");
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), {
    skipEmptyLines: "greedy",
    delimitersToGuess: [",", "\t", ";"],
  });
  const error = parsed.errors.find((e) => e.code !== "UndetectableDelimiter");
  if (error) throw new Error(`CSV: ${error.message}`);
  const [rawHeaders, ...rows] = parsed.data;
  if (!rawHeaders || !rows.length)
    throw new Error("Include a header and at least one sample row.");
  const headers = rawHeaders.map((h) => h.trim());
  if (
    !headers.every(safeName) ||
    new Set(headers.map(key)).size !== headers.length
  )
    throw new Error(
      "CSV headers must be nonempty, unique, and not reserved object names.",
    );
  rows.forEach((r, i) => {
    if (r.length !== headers.length)
      throw new Error(
        `CSV row ${i + 2}: expected ${headers.length} columns, found ${r.length}.`,
      );
  });
  return { headers, rows };
}

export function parseProfiles(
  text: string,
  schemes: Scheme[],
  selectedId?: string,
  maxSamples = 100,
): { samples: Sample[]; scheme: Scheme; warnings: string[]; detected: string } {
  const { headers, rows } = readCSV(text);
  const normalized = headers.map(key);
  const idIndex = idNames.map((n) => normalized.indexOf(n)).find((i) => i >= 0);
  if (idIndex === undefined)
    throw new Error(
      "A sample ID column is required (Access_number, sample_id, isolate_id, strain, or id).",
    );
  const locusIndex = normalized.findIndex(
    (n) => n === "locus" || n === "primer",
  );
  const alleleIndex = normalized.indexOf("allele");
  const long = locusIndex >= 0 && alleleIndex >= 0;
  const availableFor = (candidate: Scheme) => {
    const metadata = new Set([
      ...metadataNames,
      ...idNames,
      ...candidate.metadataFields.map(key),
    ]);
    return long
      ? [...new Set(rows.map((r) => r[locusIndex].trim()))]
      : headers.filter((h) => !metadata.has(key(h)));
  };
  let scheme = schemes.find((s) => s.id === selectedId);
  if (selectedId && !scheme)
    throw new Error("Selected scheme is not registered.");
  if (!scheme) {
    const candidates = schemes.filter(
      (s) =>
        availableFor(s).length && availableFor(s).every((l) => canonical(l, s)),
    );
    const exact = candidates.filter(
      (s) =>
        new Set(availableFor(s).map((l) => canonical(l, s))).size ===
        s.loci.length,
    );
    if (exact.length === 1) scheme = exact[0];
    else if (!exact.length && candidates.length === 1) scheme = candidates[0];
    else if (exact.length > 1 || candidates.length > 1)
      throw new Error(
        "These loci fit multiple schemes. Select the intended organism and scheme.",
      );
    else
      throw new Error(
        "No registered scheme matches the input locus names. Import a scheme JSON or select a compatible scheme.",
      );
  }
  const available = availableFor(scheme);
  const metadata = new Set([
    ...metadataNames,
    ...idNames,
    ...scheme.metadataFields.map(key),
  ]);
  if (!available.length) throw new Error("No locus columns found.");
  const unknown = available.filter((l) => !canonical(l, scheme));
  if (unknown.length)
    throw new Error(`Unknown loci for ${scheme.name}: ${unknown.join(", ")}.`);
  if (
    new Set(available.map((l) => canonical(l, scheme))).size !==
    available.length
  )
    throw new Error("Multiple input names map to the same locus.");
  const groups = new Map<string, Sample>();
  const called = new Set<string>();
  rows.forEach((row, i) => {
    const id = row[idIndex].trim();
    if (!safeName(id))
      throw new Error(`Row ${i + 2}: missing or invalid sample ID.`);
    if (!long && groups.has(id)) throw new Error(`Duplicate sample ID: ${id}.`);
    let sample = groups.get(id);
    if (!sample) {
      sample = {
        sample_id: id,
        profile: Object.fromEntries(scheme.loci.map((l) => [l, null])),
        metadata: {},
      };
      groups.set(id, sample);
    }
    for (let j = 0; j < headers.length; j++) {
      const name = key(headers[j]);
      if (metadata.has(name) && !idNames.includes(name)) {
        const value = row[j].trim();
        if (
          (name === "organism" && value && value !== scheme.organism) ||
          (name === "scheme" &&
            value &&
            value !== scheme.id &&
            value !== scheme.name)
        )
          throw new Error(
            `Row ${i + 2}: ${name} does not match the selected scheme.`,
          );
        if (
          long &&
          sample.metadata[name] &&
          value &&
          sample.metadata[name] !== value
        )
          throw new Error(`Conflicting ${name} for ${id}.`);
        if (value) sample.metadata[name] = value;
      }
    }
    const entries: [string, string][] = long
      ? [[row[locusIndex], row[alleleIndex]]]
      : headers.flatMap((h, j) =>
          canonical(h, scheme) ? [[h, row[j]] as [string, string]] : [],
        );
    for (const [l, value] of entries) {
      const name = canonical(l, scheme)!;
      const callKey = JSON.stringify([id, name]);
      if (called.has(callKey))
        throw new Error(
          `Duplicate call for ${id}, ${name}; resolve multiple calls before import.`,
        );
      called.add(callKey);
      sample.profile[name] = allele(value, `${id}, ${name}`);
    }
  });
  if (groups.size > maxSamples)
    throw new Error(
      `At most ${maxSamples.toLocaleString()} profiles per import.`,
    );
  const samples = [...groups.values()];
  for (const sample of samples)
    Object.assign(
      sample.metadata,
      coordinates(sample.metadata, sample.sample_id),
    );
  const missing = samples.reduce(
    (n, s) => n + Object.values(s.profile).filter((v) => v === null).length,
    0,
  );
  if (samples.some((s) => Object.values(s.profile).every((v) => v === null)))
    throw new Error("At least one sample has no numeric allele calls.");
  return {
    samples,
    scheme,
    warnings: missing
      ? [
          `${missing} missing allele call(s); missing loci are excluded, never treated as zero.`,
        ]
      : [],
    detected: `${scheme.name} · ${available.length}/${scheme.loci.length} loci`,
  };
}

export function importReferences(input: unknown, schemes: Scheme[]): Isolate[] {
  if (!Array.isArray(input) || !input.length || input.length > 10000)
    throw new Error("Reference database must contain 1–10,000 isolates.");
  const seen = new Set<string>();
  return input.map((row, i) => {
    if (!plain(row) || !safeName(row.isolate_id))
      throw new Error(`Reference ${i + 1}: invalid isolate_id.`);
    const scheme = schemes.find((s) => s.id === row.scheme);
    if (!scheme || row.organism !== scheme.organism)
      throw new Error(
        `${row.isolate_id}: scheme or organism does not match a registered plugin.`,
      );
    const identity = JSON.stringify([row.scheme, row.isolate_id]);
    if (seen.has(identity))
      throw new Error(`Duplicate reference: ${row.isolate_id}.`);
    seen.add(identity);
    if (!plain(row.profile))
      throw new Error(`${row.isolate_id}: profile must be an object.`);
    const profile: Profile = Object.fromEntries(
      scheme.loci.map((l) => [l, null]),
    );
    const mapped = new Set<string>();
    for (const [l, value] of Object.entries(row.profile)) {
      const name = canonical(l, scheme);
      if (!name || mapped.has(name))
        throw new Error(`${row.isolate_id}: unknown or duplicate locus ${l}.`);
      mapped.add(name);
      profile[name] = allele(value, `${row.isolate_id}, ${l}`);
    }
    if (Object.values(profile).every((v) => v === null))
      throw new Error(`${row.isolate_id}: no numeric allele calls.`);
    const record: Isolate = {
      isolate_id: row.isolate_id,
      organism: scheme.organism,
      scheme: scheme.id,
      profile,
      metadata: plain(row.metadata) ? row.metadata : {},
    };
    for (const field of [
      "lineage",
      "clade",
      "country",
      "host",
      "accession",
    ] as const) {
      if (
        row[field] !== undefined &&
        (typeof row[field] !== "string" || (row[field] as string).length > 200)
      )
        throw new Error(`${record.isolate_id}: invalid ${field}.`);
      if (typeof row[field] === "string" && row[field].trim())
        record[field] = row[field].trim();
    }
    for (const field of ["year"] as const) {
      const value = row[field];
      if (value !== undefined && value !== null && value !== "") {
        const number =
          typeof value === "number" || typeof value === "string"
            ? Number(value)
            : NaN;
        const valid = Number.isInteger(number) && number >= 0 && number <= 9999;
        if (!Number.isFinite(number) || !valid)
          throw new Error(`${record.isolate_id}: invalid ${field}.`);
        record[field] = number;
      }
    }
    Object.assign(record, coordinates(row, record.isolate_id));
    return record;
  });
}

export function importReferenceCSV(text: string, scheme: Scheme): Isolate[] {
  const { samples } = parseProfiles(text, [scheme], scheme.id, 10000);
  return importReferences(
    samples.map((s) => ({
      ...s.metadata,
      isolate_id: s.sample_id,
      organism: scheme.organism,
      scheme: scheme.id,
      profile: s.profile,
      metadata: s.metadata,
    })),
    [scheme],
  );
}

export async function readFile(file: File) {
  if (file.size > MAX_BYTES) throw new Error("File exceeds the 10 MB limit.");
  return file.text();
}
