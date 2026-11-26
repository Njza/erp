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
      <!-- One slim bar across the top, so pages get the full width. Account and update controls sit in a popover. -->
      <header>
        <strong class="brand">ERP</strong>
        <nav>
          @for (item of nav; track item.path) {
            @if (!item.perm || auth.has(item.perm)) {
              <a [routerLink]="item.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">{{ item.label }}</a>
            }
          }
        </nav>
        <button class="me-btn" popovertarget="me-menu" [class.dot]="newVersion()">{{ auth.me()?.displayName }} ▾</button>
        <div id="me-menu" class="me" popover #menu>
          <a routerLink="/password" (click)="menu.hidePopover()">修改密码</a>
          <span class="muted">版本 {{ version() }}</span>
          <button (click)="checkUpdate(true)">检查更新</button>
          <label class="check"><input type="checkbox" [(ngModel)]="autoCheck" (ngModelChange)="setAutoCheck($event)"> 自动检查更新</label>
          <button (click)="auth.logout()">退出登录</button>
        </div>
      </header>
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
    header { display: flex; align-items: center; gap: 16px; padding: 0 16px; background: var(--surface); border-bottom: 1px solid var(--border); }
    nav { display: flex; flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: none; }
    nav a { padding: 10px 12px; white-space: nowrap; color: var(--text); text-decoration: none; border-bottom: 2px solid transparent; }
    nav a.active { color: var(--accent); font-weight: 600; border-bottom-color: var(--accent); }
    .me-btn { white-space: nowrap; border: 0; background: none; color: var(--muted); }
    .me-btn.dot::after { content: ' ●'; color: var(--accent); } /* a new version is waiting */
    .me { inset: 46px 12px auto auto; margin: 0; padding: 12px; min-width: 180px; flex-direction: column; gap: 8px;
          border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); box-shadow: 0 4px 14px rgb(0 0 0 / .18); }
    .me:popover-open { display: flex; }
    .me a { color: var(--accent); }
    @media (max-width: 640px) {
      header { gap: 4px; padding: 0 4px; }
      .brand { display: none; }
      .me-btn { max-width: 6em; overflow: hidden; text-overflow: ellipsis; padding: 6px; } /* the menu keeps the room */
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
    .filter(r => r.data?.['label'] && !r.data['account'])
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
