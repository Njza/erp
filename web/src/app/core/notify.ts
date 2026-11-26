import { Injectable, signal } from '@angular/core';

export interface Toast { id: number; kind: 'success' | 'error'; text: string }

/** The one way to show a message to the user. Rendered by App. */
@Injectable({ providedIn: 'root' })
export class NotifyService {
  readonly toasts = signal<Toast[]>([]);
  private nextId = 1;

  success(text: string) { this.show('success', text, 4000); }
  error(text: string) { this.show('error', text, 8000); }

  dismiss(id: number) { this.toasts.update(list => list.filter(t => t.id !== id)); }

  private show(kind: Toast['kind'], text: string, ms: number) {
    // The same error from several parallel requests is shown once.
    if (this.toasts().some(t => t.kind === kind && t.text === text)) return;
    const id = this.nextId++;
    this.toasts.update(list => [...list, { id, kind, text }]);
    setTimeout(() => this.dismiss(id), ms);
  }
}
