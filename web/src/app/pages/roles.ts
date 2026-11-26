import { HttpClient } from '@angular/common/http';
import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../core/auth';
import { NotifyService } from '../core/notify';

interface Role { id: number; name: string; permissions: string[] }
const BUILT_IN = 'admin'; // the server keeps this role read-only

// Display names for the permission codes in api/Auth/Auth.cs. A code without an entry is shown as the code.
const PERM_LABELS: Record<string, string> = {
  'user.read': '查看用户',
  'user.write': '管理用户',
  'role.read': '查看角色',
  'role.write': '管理角色',
  'bill.read': '查看配件清单',
  'bill.write': '填写配件清单',
  'product.write': '管理产品',
};

@Component({
  imports: [FormsModule],
  template: `
    <header class="page-head">
      <h1>角色管理</h1>
      @if (canWrite) { <button class="primary" (click)="open()">新建角色</button> }
    </header>

    <table>
      <thead><tr><th>角色</th><th>权限</th><th></th></tr></thead>
      <tbody>
        @for (r of roles(); track r.id) {
          <tr>
            <td>{{ r.name }}</td>
            <td>{{ labels(r.permissions) || '—' }}</td>
            <td class="actions">
              @if (canWrite && r.name !== builtIn) {
                <button (click)="open(r)">编辑</button>
                <button (click)="remove(r)">删除</button>
              }
            </td>
          </tr>
        }
      </tbody>
    </table>

    <dialog #dialog>
      <form ngNativeValidate (ngSubmit)="save()">
        <h2>{{ form.id ? '编辑角色' : '新建角色' }}</h2>
        <label>名称 <input name="name" [(ngModel)]="form.name" required maxlength="50"></label>
        <fieldset>
          <legend>权限</legend>
          @for (p of permissions(); track p) {
            <label class="check">
              <input type="checkbox" [checked]="form.permissions.includes(p)" (change)="toggle(p)"> {{ label(p) }}
            </label>
          }
        </fieldset>
        <menu>
          <button type="button" (click)="dialog.close()">取消</button>
          <button class="primary">保存</button>
        </menu>
      </form>
    </dialog>
  `,
})
export class Roles {
  private http = inject(HttpClient);
  private notify = inject(NotifyService);
  private dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  builtIn = BUILT_IN;
  canWrite = inject(AuthService).has('role.write');
  roles = signal<Role[]>([]);
  permissions = signal<string[]>([]);
  form = this.blank();

  constructor() {
    this.load();
    this.http.get<string[]>('/api/permissions').subscribe(p => this.permissions.set(p));
  }

  label(code: string) { return PERM_LABELS[code] ?? code; }
  labels(codes: string[]) { return codes.map(c => this.label(c)).join('、'); }

  load() { this.http.get<Role[]>('/api/roles').subscribe(r => this.roles.set(r)); }

  open(r?: Role) {
    this.form = r ? { ...r, permissions: [...r.permissions] } : this.blank();
    this.dialog().nativeElement.showModal();
  }

  toggle(p: string) {
    const list = this.form.permissions;
    this.form.permissions = list.includes(p) ? list.filter(x => x !== p) : [...list, p];
  }

  async save() {
    const { id, name, permissions } = this.form;
    const request = id ? this.http.put(`/api/roles/${id}`, { name, permissions }) : this.http.post('/api/roles', { name, permissions });
    try { await firstValueFrom(request); } catch { return; } // the interceptor already showed the error
    this.dialog().nativeElement.close();
    this.notify.success('角色已保存。');
    this.load();
  }

  async remove(r: Role) {
    if (!confirm(`确定删除角色“${r.name}”吗？此操作无法撤销。`)) return;
    try { await firstValueFrom(this.http.delete(`/api/roles/${r.id}`)); } catch { return; }
    this.notify.success('角色已删除。');
    this.load();
  }

  private blank() {
    return { id: 0, name: '', permissions: [] as string[] };
  }
}
