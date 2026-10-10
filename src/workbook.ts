import { read, utils, write } from 'xlsx';
import type { CellObject, WorkBook, WorkSheet } from 'xlsx';
import { normalizeProducts } from './inventory.ts';
import type { InputRow, Product } from './inventory.ts';

const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_DATA_ROWS = 100_000;
const MAX_COLUMNS = 128;
const MAX_RANGE_CELLS = 8_000_000;
const MAX_STRING_LENGTH = 10_000;
const REQUIRED_HEADERS = ['상품명', '옵션명', '바코드 번호', '현매장 재고'] as const;
type RequiredHeader = typeof REQUIRED_HEADERS[number];

function requiredValue(sheet: WorkSheet, row: number, column: number, header: RequiredHeader): unknown {
  const cell: CellObject | undefined = sheet[utils.encode_cell({ r: row, c: column })];
  const label = `${row + 1}행 ${header}`;
  if (cell && (cell.f !== undefined || cell.F !== undefined)) throw new Error(`${label}: 수식 셀은 사용할 수 없습니다.`);
  if (cell?.t === 'e') throw new Error(`${label}: 오류 셀은 사용할 수 없습니다.`);
  if (!cell || cell.t === 'z' || cell.v === undefined || cell.v === null) {
    throw new Error(`${label}: 필수 값이 비어 있습니다.`);
  }
  if (typeof cell.v === 'string') {
    if (!cell.v.trim()) throw new Error(`${label}: 필수 값이 비어 있습니다.`);
    if (cell.v.length > MAX_STRING_LENGTH) throw new Error(`${label}: 문자열은 10,000자 이하여야 합니다.`);
  }
  if (header === '바코드 번호' && (cell.t !== 's' || typeof cell.v !== 'string')) {
    throw new Error(`${label}: 바코드는 문자열 셀이어야 합니다. 숫자 셀의 앞자리 0은 추측하지 않습니다.`);
  }
  return cell.v;
}

function checkRange(lastRow: number, lastColumn: number): void {
  if (!Number.isSafeInteger(lastRow) || !Number.isSafeInteger(lastColumn) || lastRow < 0 || lastColumn < 0) {
    throw new Error('Sheet1의 셀 범위가 잘못되었습니다.');
  }
  if (lastRow > MAX_DATA_ROWS) throw new Error('Sheet1은 데이터 100,000행 이하여야 합니다.');
  if (lastColumn >= MAX_COLUMNS) throw new Error('Sheet1은 128열 이하여야 합니다.');
  if ((lastRow + 1) * (lastColumn + 1) > MAX_RANGE_CELLS) {
    throw new Error('Sheet1의 셀 범위는 8,000,000칸 이하여야 합니다.');
  }
}

export function importWorkbook(data: ArrayBuffer): Product[] {
  if (!(data instanceof ArrayBuffer)) throw new Error('XLSX 파일 데이터가 잘못되었습니다.');
  if (data.byteLength > MAX_FILE_BYTES) throw new Error('XLSX 파일은 16MiB 이하여야 합니다.');
  const signature = new Uint8Array(data, 0, Math.min(data.byteLength, 4));
  if (signature.length !== 4 || signature[0] !== 0x50 || signature[1] !== 0x4b || signature[2] !== 0x03 || signature[3] !== 0x04) {
    throw new Error('ZIP 형식의 XLSX 엑셀 파일만 가져올 수 있습니다.');
  }
  let book: WorkBook;
  try {
    // No sheetRows limit: invalid final rows must reject, never disappear through truncation.
    book = read(data, { type: 'array', sheets: 'Sheet1', cellFormula: true, cellHTML: false, cellText: false, cellDates: true, WTF: true });
  } catch {
    throw new Error('XLSX 엑셀 파일을 읽을 수 없습니다. 파일이 손상되었거나 지원하지 않는 형식입니다.');
  }
  if (book.bookType !== 'xlsx') throw new Error('XLSX 엑셀 파일만 가져올 수 있습니다.');
  if (!book.SheetNames.includes('Sheet1')) throw new Error('Sheet1 시트가 없습니다.');
  const sheet = book.Sheets['Sheet1'];
  if (!sheet || !sheet['!ref']) throw new Error('Sheet1에 가져올 제품이 없습니다.');
  const range = utils.decode_range(sheet['!ref']);
  let lastRow = range.e.r;
  let lastColumn = range.e.c;
  checkRange(lastRow, lastColumn);
  // SheetJS preserves cells outside a self-reported !ref. Include them rather than silently dropping them.
  for (const address in sheet) {
    if (address.startsWith('!')) continue;
    if (!/^[A-Z]+[1-9]\d*$/.test(address)) throw new Error('Sheet1의 셀 주소가 잘못되었습니다.');
    const cellAddress = utils.decode_cell(address);
    if (cellAddress.r > lastRow || cellAddress.c > lastColumn) {
      lastRow = Math.max(lastRow, cellAddress.r);
      lastColumn = Math.max(lastColumn, cellAddress.c);
      checkRange(lastRow, lastColumn);
    }
  }
  const columns = new Map<RequiredHeader, number>();
  for (let column = 0; column <= lastColumn; column++) {
    const cell: CellObject | undefined = sheet[utils.encode_cell({ r: 0, c: column })];
    if (!cell || typeof cell.v !== 'string') continue;
    const header = REQUIRED_HEADERS.find(required => required === cell.v);
    if (!header) continue;
    requiredValue(sheet, 0, column, header);
    if (columns.has(header)) throw new Error(`1행: ${header} 헤더가 중복되었습니다.`);
    columns.set(header, column);
  }
  const mapped: Record<RequiredHeader, number> = { '상품명': -1, '옵션명': -1, '바코드 번호': -1, '현매장 재고': -1 };
  for (const header of REQUIRED_HEADERS) {
    const column = columns.get(header);
    if (column === undefined) throw new Error(`1행: ${header} 헤더가 없습니다.`);
    mapped[header] = column;
  }
  function* rows(): IterableIterator<InputRow> {
    for (let row = 1; row <= lastRow; row++) {
      yield {
        sourceRow: row + 1,
        name: requiredValue(sheet, row, mapped['상품명'], '상품명'),
        option: requiredValue(sheet, row, mapped['옵션명'], '옵션명'),
        barcode: requiredValue(sheet, row, mapped['바코드 번호'], '바코드 번호'),
        baseline: requiredValue(sheet, row, mapped['현매장 재고'], '현매장 재고'),
      };
    }
  }
  return normalizeProducts(rows());
}

export function exportWorkbook(products: readonly Product[], counts: ReadonlyMap<string, number>): ArrayBuffer {
  if (products.length > MAX_DATA_ROWS) throw new Error('내보낼 제품은 100,000개 이하여야 합니다.');
  for (const [, count] of counts) {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('실물 수량은 0 이상의 안전한 정수여야 합니다.');
  }
  const sheet = utils.aoa_to_sheet([['품번', '색상', '옵션/사이즈', '상품명', '바코드 번호', '기준 재고', '실물 수량', '차이', '확인 필요']]);
  for (let index = 0; index < products.length; index++) {
    const product = products[index];
    const count = counts.get(product.barcode) ?? 0;
    const difference = count - product.baseline;
    if (!Number.isSafeInteger(product.baseline)) throw new Error(`${product.sourceRow}행: 기준 재고가 안전한 정수가 아닙니다.`);
    if (!Number.isSafeInteger(difference)) throw new Error(`${product.sourceRow}행: 차이가 안전한 정수 범위를 벗어났습니다.`);
    // A fresh worksheet and string values create literal text cells, not formulas or hyperlinks.
    utils.sheet_add_aoa(sheet, [[product.sku, product.color, product.option, product.name, product.barcode, product.baseline, count, difference, product.needsReview ? '예' : '아니오']], { origin: { r: index + 1, c: 0 } });
  }
  const book = utils.book_new();
  utils.book_append_sheet(book, sheet, '실사 결과');
  return write(book, { type: 'array', bookType: 'xlsx', compression: true });
}
