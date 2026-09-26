import type { PageObservation, SemanticAnchor } from "@adaptive/shared";

export interface AdaptiveSdkOptions {
  apiBaseUrl: string;
  siteId: string;
}

function extractAnchors(documentRef: Document): SemanticAnchor[] {
  const nodes = Array.from(
    documentRef.querySelectorAll("main a, main button, main input, main [role]")
  ).slice(0, 100);

  return nodes.map((node, index) => ({
    id: `anchor-${index + 1}`,
    role: node.getAttribute("role") ?? undefined,
    label: node.getAttribute("aria-label") ?? node.textContent?.trim().slice(0, 120) ?? undefined,
    tagName: node.tagName.toLowerCase(),
    selectorHint: node.id ? `#${CSS.escape(node.id)}` : undefined,
    confidence: 0.5
  }));
}

export function scanPage(documentRef: Document = document): PageObservation {
  return {
    url: documentRef.location.href,
    title: documentRef.title,
    pageType: "unknown",
    headings: Array.from(documentRef.querySelectorAll("h1,h2,h3")).slice(0, 20)
      .map(n => n.textContent?.trim() ?? "").filter(Boolean),
    links: Array.from(documentRef.querySelectorAll("a")).slice(0, 50)
      .map(n => n.getAttribute("href") ?? "").filter(Boolean),
    semanticAnchors: extractAnchors(documentRef)
  };
}

export function createSdk(options: AdaptiveSdkOptions) {
  return {options, scan: () => scanPage(), version: "0.1.0"};
}
