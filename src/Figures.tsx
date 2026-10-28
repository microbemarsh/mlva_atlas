import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  cluster as d3cluster,
  geoNaturalEarth1,
  geoPath,
  hierarchy,
  interpolateRgb,
  scaleLinear,
} from "d3";
import * as echarts from "echarts/core";
import { RadarChart } from "echarts/charts";
import {
  RadarComponent,
  TitleComponent,
  TooltipComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { FeatureCollection } from "geojson";
import { clusterProfiles, metricNames, toNewick } from "./analysis";
import { readFile } from "./data";
import { download, exportFigure, snapshotSVG } from "./exports";
import type { Analysis, Isolate, Run } from "./types";

echarts.use([
  RadarChart,
  RadarComponent,
  TitleComponent,
  TooltipComponent,
  SVGRenderer,
]);
const ink = "#24453f",
  muted = "#687d77",
  green = "#16816d";
const palette = [
  "#197968",
  "#b17a39",
  "#6877b4",
  "#b26371",
  "#6b8c48",
  "#8d62a6",
];
export const labelColor = (name: string) =>
  palette[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % palette.length];

function Frame({
  title,
  subtitle,
  height = 430,
  children,
}: {
  title: string;
  subtitle: string;
  height?: number;
  children: ReactNode;
}) {
  return (
    <svg
      data-export="true"
      role="img"
      aria-label={`${title}. ${subtitle}`}
      viewBox={`0 0 1000 ${height}`}
      xmlns="http://www.w3.org/2000/svg"
      fontFamily="Arial, sans-serif"
      fontSize="12"
      fill={ink}
    >
      <rect width="1000" height={height} fill="white" />
      <text x="30" y="32" fontSize="18" fontWeight="bold">
        {title}
      </text>
      <text x="30" y="54" fontSize="11" fill={muted}>
        {subtitle}
      </text>
      {children}
      <text x="30" y={height - 15} fontSize="10" fill={muted}>
        MLVA ATLAS · Exploratory profile comparison
      </text>
    </svg>
  );
}

export function FigureCard({
  title,
  number,
  caption,
  children,
  onError,
  extra,
}: {
  title: string;
  number: string;
  caption: string;
  children: ReactNode;
  onError: (s: string) => void;
  extra?: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  async function save(format: "svg" | "png" | "pdf") {
    const svg =
      ref.current?.querySelector<SVGSVGElement>("svg[data-export]") ??
      ref.current?.querySelector<SVGSVGElement>("[data-chart] svg");
    if (!svg) {
      onError("The figure is not available yet.");
      return;
    }
    setBusy(true);
    try {
      await exportFigure(snapshotSVG(svg), title, format);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section ref={ref} className="figure-card" data-figure={title}>
      <div className="figure-heading">
        <div>
          <span className="eyebrow">FIGURE {number}</span>
          <h3>{title}</h3>
        </div>
        <div className="figure-actions">
          {extra}
          {(["svg", "png", "pdf"] as const).map((format) => (
            <button
              key={format}
              disabled={busy}
              onClick={() => void save(format)}
              aria-label={`Download ${title} as ${format.toUpperCase()}`}
            >
              {format.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      {children}
      <p className="figure-caption">{caption}</p>
    </section>
  );
}

function Heatmap({ result, run }: { result: Analysis; run: Run }) {
  const [selection, setSelection] = useState(
    "Hover or select a cell to inspect the allele difference.",
  );
  const rows = result.matches;
  const loci = run.scheme.loci;
  const left = 180,
    cell = Math.min(38, 760 / loci.length),
    height = Math.max(300, 180 + rows.length * 28);
  const differences = rows.flatMap((m) =>
    loci.map((l) =>
      result.sample.profile[l] == null || m.isolate.profile[l] == null
        ? null
        : Math.abs(result.sample.profile[l]! - m.isolate.profile[l]!),
    ),
  );
  const max = Math.max(
    1,
    ...differences.filter((v): v is number => v !== null),
  );
  const color = scaleLinear<string>()
    .domain([0, max])
    .range(["#e2eee8", run.scheme.visualization.accent])
    .interpolate(interpolateRgb);
  return (
    <>
      <div className="chart-scroll">
        <Frame
          title="Nearest isolate heatmap"
          subtitle={`${result.sample.sample_id} · ${run.scheme.name} · absolute allele differences (all metrics)`}
          height={height}
        >
          {loci.map((l, j) => (
            <text
              key={l}
              x={left + j * cell + cell / 2}
              y="90"
              textAnchor="end"
              transform={`rotate(-45 ${left + j * cell + cell / 2} 90)`}
              fontSize="10"
            >
              {l}
            </text>
          ))}
          {rows.map((m, i) => (
            <g key={m.isolate.isolate_id}>
              <text
                x={left - 14}
                y={116 + i * 28}
                textAnchor="end"
                fontSize="11"
              >
                {m.isolate.isolate_id}
              </text>
              {loci.map((l, j) => {
                const d = differences[i * loci.length + j];
                const message = `${m.isolate.isolate_id} / ${l}: query ${result.sample.profile[l] ?? "missing"}, reference ${m.isolate.profile[l] ?? "missing"}, difference ${d ?? "not compared"}`;
                return (
                  <g
                    key={l}
                    role="button"
                    tabIndex={0}
                    aria-label={message}
                    onClick={() => setSelection(message)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelection(message);
                      }
                    }}
                  >
                    <rect
                      x={left + j * cell}
                      y={100 + i * 28}
                      width={cell - 2}
                      height="25"
                      rx="2"
                      fill={d === null ? "#e8e9eb" : color(d)}
                    />
                    <title>{message}</title>
                    {d === null && (
                      <text
                        x={left + j * cell + cell / 2 - 1}
                        y={116 + i * 28}
                        textAnchor="middle"
                        fontSize="10"
                        fill={muted}
                      >
                        ×
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          ))}
          {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
            <g key={t}>
              <rect
                x={left + i * 34}
                y={height - 53}
                width="34"
                height="10"
                fill={color(t * max)}
              />
              <text x={left + i * 34} y={height - 30} fontSize="10">
                {(t * max).toFixed(1)}
              </text>
            </g>
          ))}
          <text x={left + 195} y={height - 44} fontSize="10">
            Absolute allele difference
          </text>
          <rect x="610" y={height - 53} width="12" height="12" fill="#e8e9eb" />
          <text x="630" y={height - 43} fontSize="10">
            Missing call
          </text>
          {!rows.length && (
            <text x="180" y="160">
              No references meet the overlap threshold.
            </text>
          )}
        </Frame>
      </div>
      <p className="cell-inspector" aria-live="polite">
        {selection}
      </p>
    </>
  );
}

function Dendrogram({
  result,
  run,
  batch,
  onError,
}: {
  result: Analysis;
  run: Run;
  batch: boolean;
  onError: (s: string) => void;
}) {
  const outcome = useMemo(() => {
    try {
      const results = batch ? run.results : [result];
      const references = [
        ...new Map(
          results.flatMap((r) =>
            r.matches.map((m) => [m.isolate.isolate_id, m.isolate] as const),
          ),
        ).values(),
      ];
      const items = [
        ...results.map((r) => ({
          name: `Query: ${r.sample.sample_id}`,
          profile: r.sample.profile,
        })),
        ...references.map((r) => ({
          name: `Ref: ${r.isolate_id}`,
          profile: r.profile,
        })),
      ];
      return { ...clusterProfiles(items, run.scheme, run.metric), error: null };
    } catch (e) {
      return {
        error: e instanceof Error ? e.message : String(e),
        tree: null,
        common: 0,
      };
    }
  }, [run, result, batch]);
  if (!outcome.tree)
    return (
      <div className="empty">
        {outcome.error} Select a smaller batch or profiles with more shared
        calls.
      </div>
    );
  const root = hierarchy(outcome.tree);
  const height = Math.max(320, root.leaves().length * 25 + 145);
  const layout = d3cluster<typeof outcome.tree>().size([height - 145, 680])(
    root,
  );
  const scale = scaleLinear()
    .domain([0, Math.max(outcome.tree.height, 0.001)])
    .range([720, 50]);
  const x = (n: typeof layout) => scale(n.data.height),
    y = (n: typeof layout) => n.x + 85;
  return (
    <>
      <div className="chart-scroll">
        <Frame
          title={`${batch ? "Multi-sample" : "Sample"} distance dendrogram`}
          subtitle={`${run.scheme.name} · average linkage · ${outcome.common} common loci · ${metricNames[run.metric]} per locus/weight`}
          height={height}
        >
          {layout.links().map((link, i) => (
            <path
              key={i}
              d={`M${x(link.source)},${y(link.source)}V${y(link.target)}H${x(link.target)}`}
              fill="none"
              stroke="#93aba1"
              strokeWidth="1.5"
            />
          ))}
          {layout.leaves().map((leaf) => (
            <g key={leaf.data.name}>
              <circle
                cx={x(leaf)}
                cy={y(leaf)}
                r="4"
                fill={leaf.data.name.startsWith("Query:") ? green : "#c1cec7"}
              />
              <text
                x={x(leaf) + 12}
                y={y(leaf) + 4}
                fontSize="11"
                fontWeight={
                  leaf.data.name.startsWith("Query:") ? "bold" : "normal"
                }
                fill={leaf.data.name.startsWith("Query:") ? green : ink}
              >
                {leaf.data.name}
              </text>
            </g>
          ))}
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <line
                x1={50 + 670 * t}
                x2={50 + 670 * t}
                y1={height - 53}
                y2={height - 48}
                stroke={muted}
              />
              <text
                x={50 + 670 * t}
                y={height - 33}
                fontSize="10"
                textAnchor="middle"
              >
                {(outcome.tree!.height * 2 * (1 - t)).toFixed(2)}
              </text>
            </g>
          ))}
          <line
            x1="50"
            x2="720"
            y1={height - 53}
            y2={height - 53}
            stroke={muted}
          />
        </Frame>
      </div>
      <button
        className="text-button"
        onClick={() => {
          try {
            download(
              toNewick(outcome.tree!),
              "MLVA_Atlas_clustering.nwk",
              "text/plain",
            );
          } catch (e) {
            onError(String(e));
          }
        }}
      >
        Download Newick tree ↗
      </button>
    </>
  );
}

function Placement({ result, run }: { result: Analysis; run: Run }) {
  const height = Math.max(320, result.matches.length * 36 + 130);
  const middle = (height + 75) / 2;
  return (
    <Frame
      title="Lineage neighborhood"
      subtitle={`${result.sample.sample_id} · ${run.scheme.name} · reference annotations; connections show similarity, not ancestry`}
      height={height}
    >
      <text x="490" y="88" fontSize="10" fill={muted}>
        REFERENCE ISOLATE
      </text>
      <text x="690" y="88" fontSize="10" fill={muted}>
        LINEAGE
      </text>
      <text x="845" y="88" fontSize="10" fill={muted}>
        CLADE
      </text>
      <rect
        x="35"
        y={middle - 36}
        width="220"
        height="72"
        rx="10"
        fill="#eef7f2"
        stroke="#8ab8a4"
      />
      <text
        x="145"
        y={middle - 8}
        textAnchor="middle"
        fontSize="10"
        fill={green}
      >
        QUERY SAMPLE
      </text>
      <text
        x="145"
        y={middle + 14}
        textAnchor="middle"
        fontSize="15"
        fontWeight="bold"
      >
        {result.sample.sample_id}
      </text>
      {result.matches.map((m, i) => {
        const y = 110 + i * 36;
        return (
          <g key={m.isolate.isolate_id}>
            <path
              d={`M255,${middle} C350,${middle} 360,${y} 465,${y}`}
              stroke={labelColor(m.isolate.clade ?? "Unlabeled")}
              strokeOpacity="0.45"
              strokeWidth="1.5"
              fill="none"
            />
            <circle
              cx="468"
              cy={y}
              r="5"
              fill={labelColor(m.isolate.clade ?? "Unlabeled")}
            />
            <text x="490" y={y + 4}>
              {m.isolate.isolate_id}
            </text>
            <text x="690" y={y + 4}>
              {m.isolate.lineage ?? "Unlabeled"}
            </text>
            <text
              x="845"
              y={y + 4}
              fill={labelColor(m.isolate.clade ?? "Unlabeled")}
            >
              {m.isolate.clade ?? "Unlabeled"}
            </text>
            <title>{`Raw distance ${m.distance}; normalized ${m.normalizedDistance.toFixed(4)}`}</title>
          </g>
        );
      })}
      {!result.matches.length && (
        <text x="480" y="180">
          No eligible neighbors.
        </text>
      )}
    </Frame>
  );
}

interface NewickNode {
  name: string;
  attribute?: string;
  children?: NewickNode[];
}
function NewickViewer({
  result,
  onError,
}: {
  result: Analysis;
  onError: (s: string) => void;
}) {
  const [tree, setTree] = useState<NewickNode | null>(null);
  const [name, setName] = useState("");
  async function load(file: File) {
    try {
      const text = await readFile(file);
      if (text.length > 100000 || !text.trim().endsWith(";"))
        throw new Error(
          "Use a Newick tree ending in a semicolon, at most 100 KB and 100 tips.",
        );
      const { newickParser } = await import("phylotree");
      const parsed = newickParser(text, {});
      if (parsed.error || !parsed.json)
        throw new Error(parsed.error || "Invalid Newick tree.");
      const data = parsed.json as NewickNode;
      const root = hierarchy(data);
      const tips = root.leaves();
      if (tips.length > 100 || tips.length < 2)
        throw new Error("Tree must contain 2–100 tips.");
      if (
        tips.some((n) => !n.data.name) ||
        new Set(tips.map((n) => n.data.name)).size !== tips.length
      )
        throw new Error("Tree tip names must be present and unique.");
      if (
        root
          .descendants()
          .some(
            (n) =>
              n.data.attribute !== undefined &&
              (!Number.isFinite(Number(n.data.attribute)) ||
                Number(n.data.attribute) < 0),
          )
      )
        throw new Error("Branch lengths must be finite and nonnegative.");
      setTree(data);
      setName(file.name);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }
  const root = tree ? hierarchy(tree) : null;
  const height = root ? Math.max(320, root.leaves().length * 24 + 130) : 320;
  const layout = root
    ? d3cluster<NewickNode>().size([height - 130, 650])(root)
    : null;
  return (
    <div className="newick-panel">
      <div className="flex flex-wrap items-center gap-3">
        <label className="button secondary">
          Open reference Newick
          <input
            type="file"
            className="sr-only"
            accept=".nwk,.newick,.tree,.txt"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void load(f);
              e.target.value = "";
            }}
          />
        </label>
        {tree && (
          <button className="text-button" onClick={() => setTree(null)}>
            Remove tree
          </button>
        )}
      </div>
      <p className="muted">
        Optional supplied phylogeny. Tip names match isolate/sample IDs exactly.
        Query tips are highlighted only when already present; no branches are
        inferred.
      </p>
      {layout && (
        <div data-figure="Supplied reference phylogeny">
          <Frame
            title="Supplied reference phylogeny"
            subtitle={`${name} · topology view (branch lengths not scaled) · green: existing query tip; colored: nearest reference`}
            height={height}
          >
            {layout.links().map((l, i) => (
              <path
                key={i}
                d={`M${l.source.y + 40},${l.source.x + 85}V${l.target.x + 85}H${l.target.y + 40}`}
                stroke="#9bb0a5"
                fill="none"
              />
            ))}
            {layout.leaves().map((n) => {
              const match = result.matches.find(
                (m) => m.isolate.isolate_id === n.data.name,
              );
              const isQuery = n.data.name === result.sample.sample_id;
              return (
                <text
                  key={n.data.name}
                  x={n.y + 50}
                  y={n.x + 89}
                  fill={
                    isQuery
                      ? green
                      : match
                        ? labelColor(match.isolate.clade ?? "")
                        : muted
                  }
                  fontWeight={isQuery ? "bold" : "normal"}
                >
                  {n.data.name}
                </text>
              );
            })}
          </Frame>
          <button
            className="text-button"
            onClick={(e) => {
              const svg = e.currentTarget.parentElement?.querySelector("svg");
              if (svg)
                void exportFigure(
                  snapshotSVG(svg),
                  "reference_phylogeny",
                  "svg",
                ).catch((err) => onError(String(err)));
            }}
          >
            Download reference tree SVG
          </button>
        </div>
      )}
    </div>
  );
}

interface GeoPoint {
  latitude: number;
  longitude: number;
  label: string;
  count: number;
  nearest: boolean;
  query: boolean;
}
function geographicPoints(result: Analysis, references: Isolate[]): GeoPoint[] {
  const points = new Map<string, GeoPoint>();
  const nearest = new Set(result.matches.map((m) => m.isolate.isolate_id));
  for (const r of references) {
    if (r.latitude === undefined || r.longitude === undefined) continue;
    const key = `${r.latitude},${r.longitude},${r.country ?? ""}`;
    const point = points.get(key) ?? {
      latitude: r.latitude,
      longitude: r.longitude,
      label: r.country ?? "Unknown country",
      count: 0,
      nearest: false,
      query: false,
    };
    point.count++;
    point.nearest ||= nearest.has(r.isolate_id);
    points.set(key, point);
  }
  const { latitude, longitude } = result.sample.metadata;
  if (
    latitude !== undefined &&
    longitude !== undefined &&
    latitude !== null &&
    longitude !== null &&
    String(latitude).trim() &&
    String(longitude).trim() &&
    Number.isFinite(Number(latitude)) &&
    Math.abs(Number(latitude)) <= 90 &&
    Number.isFinite(Number(longitude)) &&
    Math.abs(Number(longitude)) <= 180
  )
    points.set("query", {
      latitude: Number(latitude),
      longitude: Number(longitude),
      label: result.sample.sample_id,
      count: 1,
      nearest: false,
      query: true,
    });
  return [...points.values()];
}

function Geography({
  result,
  run,
  references,
  world,
}: {
  result: Analysis;
  run: Run;
  references: Isolate[];
  world: FeatureCollection | null;
}) {
  const [interactive, setInteractive] = useState(false);
  const mapEl = useRef<HTMLDivElement>(null);
  const points = useMemo(
    () => geographicPoints(result, references),
    [result, references],
  );
  const projection = geoNaturalEarth1().fitExtent(
    [
      [30, 85],
      [970, 430],
    ],
    { type: "Sphere" },
  );
  const path = geoPath(projection);
  useEffect(() => {
    if (!interactive || !mapEl.current || !world) return;
    const map = L.map(mapEl.current, {
      center: [20, 0],
      zoom: 1,
      minZoom: 1,
      maxZoom: 8,
      scrollWheelZoom: false,
    });
    L.geoJSON(world, {
      style: {
        fillColor: "#e4ece7",
        fillOpacity: 1,
        color: "#bacbc0",
        weight: 0.6,
      },
    }).addTo(map);
    points.forEach((p) => {
      const text = document.createElement("span");
      text.textContent = `${p.label}: ${p.count} ${p.query ? "query sample" : "reference isolate(s)"}`;
      L.circleMarker([p.latitude, p.longitude], {
        radius: p.query ? 8 : Math.min(14, 4 + Math.sqrt(p.count)),
        color: p.query ? "#bb7533" : p.nearest ? green : "#6c8e84",
        weight: 2,
        fillOpacity: 0.7,
      })
        .addTo(map)
        .bindTooltip(text);
    });
    map.attributionControl.addAttribution("Natural Earth (public domain)");
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(mapEl.current);
    return () => {
      observer.disconnect();
      map.remove();
    };
  }, [interactive, world, points]);
  const countries = [...new Set(references.map((r) => r.country ?? "Unknown"))]
    .map((country) => ({
      country,
      count: references.filter((r) => (r.country ?? "Unknown") === country)
        .length,
    }))
    .sort((a, b) => b.count - a.count);
  return (
    <>
      <div className="map-toggle">
        <button
          className={!interactive ? "active" : ""}
          onClick={() => setInteractive(false)}
        >
          Publication view
        </button>
        <button
          className={interactive ? "active" : ""}
          onClick={() => setInteractive(true)}
        >
          Interactive map
        </button>
      </div>
      <div className={interactive ? "export-only" : ""}>
        <Frame
          title="Geographic distribution"
          subtitle={`${run.scheme.name} · ${references.length} reference isolates · observed locations only · Natural Earth (public domain)`}
          height={490}
        >
          <path
            d={path({ type: "Sphere" }) ?? ""}
            fill="#f3f6f4"
            stroke="#d5dfd8"
          />
          {world?.features.map((feature, i) => (
            <path
              key={i}
              d={path(feature) ?? ""}
              fill="#dfe8e0"
              stroke="white"
              strokeWidth="0.6"
            />
          ))}
          {points.map((p, i) => {
            const [x, y] = projection([p.longitude, p.latitude])!;
            return (
              <g key={i}>
                <circle
                  cx={x}
                  cy={y}
                  r={p.query ? 7 : Math.min(12, 3 + Math.sqrt(p.count))}
                  fill={p.query ? "#bb7533" : p.nearest ? green : "#749c8c"}
                  fillOpacity="0.8"
                  stroke="white"
                  strokeWidth="1.5"
                />
                <title>
                  {p.label}: {p.count} {p.query ? "query sample" : "references"}
                </title>
              </g>
            );
          })}
          <circle cx="42" cy="450" r="5" fill={green} />
          <text x="55" y="454" fontSize="11">
            Location includes nearest neighbors
          </text>
          <circle cx="340" cy="450" r="5" fill="#749c8c" />
          <text x="353" y="454" fontSize="11">
            Other references
          </text>
          <text x="590" y="454" fontSize="11">
            {points.some((p) => p.query)
              ? "Orange: supplied query location"
              : "Query location: not supplied"}
          </text>
        </Frame>
      </div>
      {interactive && (
        <div
          ref={mapEl}
          className="leaflet-map"
          aria-label="Interactive geographic distribution"
        />
      )}
      <div className="country-list">
        {countries.map((c) => (
          <span key={c.country}>
            {c.country}
            <b>{c.count}</b>
          </span>
        ))}
      </div>
      <p className="muted">
        {
          references.filter(
            (r) => r.latitude === undefined || r.longitude === undefined,
          ).length
        }{" "}
        references lack coordinates.{" "}
        {run.scheme.synthetic ? "Demo markers use country centroids." : ""}
      </p>
    </>
  );
}

function Radar({ result, run }: { result: Analysis; run: Run }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current) return;
    const chart = echarts.init(el.current, undefined, { renderer: "svg" });
    const best = result.matches[0];
    const accent = run.scheme.visualization.accent;
    chart.setOption({
      animation: false,
      backgroundColor: "#fff",
      textStyle: { fontFamily: "Arial" },
      title: {
        text: "Profile summary",
        subtext: `${result.sample.sample_id} · ${run.scheme.name}`,
        left: 24,
        top: 16,
        textStyle: { fontSize: 18, color: ink },
        subtextStyle: { color: muted },
      },
      tooltip: { trigger: "item", renderMode: "richText" },
      radar: {
        center: ["50%", "58%"],
        radius: "59%",
        indicator: [
          { name: "Proximity", max: 100 },
          { name: "Locus match", max: 100 },
          { name: "Completeness", max: 100 },
          { name: "Lineage vote", max: 100 },
        ],
        axisName: { color: ink, fontSize: 12 },
        splitArea: { areaStyle: { color: ["#fff", "#f4f8f5"] } },
        splitLine: { lineStyle: { color: "#d8e4dc" } },
        axisLine: { lineStyle: { color: "#d8e4dc" } },
      },
      series: [
        {
          type: "radar",
          symbol: "circle",
          symbolSize: 7,
          lineStyle: { color: accent, width: 2 },
          itemStyle: { color: accent },
          areaStyle: { color: accent, opacity: 0.16 },
          data: [
            {
              name: result.sample.sample_id,
              value: [
                best ? 100 / (1 + best.normalizedDistance) : 0,
                best ? (100 * best.matchingLoci) / best.comparedLoci : 0,
                100 * result.completeness,
                result.lineage.label ? 100 * result.lineage.confidence : 0,
              ],
            },
          ],
        },
      ],
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(el.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [result, run]);
  return (
    <div
      data-chart="true"
      ref={el}
      className="radar-chart"
      role="img"
      aria-label="Radar plot of proximity, matching loci, completeness, and lineage vote support"
    />
  );
}

export default function Figures({
  run,
  index,
  references,
  world,
  onError,
}: {
  run: Run;
  index: number;
  references: Isolate[];
  world: FeatureCollection | null;
  onError: (s: string) => void;
}) {
  const result = run.results[index];
  const [batch, setBatch] = useState(false);
  return (
    <div className="figures-grid">
      <div className="full-width">
        <FigureCard
          number="01"
          title="Nearest isolate heatmap"
          caption="Each cell shows the absolute allele difference from the query. Missing calls are gray; hover or select a cell for values."
          onError={onError}
        >
          <Heatmap key={result.sample.sample_id} result={result} run={run} />
        </FigureCard>
      </div>
      <div className="full-width">
        <FigureCard
          number="02"
          title="Distance dendrogram"
          caption="Average-linkage clustering on shared, observed loci. The horizontal axis is normalized merge distance. Green tips are uploaded samples. This is a phenetic tree, not an inferred phylogeny."
          onError={onError}
          extra={
            <label className="check-label">
              <input
                type="checkbox"
                checked={batch}
                onChange={(e) => setBatch(e.target.checked)}
              />
              All samples
            </label>
          }
        >
          <Dendrogram
            result={result}
            run={run}
            batch={batch}
            onError={onError}
          />
        </FigureCard>
      </div>
      <div className="full-width">
        <FigureCard
          number="03"
          title="Lineage placement panel"
          caption="Nearest references annotated with existing lineage and clade labels. A supplied Newick tree can be inspected below; MLVA distances alone do not place a query in a phylogeny."
          onError={onError}
        >
          <Placement result={result} run={run} />
          <NewickViewer result={result} onError={onError} />
        </FigureCard>
      </div>
      <div className="full-width">
        <FigureCard
          number="04"
          title="Geographic distribution"
          caption="All references in the selected organism and scheme. Locations are supplied metadata; nearest-neighbor location does not predict query origin. Exports use the publication view."
          onError={onError}
        >
          <Geography
            result={result}
            run={run}
            references={references}
            world={world}
          />
        </FigureCard>
      </div>
      <FigureCard
        number="05"
        title="Radar summary"
        caption="All axes span 0–100. Proximity = 100 / (1 + normalized distance). Match uses compared loci; completeness uses scheme loci. Lineage vote is uncalibrated and zero when unassigned."
        onError={onError}
      >
        <Radar result={result} run={run} />
      </FigureCard>
      <aside className="reading-card">
        <span className="eyebrow">READING YOUR FIGURES</span>
        <h3>Context before conclusions.</h3>
        <p>
          Similar profiles support a comparison. They do not establish
          transmission, ancestry, or geographic origin.
        </p>
        <p>
          Keep the scheme, distance metric, reference source, and missing-locus
          policy with every exported figure.
        </p>
        <div className="reading-rule" />
        <p>
          <strong>Ready for your manuscript</strong>
          <br />
          SVG and PDF keep vector detail. PNG exports are rendered at 3×
          resolution.
        </p>
      </aside>
    </div>
  );
}
