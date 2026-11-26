import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Route, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { NotifyService } from './notify';

export interface Me { id: number; username: string; displayName: string; permissions: string[] }

// The token itself is in an HttpOnly cookie that scripts cannot read. This flag only says
// "try the session", so a visitor who never signed in goes to the login page without an API call.
const SIGNED_IN_KEY = 'erp.signedIn';
localStorage.removeItem('erp.token'); // the token was kept here before it moved to the cookie

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  readonly signedIn = signal(localStorage.getItem(SIGNED_IN_KEY) !== null);
  readonly me = signal<Me | null>(null);

  /** Hides UI only. The server checks every request again. */
  has(permission: string) { return this.me()?.permissions.includes(permission) ?? false; }

  async login(username: string, password: string) {
    await firstValueFrom(this.http.post('/api/auth/login', { username, password }));
    localStorage.setItem(SIGNED_IN_KEY, '1');
    this.signedIn.set(true);
    await this.loadMe();
  }

  async loadMe() { this.me.set(await firstValueFrom(this.http.get<Me>('/api/auth/me'))); }

  logout() {
    this.http.post('/api/auth/logout', null).subscribe({ error: () => {} }); // removes the cookie
    localStorage.removeItem(SIGNED_IN_KEY);
    this.signedIn.set(false);
    this.me.set(null);
    this.router.navigateByUrl('/login');
  }
}

/** Requires a signed-in user and, when the route has data.perm, that permission. */
export const authGuard: CanActivateFn = async route => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.signedIn()) return router.parseUrl('/login');
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
