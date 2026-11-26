import { Component, ElementRef, effect, inject, viewChild } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NotifyService } from './core/notify';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `
    <router-outlet />
    <!-- Click a toast to dismiss it. -->
    <div #toasts class="toasts" popover="manual">
      @for (t of notify.toasts(); track t.id) {
        <button class="toast" [class.error]="t.kind === 'error'" [attr.role]="t.kind === 'error' ? 'alert' : 'status'"
                (click)="notify.dismiss(t.id)">{{ t.text }}</button>
      }
    </div>
  `,
})
export class App {
  protected notify = inject(NotifyService);
  private toasts = viewChild.required<ElementRef<HTMLElement>>('toasts');

  constructor() {
    // A modal <dialog> covers everything below the top layer. Re-opening the popover
    // on each change puts the toasts above a dialog that opened in the meantime.
    effect(() => {
      const el = this.toasts().nativeElement;
      el.hidePopover();
      if (this.notify.toasts().length) el.showPopover();
    });
  }
}
