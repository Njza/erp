import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth';

@Component({
  imports: [FormsModule],
  template: `
    <main class="login">
      <form class="card" ngNativeValidate (ngSubmit)="submit()">
        <h1>ERP</h1>
        <label>用户名 <input name="username" [(ngModel)]="username" required autocomplete="username" autofocus></label>
        <label>密码 <input name="password" type="password" [(ngModel)]="password" required autocomplete="current-password"></label>
        <button class="primary" [disabled]="busy()">{{ busy() ? '登录中…' : '登录' }}</button>
      </form>
    </main>
  `,
})
export class Login {
  private auth = inject(AuthService);
  private router = inject(Router);
  username = '';
  password = '';
  busy = signal(false);

  async submit() {
    this.busy.set(true);
    try {
      await this.auth.login(this.username, this.password);
      this.router.navigateByUrl('/');
    } catch { /* the interceptor already showed the error */ }
    finally { this.busy.set(false); }
  }
}
