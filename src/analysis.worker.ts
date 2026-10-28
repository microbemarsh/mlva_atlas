import { analyze } from "./analysis";
import type { Isolate, Metric, Sample, Scheme } from "./types";
self.onmessage = (
  event: MessageEvent<{
    samples: Sample[];
    references: Isolate[];
    scheme: Scheme;
    metric: Metric;
    minOverlap: number;
  }>,
) => {
  try {
    const { samples, references, scheme, metric, minOverlap } = event.data;
    self.postMessage({
      results: analyze(samples, references, scheme, metric, minOverlap),
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
