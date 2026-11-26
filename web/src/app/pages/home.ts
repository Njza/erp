import { Component, inject } from '@angular/core';
import { AuthService } from '../core/auth';

@Component({
  template: `
    <h1>欢迎，{{ auth.me()?.displayName }}</h1>
    <p class="muted">业务模块添加后会出现在左侧菜单中。</p>
  `,
})
export class Home {
  protected auth = inject(AuthService);
}
