import { Routes } from '@angular/router';
import { authGuard } from './core/auth';
import { Shell } from './shell';

// A child route with data.label appears in the side menu; data.perm guards the route and hides the menu item.
export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./identity/login').then(m => m.Login) },
  {
    path: '', component: Shell, canActivate: [authGuard], canActivateChild: [authGuard],
    children: [
      // The home page. A user without bill.read is sent to the first page they may open (see authGuard).
      { path: '', loadComponent: () => import('./billing/parts-bill').then(m => m.PartsBill), data: { label: '配件清单打印', perm: 'bill.read' } },
      { path: 'products', loadComponent: () => import('./catalog/products').then(m => m.Products), data: { label: '产品管理', perm: 'product.write' } },
      { path: 'customers', loadComponent: () => import('./catalog/names').then(m => m.Customers), data: { label: '客户管理', perm: 'customer.write' } },
      { path: 'staff', loadComponent: () => import('./catalog/names').then(m => m.Staff), data: { label: '人员管理', perm: 'staff.write' } },
      { path: 'users', loadComponent: () => import('./identity/users').then(m => m.Users), data: { label: '用户管理', perm: 'user.read' } },
      { path: 'roles', loadComponent: () => import('./identity/roles').then(m => m.Roles), data: { label: '角色管理', perm: 'role.read' } },
    ],
  },
  { path: '**', redirectTo: '' },
];
