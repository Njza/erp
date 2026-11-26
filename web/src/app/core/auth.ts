import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Route, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { NotifyService } from './notify';

export interface Me { id: number; username: string; displayName: string; permissions: string[] }

const TOKEN_KEY = 'erp.token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  // shortcut: token in localStorage, readable by any script on the page;
  // move to an HttpOnly cookie if third-party scripts are ever added.
  readonly token = signal(localStorage.getItem(TOKEN_KEY));
  readonly me = signal<Me | null>(null);

  /** Hides UI only. The server checks every request again. */
  has(permission: string) { return this.me()?.permissions.includes(permission) ?? false; }

  async login(username: string, password: string) {
    const res = await firstValueFrom(this.http.post<{ token: string }>('/api/auth/login', { username, password }));
    localStorage.setItem(TOKEN_KEY, res.token);
    this.token.set(res.token);
    await this.loadMe();
  }

  async loadMe() { this.me.set(await firstValueFrom(this.http.get<Me>('/api/auth/me'))); }

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    this.token.set(null);
    this.me.set(null);
    this.router.navigateByUrl('/login');
  }
}

/** Requires a signed-in user and, when the route has data.perm, that permission. */
export const authGuard: CanActivateFn = async route => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.token()) return router.parseUrl('/login');
  if (!auth.me()) {
    try { await auth.loadMe(); } catch { return router.parseUrl('/login'); }
  }
  const allowed = (r: Route | ActivatedRouteSnapshot) => !r.data?.['perm'] || auth.has(r.data['perm']);
  if (allowed(route)) return true;
  // Not allowed here: go to the first menu page this user may open.
  const first = route.parent?.routeConfig?.children?.find(r => r.data?.['label'] && allowed(r));
  if (first) return router.parseUrl('/' + first.path);
  inject(NotifyService).error('您的账号还没有任何页面的访问权限，请联系管理员。');
  auth.logout();
  return false;
};
