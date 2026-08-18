/**
 * RFC4180 CSV formatting. `columns` is explicit and caller-supplied rather
 * than inferred from the first row, so a zero-row export still produces a
 * correct header-only file — there's no "first row" to infer from otherwise.
 */
export function toCsv(columns: string[], rows: Record<string, string>[]): string {
  const lines = [columns, ...rows.map((row) => columns.map((column) => row[column] ?? ""))]
  return lines.map((fields) => fields.map(escapeField).join(",")).join("\r\n") + "\r\n"
}

function escapeField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
