import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { NotifyService } from '../core/notify';

@Component({
  imports: [FormsModule],
  template: `
    <header class="page-head"><h1>修改密码</h1></header>
    <form class="card" ngNativeValidate (ngSubmit)="save()">
      <label>当前密码 <input name="current" type="password" [(ngModel)]="current" required autocomplete="current-password"></label>
      <label>新密码 <input name="next" type="password" [(ngModel)]="next" required minlength="8" autocomplete="new-password"></label>
      <label>确认新密码 <input name="confirm" type="password" [(ngModel)]="confirm" required minlength="8" autocomplete="new-password"></label>
      <button class="primary" [disabled]="busy()">保存</button>
    </form>
  `,
})
export class Password {
  private http = inject(HttpClient);
  private notify = inject(NotifyService);
  current = '';
  next = '';
  confirm = '';
  busy = signal(false);

  async save() {
    if (this.next !== this.confirm) { this.notify.error('两次输入的新密码不一致。'); return; }
    this.busy.set(true);
    try {
      // The server signs out this user's other sessions and gives this browser a new cookie.
      await firstValueFrom(this.http.post('/api/auth/password', { currentPassword: this.current, newPassword: this.next }));
      this.current = this.next = this.confirm = '';
      this.notify.success('密码已修改，其他设备上的登录已退出。');
    } catch { /* the interceptor already showed the error */ }
    finally { this.busy.set(false); }
  }
}
