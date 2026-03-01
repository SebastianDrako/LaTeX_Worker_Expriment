/**
 * R2 key helpers.
 *
 * Key layout (matches CLAUDE.md):
 *   projects/{projectId}/tex/{filename}.tex
 *   projects/{projectId}/bib/{filename}.bib
 *   projects/{projectId}/assets/{filename}
 *   projects/{projectId}/output.pdf
 */

export type FileType = "tex" | "bib" | "image" | "pdf";

export function fileTypeFromName(name: string): FileType {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "tex") return "tex";
  if (ext === "bib") return "bib";
  if (ext === "pdf") return "pdf";
  return "image";
}

export function r2KeyForSourceFile(projectId: string, name: string, type: FileType): string {
  switch (type) {
    case "tex":   return `projects/${projectId}/tex/${name}`;
    case "bib":   return `projects/${projectId}/bib/${name}`;
    case "pdf":   return `projects/${projectId}/assets/${name}`; // source PDF (e.g. included figure)
    case "image": return `projects/${projectId}/assets/${name}`;
  }
}

export const outputPdfKey = (projectId: string) => `projects/${projectId}/output.pdf`;

export function contentTypeFor(type: FileType): string {
  if (type === "pdf") return "application/pdf";
  if (type === "tex" || type === "bib") return "text/plain; charset=utf-8";
  return "application/octet-stream";
}
