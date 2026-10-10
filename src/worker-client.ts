import type { Product } from './inventory.ts';

export type ImportRequest = { type: 'import'; buffer: ArrayBuffer };
export type ExportRequest = { type: 'export'; products: readonly Product[]; counts: Array<[string, number]> };
let nextRequestId = 0;

export function runWorkbookWorker(request: ImportRequest): Promise<Product[]>;
export function runWorkbookWorker(request: ExportRequest): Promise<ArrayBuffer>;
export function runWorkbookWorker(request: ImportRequest | ExportRequest): Promise<Product[] | ArrayBuffer> {
  const { promise, resolve, reject } = Promise.withResolvers<Product[] | ArrayBuffer>();
  let worker: Worker;
  try {
    worker = new Worker(new URL('./workbook.worker.ts', import.meta.url), { type: 'module' });
  } catch (error) {
    reject(error instanceof Error ? error : new Error('엑셀 Worker를 시작할 수 없습니다.'));
    return promise;
  }
  const id = ++nextRequestId;
  const timer = window.setTimeout(() => finish(new Error('엑셀 처리 시간이 초과했습니다. 기존 실사 기록은 유지됩니다.')), 90000);
  let settled = false;
  function finish(error?: Error, result?: Product[] | ArrayBuffer): void {
    if (settled) return;
    settled = true;
    window.clearTimeout(timer);
    worker.terminate();
    if (error) reject(error);
    else if (result !== undefined) resolve(result);
    else reject(new Error('엑셀 처리 결과가 없습니다.'));
  }
  worker.onerror = event => finish(new Error(`엑셀 처리 오류: ${event.message || 'Worker 실행 실패'}`));
  worker.onmessageerror = () => finish(new Error('엑셀 처리 결과를 읽을 수 없습니다.'));
  worker.onmessage = (event: MessageEvent<unknown>) => {
    const value = event.data;
    if (!value || typeof value !== 'object' || !('id' in value) || value.id !== id || !('type' in value)) {
      finish(new Error('잘못된 엑셀 처리 응답입니다.'));
      return;
    }
    if (value.type === 'error' && 'message' in value && typeof value.message === 'string') {
      finish(new Error(value.message));
    } else if (request.type === 'import' && value.type === 'import' && 'products' in value && Array.isArray(value.products)) {
      // The local worker builds these products with normalizeProducts; structured clone preserves the validated shape.
      const products: Product[] = value.products;
      finish(undefined, products);
    } else if (request.type === 'export' && value.type === 'export' && 'buffer' in value && value.buffer instanceof ArrayBuffer) {
      finish(undefined, value.buffer);
    } else {
      finish(new Error('엑셀 처리 응답 형식이 맞지 않습니다.'));
    }
  };
  try {
    if (request.type === 'import') worker.postMessage({ ...request, id }, [request.buffer]);
    else worker.postMessage({ ...request, id });
  } catch (error) {
    finish(error instanceof Error ? error : new Error('엑셀 작업을 시작할 수 없습니다.'));
  }
  return promise;
}
