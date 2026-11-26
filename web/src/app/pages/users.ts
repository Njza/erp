import { HttpClient } from '@angular/common/http';
import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../core/auth';
import { NotifyService } from '../core/notify';

interface User { id: number; username: string; displayName: string; isActive: boolean; roleIds: number[] }
interface Role { id: number; name: string }

@Component({
  imports: [FormsModule],
  template: `
    <header class="page-head">
      <h1>用户管理</h1>
      @if (canWrite) { <button class="primary" (click)="open()">新建用户</button> }
    </header>

    <table>
      <thead><tr><th>用户名</th><th>姓名</th><th>角色</th><th>状态</th><th></th></tr></thead>
      <tbody>
        @for (u of users(); track u.id) {
          <tr>
            <td>{{ u.username }}</td>
            <td>{{ u.displayName }}</td>
            <td>{{ roleNames(u) }}</td>
            <td>{{ u.isActive ? '启用' : '停用' }}</td>
            <td class="actions">@if (canWrite) { <button (click)="open(u)">编辑</button> }</td>
          </tr>
        }
      </tbody>
    </table>

    <dialog #dialog>
      <form ngNativeValidate (ngSubmit)="save()">
        <h2>{{ form.id ? '编辑用户' : '新建用户' }}</h2>
        <label>用户名
          <input name="username" [(ngModel)]="form.username" [disabled]="!!form.id" required pattern="[A-Za-z0-9._\\-]{3,50}"
                 title="3-50 位字母、数字、“.”、“_”或“-”">
        </label>
        <label>姓名 <input name="displayName" [(ngModel)]="form.displayName" required maxlength="100"></label>
        <label>{{ form.id ? '新密码（留空则不修改）' : '密码' }}
          <input name="password" type="password" [(ngModel)]="form.password" [required]="!form.id" minlength="8" autocomplete="new-password">
        </label>
        @if (form.id) {
          <label class="check"><input name="isActive" type="checkbox" [(ngModel)]="form.isActive"> 启用</label>
        }
        @if (roles().length) {
          <fieldset>
            <legend>角色</legend>
            @for (r of roles(); track r.id) {
              <label class="check">
                <input type="checkbox" [checked]="form.roleIds.includes(r.id)" (change)="toggleRole(r.id)"> {{ r.name }}
              </label>
            }
          </fieldset>
        }
        <menu>
          <button type="button" (click)="dialog.close()">取消</button>
          <button class="primary">保存</button>
        </menu>
      </form>
    </dialog>
  `,
})
export class Users {
  private http = inject(HttpClient);
  private notify = inject(NotifyService);
  private auth = inject(AuthService);
  private dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  canWrite = this.auth.has('user.write');
  users = signal<User[]>([]);
  roles = signal<Role[]>([]);
  form = this.blank();

  constructor() {
    this.load();
    // Without role.read the role list stays empty; saving then keeps the user's current roles.
    if (this.auth.has('role.read')) this.http.get<Role[]>('/api/roles').subscribe(r => this.roles.set(r));
  }

  load() { this.http.get<User[]>('/api/users').subscribe(u => this.users.set(u)); }

  roleNames(u: User) {
    return u.roleIds.map(id => this.roles().find(r => r.id === id)?.name ?? `#${id}`).join('、');
  }

  open(u?: User) {
    this.form = u ? { ...u, roleIds: [...u.roleIds], password: '' } : this.blank();
    this.dialog().nativeElement.showModal();
  }

  toggleRole(id: number) {
    const ids = this.form.roleIds;
    this.form.roleIds = ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];
  }

  async save() {
    const { id, username, displayName, isActive, roleIds, password } = this.form;
    const request = id
      ? this.http.put(`/api/users/${id}`, { displayName, isActive, roleIds, password: password || null })
      : this.http.post('/api/users', { username, displayName, password, roleIds });
    try { await firstValueFrom(request); } catch { return; } // the interceptor already showed the error
    this.dialog().nativeElement.close();
    this.notify.success('用户已保存。');
    this.load();
  }

  private blank() {
    return { id: 0, username: '', displayName: '', isActive: true, roleIds: [] as number[], password: '' };
  }
}
