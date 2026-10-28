import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  analyze,
  clusterProfiles,
  compareProfiles,
  toNewick,
} from "../src/analysis";
import {
  importReferenceCSV,
  importReferences,
  parseProfiles,
  readCSV,
  validateScheme,
} from "../src/data";
import { reportHTML, resultsCSV } from "../src/exports";
import type { Isolate, Run, Scheme } from "../src/types";

const scheme: Scheme = validateScheme({
  id: "test",
  name: "Test",
  organism: "Synthetic",
  version: "1",
  loci: ["A", "B", "C", "D"],
  aliases: { Alpha: "A" },
  weights: { A: 2, B: 1, C: 0.5, D: 1 },
  metadataFields: ["notes"],
});
const profile = { A: 0, B: 2, C: 3.5, D: 4 };
const reference = (id: string, p = profile, lineage = "L1"): Isolate => ({
  isolate_id: id,
  organism: "Synthetic",
  scheme: "test",
  profile: p,
  lineage,
  metadata: {},
});
const sample = { sample_id: "query", profile, metadata: {} };
const parse = (text: string) => parseProfiles(text, [scheme]);

test("MLVA_finder summary preserves accession and omits key", () => {
  const p = parse("key,Access_number,A,B,C,D\n001,Query_01,0,2,3.5,4");
  assert.equal(p.samples[0].sample_id, "Query_01");
  assert.deepEqual(p.samples[0].profile, profile);
  assert.equal(p.scheme.id, "test");
});
test("delimiters, BOM, CRLF, quoted IDs and quoted newlines", () => {
  for (const d of [",", "\t", ";"])
    assert.deepEqual(
      parse(
        `\uFEFFsample_id${d}A${d}B${d}C${d}D\r\n"sample,1"${d}0${d}2${d}3.5${d}4\r\n`,
      ).samples[0].profile,
      profile,
    );
  assert.equal(
    parse('sample_id,A,B,C,D,notes\nq,0,2,3.5,4,"line one\nline two"')
      .samples[0].metadata.notes,
    "line one\nline two",
  );
});
test("zero, decimals and MLVA_finder numeric unit suffix", () =>
  assert.deepEqual(
    parse("sample_id,A,B,C,D\nq,0u,2,3.5u,4").samples[0].profile,
    profile,
  ));
test("missing markers become null, never zero", () => {
  for (const v of ["", "NA", "ND", "N/A", "NaN", "null", "?", "-"])
    assert.equal(
      parse(`sample_id,A,B,C,D\nq,${v},2,3.5,4`).samples[0].profile.A,
      null,
    );
});
test("invalid or ambiguous allele calls fail", () => {
  for (const v of [
    "1/2",
    "1|2",
    "-1",
    "Infinity",
    "NaN!",
    "2.2.2",
    "foo",
    "1e6",
    "1000001",
  ])
    assert.throws(
      () => parse(`sample_id,A,B,C,D\nq,${v},2,3,4`),
      /numeric allele/,
    );
});
test("aliases resolve explicitly and case-insensitively", () =>
  assert.equal(
    parse("sample_id,alpha,b,C,d\nq,1,2,3,4").samples[0].profile.A,
    1,
  ));
test("alias collisions and unknown loci fail", () => {
  assert.throws(
    () => parse("sample_id,A,Alpha,B,C,D\nq,1,1,2,3,4"),
    /same locus/,
  );
  assert.throws(
    () => parseProfiles("sample_id,A,B,C,typo\nq,1,2,3,4", [scheme], scheme.id),
    /Unknown loci/,
  );
});
test("duplicate/empty IDs, duplicate headers, bad widths and quotes fail", () => {
  assert.throws(
    () => parse("sample_id,A,B,C,D\nq,1,2,3,4\nq,1,2,3,4"),
    /Duplicate sample/,
  );
  assert.throws(() => parse("sample_id,A,B,C,D\n,1,2,3,4"), /sample ID/);
  assert.throws(() => parse("sample_id,A,a\nq,1,1"), /headers/);
  assert.throws(() => readCSV("id,A\nq,1,2"), /expected 2/);
  assert.throws(() => readCSV('id,A\nq,"1'), /CSV/);
});
test("all-missing profiles and empty inputs fail", () => {
  assert.throws(() => parse("sample_id,A,B,C,D\nq,NA,ND,,?"), /no numeric/);
  assert.throws(() => parse(""), /header/);
});
test("long-form calls pivot and reject duplicates", () => {
  assert.deepEqual(
    parse("strain,primer,allele\nq,A,0\nq,B,2\nq,C,3.5\nq,D,4").samples[0]
      .profile,
    profile,
  );
  assert.throws(
    () => parse("sample_id,locus,allele\nq,A,1\nq,A,1"),
    /Duplicate call/,
  );
});
test("conflicting scheme and organism metadata fail", () => {
  assert.throws(
    () => parse("sample_id,A,B,C,D,organism\nq,1,2,3,4,Other"),
    /organism/,
  );
  assert.throws(
    () => parse("sample_id,A,B,C,D,scheme\nq,1,2,3,4,wrong"),
    /scheme/,
  );
});
test("ambiguous schemes require selection", () => {
  const second = { ...scheme, id: "other", organism: "Other synthetic" };
  assert.throws(
    () => parseProfiles("sample_id,A,B,C,D\nq,1,2,3,4", [scheme, second]),
    /multiple schemes/,
  );
  assert.equal(
    parseProfiles("sample_id,A,B,C,D\nq,1,2,3,4", [scheme, second], "other")
      .scheme.id,
    "other",
  );
});
test("partial profiles fill missing loci with null", () => {
  const p = parse("sample_id,A\nq,2");
  assert.deepEqual(p.samples[0].profile, { A: 2, B: null, C: null, D: null });
  assert.equal(p.warnings.length, 1);
});
test("metadata from another plugin cannot hide a valid locus", () => {
  const first = validateScheme({
    ...scheme,
    id: "first",
    loci: ["notes"],
    aliases: {},
    weights: {},
    metadataFields: [],
  });
  const parsed = parseProfiles("sample_id,notes\nq,4", [first, scheme]);
  assert.equal(parsed.scheme.id, "first");
  assert.equal(parsed.samples[0].profile.notes, 4);
});
test("query batch limit is enforced", () => {
  const csv =
    "sample_id,A\n" +
    Array.from({ length: 101 }, (_, i) => `q${i},1`).join("\n");
  assert.throws(() => parse(csv), /At most 100/);
});
test("plugin validation rejects reserved names, collisions and invalid weights", () => {
  for (const loci of [["A", "a"], ["__proto__"], ["sample_id"], []])
    assert.throws(() => validateScheme({ ...scheme, loci }));
  for (const w of [0, -1, Infinity, 1001, "2"])
    assert.throws(() => validateScheme({ ...scheme, weights: { A: w } }));
  assert.throws(
    () => validateScheme({ ...scheme, aliases: { a: "B" } }),
    /Ambiguous/,
  );
  assert.throws(
    () => validateScheme({ ...scheme, metadataFields: ["A"] }),
    /overlap/,
  );
});
test("all distance metrics match known raw and normalized values", () => {
  const other = { A: 1, B: 2, C: 5.5, D: 4 };
  assert.equal(compareProfiles(profile, other, scheme, "hamming").distance, 2);
  assert.equal(
    compareProfiles(profile, other, scheme, "hamming").normalizedDistance,
    0.5,
  );
  assert.equal(compareProfiles(profile, other, scheme, "absolute").distance, 3);
  const w = compareProfiles(profile, other, scheme, "weighted");
  assert.equal(w.distance, 3);
  assert.equal(w.normalizedDistance, 3 / 4.5);
});
test("no overlap is ineligible and missing calls cannot make exact matches", () => {
  const d = compareProfiles(
    profile,
    { A: null, B: null, C: null, D: null },
    scheme,
    "hamming",
  );
  assert.equal(d.normalizedDistance, Infinity);
  assert.equal(d.exact, false);
  const p = compareProfiles(
    profile,
    { ...profile, A: null },
    scheme,
    "hamming",
  );
  assert.equal(p.distance, 0);
  assert.equal(p.missingLoci, 1);
  assert.equal(p.exact, false);
  assert.equal(
    compareProfiles(profile, profile, scheme, "hamming").exact,
    true,
  );
});
test("JSON reference import validates identities, profiles and locations", () => {
  assert.equal(importReferences([reference("r")], [scheme]).length, 1);
  assert.throws(
    () => importReferences([reference("r"), reference("r")], [scheme]),
    /Duplicate reference/,
  );
  assert.throws(
    () =>
      importReferences([{ ...reference("r"), organism: "wrong" }], [scheme]),
    /organism/,
  );
  assert.throws(
    () => importReferences([{ ...reference("r"), latitude: 0 }], [scheme]),
    /both/,
  );
  assert.throws(
    () =>
      importReferences(
        [{ ...reference("r"), latitude: 91, longitude: 0 }],
        [scheme],
      ),
    /latitude/,
  );
  assert.throws(
    () => importReferences([{ ...reference("r"), lineage: {} }], [scheme]),
    /lineage/,
  );
  assert.throws(
    () =>
      importReferences([{ ...reference("r"), profile: { typo: 1 } }], [scheme]),
    /unknown/,
  );
});
test("reference CSV preserves metadata and numeric coordinates", () => {
  const r = importReferenceCSV(
    "isolate_id,A,B,C,D,lineage,country,year,latitude,longitude\nr,0,2,3.5,4,L1,USA,2020,0,0",
    scheme,
  )[0];
  assert.equal(r.year, 2020);
  assert.equal(r.latitude, 0);
  assert.equal(r.lineage, "L1");
});
test("query coordinates are validated rather than silently hidden", () => {
  assert.equal(
    parse("sample_id,A,latitude,longitude\nq,1,0,0").samples[0].metadata
      .latitude,
    0,
  );
  assert.throws(
    () => parse("sample_id,A,latitude\nq,1,10"),
    /both latitude and longitude/,
  );
  assert.throws(
    () => parse("sample_id,A,latitude,longitude\nq,1,91,0"),
    /invalid latitude/,
  );
  assert.throws(
    () => parse("sample_id,A,latitude,longitude\nq,1,0,0x10"),
    /invalid longitude/,
  );
});
test("analysis filters incompatible records and honors overlap", () => {
  const refs = [
    reference("full"),
    { ...reference("partial"), profile: { ...profile, A: null } },
    { ...reference("wrong"), organism: "Other" },
  ];
  const r = analyze([sample], refs, scheme, "hamming")[0];
  assert.equal(r.matches.length, 1);
  assert.equal(r.excludedReferences, 1);
  assert.equal(
    analyze([sample], refs, scheme, "hamming", 0.5)[0].matches.length,
    2,
  );
  assert.throws(
    () => analyze([sample], [], scheme, "hamming"),
    /No references/,
  );
});
test("normalization does not reward missing calls with lower raw sums", () => {
  const refs = [
    { ...reference("partial"), profile: { A: 1, B: null, C: null, D: null } },
    reference("complete", { A: 1, B: 3, C: 3.5, D: 4 }),
  ];
  assert.equal(
    analyze([sample], refs, scheme, "absolute", 0.25)[0].matches[0].isolate
      .isolate_id,
    "complete",
  );
});
test("exact profiles determine votes and cutoff ties are included", () => {
  const exact = Array.from({ length: 12 }, (_, i) =>
    reference(`r${String(i).padStart(2, "0")}`),
  );
  const r = analyze(
    [sample],
    [...exact, reference("far", { ...profile, A: 1 }, "L2")],
    scheme,
    "hamming",
  )[0];
  assert.equal(r.matches.length, 10);
  assert.equal(r.lineage.supportingIsolates, 12);
  assert.equal(r.lineage.confidence, 1);
  assert.equal(
    analyze(
      [sample],
      exact.map((r) => ({ ...r, profile: { ...profile, A: 1 } })),
      scheme,
      "hamming",
    )[0].lineage.totalIsolates,
    12,
  );
});
test("tied labels abstain and unlabeled neighbors are counted", () => {
  const r = analyze(
    [sample],
    [
      reference("a", profile, "L1"),
      reference("b", profile, "L2"),
      reference("c", profile, ""),
    ],
    scheme,
    "hamming",
  )[0];
  assert.equal(r.lineage.label, null);
  assert.equal(r.lineage.labeledIsolates, 2);
  assert.equal(r.lineage.totalIsolates, 3);
  assert.equal(r.lineage.supportingIsolates, 0);
});
test("empty eligible sets do not invent assignments", () => {
  const r = analyze(
    [{ ...sample, profile: { ...profile, A: null } }],
    [reference("r")],
    scheme,
    "hamming",
  )[0];
  assert.equal(r.matches.length, 0);
  assert.equal(r.lineage.label, null);
  assert.equal(r.lineage.confidence, 0);
});
test("average linkage and Newick match a known three-point tree", () => {
  const one = { ...scheme, loci: ["A"], weights: {} };
  const c = clusterProfiles(
    [
      { name: "a", profile: { A: 0 } },
      { name: "b", profile: { A: 2 } },
      { name: "c", profile: { A: 6 } },
    ],
    one,
    "absolute",
  );
  assert.equal(c.tree.height, 2.5);
  assert.equal(c.tree.size, 3);
  assert.equal(c.tree.children![1].height, 1);
  assert.equal(c.common, 1);
  assert.equal(
    toNewick(c.tree),
    "('c':2.50000000,('a':1.00000000,'b':1.00000000):1.50000000);",
  );
  assert.equal(
    toNewick({ name: "O'Brien", size: 1, height: 0 }),
    "'O''Brien';",
  );
});
test("clustering refuses inadequate coverage and oversized cohorts", () => {
  assert.throws(
    () =>
      clusterProfiles(
        [
          { name: "a", profile },
          { name: "b", profile: { ...profile, A: null } },
        ],
        scheme,
        "hamming",
      ),
    /80%/,
  );
  assert.throws(
    () =>
      clusterProfiles(
        Array.from({ length: 51 }, (_, i) => ({ name: String(i), profile })),
        scheme,
        "hamming",
      ),
    /1–50/,
  );
});
test("bundled registry, references and example validate end to end", () => {
  const paths = JSON.parse(
    readFileSync(
      new URL("../public/schemes/index.json", import.meta.url),
      "utf8",
    ),
  ) as string[];
  const schemes = paths.map((p) =>
    validateScheme(
      JSON.parse(
        readFileSync(new URL("../public/" + p, import.meta.url), "utf8"),
      ),
    ),
  );
  const refs = importReferences(
    JSON.parse(
      readFileSync(
        new URL("../public/references.json", import.meta.url),
        "utf8",
      ),
    ),
    schemes,
  );
  const input = parseProfiles(
    readFileSync(
      new URL(
        "../public/examples/MLVA_analysis_assemblies.csv",
        import.meta.url,
      ),
      "utf8",
    ),
    schemes,
  );
  assert.equal(input.scheme.loci.length, 25);
  assert.equal(input.samples.length, 3);
  assert.equal(refs.length, 160);
  assert.equal(
    analyze(input.samples, refs, input.scheme, "hamming")[0].matches.length,
    10,
  );
});
test("HTML escapes input and CSV protects spreadsheet formulas", () => {
  const results = analyze(
    [
      {
        ...sample,
        sample_id: "=1+1",
        metadata: { notes: "<script>alert(1)</script>" },
      },
    ],
    [reference("<script>")],
    scheme,
    "hamming",
  );
  const run: Run = {
    schemaVersion: 1,
    createdAt: "2026-10-28T00:00:00Z",
    scheme,
    metric: "hamming",
    minOverlap: 0.8,
    referenceName: "<img>",
    referenceCount: 1,
    warnings: [],
    results,
  };
  assert.ok(resultsCSV(run).includes("'=1+1"));
  const html = reportHTML(run, []);
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&lt;img&gt;"));
});
