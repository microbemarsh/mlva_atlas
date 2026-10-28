# MLVA Atlas

A static, browser-based MLVA profile comparison workspace. Import existing allele calls, compare them against a scheme-specific reference collection, explore labeled neighbors, and export figures and reports. No backend, account, sequence processing, or server upload is required.

**The bundled organisms, VNTR names, reference profiles, lineages and clades are fictional demonstration data.** They are not curated pathogen reference databases. Atlas supplies a generic comparison engine and schema; it does not bundle organism-specific high-consequence pathogen panels.

## Run locally

Requires Node.js **22.12 or later** and npm.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. The app opens with a three-sample synthetic example. Use **Load example**, choose a metric, and click **Analyze profiles** to repeat the workflow. Each of five demonstration schemes includes 32 references.

```sh
npm test        # Node tests for parsing, validation, matching, voting, clustering and exports
npm run build  # Strict TypeScript check and production build
npm run preview
```

Production output is `dist/`. React, TypeScript, Vite, Tailwind CSS and TanStack Table provide the application; D3 provides SVG figures, Apache ECharts provides the radar plot, Leaflet provides the local interactive map, and phylotree.js parses supplied Newick trees. jsPDF and svg2pdf.js produce vector PDFs. Papa Parse handles delimited input and safe CSV output.

## GitHub Pages deployment

1. Push the project to the repository's `main` branch.
2. In **Settings → Pages → Build and deployment**, select **GitHub Actions**.
3. The [workflow](.github/workflows/pages.yml) installs from the lockfile, tests, builds, and deploys `dist/`. Pull requests validate without deployment. Manual workflow dispatch is also available.

The relative Vite base (`./`) supports repository paths such as `/mlva_atlas/` and custom domains. `BASE_PATH=/your-prefix/ npm run build` overrides it. Navigation uses in-app state, with no server-side routing requirement. Reference assets, worker code and map data are served from the same site. Creating these files does not publish the site or change repository settings.

## User workflow

1. Drag in a CSV/TSV file, select a file manually, or paste a delimited table.
2. Review the detected scheme/sample count. Select the scheme explicitly when registered locus sets are ambiguous.
3. Choose Hamming, absolute or weighted distance and a minimum overlap.
4. Click **Analyze profiles**. Matching runs in a browser worker.
5. Select a sample to inspect its closest references, lineage/clade votes and completeness.
6. Use **Visualizations**, **Batch results** and **Download center** to explore or export.

Imports remain in memory. Reloading clears imports and restores bundled data. Export databases and reports before closing. The app fetches only its static assets: profiles/reference imports are not sent to a service. There are no analytics, remote fonts, or map-tile requests.

## Input formats

### MLVA_finder summary / wide profiles

The parser supports the upstream `key,Access_number,<loci...>` summary and ordinary wide tables. The [example upload](public/examples/MLVA_analysis_assemblies.csv) uses this layout with fictional loci. The parser follows the summary columns in the [MLVA_finder source](https://github.com/i2bc/MLVA_finder/blob/master/MLVA_finder.py); Atlas does not run its allele-calling workflow.

```csv
key,Access_number,VNTR01,VNTR02,VNTR03
001,Sample_01,3,10,6.5
```

This abbreviated example needs a compatible plugin. Accepted ID headings, in precedence order: `sample_id`, `isolate_id`, `Access_number`, `sample`, `strain`, `isolate`, `id`. `key` is metadata, never a locus. Header matching is case-insensitive. Organism/scheme metadata, when present, must match the selected plugin. Unknown loci, duplicate IDs and duplicate canonical loci fail validation.

### Long-form calls

```csv
sample_id,locus,allele
Sample_01,MarkerA,2
Sample_01,MarkerB,4
```

`strain,primer,allele` is also supported. Long-form calls pivot before comparison. Duplicate calls for a sample/locus fail even when equal; Atlas does not select among ambiguous calls.

Commas, tabs and semicolons are detected. Quoted cells, BOMs, CRLF and quoted newlines are supported. Blank, `NA`, `N/A`, `ND`, `NaN`, `null`, `?` and `-` indicate missing calls. Zero is a valid allele. Calls must be finite, nonnegative integers/decimals no greater than 1,000,000. A numeric `u` suffix is accepted. Ambiguous alleles, negative numbers, infinities and malformed numbers fail. No rounding, binning or conversion is inferred.

## Scheme plugins

Plugins contain data, not executable code. No core-code edits are needed:

1. Copy [custom-scheme.json](public/examples/custom-scheme.json).
2. Set a unique stable ID, organism, version, loci, validated aliases, optional positive weights, metadata fields and visualization defaults.
3. Import the JSON in **Typing schemes** for the session. For a permanent deployment, put it in `public/schemes/` and add its relative path to [index.json](public/schemes/index.json).
4. Import/bundle references using that exact scheme ID and organism.

```json
{
  "id": "custom_example",
  "name": "Custom four-locus demonstration",
  "organism": "Synthetic custom organism",
  "version": "1.0.0",
  "description": "Fictional demonstration",
  "loci": ["MarkerA", "MarkerB", "MarkerC", "MarkerD"],
  "aliases": { "marker_a": "MarkerA" },
  "weights": { "MarkerA": 1, "MarkerB": 1, "MarkerC": 0.5, "MarkerD": 2 },
  "metadataFields": ["collection"],
  "visualization": { "accent": "#197968" },
  "synthetic": true
}
```

Weights default to 1 and must be greater than zero and at most 1,000. Names/aliases cannot collide or use reserved ID/metadata names. Schemes have 1–100 loci. `synthetic` labels demonstration results. The visualization accent sets heatmap and radar colors; clade palettes remain consistent across schemes.

MLVA8, MLVA15, MLVA20, MLVA25 and MLVA31 are fictional templates here. Any size, including MLVA16, can be registered. **A locus count is not a biological scheme identity.** Detection prefers a unique exact canonical locus set, then a unique compatible partial set; ambiguity requires selection. Changes to allele interpretation should receive distinct scheme IDs. Profiles are never automatically converted between schemes.

## Reference schema and future builder interfaces

```json
{
  "isolate_id": "DEMO-001",
  "organism": "Synthetic custom organism",
  "scheme": "custom_example",
  "profile": { "MarkerA": 2, "MarkerB": 4, "MarkerC": 6, "MarkerD": 8 },
  "lineage": "Demo L1",
  "clade": "Demo clade",
  "country": "USA",
  "host": "Synthetic specimen",
  "year": 2020,
  "accession": "DEMO-ACCESSION",
  "latitude": 39.8,
  "longitude": -98.6,
  "metadata": {
    "synthetic": true,
    "source": "example",
    "location_precision": "country centroid"
  }
}
```

Required fields: `isolate_id`, `organism`, `scheme`, `profile`. Missing profile keys become null; unknown keys fail. IDs are unique within a scheme. Optional metadata may be incomplete. Coordinates must be supplied together and lie in range. Countries without coordinates contribute to summaries but are not geocoded. Missing locations are counted explicitly.

Typed interfaces live in [src/data.ts](src/data.ts) and [src/types.ts](src/types.ts):

```ts
const scheme = validateScheme(untrustedPlugin);
const jsonReferences = importReferences(untrustedArray, registeredSchemes);
const csvReferences = importReferenceCSV(csvText, scheme);
const input = parseProfiles(csvText, registeredSchemes, optionalSchemeId);
const results = analyze(
  input.samples,
  jsonReferences,
  input.scheme,
  "hamming",
  0.8,
);
```

- **JSON:** arrays of isolate records, including mixed registered schemes.
- **CSV:** wide tables with isolate ID, locus columns and optional lineage/clade/country/host/year/accession/coordinate columns. One scheme per file. Declare custom metadata columns in the plugin. CSV metadata is retained as strings; JSON preserves structured `metadata`.
- **Programmatic:** future builders can fetch/combine metadata externally, normalize records, call `importReferences` at the trust boundary, and write the validated array to `public/references.json`. Atlas performs no genome download, genome processing or allele calling.

Preserve provenance, source versions, collection dates, curation decisions and location precision in `metadata`. Imports replace the session collection only after complete validation. Run JSON includes the full scheme and top-neighbor records; export the database separately to archive the entire comparison universe.

## Matching and lineage support

For loci observed in both profiles:

| Metric   | Raw score                           | Ranking score                |
| -------- | ----------------------------------- | ---------------------------- |
| Hamming  | Number of unequal calls             | Raw score / compared loci    |
| Absolute | Sum of absolute allele differences  | Raw score / compared loci    |
| Weighted | Sum of weight × absolute difference | Raw score / compared weights |

Missing loci contribute neither score nor denominator. A candidate needs `ceil(minOverlap × schemeLoci)` jointly observed loci. No-overlap pairs are excluded. Default overlap is 80%; the UI supports 50%, 80%, 90% and 100%. Lower thresholds reduce evidence. Ties sort by greater coverage, then ID. Results include raw/normalized distance, matching/compared/missing counts and complete exact-match status. Exact matches require every scheme locus to be observed and equal.

Ten candidates are displayed. Voting includes all ties at the tenth normalized distance. If complete exact matches exist, all of them form the voting pool instead. Each labeled neighbor contributes:

```text
weight = (compared loci / scheme loci) / (1 + normalized distance)
support(label) = weight for label / total labeled voting weight
```

Lineage and clade vote independently. Unlabeled neighbors are counted but do not vote. Equal winners remain unassigned. **Lineage vote support is an uncalibrated confidence score**, not a probability of correct assignment. There is no trained prediction model or accuracy claim. Reference bias, duplicate profiles, homoplasy, scheme design and missingness affect interpretation. Unknown populations may still receive high support.

## Figures and exports

1. **Heatmap:** absolute per-locus differences for every metric; missing calls are gray. Keyboard-selectable cells expose values.
2. **Dendrogram:** average-linkage (UPGMA) clustering of queries and top references. Uses loci called in every included profile, requiring 80% common coverage. Axis shows normalized merge distance; Newick stores half-height branch lengths. Batch mode includes all queries and the union of their displayed neighbors without silent truncation.
3. **Lineage placement:** a neighbor panel with clade colors and annotations, not an inferred phylogeny. Optional supplied Newick trees show topology with existing query/reference IDs highlighted. Queries absent from the tree are never inserted; branch lengths in this view are not scaled.
4. **Geography:** same-scheme reference coordinates/country counts. Query coordinates are shown only when supplied. Leaflet pans/zooms without a tile service. Exports use the fixed D3 publication view. Demo locations are country centroids.
5. **Radar:** 0–100 axes for proximity `100/(1+normalized distance)`, matching fraction of compared loci, completeness and assigned lineage support. Unassigned support is zero; absent eligible matches have zero proximity/match.

Figures export SVG, 3× PNG and vector PDF. Dendrograms also export Newick; optional reference trees export SVG. HTML reports are self-contained and printable. PDF reports paginate text and retain vector figures. Standard PDF fonts primarily cover Latin text; use HTML/SVG for arbitrary Unicode labels. Combined reports contain summaries/matches for all samples with figures for the active sample. Switch samples to export separate figure sets.

CSV output escapes spreadsheet formulas. Report HTML escapes imported text; imported SVG is never accepted. Newick labels render as text. Reports snapshot analyzed settings: changed controls mark previous results stale until reanalysis.

## MVP limits

- 10 MB/file, 100 queries, 10,000 references and 100 loci/scheme.
- 50 million locus comparisons/run in a worker; split larger batches.
- Clustering: O(n³), at most 50 combined query/reference profiles; larger cohorts show an explicit message. Indexed matching and nearest-neighbor-chain clustering are upgrade paths.
- Supplied Newick: 100 KB, 2–100 unique labeled tips; topology view only.
- Session-only imports; no persistent storage, accounts or automatic public-data ingestion.
- Real reference data and labeling require external curation and validation. No epidemiological or clinical accuracy is asserted.
- GitHub Pages requires the repository owner to enable Pages and push the workflow.

## Sources and licensing

Project license: [GPL-3.0](LICENSE). Dependencies retain their respective licenses.

- [MLVA_finder](https://github.com/i2bc/MLVA_finder): input summary layout.
- [Vite static deployment](https://vite.dev/guide/static-deploy): Pages build model.
- [TanStack Table v8](https://tanstack.com/table/v8/docs/guide/introduction): tables.
- [ECharts SVG renderer](https://echarts.apache.org/handbook/en/best-practices/canvas-vs-svg/): radar.
- [Leaflet](https://leafletjs.com/reference.html): interactive maps.
- [phylotree.js](https://github.com/veg/phylotree.js): Newick parser.
- [Natural Earth public-domain terms](https://www.naturalearthdata.com/about/terms-of-use/) and [1:110m country boundaries](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_admin_0_countries.geojson): bundled `public/world.geojson`.
