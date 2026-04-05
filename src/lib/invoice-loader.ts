import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import { parseInvoice } from '$shared/invoice';
import type { PositionedTextItem, ParsedInvoice } from '$shared/invoice';

// Use bundled worker for browser environments
GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export async function loadInvoiceFromFile(file: File): Promise<ParsedInvoice> {
  const arrayBuffer = await file.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);
  const pdf = await getDocument({ data }).promise;

  const items: PositionedTextItem[] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    for (const textItem of content.items) {
      if ('str' in textItem && 'transform' in textItem) {
        items.push({
          str: textItem.str,
          x: textItem.transform[4],
          y: textItem.transform[5],
          page: pageNum,
        });
      }
    }
  }

  return parseInvoice(items);
}
