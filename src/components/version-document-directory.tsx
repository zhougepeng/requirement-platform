"use client";

import type { RequirementDocument } from "@/lib/types";

export function VersionDocumentDirectory({
  documents,
  selectedId,
  onSelect,
  label,
}: {
  documents: RequirementDocument[];
  selectedId: string;
  onSelect: (id: string) => void;
  label: string;
}) {
  if (documents.length <= 1) return null;
  return (
    <nav className="document-directory" aria-label={label}>
      <div className="document-directory-title">{label}</div>
      <div className="document-directory-list">
        {documents.map((document) => (
          <button
            type="button"
            key={document.id}
            className={`document-directory-file ${document.id === selectedId ? "is-active" : ""}`}
            onClick={() => onSelect(document.id)}
            title={document.path}
            aria-current={document.id === selectedId ? "page" : undefined}
          >
            <span>{document.name}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
