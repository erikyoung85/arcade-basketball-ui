import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { MqttService } from '../core/services/mqtt.service';

/**
 * Small pill showing the live MQTT broker connection status, with a Reconnect
 * button when the link is down. Reads {@link MqttService} directly so it can be
 * dropped onto any screen without wiring.
 */
@Component({
  selector: 'app-mqtt-status-indicator',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let status = mqtt.status();
    <div
      class="flex items-center gap-2 rounded-full bg-slate-900/80 px-3 py-2 shadow-lg ring-1 ring-white/10 backdrop-blur"
    >
      <span
        class="h-2.5 w-2.5 rounded-full"
        [class.bg-emerald-400]="status === 'connected'"
        [class.bg-amber-400]="status === 'connecting'"
        [class.animate-pulse]="status === 'connecting'"
        [class.bg-red-500]="status === 'error' || status === 'no-sensor'"
        [class.bg-slate-500]="status === 'disconnected'"
      ></span>
      <span class="text-xs font-semibold uppercase tracking-widest text-slate-300">
        @switch (status) {
          @case ('connected') { Sensors live }
          @case ('connecting') { Connecting… }
          @case ('no-sensor') { Cannot detect sensors }
          @case ('error') { Broker unreachable }
          @default { Broker disconnected }
        }
      </span>
      <!-- Only a broker-connection failure is recoverable from here; a missing
           sensor reply is the sensor's problem, not the broker link's. -->
      @if (status === 'error' || status === 'disconnected') {
        <button
          type="button"
          (click)="mqtt.reconnect()"
          class="ml-1 flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-orange-300 transition hover:bg-white/20 active:scale-95"
        >
          <i class="pi pi-refresh text-xs"></i>
          Reconnect
        </button>
      }
    </div>
  `,
})
export class MqttStatusIndicator {
  protected readonly mqtt = inject(MqttService);
}
