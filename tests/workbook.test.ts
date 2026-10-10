import test from 'node:test';
import assert from 'node:assert/strict';
import { read, utils, write } from 'xlsx';
import { importWorkbook, exportWorkbook } from '../src/workbook.ts';
import { normalizeProducts } from '../src/inventory.ts';

function workbook(rows: unknown[][], sheetName = 'Sheet1'): ArrayBuffer {
  const book = utils.book_new();
  utils.book_append_sheet(book, utils.aoa_to_sheet(rows), sheetName);
  return write(book, { type: 'array', bookType: 'xlsx' });
}

const headers = ['상품명', '이미지', '옵션명', '바코드 번호', '현매장 재고', '창고 재고', '타 매장'];

test('sparse image columns and different store values preserve every barcode record', () => {
  const products = importWorkbook(workbook([
    headers,
    ['XUL4PT1301 핑크스완', undefined, '120', '00123', 2, 7, 11],
    ['[사은품] 심볼 크루삭스', undefined, '블랙', 'constructor', -1, 5, 6],
    ['X1SHU X-1 퓨어민트', undefined, 'S', 'LAST', 0, 9, 8],
  ]));
  assert.deepEqual(products.map(p => [p.barcode, p.name, p.option, p.baseline]), [
    ['00123', 'XUL4PT1301 핑크스완', '120', 2],
    ['constructor', '[사은품] 심볼 크루삭스', '블랙', -1],
    ['LAST', 'X1SHU X-1 퓨어민트', 'S', 0],
  ]);
  const moved = importWorkbook(workbook([['바코드 번호', '현매장 재고', '옵션명', '상품명'], ['A', 4, 'M', 'XUL4PT1301 블랙']]));
  assert.equal(moved[0].baseline, 4);
});

test('bad final rows and duplicate barcodes reject the whole input with actual row numbers', () => {
  assert.throws(() => importWorkbook(workbook([headers, ['XUL4PT1301 블랙', '', 'S', 'A', 1], ['XUL4PT1301 블랙', '', 'M', 'B', ' ']])), /3행/);
  assert.throws(() => importWorkbook(workbook([headers, ['XUL4PT1301 블랙', '', 'S', 'A', 1], ['XUL4PT1301 블랙', '', 'M', 'A', 2]])), /3행.*중복/);
  assert.throws(() => importWorkbook(workbook([['상품명', '옵션명'], ['XUL4PT1301 블랙', 'S']])), /바코드 번호|현매장 재고/);
  assert.throws(() => importWorkbook(workbook([headers, ['XUL4PT1301 블랙', '', 'S', 'A', 1]], 'Other')), /Sheet1/);
  assert.throws(() => importWorkbook(new Uint8Array([1, 2, 3]).buffer), /XLSX|엑셀/);
});

test('formula stock cells and numeric barcode cells are not silently coerced', () => {
  const book = utils.book_new();
  const sheet = utils.aoa_to_sheet([headers, ['XUL4PT1301 블랙', '', 'S', 'A', 1]]);
  sheet.E2 = { t: 'n', v: 1, f: '1+0' };
  utils.book_append_sheet(book, sheet, 'Sheet1');
  assert.throws(() => importWorkbook(write(book, { type: 'array', bookType: 'xlsx' })), /2행.*수식|2행.*재고/);
  assert.throws(() => importWorkbook(workbook([headers, ['XUL4PT1301 블랙', '', 'S', 123, 1]])), /2행.*바코드/);
});

test('XLSX results preserve literal strings, full product identity and signed quantities', () => {
  const products = normalizeProducts([
    { sourceRow: 2, name: '=HYPERLINK("https://example.invalid")', option: '<img src=x>', barcode: '00123', baseline: -2 },
    { sourceRow: 3, name: 'XUL4PT1301 블랙', option: 'M', barcode: 'AbC', baseline: 10 },
  ]);
  const counts = new Map([['AbC', 8]]);
  const book = read(exportWorkbook(products, counts), { type: 'array', cellFormula: true });
  const sheet = book.Sheets['실사 결과'];
  const rows = utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: true });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => [row['바코드 번호'], row['기준 재고'], row['실물 수량'], row['차이']]), [['00123', -2, 0, 2], ['AbC', 10, 8, -2]]);
  assert.equal(rows[0]['상품명'], products[0].name);
  assert.equal(rows[0]['옵션/사이즈'], '<img src=x>');
  assert.equal(rows[0]['확인 필요'], '예');
  assert.equal(rows[1]['품번'], 'XUL4PT1301');
  assert.equal(rows[1]['색상'], '블랙');
  for (const [address, cell] of Object.entries(sheet)) {
    if (address.startsWith('!')) continue;
    assert.ok(cell && typeof cell === 'object');
    assert.equal('f' in cell ? cell.f : undefined, undefined);
    assert.equal('l' in cell ? cell.l : undefined, undefined);
  }
  const barcodeEntry = Object.entries(sheet).find(([, cell]) => cell && typeof cell === 'object' && 'v' in cell && cell.v === '00123');
  const barcodeCell = barcodeEntry?.[1];
  assert.ok(barcodeCell && typeof barcodeCell === 'object' && 't' in barcodeCell);
  assert.equal(barcodeCell.t, 's');
});
