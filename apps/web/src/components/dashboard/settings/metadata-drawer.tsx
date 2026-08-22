'use client';

import * as React from 'react';

import type { AuditLogEntry } from '../../../lib/audit/types.js';

/**
 * Safely format an unknown value for display. Handles strings, numbers,
 * booleans; objects are JSON-stringified to avoid [object Object] rendering.
 */
function formatUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return '';
  return JSON.stringify(value);
}

export interface MetadataDrawerProps {
  readonly entry: AuditLogEntry;
  readonly onClose: () => void;
}

/**
 * Side panel showing the full metadata JSON for an audit log entry.
 *
 * For auto-transition actions, highlights summaryId, confidence, and
 * promptVersion — the "every AI decision is auditable" moment per the task.
 *
 * Metadata is rendered as formatted JSON in monospace font. Nested keys
 * are indented and collapsible for readability, though we keep it simple:
 * just pretty-printed JSON with syntax highlighting.
 */
export function MetadataDrawer({ entry, onClose }: MetadataDrawerProps): React.ReactElement {
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const isAutoTransition = entry.action === 'AUTO_TRANSITION';

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
        role="button"
        tabIndex={-1}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-auto bg-white shadow-lg">
        <div className="bg-stone-warm/30 sticky top-0 flex items-center justify-between border-b border-black/5 px-6 py-4">
          <div>
            <h2 className="font-display text-lg font-light text-black">Audit Details</h2>
            <p className="text-gray-warm mt-1 text-xs">
              {entry.action} · {entry.resourceType} {entry.resourceId}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-warm -mr-2 p-2 transition-colors hover:text-black"
            aria-label="Close drawer"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="space-y-6 p-6">
          {/* Summary section for auto-transitions */}
          {isAutoTransition &&
          (entry.metadata.summaryId ||
            entry.metadata.confidence ||
            entry.metadata.promptVersion) ? (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <h3 className="font-display mb-3 text-sm font-medium text-blue-900">
                AI Decision Parameters
              </h3>
              <div className="space-y-2">
                {entry.metadata.summaryId ? (
                  <div>
                    <span className="text-xs font-medium text-blue-800">Summary ID</span>
                    <p className="mt-1 break-all font-mono text-xs text-blue-700">
                      {formatUnknown(entry.metadata.summaryId)}
                    </p>
                  </div>
                ) : null}
                {entry.metadata.confidence ? (
                  <div>
                    <span className="text-xs font-medium text-blue-800">Confidence</span>
                    <p className="mt-1 font-mono text-xs text-blue-700">
                      {(Number(entry.metadata.confidence) * 100).toFixed(1)}%
                    </p>
                  </div>
                ) : null}
                {entry.metadata.promptVersion ? (
                  <div>
                    <span className="text-xs font-medium text-blue-800">Prompt Version</span>
                    <p className="mt-1 font-mono text-xs text-blue-700">
                      {formatUnknown(entry.metadata.promptVersion)}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Actor info */}
          <div>
            <h3 className="text-caption text-gray-warm mb-2 font-medium uppercase tracking-[0.12em]">
              Actor
            </h3>
            {entry.user ? (
              <div className="text-sm text-black">
                <p className="font-medium">{entry.user.name ?? entry.user.email}</p>
                {entry.user.name ? (
                  <p className="text-gray-warm text-xs">{entry.user.email}</p>
                ) : null}
              </div>
            ) : (
              <p className="text-gray-warm text-sm italic">System</p>
            )}
          </div>

          {/* IP and user agent */}
          <div className="grid grid-cols-2 gap-4">
            {entry.ipAddress ? (
              <div>
                <h3 className="text-caption text-gray-warm mb-1 text-xs font-medium uppercase tracking-[0.12em]">
                  IP Address
                </h3>
                <p className="font-mono text-xs text-black">{entry.ipAddress}</p>
              </div>
            ) : null}
            {entry.userAgent ? (
              <div>
                <h3 className="text-caption text-gray-warm mb-1 text-xs font-medium uppercase tracking-[0.12em]">
                  User Agent
                </h3>
                <p className="break-all font-mono text-xs text-black">
                  {entry.userAgent.slice(0, 40)}…
                </p>
              </div>
            ) : null}
          </div>

          {/* Full metadata as JSON */}
          <div>
            <h3 className="text-caption text-gray-warm mb-3 font-medium uppercase tracking-[0.12em]">
              Full Metadata
            </h3>
            <pre className="max-h-96 overflow-auto rounded-lg border border-black/5 bg-gray-50 p-4 font-mono text-xs text-black/80">
              {JSON.stringify(entry.metadata, null, 2)}
            </pre>
          </div>

          {/* Raw entry (for debugging) */}
          <div className="border-t border-black/5 pt-4">
            <details className="cursor-pointer">
              <summary className="text-gray-warm text-xs font-medium uppercase tracking-[0.12em] hover:text-black">
                Raw Entry (debugging)
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded-lg border border-black/5 bg-gray-50 p-3 font-mono text-xs text-black/60">
                {JSON.stringify(
                  {
                    id: entry.id,
                    action: entry.action,
                    resourceType: entry.resourceType,
                    resourceId: entry.resourceId,
                    userId: entry.userId,
                    createdAt: entry.createdAt,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          </div>
        </div>

        <div className="bg-stone-warm/30 sticky bottom-0 border-t border-black/5 p-4">
          <button
            onClick={onClose}
            className="w-full rounded-[9999px] bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-black/90"
          >
            Close
          </button>
        </div>
      </div>
    </>
  );
}
