import { HttpClient, HttpContext } from '@angular/common/http';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth';
import { SILENT } from './core/http';
import { NotifyService } from './core/notify';

const AUTO_CHECK_KEY = 'erp.autoUpdateCheck'; // per PC, like the print settings
const AUTO_CHECK_MS = 5 * 60_000;

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FormsModule],
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
          <small>版本 {{ version() }}</small>
          <button (click)="checkUpdate(true)">检查更新</button>
          <label class="check"><input type="checkbox" [(ngModel)]="autoCheck" (ngModelChange)="setAutoCheck($event)"> 自动检查更新</label>
        </div>
      </aside>
      <main>
        @if (newVersion()) {
          <!-- The server already runs the new version; this page is still the old one. -->
          <div class="update no-print" role="alert">
            <span>有新版本 {{ newVersion() }}。请先保存正在编辑的单据，再点“刷新更新”。</span>
            <button class="primary" (click)="reload()">刷新更新</button>
          </div>
        }
        <router-outlet />
      </main>
    </div>
  `,
  styles: `
    .update { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; justify-content: space-between;
              margin-bottom: 16px; padding: 10px 12px; border: 1px solid var(--accent); border-radius: 6px; background: var(--surface); }
    /* Top bar on tablets and phones: the account and update controls on one line, the menu on its own line below. */
    @media (max-width: 900px) {
      aside { flex-wrap: wrap; }
      nav { order: 1; flex-basis: 100%; }
      .me { flex-wrap: wrap; white-space: nowrap; }
    }
  `,
})
export class Shell {
  protected auth = inject(AuthService);
  private http = inject(HttpClient);
  private notify = inject(NotifyService);
  protected version = signal(''); // the version this page was loaded with
  protected newVersion = signal(''); // set when the server runs a different one
  protected autoCheck = readAutoCheck();
  private timer = 0;
  // The menu is the child routes of this shell, so a new page is added in one place: app.routes.ts.
  protected nav = (inject(ActivatedRoute).routeConfig?.children ?? [])
    .filter(r => r.data?.['label'])
    .map(r => ({ path: '/' + r.path, label: r.data!['label'] as string, perm: r.data!['perm'] as string | undefined }));

  constructor() {
    this.http.get<{ version: string }>('/api/version').subscribe(v => this.version.set(v.version));
    this.setAutoCheck(this.autoCheck);
    inject(DestroyRef).onDestroy(() => clearInterval(this.timer));
  }

  /** Web and API are deployed together, so a changed API version means this page's code is old. */
  checkUpdate(manual: boolean) {
    this.http.get<{ version: string }>('/api/version', { context: new HttpContext().set(SILENT, !manual) }).subscribe(v => {
      if (this.version() && v.version !== this.version()) this.newVersion.set(v.version);
      else if (manual) this.notify.success(`已是最新版本 ${v.version}。`);
    });
  }

  setAutoCheck(on: boolean) {
    try { localStorage.setItem(AUTO_CHECK_KEY, on ? '1' : '0'); } catch { /* private window: the choice lasts this visit */ }
    clearInterval(this.timer);
    if (on) this.timer = window.setInterval(() => this.checkUpdate(false), AUTO_CHECK_MS);
  }

  /** A page with unsaved edits asks before it is left (its beforeunload handler). */
  reload() { location.reload(); }
}

function readAutoCheck() {
  try { return localStorage.getItem(AUTO_CHECK_KEY) !== '0'; } catch { return true; } // on unless turned off
}
