import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth';

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="shell">
      <aside>
        <strong class="brand">ERP</strong>
        <nav>
          @for (item of nav; track item.path) {
            @if (!item.perm || auth.has(item.perm)) {
              <a [routerLink]="item.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">{{ item.label }}</a>
            }
          }
        </nav>
        <div class="me">
          <span>{{ auth.me()?.displayName }}</span>
          <button (click)="auth.logout()">退出登录</button>
        </div>
      </aside>
      <main><router-outlet /></main>
    </div>
  `,
})
export class Shell {
  protected auth = inject(AuthService);
  // The menu is the child routes of this shell, so a new page is added in one place: app.routes.ts.
  protected nav = (inject(ActivatedRoute).routeConfig?.children ?? [])
    .filter(r => r.data?.['label'])
    .map(r => ({ path: '/' + r.path, label: r.data!['label'] as string, perm: r.data!['perm'] as string | undefined }));
}
