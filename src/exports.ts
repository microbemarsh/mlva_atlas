import Papa from "papaparse";
import type { Run } from "./types";
import { metricNames } from "./analysis";

export const safeFilename = (name: string) =>
  name.replace(/[^a-z0-9_.-]/gi, "_").slice(0, 100) || "mlva-atlas";
export function download(data: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = safeFilename(filename);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const escapeHTML = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export function resultsCSV(run: Run) {
  const rows = run.results.flatMap((r) =>
    (r.matches.length ? r.matches : [undefined]).map((m, i) => ({
      sample_id: r.sample.sample_id,
      scheme: run.scheme.id,
      scheme_version: run.scheme.version,
      organism: run.scheme.organism,
      metric: run.metric,
      min_overlap: run.minOverlap,
      reference_database: run.referenceName,
      analyzed_at: run.createdAt,
      rank: m ? i + 1 : "",
      isolate_id: m?.isolate.isolate_id ?? "",
      distance: m?.distance ?? "",
      normalized_distance: m?.normalizedDistance ?? "",
      matching_loci: m?.matchingLoci ?? "",
      compared_loci: m?.comparedLoci ?? "",
      missing_loci: m?.missingLoci ?? "",
      exact: m?.exact ?? false,
      predicted_lineage: r.lineage.label ?? "",
      lineage_support: r.lineage.label ? r.lineage.confidence : "",
      supporting_isolates: r.lineage.supportingIsolates,
      predicted_clade: r.clade.label ?? "",
      reference_lineage: m?.isolate.lineage ?? "",
      country: m?.isolate.country ?? "",
      host: m?.isolate.host ?? "",
      year: m?.isolate.year ?? "",
      accession: m?.isolate.accession ?? "",
    })),
  );
  return Papa.unparse(rows, { escapeFormulae: true });
}

export function snapshotSVG(element: SVGSVGElement): string {
  const clone = element.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const view = element.viewBox.baseVal;
  clone.setAttribute(
    "width",
    String(view.width || element.clientWidth || 1000),
  );
  clone.setAttribute(
    "height",
    String(view.height || element.clientHeight || 420),
  );
  clone.style.background = "white";
  clone.querySelectorAll("script,foreignObject").forEach((n) => n.remove());
  return new XMLSerializer().serializeToString(clone);
}

export function collectFigures(): { title: string; svg: string }[] {
  return [...document.querySelectorAll<HTMLElement>("[data-figure]")].flatMap(
    (el) => {
      const svg =
        el.querySelector<SVGSVGElement>("svg[data-export]") ??
        el.querySelector<SVGSVGElement>("[data-chart] svg");
      return svg ? [{ title: el.dataset.figure!, svg: snapshotSVG(svg) }] : [];
    },
  );
}

export async function exportFigure(
  svg: string,
  filename: string,
  format: "svg" | "png" | "pdf",
) {
  if (format === "svg")
    return download(svg, filename + ".svg", "image/svg+xml");
  const element = new DOMParser().parseFromString(svg, "image/svg+xml")
    .documentElement as unknown as SVGSVGElement;
  const width = Number(element.getAttribute("width")) || 1000,
    height = Number(element.getAttribute("height")) || 420;
  if (format === "pdf") {
    const { jsPDF } = await import("jspdf");
    await import("svg2pdf.js");
    const pdf = new jsPDF({
      orientation: width > height ? "landscape" : "portrait",
      unit: "pt",
      format: [width, height],
    });
    await pdf.svg(element, { x: 0, y: 0, width, height });
    pdf.save(safeFilename(filename + ".pdf"));
    return;
  }
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width * 3;
    canvas.height = height * 3;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable in this browser.");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("PNG export failed."))),
        "image/png",
      ),
    );
    download(blob, filename + ".png", "image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

const caveat =
  "Lineage/clade support is an inverse-distance neighbor vote, not a calibrated probability. MLVA similarity does not establish ancestry or geographic origin. Missing calls are excluded. Rankings use distance per compared locus (per compared weight for weighted distance).";
export function reportHTML(
  run: Run,
  figures: { title: string; svg: string }[],
  selected?: number,
) {
  const results =
    selected === undefined ? run.results : [run.results[selected]];
  const h = escapeHTML;
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MLVA Atlas report</title><style>
body{font:14px system-ui,sans-serif;color:#213c38;max-width:1100px;margin:40px auto;padding:0 24px}h1{font-size:36px}h2{border-top:1px solid #ddd;padding-top:24px}table{border-collapse:collapse;width:100%;font-size:12px;margin:20px 0}td,th{border-bottom:1px solid #ddd;text-align:left;padding:8px}svg{max-width:100%;height:auto}figure{margin:24px 0;break-inside:avoid}p{line-height:1.6}pre{white-space:pre-wrap;overflow-wrap:anywhere}header{border-bottom:3px solid #197968}.note{background:#f0f5f2;padding:16px}@media print{body{margin:0}h2{break-before:auto}tr{break-inside:avoid}}</style></head><body>
<header><p>MLVA ATLAS / ANALYSIS REPORT</p><h1>${run.scheme.synthetic ? "Synthetic demonstration" : "Profile interpretation"}</h1><p>${h(run.createdAt)}</p></header>
<h2>Input summary</h2><p>${h(results.length)} sample(s) · ${h(run.scheme.name)} (${h(run.scheme.version)}) · ${h(run.scheme.organism)}<br>${h(metricNames[run.metric])} · Minimum overlap ${run.minOverlap * 100}% · ${h(run.referenceName)} (${run.referenceCount} references)</p>
<p class="note">${h(caveat)} ${run.scheme.synthetic ? "All bundled profiles and labels are fictional." : ""}</p>${run.warnings.map((w) => `<p>${h(w)}</p>`).join("")}
${results
  .map(
    (
      r,
    ) => `<section><h2>${h(r.sample.sample_id)}</h2><p>Completeness: ${(r.completeness * 100).toFixed(1)}% · Predicted lineage: ${h(r.lineage.label ?? "Unassigned")} · Vote support: ${r.lineage.label ? (r.lineage.confidence * 100).toFixed(1) + "%" : "—"} · Supporting isolates: ${r.lineage.supportingIsolates}<br>Clade: ${h(r.clade.label ?? "Unassigned")} · Eligible references: ${r.eligibleReferences} · Excluded references: ${r.excludedReferences}</p>
<h3>Matching isolates</h3><table><thead><tr>${["Isolate", "Raw distance", "Per locus / weight", "Match / compared", "Missing", "Lineage", "Country", "Host", "Year"].map((t) => `<th>${t}</th>`).join("")}</tr></thead><tbody>${r.matches.map((m) => `<tr>${[m.isolate.isolate_id, m.distance, m.normalizedDistance.toFixed(4), `${m.matchingLoci}/${m.comparedLoci}`, m.missingLoci, m.isolate.lineage, m.isolate.country, m.isolate.host, m.isolate.year].map((v) => `<td>${h(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>
${!r.matches.length ? "<p>No references meet the overlap requirement.</p>" : ""}<h3>Lineage distribution</h3><p>${r.lineage.distribution.map((d) => `${h(d.label)}: ${(d.support * 100).toFixed(1)}% (${d.count} isolates)`).join(" · ") || "No labeled neighbors."}</p>
<h3>Input profile and metadata</h3><pre>${h(JSON.stringify({ profile: r.sample.profile, metadata: r.sample.metadata }, null, 2))}</pre></section>`,
  )
  .join("")}
${figures.length ? `<h2>Visualizations for ${h(selected === undefined ? "the active sample in the workspace" : results[0].sample.sample_id)}</h2>${figures.map((f) => `<figure><figcaption>${h(f.title)}</figcaption>${f.svg}</figure>`).join("")}` : ""}
<h2>Methods</h2><p>${h(caveat)} Up to ten neighbors are displayed. Voting includes all ties at the tenth distance, or all complete exact matches when present. Unlabeled neighbors do not vote; tied winning labels remain unassigned. Dendrograms use average linkage on loci called in every included profile, requiring at least 80% of the scheme.</p><p>Reference locations are observed metadata. Query location is shown only when supplied. Map: Natural Earth, public domain.</p></body></html>`;
}

export async function reportPDF(
  run: Run,
  figures: { title: string; svg: string }[],
  selected?: number,
) {
  const { jsPDF } = await import("jspdf");
  await import("svg2pdf.js");
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  let y = 44;
  const line = (text: string, size = 10) => {
    pdf.setFontSize(size);
    const lines: string[] = pdf.splitTextToSize(text, 505);
    for (const l of lines) {
      if (y > 785) {
        pdf.addPage();
        y = 44;
      }
      pdf.text(l, 44, y);
      y += size * 1.5;
    }
    y += 5;
  };
  line("MLVA ATLAS / ANALYSIS REPORT", 19);
  line(`${run.scheme.name} | ${run.scheme.organism}`);
  line(run.createdAt);
  line(
    `${metricNames[run.metric]} | Minimum overlap ${run.minOverlap * 100}% | ${run.referenceName} (${run.referenceCount} references)`,
  );
  if (run.scheme.synthetic)
    line("SYNTHETIC DEMONSTRATION: fictional profiles and lineage labels.");
  line(caveat);
  run.warnings.forEach((w) => line(w));
  for (const r of selected === undefined
    ? run.results
    : [run.results[selected]]) {
    line(r.sample.sample_id, 15);
    line(
      `Completeness ${(r.completeness * 100).toFixed(1)}% | Lineage ${r.lineage.label ?? "Unassigned"} | Vote support ${r.lineage.label ? (r.lineage.confidence * 100).toFixed(1) + "%" : "unassigned"} | Supporting isolates ${r.lineage.supportingIsolates} | Clade ${r.clade.label ?? "Unassigned"}`,
    );
    line(
      `Eligible references ${r.eligibleReferences}; excluded references ${r.excludedReferences}.`,
    );
    for (const m of r.matches)
      line(
        `${m.isolate.isolate_id}: distance ${m.distance}; normalized ${m.normalizedDistance.toFixed(4)}; matches ${m.matchingLoci}/${m.comparedLoci}; missing ${m.missingLoci}; ${m.isolate.lineage ?? "Unlabeled"}; ${m.isolate.country ?? "Unknown country"}; ${m.isolate.host ?? ""}; ${m.isolate.year ?? ""}; ${m.isolate.accession ?? ""}`,
      );
    if (!r.matches.length) line("No eligible references.");
    line(
      "Lineage distribution: " +
        (r.lineage.distribution
          .map(
            (d) => `${d.label} ${(d.support * 100).toFixed(1)}% (n=${d.count})`,
          )
          .join("; ") || "No labeled neighbors"),
    );
    line("Input profile: " + JSON.stringify(r.sample.profile));
    line("Metadata: " + JSON.stringify(r.sample.metadata));
  }
  for (const figure of figures) {
    pdf.addPage();
    y = 44;
    line(figure.title, 15);
    const svg = new DOMParser().parseFromString(figure.svg, "image/svg+xml")
      .documentElement as unknown as SVGSVGElement;
    const width = Number(svg.getAttribute("width")) || 1000,
      height = Number(svg.getAttribute("height")) || 420;
    const scale = Math.min(505 / width, 680 / height);
    await pdf.svg(svg, {
      x: 44,
      y: 80,
      width: width * scale,
      height: height * scale,
    });
  }
  pdf.save(
    safeFilename(
      `MLVA_Atlas_${selected === undefined ? "batch" : run.results[selected].sample.sample_id}.pdf`,
    ),
  );
}
