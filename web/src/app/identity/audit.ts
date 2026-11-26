import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

interface Entry { id: number; at: string; action: string; entity: string; entityId: string; changes: string; user: string | null }
interface Page { items: Entry[]; total: number; pageSize: number }

const ENTITIES: Record<string, string> = {
  PartsBill: '单据', User: '用户', Role: '角色', RoleUser: '用户的角色', Product: '产品', NameOption: '客户/人员',
};
const ACTIONS: Record<string, string> = { Added: '新建', Modified: '修改', Deleted: '删除' };

@Component({
  imports: [FormsModule, DatePipe],
  template: `
    <header class="page-head"><h1>操作日志</h1></header>
    <form class="filters" (ngSubmit)="load(1)">
      <select name="entity" [(ngModel)]="entity">
        <option value="">全部类型</option>
        @for (e of entityKeys; track e) { <option [value]="e">{{ entities[e] }}</option> }
      </select>
      <input name="entityId" [(ngModel)]="entityId" placeholder="记录 ID">
      <button>查询</button>
    </form>

    <table class="scroll">
      <thead><tr><th>时间</th><th>操作人</th><th>操作</th><th>类型</th><th>记录 ID</th><th>内容</th></tr></thead>
      <tbody>
        @for (a of page().items; track a.id) {
          <tr>
            <td>{{ a.at | date: 'yyyy-MM-dd HH:mm:ss' }}</td>
            <td>{{ a.user ?? '—' }}</td>
            <td>{{ actions[a.action] ?? a.action }}</td>
            <td>{{ entities[a.entity] ?? a.entity }}</td>
            <td>{{ a.entityId }}</td>
            <td><code>{{ a.changes }}</code></td>
          </tr>
        }
      </tbody>
    </table>

    <footer class="pager">
      <button [disabled]="current() <= 1" (click)="load(current() - 1)">上一页</button>
      <span>第 {{ current() }} / {{ pages() }} 页，共 {{ page().total }} 条</span>
      <button [disabled]="current() >= pages()" (click)="load(current() + 1)">下一页</button>
    </footer>
  `,
})
export class Audit {
  private http = inject(HttpClient);
  protected entities = ENTITIES;
  protected entityKeys = Object.keys(ENTITIES);
  protected actions = ACTIONS;
  entity = '';
  entityId = '';
  page = signal<Page>({ items: [], total: 0, pageSize: 50 });
  current = signal(1);
  pages = () => Math.max(1, Math.ceil(this.page().total / this.page().pageSize));

  constructor() { this.load(1); }

  load(n: number) {
    const params = { entity: this.entity, entityId: this.entityId, page: n };
    this.http.get<Page>('/api/audit', { params }).subscribe(p => { this.page.set(p); this.current.set(n); });
  }
}
