import type { Product } from './inventory';

export interface Session {
  id: string;
  fileName: string;
  importedAt: string;
  products: Product[];
}

export interface RestoredSession extends Session {
  counts: Map<string, number>;
}

type SessionMetadata = Omit<Session, 'products'>;

const DATABASE_NAME = 'jaegosilsa-stocktake-v1';
const ACTIVE_KEY = 'active';
const STORES = ['session', 'catalog', 'counts'];

function nonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateMetadata(value: unknown): SessionMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
      !('id' in value) || !nonemptyString(value.id) ||
      !('fileName' in value) || !nonemptyString(value.fileName) ||
      !('importedAt' in value) || !nonemptyString(value.importedAt) || !Number.isFinite(Date.parse(value.importedAt))) {
    throw new Error('저장된 실사 파일 정보가 손상되었습니다.');
  }
  return { id: value.id, fileName: value.fileName, importedAt: value.importedAt };
}

function validateProducts(value: unknown, barcodes: Set<string>): asserts value is Product[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('저장된 제품 목록이 비어 있거나 손상되었습니다.');
  for (let index = 0; index < value.length; index++) {
    const product: unknown = value[index];
    if (typeof product !== 'object' || product === null || Array.isArray(product) ||
        !('barcode' in product) || !nonemptyString(product.barcode) ||
        !('name' in product) || !nonemptyString(product.name) ||
        !('option' in product) || !nonemptyString(product.option) ||
        !('sku' in product) || typeof product.sku !== 'string' ||
        !('color' in product) || typeof product.color !== 'string' ||
        !('needsReview' in product) || typeof product.needsReview !== 'boolean' ||
        !('baseline' in product) || typeof product.baseline !== 'number' || !Number.isSafeInteger(product.baseline) ||
        !('sourceRow' in product) || typeof product.sourceRow !== 'number' ||
        !Number.isSafeInteger(product.sourceRow) || product.sourceRow <= 0) {
      throw new Error(`저장된 ${index + 1}번째 제품 정보가 손상되었습니다.`);
    }
    if (barcodes.has(product.barcode)) throw new Error(`저장된 제품 목록에 중복 바코드가 있습니다: ${product.barcode}`);
    barcodes.add(product.barcode);
  }
}

function validateCount(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('실물 수량은 0 이상의 안전한 정수여야 합니다.');
  }
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

// A successful request is not a commit: only the transaction's complete event resolves.
function transact<T>(
  database: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  work: (transaction: IDBTransaction, abort: (error: unknown) => void) => void,
  result: () => T,
): Promise<T> {
  const completion = Promise.withResolvers<T>();
  let transaction: IDBTransaction;
  try {
    transaction = database.transaction(stores, mode);
  } catch (error) {
    completion.reject(error);
    return completion.promise;
  }
  let failure: Error | null = null;
  const abort = (error: unknown): void => {
    failure ??= asError(error);
    try {
      transaction.abort();
    } catch {
      completion.reject(failure);
    }
  };
  transaction.onerror = event => {
    const request = event.target;
    failure ??= request instanceof IDBRequest && request.error
      ? request.error
      : transaction.error ?? new Error('브라우저 저장 트랜잭션에서 오류가 발생했습니다.');
  };
  transaction.onabort = () => {
    completion.reject(failure ?? transaction.error ?? new DOMException('브라우저 저장 트랜잭션이 취소되었습니다.', 'AbortError'));
  };
  transaction.oncomplete = () => {
    if (failure) {
      completion.reject(failure);
      return;
    }
    try {
      completion.resolve(result());
    } catch (error) {
      completion.reject(error);
    }
  };
  try {
    for (const name of stores) {
      const store = transaction.objectStore(name);
      if (store.keyPath !== null || store.autoIncrement) throw new Error('브라우저 저장소 구조가 손상되었습니다.');
    }
    work(transaction, abort);
  } catch (error) {
    abort(error);
  }
  return completion.promise;
}

export class StocktakeStore {
  private database: IDBDatabase | null = null;
  private opening: Promise<IDBDatabase> | null = null;
  private cancelOpen: (() => void) | null = null;
  private unavailable: Error | null = null;
  private closed = false;

  private open(): Promise<IDBDatabase> {
    if (this.closed) return Promise.reject(new Error('브라우저 저장소 연결이 닫혔습니다.'));
    if (this.unavailable) return Promise.reject(this.unavailable);
    if (this.opening) return this.opening;
    const completion = Promise.withResolvers<IDBDatabase>();
    this.opening = completion.promise;
    let finished = false;
    const fail = (error: unknown): void => {
      if (finished) return;
      finished = true;
      if (this.opening === completion.promise) {
        this.opening = null;
        this.cancelOpen = null;
      }
      completion.reject(error);
    };
    this.cancelOpen = () => fail(new Error('브라우저 저장소 연결이 닫혔습니다.'));
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE_NAME, 1);
    } catch (error) {
      fail(error);
      return completion.promise;
    }
    request.onblocked = () => fail(new Error('다른 탭이 브라우저 저장소 열기를 막고 있습니다. 다른 실사 탭을 닫은 뒤 다시 시도하세요.'));
    request.onerror = () => fail(request.error ?? new Error('브라우저 저장소를 열지 못했습니다.'));
    request.onupgradeneeded = () => {
      if (finished || this.closed) {
        request.transaction?.abort();
        return;
      }
      try {
        for (const name of STORES) request.result.createObjectStore(name);
      } catch (error) {
        fail(error);
        request.transaction?.abort();
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      if (finished || this.closed) {
        database.close();
        return;
      }
      if (database.objectStoreNames.length !== STORES.length || !STORES.every(name => database.objectStoreNames.contains(name))) {
        database.close();
        fail(new Error('브라우저 저장소 구조가 손상되었습니다.'));
        return;
      }
      database.onversionchange = () => {
        this.unavailable = new Error('다른 탭에서 브라우저 저장소가 변경되었습니다. 이 페이지를 새로고침하세요.');
        database.close();
        this.database = null;
        this.opening = null;
      };
      database.onclose = () => {
        if (this.database !== database) return;
        this.unavailable = new Error('브라우저 저장소 연결이 예기치 않게 끊겼습니다. 이 페이지를 새로고침하세요.');
        this.database = null;
        this.opening = null;
      };
      finished = true;
      this.cancelOpen = null;
      this.database = database;
      completion.resolve(database);
    };
    return completion.promise;
  }

  async load(): Promise<RestoredSession | null> {
    const database = await this.open();
    let metadata: unknown;
    let products: unknown;
    let metadataSize = 0;
    let catalogSize = 0;
    const counts = new Map<string, number>();
    return transact(database, STORES, 'readonly', (transaction, abort) => {
      const sessionStore = transaction.objectStore('session');
      const catalogStore = transaction.objectStore('catalog');
      const metadataRequest = sessionStore.get(ACTIVE_KEY);
      metadataRequest.onsuccess = () => { metadata = metadataRequest.result; };
      const productsRequest = catalogStore.get(ACTIVE_KEY);
      productsRequest.onsuccess = () => { products = productsRequest.result; };
      const metadataSizeRequest = sessionStore.count();
      metadataSizeRequest.onsuccess = () => { metadataSize = metadataSizeRequest.result; };
      const catalogSizeRequest = catalogStore.count();
      catalogSizeRequest.onsuccess = () => { catalogSize = catalogSizeRequest.result; };
      const cursorRequest = transaction.objectStore('counts').openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        try {
          if (!nonemptyString(cursor.key)) throw new Error('저장된 실물 수량의 바코드가 손상되었습니다.');
          const count: unknown = cursor.value;
          validateCount(count);
          counts.set(cursor.key, count);
          cursor.continue();
        } catch (error) {
          abort(error);
        }
      };
    }, () => {
      if (metadataSize === 0 && catalogSize === 0 && counts.size === 0) return null;
      if (metadataSize !== 1 || catalogSize !== 1) throw new Error('저장된 실사 정보가 일부 누락되거나 손상되었습니다.');
      const session = validateMetadata(metadata);
      const barcodes = new Set<string>();
      validateProducts(products, barcodes);
      for (const barcode of counts.keys()) {
        if (!barcodes.has(barcode)) throw new Error(`저장된 실물 수량에 미등록 바코드가 있습니다: ${barcode}`);
      }
      return { ...session, products, counts };
    });
  }

  async replace(session: Session): Promise<void> {
    const metadata = validateMetadata(session);
    validateProducts(session.products, new Set<string>());
    const database = await this.open();
    return transact(database, STORES, 'readwrite', transaction => {
      const sessionStore = transaction.objectStore('session');
      const catalogStore = transaction.objectStore('catalog');
      sessionStore.clear();
      catalogStore.clear();
      transaction.objectStore('counts').clear();
      sessionStore.put(metadata, ACTIVE_KEY);
      catalogStore.put(session.products, ACTIVE_KEY);
    }, () => undefined);
  }

  async clear(): Promise<void> {
    const database = await this.open();
    return transact(database, STORES, 'readwrite', transaction => {
      for (const name of STORES) transaction.objectStore(name).clear();
    }, () => undefined);
  }

  async setCount(sessionId: string, barcode: string, count: number): Promise<void> {
    if (!nonemptyString(sessionId) || !nonemptyString(barcode)) throw new Error('실사 ID와 바코드는 비어 있지 않은 문자열이어야 합니다.');
    validateCount(count);
    const database = await this.open();
    return transact(database, ['session', 'counts'], 'readwrite', (transaction, abort) => {
      const request = transaction.objectStore('session').get(ACTIVE_KEY);
      request.onsuccess = () => {
        try {
          if (request.result === undefined || validateMetadata(request.result).id !== sessionId) {
            throw new Error('실사가 교체되었거나 존재하지 않아 이전 실사 수량을 저장할 수 없습니다.');
          }
          const counts = transaction.objectStore('counts');
          if (count === 0) counts.delete(barcode);
          else counts.put(count, barcode);
        } catch (error) {
          abort(error);
        }
      };
    }, () => undefined);
  }

  close(): void {
    this.closed = true;
    this.cancelOpen?.();
    this.database?.close();
    this.database = null;
    this.opening = null;
  }
}
