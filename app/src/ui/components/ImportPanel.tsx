import { useState } from 'react';
import { applyImport, parseArchive, previewImport, ArchiveError, type DuplicatePolicy, type ImportPreview, type ImportReport, type ParsedArchive } from '../../importExport/archive';
import { Modal } from './common';
import { navigate } from '../router';
import { confirmDialog, reportError, toast } from '../store';
import { flushAllEdits } from '../../editor/EditorContext';

/** Pick an archive file (or receive bytes), preview it, and import with explicit choices. */
export function useArchiveImport() {
  const [state, setState] = useState<{ parsed: ParsedArchive; preview: ImportPreview } | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);

  const loadBytes = async (bytes: Uint8Array) => {
    try {
      const parsed = await parseArchive(bytes);
      const preview = await previewImport(parsed);
      setState({ parsed, preview });
    } catch (e) {
      if (e instanceof ArchiveError) toast(e.message, { kind: 'error', ms: 10000 });
      else reportError(e, 'Import failed');
    }
  };

  const loadFile = async (file: File) => {
    if (file.size > 500 * 1024 * 1024) return toast('That file is larger than 500 MB.', { kind: 'error' });
    await loadBytes(new Uint8Array(await file.arrayBuffer()));
  };

  const modal = (
    <>
      {state && (
        <ImportPreviewModal
          parsed={state.parsed}
          preview={state.preview}
          onClose={() => setState(null)}
          onDone={(r) => {
            setState(null);
            setReport(r);
          }}
        />
      )}
      {report && (
        <Modal title="Import complete" onClose={() => setReport(null)}>
          <ul>
            <li>{report.added} records added</li>
            {report.updated > 0 && <li>{report.updated} records replaced with the imported version (previous prose saved in History)</li>}
            {report.copied > 0 && <li>{report.copied} imported as copies beside existing ones</li>}
            <li>{report.skipped} unchanged or kept as-is</li>
          </ul>
          {report.warnings.length > 0 && (
            <>
              <h3>Notes</h3>
              <ul className="small">
                {report.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </>
          )}
          <div className="dialog-actions">
            <button
              className="primary"
              onClick={() => {
                const id = report.projectId;
                setReport(null);
                navigate(id, 'home');
              }}
            >
              Open project
            </button>
          </div>
        </Modal>
      )}
    </>
  );
  return { loadFile, loadBytes, modal };
}

function ImportPreviewModal({ parsed, preview, onClose, onDone }: { parsed: ParsedArchive; preview: ImportPreview; onClose: () => void; onDone: (r: ImportReport) => void }) {
  const [mode, setMode] = useState<'restore' | 'merge' | 'copy'>(preview.projectExists ? 'copy' : 'restore');
  const [policy, setPolicy] = useState<DuplicatePolicy>('keep-existing');
  const [busy, setBusy] = useState(false);
  const differs = preview.perTable.reduce((n, t) => n + t.differs, 0);
  const totals = preview.perTable.filter((t) => t.total > 0);
  const run = async () => {
    if (mode === 'merge' && policy === 'use-imported' && differs) {
      const ok = await confirmDialog('Replace changed records?', `${differs} records on this device differ from the archive and will be replaced by the imported versions. Scene text is saved to History first.`, { confirmLabel: 'Replace', danger: true });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await flushAllEdits();
      onDone(await applyImport(parsed, mode, policy));
    } catch (e) {
      if (e instanceof ArchiveError) toast(e.message, { kind: 'error', ms: 10000 });
      else reportError(e, 'Import failed');
      setBusy(false);
    }
  };
  return (
    <Modal title="Import preview" onClose={onClose} wide>
      <p>
        <strong>{parsed.manifest.project.name}</strong> · exported {new Date(parsed.manifest.exportedAt).toLocaleString()} · integrity check passed ✓
      </p>
      {parsed.warnings.length > 0 && (
        <div className="banner info">
          <ul>
            {parsed.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      <table className="preview-table">
        <thead>
          <tr>
            <th>Content</th>
            <th>In archive</th>
            <th>New</th>
            <th>Same</th>
            <th>Different</th>
          </tr>
        </thead>
        <tbody>
          {totals.map((t) => (
            <tr key={t.table}>
              <td>{t.table}</td>
              <td>{t.total}</td>
              <td>{t.new}</td>
              <td>{t.identical}</td>
              <td className={t.differs ? 'warn-text' : ''}>{t.differs}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <fieldset className="field">
        <legend>How should this be imported?</legend>
        {!preview.projectExists && (
          <label className="radio">
            <input type="radio" checked={mode === 'restore'} onChange={() => setMode('restore')} /> <strong>Restore project</strong> — this project isn’t on this device yet; add it exactly as archived.
          </label>
        )}
        {preview.projectExists && (
          <label className="radio">
            <input type="radio" checked={mode === 'merge'} onChange={() => setMode('merge')} /> <strong>Merge into “{preview.existingName}”</strong> — add new records; choose what happens to the {differs} that differ.
          </label>
        )}
        <label className="radio">
          <input type="radio" checked={mode === 'copy'} onChange={() => setMode('copy')} /> <strong>Import as a separate copy</strong> — a new project; nothing existing is touched.
        </label>
      </fieldset>
      {mode === 'merge' && differs > 0 && (
        <fieldset className="field">
          <legend>When a record differs</legend>
          <label className="radio">
            <input type="radio" checked={policy === 'keep-existing'} onChange={() => setPolicy('keep-existing')} /> Keep the version on this device
          </label>
          <label className="radio">
            <input type="radio" checked={policy === 'use-imported'} onChange={() => setPolicy('use-imported')} /> Use the imported version (scene text backed up to History)
          </label>
          <label className="radio">
            <input type="radio" checked={policy === 'keep-both'} onChange={() => setPolicy('keep-both')} /> Keep both (imported versions added as copies)
          </label>
        </fieldset>
      )}
      {preview.idCollisionsElsewhere > 0 && <p className="warn-text">{preview.idCollisionsElsewhere} ids are used by another project here; use “Import as a separate copy”.</p>}
      <div className="dialog-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={busy} onClick={run}>
          {busy ? 'Importing…' : 'Import'}
        </button>
      </div>
    </Modal>
  );
}
