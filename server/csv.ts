// Minimal CSV parser for the Fuzzwork SDE dumps (handles quoted fields).
export interface ParsedCsv {
  rows: string[][];
  idx: Record<string, number>;
}

/**
 * Parses a CSV string. Supports a row filter callback to discard rows
 * immediately during parsing, drastically saving memory for large files.
 */
export function parseCsv(
  text: string,
  filter?: (row: string[], idx: Record<string, number>) => boolean
): ParsedCsv {
  // Skip a leading BOM by offset rather than allocating a second copy of the (multi-MB) string.
  const cleanText = text;
  const start = cleanText.charCodeAt(0) === 0xfeff ? 1 : 0;
  const rows: string[][] = [];
  const idx: Record<string, number> = {};
  let headerParsed = false;

  let row: string[] = [];
  let inQuotes = false;
  let fieldStart = start;

  for (let i = start; i < cleanText.length; i++) {
    const c = cleanText[i];
    if (inQuotes) {
      if (c === '"') {
        if (cleanText[i + 1] === '"') {
          // escaped quote, skip next quote character
          i++;
        } else {
          inQuotes = false;
        }
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      let val = cleanText.substring(fieldStart, i);
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.substring(1, val.length - 1).replace(/""/g, '"');
      }
      row.push(val);
      fieldStart = i + 1;
    } else if (c === '\n') {
      let val = cleanText.substring(fieldStart, i);
      if (val.endsWith('\r')) {
        val = val.substring(0, val.length - 1);
      }
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.substring(1, val.length - 1).replace(/""/g, '"');
      }
      row.push(val);

      if (!headerParsed) {
        row.forEach((name, idxNum) => (idx[name] = idxNum));
        headerParsed = true;
      } else {
        if (row.length > 1) {
          if (!filter || filter(row, idx)) {
            rows.push(row);
          }
        }
      }

      row = [];
      fieldStart = i + 1;
    }
  }

  // Handle final row if there's no trailing newline
  if (fieldStart < cleanText.length || row.length > 0) {
    let val = cleanText.substring(fieldStart);
    if (val.endsWith('\r')) {
      val = val.substring(0, val.length - 1);
    }
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.substring(1, val.length - 1).replace(/""/g, '"');
    }
    row.push(val);
    if (headerParsed) {
      if (row.length > 1 && (!filter || filter(row, idx))) {
        rows.push(row);
      }
    }
  }

  return { rows, idx };
}
