import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { FeatureCollection } from "geojson";
import { analyze, metricNames } from "./analysis";
import {
  importReferenceCSV,
  importReferences,
  parseProfiles,
  readFile,
  validateScheme,
} from "./data";
import {
  collectFigures,
  download,
  reportHTML,
  reportPDF,
  resultsCSV,
} from "./exports";
import { Table } from "./Table";
import type { Analysis, Isolate, Match, Metric, Run, Scheme } from "./types";

const Figures = lazy(() => import("./Figures"));
const base = import.meta.env.BASE_URL;
type Page = "analysis" | "references" | "schemes" | "guide";
type Tab = "overview" | "figures" | "batch" | "downloads";
const percent = (v: number) => (v * 100).toFixed(1) + "%";
const number = (v: number) => Number(v.toFixed(4)).toString();

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    database: (
      <>
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0" />
      </>
    ),
    scheme: (
      <>
        <circle cx="6" cy="5" r="2" />
        <circle cx="18" cy="5" r="2" />
        <circle cx="12" cy="19" r="2" />
        <path d="m7 7 4 10M17 7l-4 10M8 5h8" />
      </>
    ),
    book: (
      <>
        <path d="M12 5C8 2 4 3 2 4v15c4-2 7-1 10 1 3-2 6-3 10-1V4c-2-1-6-2-10 1Zm0 0v15" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5" />
      </>
    ),
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    shield: (
      <>
        <path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    file: (
      <>
        <path d="M5 2h9l5 5v15H5Z M14 2v6h5M8 13h8M8 17h6" />
      </>
    ),
    check: <path d="m4 12 5 5L20 6" />,
    globe: (
      <>
        <circle cx="12" cy="12" r="10" />
        <ellipse cx="12" cy="12" rx="4" ry="10" />
        <path d="M2 12h20" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.grid}
    </svg>
  );
}
function Logo() {
  return (
    <div className="brand">
      <div className="brand-mark">
        <svg
          width="31"
          height="31"
          viewBox="0 0 32 32"
          fill="none"
          aria-hidden="true"
        >
          <ellipse
            cx="16"
            cy="16"
            rx="12"
            ry="6"
            transform="rotate(-50 16 16)"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <ellipse
            cx="16"
            cy="16"
            rx="12"
            ry="6"
            transform="rotate(50 16 16)"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <circle cx="16" cy="16" r="2.5" fill="currentColor" />
        </svg>
      </div>
      <div>
        MLVA <b>Atlas</b>
        <span>PROFILES. IN CONTEXT.</span>
      </div>
    </div>
  );
}

const matchColumns: ColumnDef<Match>[] = [
  {
    accessorFn: (r) => r.isolate.isolate_id,
    id: "isolate",
    header: "Reference isolate",
    cell: (c) => (
      <span className="isolate-name">
        {c.getValue<string>()}
        {c.row.original.exact && <span className="tiny-badge">Exact</span>}
      </span>
    ),
  },
  {
    accessorKey: "distance",
    header: "Distance",
    cell: (c) => <b>{number(c.getValue<number>())}</b>,
  },
  {
    accessorKey: "normalizedDistance",
    header: "Per locus / weight",
    cell: (c) => number(c.getValue<number>()),
  },
  {
    accessorKey: "matchingLoci",
    header: "Matching loci",
    cell: (c) => (
      <span>
        {c.getValue<number>()}
        <span className="muted"> / {c.row.original.comparedLoci}</span>
      </span>
    ),
  },
  { accessorKey: "missingLoci", header: "Missing" },
  {
    accessorFn: (r) => r.isolate.lineage ?? "Unlabeled",
    id: "lineage",
    header: "Lineage",
    cell: (c) => <span className="lineage-tag">{c.getValue<string>()}</span>,
  },
  {
    accessorFn: (r) => r.isolate.country ?? "Unknown",
    id: "country",
    header: "Country",
  },
];
const referenceColumns: ColumnDef<Isolate>[] = [
  { accessorKey: "isolate_id", header: "Isolate ID" },
  { accessorKey: "scheme", header: "Scheme" },
  { accessorKey: "lineage", header: "Lineage" },
  { accessorKey: "clade", header: "Clade" },
  { accessorKey: "country", header: "Country" },
  { accessorKey: "host", header: "Host" },
  { accessorKey: "year", header: "Year" },
  { accessorKey: "accession", header: "Accession" },
];

function makeRun(
  results: Analysis[],
  scheme: Scheme,
  metric: Metric,
  minOverlap: number,
  referenceName: string,
  references: Isolate[],
  warnings: string[],
): Run {
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    scheme,
    metric,
    minOverlap,
    referenceName,
    referenceCount: references.filter(
      (r) => r.scheme === scheme.id && r.organism === scheme.organism,
    ).length,
    warnings,
    results,
  };
}
async function asset(path: string) {
  const response = await fetch(base + path);
  if (!response.ok)
    throw new Error(`Could not load ${path} (${response.status}).`);
  return response;
}

export default function App() {
  const [page, setPage] = useState<Page>("analysis");
  const [tab, setTab] = useState<Tab>("overview");
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [references, setReferences] = useState<Isolate[]>([]);
  const [runRefs, setRunRefs] = useState<Isolate[]>([]);
  const [referenceName, setReferenceName] = useState(
    "Atlas synthetic reference v1",
  );
  const [world, setWorld] = useState<FeatureCollection | null>(null);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [inputMode, setInputMode] = useState<"file" | "paste">("file");
  const [selectedScheme, setSelectedScheme] = useState("auto");
  const [metric, setMetric] = useState<Metric>("hamming");
  const [overlap, setOverlap] = useState(0.8);
  const [run, setRun] = useState<Run | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [analyzedText, setAnalyzedText] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      try {
        const paths: unknown = await (await asset("schemes/index.json")).json();
        if (
          !Array.isArray(paths) ||
          !paths.every(
            (p) =>
              typeof p === "string" && /^schemes\/[a-z0-9_/-]+\.json$/i.test(p),
          )
        )
          throw new Error("Invalid scheme manifest.");
        const loaded = await Promise.all(
          paths.map(async (p) => validateScheme(await (await asset(p)).json())),
        );
        if (new Set(loaded.map((s) => s.id)).size !== loaded.length)
          throw new Error("Duplicate scheme IDs in manifest.");
        const [raw, csv] = await Promise.all([
          asset("references.json").then((r) => r.json()),
          asset("examples/MLVA_analysis_assemblies.csv").then((r) => r.text()),
        ]);
        const refs = importReferences(raw, loaded);
        const parsed = parseProfiles(csv, loaded);
        if (cancelled) return;
        setSchemes(loaded);
        setReferences(refs);
        setRunRefs(refs);
        setText(csv);
        setAnalyzedText(csv);
        setFileName("MLVA_analysis_assemblies.csv");
        setRun(
          makeRun(
            analyze(parsed.samples, refs, parsed.scheme, "hamming"),
            parsed.scheme,
            "hamming",
            0.8,
            "Atlas synthetic reference v1",
            refs,
            parsed.warnings,
          ),
        );
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void initialize();
    void asset("world.geojson")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setWorld(data);
      })
      .catch(() => {
        if (!cancelled)
          setNotice(
            "Map background is unavailable. Other analysis features remain available.",
          );
      });
    return () => {
      cancelled = true;
      workerRef.current?.terminate();
    };
  }, []);

  const parsed = useMemo(() => {
    if (!text || !schemes.length) return null;
    try {
      return {
        ...parseProfiles(
          text,
          schemes,
          selectedScheme === "auto" ? undefined : selectedScheme,
        ),
        error: null,
      };
    } catch (e) {
      return {
        error: e instanceof Error ? e.message : String(e),
        samples: [],
        scheme: null,
        warnings: [],
        detected: "",
      };
    }
  }, [text, schemes, selectedScheme]);
  const current = run?.results[index];
  const best = current?.matches[0];
  const compatibleRefs = useMemo(
    () =>
      run
        ? runRefs.filter(
            (r) =>
              r.scheme === run.scheme.id && r.organism === run.scheme.organism,
          )
        : [],
    [run, runRefs],
  );
  const dirty =
    run &&
    (text !== analyzedText ||
      metric !== run.metric ||
      overlap !== run.minOverlap ||
      (selectedScheme !== "auto" && selectedScheme !== run.scheme.id));
  const batchColumns = useMemo<ColumnDef<Analysis>[]>(
    () => [
      {
        accessorFn: (r) => r.sample.sample_id,
        id: "sample",
        header: "Sample",
        cell: (c) => (
          <button
            className="text-button"
            onClick={() => {
              setIndex(run!.results.indexOf(c.row.original));
              setTab("overview");
            }}
          >
            {c.getValue<string>()} ↗
          </button>
        ),
      },
      {
        accessorFn: (r) =>
          r.matches[0]?.isolate.isolate_id ?? "No eligible reference",
        id: "closest",
        header: "Closest isolate",
      },
      {
        accessorFn: (r) => r.matches[0]?.distance,
        id: "distance",
        header: "Distance",
      },
      {
        accessorFn: (r) => r.lineage.label ?? "Unassigned",
        id: "lineage",
        header: "Lineage",
      },
      {
        accessorFn: (r) => (r.lineage.label ? r.lineage.confidence : null),
        id: "support",
        header: "Vote support",
        cell: (c) =>
          c.getValue<number | null>() === null
            ? "—"
            : percent(c.getValue<number>()),
      },
      {
        accessorKey: "completeness",
        header: "Completeness",
        cell: (c) => percent(c.getValue<number>()),
      },
    ],
    [run],
  );

  function fail(e: unknown) {
    setError(e instanceof Error ? e.message : String(e));
    setNotice("");
  }
  async function acceptFile(file: File) {
    try {
      const content = await readFile(file);
      setText(content);
      setFileName(file.name);
      setError("");
      setNotice("File loaded. Review the detected scheme, then analyze.");
    } catch (e) {
      fail(e);
    }
  }
  async function loadDemo() {
    try {
      const csv = await (
        await asset("examples/MLVA_analysis_assemblies.csv")
      ).text();
      setText(csv);
      setFileName("MLVA_analysis_assemblies.csv");
      setSelectedScheme("auto");
      setPage("analysis");
      setError("");
      setNotice("Synthetic example loaded. Click Analyze profiles to run.");
    } catch (e) {
      fail(e);
    }
  }
  function startAnalysis() {
    if (!parsed?.scheme || parsed.error) {
      fail(parsed?.error ?? "Upload or paste profiles first.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    const scheme = parsed.scheme;
    workerRef.current?.terminate();
    const worker = new Worker(
      new URL("./analysis.worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;
    worker.onmessage = (
      event: MessageEvent<{ results?: Analysis[]; error?: string }>,
    ) => {
      worker.terminate();
      workerRef.current = null;
      setBusy(false);
      if (event.data.error) {
        fail(event.data.error);
        return;
      }
      if (event.data.results) {
        setRun(
          makeRun(
            event.data.results,
            scheme,
            metric,
            overlap,
            referenceName,
            references,
            parsed.warnings,
          ),
        );
        setRunRefs(references);
        setAnalyzedText(text);
        setIndex(0);
        setTab("overview");
        setNotice(
          `${event.data.results.length} ${event.data.results.length === 1 ? "profile" : "profiles"} analyzed in your browser.`,
        );
      }
    };
    worker.onerror = () => {
      worker.terminate();
      workerRef.current = null;
      setBusy(false);
      fail(
        "The analysis worker failed. Try a smaller batch or reload the page.",
      );
    };
    worker.postMessage({
      samples: parsed.samples,
      references,
      scheme,
      metric,
      minOverlap: overlap,
    });
  }
  async function importDatabase(file: File) {
    try {
      const content = await readFile(file);
      const scheme =
        schemes.find((s) => s.id === selectedScheme) ?? parsed?.scheme;
      if (!file.name.toLowerCase().endsWith(".json") && !scheme)
        throw new Error("Select a scheme before importing a reference CSV.");
      const refs = file.name.toLowerCase().endsWith(".json")
        ? importReferences(JSON.parse(content), schemes)
        : importReferenceCSV(content, scheme!);
      setReferences(refs);
      setReferenceName(file.name);
      setRun(null);
      setError("");
      setNotice(
        `Imported ${refs.length} reference isolates. Analyze your profiles against this database.`,
      );
    } catch (e) {
      fail(e);
    }
  }
  async function resetDatabase() {
    try {
      setReferences(
        importReferences(
          await (await asset("references.json")).json(),
          schemes,
        ),
      );
      setReferenceName("Atlas synthetic reference v1");
      setRun(null);
      setNotice("Synthetic reference database restored.");
      setError("");
    } catch (e) {
      fail(e);
    }
  }
  async function importPlugin(file: File) {
    try {
      const scheme = validateScheme(JSON.parse(await readFile(file)));
      if (schemes.some((s) => s.id === scheme.id))
        throw new Error(
          "A scheme with this ID is already registered. Use a distinct ID for a different version.",
        );
      setSchemes([...schemes, scheme]);
      setSelectedScheme(scheme.id);
      setNotice(
        `${scheme.name} registered for this session. Import its reference database next.`,
      );
      setError("");
    } catch (e) {
      fail(e);
    }
  }
  async function exportReport(format: "html" | "pdf", batch = false) {
    if (!run) return;
    setExporting(true);
    setError("");
    try {
      const figures = collectFigures();
      if (figures.length < 4)
        throw new Error(
          "Figures are still loading. Try the export again in a moment.",
        );
      if (format === "html")
        download(
          reportHTML(run, figures, batch ? undefined : index),
          `MLVA_Atlas_${batch ? "batch" : current!.sample.sample_id}.html`,
          "text/html",
        );
      else await reportPDF(run, figures, batch ? undefined : index);
      setNotice("Report downloaded.");
    } catch (e) {
      fail(e);
    } finally {
      setExporting(false);
    }
  }

  const nav = [
    { id: "analysis" as const, label: "Analysis workspace", icon: "grid" },
    {
      id: "references" as const,
      label: "Reference database",
      icon: "database",
    },
    { id: "schemes" as const, label: "Typing schemes", icon: "scheme" },
    { id: "guide" as const, label: "Documentation", icon: "book" },
  ];
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar">
        <Logo />
        <div className="sidebar-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {nav.map((item) => (
            <button
              key={item.id}
              className={page === item.id ? "nav-item selected" : "nav-item"}
              onClick={() => setPage(item.id)}
              aria-current={page === item.id ? "page" : undefined}
            >
              <Icon name={item.icon} />
              {item.label}
              {item.id === "analysis" && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="privacy-icon">
            <Icon name="shield" size={23} />
          </div>
          <h3>Your data stays yours.</h3>
          <p>
            Profiles are processed in this browser. No account, no upload
            server.
          </p>
          <div className="local-status">
            <span />
            LOCAL ANALYSIS
          </div>
        </div>
        <div className="sidebar-footer">
          <span className="version">MVP 0.1</span>
          <a
            href="https://github.com/microbemarsh/mlva_atlas"
            target="_blank"
            rel="noreferrer"
          >
            GitHub ↗
          </a>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div>
            <span className="topbar-brand">MLVA Atlas</span>
            <span className="breadcrumb-divider">/</span>
            <span>{nav.find((n) => n.id === page)?.label}</span>
          </div>
          <span className="browser-badge">
            <span />
            Browser workspace
          </span>
        </header>
        <main id="main">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {page === "analysis"
                  ? "FROM PROFILE TO PERSPECTIVE"
                  : page === "references"
                    ? "YOUR COMPARISON COLLECTION"
                    : page === "schemes"
                      ? "EXTENSIBLE BY DESIGN"
                      : "A GUIDE TO INTERPRETATION"}
              </p>
              <h1>
                {page === "analysis"
                  ? "Profiles in context."
                  : page === "references"
                    ? "Reference database"
                    : page === "schemes"
                      ? "Typing schemes"
                      : "How Atlas works"}
              </h1>
              <p className="page-description">
                {page === "analysis"
                  ? "Find your closest references. Explore the relationships. Share the evidence."
                  : page === "references"
                    ? "A transparent foundation for every comparison."
                    : page === "schemes"
                      ? "Define loci once. Use the same workflow across organisms."
                      : "From an allele table to a reproducible comparison."}
              </p>
            </div>
            {page === "analysis" && (
              <button
                className="button secondary"
                onClick={() => void loadDemo()}
                disabled={loading || busy}
              >
                <Icon name="file" size={17} />
                Load example
              </button>
            )}
          </div>
          <div aria-live="polite">
            {notice && (
              <div className="notice">
                <Icon name="check" size={18} />
                {notice}
                <button
                  aria-label="Dismiss notification"
                  onClick={() => setNotice("")}
                >
                  ×
                </button>
              </div>
            )}
          </div>
          {error && (
            <div className="error-message" role="alert">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                ×
              </button>
            </div>
          )}
          {loading ? (
            <div className="loading-state">
              <span className="spinner" />
              Loading scheme registry and example references…
            </div>
          ) : (
            <>
              {page === "analysis" && (
                <>
                  <section className="input-card">
                    <div className="section-heading">
                      <div className="heading-with-icon">
                        <span className="icon-box">
                          <Icon name="upload" />
                        </span>
                        <div>
                          <h2>Start with your profiles</h2>
                          <p>MLVA_finder output or a table of allele calls</p>
                        </div>
                      </div>
                      <span className="badge">CSV / TSV</span>
                    </div>
                    <fieldset disabled={busy} className="input-fieldset">
                      <div className="input-columns">
                        <div>
                          <div className="input-tabs">
                            <button
                              type="button"
                              className={inputMode === "file" ? "active" : ""}
                              onClick={() => setInputMode("file")}
                            >
                              Upload file
                            </button>
                            <button
                              type="button"
                              className={inputMode === "paste" ? "active" : ""}
                              onClick={() => setInputMode("paste")}
                            >
                              Paste profiles
                            </button>
                          </div>
                          {inputMode === "file" ? (
                            <div
                              role="button"
                              tabIndex={busy ? -1 : 0}
                              aria-label="Choose or drop an MLVA CSV file"
                              className={`dropzone ${dragging ? "dragging" : ""}`}
                              onClick={() =>
                                !busy && fileInput.current?.click()
                              }
                              onKeyDown={(e) => {
                                if (
                                  !busy &&
                                  (e.key === "Enter" || e.key === " ")
                                ) {
                                  e.preventDefault();
                                  fileInput.current?.click();
                                }
                              }}
                              onDragOver={(e) => {
                                e.preventDefault();
                                if (!busy) setDragging(true);
                              }}
                              onDragLeave={() => setDragging(false)}
                              onDrop={(e) => {
                                e.preventDefault();
                                setDragging(false);
                                if (!busy && e.dataTransfer.files[0])
                                  void acceptFile(e.dataTransfer.files[0]);
                              }}
                            >
                              <div className="upload-symbol">
                                <Icon
                                  name={fileName ? "file" : "upload"}
                                  size={27}
                                />
                              </div>
                              <strong>
                                {fileName || "Drop your MLVA file here"}
                              </strong>
                              <span>
                                {fileName
                                  ? "Click or drop a file to replace"
                                  : "or click to browse files"}
                              </span>
                              <small>
                                CSV, TSV or semicolon-delimited · up to 10 MB /
                                100 samples
                              </small>
                            </div>
                          ) : (
                            <textarea
                              aria-label="Paste MLVA profiles"
                              className="profile-input"
                              placeholder={
                                "sample_id,VNTR01,VNTR02,…\nSample_01,4,8,…"
                              }
                              value={text}
                              onChange={(e) => {
                                setText(e.target.value);
                                setFileName("Pasted profiles");
                              }}
                              spellCheck={false}
                            />
                          )}
                          <input
                            ref={fileInput}
                            type="file"
                            accept=".csv,.tsv,.txt"
                            className="sr-only"
                            aria-label="MLVA profile file"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) void acceptFile(file);
                              e.target.value = "";
                            }}
                          />
                          <div className="input-footnote">
                            <Icon name="shield" size={14} />
                            <span>
                              Your input remains in memory for this session.
                            </span>
                            <a
                              href={
                                base + "examples/MLVA_analysis_assemblies.csv"
                              }
                              download
                            >
                              Example CSV ↗
                            </a>
                          </div>
                        </div>
                        <div className="analysis-settings">
                          <label>
                            Typing scheme
                            <select
                              aria-label="Typing scheme"
                              value={selectedScheme}
                              onChange={(e) =>
                                setSelectedScheme(e.target.value)
                              }
                            >
                              <option value="auto">
                                Auto-detect from locus names
                              </option>
                              {schemes.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name} · {s.organism}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className="settings-row">
                            <label>
                              Distance metric
                              <select
                                aria-label="Distance metric"
                                value={metric}
                                onChange={(e) =>
                                  setMetric(e.target.value as Metric)
                                }
                              >
                                {Object.entries(metricNames).map(([k, v]) => (
                                  <option key={k} value={k}>
                                    {v}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              Minimum overlap
                              <select
                                aria-label="Minimum overlap"
                                value={overlap}
                                onChange={(e) =>
                                  setOverlap(Number(e.target.value))
                                }
                              >
                                <option value={1}>100% of loci</option>
                                <option value={0.9}>90% of loci</option>
                                <option value={0.8}>80% of loci</option>
                                <option value={0.5}>50% of loci</option>
                              </select>
                            </label>
                          </div>
                          <div
                            className={`detection-status ${parsed?.error ? "invalid" : ""}`}
                          >
                            {parsed?.scheme ? (
                              <>
                                <Icon name="check" size={17} />
                                <span>
                                  <b>
                                    {parsed.samples.length} samples detected
                                  </b>
                                  <small>{parsed.detected}</small>
                                </span>
                              </>
                            ) : (
                              <span>
                                {parsed?.error ??
                                  "Upload profiles to detect a scheme."}
                              </span>
                            )}
                          </div>
                          <button
                            className="button primary analyze-button"
                            onClick={startAnalysis}
                            disabled={!parsed?.scheme || busy}
                          >
                            {busy ? (
                              <>
                                <span className="spinner" />
                                Analyzing…
                              </>
                            ) : (
                              <>
                                Analyze profiles
                                <Icon name="arrow" size={19} />
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </fieldset>
                  </section>
                  {run && current ? (
                    <>
                      <div className="results-heading">
                        <div>
                          <span className="status-dot" />
                          <h2>Analysis results</h2>
                          <span className="badge">
                            {run.results.length}{" "}
                            {run.results.length === 1 ? "sample" : "samples"}
                          </span>
                          {run.scheme.synthetic && (
                            <span className="demo-label">
                              Synthetic demonstration
                            </span>
                          )}
                        </div>
                        <label className="sample-selector">
                          Sample
                          <select
                            aria-label="Sample"
                            value={index}
                            onChange={(e) => setIndex(Number(e.target.value))}
                          >
                            {run.results.map((r, i) => (
                              <option key={r.sample.sample_id} value={i}>
                                {r.sample.sample_id}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      {dirty && (
                        <div className="notice">
                          Input or settings changed. These results show the
                          previous run; click Analyze profiles to update them.
                        </div>
                      )}
                      <div
                        className="results-tabs"
                        role="tablist"
                        aria-label="Result views"
                      >
                        {(
                          ["overview", "figures", "batch", "downloads"] as const
                        ).map((t) => (
                          <button
                            key={t}
                            role="tab"
                            aria-selected={tab === t}
                            aria-controls={`panel-${t}`}
                            id={`tab-${t}`}
                            className={tab === t ? "active" : ""}
                            onClick={() => setTab(t)}
                          >
                            {
                              {
                                overview: "Overview",
                                figures: "Visualizations",
                                batch: "Batch results",
                                downloads: "Download center",
                              }[t]
                            }
                            {t === "figures" && <span>5</span>}
                          </button>
                        ))}
                      </div>
                      {tab === "overview" && (
                        <div
                          role="tabpanel"
                          id="panel-overview"
                          aria-labelledby="tab-overview"
                        >
                          <div className="summary-grid">
                            <article className="summary-card">
                              <div className="summary-label">
                                CLOSEST REFERENCE
                                <Icon name="database" size={17} />
                              </div>
                              <div className="summary-value id-value">
                                {best?.isolate.isolate_id ??
                                  "No eligible match"}
                              </div>
                              <div className="summary-detail">
                                {best?.isolate.country ?? "Location unknown"}
                                {best?.isolate.year
                                  ? ` · ${best.isolate.year}`
                                  : ""}
                                <span
                                  className={
                                    best?.exact ? "mini-status" : "muted"
                                  }
                                >
                                  {best?.exact
                                    ? "Exact profile"
                                    : "Nearest neighbor"}
                                </span>
                              </div>
                            </article>
                            <article className="summary-card">
                              <div className="summary-label">
                                PROFILE DISTANCE
                                <Icon name="scheme" size={17} />
                              </div>
                              <div className="summary-value">
                                {best ? number(best.distance) : "—"}
                                <span>
                                  {run.metric === "hamming"
                                    ? "loci differ"
                                    : run.metric === "weighted"
                                      ? "weighted units"
                                      : "allele units"}
                                </span>
                              </div>
                              <div className="summary-detail">
                                {metricNames[run.metric]}
                                <span>
                                  {best
                                    ? `${best.matchingLoci}/${best.comparedLoci} match`
                                    : ""}
                                </span>
                              </div>
                            </article>
                            <article className="summary-card">
                              <div className="summary-label">
                                PREDICTED LINEAGE
                                <Icon name="globe" size={17} />
                              </div>
                              <div className="summary-value id-value">
                                {current.lineage.label ?? "Unassigned"}
                              </div>
                              <div className="summary-detail">
                                Clade: {current.clade.label ?? "Unassigned"}
                                <span>
                                  {current.lineage.supportingIsolates}{" "}
                                  supporting
                                </span>
                              </div>
                            </article>
                            <article className="summary-card accent">
                              <div className="summary-label">
                                LINEAGE VOTE SUPPORT
                                <Icon name="check" size={17} />
                              </div>
                              <div className="summary-value">
                                {current.lineage.label
                                  ? percent(current.lineage.confidence)
                                  : "—"}
                              </div>
                              <div className="summary-detail">
                                Uncalibrated confidence
                                <span>
                                  {percent(current.completeness)} complete
                                </span>
                              </div>
                            </article>
                          </div>
                          <div className="overview-grid">
                            <section className="panel matches-panel">
                              <div className="section-heading">
                                <div>
                                  <h2>Closest reference isolates</h2>
                                  <p>
                                    Top {current.matches.length} matches ·
                                    ranked by normalized distance
                                  </p>
                                </div>
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    download(
                                      resultsCSV({
                                        ...run,
                                        results: [current],
                                      }),
                                      "MLVA_Atlas_matches.csv",
                                      "text/csv",
                                    )
                                  }
                                >
                                  <Icon name="download" size={15} />
                                  CSV
                                </button>
                              </div>
                              <Table
                                data={current.matches}
                                columns={matchColumns}
                                label="Closest reference isolates"
                              />
                              <div className="panel-footnote">
                                {current.eligibleReferences} references meet the{" "}
                                {percent(run.minOverlap)} overlap threshold ·{" "}
                                {current.excludedReferences} excluded
                              </div>
                            </section>
                            <section className="panel lineage-panel">
                              <div className="section-heading">
                                <div>
                                  <h2>Lineage evidence</h2>
                                  <p>Neighbor vote distribution</p>
                                </div>
                              </div>
                              <div className="lineage-bars">
                                {current.lineage.distribution.length ? (
                                  current.lineage.distribution.map((d, i) => (
                                    <div key={d.label}>
                                      <div className="bar-label">
                                        <span>
                                          <i
                                            style={{
                                              background: [
                                                "#197968",
                                                "#be965c",
                                                "#7d8db6",
                                              ][i % 3],
                                            }}
                                          />
                                          {d.label}
                                        </span>
                                        <strong>{percent(d.support)}</strong>
                                      </div>
                                      <div className="bar-track">
                                        <span
                                          style={{
                                            width: percent(d.support),
                                            background: [
                                              "#197968",
                                              "#be965c",
                                              "#7d8db6",
                                            ][i % 3],
                                          }}
                                        />
                                      </div>
                                      <small>
                                        {d.count} supporting isolate
                                        {d.count === 1 ? "" : "s"}
                                      </small>
                                    </div>
                                  ))
                                ) : (
                                  <p>No labeled eligible neighbors.</p>
                                )}
                              </div>
                              <p className="evidence-note">
                                {current.lineage.labeledIsolates} of{" "}
                                {current.lineage.totalIsolates} voting neighbors
                                have lineage labels. Equal winning votes remain
                                unassigned. Support is not a calibrated
                                probability.
                              </p>
                              <button
                                className="text-button"
                                onClick={() => setTab("figures")}
                              >
                                Explore sample placement{" "}
                                <Icon name="arrow" size={17} />
                              </button>
                            </section>
                          </div>
                          <div className="run-details">
                            <span>
                              <b>Scheme</b>
                              {run.scheme.name} · v{run.scheme.version}
                            </span>
                            <span>
                              <b>Reference set</b>
                              {run.referenceName}
                            </span>
                            <span>
                              <b>Analyzed</b>
                              {new Date(run.createdAt).toLocaleString()}
                            </span>
                          </div>
                          {run.warnings.map((w) => (
                            <p className="data-warning" key={w}>
                              {w}
                            </p>
                          ))}
                        </div>
                      )}
                      {tab === "batch" && (
                        <section
                          className="panel"
                          role="tabpanel"
                          id="panel-batch"
                          aria-labelledby="tab-batch"
                        >
                          <div className="section-heading">
                            <div>
                              <h2>All uploaded samples</h2>
                              <p>
                                Select a sample for its report. Multi-sample
                                clustering is available under Visualizations.
                              </p>
                            </div>
                          </div>
                          <Table
                            data={run.results}
                            columns={batchColumns}
                            label="Batch analysis results"
                            search
                          />
                        </section>
                      )}
                      {tab === "downloads" && (
                        <section
                          role="tabpanel"
                          id="panel-downloads"
                          aria-labelledby="tab-downloads"
                        >
                          <div className="download-grid">
                            <article className="panel download-card">
                              <Icon name="file" size={30} />
                              <h3>Sample report</h3>
                              <p>
                                {current.sample.sample_id}: input profile,
                                matching isolates, lineage votes, metadata, and
                                figures.
                              </p>
                              <div className="flex gap-2">
                                <button
                                  className="button secondary"
                                  disabled={exporting}
                                  onClick={() => void exportReport("html")}
                                >
                                  HTML report
                                </button>
                                <button
                                  className="button primary"
                                  disabled={exporting}
                                  onClick={() => void exportReport("pdf")}
                                >
                                  PDF report
                                </button>
                              </div>
                            </article>
                            <article className="panel download-card">
                              <Icon name="database" size={30} />
                              <h3>Batch results</h3>
                              <p>
                                {run.results.length} samples with all top
                                matches. JSON preserves profiles, scheme
                                weights, metadata, and run settings.
                              </p>
                              <div className="flex gap-2">
                                <button
                                  className="button secondary"
                                  onClick={() =>
                                    download(
                                      resultsCSV(run),
                                      "MLVA_Atlas_results.csv",
                                      "text/csv",
                                    )
                                  }
                                >
                                  CSV table
                                </button>
                                <button
                                  className="button secondary"
                                  onClick={() =>
                                    download(
                                      JSON.stringify(run, null, 2),
                                      "MLVA_Atlas_results.json",
                                      "application/json",
                                    )
                                  }
                                >
                                  JSON data
                                </button>
                              </div>
                            </article>
                            <article className="panel download-card">
                              <Icon name="book" size={30} />
                              <h3>Combined report</h3>
                              <p>
                                Summaries and matches for every sample, with
                                figures from the currently selected sample.
                              </p>
                              <div className="flex gap-2">
                                <button
                                  className="button secondary"
                                  disabled={exporting}
                                  onClick={() =>
                                    void exportReport("html", true)
                                  }
                                >
                                  Batch HTML
                                </button>
                                <button
                                  className="button secondary"
                                  disabled={exporting}
                                  onClick={() => void exportReport("pdf", true)}
                                >
                                  Batch PDF
                                </button>
                              </div>
                            </article>
                            <article className="panel download-card">
                              <Icon name="grid" size={30} />
                              <h3>Publication figures</h3>
                              <p>
                                Download each figure as SVG, PNG at 3×
                                resolution, or vector PDF. Dendrograms also
                                export Newick.
                              </p>
                              <button
                                className="button secondary"
                                onClick={() => setTab("figures")}
                              >
                                Open visualizations{" "}
                                <Icon name="arrow" size={17} />
                              </button>
                            </article>
                          </div>
                          {exporting && (
                            <p role="status">Preparing your report…</p>
                          )}
                        </section>
                      )}
                    </>
                  ) : (
                    <div className="empty-state">
                      <Icon name="scheme" size={40} />
                      <h2>Your next comparison starts here.</h2>
                      <p>
                        Choose your profiles and reference set, then click
                        Analyze profiles.
                      </p>
                    </div>
                  )}
                </>
              )}
              {page === "references" && (
                <>
                  <div className="info-banner">
                    <Icon name="database" size={26} />
                    <div>
                      <strong>{referenceName}</strong>
                      <p>
                        {references.length} isolates ·{" "}
                        {new Set(references.map((r) => r.organism)).size}{" "}
                        organism(s) ·{" "}
                        {new Set(references.map((r) => r.scheme)).size}{" "}
                        scheme(s)
                      </p>
                    </div>
                  </div>
                  <div className="toolbar">
                    <label className="button primary">
                      Import reference CSV / JSON
                      <input
                        className="sr-only"
                        type="file"
                        accept=".csv,.tsv,.json"
                        disabled={busy}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void importDatabase(f);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => void resetDatabase()}
                    >
                      Restore demo database
                    </button>
                    <button
                      className="text-button"
                      onClick={() =>
                        download(
                          JSON.stringify(references, null, 2),
                          "references.json",
                          "application/json",
                        )
                      }
                    >
                      Export database ↗
                    </button>
                  </div>
                  <p className="muted">
                    An import replaces the current in-memory database after
                    validation. CSV imports use the selected or detected scheme;
                    JSON records specify their own. Reloading restores the
                    bundled dataset.
                  </p>
                  <section className="panel">
                    <Table
                      data={references}
                      columns={referenceColumns}
                      label="Reference database"
                      search
                    />
                  </section>
                </>
              )}
              {page === "schemes" && (
                <>
                  <div className="toolbar">
                    <label className="button primary">
                      Import scheme JSON
                      <input
                        type="file"
                        className="sr-only"
                        accept=".json"
                        disabled={busy}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void importPlugin(f);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    <a
                      className="button secondary"
                      href={base + "examples/custom-scheme.json"}
                      download
                    >
                      Download custom template
                    </a>
                  </div>
                  <p className="muted">
                    The bundled MLVA8, MLVA15, MLVA20, MLVA25 and MLVA31
                    templates use fictional VNTR names. Scheme identity depends
                    on registered locus names and organism, never on locus count
                    alone.
                  </p>
                  <div className="scheme-grid">
                    {schemes.map((s) => (
                      <article className="panel scheme-card" key={s.id}>
                        <div className="flex items-center justify-between">
                          <Icon name="scheme" size={25} />
                          <span className="badge">{s.loci.length} loci</span>
                        </div>
                        <h3>{s.name}</h3>
                        <p>{s.organism}</p>
                        <small>{s.description}</small>
                        <div className="locus-list">
                          {s.loci.map((l) => (
                            <span
                              key={l}
                              title={`Weight: ${s.weights?.[l] ?? 1}`}
                            >
                              {l}
                            </span>
                          ))}
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="muted">v{s.version}</span>
                          <button
                            className="text-button"
                            onClick={() => {
                              setSelectedScheme(s.id);
                              setPage("analysis");
                            }}
                          >
                            Use scheme ↗
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              )}
              {page === "guide" && <Guide />}
            </>
          )}
          {run && (
            <div
              className={
                page === "analysis" && tab === "figures"
                  ? ""
                  : "offscreen-figures"
              }
              role="tabpanel"
              id="panel-figures"
              aria-labelledby="tab-figures"
              aria-hidden={page !== "analysis" || tab !== "figures"}
              inert={page !== "analysis" || tab !== "figures"}
            >
              <Suspense
                fallback={
                  <p className="loading-state">Loading visualizations…</p>
                }
              >
                <Figures
                  key={run.createdAt}
                  run={run}
                  index={index}
                  references={compatibleRefs}
                  world={world}
                  onError={setError}
                />
              </Suspense>
            </div>
          )}
          <footer className="page-footer">
            <span>
              MLVA Atlas <span className="footer-separator">/</span> Open
              profiles. Clear comparisons.
            </span>
            <span>Static by design. Private by default.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}

function Guide() {
  return (
    <div className="guide-content">
      <section className="panel">
        <span className="eyebrow">01 / INPUT</span>
        <h2>Bring allele calls from your existing workflow.</h2>
        <p>
          Upload MLVA_analysis_assemblies.csv, paste a wide table with a sample
          ID and one column per locus, or use long-form sample/locus/allele
          rows. MLVA Atlas does not call alleles from sequences.
        </p>
        <pre>
          key,Access_number,VNTR01,VNTR02,…
          <br />
          001,Sample_01,3,10,…
        </pre>
        <p>
          Commas, tabs and semicolons are detected automatically. Blank, NA, ND,
          N/A, NaN, null, ? and - are missing calls. Zero is a real allele
          value. Decimal calls and MLVA_finder’s numeric “u” suffix are
          accepted; ambiguous calls must be resolved upstream.
        </p>
      </section>
      <section className="panel">
        <span className="eyebrow">02 / COMPARE</span>
        <h2>Choose the comparison that fits your scheme.</h2>
        <p>
          <strong>Hamming:</strong> number of unequal observed loci.{" "}
          <strong>Absolute:</strong> sum of absolute allele differences.{" "}
          <strong>Weighted:</strong> sum of differences multiplied by positive,
          scheme-defined locus weights.
        </p>
        <p>
          Ranks use distance divided by compared loci, or by compared weights
          for weighted distance. Raw scores remain visible. A reference needs
          the configured fraction of all scheme loci called in both profiles. An
          exact match requires every scheme locus to be present and equal.
        </p>
        <p>
          Only references with the same scheme ID and organism are eligible.
          Register validated aliases explicitly; the parser never guesses
          biological equivalence from a name or locus count.
        </p>
      </section>
      <section className="panel">
        <span className="eyebrow">03 / INTERPRET</span>
        <h2>Read vote support with its evidence.</h2>
        <p>
          The top ten neighbors vote, including all ties at the tenth normalized
          distance. Complete exact matches, when available, form the voting set
          instead. Each labeled neighbor contributes its locus coverage divided
          by (1 + normalized distance). Winning support is its share of labeled
          voting weight. Equal winners remain unassigned.
        </p>
        <p>
          This support is uncalibrated. Small or biased databases may yield high
          support without strong evidence. Unlabeled neighbors are counted but
          do not vote. MLVA clusters are descriptive similarity trees; they do
          not establish ancestry, transmission, or query geography.
        </p>
      </section>
      <section className="panel">
        <span className="eyebrow">04 / EXTEND & EXPORT</span>
        <h2>A static application with room to grow.</h2>
        <p>
          Import a custom scheme JSON, then compatible reference JSON or CSV.
          Imports are validated before replacing session data. For a permanent
          deployment, add a plugin under public/schemes, register it in
          index.json, and rebuild.
        </p>
        <p>
          The synthetic examples are for interface exploration. Replace them
          with curated, versioned data for your intended application. Browser
          limits: 10 MB per file, 100 query profiles, 10,000 references, 100
          loci per scheme, and 50 profiles per clustering figure. A batch above
          50 million locus comparisons must be split.
        </p>
        <p>
          HTML reports are self-contained and printable. PDF reports and figures
          use vector graphics; PNGs use three times the SVG dimensions. Standard
          PDF text fonts cover Latin text; use HTML/SVG for full Unicode labels.
          Figures in a combined report describe the active sample. Export
          separate sample reports for each sample’s figures.
        </p>
        <div className="guide-links">
          <a href={base + "examples/custom-scheme.json"} download>
            Scheme template ↗
          </a>
          <a href={base + "examples/custom-references.json"} download>
            Custom references ↗
          </a>
          <a href={base + "examples/custom-profiles.csv"} download>
            Custom profiles ↗
          </a>
        </div>
      </section>
    </div>
  );
}
