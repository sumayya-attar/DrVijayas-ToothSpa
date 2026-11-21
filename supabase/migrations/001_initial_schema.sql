-- DrVijayas ToothSpa — Complete PostgreSQL / Supabase Schema Migration
-- Run this script once in your Supabase Dashboard -> SQL Editor

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Admins (RBAC)
CREATE TABLE IF NOT EXISTS public.admins (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'super_admin' CHECK (role IN ('super_admin', 'manager', 'reception')),
  password_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Patients
CREATE TABLE IF NOT EXISTS public.patients (
  id BIGSERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_patients_phone ON public.patients(phone);

-- 3. Dentists
CREATE TABLE IF NOT EXISTS public.dentists (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Dental Practitioner',
  qualifications TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  photo_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Treatments
CREATE TABLE IF NOT EXISTS public.treatments (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  short_description TEXT NOT NULL,
  full_description TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK (duration_minutes IN (15, 30, 45, 60, 90)),
  buffer_minutes INTEGER NOT NULL DEFAULT 10,
  image_url TEXT,
  price_display TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_featured BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Dentist <-> Treatments
CREATE TABLE IF NOT EXISTS public.dentist_treatments (
  dentist_id BIGINT NOT NULL REFERENCES public.dentists(id) ON DELETE CASCADE,
  treatment_id BIGINT NOT NULL REFERENCES public.treatments(id) ON DELETE CASCADE,
  PRIMARY KEY (dentist_id, treatment_id)
);

-- 6. Dentist Schedules
CREATE TABLE IF NOT EXISTS public.dentist_schedules (
  id BIGSERIAL PRIMARY KEY,
  dentist_id BIGINT NOT NULL REFERENCES public.dentists(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  is_working BOOLEAN NOT NULL DEFAULT TRUE,
  start_time TEXT NOT NULL DEFAULT '10:30',
  end_time TEXT NOT NULL DEFAULT '21:30',
  UNIQUE (dentist_id, day_of_week)
);

-- 7. Clinic Hours
CREATE TABLE IF NOT EXISTS public.clinic_hours (
  day_of_week INTEGER PRIMARY KEY CHECK (day_of_week >= 0 AND day_of_week <= 6),
  day_name TEXT NOT NULL,
  is_open BOOLEAN NOT NULL DEFAULT TRUE,
  open_time TEXT NOT NULL DEFAULT '10:30',
  close_time TEXT NOT NULL DEFAULT '21:30',
  slot_interval_minutes INTEGER NOT NULL DEFAULT 15,
  booking_buffer_minutes INTEGER NOT NULL DEFAULT 10
);

-- 8. Blocked Dates & Holidays
CREATE TABLE IF NOT EXISTS public.blocked_dates (
  id BIGSERIAL PRIMARY KEY,
  date DATE NOT NULL,
  dentist_id BIGINT REFERENCES public.dentists(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Appointments (Stores booking form submissions + relational links)
CREATE TABLE IF NOT EXISTS public.appointments (
  id BIGSERIAL PRIMARY KEY,
  booking_ref TEXT NOT NULL UNIQUE,
  patient_id BIGINT REFERENCES public.patients(id) ON DELETE SET NULL,
  treatment_id BIGINT REFERENCES public.treatments(id) ON DELETE SET NULL,
  dentist_id BIGINT REFERENCES public.dentists(id) ON DELETE SET NULL,
  patient_name TEXT NOT NULL,
  patient_phone TEXT NOT NULL,
  patient_email TEXT,
  treatment_name TEXT NOT NULL,
  dentist_name TEXT NOT NULL DEFAULT 'Any Available Dentist',
  appointment_date DATE NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Confirmed', 'Completed', 'Cancelled', 'No-show')),
  notes TEXT DEFAULT '',
  consent_accepted BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent duplicate active bookings for the same dentist, date, and start time
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_unique_active_slot
  ON public.appointments (dentist_name, appointment_date, start_time)
  WHERE status NOT IN ('Cancelled', 'No-show');

-- 10. Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id BIGSERIAL PRIMARY KEY,
  appointment_id BIGINT REFERENCES public.appointments(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  recipient TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'skipped_unconfigured', 'failed')),
  provider_response TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. Testimonials
CREATE TABLE IF NOT EXISTS public.testimonials (
  id BIGSERIAL PRIMARY KEY,
  patient_name TEXT NOT NULL,
  review_text TEXT NOT NULL,
  review_date TEXT DEFAULT '',
  source TEXT NOT NULL DEFAULT 'Google Maps Review',
  rating INTEGER CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. Website Settings
CREATE TABLE IF NOT EXISTS public.website_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 13. Audit Logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id BIGSERIAL PRIMARY KEY,
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==================== ROW LEVEL SECURITY ====================
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dentists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treatments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dentist_treatments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dentist_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocked_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.testimonials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Public read access for non-sensitive clinic catalog & schedules
DROP POLICY IF EXISTS "Public read active treatments" ON public.treatments;
CREATE POLICY "Public read active treatments" ON public.treatments
  FOR SELECT TO anon, authenticated USING (is_active = TRUE);

DROP POLICY IF EXISTS "Public read active dentists" ON public.dentists;
CREATE POLICY "Public read active dentists" ON public.dentists
  FOR SELECT TO anon, authenticated USING (is_active = TRUE);

DROP POLICY IF EXISTS "Public read clinic hours" ON public.clinic_hours;
CREATE POLICY "Public read clinic hours" ON public.clinic_hours
  FOR SELECT TO anon, authenticated USING (TRUE);

DROP POLICY IF EXISTS "Public read published testimonials" ON public.testimonials;
CREATE POLICY "Public read published testimonials" ON public.testimonials
  FOR SELECT TO anon, authenticated USING (is_published = TRUE);

DROP POLICY IF EXISTS "Public read website settings" ON public.website_settings;
CREATE POLICY "Public read website settings" ON public.website_settings
  FOR SELECT TO anon, authenticated USING (TRUE);

-- Table & sequence privileges for Supabase publishable (anon/authenticated) key
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.treatments, public.dentists, public.clinic_hours, public.testimonials, public.website_settings TO anon, authenticated;
GRANT INSERT ON public.appointments TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.appointments_id_seq TO anon, authenticated;

-- Strict INSERT-only policy for online appointment bookings (protects patient PII from public SELECT)
DROP POLICY IF EXISTS "Public create pending appointments" ON public.appointments;
CREATE POLICY "Public create pending appointments" ON public.appointments
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    consent_accepted = TRUE
    AND status = 'Pending'
    AND char_length(trim(patient_name)) >= 2
    AND char_length(trim(patient_phone)) >= 10
  );

-- Seed initial verified clinic hours (Monday to Sunday: 10:30 AM - 9:30 PM)
INSERT INTO public.clinic_hours (day_of_week, day_name, is_open, open_time, close_time, slot_interval_minutes, booking_buffer_minutes)
VALUES
  (0, 'Sunday', TRUE, '10:30', '21:30', 15, 10),
  (1, 'Monday', TRUE, '10:30', '21:30', 15, 10),
  (2, 'Tuesday', TRUE, '10:30', '21:30', 15, 10),
  (3, 'Wednesday', TRUE, '10:30', '21:30', 15, 10),
  (4, 'Thursday', TRUE, '10:30', '21:30', 15, 10),
  (5, 'Friday', TRUE, '10:30', '21:30', 15, 10),
  (6, 'Saturday', TRUE, '10:30', '21:30', 15, 10)
ON CONFLICT (day_of_week) DO NOTHING;

-- Seed verified core treatments
INSERT INTO public.treatments (slug, name, short_description, full_description, duration_minutes, buffer_minutes, sort_order)
VALUES
  ('dental-consultation', 'Dental Consultation', 'Thorough oral evaluation and calm, unhurried discussion of your dental concerns and goals.', 'A dedicated one-on-one consultation to understand your oral health concerns, review your dental history, and outline clear, transparent options tailored to your comfort.', 30, 10, 1),
  ('general-dental-check-up', 'General Dental Check-up', 'Comprehensive routine examination of teeth, gums, and restorations for ongoing oral wellness.', 'Routine preventive examination designed to monitor enamel health, gum condition, and existing dental work early, supporting long-term oral health.', 30, 10, 2),
  ('teeth-cleaning', 'Teeth Cleaning', 'Gentle professional cleaning to remove plaque, surface deposits, and keep your smile fresh.', 'Comfortable clinical teeth cleaning performed with modern hygiene protocols to gently remove everyday plaque buildup and maintain healthy gums.', 45, 10, 3),
  ('scaling-and-polishing', 'Scaling and Polishing', 'Detailed ultrasonic scaling and smooth surface polishing for cleaner teeth and healthier gums.', 'Careful removal of hardened tartar along the gumline followed by gentle polishing to smooth tooth surfaces and reduce future plaque retention.', 45, 10, 4),
  ('dental-fillings', 'Dental Fillings', 'Conservative tooth-coloured restorations to repair cavities and protect tooth structure.', 'Careful restoration of decayed or chipped teeth using modern restorative materials with attention to bite comfort, aesthetics, and durability.', 45, 10, 5),
  ('preventive-dental-care', 'Preventive Dental Care', 'Proactive hygiene guidance and early-stage care plans tailored to your daily routine.', 'Personalized preventive guidance, hygiene maintenance scheduling, and early protection strategies to help you avoid avoidable dental discomfort.', 30, 10, 6)
ON CONFLICT (slug) DO NOTHING;
