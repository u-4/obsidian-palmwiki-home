import type { App, CachedMetadata, TFile } from "obsidian";
import type { PageGraphMetadata } from "./buildPageIndex";
import type { PageRecord } from "./PageRecord";
import { normalizeSearchText } from "../search/normalizeText";

const DESCRIPTION_MAX_LENGTH = 180;
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);

export interface BodyDerivedMetadata {
  lineCount: number;
  charCount: number;
  description: string;
}

export function extractPageMetadata(
  app: App,
  file: TFile,
  cache: CachedMetadata | null,
  bodyMetadata: BodyDerivedMetadata,
  graphMetadata: PageGraphMetadata,
  pinned: boolean,
  indexOrder: number
): PageRecord {
  const frontmatter = getFrontmatter(cache);
  const frontmatterTitle = normalizeString(frontmatter?.title);
  const aliases = uniqueStrings([
    ...extractStringList(frontmatter?.aliases),
    ...extractStringList(frontmatter?.alias)
  ]);
  const title = frontmatterTitle ?? file.basename;
  const folder = getFolderPath(file.path);
  const tags = extractTags(cache);

  return {
    path: file.path,
    basename: file.basename,
    title,
    aliases,
    folder,
    tags,
    createdTime: file.stat.ctime,
    modifiedTime: file.stat.mtime,
    lineCount: bodyMetadata.lineCount,
    charCount: bodyMetadata.charCount,
    description: bodyMetadata.description,
    firstImagePath: extractFirstImagePath(app, file, cache),
    outlinks: graphMetadata.outlinks,
    inlinks: graphMetadata.inlinks,
    outlinkCount: graphMetadata.outlinkCount,
    inlinkCount: graphMetadata.inlinkCount,
    pageRank: graphMetadata.pageRank,
    pageRankComponents: graphMetadata.pageRankComponents,
    pinned,
    filterText: buildFilterText(title, file.basename, file.path, folder, aliases, tags),
    sortTitle: normalizeSearchText(title),
    sortPath: normalizeSearchText(file.path),
    indexOrder
  };
}

export function extractBodyMetadata(body: string): BodyDerivedMetadata {
  return {
    lineCount: countLines(body),
    charCount: body.length,
    description: extractDescription(body)
  };
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function extractStringList(value: unknown): string[] {
  if (typeof value === "string") {
    return [value].map((item) => item.trim()).filter(Boolean);
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractTags(cache: CachedMetadata | null): string[] {
  const tags = new Set<string>();

  for (const tag of cache?.tags ?? []) {
    const normalized = normalizeTag(tag.tag);
    if (normalized) {
      tags.add(normalized);
    }
  }

  const frontmatter = getFrontmatter(cache);
  const frontmatterTags = frontmatter?.tags ?? frontmatter?.tag;
  for (const tag of extractFrontmatterTags(frontmatterTags)) {
    const normalized = normalizeTag(tag);
    if (normalized) {
      tags.add(normalized);
    }
  }

  return [...tags].sort((a, b) => a.localeCompare(b));
}

function extractFrontmatterTags(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  return extractStringList(value);
}

function normalizeTag(tag: string): string | undefined {
  const trimmed = tag.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function getFrontmatter(cache: CachedMetadata | null): Record<string, unknown> | undefined {
  const frontmatter: unknown = cache?.frontmatter;
  return isRecord(frontmatter) ? frontmatter : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    unique.push(value);
  }

  return unique;
}

function getFolderPath(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash === -1 ? "" : path.slice(0, lastSlash);
}

function countLines(body: string): number {
  if (body.length === 0) {
    return 0;
  }

  return body.split(/\r\n|\r|\n/).length;
}

function extractDescription(body: string): string {
  const text = stripFrontmatter(body);
  const lines = text
    .split(/\r\n|\r|\n/)
    .map(cleanDescriptionLine)
    .filter(Boolean);

  return truncateDescription(lines.join(" "));
}

function stripFrontmatter(body: string): string {
  return body.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(\r?\n|$)/, "");
}

function cleanDescriptionLine(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/!\[\[([^\]]+)\]\]/g, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateDescription(description: string): string {
  if (description.length <= DESCRIPTION_MAX_LENGTH) {
    return description;
  }

  return `${description.slice(0, DESCRIPTION_MAX_LENGTH - 1).trimEnd()}...`;
}

function extractFirstImagePath(
  app: App,
  file: TFile,
  cache: CachedMetadata | null
): string | undefined {
  for (const embed of cache?.embeds ?? []) {
    const link = cleanEmbedLink(embed.link);
    if (!isImagePath(link)) {
      continue;
    }

    const destination = app.metadataCache.getFirstLinkpathDest(link, file.path);
    if (destination && isImagePath(destination.path)) {
      return destination.path;
    }
  }

  return undefined;
}

function cleanEmbedLink(link: string): string {
  return link.split("|")[0].split("#")[0].trim();
}

function isImagePath(path: string): boolean {
  const extension = path.split(".").pop()?.toLocaleLowerCase();
  return extension !== undefined && IMAGE_EXTENSIONS.has(extension);
}

function buildFilterText(
  title: string,
  basename: string,
  path: string,
  folder: string,
  aliases: string[],
  tags: string[]
): string {
  return normalizeSearchText([
    title,
    basename,
    path,
    folder,
    ...aliases,
    ...tags
  ].join(" "));
}
