export function sanitizeCsvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const escaped = text.replaceAll('"', '""');
  const guarded = /^[=+\-@\t\r]/.test(escaped) ? `'${escaped}` : escaped;
  return `"${guarded}"`;
}

export function toCsv(rows: Array<Record<string, unknown>>): string {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [headers.map((header) => sanitizeCsvCell(header)).join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => sanitizeCsvCell(row[header])).join(","));
  }
  return lines.join("\n");
}
