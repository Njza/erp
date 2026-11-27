import { HttpClient } from '@angular/common/http';
import { Component, ElementRef, OnInit, computed, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth';
import { firstValueFrom } from 'rxjs';
import { NotifyService } from '../core/notify';

interface NameOption { id: number; name: string }
interface BillSummary { id: number; no: string; date: string; customer: string; handler: string; total: number; printCount: number }

/** One editable list of names from /api/names/<kind>: add, rename, search, delete. */
@Component({
  selector: 'app-name-list',
  imports: [FormsModule],
  template: `
    <header class="page-head">
      <h1>{{ title() }}</h1>
      <button class="primary" (click)="open()">新建{{ noun() }}</button>
    </header>

    <label>搜索 <input type="search" [name]="kind() + 'Q'" [ngModel]="q()" (ngModelChange)="q.set($event)" [placeholder]="'输入' + noun() + '名称'"></label>

    <table>
      <thead><tr><th>{{ noun() }}名称</th><th></th></tr></thead>
      <tbody>
        @for (n of shown(); track n.id) {
          <tr>
            <td>{{ n.name }}</td>
            <td class="actions">
              @if (canSeeBills) {
                <button (click)="openHistory(n.name)">历史单据</button>
              }
              <button (click)="open(n)">编辑</button>
              <button (click)="remove(n)">删除</button>
            </td>
          </tr>
        } @empty {
          <tr><td colspan="2" class="muted">{{ names().length ? '没有匹配的' + noun() + '。' : '还没有' + noun() + '。' }}</td></tr>
        }
      </tbody>
    </table>
    <p class="muted">共 {{ names().length }} 个。在单据上填了这里没有的名称，保存单据时会自动加进来。</p>

    <dialog #history class="history">
      <h2>{{ historyName }} 的历史单据</h2>
      <table class="scroll">
        <thead><tr><th>单据编号</th><th>日期</th><th>使用单位</th><th>经手人</th><th class="r">合计</th><th>打印</th><th></th></tr></thead>
        <tbody>
          @for (b of bills().items; track b.id) {
            <tr>
              <td>{{ b.no }}</td><td>{{ b.date }}</td><td>{{ b.customer }}</td><td>{{ b.handler }}</td>
              <td class="r">{{ +b.total.toFixed(2) }}</td>
              <td [class.unprinted]="!b.printCount">{{ b.printCount ? '已打印 ' + b.printCount + ' 次' : '未打印' }}</td>
              <td class="actions"><button (click)="router.navigate(['/'], { queryParams: { bill: b.id } })">{{ canEditBills ? '修改' : '打开' }}</button></td>
            </tr>
          } @empty {
            <tr><td colspan="7" class="muted">没有单据。</td></tr>
          }
        </tbody>
      </table>
      <menu>
        <span class="muted">共 {{ bills().total }} 张，第 {{ page }} / {{ pages() }} 页</span>
        <button type="button" [disabled]="page <= 1" (click)="loadHistory(page - 1)">上一页</button>
        <button type="button" [disabled]="page >= pages()" (click)="loadHistory(page + 1)">下一页</button>
        <button type="button" (click)="history.close()">关闭</button>
      </menu>
    </dialog>

    <dialog #dialog>
      <form ngNativeValidate (ngSubmit)="save()">
        <h2>{{ form.id ? '编辑' : '新建' }}{{ noun() }}</h2>
        <label>{{ noun() }}名称 <input name="name" [(ngModel)]="form.name" required maxlength="100"></label>
        <menu>
          <button type="button" (click)="dialog.close()">取消</button>
          <button class="primary">保存</button>
        </menu>
      </form>
    </dialog>
  `,
  styles: `
    :host { display: block; margin-bottom: 32px; }
    dialog.history { width: min(100%, 860px); }
    .history .r { text-align: right; }
    .history .unprinted { color: var(--danger); }
    .history menu { align-items: center; }
    .history menu span { margin-right: auto; }
  `,
})
export class NameList implements OnInit {
  kind = input.required<'customer' | 'handler' | 'installer'>();
  title = input.required<string>();
  noun = input.required<string>(); // 客户, 经手人, 维修安装员

  private http = inject(HttpClient);
  private notify = inject(NotifyService);
  private dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  canSeeBills = inject(AuthService).has('bill.read');
  canEditBills = inject(AuthService).has('bill.write');
  router = inject(Router);
  private historyDialog = viewChild.required<ElementRef<HTMLDialogElement>>('history');
  // shortcut: the server search matches any part of the number, customer, handler or installer,
  // so a name inside a longer name also lists that one's bills; add exact-name filters if it confuses people.
  historyName = '';
  page = 1;
  bills = signal<{ items: BillSummary[]; total: number; pageSize: number }>({ items: [], total: 0, pageSize: 20 });
  pages() { return Math.max(1, Math.ceil(this.bills().total / this.bills().pageSize)); }
  names = signal<NameOption[]>([]);
  q = signal('');
  shown = computed(() => {
    const term = this.q().trim().toLowerCase();
    return term ? this.names().filter(n => n.name.toLowerCase().includes(term)) : this.names();
  });
  form = { id: 0, name: '' };

  private get url() { return `/api/names/${this.kind()}`; }

  ngOnInit() { this.load(); } // inputs are not set yet in the constructor

  load() { this.http.get<NameOption[]>(this.url).subscribe(n => this.names.set(n)); }

  openHistory(name: string) {
    this.historyName = name;
    this.bills.set({ items: [], total: 0, pageSize: 20 });
    this.historyDialog().nativeElement.showModal();
    this.loadHistory(1);
  }

  loadHistory(page: number) {
    this.page = page;
    this.http.get<{ items: BillSummary[]; total: number; pageSize: number }>('/api/parts-bills', { params: { q: this.historyName, page } })
      .subscribe(r => this.bills.set(r));
  }

  open(n?: NameOption) {
    this.form = n ? { ...n } : { id: 0, name: '' };
    this.dialog().nativeElement.showModal();
  }

  async save() {
    const { id, name } = this.form;
    const request = id ? this.http.put(`${this.url}/${id}`, { name }) : this.http.post(this.url, { name });
    try { await firstValueFrom(request); } catch { return; } // the interceptor already showed the error
    this.dialog().nativeElement.close();
    this.notify.success(`${this.noun()}已保存。`);
    this.load();
  }

  async remove(n: NameOption) {
    if (!confirm(`确定删除${this.noun()}“${n.name}”吗？\n它不再出现在提示里，已保存的单据不受影响。以后再用到这个名称时会自动恢复。`)) return;
    try { await firstValueFrom(this.http.delete(`${this.url}/${n.id}`)); } catch { return; }
    this.notify.success(`${this.noun()}已删除。`);
    this.load();
  }
}

@Component({
  imports: [NameList],
  template: `<app-name-list kind="customer" title="客户管理" noun="客户" />`,
})
export class Customers {}

@Component({
  imports: [NameList],
  template: `
    <app-name-list kind="handler" title="经手人" noun="经手人" />
    <app-name-list kind="installer" title="维修安装员" noun="维修安装员" />
  `,
})
export class Staff {}
