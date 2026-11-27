import { HttpClient } from '@angular/common/http';
import { ChangeDetectorRef, Component, DestroyRef, ElementRef, afterNextRender, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../core/auth';
import { NotifyService } from '../core/notify';
import type { Product } from '../catalog/products';
import { rmbUpper } from './rmb';

// Continuous paper for dot-matrix printers is 9.5in (241mm) wide; the height is one fold.
// `rows` is how many item lines fit on one sheet with the layout below.
const PAPERS = {
  half: { label: '241 × 140 mm（二等分）', height: 5.5, rows: 7 },
  full: { label: '241 × 280 mm（整张）', height: 11, rows: 26 },
} as const;
type PaperKey = keyof typeof PAPERS;
const MAX_ROWS = PAPERS.full.rows;

const SETTINGS_KEY = 'erp.partsBill.settings';
const HANDLER_KEY = 'erp.partsBill.handler'; // the last 经手人 typed on this PC, offered on the next new bill
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
interface BillSummary { id: number; no: string; date: string; customer: string; handler: string; total: number; printCount: number }

// unit is not looked at: it is not typed per line, it follows the bill's 使用单位.
const isEmpty = (r: Row) => !r.name && r.qty === null && r.price === null;
const blankRow = (): Row => ({ name: '', unit: '', qty: null, qtyUnit: '台', price: null });

function lastHandler() {
  try { return localStorage.getItem(HANDLER_KEY) ?? ''; } catch { return ''; }
}

/** 650 -> "650", 650.5 -> "650.5", 0.125 -> "0.13" */
const num = (n: number) => String(+n.toFixed(2));

@Component({
  imports: [FormsModule],
  host: { '(document:keydown)': 'shortcut($event)', '(window:beforeunload)': 'warnUnload($event)' },
  template: `
    <div class="no-print">
      <header class="page-head bar">
        <h1>更换配件清单 <small [class.warn]="status() !== '已保存'">{{ status() }}</small>
          @if (bill.id) { <small [class.warn]="!printCount()">{{ printText(printCount()) }}</small> }
        </h1>
        <div class="buttons">
          <button (click)="openHistory()">历史记录</button>
          @if (canWrite) {
            <button (click)="newBill()">新建</button>
            <button [disabled]="busy()" (click)="save()" title="快捷键 Ctrl+S">保存</button>
            <button class="primary" [disabled]="busy()" (click)="saveAndPrint()" title="快捷键 Ctrl+P">保存并打印</button>
            <button [disabled]="busy()" (click)="downloadPdf()" title="先保存，再下载这张单据的 PDF">下载PDF</button>
          } @else {
            <button class="primary" [disabled]="!bill.id" (click)="print()" title="快捷键 Ctrl+P">打印</button>
            <button [disabled]="!bill.id || busy()" (click)="downloadPdf()">下载PDF</button>
          }
        </div>
      </header>
      @if (!settings.company) {
        <p class="setup" role="status">第一次在这台电脑上使用：请先在下方“打印设置”里填写公司抬头，之后才能打印。</p>
      }

      <dialog #history class="history">
        <h2>历史记录</h2>
        <form class="search" (ngSubmit)="loadHistory(1)">
          <input name="q" [(ngModel)]="q" placeholder="单据编号、使用单位、经手人或维修安装员" aria-label="搜索单据编号、使用单位、经手人或维修安装员">
          <button>搜索</button>
        </form>
        <table class="scroll">
          <thead><tr><th>单据编号</th><th>日期</th><th>使用单位</th><th>经手人</th><th class="r">合计</th><th>打印</th><th></th></tr></thead>
          <tbody>
            @for (b of list().items; track b.id) {
              <tr>
                <td>{{ b.no }}</td><td>{{ b.date }}</td><td>{{ b.customer }}</td><td>{{ b.handler }}</td>
                <td class="r">{{ numText(b.total) }}</td>
                <td [class.unprinted]="!b.printCount">{{ printText(b.printCount) }}</td>
                <!-- Each action loads the bill into the page first: printing and the PDF use the page's sheet. -->
                <td class="actions">
                  <button (click)="open(b.id)">{{ canWrite ? '修改' : '打开' }}</button>
                  <button (click)="openThen(b.id, 'print')">打印</button>
                  <button [disabled]="busy()" (click)="openThen(b.id, 'pdf')">下载PDF</button>
                </td>
              </tr>
            } @empty {
              <tr><td colspan="7" class="muted">没有单据。</td></tr>
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
    </div>

    <!-- On a wide screen the form and the preview sit side by side, so each edit shows at once. -->
    <div class="layout">
    <div class="no-print form">
      <!-- The form follows the order a bill is written in. Enter moves to the next box, like Tab. -->
      <div class="steps" (keydown.enter)="nextField($event)">
        <section>
          <h2>1. 单据信息</h2>
          <div class="fields">
            <label class="wide">使用单位
              <input enterkeyhint="next" #first name="customer" [(ngModel)]="bill.customer" list="customer-list" autocomplete="off" placeholder="输入几个字，从客户库里选">
            </label>
            <label>录单日期 <input enterkeyhint="next" type="date" name="date" [(ngModel)]="bill.date" (change)="suggestNo()"></label>
            <label>单据编号 <input enterkeyhint="next" name="no" [(ngModel)]="bill.no"></label>
            <label>经手人 <input enterkeyhint="next" name="handler" [(ngModel)]="bill.handler" list="handler-list" autocomplete="off"></label>
          </div>
        </section>

        <section>
          <h2>2. 配件明细 <small class="muted">按 Enter 跳到下一格。选中产品后自动带出单位，数量默认为 1。打印时“单位（梯号）”一栏就是使用单位。</small></h2>
          <table class="entry">
            <thead><tr><th>序号</th><th>配件名称</th><th>数量</th><th>单位</th><th>单价（元）</th><th>金额</th><th></th></tr></thead>
            <tbody>
              @for (r of formRows(); track $index; let i = $index) {
                <tr [class.spare]="i > usedRows()">
                  <td class="no">{{ i + 1 }}</td>
                  <td data-label="配件名称"><input enterkeyhint="next" [name]="'name' + i" [(ngModel)]="r.name" (ngModelChange)="pickProduct(r, $event)" list="product-list"
                             autocomplete="off" [attr.aria-label]="'第' + (i + 1) + '行配件名称'"></td>
                  <td data-label="数量"><input enterkeyhint="next" type="number" min="0" step="any" [name]="'qty' + i" [(ngModel)]="r.qty" [attr.aria-label]="'第' + (i + 1) + '行数量'"></td>
                  <td data-label="单位"><input enterkeyhint="next" [name]="'qtyUnit' + i" [(ngModel)]="r.qtyUnit" [attr.aria-label]="'第' + (i + 1) + '行数量单位'"></td>
                  <td data-label="单价（元）"><input enterkeyhint="next" type="number" min="0" step="any" [name]="'price' + i" [(ngModel)]="r.price" [attr.aria-label]="'第' + (i + 1) + '行单价'"></td>
                  <td class="amount" data-label="金额">{{ amountText(r) }}</td>
                  <td class="del">
                    @if (!rowEmpty(r)) {
                      <button type="button" class="x" tabindex="-1" (click)="removeRow(i)" title="删除这一行，下面的行上移"
                              [attr.aria-label]="'删除第' + (i + 1) + '行'">×</button>
                    }
                  </td>
                </tr>
              }
            </tbody>
            <tfoot>
              <tr><td colspan="7" class="amount">合计：<strong>￥{{ numText(total()) }} 元</strong>　{{ upper() }}</td></tr>
            </tfoot>
          </table>
          <p class="muted">库里没有的使用单位、经手人、维修安装员和配件都可以直接输入，保存单据时会自动加入各自的库，下次就有提示。只填名称的一行会原样打印，可用来写配件编号，不会加入产品库。</p>
        </section>

        <section>
          <h2>3. 签字与说明</h2>
          <div class="fields">
            <label>维修安装员 <input enterkeyhint="next" name="installer" [(ngModel)]="bill.installer" list="installer-list" autocomplete="off"></label>
            <label>出仓领件人 <input enterkeyhint="next" name="picker" [(ngModel)]="bill.picker" placeholder="可留空，打印后手签"></label>
            <label>使用单位收货人 <input enterkeyhint="next" name="receiver" [(ngModel)]="bill.receiver" placeholder="可留空，打印后手签"></label>
            <fieldset>
              <legend>附加说明</legend>
              <label class="check"><input type="checkbox" name="settle" [(ngModel)]="bill.settle"> 配件更换完毕即结算</label>
              <label class="check"><input type="checkbox" name="warranty" [(ngModel)]="bill.warranty"> 配件保修半年，易损件除外</label>
            </fieldset>
          </div>
        </section>
      </div>

      <!-- The browser's own suggestion lists: they filter as the user types. -->
      <datalist id="product-list">
        @for (p of products(); track p.id) { <option [value]="p.name">{{ p.unit }}</option> }
      </datalist>
      <datalist id="handler-list">
        @for (h of handlers(); track h) { <option [value]="h"></option> }
      </datalist>
      <datalist id="installer-list">
        @for (n of installers(); track n) { <option [value]="n"></option> }
      </datalist>
      <datalist id="customer-list">
        @for (c of customers(); track c) { <option [value]="c"></option> }
      </datalist>

      <details [open]="setupOpen">
        <summary>打印设置（公司抬头、纸张、位置校准）</summary>
        <div class="fields">
          <label>公司名称 <input name="company" [(ngModel)]="settings.company" (change)="saveSettings()"></label>
          <label>开户银行 <input name="bank" [(ngModel)]="settings.bank" (change)="saveSettings()"></label>
          <label>银行账号 <input name="account" [(ngModel)]="settings.account" (change)="saveSettings()"></label>
          <label>户名 <input name="holder" [(ngModel)]="settings.holder" (change)="saveSettings()"></label>
          <label>电话 <input name="phone" [(ngModel)]="settings.phone" (change)="saveSettings()"></label>
          <label class="wide">纸张
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
    </div>

    <div class="side">
      <h2 class="no-print">打印预览 <small class="muted">{{ zoom() < 1 ? '屏幕较窄，已缩小显示；打印仍是实际尺寸' : '实际尺寸' }}</small></h2>

    <div #preview class="preview">
      <!-- 2mm shorter than the paper: a sheet that is exactly page-high can spill onto a second, blank fold. -->
      <section class="sheet" [class.flat]="capturing()" [style.zoom]="capturing() ? 1 : zoom()" [style.height]="'calc(' + paper().height + 'in - 2mm)'"
               [style.padding-left.mm]="13 + (capturing() ? 0 : settings.offsetX || 0)" [style.padding-top.mm]="6 + (capturing() ? 0 : settings.offsetY || 0)">
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
                <td>{{ isItem(r) ? bill.customer : '' }}</td>
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
    </div>
    </div>
  `,
  styles: `
    .buttons { display: flex; gap: 8px; flex-wrap: wrap; }
    h1 small, h2 small { font-size: 12px; font-weight: normal; margin-left: 8px; }
    dialog.history { width: min(100%, 980px); } /* room for three buttons per row */
    .search { display: flex; gap: 8px; margin-bottom: 12px; }
    .search input { flex: 1; padding: 7px 9px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--text); }
    .history .r { text-align: right; }
    .history .unprinted { color: var(--danger); }
    .history menu { align-items: center; }
    .history menu span { margin-right: auto; }
    /* The action bar stays in view while the form scrolls. */
    .bar { position: sticky; top: 0; z-index: 5; margin: -12px 0 12px; padding: 12px 0; background: var(--bg); align-items: center; }
    .bar h1 { margin: 0; }
    h1 small.warn { color: var(--danger); }
    .setup { padding: 10px 12px; border: 1px solid var(--accent); border-radius: 6px; }
    .steps section { margin-bottom: 16px; padding: 16px 16px 4px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
    .steps h2 small { font-size: 12px; font-weight: normal; margin-left: 8px; }
    .fields .wide { grid-column: span 2; }
    table.entry { border: 0; }
    table.entry tfoot td { padding: 10px 12px; border-bottom: 0; }
    table.entry th:last-child { width: 40px; }
    button.x { padding: 2px 8px; border-color: transparent; background: none; color: var(--muted); }
    button.x:hover { color: var(--danger); }
    .fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0 16px; }
    .fields fieldset { grid-column: span 2; }
    select { display: block; width: 100%; margin-top: 4px; padding: 7px 9px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--text); }
    table.entry td { padding: 3px 4px; }
    table.entry input { width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--text); }
    /* Fixed layout: the narrow columns keep their width, and the name column takes the rest. */
    table.entry { table-layout: fixed; }
    table.entry th { white-space: nowrap; }
    table.entry th:nth-child(1) { width: 52px; }
    table.entry th:nth-child(3) { width: 90px; }
    table.entry th:nth-child(4) { width: 80px; }
    table.entry th:nth-child(5) { width: 120px; }
    table.entry th:nth-child(6) { width: 110px; }
    table.entry .amount { text-align: right; }
    details { margin: 16px 0; padding: 12px; border: 1px solid var(--border); border-radius: 6px; }
    summary { cursor: pointer; margin-bottom: 8px; }
    .preview { overflow-x: auto; padding-bottom: 16px; }
    /* Wide enough for the entry table (~680px) and a readable preview beside it. */
    @media screen and (min-width: 1500px) {
      .layout { display: grid; grid-template-columns: minmax(680px, 1fr) minmax(0, 9.5in); gap: 16px; align-items: start; }
      .layout .form details { margin-top: 0; }
      .side { position: sticky; top: 64px; } /* below the sticky action bar */
      .side h2 { margin-top: 0; }
    }

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

    .sheet.flat { border: 0; } /* while the PDF picture is taken */
    @media print {
      .preview { overflow: visible; padding: 0; }
      .sheet { border: 0; zoom: 1 !important; } /* the screen preview may be scaled down; paper never is */
    }

    /* ---- Phone: the actions sit at the bottom edge, and each line of the table becomes a card. ---- */
    @media (max-width: 700px) {
      :host { display: block; padding-bottom: calc(72px + env(safe-area-inset-bottom)); } /* room for the fixed buttons */
      .bar { position: static; margin: 0 0 8px; padding: 0; }
      .bar .buttons {
        position: fixed; z-index: 6; inset: auto 0 0 0; flex-wrap: nowrap;
        padding: 8px 12px calc(8px + env(safe-area-inset-bottom));
        background: var(--surface); border-top: 1px solid var(--border);
      }
      .bar .buttons button { flex: 1; padding-inline: 4px; white-space: nowrap; }
      .steps section { padding: 12px 12px 2px; }
      .fields { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 12px; }

      table.entry, table.entry tbody, table.entry tfoot { display: block; }
      table.entry thead, table.entry tr.spare { display: none; } /* only the used lines and one blank line */
      table.entry tr {
        display: grid; gap: 6px 8px; padding: 10px 0; border-bottom: 1px solid var(--border);
        grid-template-columns: repeat(3, minmax(0, 1fr));
        grid-template-areas: "no no del" "name name name" "qty qunit price" "amount amount amount";
      }
      table.entry td { display: block; padding: 0; border: 0; }
      table.entry td[data-label]::before { content: attr(data-label); display: block; margin-bottom: 2px; font-size: 12px; color: var(--muted); }
      table.entry td.no { grid-area: no; align-self: center; font-weight: 600; }
      table.entry td.no::before { content: "第 "; } table.entry td.no::after { content: " 行"; }
      table.entry td.del { grid-area: del; text-align: right; }
      table.entry td:nth-child(2) { grid-area: name; } table.entry td:nth-child(3) { grid-area: qty; }
      table.entry td:nth-child(4) { grid-area: qunit; } table.entry td:nth-child(5) { grid-area: price; }
      table.entry td.amount { grid-area: amount; }
      table.entry td.amount::before { display: inline; margin-right: 8px; }
      table.entry td.amount:empty { display: none; }
      table.entry tfoot tr { display: block; border-bottom: 0; }
      button.x { min-width: 44px; }
      dialog.history { width: 100%; }
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
  private first = viewChild.required<ElementRef<HTMLInputElement>>('first');
  private preview = viewChild.required<ElementRef<HTMLElement>>('preview');
  zoom = signal(1); // the preview is scaled down when the screen is narrower than the paper
  rowEmpty = isEmpty;

  canWrite = inject(AuthService).has('bill.write');
  busy = signal(false);
  capturing = signal(false); // the sheet shows the plain paper layout: no screen zoom, frame or printer calibration
  printCount = signal(0); // of the open bill
  settings = this.loadSettings();
  setupOpen = !this.settings.company; // decided once: it must not close while the header is being typed
  bill = this.blankBill();
  private savedJson = JSON.stringify(this.bill); // the bill as last saved or loaded, to detect unsaved edits

  products = signal<Product[]>([]);
  // The suggestion lists. A bill that uses a new value adds it on the server, so they are reloaded after each save.
  customers = signal<string[]>([]);
  handlers = signal<string[]>([]);
  installers = signal<string[]>([]);

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
    const destroyRef = inject(DestroyRef);
    // 客户管理 and 人员管理 link here with ?bill=<id> to open that bill.
    const billId = Number(inject(ActivatedRoute).snapshot.queryParamMap.get('bill'));
    afterNextRender(() => {
      this.first().nativeElement.focus();
      if (billId) this.open(billId);
      const sheetWidth = 9.5 * 96; // CSS pixels
      const watcher = new ResizeObserver(([box]) => this.zoom.set(Math.min(1, box.contentRect.width / sheetWidth)));
      watcher.observe(this.preview().nativeElement);
      destroyRef.onDestroy(() => watcher.disconnect());
    });
    this.loadLists();
    const style = document.createElement('style');
    document.head.appendChild(style);
    effect(onCleanup => {
      style.textContent = `@page { size: 9.5in ${PAPERS[this.paperKey()].height}in; margin: 0; }`;
      onCleanup(() => (style.textContent = ''));
    });
  }

  paper() { return PAPERS[this.settings.paper] ?? PAPERS.half; }
  formRows() { return this.bill.rows.slice(0, this.paper().rows); }
  /** How many lines are in use, counted up to the last one that has content. */
  usedRows() {
    let used = this.bill.rows.length;
    while (used > 0 && isEmpty(this.bill.rows[used - 1])) used--;
    return used;
  }

  /** Rows are numbered only when they are an item (have a quantity or price), like the paper original. */
  numberOf(i: number) {
    const rows = this.bill.rows;
    return this.isItem(rows[i]) ? rows.slice(0, i + 1).filter(this.isItem).length : '';
  }

  private loadLists() {
    const names = (kind: string, into: typeof this.customers) =>
      this.http.get<{ name: string }[]>(`/api/names/${kind}`).subscribe(list => into.set(list.map(n => n.name)));
    names('customer', this.customers);
    names('handler', this.handlers);
    names('installer', this.installers);
    this.http.get<Product[]>('/api/products').subscribe(p => this.products.set(p));
  }

  /** A name that is exactly a product's name fills in what usually follows: its unit and quantity 1. */
  pickProduct(r: Row, name: string) {
    const product = this.products().find(p => p.name === name);
    if (!product) return;
    r.qtyUnit = product.unit;
    r.qty ??= 1;
  }

  /** Removes a line; the lines below move up, so the printed bill has no gap. */
  removeRow(i: number) {
    this.bill.rows.splice(i, 1);
    this.bill.rows.push(blankRow());
  }

  /** Enter moves to the next box of the form, like Tab. */
  nextField(e: Event) {
    const box = e.target;
    if (!(box instanceof HTMLInputElement) || box.type === 'checkbox') return;
    e.preventDefault();
    const boxes = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLInputElement>('input:not([type=checkbox])')]
      .filter(b => b.offsetParent !== null); // skip lines that are hidden on a phone
    const next = boxes[boxes.indexOf(box) + 1];
    next?.focus();
    next?.select();
  }

  /** Ctrl/Cmd+S saves. Ctrl/Cmd+P prints through the app, so the bill is saved first and only the sheet is printed. */
  shortcut(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key !== 's' && key !== 'p') return;
    e.preventDefault();
    if (this.busy()) return;
    if (key === 's') { if (this.canWrite) this.save(); }
    else if (this.canWrite) this.saveAndPrint();
    else if (this.bill.id) this.print();
  }

  warnUnload(e: BeforeUnloadEvent) {
    if (this.dirty()) e.preventDefault(); // the browser then asks before closing or reloading
  }

  dirty() { return JSON.stringify(this.bill) !== this.savedJson; }

  status() {
    if (!this.bill.id) return this.dirty() ? '未保存' : '新单据';
    return this.dirty() ? '有未保存的修改' : '已保存';
  }

  /** A line with a quantity or a price is an item; a line with only a name is a note. */
  isItem = (r: Row) => r.qty !== null || r.price !== null;

  amount(r: Row) { return r.qty !== null && r.price !== null ? r.qty * r.price : null; }
  amountText(r: Row) { const a = this.amount(r); return a === null ? '' : num(a) + '元'; }
  total() { return this.bill.rows.reduce((sum, r) => sum + (this.amount(r) ?? 0), 0); }
  upper() { return rmbUpper(this.total()); }

  dateText() {
    const [y, m, d] = this.bill.date.split('-').map(Number);
    return y ? `${y}年${m}月${d}日` : '';
  }

  /** Why the bill cannot be saved, or ''. */
  saveProblem() {
    if (!this.bill.customer.trim()) return '请填写使用单位。';
    if (!this.bill.no.trim()) return '请填写单据编号。';
    if (this.bill.rows.every(isEmpty)) return '请至少填写一行配件。';
    if (this.bill.rows.some(r => (r.qty ?? 0) < 0 || (r.price ?? 0) < 0)) return '数量和单价不能是负数。';
    return '';
  }

  /** Why the sheet cannot be printed, or ''. */
  printProblem() {
    if (!this.settings.company) return '请先在“打印设置”里填写公司名称。';
    // shortcut: one sheet per bill, no continuation page; add paging if bills outgrow one sheet.
    const hidden = this.bill.rows.slice(this.paper().rows).some(r => !isEmpty(r));
    return hidden ? `当前纸张只能打印 ${this.paper().rows} 行，后面还有已填写的行。请换用整张纸或删掉多余的行。` : '';
  }

  print() {
    const problem = this.printProblem();
    if (problem) { this.notify.error(problem); return; }
    window.print();
    // The browser does not say whether the user printed or cancelled the dialog,
    // so this counts every time the bill was sent to the print dialog.
    const id = this.bill.id;
    if (id) this.http.post(`/api/parts-bills/${id}/printed`, null).subscribe(() => {
      if (id === this.bill.id) this.printCount.update(n => n + 1);
    });
  }

  /** Saves first (like printing), then downloads the sheet as a one-page PDF of the paper's size. */
  async downloadPdf() {
    const problem = this.printProblem();
    if (problem) { this.notify.error(problem); return; }
    if (this.canWrite && (this.dirty() || !this.bill.id) && !(await this.save())) return;
    const sheet = this.preview().nativeElement.querySelector<HTMLElement>('.sheet')!;
    const w = 9.5 * 25.4, h = this.paper().height * 25.4 - 2; // mm, as the sheet's CSS size
    const px = (mm: number) => Math.round(mm * 96 / 25.4);
    this.busy.set(true);
    this.capturing.set(true);
    this.view.detectChanges();
    try {
      // Loaded on demand: the two libraries are large and only this button needs them.
      const [{ toPng }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')]);
      // shortcut: the PDF is a 3x picture of the sheet (no selectable text), because embedding a
      // Chinese font in jsPDF costs megabytes; switch to a server-side PDF if text must be searchable.
      const png = await toPng(sheet, { width: px(w), height: px(h), pixelRatio: 3, backgroundColor: '#fff', skipFonts: true });
      const pdf = new jsPDF({ unit: 'mm', format: [w, h], orientation: w > h ? 'l' : 'p', compress: true });
      pdf.addImage(png, 'PNG', 0, 0, w, h, undefined, 'FAST'); // fast compression; without it a 3x sheet is ~13 MB
      pdf.save(`更换配件清单-${this.bill.no || this.bill.date}.pdf`);
    } catch {
      this.notify.error('PDF 生成失败，请重试。');
    } finally { this.busy.set(false); this.capturing.set(false); }
  }

  printText(count: number) { return count ? `已打印 ${count} 次` : '未打印'; }


  /** Saves the bill (create or update). Returns false when the server refused it; the interceptor shows why. */
  async save(): Promise<boolean> {
    const problem = this.saveProblem();
    if (problem) { this.notify.error(problem); return false; }
    const { id, rows, ...fields } = this.bill;
    // Blank lines between items stay, trailing ones go. 单位（梯号） is always the bill's 使用单位, as printed.
    const customer = this.bill.customer.trim();
    const body = { ...fields, rows: rows.slice(0, this.usedRows()).map(r => ({ ...r, unit: this.isItem(r) ? customer : '' })) };
    this.busy.set(true);
    try {
      if (id) await firstValueFrom(this.http.put(`/api/parts-bills/${id}`, body));
      else this.bill.id = (await firstValueFrom(this.http.post<{ id: number }>('/api/parts-bills', body))).id;
    } catch { return false; }
    finally { this.busy.set(false); }
    this.savedJson = JSON.stringify(this.bill);
    this.loadLists(); // the server has just added any new customer, person or part
    try { localStorage.setItem(HANDLER_KEY, this.bill.handler); } catch { /* not remembered in a private window */ }
    this.view.markForCheck();
    this.notify.success('单据已保存。');
    return true;
  }

  /** Printing always saves first, so every printed bill is in the history. */
  async saveAndPrint() {
    const problem = this.printProblem();
    if (problem) { this.notify.error(problem); return; } // before saving, so the user fixes everything in one go
    if (await this.save()) this.print();
  }

  newBill() {
    if (!this.discardOk()) return;
    this.bill = this.blankBill();
    this.savedJson = JSON.stringify(this.bill);
    this.printCount.set(0);
    this.suggestNo();
    this.first().nativeElement.focus();
  }

  /** Asks the server for the next free number of the bill's date. Only for a bill that is not saved yet. */
  suggestNo() {
    if (this.bill.id || !this.canWrite || !this.bill.date) return;
    const bill = this.bill;
    this.http.get<{ no: string }>('/api/parts-bills/next-no', { params: { date: bill.date } })
      .subscribe({ next: r => {
        const clean = bill === this.bill && !this.dirty();
        bill.no = r.no;
        if (clean) this.savedJson = JSON.stringify(bill); // a suggested number is not an edit
        this.view.markForCheck();
      }, error: () => { /* keep the local guess; the interceptor showed the error */ } });
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

  /** Opens a bill from the history, then prints it or downloads its PDF. */
  async openThen(id: number, then: 'print' | 'pdf') {
    if (!(await this.open(id))) return;
    this.view.detectChanges(); // the sheet must show this bill before the print dialog takes its picture
    if (then === 'print') this.print(); else await this.downloadPdf();
  }

  async open(id: number): Promise<boolean> {
    if (!this.discardOk()) return false;
    let saved: Bill, printCount: number;
    try { ({ printCount, ...saved } = await firstValueFrom(this.http.get<Bill & { printCount: number }>(`/api/parts-bills/${id}`))); } catch { return false; }
    // The form always has MAX_ROWS lines; the server stores only the used ones.
    const rows = [...saved.rows, ...Array.from({ length: MAX_ROWS - saved.rows.length }, blankRow)];
    this.bill = { ...this.blankBill(), ...saved, rows };
    this.printCount.set(printCount);
    this.savedJson = JSON.stringify(this.bill);
    this.view.markForCheck();
    this.historyDialog().nativeElement.close();
    return true;
  }

  private discardOk() {
    return !this.dirty() || confirm('当前单据有未保存的内容，确定放弃吗？');
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
      handler: lastHandler(), customer: '', picker: '', installer: '', receiver: '',
      settle: true, warranty: false,
      rows: Array.from({ length: MAX_ROWS }, blankRow),
    };
  }
}
