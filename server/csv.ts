// Minimal CSV parser for the Fuzzwork SDE dumps (handles quoted fields).
export interface ParsedCsv {
  rows: string[][];
  idx: Record<string, number>;
}

function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function parseCsv(text: string): ParsedCsv {
  const rows = parseRows(text.replace(/^\uFEFF/, ''));
  const header = rows[0] ?? [];
  const idx: Record<string, number> = {};
  header.forEach((name, i) => (idx[name] = i));
  return { rows: rows.slice(1).filter((r) => r.length > 1), idx };
}
