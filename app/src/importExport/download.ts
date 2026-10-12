/** Save a file: uses the native "Save as" picker where supported (lets you pick e.g. a synced Drive folder). */
export async function saveFile(data: Blob | Uint8Array | string, filename: string, mime: string): Promise<'saved' | 'cancelled'> {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: mime });
  const w = window as unknown as {
    showSaveFilePicker?: (o: unknown) => Promise<{ createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }>;
  };
  if (w.showSaveFilePicker) {
    try {
      const ext = filename.slice(filename.lastIndexOf('.'));
      const handle = await w.showSaveFilePicker({ suggestedName: filename, types: [{ description: 'AuthorDesk export', accept: { [mime]: [ext] } }] });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'saved';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      // Fall through to a regular download (e.g. picker blocked in this context).
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'saved';
}

export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

export function fileSafe(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim().slice(0, 60) || 'project';
}
