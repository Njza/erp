import { HttpClient } from '@angular/common/http';
import { Component, ElementRef, OnInit, computed, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth';
import { firstValueFrom } from 'rxjs';
import { NotifyService } from '../core/notify';

interface NameOption { id: number; name: string }

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
                <button (click)="router.navigate(['/'], { queryParams: { q: n.name } })">历史单据</button>
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
  styles: `:host { display: block; margin-bottom: 32px; }`,
})
export class NameList implements OnInit {
  kind = input.required<'customer' | 'handler' | 'installer'>();
  title = input.required<string>();
  noun = input.required<string>(); // 客户, 经手人, 维修安装员

  private http = inject(HttpClient);
  private notify = inject(NotifyService);
  private dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  canSeeBills = inject(AuthService).has('bill.read');
  router = inject(Router);
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
