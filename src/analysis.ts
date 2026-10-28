import type {
  Analysis,
  Comparison,
  Isolate,
  Match,
  Metric,
  Profile,
  Sample,
  Scheme,
  Vote,
} from "./types";

export const metricNames: Record<Metric, string> = {
  hamming: "Hamming distance",
  absolute: "Absolute allele distance",
  weighted: "Weighted allele distance",
};

export function compareProfiles(
  a: Profile,
  b: Profile,
  scheme: Scheme,
  metric: Metric,
): Comparison {
  let distance = 0,
    comparedLoci = 0,
    matchingLoci = 0,
    denominator = 0;
  for (const l of scheme.loci) {
    if (a[l] == null || b[l] == null) continue;
    const weight = metric === "weighted" ? (scheme.weights?.[l] ?? 1) : 1;
    const delta = Math.abs(a[l]! - b[l]!);
    comparedLoci++;
    denominator += weight;
    if (delta === 0) matchingLoci++;
    distance += metric === "hamming" ? Number(delta !== 0) : delta * weight;
  }
  return {
    distance,
    normalizedDistance: denominator ? distance / denominator : Infinity,
    matchingLoci,
    comparedLoci,
    missingLoci: scheme.loci.length - comparedLoci,
    exact: comparedLoci === scheme.loci.length && distance === 0,
  };
}

export function vote(matches: Match[], field: "lineage" | "clade"): Vote {
  const counts = new Map<string, { count: number; weight: number }>();
  let totalWeight = 0,
    labeledIsolates = 0;
  for (const m of matches) {
    const label = m.isolate[field];
    if (!label) continue;
    const weight =
      m.comparedLoci /
      (m.comparedLoci + m.missingLoci) /
      (1 + m.normalizedDistance);
    const entry = counts.get(label) ?? { count: 0, weight: 0 };
    entry.count++;
    entry.weight += weight;
    totalWeight += weight;
    labeledIsolates++;
    counts.set(label, entry);
  }
  const distribution = [...counts]
    .map(([label, v]) => ({
      label,
      count: v.count,
      support: v.weight / totalWeight,
    }))
    .sort((a, b) => b.support - a.support || a.label.localeCompare(b.label));
  const winner = distribution[0];
  const tied =
    distribution[1] &&
    Math.abs(winner.support - distribution[1].support) < 1e-12;
  return {
    label: winner && !tied ? winner.label : null,
    confidence: winner?.support ?? 0,
    supportingIsolates: winner && !tied ? winner.count : 0,
    labeledIsolates,
    totalIsolates: matches.length,
    distribution,
  };
}

export function analyze(
  samples: Sample[],
  references: Isolate[],
  scheme: Scheme,
  metric: Metric,
  minOverlap = 0.8,
): Analysis[] {
  if (!(minOverlap > 0 && minOverlap <= 1))
    throw new Error("Minimum overlap must be greater than 0 and at most 1.");
  const compatible = references.filter(
    (r) => r.scheme === scheme.id && r.organism === scheme.organism,
  );
  if (!compatible.length)
    throw new Error(
      "No references match this organism and scheme. Import a compatible database.",
    );
  // ponytail: bounded linear scans suit the static MVP; index profiles for larger databases.
  if (samples.length * compatible.length * scheme.loci.length > 50000000)
    throw new Error(
      "This batch exceeds the browser workload limit. Split it into smaller files.",
    );
  return samples.map((sample) => {
    const ranked = compatible
      .map((isolate) => ({
        isolate,
        ...compareProfiles(sample.profile, isolate.profile, scheme, metric),
      }))
      .filter(
        (m) => m.comparedLoci >= Math.ceil(scheme.loci.length * minOverlap),
      )
      .sort(
        (a, b) =>
          a.normalizedDistance - b.normalizedDistance ||
          b.comparedLoci - a.comparedLoci ||
          a.isolate.isolate_id.localeCompare(b.isolate.isolate_id),
      );
    const cutoff = ranked[Math.min(9, ranked.length - 1)]?.normalizedDistance;
    const exact = ranked.filter((m) => m.exact);
    const supporting = exact.length
      ? exact
      : ranked.filter((m) => m.normalizedDistance <= cutoff + 1e-12);
    return {
      sample,
      matches: ranked.slice(0, 10),
      eligibleReferences: ranked.length,
      excludedReferences: compatible.length - ranked.length,
      completeness:
        Object.values(sample.profile).filter((v) => v !== null).length /
        scheme.loci.length,
      lineage: vote(supporting, "lineage"),
      clade: vote(supporting, "clade"),
    };
  });
}

export interface ClusterNode {
  name: string;
  height: number;
  size: number;
  children?: ClusterNode[];
}
export function clusterProfiles(
  items: { name: string; profile: Profile }[],
  scheme: Scheme,
  metric: Metric,
): { tree: ClusterNode; common: number } {
  if (!items.length || items.length > 50)
    throw new Error("Clustering supports 1–50 profiles.");
  if (new Set(items.map((i) => i.name)).size !== items.length)
    throw new Error("Clustering requires unique labels.");
  const loci = scheme.loci.filter((l) =>
    items.every((i) => i.profile[l] != null),
  );
  if (loci.length < Math.ceil(scheme.loci.length * 0.8))
    throw new Error(
      "Clustering requires at least 80% of scheme loci called in every included profile.",
    );
  const commonScheme = { ...scheme, loci };
  let clusters = items.map(
    (i) => ({ name: i.name, height: 0, size: 1 }) as ClusterNode,
  );
  let distances = items.map((a) =>
    items.map(
      (b) =>
        compareProfiles(a.profile, b.profile, commonScheme, metric)
          .normalizedDistance,
    ),
  );
  // ponytail: O(n³) average linkage is bounded to 50 profiles; use a nearest-neighbor chain for larger trees.
  while (clusters.length > 1) {
    let first = 0,
      second = 1;
    for (let a = 0; a < clusters.length; a++)
      for (let b = a + 1; b < clusters.length; b++)
        if (distances[a][b] < distances[first][second]) {
          first = a;
          second = b;
        }
    const a = clusters[first],
      b = clusters[second];
    const merged: ClusterNode = {
      name: "",
      size: a.size + b.size,
      height: distances[first][second] / 2,
      children: [a, b],
    };
    const keep = clusters
      .map((_, i) => i)
      .filter((i) => i !== first && i !== second);
    const nextDistances = keep.map((i) => keep.map((j) => distances[i][j]));
    const toMerged = keep.map(
      (i) =>
        (distances[i][first] * a.size + distances[i][second] * b.size) /
        (a.size + b.size),
    );
    nextDistances.forEach((row, i) => row.push(toMerged[i]));
    nextDistances.push([...toMerged, 0]);
    clusters = [...keep.map((i) => clusters[i]), merged];
    distances = nextDistances;
  }
  return { tree: clusters[0], common: loci.length };
}

export function toNewick(node: ClusterNode, parentHeight?: number): string {
  const label = node.children
    ? `(${node.children.map((n) => toNewick(n, node.height)).join(",")})`
    : `'${node.name.replace(/'/g, "''")}'`;
  return `${label}${parentHeight === undefined ? ";" : ":" + Math.max(0, parentHeight - node.height).toFixed(8)}`;
}
