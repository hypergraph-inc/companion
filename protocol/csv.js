// The row shape the server accepts. Mirrored by hand from src/data/csv.js in
// the tesseract repo -- this is a format, not an implementation, and the
// package must not reach outside its own directory to read it.

const VALID_TYPES = new Set(['NODE', 'EDGE']);
const VALID_OPS = new Set(['add', 'update', 'remove']);

export const HEADER = 't,type,op,id,kind,source,target,layer,weight,label';

export function parseLine(line) {
  const fields = [];
  let i = 0;
  const len = line.length;

  if (len === 0) return [''];

  while (i <= len) {
    if (i === len) {
      fields.push('');
      break;
    }

    if (line[i] === '"') {
      let value = '';
      i++;
      while (i < len) {
        if (line[i] === '"') {
          if (i + 1 < len && line[i + 1] === '"') {
            value += '"';
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          value += line[i];
          i++;
        }
      }
      fields.push(value);
      if (i < len && line[i] === ',') {
        i++;
      } else {
        break;
      }
    } else {
      const next = line.indexOf(',', i);
      if (next === -1) {
        fields.push(line.slice(i));
        break;
      } else {
        fields.push(line.slice(i, next));
        i = next + 1;
      }
    }
  }

  return fields;
}

export function fieldsToRow(fields) {
  const weight = fields[8] !== '' ? Number(fields[8]) : undefined;

  return {
    t: Number(fields[0]),
    type: fields[1],
    op: fields[2],
    id: fields[3],
    kind: fields[4] || undefined,
    source: fields[5] || undefined,
    target: fields[6] || undefined,
    layer: fields[7] || undefined,
    weight: isNaN(weight) ? undefined : weight,
    label: fields[9],
  };
}

export function splitLines(text) {
  const lines = [];
  const len = text.length;
  let lineStart = 0;
  let inQuote = false;
  let i = 0;
  while (i < len) {
    const ch = text.charCodeAt(i);
    if (ch === 34) {
      inQuote = !inQuote;
      i++;
    } else if ((ch === 10 || ch === 13) && !inQuote) {
      if (i > lineStart) lines.push(text.slice(lineStart, i));
      if (ch === 13 && text.charCodeAt(i + 1) === 10) i++;
      i++;
      lineStart = i;
    } else {
      i++;
    }
  }
  if (lineStart < len) lines.push(text.slice(lineStart, len));

  return lines;
}

export function parseCSV(text) {
  const rows = [];
  const lines = splitLines(text);

  let start = 0;
  if (lines.length > 0 && lines[0].startsWith('t,type,')) {
    start = 1;
  }

  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const fields = parseLine(line);
    if (fields.length < 4) continue;
    rows.push(fieldsToRow(fields));
  }

  return rows;
}

export function validateRow(row) {
  if (!row || typeof row !== 'object') return 'row is not an object';
  if (!VALID_TYPES.has(row.type)) return `invalid type: ${row.type}`;
  if (!VALID_OPS.has(row.op)) return `invalid op: ${row.op}`;
  if (!row.id || typeof row.id !== 'string') return 'missing id';
  if (row.t != null && !Number.isFinite(row.t)) return 'invalid t';
  if (row.type === 'EDGE' && row.op === 'add') {
    if (!row.source) return 'EDGE add requires source';
    if (!row.target) return 'EDGE add requires target';
    if (!row.layer) return 'EDGE add requires layer';
  }
  return null;
}
