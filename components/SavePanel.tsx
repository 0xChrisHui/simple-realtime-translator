"use client";

import { memo } from "react";
import { formatDuration } from "../lib/caption-text";
import { formatSessionTimeRange, getTranscriptSessionEndTime } from "../lib/transcript-session";
import type { StoredTranscriptSession } from "../lib/types";

type SavePanelProps = {
  sessions: StoredTranscriptSession[];
  onClose: () => void;
  onDownload: (session: StoredTranscriptSession) => void;
  onDelete: (sessionId: string) => void;
  onClearAll: () => void;
};

export const SavePanel = memo(function SavePanel({ sessions, onClose, onDownload, onDelete, onClearAll }: SavePanelProps) {
  return (
    <div className="save-panel-backdrop" role="presentation">
      <section aria-label="Saved transcript sessions" aria-modal="true" className="save-panel" role="dialog">
        <div className="save-panel-header">
          <h2>Transcripts</h2>
          <div className="save-panel-actions">
            <button className="tiny-button danger-outline" disabled={!sessions.length} onClick={onClearAll} type="button">
              Clear All
            </button>
            <button className="tiny-button" onClick={onClose} type="button">
              Close
            </button>
          </div>
        </div>
        <p className="save-panel-note">
          Saved locally in this browser for this site. Clearing browser site data, private browsing, a different browser, or a
          different domain can remove or hide these records.
        </p>

        {sessions.length ? (
          <div className="session-list">
            {sessions.map((session) => (
              <div className="session-row" key={session.id}>
                <div className="session-meta">
                  <span>{formatSessionTimeRange(session)}</span>
                  <span>{formatDuration(session.startedAt, getTranscriptSessionEndTime(session))}</span>
                  {session.status === "recovered" ? <span className="session-badge">Recovered</span> : null}
                  {session.downloaded ? <span className="session-badge">Downloaded</span> : null}
                </div>
                <div className="session-actions">
                  <button className="tiny-button" onClick={() => onDownload(session)} type="button">
                    Download
                  </button>
                  <button className="tiny-button danger-outline" onClick={() => onDelete(session.id)} type="button">
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-session-message">No saved transcript sessions yet.</p>
        )}
      </section>
    </div>
  );
});
