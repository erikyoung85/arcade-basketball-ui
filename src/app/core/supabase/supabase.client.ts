import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { Database } from '../../../../database.types';

/**
 * Thin singleton wrapper around the Supabase JS SDK.
 *
 * Exposes `client` (the typed SupabaseClient) and `isConfigured` so feature
 * services can decide whether to persist remotely or fall back to in-memory
 * behaviour when credentials are not yet set.
 */
@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly isConfigured: boolean = Boolean(
    environment.supabaseUrl && environment.supabasePublishableKey,
  );

  readonly client: SupabaseClient<Database> | null = this.isConfigured
    ? createClient<Database>(environment.supabaseUrl, environment.supabasePublishableKey, {
        db: { schema: 'arcade_basketball' },
      })
    : null;
}
