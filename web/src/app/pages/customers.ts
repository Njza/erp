import { HttpClient } from '@angular/common/http';
import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { NotifyService } from '../core/notify';

export interface Customer { id: number; name: string }

@Component({
  imports: [FormsModule],
  template: `
    <header class="page-head">
      <h1>客户管理</h1>
      <button class="primary" (click)="open()">新建客户</button>
    </header>

    <label>搜索 <input type="search" name="q" [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="输入客户名称"></label>

    <table>
      <thead><tr><th>客户名称（使用单位）</th><th></th></tr></thead>
      <tbody>
        @for (c of shown(); track c.id) {
          <tr>
            <td>{{ c.name }}</td>
            <td class="actions">
              <button (click)="open(c)">编辑</button>
              <button (click)="remove(c)">删除</button>
            </td>
          </tr>
        } @empty {
          <tr><td colspan="2" class="muted">{{ customers().length ? '没有匹配的客户。' : '还没有客户。' }}</td></tr>
        }
      </tbody>
    </table>
    <p class="muted">共 {{ customers().length }} 个客户。</p>

    <dialog #dialog>
      <form ngNativeValidate (ngSubmit)="save()">
        <h2>{{ form.id ? '编辑客户' : '新建客户' }}</h2>
        <label>客户名称 <input name="name" [(ngModel)]="form.name" required maxlength="100"></label>
        <menu>
          <button type="button" (click)="dialog.close()">取消</button>
          <button class="primary">保存</button>
        </menu>
      </form>
    </dialog>
  `,
})
export class Customers {
  private http = inject(HttpClient);
  private notify = inject(NotifyService);
  private dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  customers = signal<Customer[]>([]);
  q = signal('');
  shown = computed(() => {
    const term = this.q().trim().toLowerCase();
    return term ? this.customers().filter(c => c.name.toLowerCase().includes(term)) : this.customers();
  });
  form = { id: 0, name: '' };

  constructor() { this.load(); }

  load() { this.http.get<Customer[]>('/api/customers').subscribe(c => this.customers.set(c)); }

  open(c?: Customer) {
    this.form = c ? { ...c } : { id: 0, name: '' };
    this.dialog().nativeElement.showModal();
  }

  async save() {
    const { id, name } = this.form;
    const request = id ? this.http.put(`/api/customers/${id}`, { name }) : this.http.post('/api/customers', { name });
    try { await firstValueFrom(request); } catch { return; } // the interceptor already showed the error
    this.dialog().nativeElement.close();
    this.notify.success('客户已保存。');
    this.load();
  }

  async remove(c: Customer) {
    if (!confirm(`确定删除客户“${c.name}”吗？已保存的单据不受影响。`)) return;
    try { await firstValueFrom(this.http.delete(`/api/customers/${c.id}`)); } catch { return; }
    this.notify.success('客户已删除。');
    this.load();
  }
}
