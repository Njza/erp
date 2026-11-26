import { Routes } from '@angular/router';
import { authGuard } from './core/auth';
import { Shell } from './pages/shell';

// A child route with data.label appears in the side menu; data.perm guards the route and hides the menu item.
export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login').then(m => m.Login) },
  {
    path: '', component: Shell, canActivate: [authGuard], canActivateChild: [authGuard],
    children: [
      { path: '', loadComponent: () => import('./pages/home').then(m => m.Home), data: { label: '首页' } },
      { path: 'users', loadComponent: () => import('./pages/users').then(m => m.Users), data: { label: '用户管理', perm: 'user.read' } },
      { path: 'roles', loadComponent: () => import('./pages/roles').then(m => m.Roles), data: { label: '角色管理', perm: 'role.read' } },
    ],
  },
  { path: '**', redirectTo: '' },
];
