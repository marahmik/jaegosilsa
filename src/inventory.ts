export interface Product {
  barcode: string;
  name: string;
  sku: string;
  color: string;
  option: string;
  baseline: number;
  needsReview: boolean;
  sourceRow: number;
}

export interface InputRow {
  barcode: unknown;
  name: unknown;
  option: unknown;
  baseline: unknown;
  sourceRow: number;
}

export interface CountChange {
  barcode: string;
  previous: number;
  count: number;
}

export interface InventoryStats {
  baseline: number;
  physical: number;
  shortage: number;
  overage: number;
  net: number;
  scannedProducts: number;
  sourceNegative: number;
  sourcePositive: number;
  sourceZero: number;
  needsReview: number;
}

const PRODUCT_NAME = /^([A-Z][A-Z0-9]*[0-9][A-Z0-9]*)\s+(.+)$/;

function safeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label}: 정확하게 계산할 수 있는 정수 범위를 벗어났습니다.`);
  return value;
}

export function normalizeProducts(rows: Iterable<InputRow>): Product[] {
  const products: Product[] = [];
  const seen = new Set<string>();
  let totalPositive = 0;
  let totalNegative = 0;
  for (const row of rows) {
    const label = `${row.sourceRow}행`;
    if (typeof row.barcode !== 'string' || !row.barcode.trim()) {
      throw new Error(`${label}: 바코드 번호는 비어 있지 않은 문자열이어야 합니다. 숫자 셀의 앞자리 0은 추측하지 않습니다.`);
    }
    const barcode = row.barcode.trim();
    if (seen.has(barcode)) throw new Error(`${label}: 중복 바코드 ${barcode}`);
    if (typeof row.name !== 'string' || !row.name.trim()) throw new Error(`${label}: 상품명이 비어 있습니다.`);
    if (!((typeof row.option === 'string' && row.option.trim()) || (typeof row.option === 'number' && Number.isFinite(row.option)))) {
      throw new Error(`${label}: 옵션명이 비어 있거나 잘못되었습니다.`);
    }
    let baseline: number;
    if (typeof row.baseline === 'number') baseline = row.baseline;
    else if (typeof row.baseline === 'string' && /^[+-]?\d+$/.test(row.baseline.trim())) baseline = Number(row.baseline.trim());
    else throw new Error(`${label}: 현매장 재고는 부호 있는 정수여야 합니다.`);
    safeInteger(baseline, `${label} 현매장 재고`);
    if (baseline > 0) totalPositive = safeInteger(totalPositive + baseline, `${label} 양수 재고 합계`);
    if (baseline < 0) totalNegative = safeInteger(totalNegative - baseline, `${label} 음수 재고 합계`);
    const match = PRODUCT_NAME.exec(row.name.trim());
    products.push({ barcode, name: row.name, sku: match?.[1] ?? '', color: match?.[2] ?? '', option: String(row.option), baseline, needsReview: !match, sourceRow: row.sourceRow });
    seen.add(barcode);
  }
  if (!products.length) throw new Error('가져올 제품이 없습니다.');
  return products;
}

export function sourceSign(product: Product): 'negative' | 'zero' | 'positive' {
  return product.baseline < 0 ? 'negative' : product.baseline > 0 ? 'positive' : 'zero';
}

export function differenceSign(difference: number): 'shortage' | 'match' | 'overage' {
  return difference < 0 ? 'shortage' : difference > 0 ? 'overage' : 'match';
}

export class Stocktake {
  readonly products: readonly Product[];
  readonly byBarcode: ReadonlyMap<string, Product>;
  readonly counts: Map<string, number>;
  readonly stats: InventoryStats;

  constructor(products: Product[], counts: ReadonlyMap<string, number> = new Map()) {
    this.products = products;
    this.byBarcode = new Map(products.map(product => [product.barcode, product]));
    if (this.byBarcode.size !== products.length) throw new Error('제품 목록에 중복 바코드가 있습니다.');
    this.counts = new Map();
    this.stats = { baseline: 0, physical: 0, shortage: 0, overage: 0, net: 0, scannedProducts: 0, sourceNegative: 0, sourcePositive: 0, sourceZero: 0, needsReview: 0 };
    for (const product of products) {
      const stats = this.stats;
      stats.baseline = safeInteger(stats.baseline + product.baseline, '기준 재고 합계');
      stats.shortage = safeInteger(stats.shortage + Math.max(product.baseline, 0), '부족 수량 합계');
      stats.overage = safeInteger(stats.overage + Math.max(-product.baseline, 0), '초과 수량 합계');
      stats.net = safeInteger(stats.net - product.baseline, '차이 합계');
      if (product.baseline < 0) stats.sourceNegative++;
      else if (product.baseline > 0) stats.sourcePositive++;
      else stats.sourceZero++;
      if (product.needsReview) stats.needsReview++;
    }
    for (const [barcode, count] of counts) this.setCount(barcode, count);
  }

  getCount(barcode: string): number {
    return this.counts.get(barcode) ?? 0;
  }

  scan(raw: string): CountChange | undefined {
    const barcode = raw.trim();
    if (!this.byBarcode.has(barcode)) return undefined;
    return this.setCount(barcode, this.getCount(barcode) + 1);
  }

  setCount(barcode: string, count: number): CountChange {
    const product = this.byBarcode.get(barcode);
    if (!product) throw new Error('등록되지 않은 바코드입니다.');
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('실물 수량은 0 이상의 안전한 정수여야 합니다.');
    const previous = this.getCount(barcode);
    const before = safeInteger(previous - product.baseline, '변경 전 차이');
    const after = safeInteger(count - product.baseline, '변경 후 차이');
    const delta = count - previous;
    const physical = safeInteger(this.stats.physical + delta, '실물 수량 합계');
    const shortage = safeInteger(this.stats.shortage - Math.max(-before, 0) + Math.max(-after, 0), '부족 수량 합계');
    const overage = safeInteger(this.stats.overage - Math.max(before, 0) + Math.max(after, 0), '초과 수량 합계');
    const net = safeInteger(this.stats.net + delta, '차이 합계');
    if (count === 0) this.counts.delete(barcode);
    else this.counts.set(barcode, count);
    this.stats.physical = physical;
    this.stats.shortage = shortage;
    this.stats.overage = overage;
    this.stats.net = net;
    if (previous === 0 && count > 0) this.stats.scannedProducts++;
    if (previous > 0 && count === 0) this.stats.scannedProducts--;
    return { barcode, previous, count };
  }
}
