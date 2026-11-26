import { HttpClient } from '@angular/common/http';
import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { NotifyService } from '../core/notify';

export interface Product { id: number; name: string; unit: string }

@Component({
  imports: [FormsModule],
  template: `
    <header class="page-head">
      <h1>产品管理</h1>
      <button class="primary" (click)="open()">新建产品</button>
    </header>

    <label>搜索 <input type="search" name="q" [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="输入产品名称"></label>

    <table>
      <thead><tr><th>产品名称</th><th>单位</th><th></th></tr></thead>
      <tbody>
        @for (p of shown(); track p.id) {
          <tr>
            <td>{{ p.name }}</td>
            <td>{{ p.unit }}</td>
            <td class="actions">
              <button (click)="open(p)">编辑</button>
              <button (click)="remove(p)">删除</button>
            </td>
          </tr>
        } @empty {
          <tr><td colspan="3" class="muted">{{ products().length ? '没有匹配的产品。' : '还没有产品。' }}</td></tr>
        }
      </tbody>
    </table>
    <p class="muted">共 {{ products().length }} 个产品。产品不带价格，价格在每张单据上填写。在单据上填了这里没有的配件，保存单据时会自动加进来。</p>

    <dialog #dialog>
      <form ngNativeValidate (ngSubmit)="save()">
        <h2>{{ form.id ? '编辑产品' : '新建产品' }}</h2>
        <label>产品名称 <input name="name" [(ngModel)]="form.name" required maxlength="100"></label>
        <label>单位 <input name="unit" [(ngModel)]="form.unit" required maxlength="10" placeholder="台、个、条…"></label>
        <menu>
          <button type="button" (click)="dialog.close()">取消</button>
          <button class="primary">保存</button>
        </menu>
      </form>
    </dialog>
  `,
})
export class Products {
  private http = inject(HttpClient);
  private notify = inject(NotifyService);
  private dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  products = signal<Product[]>([]);
  q = signal('');
  shown = computed(() => {
    const term = this.q().trim().toLowerCase();
    return term ? this.products().filter(p => p.name.toLowerCase().includes(term)) : this.products();
  });
  form = { id: 0, name: '', unit: '' };

  constructor() { this.load(); }

  load() { this.http.get<Product[]>('/api/products').subscribe(p => this.products.set(p)); }

  open(p?: Product) {
    this.form = p ? { ...p } : { id: 0, name: '', unit: '' };
    this.dialog().nativeElement.showModal();
  }

  async save() {
    const { id, name, unit } = this.form;
    const request = id ? this.http.put(`/api/products/${id}`, { name, unit }) : this.http.post('/api/products', { name, unit });
    try { await firstValueFrom(request); } catch { return; } // the interceptor already showed the error
    this.dialog().nativeElement.close();
    this.notify.success('产品已保存。');
    this.load();
  }

  async remove(p: Product) {
    if (!confirm(`确定删除产品“${p.name}”吗？\n它不再出现在提示里，已保存的单据不受影响。以后再用到这个名称时会自动恢复。`)) return;
    try { await firstValueFrom(this.http.delete(`/api/products/${p.id}`)); } catch { return; }
    this.notify.success('产品已删除。');
    this.load();
  }
}
