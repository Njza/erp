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
      { path: 'parts-bill', loadComponent: () => import('./pages/parts-bill').then(m => m.PartsBill), data: { label: '配件清单打印', perm: 'bill.read' } },
      { path: 'products', loadComponent: () => import('./pages/products').then(m => m.Products), data: { label: '产品管理', perm: 'product.write' } },
      { path: 'customers', loadComponent: () => import('./pages/customers').then(m => m.Customers), data: { label: '客户管理', perm: 'customer.write' } },
      { path: 'users', loadComponent: () => import('./pages/users').then(m => m.Users), data: { label: '用户管理', perm: 'user.read' } },
      { path: 'roles', loadComponent: () => import('./pages/roles').then(m => m.Roles), data: { label: '角色管理', perm: 'role.read' } },
    ],
  },
  { path: '**', redirectTo: '' },
];
