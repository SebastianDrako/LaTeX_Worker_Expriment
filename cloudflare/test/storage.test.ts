import { describe, it, expect } from "vitest";
import {
  contentTypeFor,
  fileTypeFromName,
  outputPdfKey,
  r2KeyForSourceFile,
  type FileType,
} from "../src/storage";

describe("fileTypeFromName", () => {
  it.each([
    ["main.tex", "tex"],
    ["refs.bib", "bib"],
    ["figure.pdf", "pdf"],
    ["logo.png", "image"],
    ["photo.jpg", "image"],
    ["scan.jpeg", "image"],
    ["data.csv", "image"],   // unknown extension → image
    ["noextension", "image"],
  ] as [string, FileType][])("%s → %s", (name, expected) => {
    expect(fileTypeFromName(name)).toBe(expected);
  });
});

describe("r2KeyForSourceFile", () => {
  const pid = "proj-abc";

  it.each([
    ["main.tex",   "tex",   `projects/${pid}/tex/main.tex`],
    ["refs.bib",   "bib",   `projects/${pid}/bib/refs.bib`],
    ["logo.png",   "image", `projects/${pid}/assets/logo.png`],
    ["fig.pdf",    "pdf",   `projects/${pid}/assets/fig.pdf`],
  ] as [string, FileType, string][])("%s (%s) → %s", (name, type, expected) => {
    expect(r2KeyForSourceFile(pid, name, type)).toBe(expected);
  });
});

describe("outputPdfKey", () => {
  it("builds the correct R2 key", () => {
    expect(outputPdfKey("proj-xyz")).toBe("projects/proj-xyz/output.pdf");
  });
});

describe("contentTypeFor", () => {
  it.each([
    ["pdf",   "application/pdf"],
    ["tex",   "text/plain; charset=utf-8"],
    ["bib",   "text/plain; charset=utf-8"],
    ["image", "application/octet-stream"],
  ] as [FileType, string][])("%s → %s", (type, expected) => {
    expect(contentTypeFor(type)).toBe(expected);
  });
});
