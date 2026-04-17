import JSZip from "jszip";

/**
 * Read visible sheet names from an xlsx workbook without loading the full file
 * into ExcelJS/openpyxl. Returns null when the buffer is not an xlsx zip.
 */
export async function getWorkbookSheetNames(
  buffer: Buffer,
): Promise<string[] | null> {
  if (buffer.length < 4) return null;

  // .xlsx is a ZIP archive starting with PK.
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    return null;
  }

  const zip = await JSZip.loadAsync(buffer);
  const workbookFile = zip.file("xl/workbook.xml");
  if (!workbookFile) return null;

  const workbookXml = await workbookFile.async("string");
  const names: string[] = [];
  const iterator = workbookXml.matchAll(/<sheet\b[^>]*\bname="([^"]+)"/g);
  for (const match of iterator) {
    names.push(match[1]);
  }
  return names;
}
