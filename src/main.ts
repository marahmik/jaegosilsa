import './style.css';
import { Stocktake, sourceSign, differenceSign } from './inventory.ts';
import type { Product, CountChange } from './inventory.ts';
import { StocktakeStore } from './storage.ts';
import type { Session } from './storage.ts';
import { runWorkbookWorker } from './worker-client.ts';
import { ErrorSpeech, SuccessBeep } from './speech.ts';

const fileInput = document.querySelector<HTMLInputElement>('#file-input')!;
const scanInput = document.querySelector<HTMLInputElement>('#scan-input')!;
const scanButton = document.querySelector<HTMLButtonElement>('#scan-button')!;
const scanForm = document.querySelector<HTMLFormElement>('#scan-form')!;
const exportButton = document.querySelector<HTMLButtonElement>('#export-button')!;
const resetButton = document.querySelector<HTMLButtonElement>('#reset-button')!;
const undoButton = document.querySelector<HTMLButtonElement>('#undo-button')!;
const searchInput = document.querySelector<HTMLInputElement>('#search-input')!;
const sourceFilter = document.querySelector<HTMLSelectElement>('#source-filter')!;
const differenceFilter = document.querySelector<HTMLSelectElement>('#difference-filter')!;
const reviewFilter = document.querySelector<HTMLInputElement>('#review-filter')!;
const previousPage = document.querySelector<HTMLButtonElement>('#previous-page')!;
const nextPage = document.querySelector<HTMLButtonElement>('#next-page')!;
const body = document.querySelector<HTMLTableSectionElement>('#product-rows')!;
const notice = document.querySelector<HTMLDivElement>('#notice')!;
const saveStatus = document.querySelector<HTMLSpanElement>('#save-status')!;
const voiceStatus = document.querySelector<HTMLSpanElement>('#voice-status')!;
const successSoundStatus = document.querySelector<HTMLParagraphElement>('#success-sound-status')!;
const fileInfo = document.querySelector<HTMLDivElement>('#file-info')!;
const lastScan = document.querySelector<HTMLDivElement>('#last-scan')!;
const emptyState = document.querySelector<HTMLDivElement>('#table-empty')!;
const reviewSummary = document.querySelector<HTMLSpanElement>('#review-summary')!;
const pageLabel = document.querySelector<HTMLSpanElement>('#page-label')!;
const resultCount = document.querySelector<HTMLSpanElement>('#result-count')!;
const catalogDescription = document.querySelector<HTMLParagraphElement>('#catalog-description')!;
const formatter = new Intl.NumberFormat('ko-KR');
const store = new StocktakeStore();
const PAGE_SIZE = 100;
const history: CountChange[] = [];
const rowsByBarcode = new Map<string, { product: Product; physical: HTMLTableCellElement; difference: HTMLTableCellElement; input: HTMLInputElement; button: HTMLButtonElement }>();
let session: Session | null = null;
let stocktake: Stocktake | null = null;
let filteredProducts: readonly Product[] = [];
let searchIndex: string[] = [];
let page = 0;
let busy = true;
let pendingWrites = 0;
let saveFailed = false;
let restoreFailed = false;
let writeQueue: Promise<void> = Promise.resolve();
let searchTimer: number | undefined;

const speech = new ErrorSpeech((message, status) => {
  voiceStatus.textContent = message;
  voiceStatus.className = `helper${status === 'error' ? ' voice-error' : ''}`;
});
document.querySelector<HTMLButtonElement>('#voice-test')!.addEventListener('click', () => speech.speakError());
const successBeep = new SuccessBeep((message, status) => {
  successSoundStatus.textContent = message;
  successSoundStatus.dataset.status = status;
});

function showNotice(message: string, kind: 'success' | 'error' | 'warning' = 'success'): void {
  notice.textContent = message;
  notice.className = `notice ${kind}`;
  notice.hidden = false;
}

function updateControls(): void {
  fileInput.disabled = busy;
  scanInput.disabled = busy || !stocktake;
  scanButton.disabled = busy || !stocktake;
  exportButton.disabled = busy || !stocktake;
  resetButton.disabled = busy || (!stocktake && !restoreFailed);
  undoButton.disabled = busy || !stocktake || !history.length || pendingWrites > 0;
  searchInput.disabled = !stocktake;
  sourceFilter.disabled = !stocktake;
  differenceFilter.disabled = !stocktake;
  reviewFilter.disabled = !stocktake;
  for (const row of rowsByBarcode.values()) {
    row.input.disabled = busy;
    row.button.disabled = busy;
  }
  saveStatus.className = `status-pill${saveFailed ? ' failed' : pendingWrites > 0 || busy ? ' saving' : ''}`;
  saveStatus.textContent = saveFailed ? '저장/복원 오류' : pendingWrites > 0 ? `저장 중 · ${pendingWrites}건` : busy ? '처리 중' : session ? '브라우저 저장 완료' : '실사 기록 없음';
}

function renderSummary(): void {
  const values: Record<string, number | undefined> = {
    products: stocktake?.products.length,
    baseline: stocktake?.stats.baseline,
    physical: stocktake?.stats.physical,
    shortage: stocktake?.stats.shortage,
    overage: stocktake?.stats.overage,
    net: stocktake?.stats.net,
  };
  for (const [key, value] of Object.entries(values)) {
    const element = document.getElementById(`metric-${key}`)!;
    element.textContent = value === undefined ? '—' : (key === 'net' && value > 0 ? '+' : '') + formatter.format(value);
  }
  document.getElementById('metric-scanned')!.textContent = `실물 확인 ${formatter.format(stocktake?.stats.scannedProducts ?? 0)}종`;
  if (stocktake) {
    catalogDescription.textContent = `원본 재고: 음수 ${formatter.format(stocktake.stats.sourceNegative)}종 · 양수 ${formatter.format(stocktake.stats.sourcePositive)}종 · 0 ${formatter.format(stocktake.stats.sourceZero)}종`;
    reviewSummary.hidden = stocktake.stats.needsReview === 0;
    reviewSummary.textContent = `품번·색상 확인 필요 ${formatter.format(stocktake.stats.needsReview)}종`;
  } else {
    catalogDescription.textContent = '엑셀을 불러오면 제품 목록이 표시됩니다.';
    reviewSummary.hidden = true;
    reviewSummary.textContent = '';
  }
}

function renderLastScan(): void {
  const recent = history.at(-1);
  lastScan.replaceChildren();
  if (!recent || !stocktake) {
    const label = document.createElement('span');
    label.className = 'empty-label';
    label.textContent = '제품을 스캔하면 최근 등록 정보가 표시됩니다.';
    lastScan.append(label);
    return;
  }
  const product = stocktake.byBarcode.get(recent.barcode)!;
  const title = document.createElement('div');
  title.className = 'scan-title';
  const name = document.createElement('strong');
  name.textContent = `${product.sku || product.name} · ${product.color} · ${product.option}`;
  const quantity = document.createElement('span');
  quantity.className = 'scan-count';
  quantity.textContent = `${formatter.format(stocktake.getCount(product.barcode))}개`;
  title.append(name, quantity);
  const details = document.createElement('p');
  details.className = 'scan-details';
  details.textContent = `${product.barcode} · 최근 성공한 스캔입니다. 취소는 화면 검색·필터와 관계없이 적용됩니다.`;
  lastScan.append(title, details);
}

function updateVisibleCount(barcode: string): void {
  const row = rowsByBarcode.get(barcode);
  if (!row || !stocktake) return;
  const count = stocktake.getCount(barcode);
  const difference = count - row.product.baseline;
  row.physical.textContent = formatter.format(count);
  row.difference.textContent = (difference > 0 ? '+' : '') + formatter.format(difference);
  row.difference.className = `numeric difference-${difference < 0 ? 'negative' : difference > 0 ? 'positive' : 'zero'}`;
  if (document.activeElement !== row.input) row.input.value = String(count);
}

function renderRows(): void {
  body.replaceChildren();
  rowsByBarcode.clear();
  const totalPages = Math.ceil(filteredProducts.length / PAGE_SIZE);
  page = Math.max(0, Math.min(page, Math.max(totalPages - 1, 0)));
  for (const product of filteredProducts.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
    const tr = document.createElement('tr');
    const nameCell = document.createElement('td');
    const sku = document.createElement('span');
    sku.className = 'product-sku'; sku.textContent = product.sku || product.name;
    nameCell.append(sku);
    if (product.sku) {
      const original = document.createElement('span');
      original.className = 'product-name'; original.textContent = product.name;
      nameCell.append(original);
    }
    if (product.needsReview) {
      const badge = document.createElement('span');
      badge.className = 'review-badge'; badge.textContent = '확인 필요';
      nameCell.append(badge);
    }
    const color = document.createElement('td'); color.textContent = product.color || '—';
    const option = document.createElement('td'); option.textContent = product.option;
    const barcode = document.createElement('td'); barcode.className = 'barcode-cell'; barcode.textContent = product.barcode;
    const baseline = document.createElement('td'); baseline.className = `numeric${product.baseline < 0 ? ' source-negative' : ''}`; baseline.textContent = formatter.format(product.baseline);
    const physical = document.createElement('td'); physical.className = 'numeric';
    const difference = document.createElement('td');
    const edit = document.createElement('td');
    const form = document.createElement('form'); form.className = 'quantity-edit';
    const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.step = '1'; input.value = String(stocktake!.getCount(product.barcode)); input.setAttribute('aria-label', `${product.barcode} 실물 수량`);
    const button = document.createElement('button'); button.type = 'submit'; button.className = 'button compact'; button.textContent = '수정';
    input.disabled = busy; button.disabled = busy;
    form.addEventListener('submit', event => {
      event.preventDefault();
      const value = input.value.trim();
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
        showNotice('실물 수량은 0 이상의 안전한 정수로 입력해주세요.', 'error');
        return;
      }
      enqueueChange('edit', product.barcode, Number(value));
    });
    form.append(input, button); edit.append(form);
    tr.append(nameCell, color, option, barcode, baseline, physical, difference, edit);
    body.append(tr);
    rowsByBarcode.set(product.barcode, { product, physical, difference, input, button });
    updateVisibleCount(product.barcode);
  }
  emptyState.hidden = filteredProducts.length > 0;
  if (stocktake && !filteredProducts.length) {
    emptyState.querySelector('h4')!.textContent = '조건에 맞는 제품이 없습니다.';
    emptyState.querySelector('p')!.textContent = '검색어와 원본 재고·실사 차이 필터를 확인해주세요.';
  } else if (!stocktake) {
    emptyState.querySelector('h4')!.textContent = '실사를 시작할 준비가 됐습니다.';
    emptyState.querySelector('p')!.textContent = 'POS 엑셀을 불러와 기준 제품 목록을 만들어주세요.';
  }
  resultCount.textContent = `${formatter.format(filteredProducts.length)}개 제품${stocktake ? ` / 전체 ${formatter.format(stocktake.products.length)}개` : ''}`;
  pageLabel.textContent = `${totalPages ? page + 1 : 0} / ${totalPages}`;
  previousPage.disabled = page <= 0; nextPage.disabled = page + 1 >= totalPages;
}

function applyFilters(resetPage = true): void {
  if (resetPage) page = 0;
  if (!stocktake) filteredProducts = [];
  else {
    const query = searchInput.value.trim().toLocaleLowerCase('ko-KR');
    const source = sourceFilter.value;
    const difference = differenceFilter.value;
    if (!query && source === 'all' && difference === 'all' && !reviewFilter.checked) filteredProducts = stocktake.products;
    else {
      const activeStocktake = stocktake;
      filteredProducts = stocktake.products.filter((product, index) =>
        (!query || searchIndex[index].includes(query)) &&
        (source === 'all' || sourceSign(product) === source) &&
        (difference === 'all' || differenceSign(activeStocktake.getCount(product.barcode) - product.baseline) === difference) &&
        (!reviewFilter.checked || product.needsReview));
    }
  }
  renderRows();
}

function installSession(nextSession: Session, nextStocktake: Stocktake): void {
  session = nextSession; stocktake = nextStocktake;
  searchIndex = nextStocktake.products.map(product => `${product.name} ${product.sku} ${product.color} ${product.option} ${product.barcode}`.toLocaleLowerCase('ko-KR'));
  history.length = 0;
  searchInput.value = ''; sourceFilter.value = 'all'; differenceFilter.value = 'all'; reviewFilter.checked = false;
  fileInfo.textContent = `${nextSession.fileName} · ${formatter.format(nextStocktake.products.length)}개 제품 · ${new Date(nextSession.importedAt).toLocaleString('ko-KR')}`;
  renderSummary(); renderLastScan(); applyFilters();
}

function enqueueChange(kind: 'scan' | 'edit' | 'undo', barcode = '', quantity = 0): void {
  if (busy || !stocktake || !session) return;
  pendingWrites++;
  updateControls();
  writeQueue = writeQueue.then(async () => {
    if (!stocktake || !session) return;
    let change: CountChange | undefined;
    const undo = kind === 'undo' ? history.at(-1) : undefined;
    try {
      if (kind === 'scan') change = stocktake.scan(barcode);
      else if (kind === 'edit') change = stocktake.setCount(barcode, quantity);
      else if (undo) change = stocktake.setCount(undo.barcode, undo.previous);
      else { showNotice('취소할 최근 스캔이 없습니다.', 'warning'); return; }
      if (!change) {
        showNotice(`미등록 바코드: ${barcode}. 집계하지 않았습니다. 최신 엑셀에 해당 제품이 있는지 확인해주세요.`, 'error');
        speech.speakError();
        return;
      }
      try {
        await store.setCount(session.id, change.barcode, change.count);
      } catch (error) {
        stocktake.setCount(change.barcode, change.previous);
        saveFailed = true;
        renderSummary();
        renderLastScan();
        applyFilters(false);
        throw error;
      }
      saveFailed = false;
      if (kind === 'scan') {
        history.push(change);
        void successBeep.play();
      }
      else if (kind === 'undo') history.pop();
      else for (let index = history.length - 1; index >= 0; index--) if (history[index].barcode === change.barcode) history.splice(index, 1);
      renderSummary(); renderLastScan();
      if (differenceFilter.value !== 'all') applyFilters(false);
      else updateVisibleCount(change.barcode);
      showNotice(`${kind === 'undo' ? '스캔 취소' : kind === 'edit' ? '수량 수정' : '등록 완료'} · ${change.barcode} · 실물 ${formatter.format(change.count)}개 · 저장 완료`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '수량을 저장하지 못했습니다.', 'error');
    }
  }).finally(() => {
    pendingWrites--;
    updateControls();
  });
}

scanForm.addEventListener('submit', event => {
  event.preventDefault();
  const barcode = scanInput.value.trim();
  scanInput.value = '';
  if (!barcode) return;
  if (!busy && stocktake?.byBarcode.has(barcode)) successBeep.prepareFromGesture();
  enqueueChange('scan', barcode);
  scanInput.focus();
});
scanInput.addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== 'Tab') return;
  event.preventDefault();
  if (event.repeat) return;
  scanForm.requestSubmit();
});
undoButton.addEventListener('click', () => { enqueueChange('undo'); scanInput.focus(); });
searchInput.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = window.setTimeout(() => applyFilters(), 160); });
sourceFilter.addEventListener('change', () => applyFilters());
differenceFilter.addEventListener('change', () => applyFilters());
reviewFilter.addEventListener('change', () => applyFilters());
previousPage.addEventListener('click', () => { page--; renderRows(); });
nextPage.addEventListener('click', () => { page++; renderRows(); });

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file || busy) return;
  busy = true; updateControls();
  try {
    await writeQueue;
    if ((session || restoreFailed) && !window.confirm('새 엑셀로 실사를 교체할까요? 기존 제품 목록과 스캔 집계가 교체되며 새 실물 수량은 0부터 시작합니다. 필요한 결과는 먼저 내려받아주세요.')) return;
    if (!file.name.toLowerCase().endsWith('.xlsx') || file.size > 16 * 1024 * 1024) throw new Error('16 MB 이하의 POS .xlsx 파일을 선택해주세요.');
    showNotice(`${file.name} · 엑셀 분석 중입니다. 기존 기록은 아직 교체하지 않았습니다.`);
    const products = await runWorkbookWorker({ type: 'import', buffer: await file.arrayBuffer() });
    const nextStocktake = new Stocktake(products);
    const nextSession: Session = { id: crypto.randomUUID(), fileName: file.name, importedAt: new Date().toISOString(), products };
    showNotice('분석 완료 · 새 실사를 브라우저에 저장 중입니다.');
    await store.replace(nextSession);
    installSession(nextSession, nextStocktake);
    restoreFailed = false; saveFailed = false;
    showNotice(`${formatter.format(products.length)}개 제품을 불러왔습니다. 원본 재고와 실사 차이를 구분해서 확인하세요.`);
  } catch (error) {
    showNotice(`${error instanceof Error ? error.message : '파일을 가져오지 못했습니다.'} 기존 실사 기록은 유지됩니다.`, 'error');
  } finally {
    busy = false; updateControls();
    if (stocktake) scanInput.focus();
  }
});

resetButton.addEventListener('click', async () => {
  if (busy || (!stocktake && !restoreFailed)) return;
  busy = true; updateControls();
  try {
    await writeQueue;
    if (!window.confirm('불러온 엑셀의 제품 목록과 모든 스캔·수정 수량을 이 브라우저에서 삭제할까요? 복구할 수 없으니 필요한 결과는 먼저 내려받아주세요. PC의 원본 엑셀 파일은 삭제되지 않습니다.')) return;
    await store.clear();
    session = null; stocktake = null;
    searchIndex = []; history.length = 0;
    clearTimeout(searchTimer);
    fileInput.value = ''; scanInput.value = ''; searchInput.value = '';
    sourceFilter.value = 'all'; differenceFilter.value = 'all'; reviewFilter.checked = false;
    fileInfo.textContent = '아직 선택한 파일이 없습니다.';
    restoreFailed = false; saveFailed = false;
    renderSummary(); renderLastScan(); applyFilters();
    showNotice('불러온 제품 목록과 스캔·수정 수량을 모두 삭제했습니다. 새 엑셀을 불러와 실사를 시작해주세요.');
  } catch (error) {
    saveFailed = true;
    showNotice(`리셋하지 못했습니다: ${error instanceof Error ? error.message : '브라우저 저장소 오류'}. 기존 실사 기록은 유지됩니다.`, 'error');
  } finally {
    busy = false; updateControls();
    if (stocktake) scanInput.focus();
    else fileInput.focus();
  }
});

exportButton.addEventListener('click', async () => {
  if (busy || !stocktake || !session) return;
  busy = true; updateControls();
  try {
    await writeQueue;
    showNotice('저장된 현재 집계로 전체 결과 엑셀을 생성 중입니다.');
    const buffer = await runWorkbookWorker({ type: 'export', products: stocktake.products, counts: [...stocktake.counts] });
    const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const link = document.createElement('a'); link.href = url;
    link.download = `${session.fileName.replace(/\.xlsx$/i, '')}-실사-${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`;
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    showNotice(`전체 ${formatter.format(stocktake.products.length)}개 제품의 결과를 내려받았습니다. 현재 검색·필터는 결과에서 제외하지 않습니다.${saveFailed ? ' 브라우저 저장 오류가 있었으므로 저장 상태를 별도로 확인하세요.' : ''}`);
  } catch (error) {
    showNotice(error instanceof Error ? error.message : '결과를 내려받지 못했습니다.', 'error');
  } finally {
    busy = false; updateControls(); scanInput.focus();
  }
});

async function restore(): Promise<void> {
  try {
    const saved = await store.load();
    if (saved) {
      installSession(saved, new Stocktake(saved.products, saved.counts));
      showNotice('이 브라우저에 저장된 실사를 복원했습니다. 이어서 스캔할 수 있습니다.');
    }
  } catch (error) {
    saveFailed = true; restoreFailed = true;
    showNotice(`저장 기록을 복원하지 못했습니다: ${error instanceof Error ? error.message : 'IndexedDB 오류'}. 새 파일로 교체하기 전에 기존 기록 보관 여부를 확인해주세요.`, 'error');
  } finally {
    busy = false; renderSummary(); updateControls();
    if (stocktake) scanInput.focus();
  }
}

renderRows();
void restore();
