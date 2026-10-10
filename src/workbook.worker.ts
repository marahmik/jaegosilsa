import { exportWorkbook, importWorkbook } from './workbook.ts';
import type { Product } from './inventory.ts';

type ImportRequest = { id: number; type: 'import'; buffer: ArrayBuffer };
type ExportRequest = { id: number; type: 'export'; products: Product[]; counts: Array<[string, number]> };
type WorkbookRequest = ImportRequest | ExportRequest;
type WorkbookResponse =
  | { id: number; type: 'import'; products: Product[] }
  | { id: number; type: 'export'; buffer: ArrayBuffer }
  | { id: number; type: 'error'; message: string };

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 10_000;
}

function isProduct(value: unknown): value is Product {
  return typeof value === 'object' && value !== null
    && 'barcode' in value && isText(value.barcode) && value.barcode.trim().length > 0
    && 'name' in value && isText(value.name) && value.name.trim().length > 0
    && 'sku' in value && isText(value.sku)
    && 'color' in value && isText(value.color)
    && 'option' in value && isText(value.option) && value.option.trim().length > 0
    && 'baseline' in value && typeof value.baseline === 'number' && Number.isSafeInteger(value.baseline)
    && 'needsReview' in value && typeof value.needsReview === 'boolean'
    && 'sourceRow' in value && typeof value.sourceRow === 'number' && Number.isSafeInteger(value.sourceRow) && value.sourceRow >= 2;
}

function isCount(value: unknown): value is [string, number] {
  return Array.isArray(value) && value.length === 2
    && isText(value[0]) && value[0].trim().length > 0
    && typeof value[1] === 'number' && Number.isSafeInteger(value[1]) && value[1] >= 0;
}

function isRequest(value: unknown): value is WorkbookRequest {
  if (typeof value !== 'object' || value === null || !('id' in value) || !('type' in value)
    || typeof value.id !== 'number' || !Number.isSafeInteger(value.id) || value.id < 0) return false;
  if (value.type === 'import') return 'buffer' in value && value.buffer instanceof ArrayBuffer;
  return value.type === 'export'
    && 'products' in value && Array.isArray(value.products) && value.products.length <= 100_000 && value.products.every(isProduct)
    && 'counts' in value && Array.isArray(value.counts) && value.counts.length <= 100_000 && value.counts.every(isCount);
}

self.addEventListener('message', (event: MessageEvent<unknown>) => {
  const request = event.data;
  const id = typeof request === 'object' && request !== null && 'id' in request
    && typeof request.id === 'number' && Number.isSafeInteger(request.id) ? request.id : -1;
  try {
    if (!isRequest(request)) throw new Error('엑셀 작업 요청의 형식이 잘못되었습니다.');
    if (request.type === 'import') {
      const response: WorkbookResponse = { id: request.id, type: 'import', products: importWorkbook(request.buffer) };
      self.postMessage(response);
      return;
    }
    const barcodes = new Set<string>();
    for (const product of request.products) {
      if (barcodes.has(product.barcode)) throw new Error(`${product.sourceRow}행: 중복 바코드입니다.`);
      barcodes.add(product.barcode);
    }
    const counts = new Map<string, number>();
    for (const [barcode, count] of request.counts) {
      if (!barcodes.has(barcode)) throw new Error('등록되지 않은 바코드의 실물 수량입니다.');
      if (counts.has(barcode)) throw new Error('실물 수량 요청에 중복 바코드가 있습니다.');
      counts.set(barcode, count);
    }
    const buffer = exportWorkbook(request.products, counts);
    const response: WorkbookResponse = { id: request.id, type: 'export', buffer };
    self.postMessage(response, { transfer: [buffer] });
  } catch (error) {
    const response: WorkbookResponse = { id, type: 'error', message: error instanceof Error ? error.message : '엑셀 작업에 실패했습니다.' };
    self.postMessage(response);
  }
});
