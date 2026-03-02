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

  const imageExtensions = ["png", "jpg", "jpeg", "gif", "svg", "bmp", "tiff", "webp"];
  if (imageExtensions.includes(ext)) {
    return "image";
  }

  // For other files (.cls, .sty, etc.), we must use an existing type due to the
  // CHECK constraint in the database. We'll classify them as "image" which serves
  // as a generic "binary asset" type for storage purposes.
  return "image";
}

export function r2KeyForSourceFile(projectId: string, name: string, type: FileType): string {
  switch (type) {
    case "tex":
      return `projects/${projectId}/tex/${name}`;
    case "bib":
      return `projects/${projectId}/bib/${name}`;
    // "image" and "pdf" files are both treated as assets and stored in the same folder.
    case "pdf":
    case "image":
      return `projects/${projectId}/assets/${name}`;
  }
}

export const outputPdfKey = (projectId: string) => `projects/${projectId}/output.pdf`;

export const yjsSnapshotKey = (projectId: string, fileName: string) =>
  `projects/${projectId}/yjs/${encodeURIComponent(fileName)}.bin`;

export function contentTypeFor(name: string, type: FileType): string {
  if (type === "pdf") return "application/pdf";
  if (type === "tex" || type === "bib") return "text/plain; charset=utf-8";

  if (type === "image") {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    switch (ext) {
      case "png":  return "image/png";
      case "jpg":
      case "jpeg": return "image/jpeg";
      case "gif":  return "image/gif";
      case "svg":  return "image/svg+xml";
      case "webp": return "image/webp";
    }
  }

  return "application/octet-stream";
}
