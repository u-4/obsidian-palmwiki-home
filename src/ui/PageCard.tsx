import React from "react";
import type { PageActionHandler, PageRecord } from "./PalmWikiHomeView";
import { formatDate } from "./components/format";

interface PageCardProps {
  imageUrl?: string;
  onOpenPage: PageActionHandler;
  onTogglePinned: PageActionHandler;
  page: PageRecord;
  showFolder: boolean;
  showTags: boolean;
}

export const PageCard = React.memo(function PageCard({
  imageUrl,
  onOpenPage,
  onTogglePinned,
  page,
  showFolder,
  showTags
}: PageCardProps): React.JSX.Element {
  const openPage = (): void => onOpenPage(page.path);
  const activateOpenArea = (event: React.KeyboardEvent): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      openPage();
    }
  };

  return (
    <article
      className={`palmwiki-card ${page.pinned ? "is-pinned" : ""}`}
      onClick={openPage}
    >
      <div className="palmwiki-card-header">
        <div
          className="palmwiki-card-title-action"
          onClick={(event) => {
            event.stopPropagation();
            openPage();
          }}
          onKeyDown={activateOpenArea}
          role="button"
          tabIndex={0}
        >
          <h2>{page.title}</h2>
        </div>
        <button
          aria-pressed={page.pinned}
          className="palmwiki-pin-button"
          onClick={(event) => {
            event.stopPropagation();
            onTogglePinned(page.path);
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
          }}
          title={page.pinned ? "Unpin" : "Pin"}
          type="button"
        >
          {page.pinned ? "Pinned" : "Pin"}
        </button>
      </div>

      <div
        className="palmwiki-card-body-action"
        onClick={(event) => {
          event.stopPropagation();
          openPage();
        }}
        onKeyDown={activateOpenArea}
        role="button"
        tabIndex={0}
      >
        {imageUrl ? (
          <img alt="" className="palmwiki-card-image" loading="lazy" src={imageUrl} />
        ) : null}

        {page.description ? (
          <p className="palmwiki-card-description">{page.description}</p>
        ) : (
          <p className="palmwiki-card-description is-empty">{page.path}</p>
        )}

        <div className="palmwiki-graph-badges" aria-label="Graph metadata">
          <span>PR {page.pageRank.toFixed(2)}</span>
          <span>In {page.inlinkCount}</span>
          <span>Out {page.outlinkCount}</span>
        </div>

        {showTags && page.tags.length > 0 ? (
          <div className="palmwiki-tags">
            {page.tags.map((tag) => (
              <span className="palmwiki-tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        <div className="palmwiki-card-footer">
          {showFolder && page.folder ? <span>{page.folder}</span> : <span>{page.path}</span>}
          <span>{formatDate(page.modifiedTime)}</span>
        </div>
      </div>
    </article>
  );
});
