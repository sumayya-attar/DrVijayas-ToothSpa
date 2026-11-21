# DrVijayas ToothSpa — Dental Clinic Website & Appointment System

Full-stack dental clinic website, multi-step appointment booking engine, Google Maps location integration, and role-based admin dashboard for **DrVijayas ToothSpa**, Mantri Square Mall, Seshadripuram, Bengaluru.

## Architecture Overview

- **Frontend:** React 19, TypeScript, Tailwind CSS v4, `@vis.gl/react-google-maps`, Lucide icons.
- **Backend:** Express (`server.ts`) with Vite middleware in development and static `dist/` serving in production.
- **Database:** Embedded relational SQLite (`node:sqlite` `DatabaseSync` at `data/toothspa.db`) with foreign keys, WAL mode, automatic migrations (`src/server/db.ts`), and `BEGIN IMMEDIATE` transactional slot locking (`src/server/booking.ts`), paired with automatic sync to **Supabase** (`src/server/supabase.ts`).

### Database Tables
`admins`, `patients`, `dentists`, `treatments`, `dentist_treatments`, `dentist_schedules`, `clinic_hours`, `blocked_dates`, `appointments`, `notifications`, `testimonials`, `website_settings`, `audit_logs`.

### Supabase Schema Setup
Run `/supabase/migrations/001_initial_schema.sql` once in your Supabase Dashboard SQL Editor to create all tables, indexes, and strict RLS policies (including `INSERT`-only public booking protection on `public.appointments`).

## Environment Configuration

Copy `.env.example` to `.env` and configure:

- `SUPABASE_PROJECT_ID`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`: Supabase project credentials for saving online appointment bookings (and optionally syncing admin status updates when `SUPABASE_SECRET_KEY` is provided).
- `VITE_GOOGLE_MAPS_API_KEY` / `GOOGLE_MAPS_API_KEY`: Google Maps Platform key (Maps JavaScript API & Places API New).
- `ADMIN_INITIAL_EMAIL` & `ADMIN_INITIAL_PASSWORD`: Initial super-admin account seeded on first startup.
- `SESSION_SECRET`: Random 64-char hex string for HMAC-signed admin session cookies.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`: Optional SMTP credentials for automated confirmation & reset emails.
- `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`: Optional WhatsApp Business Cloud API credentials for automated template/text notifications.

## Running Locally & Production Deployment

```bash
npm install
npm run dev       # Starts Express + Vite on port 3000
npm run lint      # TypeScript type-check
npm run build     # Builds frontend bundle into dist/
npm start         # Runs production Express server on port 3000
```

## Verification & Testing Checklist

1. **Booking Flow:** Visit `/`, choose a treatment, select a dentist or "Any Available Dentist", pick an open date from the calendar, select a dynamic slot, submit patient details with privacy consent, and verify the generated `TS-XXXXXX` booking reference.
2. **Double-Booking Prevention:** Attempt to book the same dentist/time slot concurrently—verify the second request receives HTTP `409 Conflict`.
3. **Patient Self-Service:** Click *Manage or Reschedule Booking*, enter the booking reference and registered phone number, reschedule to another open slot or cancel.
4. **Admin Dashboard:** Navigate to `/admin`, sign in with your configured admin credentials, confirm/complete/reschedule/export CSV appointments, manage dentists, add verified treatments, adjust clinic hours or blocked holiday dates, upload replacement photos, and inspect audit logs.
