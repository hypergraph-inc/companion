// The row shape the server accepts. Mirrored by hand from src/data/csv.js in
// the tesseract repo -- this is a format, not an implementation, and the
// package must not reach outside its own directory to read it.

const VALID_TYPES = new Set(['NODE', 'EDGE']);
const VALID_OPS = new Set(['add', 'update', 'remove']);

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
