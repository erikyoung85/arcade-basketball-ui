/**
 * Runtime configuration.
 *
 * Fill in the values from your Supabase project:
 *   Supabase Dashboard → Project Settings → API
 *     - Project URL          → supabaseUrl
 *     - Project API key (anon, public) → supabaseAnonKey
 *
 * The anon key is safe to ship in a client bundle as long as Row Level
 * Security is enabled on your tables (see supabase/schema.sql).
 *
 * If these are left blank the app still runs, but games and players are kept
 * only in memory (nothing is persisted). This keeps local development usable
 * before the backend is wired up.
 *
 * `mqttBrokerUrl` points at the local MQTT broker that publishes made-shot
 * events on the `basketball/shots` topic. Browsers can only speak MQTT over
 * WebSockets, so this must be a `ws://` / `wss://` URL — e.g. Mosquitto's
 * default WebSocket listener on port 9001.
 */
export const environment = {
  production: false,
  supabaseUrl: 'https://ulqlllosknuyhjasvtci.supabase.co',
  supabasePublishableKey: 'sb_publishable_ojLGNeAS8kqVw47wCo4ydQ_WBA0xi42',
  mqttBrokerUrl: 'ws://raspberrypi.local/mqtt',
};
