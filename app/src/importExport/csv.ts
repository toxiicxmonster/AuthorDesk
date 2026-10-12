/**
 * Spreadsheet (CSV/TSV) reading for imports. Handles what Excel, Google Sheets, Numbers and LibreOffice
 * produce: quoted cells with commas/newlines/doubled quotes, a UTF-8 byte-order mark, Windows line endings,
 * and comma, semicolon (European Excel) or tab separators.
 */

export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

export function parseCsv(input: string, delimiter?: string): string[][] {
  const text = input.replace(/^\uFEFF/, '');
  const d = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === d) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  // Drop completely empty rows (common at the end of exported sheets).
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Normalise a column heading for matching: "Also known as" → "alsoknownas". */
export function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface Sheet {
  /** Original headings, in order. */
  headers: string[];
  /** One object per row keyed by normalised heading. */
  rows: Record<string, string>[];
}

export function readSheet(text: string): Sheet {
  const [head, ...body] = parseCsv(text);
  if (!head) return { headers: [], rows: [] };
  const headers = head.map((h) => h.trim());
  const keys = headers.map(normHeader);
  return {
    headers,
    rows: body.map((r) => {
      const o: Record<string, string> = {};
      keys.forEach((k, i) => {
        if (k) o[k] = (r[i] ?? '').trim();
      });
      return o;
    }),
  };
}

/** Split a multi-value cell. Semicolons or vertical bars always separate; commas only when `commas` is true. */
export function splitList(v: string | undefined, commas = false): string[] {
  if (!v) return [];
  return v
    .split(commas ? /[;|,]/ : /[;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
