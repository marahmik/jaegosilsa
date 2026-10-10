import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProducts, Stocktake, sourceSign, differenceSign } from '../src/inventory.ts';

const input = (barcode: unknown = '00123', baseline: unknown = 2, name: unknown = 'XUL4PT1301 핑크스완', option: unknown = '120', sourceRow = 2) => ({ barcode, baseline, name, option, sourceRow });

test('SKU, short SKU and raw options are preserved without inferred sizes', () => {
  const products = normalizeProducts([
    input(),
    input('SHORT', 0, ' X1SHU X-1 퓨어민트 ', '블랙', 3),
    input('GIFT', 0, '[사은품] 심볼 크루삭스', 'M(55반~66)', 4),
  ]);
  assert.deepEqual([products[0].sku, products[0].color, products[0].option], ['XUL4PT1301', '핑크스완', '120']);
  assert.deepEqual([products[1].sku, products[1].color, products[1].option], ['X1SHU', 'X-1 퓨어민트', '블랙']);
  assert.equal(products[1].name, ' X1SHU X-1 퓨어민트 ');
  assert.deepEqual([products[2].sku, products[2].color, products[2].needsReview], ['', '', true]);
  assert.equal(products[2].name, '[사은품] 심볼 크루삭스');
  assert.equal(products[2].option, 'M(55반~66)');
});

test('invalid import fields and duplicate barcodes identify the source row', () => {
  for (const invalid of [input('', 1), input(123, 1), input('A', '', 'XUL4PT1301 블랙'), input('A', 1.5), input('A', Number.NaN), input('A', 1, ''), input('A', 1, 'XUL4PT1301 블랙', '')]) {
    assert.throws(() => normalizeProducts([invalid]), /2행/);
  }
  assert.throws(() => normalizeProducts([input('DUP'), input('DUP', 3, 'XUL4PT1301 블랙', 'M', 9)]), /9행.*중복/);
  assert.throws(() => normalizeProducts([input('A', Number.MAX_SAFE_INTEGER + 1)]), /2행/);
  assert.throws(() => normalizeProducts([]), /제품/);
});

test('string barcode boundaries and source signs do not change identifiers', () => {
  const products = normalizeProducts([input('00123', '-2'), input('AbC', '0', 'XUL4PT1301 블랙', 'M', 3)]);
  const stocktake = new Stocktake(products);
  assert.equal(products[0].barcode, '00123');
  assert.equal(products[0].baseline, -2);
  assert.equal(stocktake.scan(' 00123\r\n')?.count, 1);
  assert.equal(stocktake.scan('abc'), undefined);
  assert.equal(stocktake.getCount('AbC'), 0);
  assert.equal(stocktake.scan('AbC\t')?.count, 1);
  assert.equal(sourceSign(products[0]), 'negative');
  assert.equal(differenceSign(stocktake.getCount('00123') - products[0].baseline), 'overage');
});

test('repeated zero-stock scans, undo values and explicit correction affect only one product', () => {
  const stocktake = new Stocktake(normalizeProducts([input('ZERO', 0), input('OTHER', 4, 'XUL4PT1301 블랙', 'M', 3)]));
  stocktake.scan('ZERO'); stocktake.scan('ZERO');
  const last = stocktake.scan('ZERO')!;
  assert.deepEqual(last, { barcode: 'ZERO', previous: 2, count: 3 });
  assert.equal(stocktake.getCount('ZERO'), 3);
  stocktake.setCount(last.barcode, last.previous);
  assert.equal(stocktake.getCount('ZERO'), 2);
  stocktake.setCount('ZERO', 5);
  assert.equal(stocktake.getCount('ZERO'), 5);
  assert.equal(stocktake.getCount('OTHER'), 0);
  assert.equal(stocktake.stats.physical, 5);
  assert.equal(stocktake.stats.shortage, 4);
  assert.equal(stocktake.stats.overage, 5);
  assert.equal(stocktake.stats.net, 1);
});

test('unknown scans and invalid corrections cannot mutate accepted counts', () => {
  const stocktake = new Stocktake(normalizeProducts([input('KNOWN', 10)]));
  stocktake.setCount('KNOWN', 8);
  const before = { ...stocktake.stats };
  assert.equal(stocktake.scan('UNKNOWN'), undefined);
  assert.equal(stocktake.scan('  '), undefined);
  for (const count of [-1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => stocktake.setCount('KNOWN', count), /수량/);
  }
  assert.throws(() => stocktake.setCount('UNKNOWN', 1), /바코드/);
  assert.equal(stocktake.getCount('KNOWN'), 8);
  assert.deepEqual(stocktake.stats, before);
  stocktake.setCount('KNOWN', 0);
  assert.equal(stocktake.getCount('KNOWN'), 0);
});

test('source-negative stock and net discrepancy classify independently, with noncancelling totals', () => {
  const products = normalizeProducts([input('A', 10), input('B', 10, 'XUL4PT1301 블랙', 'M', 3), input('C', -2, 'X1SHU X-1 퓨어민트', 'S', 4)]);
  const stocktake = new Stocktake(products, new Map([['A', 8], ['B', 12]]));
  assert.deepEqual(products.map(p => stocktake.getCount(p.barcode) - p.baseline), [-2, 2, 2]);
  assert.deepEqual(products.map(sourceSign), ['positive', 'positive', 'negative']);
  assert.deepEqual(products.map(p => differenceSign(stocktake.getCount(p.barcode) - p.baseline)), ['shortage', 'overage', 'overage']);
  assert.equal(stocktake.stats.shortage, 2);
  assert.equal(stocktake.stats.overage, 4);
  assert.equal(stocktake.stats.net, 2);
  assert.equal(stocktake.stats.physical, 20);
  assert.equal(stocktake.stats.baseline, 18);
});

test('safe integer boundary edits and increment rejection preserve exact totals', () => {
  const stocktake = new Stocktake(normalizeProducts([input('MAX', 0)]));
  stocktake.setCount('MAX', Number.MAX_SAFE_INTEGER);
  assert.throws(() => stocktake.scan('MAX'), /수량/);
  assert.equal(stocktake.getCount('MAX'), Number.MAX_SAFE_INTEGER);
  stocktake.setCount('MAX', Number.MAX_SAFE_INTEGER - 1);
  assert.equal(stocktake.stats.physical, Number.MAX_SAFE_INTEGER - 1);
  assert.equal(stocktake.stats.net, Number.MAX_SAFE_INTEGER - 1);
  assert.equal(stocktake.stats.overage, Number.MAX_SAFE_INTEGER - 1);
});

test('prototype-like barcode names are exact identifiers, not inherited membership', () => {
  const stocktake = new Stocktake(normalizeProducts([input('constructor', 0), input('toString', 0, 'XUL4PT1301 블랙', 'M', 3)]));
  assert.equal(stocktake.scan('__proto__'), undefined);
  assert.equal(stocktake.scan('Constructor'), undefined);
  assert.equal(stocktake.scan('constructor')?.count, 1);
  assert.equal(stocktake.scan('toString')?.count, 1);
  assert.equal(stocktake.stats.physical, 2);
});
