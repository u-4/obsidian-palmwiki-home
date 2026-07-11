export interface PageRecord {
  path: string;
  basename: string;
  title: string;
  aliases: string[];
  folder: string;
  tags: string[];
  createdTime: number;
  modifiedTime: number;
  lineCount: number;
  charCount: number;
  description: string;
  firstImagePath?: string;
  outlinks: string[];
  inlinks: string[];
  outlinkCount: number;
  inlinkCount: number;
  pageRank: number;
  pageRankComponents?: {
    backlinks: number;
    backlinkAuthority: number;
    outlinks: number;
    editFrequency: number;
  };
  pinned: boolean;
  filterText: string;
  sortTitle: string;
  sortPath: string;
  indexOrder: number;
}
