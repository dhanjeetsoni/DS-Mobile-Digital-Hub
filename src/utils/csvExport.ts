// Phase 6: "Excel/PDF export for invoices and customers". PDF export
// already existed (browser print -> Save as PDF, see ExportClearInvoicesView
// / CustomerDirectoryView's "Export PDF" button). This adds the missing
// Excel side as a downloadable .csv — Excel, Google Sheets, and every other
// spreadsheet app opens a CSV natively with zero extra steps for the owner.
//
// A genuine binary .xlsx (via a library like SheetJS) was considered, but
// deliberately not used here: it would be a new dependency pulled into a
// Tauri desktop bundle purely for file writing that a plain CSV already
// covers, for a "shopkeeper reviews it in Excel" use case. If a future need
// specifically requires multi-sheet workbooks, cell formatting, or formulas,
// that would justify revisiting this with `xlsx`, but plain CSV is the
// safer, zero-new-dependency choice for what was actually asked for here.
function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const lines = [headers.map(csvEscape).join(","), ...rows.map((r) => r.map(csvEscape).join(","))];
  // A UTF-8 BOM so Excel (which otherwise guesses the wrong encoding for
  // non-ASCII text) renders ₹ and any Hindi text correctly instead of "?"/mojibake.
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
