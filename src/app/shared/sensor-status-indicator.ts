import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { SensorService } from '../core/services/sensor.service';

/**
 * Small pill showing the live sensor WebSocket connection status, with a
 * Reconnect button when the link is down. Reads {@link SensorService} directly
 * so it can be dropped onto any screen without wiring.
 */
@Component({
  selector: 'app-sensor-status-indicator',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let status = sensor.status();
    <div
      class="flex items-center gap-2 rounded-full bg-slate-900/80 px-3 py-2 shadow-lg ring-1 ring-white/10 backdrop-blur"
    >
      <span
        class="h-2.5 w-2.5 rounded-full"
        [class.bg-emerald-400]="status === 'connected'"
        [class.bg-amber-400]="status === 'connecting'"
        [class.animate-pulse]="status === 'connecting'"
        [class.bg-red-500]="status === 'error'"
        [class.bg-slate-500]="status === 'disconnected'"
      ></span>
      <span class="text-xs font-semibold uppercase tracking-widest text-slate-300">
        @switch (status) {
          @case ('connected') { Sensors live }
          @case ('connecting') { Connecting… }
          @case ('error') { Cannot reach sensors }
          @default { Sensors disconnected }
        }
      </span>
      @if (status === 'error' || status === 'disconnected') {
        <button
          type="button"
          (click)="sensor.reconnect()"
          class="ml-1 flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-orange-300 transition hover:bg-white/20 active:scale-95"
        >
          <i class="pi pi-refresh text-xs"></i>
          Reconnect
        </button>
      }
    </div>
  `,
})
export class SensorStatusIndicator {
  protected readonly sensor = inject(SensorService);
}
