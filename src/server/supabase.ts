import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cachedClient: SupabaseClient | null = null;

export function getSupabaseConfig() {
  const projectId = process.env.SUPABASE_PROJECT_ID || '';
  const url =
    process.env.SUPABASE_URL ||
    (projectId ? `https://${projectId}.supabase.co` : '');
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || '';
  const secretKey = process.env.SUPABASE_SECRET_KEY || '';

  return {
    projectId,
    url,
    publishableKey,
    hasSecretKey: Boolean(secretKey),
    configured: Boolean(url && (secretKey || publishableKey)),
  };
}

export function getSupabaseClient(): SupabaseClient | null {
  const cfg = getSupabaseConfig();
  const key = process.env.SUPABASE_SECRET_KEY || cfg.publishableKey;
  if (!cfg.url || !key) return null;

  if (!cachedClient) {
    cachedClient = createClient(cfg.url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return cachedClient;
}

export interface SupabaseAppointmentPayload {
  booking_ref: string;
  patient_name: string;
  patient_phone: string;
  patient_email?: string | null;
  treatment_name: string;
  dentist_name: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  status: string;
  notes?: string;
  consent_accepted?: boolean;
}

export async function syncAppointmentToSupabase(
  appt: SupabaseAppointmentPayload
): Promise<{ synced: boolean; code?: string; message?: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { synced: false, code: 'NOT_CONFIGURED', message: 'Supabase credentials not set.' };
  }

  try {
    const { error } = await supabase.from('appointments').insert(
      {
        booking_ref: appt.booking_ref,
        patient_name: appt.patient_name,
        patient_phone: appt.patient_phone,
        patient_email: appt.patient_email || null,
        treatment_name: appt.treatment_name,
        dentist_name: appt.dentist_name,
        appointment_date: appt.appointment_date,
        start_time: appt.start_time,
        end_time: appt.end_time,
        duration_minutes: appt.duration_minutes,
        status: appt.status || 'Pending',
        notes: appt.notes || '',
        consent_accepted: appt.consent_accepted !== false,
      },
      { count: undefined }
    );

    if (error) {
      return {
        synced: false,
        code: error.code,
        message: error.message,
      };
    }

    return { synced: true };
  } catch (err) {
    return {
      synced: false,
      code: 'NETWORK_ERROR',
      message: err instanceof Error ? err.message : 'Supabase insert failed',
    };
  }
}

export interface SupabaseAppointmentRow {
  id: number;
  booking_ref: string;
  patient_name: string;
  patient_phone: string;
  patient_email: string | null;
  treatment_name: string;
  dentist_name: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  status: string;
  notes: string | null;
  consent_accepted: boolean;
  created_at: string;
  updated_at?: string;
}

export async function fetchAppointmentsFromSupabase(): Promise<{
  accessible: boolean;
  rows: SupabaseAppointmentRow[];
  reason?: string;
}> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { accessible: false, rows: [], reason: 'Supabase is not configured.' };
  }

  try {
    const { data, error } = await supabase
      .from('appointments')
      .select('*')
      .order('appointment_date', { ascending: false })
      .order('start_time', { ascending: true })
      .limit(500);

    if (error) {
      if (error.code === '42501' || error.message.toLowerCase().includes('permission')) {
        return {
          accessible: false,
          rows: [],
          reason:
            'Supabase table has INSERT-only RLS active for the publishable key. Add SUPABASE_SECRET_KEY in .env (or grant SELECT/UPDATE) to read & sync edits from Supabase directly.',
        };
      }
      if (error.code === 'PGRST205') {
        return {
          accessible: false,
          rows: [],
          reason: 'Table public.appointments was not found in Supabase.',
        };
      }
      return { accessible: false, rows: [], reason: error.message };
    }

    return {
      accessible: true,
      rows: (data as SupabaseAppointmentRow[]) || [],
    };
  } catch (err) {
    return {
      accessible: false,
      rows: [],
      reason: err instanceof Error ? err.message : 'Unable to query Supabase',
    };
  }
}

export async function updateAppointmentInSupabase(
  bookingRef: string,
  updates: {
    patient_name?: string;
    patient_phone?: string;
    patient_email?: string | null;
    treatment_name?: string;
    dentist_name?: string;
    appointment_date?: string;
    start_time?: string;
    end_time?: string;
    duration_minutes?: number;
    status?: string;
    notes?: string;
  }
): Promise<{ synced: boolean; message?: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { synced: false, message: 'Supabase not configured.' };

  try {
    const { error } = await supabase
      .from('appointments')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('booking_ref', bookingRef);

    if (error) {
      return { synced: false, message: error.message };
    }
    return { synced: true };
  } catch (err) {
    return { synced: false, message: err instanceof Error ? err.message : 'Update failed' };
  }
}

export async function checkSupabaseStatus(): Promise<{
  configured: boolean;
  projectId: string;
  url: string;
  schemaReady: boolean;
  hasSecretKey: boolean;
  statusMessage: string;
}> {
  const cfg = getSupabaseConfig();
  if (!cfg.configured) {
    return {
      configured: false,
      projectId: cfg.projectId,
      url: cfg.url,
      schemaReady: false,
      hasSecretKey: false,
      statusMessage: 'Not configured',
    };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      configured: false,
      projectId: cfg.projectId,
      url: cfg.url,
      schemaReady: false,
      hasSecretKey: cfg.hasSecretKey,
      statusMessage: 'Client init failed',
    };
  }

  try {
    // Minimal GET select accurately detects PGRST205 when public.appointments is not yet created
    const { error } = await supabase
      .from('appointments')
      .select('id')
      .limit(1);

    if (error) {
      if (error.code === 'PGRST205') {
        return {
          configured: true,
          projectId: cfg.projectId,
          url: cfg.url,
          schemaReady: false,
          hasSecretKey: cfg.hasSecretKey,
          statusMessage: 'Connected to project — run SQL migration to create public.appointments table',
        };
      }
      // 42501 / RLS policy block on SELECT is expected & healthy when anon key has INSERT-only access!
      if (error.code === '42501' || error.message.toLowerCase().includes('permission')) {
        return {
          configured: true,
          projectId: cfg.projectId,
          url: cfg.url,
          schemaReady: true,
          hasSecretKey: cfg.hasSecretKey,
          statusMessage: 'Connected & schema ready (RLS INSERT-only active)',
        };
      }
      return {
        configured: true,
        projectId: cfg.projectId,
        url: cfg.url,
        schemaReady: false,
        hasSecretKey: cfg.hasSecretKey,
        statusMessage: error.message,
      };
    }

    return {
      configured: true,
      projectId: cfg.projectId,
      url: cfg.url,
      schemaReady: true,
      hasSecretKey: cfg.hasSecretKey,
      statusMessage: 'Connected & schema ready',
    };
  } catch (err) {
    return {
      configured: true,
      projectId: cfg.projectId,
      url: cfg.url,
      schemaReady: false,
      hasSecretKey: cfg.hasSecretKey,
      statusMessage: err instanceof Error ? err.message : 'Connection error',
    };
  }
}
