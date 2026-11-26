import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { ErrorHandler, Injectable, inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth';
import { NotifyService } from './notify';

/** Adds the token, and shows every API error as a toast. Pages do not show HTTP errors themselves. */
export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const notify = inject(NotifyService);
  const token = auth.token();
  if (token) req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });

  return next(req).pipe(catchError((e: HttpErrorResponse) => {
    if (e.status === 401 && !req.url.endsWith('/auth/login')) {
      auth.logout();
      notify.error('登录已失效，请重新登录。');
    } else {
      notify.error(messageOf(e));
    }
    return throwError(() => e);
  }));
};

/** Reads the server's ProblemDetails: field errors first, then title. */
function messageOf(e: HttpErrorResponse): string {
  if (e.status === 0) return '无法连接服务器，请检查网络后重试。';
  const fieldErrors = Object.values<string[]>(e.error?.errors ?? {}).flat().join('');
  return fieldErrors || e.error?.title || `请求失败（${e.status}）。`;
}

/** Catches errors that are not HTTP errors (bugs in the page), so the user is never left with silence. */
@Injectable()
export class AppErrorHandler implements ErrorHandler {
  private notify = inject(NotifyService);
  handleError(error: unknown) {
    console.error(error);
    if (!(error instanceof HttpErrorResponse)) this.notify.error('页面出错了，请刷新后重试。');
  }
}
