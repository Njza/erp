import { HttpClient } from '@angular/common/http';
import { ChangeDetectorRef, Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../core/auth';
import { NotifyService } from '../core/notify';
import { rmbUpper } from '../core/rmb';

// Continuous paper for dot-matrix printers is 9.5in (241mm) wide; the height is one fold.
// `rows` is how many item lines fit on one sheet with the layout below.
const PAPERS = {
  half: { label: '241 × 140 mm（二等分）', height: 5.5, rows: 7 },
  full: { label: '241 × 280 mm（整张）', height: 11, rows: 26 },
} as const;
type PaperKey = keyof typeof PAPERS;
const MAX_ROWS = PAPERS.full.rows;

const SETTINGS_KEY = 'erp.partsBill.settings';
// shortcut: the company header and printer calibration are saved in this browser only,
// so each PC enters them once; move them to a server-side settings table when several PCs print.
const DEFAULT_SETTINGS = {
  company: '', bank: '', account: '', holder: '', phone: '',
  paper: 'half' as PaperKey,
  offsetX: 0, // mm, moves the whole print right (+) or left (-)
  offsetY: 0, // mm, moves the whole print down (+) or up (-)
};

interface Row { name: string; unit: string; qty: number | null; qtyUnit: string; price: number | null }
interface Bill {
  id: number; no: string; date: string; handler: string; customer: string; picker: string; installer: string; receiver: string;
  settle: boolean; warranty: boolean; rows: Row[];
}
interface BillSummary { id: number; no: string; date: string; customer: string; handler: string; total: number }

const isEmpty = (r: Row) => !r.name && !r.unit && r.qty === null && r.price === null;
const blankRow = (): Row => ({ name: '', unit: '', qty: null, qtyUnit: '台', price: null });

/** 650 -> "650", 650.5 -> "650.5", 0.125 -> "0.13" */
const num = (n: number) => String(+n.toFixed(2));

@Component({
  imports: [FormsModule],
  template: `
    <div class="no-print">
      <header class="page-head">
        <h1>更换配件清单 <small class="muted">{{ bill.id ? '已保存' : '未保存' }}</small></h1>
        <div class="buttons">
          <button (click)="openHistory()">历史记录</button>
          @if (canWrite) {
            <button (click)="newBill()">新建</button>
            <button [disabled]="busy()" (click)="save()">保存</button>
            <button class="primary" [disabled]="busy() || !!problem()" (click)="saveAndPrint()">保存并打印</button>
          } @else {
            <button class="primary" [disabled]="!bill.id || !!problem()" (click)="print()">打印</button>
          }
        </div>
      </header>
      @if (problem(); as p) { <p class="problem" role="alert">{{ p }}</p> }

      <dialog #history class="history">
        <h2>历史记录</h2>
        <form class="search" (ngSubmit)="loadHistory(1)">
          <input name="q" [(ngModel)]="q" placeholder="单据编号或使用单位" aria-label="搜索单据编号或使用单位">
          <button>搜索</button>
        </form>
        <table>
          <thead><tr><th>单据编号</th><th>日期</th><th>使用单位</th><th>经手人</th><th class="r">合计</th><th></th></tr></thead>
          <tbody>
            @for (b of list().items; track b.id) {
              <tr>
                <td>{{ b.no }}</td><td>{{ b.date }}</td><td>{{ b.customer }}</td><td>{{ b.handler }}</td>
                <td class="r">{{ numText(b.total) }}</td>
                <td class="actions"><button (click)="open(b.id)">打开</button></td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="muted">没有单据。</td></tr>
            }
          </tbody>
        </table>
        <menu>
          <span class="muted">共 {{ list().total }} 张，第 {{ page }} / {{ pages() }} 页</span>
          <button type="button" [disabled]="page <= 1" (click)="loadHistory(page - 1)">上一页</button>
          <button type="button" [disabled]="page >= pages()" (click)="loadHistory(page + 1)">下一页</button>
          <button type="button" (click)="history.close()">关闭</button>
        </menu>
      </dialog>

      <div class="fields">
        <label>录单日期 <input type="date" name="date" [(ngModel)]="bill.date" (change)="suggestNo()"></label>
        <label>单据编号 <input name="no" [(ngModel)]="bill.no"></label>
        <label>经手人 <input name="handler" [(ngModel)]="bill.handler"></label>
        <label>使用单位 <input name="customer" [(ngModel)]="bill.customer"></label>
        <label>出仓领件人 <input name="picker" [(ngModel)]="bill.picker"></label>
        <label>维修安装员 <input name="installer" [(ngModel)]="bill.installer"></label>
        <label>使用单位收货人 <input name="receiver" [(ngModel)]="bill.receiver"></label>
        <fieldset>
          <legend>附加说明</legend>
          <label class="check"><input type="checkbox" name="settle" [(ngModel)]="bill.settle"> 配件更换完毕即结算</label>
          <label class="check"><input type="checkbox" name="warranty" [(ngModel)]="bill.warranty"> 配件保修半年，易损件除外</label>
        </fieldset>
      </div>

      <table class="entry">
        <thead><tr><th>序号</th><th>配件名称</th><th>单位（梯号）</th><th>数量</th><th>单位</th><th>单价（元）</th><th>金额</th></tr></thead>
        <tbody>
          @for (r of formRows(); track $index; let i = $index) {
            <tr>
              <td>{{ i + 1 }}</td>
              <td><input [name]="'name' + i" [(ngModel)]="r.name" [attr.aria-label]="'第' + (i + 1) + '行配件名称'"></td>
              <td><input [name]="'unit' + i" [(ngModel)]="r.unit" [attr.aria-label]="'第' + (i + 1) + '行单位（梯号）'"></td>
              <td><input type="number" min="0" step="any" [name]="'qty' + i" [(ngModel)]="r.qty" [attr.aria-label]="'第' + (i + 1) + '行数量'"></td>
              <td><input [name]="'qtyUnit' + i" [(ngModel)]="r.qtyUnit" placeholder="台" [attr.aria-label]="'第' + (i + 1) + '行数量单位'"></td>
              <td><input type="number" min="0" step="any" [name]="'price' + i" [(ngModel)]="r.price" [attr.aria-label]="'第' + (i + 1) + '行单价'"></td>
              <td class="amount">{{ amountText(r) }}</td>
            </tr>
          }
        </tbody>
      </table>
      <p class="muted">只填名称的行会原样打印，可用来写配件编号。数量和单价都填了才计算金额。</p>

      <details>
        <summary>打印设置（公司抬头、纸张、位置校准）</summary>
        <div class="fields">
          <label>公司名称 <input name="company" [(ngModel)]="settings.company" (change)="saveSettings()"></label>
          <label>开户银行 <input name="bank" [(ngModel)]="settings.bank" (change)="saveSettings()"></label>
          <label>银行账号 <input name="account" [(ngModel)]="settings.account" (change)="saveSettings()"></label>
          <label>户名 <input name="holder" [(ngModel)]="settings.holder" (change)="saveSettings()"></label>
          <label>电话 <input name="phone" [(ngModel)]="settings.phone" (change)="saveSettings()"></label>
          <label>纸张
            <select name="paper" [(ngModel)]="settings.paper" (change)="saveSettings()">
              @for (key of paperKeys; track key) { <option [value]="key">{{ papers[key].label }}</option> }
            </select>
          </label>
          <label>向右偏移（毫米，负数向左）
            <input type="number" step="0.5" name="offsetX" [(ngModel)]="settings.offsetX" (change)="saveSettings()">
          </label>
          <label>向下偏移（毫米，负数向上）
            <input type="number" step="0.5" name="offsetY" [(ngModel)]="settings.offsetY" (change)="saveSettings()">
          </label>
        </div>
        <p class="muted">这些设置只保存在这台电脑的浏览器里。打印出来位置不对时，先打一张，用尺量出偏差，再填到偏移里。</p>
      </details>

      <h2>打印预览（实际尺寸）</h2>
    </div>

    <div class="preview">
      <!-- 2mm shorter than the paper: a sheet that is exactly page-high can spill onto a second, blank fold. -->
      <section class="sheet" [style.height]="'calc(' + paper().height + 'in - 2mm)'"
               [style.padding-left.mm]="13 + (settings.offsetX || 0)" [style.padding-top.mm]="6 + (settings.offsetY || 0)">
        <h1>{{ settings.company }}更换配件清单</h1>
        <div class="line">
          <span>录单日期：<u>{{ dateText() }}</u></span>
          <span>单据编号：<u>{{ bill.no }}</u></span>
        </div>
        <div class="line">
          <span>经手人：<u>{{ bill.handler }}</u></span>
          <span>使用单位：<u>{{ bill.customer }}</u></span>
        </div>
        <div class="line">
          <span>开户银行：<u>{{ settings.bank }}</u></span>
          <span>附加说明：配件更换完毕即结算（{{ bill.settle ? '√' : '　' }}）</span>
        </div>
        <div class="line">
          <span>银行账号：<u>{{ settings.account }}</u>　户名：<u>{{ settings.holder }}</u></span>
          <span class="indent">配件保修半年，易损件除外（{{ bill.warranty ? '√' : '　' }}）</span>
        </div>

        <table>
          <colgroup><col style="width: 8%"><col style="width: 34%"><col style="width: 22%"><col style="width: 10%"><col style="width: 12%"><col style="width: 14%"></colgroup>
          <thead><tr><th>序号</th><th>配件名称</th><th>单位（梯号）</th><th>数量</th><th>单价</th><th>金额</th></tr></thead>
          <tbody>
            @for (r of formRows(); track $index; let i = $index) {
              <tr>
                <td class="c">{{ numberOf(i) }}</td>
                <td>{{ r.name }}</td>
                <td>{{ r.unit }}</td>
                <td class="c">{{ r.qty === null ? '' : numText(r.qty) + r.qtyUnit }}</td>
                <td class="c">{{ r.price === null ? '' : numText(r.price) + '元' }}</td>
                <td class="c">{{ amountText(r) }}</td>
              </tr>
            }
            <tr><td></td><td></td><td></td><td class="c">合计</td><td></td><td class="c">￥{{ numText(total()) }}元</td></tr>
          </tbody>
        </table>

        <div class="upper">金额大写：￥<u>{{ upper() }}</u></div>
        <div class="signs">
          <span>出仓领件人：<u class="blank">{{ bill.picker }}</u></span>
          <span>维修安装员：<u class="blank">{{ bill.installer }}</u></span>
          <span>使用单位收货人：<u class="blank">{{ bill.receiver }}</u></span>
        </div>
        <div class="copies">
          <span>一式三份：第一联存根（白）</span><span>第二联交顾客（红）</span><span>第三联记帐（黄）</span><span>电话：{{ settings.phone }}</span>
        </div>
      </section>
    </div>
  `,
  styles: `
    .buttons { display: flex; gap: 8px; flex-wrap: wrap; }
    h1 small { font-size: 12px; font-weight: normal; margin-left: 8px; }
    dialog.history { width: min(100%, 820px); }
    .search { display: flex; gap: 8px; margin-bottom: 12px; }
    .search input { flex: 1; padding: 7px 9px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--text); }
    .history .r { text-align: right; }
    .history menu { align-items: center; }
    .history menu span { margin-right: auto; }
    .problem { color: var(--danger); }
    .fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0 16px; }
    .fields fieldset { grid-column: span 2; }
    select { display: block; width: 100%; margin-top: 4px; padding: 7px 9px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--text); font: inherit; }
    table.entry td { padding: 3px 4px; }
    table.entry input { width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--text); }
    table.entry th:nth-child(1) { width: 48px; }
    table.entry th:nth-child(4), table.entry th:nth-child(5) { width: 90px; }
    table.entry th:nth-child(6), table.entry th:nth-child(7) { width: 120px; }
    table.entry .amount { text-align: right; }
    details { margin: 16px 0; padding: 12px; border: 1px solid var(--border); border-radius: 6px; }
    summary { cursor: pointer; margin-bottom: 8px; }
    .preview { overflow-x: auto; padding-bottom: 16px; }

    /* ---- The sheet: millimetres and points only, so the screen preview equals the print. ----
       Dot-matrix rules: pure black on white, no greys; a Song typeface at 10.5pt or larger;
       lines 0.35mm thick (thinner lines drop out at 180 dpi). */
    .sheet {
      box-sizing: border-box; width: 9.5in; overflow: hidden;
      padding-right: 13mm; /* the tractor-feed strips take about 12.7mm on each side */
      background: #fff; color: #000; border: 1px dashed #999;
      font: 10.5pt/1 SimSun, '宋体', 'Songti SC', STSong, serif;
    }
    .sheet h1 { margin: 0 0 2mm; font-size: 16pt; font-weight: bold; text-align: center; letter-spacing: 0.5mm; }
    .sheet .line { display: grid; grid-template-columns: 58% 42%; height: 6mm; align-items: center; white-space: nowrap; }
    .sheet .indent { padding-left: 5em; }
    .sheet u { text-underline-offset: 0.8mm; }
    /* A signature space: drawn as a border, because an empty <u> has no underline. */
    .sheet u.blank { display: inline-block; min-width: 24mm; min-height: 1em; padding-bottom: 0.8mm; text-align: center; text-decoration: none; border-bottom: 0.35mm solid #000; }
    .sheet table { width: 100%; margin-top: 1mm; border-collapse: collapse; table-layout: fixed; border: 0; background: none; }
    .sheet th, .sheet td { height: 7mm; padding: 0 1mm; border: 0.35mm solid #000; color: #000; font-weight: normal; white-space: nowrap; overflow: hidden; }
    .sheet th, .sheet td.c { text-align: center; }
    .sheet .upper { height: 7mm; display: flex; align-items: center; justify-content: flex-end; padding-right: 20mm; }
    .sheet .signs, .sheet .copies { display: flex; justify-content: space-between; align-items: center; height: 8mm; }
    .sheet .copies { height: 6mm; }

    @media print {
      .preview { overflow: visible; padding: 0; }
      .sheet { border: 0; }
    }
  `,
})
export class PartsBill {
  papers = PAPERS;
  paperKeys = Object.keys(PAPERS) as PaperKey[];
  numText = num;

  private http = inject(HttpClient);
  private notify = inject(NotifyService);
  // The form binds to plain objects, not signals. The app is zoneless, so after changing them
  // in an async callback the view must be told to refresh.
  private view = inject(ChangeDetectorRef);
  private historyDialog = viewChild.required<ElementRef<HTMLDialogElement>>('history');

  canWrite = inject(AuthService).has('bill.write');
  busy = signal(false);
  settings = this.loadSettings();
  bill = this.blankBill();

  // History dialog state.
  q = '';
  page = 1;
  list = signal<{ items: BillSummary[]; total: number; pageSize: number }>({ items: [], total: 0, pageSize: 20 });
  pages() { return Math.max(1, Math.ceil(this.list().total / this.list().pageSize)); }
  // A signal copy of settings.paper, so the @page effect below re-runs when the paper changes.
  private paperKey = signal(this.settings.paper);

  constructor() {
    // The browser takes the paper size from @page, which cannot be bound in a template.
    this.suggestNo();
    const style = document.createElement('style');
    document.head.appendChild(style);
    effect(onCleanup => {
      style.textContent = `@page { size: 9.5in ${PAPERS[this.paperKey()].height}in; margin: 0; }`;
      onCleanup(() => (style.textContent = ''));
    });
  }

  paper() { return PAPERS[this.settings.paper] ?? PAPERS.half; }
  formRows() { return this.bill.rows.slice(0, this.paper().rows); }

  /** Rows are numbered only when they are an item (have a quantity or price), like the paper original. */
  numberOf(i: number) {
    const rows = this.bill.rows;
    const isItem = (r: Row) => r.qty !== null || r.price !== null;
    return isItem(rows[i]) ? rows.slice(0, i + 1).filter(isItem).length : '';
  }

  amount(r: Row) { return r.qty !== null && r.price !== null ? r.qty * r.price : null; }
  amountText(r: Row) { const a = this.amount(r); return a === null ? '' : num(a) + '元'; }
  total() { return this.bill.rows.reduce((sum, r) => sum + (this.amount(r) ?? 0), 0); }
  upper() { return rmbUpper(this.total()); }

  dateText() {
    const [y, m, d] = this.bill.date.split('-').map(Number);
    return y ? `${y}年${m}月${d}日` : '';
  }

  /** Why printing is blocked, or '' when the sheet is ready. */
  problem() {
    if (!this.settings.company) return '请先在“打印设置”里填写公司名称。';
    if (this.bill.rows.some(r => (r.qty ?? 0) < 0 || (r.price ?? 0) < 0)) return '数量和单价不能是负数。';
    // shortcut: one sheet per bill, no continuation page; add paging if bills outgrow one sheet.
    const hidden = this.bill.rows.slice(this.paper().rows).some(r => !isEmpty(r));
    return hidden ? `当前纸张只能打印 ${this.paper().rows} 行，后面还有已填写的行。请换用整张纸或删掉多余的行。` : '';
  }

  print() { window.print(); }

  /** Saves the bill (create or update). Returns false when the server refused it; the interceptor shows why. */
  async save(): Promise<boolean> {
    const { id, rows, ...fields } = this.bill;
    let used = rows.length; // keep blank lines between items, drop the trailing ones
    while (used > 0 && isEmpty(rows[used - 1])) used--;
    const body = { ...fields, rows: rows.slice(0, used) };
    this.busy.set(true);
    try {
      if (id) await firstValueFrom(this.http.put(`/api/parts-bills/${id}`, body));
      else this.bill.id = (await firstValueFrom(this.http.post<{ id: number }>('/api/parts-bills', body))).id;
    } catch { return false; }
    finally { this.busy.set(false); }
    this.view.markForCheck();
    this.notify.success('单据已保存。');
    return true;
  }

  /** Printing always saves first, so every printed bill is in the history. */
  async saveAndPrint() {
    if (await this.save()) this.print();
  }

  newBill() {
    if (!this.discardOk()) return;
    this.bill = this.blankBill();
    this.suggestNo();
  }

  /** Asks the server for the next free number of the bill's date. Only for a bill that is not saved yet. */
  suggestNo() {
    if (this.bill.id || !this.canWrite || !this.bill.date) return;
    const bill = this.bill;
    this.http.get<{ no: string }>('/api/parts-bills/next-no', { params: { date: bill.date } })
      .subscribe({ next: r => { bill.no = r.no; this.view.markForCheck(); }, error: () => { /* keep the local guess; the interceptor showed the error */ } });
  }

  openHistory() {
    this.historyDialog().nativeElement.showModal();
    this.loadHistory(1);
  }

  loadHistory(page: number) {
    this.page = page;
    this.http.get<{ items: BillSummary[]; total: number; pageSize: number }>('/api/parts-bills', { params: { q: this.q, page } })
      .subscribe(r => this.list.set(r));
  }

  async open(id: number) {
    if (!this.discardOk()) return;
    let saved: Bill;
    try { saved = await firstValueFrom(this.http.get<Bill>(`/api/parts-bills/${id}`)); } catch { return; }
    // The form always has MAX_ROWS lines; the server stores only the used ones.
    const rows = [...saved.rows, ...Array.from({ length: MAX_ROWS - saved.rows.length }, blankRow)];
    this.bill = { ...this.blankBill(), ...saved, rows };
    this.view.markForCheck();
    this.historyDialog().nativeElement.close();
  }

  /** A bill that was never saved and has content would be lost: ask first. */
  private discardOk() {
    const unsaved = !this.bill.id && (this.bill.customer || this.bill.rows.some(r => !isEmpty(r)));
    return !unsaved || confirm('当前单据还没有保存，确定放弃吗？');
  }

  saveSettings() {
    this.paperKey.set(this.settings.paper);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* private window: settings last until reload */ }
  }

  private loadSettings(): typeof DEFAULT_SETTINGS {
    try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') }; }
    catch { return { ...DEFAULT_SETTINGS }; }
  }

  private blankBill(): Bill {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const ymd = [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())];
    return {
      id: 0, // 0 = not saved yet
      date: ymd.join('-'),
      no: ymd.join('') + '01', // a local guess; suggestNo() replaces it with the server's next free number
      handler: '', customer: '', picker: '', installer: '', receiver: '',
      settle: true, warranty: false,
      rows: Array.from({ length: MAX_ROWS }, blankRow),
    };
  }
}
