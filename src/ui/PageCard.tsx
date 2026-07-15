import React from "react";
import type { PalmWikiCardShape } from "../settings/Settings";
import type {
  PageActionHandler,
  PagePreviewHandler,
  PageRecord
} from "./PalmWikiHomeView";
import { getCardPresentation } from "./cardPresentation";
import { formatDate } from "./components/format";

interface PageCardProps {
  cardShape: PalmWikiCardShape;
  imageUrl?: string;
  onOpenPage: PageActionHandler;
  onPreviewPage?: PagePreviewHandler;
  onTogglePinned: PageActionHandler;
  page: PageRecord;
  showFolder: boolean;
  showTags: boolean;
}

export const PageCard = React.memo(function PageCard({
  cardShape,
  imageUrl,
  onOpenPage,
  onPreviewPage,
  onTogglePinned,
  page,
  showFolder,
  showTags
}: PageCardProps): React.JSX.Element {
  const openPage = (): void => onOpenPage(page.path);
  const presentation = getCardPresentation(cardShape);
  const previewPage = (event: React.MouseEvent<HTMLElement>): void => {
    onPreviewPage?.(page.path, event.currentTarget, event.nativeEvent);
  };
  const activateOpenArea = (event: React.KeyboardEvent): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      openPage();
    }
  };

  return (
    <article
      className={`palmwiki-card palmwiki-card-${cardShape} ${page.pinned ? "is-pinned" : ""}`}
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
          onMouseEnter={previewPage}
          role="button"
          tabIndex={0}
        >
          <h2>{page.title}</h2>
        </div>
        <button
          aria-label={page.pinned ? `Unpin ${page.title}` : `Pin ${page.title}`}
          aria-pressed={page.pinned}
          className="palmwiki-pin-button palmwiki-card-pin-button"
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
          Pin
        </button>
      </div>

      <div
        aria-label={`Open ${page.title}`}
        className="palmwiki-card-body-action"
        onClick={(event) => {
          event.stopPropagation();
          openPage();
        }}
        onKeyDown={activateOpenArea}
        onMouseEnter={previewPage}
        role="button"
        tabIndex={0}
      >
        {imageUrl ? (
          <img alt="" className="palmwiki-card-image" loading="lazy" src={imageUrl} />
        ) : null}

        {page.description ? (
          <p className="palmwiki-card-description">{page.description}</p>
        ) : presentation.showDescriptionPathFallback ? (
          <p className="palmwiki-card-description is-empty">{page.path}</p>
        ) : null}

        {presentation.showSecondaryMetadata ? (
          <div className="palmwiki-graph-badges" aria-label="Graph metadata">
            <span>PR {page.pageRank.toFixed(2)}</span>
            <span>In {page.inlinkCount}</span>
            <span>Out {page.outlinkCount}</span>
          </div>
        ) : null}

        {presentation.showSecondaryMetadata && showTags && page.tags.length > 0 ? (
          <div className="palmwiki-tags">
            {page.tags.map((tag) => (
              <span className="palmwiki-tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        {presentation.showSecondaryMetadata ? (
          <div className="palmwiki-card-footer">
            {showFolder && page.folder ? <span>{page.folder}</span> : <span>{page.path}</span>}
            <span>{formatDate(page.modifiedTime)}</span>
          </div>
        ) : null}
      </div>
    </article>
  );
});
