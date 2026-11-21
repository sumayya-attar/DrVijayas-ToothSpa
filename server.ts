import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import nodemailer from 'nodemailer';
import {
  db,
  getWebsiteSettings,
  hashPassword,
  logAudit,
  runMigrationsAndSeed,
  uploadsDir,
  verifyPassword,
} from './src/server/db.ts';
import {
  clearSessionCookie,
  requireAdmin,
  requireRole,
  setSessionCookie,
  signSessionToken,
  type AdminRequest,
} from './src/server/auth.ts';
import {
  adminEditAppointmentTransaction,
  createBookingTransaction,
  getAppointmentDetailById,
  getAvailableSlots,
  minutesToTime,
  rescheduleAppointmentTransaction,
  timeToMinutes,
} from './src/server/booking.ts';
import { dispatchBookingNotifications } from './src/server/notifications.ts';
import {
  checkSupabaseStatus,
  fetchAppointmentsFromSupabase,
  syncAppointmentToSupabase,
  updateAppointmentInSupabase,
} from './src/server/supabase.ts';

dotenv.config();
runMigrationsAndSeed();

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '8mb' }));
app.use('/uploads', express.static(uploadsDir));

// Simple in-memory cache for Google Places API lookup (valid well within 30-day ToS limit)
let cachedPlaceResult: { fetchedAt: number; data: unknown } | null = null;

function normalizePhoneDigits(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
}

function getMapsApiKey(): string {
  return process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
}

// SEO: robots.txt and dynamic sitemap.xml
app.get('/robots.txt', (req, res) => {
  const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  res.type('text/plain').send(
    `User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${baseUrl.replace(/\/$/, '')}/sitemap.xml\n`
  );
});

app.get('/sitemap.xml', (req, res) => {
  const baseUrl = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const treatments = db
    .prepare('SELECT slug, created_at FROM treatments WHERE is_active = 1 ORDER BY sort_order ASC')
    .all() as { slug: string; created_at: string }[];

  const staticPaths = ['', '/treatments', '/book', '/manage-booking', '/privacy-policy', '/terms'];
  const urls = [
    ...staticPaths.map((p) => `<url><loc>${baseUrl}${p || '/'}</loc><changefreq>weekly</changefreq><priority>${p === '' ? '1.0' : '0.8'}</priority></url>`),
    ...treatments.map(
      (t) => `<url><loc>${baseUrl}/treatments/${t.slug}</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>`
    ),
  ];

  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`
  );
});

// Public Maps Config (supplies provisioned VITE_GOOGLE_MAPS_API_KEY or GOOGLE_MAPS_API_KEY to client)
app.get('/api/public/maps-config', (_req, res) => {
  res.json({ apiKey: getMapsApiKey() });
});

// Google Places API (New) lookup for DrVijayas ToothSpa & Mantri Square Mall
app.get('/api/clinic/google-place', async (_req, res) => {
  const apiKey = getMapsApiKey();
  if (!apiKey) {
    return res.json({ configured: false, place: null, mallCenter: null });
  }

  if (cachedPlaceResult && Date.now() - cachedPlaceResult.fetchedAt < 1000 * 60 * 60 * 6) {
    return res.json(cachedPlaceResult.data);
  }

  const searchPlace = async (textQuery: string) => {
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-Maps-Solution-ID': 'gmp_mcp_codeassist_v1_aistudio',
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.googleMapsUri,places.googleMapsLinks,places.reviews',
      },
      body: JSON.stringify({
        textQuery,
        languageCode: 'en',
        regionCode: 'IN',
        pageSize: 3,
      }),
    });

    if (response.status === 429) {
      return { quotaExceeded: true, places: [] };
    }
    if (!response.ok) {
      return { quotaExceeded: false, places: [] };
    }
    const json = (await response.json()) as { places?: any[] };
    return { quotaExceeded: false, places: json.places || [] };
  };

  try {
    const clinicSearch = await searchPlace('DrVijayas ToothSpa Mantri Square Mall Seshadripuram Bengaluru');
    if (clinicSearch.quotaExceeded) {
      return res.status(429).json({ error: { status: 'RESOURCE_EXHAUSTED' }, quotaExceeded: true });
    }

    const clinicMatch = clinicSearch.places.find((p) =>
      String(p.displayName?.text || '').toLowerCase().includes('toothspa') ||
      String(p.displayName?.text || '').toLowerCase().includes('vijaya')
    );

    let mallMatch = clinicSearch.places[0] || null;
    if (!clinicMatch) {
      const mallSearch = await searchPlace('Mantri Square Mall Seshadripuram Bengaluru 560003');
      if (mallSearch.quotaExceeded) {
        return res.status(429).json({ error: { status: 'RESOURCE_EXHAUSTED' }, quotaExceeded: true });
      }
      if (mallSearch.places.length > 0) {
        mallMatch = mallSearch.places[0];
      }
    }

    const payload = {
      configured: true,
      place: clinicMatch
        ? {
            id: clinicMatch.id,
            name: clinicMatch.displayName?.text || 'DrVijayas ToothSpa',
            formattedAddress: clinicMatch.formattedAddress || '',
            location: clinicMatch.location
              ? { lat: clinicMatch.location.latitude, lng: clinicMatch.location.longitude }
              : null,
            rating: typeof clinicMatch.rating === 'number' ? clinicMatch.rating : null,
            userRatingCount:
              typeof clinicMatch.userRatingCount === 'number' ? clinicMatch.userRatingCount : null,
            googleMapsUri: clinicMatch.googleMapsUri || clinicMatch.googleMapsLinks?.placeUri || null,
            directionsUri: clinicMatch.googleMapsLinks?.directionsUri || null,
            reviewsUri: clinicMatch.googleMapsLinks?.reviewsUri || null,
            reviews: Array.isArray(clinicMatch.reviews)
              ? clinicMatch.reviews.map((r: any) => ({
                  authorName: r.authorAttribution?.displayName || 'Google Reviewer',
                  rating: r.rating || null,
                  relativePublishTimeDescription: r.relativePublishTimeDescription || '',
                  text: r.text?.text || '',
                }))
              : [],
          }
        : null,
      mallLocation: mallMatch?.location
        ? {
            lat: mallMatch.location.latitude,
            lng: mallMatch.location.longitude,
            googleMapsUri: mallMatch.googleMapsUri || null,
            directionsUri: mallMatch.googleMapsLinks?.directionsUri || null,
          }
        : null,
    };

    cachedPlaceResult = { fetchedAt: Date.now(), data: payload };
    res.json(payload);
  } catch (err) {
    console.error('Places lookup error:', err);
    res.json({ configured: true, place: null, mallLocation: null });
  }
});

// Public Bootstrap
app.get('/api/public/bootstrap', (_req, res) => {
  const settings = getWebsiteSettings();
  const treatments = db
    .prepare('SELECT * FROM treatments WHERE is_active = 1 ORDER BY sort_order ASC, id ASC')
    .all();

  const dentistsRaw = db
    .prepare('SELECT id, name, title, qualifications, bio, photo_url, is_active, sort_order FROM dentists WHERE is_active = 1 ORDER BY sort_order ASC, id ASC')
    .all() as {
    id: number;
    name: string;
    title: string;
    qualifications: string;
    bio: string;
    photo_url: string | null;
    is_active: number;
    sort_order: number;
  }[];

  const dentists = dentistsRaw.map((d) => {
    const dtRows = db
      .prepare('SELECT treatment_id FROM dentist_treatments WHERE dentist_id = ?')
      .all(d.id) as { treatment_id: number }[];
    const schedRows = db
      .prepare('SELECT day_of_week, is_working, start_time, end_time FROM dentist_schedules WHERE dentist_id = ? ORDER BY day_of_week ASC')
      .all(d.id);
    return {
      ...d,
      treatment_ids: dtRows.map((r) => r.treatment_id),
      schedules: schedRows,
    };
  });

  const clinicHours = db
    .prepare('SELECT * FROM clinic_hours ORDER BY day_of_week ASC')
    .all();

  const today = new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
  const blockedDates = db
    .prepare('SELECT id, date, dentist_id, reason FROM blocked_dates WHERE date >= ? ORDER BY date ASC')
    .all(today);

  const testimonials = db
    .prepare('SELECT id, patient_name, review_text, review_date, source, rating FROM testimonials WHERE is_published = 1 ORDER BY sort_order ASC, id DESC')
    .all();

  res.json({
    settings,
    treatments,
    dentists,
    clinicHours,
    blockedDates,
    testimonials,
  });
});

// Dynamic Appointment Slots
app.get('/api/slots', (req, res) => {
  try {
    const date = String(req.query.date || '');
    const treatmentId = Number(req.query.treatmentId);
    const dentistParam = String(req.query.dentistId || 'any');
    const dentistId: number | 'any' = dentistParam === 'any' ? 'any' : Number(dentistParam);

    if (!date || !Number.isFinite(treatmentId)) {
      return res.status(400).json({ error: 'date and treatmentId are required.' });
    }
    if (dentistId !== 'any' && !Number.isFinite(dentistId)) {
      return res.status(400).json({ error: 'Invalid dentistId.' });
    }

    const result = getAvailableSlots(date, treatmentId, dentistId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to fetch slots.' });
  }
});

// Calendar Month Availability Summary
app.get('/api/availability/calendar', (req, res) => {
  try {
    const month = String(req.query.month || '');
    const treatmentId = Number(req.query.treatmentId);
    const dentistParam = String(req.query.dentistId || 'any');
    const dentistId: number | 'any' = dentistParam === 'any' ? 'any' : Number(dentistParam);

    if (!/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(treatmentId)) {
      return res.status(400).json({ error: 'month (YYYY-MM) and treatmentId are required.' });
    }

    const [y, m] = month.split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const todayIst = new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);

    const days: { date: string; available: boolean; slotCount: number; reason: string | null }[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${month}-${String(day).padStart(2, '0')}`;
      if (dateStr < todayIst) {
        days.push({ date: dateStr, available: false, slotCount: 0, reason: 'Past date' });
        continue;
      }
      const resSlots = getAvailableSlots(dateStr, treatmentId, dentistId);
      days.push({
        date: dateStr,
        available: !resSlots.is_closed && resSlots.slots.length > 0,
        slotCount: resSlots.slots.length,
        reason: resSlots.closure_reason,
      });
    }

    res.json({ month, days });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to load calendar availability.' });
  }
});

// Create Appointment (Atomic Transaction)
app.post('/api/appointments', async (req, res) => {
  try {
    const {
      full_name,
      phone,
      email,
      treatment_id,
      dentist_id,
      appointment_date,
      start_time,
      notes,
      consent_accepted,
    } = req.body || {};

    if (!full_name || String(full_name).trim().length < 2) {
      return res.status(400).json({ error: 'Please enter your full name.' });
    }
    const digits = normalizePhoneDigits(String(phone || ''));
    if (digits.length < 10 || digits.length > 15) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (!Number.isFinite(Number(treatment_id))) {
      return res.status(400).json({ error: 'Please select a treatment.' });
    }
    if (!appointment_date || !start_time) {
      return res.status(400).json({ error: 'Please select an appointment date and time slot.' });
    }
    if (!consent_accepted) {
      return res.status(400).json({ error: 'Please accept the patient privacy consent checkbox.' });
    }

    const parsedDentist: number | 'any' =
      dentist_id === 'any' || dentist_id === null || dentist_id === undefined
        ? 'any'
        : Number(dentist_id);

    const created = createBookingTransaction({
      full_name: String(full_name),
      phone: String(phone),
      email: email ? String(email) : undefined,
      treatment_id: Number(treatment_id),
      dentist_id: parsedDentist,
      appointment_date: String(appointment_date),
      start_time: String(start_time),
      notes: notes ? String(notes) : undefined,
      consent_accepted: Boolean(consent_accepted),
    }) as any;

    const supabase = await syncAppointmentToSupabase({
      booking_ref: created.booking_ref,
      patient_name: created.patient_name,
      patient_phone: created.patient_phone,
      patient_email: created.patient_email,
      treatment_name: created.treatment_name,
      dentist_name: created.dentist_name,
      appointment_date: created.appointment_date,
      start_time: created.start_time,
      end_time: created.end_time,
      duration_minutes: created.duration_minutes,
      status: created.status,
      notes: created.notes,
      consent_accepted: true,
    });

    const notifications = await dispatchBookingNotifications(created, 'created');
    res.status(201).json({ appointment: created, notifications, supabase });
  } catch (err) {
    const status = (err as Error & { statusCode?: number }).statusCode || 400;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Booking could not be completed.' });
  }
});

// Patient Booking Lookup (Requires Booking Ref + Phone Match)
app.post('/api/appointments/lookup', (req, res) => {
  const { booking_ref, phone } = req.body || {};
  const ref = String(booking_ref || '').trim().toUpperCase();
  const inputDigits = normalizePhoneDigits(String(phone || ''));

  if (!ref || inputDigits.length < 6) {
    return res.status(400).json({ error: 'Booking reference and registered mobile number are required.' });
  }

  const appt = db
    .prepare(
      `SELECT
        a.id, a.booking_ref, a.appointment_date, a.start_time, a.end_time,
        a.duration_minutes, a.status, a.notes, a.created_at,
        a.treatment_id, a.requested_dentist_id, a.assigned_dentist_id,
        p.full_name as patient_name, p.phone as patient_phone, p.email as patient_email,
        t.name as treatment_name,
        d.name as dentist_name
      FROM appointments a
      INNER JOIN patients p ON p.id = a.patient_id
      INNER JOIN treatments t ON t.id = a.treatment_id
      INNER JOIN dentists d ON d.id = a.assigned_dentist_id
      WHERE upper(a.booking_ref) = ?`
    )
    .get(ref) as any;

  if (!appt) {
    return res.status(404).json({ error: 'No appointment found matching those details.' });
  }

  const storedDigits = normalizePhoneDigits(appt.patient_phone);
  if (!storedDigits.endsWith(inputDigits.slice(-10)) && !inputDigits.endsWith(storedDigits.slice(-10))) {
    return res.status(404).json({ error: 'No appointment found matching those details.' });
  }

  res.json({ appointment: appt });
});

// Patient Reschedule
app.post('/api/appointments/reschedule', async (req, res) => {
  try {
    const { booking_ref, phone, new_date, new_start_time } = req.body || {};
    const ref = String(booking_ref || '').trim().toUpperCase();
    const inputDigits = normalizePhoneDigits(String(phone || ''));

    const appt = db
      .prepare(
        `SELECT a.id, p.phone as patient_phone FROM appointments a
         INNER JOIN patients p ON p.id = a.patient_id
         WHERE upper(a.booking_ref) = ?`
      )
      .get(ref) as { id: number; patient_phone: string } | undefined;

    if (!appt) {
      return res.status(404).json({ error: 'Booking not found.' });
    }
    const storedDigits = normalizePhoneDigits(appt.patient_phone);
    if (!storedDigits.endsWith(inputDigits.slice(-10)) && !inputDigits.endsWith(storedDigits.slice(-10))) {
      return res.status(403).json({ error: 'Phone verification failed.' });
    }

    const updated = rescheduleAppointmentTransaction(appt.id, String(new_date), String(new_start_time)) as any;
    logAudit(null, 'patient-self-service', 'RESCHEDULE_APPOINTMENT', 'appointment', appt.id, `Rescheduled to ${new_date} ${new_start_time}`);
    await updateAppointmentInSupabase(updated.booking_ref, {
      appointment_date: updated.appointment_date,
      start_time: updated.start_time,
      end_time: updated.end_time,
      dentist_name: updated.dentist_name,
    });
    const notifications = await dispatchBookingNotifications(updated, 'rescheduled');
    res.json({ appointment: updated, notifications });
  } catch (err) {
    const status = (err as Error & { statusCode?: number }).statusCode || 400;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Unable to reschedule appointment.' });
  }
});

// Patient Cancel
app.post('/api/appointments/cancel', async (req, res) => {
  try {
    const { booking_ref, phone } = req.body || {};
    const ref = String(booking_ref || '').trim().toUpperCase();
    const inputDigits = normalizePhoneDigits(String(phone || ''));

    const appt = db
      .prepare(
        `SELECT a.id, a.status, p.phone as patient_phone FROM appointments a
         INNER JOIN patients p ON p.id = a.patient_id
         WHERE upper(a.booking_ref) = ?`
      )
      .get(ref) as { id: number; status: string; patient_phone: string } | undefined;

    if (!appt) {
      return res.status(404).json({ error: 'Booking not found.' });
    }
    const storedDigits = normalizePhoneDigits(appt.patient_phone);
    if (!storedDigits.endsWith(inputDigits.slice(-10)) && !inputDigits.endsWith(storedDigits.slice(-10))) {
      return res.status(403).json({ error: 'Phone verification failed.' });
    }
    if (appt.status === 'Cancelled' || appt.status === 'Completed') {
      return res.status(400).json({ error: `Cannot cancel an appointment that is already ${appt.status}.` });
    }

    db.prepare(`UPDATE appointments SET status = 'Cancelled', updated_at = datetime('now') WHERE id = ?`).run(appt.id);
    logAudit(null, 'patient-self-service', 'CANCEL_APPOINTMENT', 'appointment', appt.id, 'Cancelled by patient');
    const updated = getAppointmentDetailById(appt.id) as any;
    await updateAppointmentInSupabase(updated.booking_ref, { status: 'Cancelled' });
    const notifications = await dispatchBookingNotifications(updated, 'cancelled');
    res.json({ appointment: updated, notifications });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to cancel appointment.' });
  }
});

// ==================== ADMIN AUTH ====================
app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  const admin = db
    .prepare('SELECT * FROM admins WHERE lower(email) = lower(?) AND is_active = 1')
    .get(String(email).trim()) as
    | { id: number; email: string; name: string; role: 'super_admin' | 'manager' | 'reception'; password_hash: string }
    | undefined;

  if (!admin || !verifyPassword(String(password), admin.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const token = signSessionToken({
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  });
  setSessionCookie(res, token);
  logAudit(admin.id, admin.email, 'ADMIN_LOGIN', 'admin', admin.id, 'Signed in');
  res.json({
    admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
  });
});

app.post('/api/admin/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/admin/me', requireAdmin, (req: AdminRequest, res) => {
  res.json({ admin: req.admin });
});

app.post('/api/admin/forgot-password', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }
  const admin = db.prepare('SELECT id, email, name FROM admins WHERE lower(email) = ? AND is_active = 1').get(email) as
    | { id: number; email: string; name: string }
    | undefined;

  if (admin) {
    const rawToken = crypto.randomBytes(24).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    db.prepare('UPDATE admins SET reset_token_hash = ?, reset_token_expires_at = ? WHERE id = ?').run(
      tokenHash,
      expiresAt,
      admin.id
    );

    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    if (smtpHost && smtpUser && smtpPass) {
      try {
        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port: Number(process.env.SMTP_PORT || 587),
          secure: Number(process.env.SMTP_PORT) === 465,
          auth: { user: smtpUser, pass: smtpPass },
        });
        const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
        await transporter.sendMail({
          from: process.env.SMTP_FROM || smtpUser,
          to: admin.email,
          subject: 'DrVijayas ToothSpa Admin Password Reset',
          text: `Reset your admin password using this token: ${rawToken}\nOr open: ${baseUrl}/admin?resetToken=${rawToken}\nThis token expires in 30 minutes.`,
        });
      } catch (err) {
        console.error('Reset email error:', err);
      }
    }
    logAudit(admin.id, admin.email, 'REQUEST_PASSWORD_RESET', 'admin', admin.id, 'Reset token generated');
  }

  res.json({
    message:
      'If an active administrator account exists for that email and SMTP is configured, reset instructions have been sent.',
  });
});

app.post('/api/admin/reset-password', (req, res) => {
  const { token, new_password } = req.body || {};
  if (!token || !new_password || String(new_password).length < 8) {
    return res.status(400).json({ error: 'Valid reset token and a password of at least 8 characters are required.' });
  }
  const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
  const admin = db
    .prepare('SELECT id, email, reset_token_expires_at FROM admins WHERE reset_token_hash = ? AND is_active = 1')
    .get(tokenHash) as { id: number; email: string; reset_token_expires_at: string } | undefined;

  if (!admin || !admin.reset_token_expires_at || admin.reset_token_expires_at < new Date().toISOString()) {
    return res.status(400).json({ error: 'Reset token is invalid or expired.' });
  }

  db.prepare('UPDATE admins SET password_hash = ?, reset_token_hash = NULL, reset_token_expires_at = NULL WHERE id = ?').run(
    hashPassword(String(new_password)),
    admin.id
  );
  logAudit(admin.id, admin.email, 'RESET_PASSWORD', 'admin', admin.id, 'Password updated via reset token');
  res.json({ ok: true });
});

app.post('/api/admin/change-password', requireAdmin, (req: AdminRequest, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password || String(new_password).length < 8) {
    return res.status(400).json({ error: 'Current password and a new password (min 8 chars) are required.' });
  }
  const admin = db.prepare('SELECT id, password_hash FROM admins WHERE id = ?').get(req.admin!.id) as {
    id: number;
    password_hash: string;
  };
  if (!verifyPassword(String(current_password), admin.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hashPassword(String(new_password)), admin.id);
  logAudit(req.admin!.id, req.admin!.email, 'CHANGE_PASSWORD', 'admin', admin.id, 'Password changed');
  res.json({ ok: true });
});

// ==================== ADMIN OVERVIEW & APPOINTMENTS ====================
app.get('/api/admin/overview', requireAdmin, async (_req: AdminRequest, res) => {
  const todayIst = new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);

  const counts = db
    .prepare(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN appointment_date = ? AND status NOT IN ('Cancelled') THEN 1 ELSE 0 END) as today,
        SUM(CASE WHEN appointment_date >= ? AND status IN ('Pending', 'Confirmed') THEN 1 ELSE 0 END) as upcoming,
        SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'Confirmed' THEN 1 ELSE 0 END) as confirmed,
        SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END) as cancelled,
        SUM(CASE WHEN status = 'No-show' THEN 1 ELSE 0 END) as no_show
      FROM appointments`
    )
    .get(todayIst, todayIst) as Record<string, number>;

  const recentLogs = db
    .prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 15')
    .all();

  const [supabase, sbRowsRes] = await Promise.all([
    checkSupabaseStatus(),
    fetchAppointmentsFromSupabase(),
  ]);

  if (sbRowsRes.accessible && sbRowsRes.rows.length > 0) {
    const localRefs = new Set(
      (db.prepare('SELECT booking_ref FROM appointments').all() as { booking_ref: string }[]).map((r) =>
        r.booking_ref.toUpperCase()
      )
    );
    for (const row of sbRowsRes.rows) {
      if (localRefs.has(String(row.booking_ref || '').toUpperCase())) continue;
      counts.total = (counts.total || 0) + 1;
      if (row.appointment_date === todayIst && row.status !== 'Cancelled') {
        counts.today = (counts.today || 0) + 1;
      }
      if (row.appointment_date >= todayIst && (row.status === 'Pending' || row.status === 'Confirmed')) {
        counts.upcoming = (counts.upcoming || 0) + 1;
      }
      if (row.status === 'Pending') counts.pending = (counts.pending || 0) + 1;
      if (row.status === 'Confirmed') counts.confirmed = (counts.confirmed || 0) + 1;
      if (row.status === 'Completed') counts.completed = (counts.completed || 0) + 1;
      if (row.status === 'Cancelled') counts.cancelled = (counts.cancelled || 0) + 1;
      if (row.status === 'No-show') counts.no_show = (counts.no_show || 0) + 1;
    }
  }

  const integrations = {
    smtpConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
    whatsappConfigured: Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
    mapsConfigured: Boolean(getMapsApiKey()),
    supabase,
    supabaseRead: {
      accessible: sbRowsRes.accessible,
      reason: sbRowsRes.reason || null,
      count: sbRowsRes.rows.length,
    },
  };

  res.json({ counts, recentLogs, integrations, todayIst });
});

app.get('/api/admin/supabase-migration-sql', requireAdmin, (_req: AdminRequest, res) => {
  try {
    const sqlPath = path.resolve(process.cwd(), 'supabase/migrations/001_initial_schema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    res.json({ sql });
  } catch {
    res.status(404).json({ error: 'Migration SQL file not found.' });
  }
});

app.get('/api/admin/appointments', requireAdmin, async (req: AdminRequest, res) => {
  const search = String(req.query.search || '').trim().toLowerCase();
  const date = String(req.query.date || '').trim();
  const dentistId = req.query.dentistId ? Number(req.query.dentistId) : null;
  const treatmentId = req.query.treatmentId ? Number(req.query.treatmentId) : null;
  const status = String(req.query.status || '').trim();

  let sql = `
    SELECT
      a.*, p.full_name as patient_name, p.phone as patient_phone, p.email as patient_email,
      t.name as treatment_name, d.name as dentist_name
    FROM appointments a
    INNER JOIN patients p ON p.id = a.patient_id
    INNER JOIN treatments t ON t.id = a.treatment_id
    INNER JOIN dentists d ON d.id = a.assigned_dentist_id
    WHERE 1=1
  `;
  const params: (string | number)[] = [];

  if (search) {
    sql += ` AND (lower(p.full_name) LIKE ? OR lower(a.booking_ref) LIKE ? OR p.phone LIKE ? OR lower(COALESCE(p.email, '')) LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (date) {
    sql += ` AND a.appointment_date = ?`;
    params.push(date);
  }
  if (dentistId) {
    sql += ` AND a.assigned_dentist_id = ?`;
    params.push(dentistId);
  }
  if (treatmentId) {
    sql += ` AND a.treatment_id = ?`;
    params.push(treatmentId);
  }
  if (status) {
    sql += ` AND a.status = ?`;
    params.push(status);
  }

  sql += ` ORDER BY a.appointment_date DESC, a.start_time ASC LIMIT 500`;
  const localRows = db.prepare(sql).all(...params) as any[];

  const sbRes = await fetchAppointmentsFromSupabase();
  const sbRefSet = new Set(sbRes.rows.map((r) => String(r.booking_ref || '').toUpperCase()));

  const merged: any[] = localRows.map((row) => {
    const synced = sbRes.accessible && sbRefSet.has(String(row.booking_ref || '').toUpperCase());
    return {
      ...row,
      supabase_synced: synced,
      source_db: synced ? 'sqlite+supabase' : 'sqlite',
    };
  });

  if (sbRes.accessible && sbRes.rows.length > 0) {
    const allLocalRefs = new Set(
      (db.prepare('SELECT booking_ref FROM appointments').all() as { booking_ref: string }[]).map((r) =>
        r.booking_ref.toUpperCase()
      )
    );
    const dentistFilterName = dentistId
      ? (db.prepare('SELECT name FROM dentists WHERE id = ?').get(dentistId) as { name: string } | undefined)?.name
      : null;
    const treatmentFilterName = treatmentId
      ? (db.prepare('SELECT name FROM treatments WHERE id = ?').get(treatmentId) as { name: string } | undefined)?.name
      : null;

    for (const sb of sbRes.rows) {
      if (allLocalRefs.has(String(sb.booking_ref || '').toUpperCase())) continue;
      if (search) {
        const hay = `${sb.patient_name} ${sb.booking_ref} ${sb.patient_phone} ${sb.patient_email || ''}`.toLowerCase();
        if (!hay.includes(search)) continue;
      }
      if (date && sb.appointment_date !== date) continue;
      if (status && sb.status !== status) continue;
      if (dentistFilterName && sb.dentist_name !== dentistFilterName) continue;
      if (treatmentFilterName && sb.treatment_name !== treatmentFilterName) continue;

      merged.push({
        id: -Math.abs(Number(sb.id) || 1),
        booking_ref: sb.booking_ref,
        appointment_date: sb.appointment_date,
        start_time: sb.start_time,
        end_time: sb.end_time,
        duration_minutes: sb.duration_minutes,
        status: sb.status,
        notes: sb.notes || '',
        created_at: sb.created_at,
        updated_at: sb.updated_at,
        requested_dentist_id: null,
        assigned_dentist_id: 0,
        treatment_id: 0,
        patient_name: sb.patient_name,
        patient_phone: sb.patient_phone,
        patient_email: sb.patient_email,
        treatment_name: sb.treatment_name,
        dentist_name: sb.dentist_name,
        supabase_synced: true,
        source_db: 'supabase',
      });
    }

    merged.sort((a, b) => {
      if (a.appointment_date !== b.appointment_date) {
        return a.appointment_date < b.appointment_date ? 1 : -1;
      }
      return a.start_time.localeCompare(b.start_time);
    });
  }

  res.json({
    appointments: merged,
    supabaseRead: {
      accessible: sbRes.accessible,
      reason: sbRes.reason || null,
      count: sbRes.rows.length,
    },
  });
});

app.post('/api/admin/appointments', requireAdmin, async (req: AdminRequest, res) => {
  try {
    const {
      full_name,
      phone,
      email,
      treatment_id,
      dentist_id,
      appointment_date,
      start_time,
      notes,
      status,
    } = req.body || {};

    if (!full_name || String(full_name).trim().length < 2) {
      return res.status(400).json({ error: 'Patient full name is required.' });
    }
    const digits = normalizePhoneDigits(String(phone || ''));
    if (digits.length < 10 || digits.length > 15) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
    }
    if (!Number.isFinite(Number(treatment_id)) || !appointment_date || !start_time) {
      return res.status(400).json({ error: 'Treatment, date, and time slot are required.' });
    }

    const parsedDentist: number | 'any' =
      dentist_id === 'any' || dentist_id === null || dentist_id === undefined
        ? 'any'
        : Number(dentist_id);

    let created = createBookingTransaction({
      full_name: String(full_name),
      phone: String(phone),
      email: email ? String(email) : undefined,
      treatment_id: Number(treatment_id),
      dentist_id: parsedDentist,
      appointment_date: String(appointment_date),
      start_time: String(start_time),
      notes: notes ? String(notes) : undefined,
      consent_accepted: true,
    }) as any;

    if (status === 'Confirmed') {
      db.prepare(`UPDATE appointments SET status = 'Confirmed', updated_at = datetime('now') WHERE id = ?`).run(created.id);
      created = getAppointmentDetailById(created.id);
    }

    const supabase = await syncAppointmentToSupabase({
      booking_ref: created.booking_ref,
      patient_name: created.patient_name,
      patient_phone: created.patient_phone,
      patient_email: created.patient_email,
      treatment_name: created.treatment_name,
      dentist_name: created.dentist_name,
      appointment_date: created.appointment_date,
      start_time: created.start_time,
      end_time: created.end_time,
      duration_minutes: created.duration_minutes,
      status: created.status,
      notes: created.notes,
      consent_accepted: true,
    });

    logAudit(
      req.admin!.id,
      req.admin!.email,
      'ADMIN_CREATE_APPOINTMENT',
      'appointment',
      created.id,
      `${created.booking_ref} for ${created.patient_name}`
    );

    const notifications = await dispatchBookingNotifications(
      created,
      created.status === 'Confirmed' ? 'confirmed' : 'created'
    );
    res.status(201).json({ appointment: created, supabase, notifications });
  } catch (err) {
    const code = (err as Error & { statusCode?: number }).statusCode || 400;
    res.status(code).json({ error: err instanceof Error ? err.message : 'Unable to create appointment.' });
  }
});

app.get('/api/admin/appointments/export.csv', requireAdmin, (_req: AdminRequest, res) => {
  const rows = db
    .prepare(
      `SELECT
        a.booking_ref, a.appointment_date, a.start_time, a.end_time, a.duration_minutes, a.status,
        p.full_name as patient_name, p.phone as patient_phone, p.email as patient_email,
        t.name as treatment_name, d.name as dentist_name, a.notes, a.created_at
      FROM appointments a
      INNER JOIN patients p ON p.id = a.patient_id
      INNER JOIN treatments t ON t.id = a.treatment_id
      INNER JOIN dentists d ON d.id = a.assigned_dentist_id
      ORDER BY a.appointment_date DESC, a.start_time ASC`
    )
    .all() as Record<string, unknown>[];

  const headers = [
    'Booking Ref',
    'Date',
    'Start Time',
    'End Time',
    'Duration (min)',
    'Status',
    'Patient Name',
    'Phone',
    'Email',
    'Treatment',
    'Dentist',
    'Notes',
    'Created At',
  ];
  const keys = [
    'booking_ref',
    'appointment_date',
    'start_time',
    'end_time',
    'duration_minutes',
    'status',
    'patient_name',
    'patient_phone',
    'patient_email',
    'treatment_name',
    'dentist_name',
    'notes',
    'created_at',
  ];

  const escapeCsv = (val: unknown) => {
    const str = String(val ?? '');
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const csvLines = [
    headers.join(','),
    ...rows.map((r) => keys.map((k) => escapeCsv(r[k])).join(',')),
  ];

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="drvijayas-toothspa-appointments.csv"');
  res.send(csvLines.join('\n'));
});

app.put('/api/admin/appointments/:id', requireAdmin, async (req: AdminRequest, res) => {
  try {
    const id = Number(req.params.id);
    const {
      booking_ref,
      patient_name,
      patient_phone,
      patient_email,
      treatment_id,
      assigned_dentist_id,
      appointment_date,
      start_time,
      status,
      notes,
    } = req.body || {};

    if (!patient_name || String(patient_name).trim().length < 2) {
      return res.status(400).json({ error: 'Patient full name is required.' });
    }
    const digits = normalizePhoneDigits(String(patient_phone || ''));
    if (digits.length < 10 || digits.length > 15) {
      return res.status(400).json({ error: 'Valid 10-digit mobile number is required.' });
    }
    const allowedStatuses = ['Pending', 'Confirmed', 'Completed', 'Cancelled', 'No-show'];
    if (!status || !allowedStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid appointment status.' });
    }

    // Handle Supabase-only row edits (negative synthetic id)
    if (id < 0 && booking_ref) {
      const treatment = db.prepare('SELECT name, duration_minutes FROM treatments WHERE id = ?').get(Number(treatment_id)) as
        | { name: string; duration_minutes: number }
        | undefined;
      const dentist = db.prepare('SELECT name FROM dentists WHERE id = ?').get(Number(assigned_dentist_id)) as
        | { name: string }
        | undefined;
      const dur = treatment?.duration_minutes || 30;
      const endTime = minutesToTime(timeToMinutes(String(start_time)) + dur);

      const sbSync = await updateAppointmentInSupabase(String(booking_ref), {
        patient_name: String(patient_name).trim(),
        patient_phone: String(patient_phone).trim(),
        patient_email: patient_email ? String(patient_email).trim() : null,
        treatment_name: treatment?.name,
        dentist_name: dentist?.name,
        appointment_date: String(appointment_date),
        start_time: String(start_time),
        end_time: endTime,
        duration_minutes: dur,
        status,
        notes: notes !== undefined ? String(notes).trim() : '',
      });

      if (!sbSync.synced) {
        return res.status(400).json({ error: sbSync.message || 'Unable to update Supabase record.' });
      }
      logAudit(req.admin!.id, req.admin!.email, 'ADMIN_EDIT_SUPABASE_APPOINTMENT', 'appointment', String(booking_ref), `Edited ${booking_ref}`);
      return res.json({ ok: true, supabase: sbSync });
    }

    const existing = db.prepare('SELECT status FROM appointments WHERE id = ?').get(id) as { status: string } | undefined;
    if (!existing) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }

    const updated = adminEditAppointmentTransaction(id, {
      patient_name: String(patient_name),
      patient_phone: String(patient_phone),
      patient_email: patient_email ? String(patient_email) : null,
      treatment_id: Number(treatment_id),
      assigned_dentist_id: Number(assigned_dentist_id),
      appointment_date: String(appointment_date),
      start_time: String(start_time),
      status,
      notes: notes !== undefined ? String(notes) : '',
    }) as any;

    logAudit(
      req.admin!.id,
      req.admin!.email,
      'ADMIN_EDIT_APPOINTMENT',
      'appointment',
      id,
      `Edited ${updated.booking_ref} (${updated.appointment_date} ${updated.start_time}, ${updated.status})`
    );

    const supabase = await updateAppointmentInSupabase(updated.booking_ref, {
      patient_name: updated.patient_name,
      patient_phone: updated.patient_phone,
      patient_email: updated.patient_email,
      treatment_name: updated.treatment_name,
      dentist_name: updated.dentist_name,
      appointment_date: updated.appointment_date,
      start_time: updated.start_time,
      end_time: updated.end_time,
      duration_minutes: updated.duration_minutes,
      status: updated.status,
      notes: updated.notes,
    });

    if (existing.status !== status) {
      if (status === 'Confirmed') {
        await dispatchBookingNotifications(updated, 'confirmed');
      } else if (status === 'Cancelled') {
        await dispatchBookingNotifications(updated, 'cancelled');
      }
    }

    res.json({ appointment: updated, supabase });
  } catch (err) {
    const code = (err as Error & { statusCode?: number }).statusCode || 400;
    res.status(code).json({ error: err instanceof Error ? err.message : 'Unable to save appointment changes.' });
  }
});

app.patch('/api/admin/appointments/:id', requireAdmin, async (req: AdminRequest, res) => {
  try {
    const id = Number(req.params.id);
    const { booking_ref, status, new_date, new_start_time, new_dentist_id, notes } = req.body || {};

    if (id < 0 && booking_ref) {
      const allowedStatuses = ['Pending', 'Confirmed', 'Completed', 'Cancelled', 'No-show'];
      if (status && !allowedStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status.' });
      }
      const sbSync = await updateAppointmentInSupabase(String(booking_ref), {
        ...(status ? { status } : {}),
        ...(notes !== undefined ? { notes: String(notes) } : {}),
        ...(new_date ? { appointment_date: String(new_date) } : {}),
        ...(new_start_time ? { start_time: String(new_start_time) } : {}),
      });
      if (!sbSync.synced) {
        return res.status(400).json({ error: sbSync.message || 'Unable to update Supabase appointment.' });
      }
      logAudit(req.admin!.id, req.admin!.email, 'UPDATE_SUPABASE_APPOINTMENT', 'appointment', String(booking_ref), `status=${status || 'unchanged'}`);
      return res.json({ ok: true, supabase: sbSync });
    }

    const existing = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id) as any;
    if (!existing) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }

    if (new_date && new_start_time) {
      const updated = rescheduleAppointmentTransaction(
        id,
        String(new_date),
        String(new_start_time),
        new_dentist_id !== undefined ? (new_dentist_id === 'any' ? 'any' : Number(new_dentist_id)) : undefined
      ) as any;
      logAudit(
        req.admin!.id,
        req.admin!.email,
        'ADMIN_RESCHEDULE_APPOINTMENT',
        'appointment',
        id,
        `Rescheduled to ${new_date} ${new_start_time}`
      );
      const supabase = await updateAppointmentInSupabase(updated.booking_ref, {
        appointment_date: updated.appointment_date,
        start_time: updated.start_time,
        end_time: updated.end_time,
        dentist_name: updated.dentist_name,
        status: updated.status,
      });
      await dispatchBookingNotifications(updated, 'rescheduled');
      return res.json({ appointment: updated, supabase });
    }

    const allowedStatuses = ['Pending', 'Confirmed', 'Completed', 'Cancelled', 'No-show'];
    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }

    db.prepare(
      `UPDATE appointments
       SET status = COALESCE(?, status),
           notes = COALESCE(?, notes),
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(status || null, notes !== undefined ? String(notes) : null, id);

    logAudit(
      req.admin!.id,
      req.admin!.email,
      'UPDATE_APPOINTMENT_STATUS',
      'appointment',
      id,
      `Status: ${existing.status} -> ${status || existing.status}`
    );

    const updated = getAppointmentDetailById(id) as any;
    const supabase = await updateAppointmentInSupabase(updated.booking_ref, {
      status: updated.status,
      notes: updated.notes,
    });
    if (status === 'Confirmed') {
      await dispatchBookingNotifications(updated, 'confirmed');
    } else if (status === 'Cancelled') {
      await dispatchBookingNotifications(updated, 'cancelled');
    }

    res.json({ appointment: updated, supabase });
  } catch (err) {
    const code = (err as Error & { statusCode?: number }).statusCode || 400;
    res.status(code).json({ error: err instanceof Error ? err.message : 'Update failed.' });
  }
});

// ==================== ADMIN DENTISTS ====================
app.get('/api/admin/dentists', requireAdmin, (_req, res) => {
  const rows = db.prepare('SELECT * FROM dentists ORDER BY sort_order ASC, id ASC').all() as any[];
  const dentists = rows.map((d) => {
    const dt = db.prepare('SELECT treatment_id FROM dentist_treatments WHERE dentist_id = ?').all(d.id) as {
      treatment_id: number;
    }[];
    const schedules = db
      .prepare('SELECT * FROM dentist_schedules WHERE dentist_id = ? ORDER BY day_of_week ASC')
      .all(d.id);
    return {
      ...d,
      treatment_ids: dt.map((x) => x.treatment_id),
      schedules,
    };
  });
  res.json({ dentists });
});

app.post('/api/admin/dentists', requireAdmin, requireRole(['super_admin', 'manager']), (req: AdminRequest, res) => {
  const { name, title, qualifications, bio, photo_url, is_active, treatment_ids, schedules } = req.body || {};
  if (!name || String(name).trim().length < 2) {
    return res.status(400).json({ error: 'Dentist name is required.' });
  }
  const info = db
    .prepare(
      'INSERT INTO dentists (name, title, qualifications, bio, photo_url, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM dentists))'
    )
    .run(
      String(name).trim(),
      String(title || 'Dental Practitioner').trim(),
      String(qualifications || '').trim(),
      String(bio || '').trim(),
      photo_url || null,
      is_active === false || is_active === 0 ? 0 : 1
    );

  const dentistId = Number(info.lastInsertRowid);
  if (Array.isArray(treatment_ids)) {
    const stmt = db.prepare('INSERT OR IGNORE INTO dentist_treatments (dentist_id, treatment_id) VALUES (?, ?)');
    for (const tid of treatment_ids) {
      stmt.run(dentistId, Number(tid));
    }
  }
  const schedStmt = db.prepare(
    'INSERT INTO dentist_schedules (dentist_id, day_of_week, is_working, start_time, end_time) VALUES (?, ?, ?, ?, ?)'
  );
  for (let dow = 0; dow <= 6; dow++) {
    const s = Array.isArray(schedules) ? schedules.find((x: any) => Number(x.day_of_week) === dow) : null;
    schedStmt.run(
      dentistId,
      dow,
      s ? (s.is_working ? 1 : 0) : 1,
      s?.start_time || '10:30',
      s?.end_time || '21:30'
    );
  }

  logAudit(req.admin!.id, req.admin!.email, 'CREATE_DENTIST', 'dentist', dentistId, String(name));
  res.status(201).json({ id: dentistId });
});

app.put('/api/admin/dentists/:id', requireAdmin, requireRole(['super_admin', 'manager']), (req: AdminRequest, res) => {
  const id = Number(req.params.id);
  const { name, title, qualifications, bio, photo_url, is_active, treatment_ids, schedules } = req.body || {};

  db.prepare(
    `UPDATE dentists SET name = ?, title = ?, qualifications = ?, bio = ?, photo_url = ?, is_active = ? WHERE id = ?`
  ).run(
    String(name).trim(),
    String(title || '').trim(),
    String(qualifications || '').trim(),
    String(bio || '').trim(),
    photo_url || null,
    is_active ? 1 : 0,
    id
  );

  if (Array.isArray(treatment_ids)) {
    db.prepare('DELETE FROM dentist_treatments WHERE dentist_id = ?').run(id);
    const stmt = db.prepare('INSERT OR IGNORE INTO dentist_treatments (dentist_id, treatment_id) VALUES (?, ?)');
    for (const tid of treatment_ids) {
      stmt.run(id, Number(tid));
    }
  }

  if (Array.isArray(schedules)) {
    db.prepare('DELETE FROM dentist_schedules WHERE dentist_id = ?').run(id);
    const schedStmt = db.prepare(
      'INSERT INTO dentist_schedules (dentist_id, day_of_week, is_working, start_time, end_time) VALUES (?, ?, ?, ?, ?)'
    );
    for (const s of schedules) {
      schedStmt.run(id, Number(s.day_of_week), s.is_working ? 1 : 0, s.start_time || '10:30', s.end_time || '21:30');
    }
  }

  logAudit(req.admin!.id, req.admin!.email, 'UPDATE_DENTIST', 'dentist', id, String(name));
  res.json({ ok: true });
});

app.delete('/api/admin/dentists/:id', requireAdmin, requireRole(['super_admin', 'manager']), (req: AdminRequest, res) => {
  const id = Number(req.params.id);
  const activeCount = db
    .prepare(`SELECT COUNT(*) as c FROM appointments WHERE assigned_dentist_id = ? AND status NOT IN ('Cancelled')`)
    .get(id) as { c: number };
  if (activeCount.c > 0) {
    db.prepare('UPDATE dentists SET is_active = 0 WHERE id = ?').run(id);
    logAudit(req.admin!.id, req.admin!.email, 'DEACTIVATE_DENTIST', 'dentist', id, 'Deactivated (has appointments)');
    return res.json({ deactivated: true, message: 'Dentist has existing appointments and was deactivated instead of deleted.' });
  }
  db.prepare('DELETE FROM dentists WHERE id = ?').run(id);
  logAudit(req.admin!.id, req.admin!.email, 'DELETE_DENTIST', 'dentist', id, 'Deleted dentist');
  res.json({ ok: true });
});

// ==================== ADMIN TREATMENTS ====================
app.get('/api/admin/treatments', requireAdmin, (_req, res) => {
  const rows = db.prepare('SELECT * FROM treatments ORDER BY sort_order ASC, id ASC').all() as any[];
  const treatments = rows.map((t) => {
    const dt = db.prepare('SELECT dentist_id FROM dentist_treatments WHERE treatment_id = ?').all(t.id) as {
      dentist_id: number;
    }[];
    return { ...t, assigned_dentist_ids: dt.map((x) => x.dentist_id) };
  });
  res.json({ treatments });
});

app.post('/api/admin/treatments', requireAdmin, requireRole(['super_admin', 'manager']), (req: AdminRequest, res) => {
  const {
    name,
    short_description,
    full_description,
    duration_minutes,
    buffer_minutes,
    image_url,
    price_display,
    is_active,
    assigned_dentist_ids,
  } = req.body || {};

  if (!name || !short_description) {
    return res.status(400).json({ error: 'Treatment name and short description are required.' });
  }

  const baseSlug = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  let slug = baseSlug || 'treatment';
  let idx = 1;
  while (db.prepare('SELECT 1 FROM treatments WHERE slug = ?').get(slug)) {
    slug = `${baseSlug}-${idx++}`;
  }

  const allowedDur = [15, 30, 45, 60, 90].includes(Number(duration_minutes)) ? Number(duration_minutes) : 30;
  const info = db
    .prepare(
      `INSERT INTO treatments (slug, name, short_description, full_description, duration_minutes, buffer_minutes, image_url, price_display, is_active, is_featured, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM treatments))`
    )
    .run(
      slug,
      String(name).trim(),
      String(short_description).trim(),
      String(full_description || short_description).trim(),
      allowedDur,
      Number(buffer_minutes ?? 10),
      image_url || '/src/assets/images/treatment_care_1795284233215.jpg',
      price_display ? String(price_display).trim() : null,
      is_active === false || is_active === 0 ? 0 : 1
    );

  const treatmentId = Number(info.lastInsertRowid);
  if (Array.isArray(assigned_dentist_ids)) {
    const stmt = db.prepare('INSERT OR IGNORE INTO dentist_treatments (dentist_id, treatment_id) VALUES (?, ?)');
    for (const did of assigned_dentist_ids) {
      stmt.run(Number(did), treatmentId);
    }
  }

  logAudit(req.admin!.id, req.admin!.email, 'CREATE_TREATMENT', 'treatment', treatmentId, String(name));
  res.status(201).json({ id: treatmentId, slug });
});

app.put('/api/admin/treatments/:id', requireAdmin, requireRole(['super_admin', 'manager']), (req: AdminRequest, res) => {
  const id = Number(req.params.id);
  const {
    name,
    short_description,
    full_description,
    duration_minutes,
    buffer_minutes,
    image_url,
    price_display,
    is_active,
    sort_order,
    assigned_dentist_ids,
  } = req.body || {};

  const allowedDur = [15, 30, 45, 60, 90].includes(Number(duration_minutes)) ? Number(duration_minutes) : 30;
  db.prepare(
    `UPDATE treatments
     SET name = ?, short_description = ?, full_description = ?, duration_minutes = ?, buffer_minutes = ?,
         image_url = ?, price_display = ?, is_active = ?, sort_order = COALESCE(?, sort_order)
     WHERE id = ?`
  ).run(
    String(name).trim(),
    String(short_description).trim(),
    String(full_description || short_description).trim(),
    allowedDur,
    Number(buffer_minutes ?? 10),
    image_url || null,
    price_display ? String(price_display).trim() : null,
    is_active ? 1 : 0,
    sort_order !== undefined ? Number(sort_order) : null,
    id
  );

  if (Array.isArray(assigned_dentist_ids)) {
    db.prepare('DELETE FROM dentist_treatments WHERE treatment_id = ?').run(id);
    const stmt = db.prepare('INSERT OR IGNORE INTO dentist_treatments (dentist_id, treatment_id) VALUES (?, ?)');
    for (const did of assigned_dentist_ids) {
      stmt.run(Number(did), id);
    }
  }

  logAudit(req.admin!.id, req.admin!.email, 'UPDATE_TREATMENT', 'treatment', id, String(name));
  res.json({ ok: true });
});

app.post('/api/admin/treatments/reorder', requireAdmin, requireRole(['super_admin', 'manager']), (req: AdminRequest, res) => {
  const { orderedIds } = req.body || {};
  if (!Array.isArray(orderedIds)) {
    return res.status(400).json({ error: 'orderedIds array required.' });
  }
  const stmt = db.prepare('UPDATE treatments SET sort_order = ? WHERE id = ?');
  orderedIds.forEach((id: number, idx: number) => {
    stmt.run(idx + 1, Number(id));
  });
  logAudit(req.admin!.id, req.admin!.email, 'REORDER_TREATMENTS', 'treatment', 'batch', orderedIds.join(','));
  res.json({ ok: true });
});

app.delete('/api/admin/treatments/:id', requireAdmin, requireRole(['super_admin', 'manager']), (req: AdminRequest, res) => {
  const id = Number(req.params.id);
  const used = db.prepare('SELECT COUNT(*) as c FROM appointments WHERE treatment_id = ?').get(id) as { c: number };
  if (used.c > 0) {
    db.prepare('UPDATE treatments SET is_active = 0 WHERE id = ?').run(id);
    logAudit(req.admin!.id, req.admin!.email, 'DISABLE_TREATMENT', 'treatment', id, 'Disabled (has appointments)');
    return res.json({ disabled: true });
  }
  db.prepare('DELETE FROM treatments WHERE id = ?').run(id);
  logAudit(req.admin!.id, req.admin!.email, 'DELETE_TREATMENT', 'treatment', id, 'Deleted treatment');
  res.json({ ok: true });
});

// ==================== ADMIN HOURS & BLOCKED DATES ====================
app.get('/api/admin/hours', requireAdmin, (_req, res) => {
  res.json({ hours: db.prepare('SELECT * FROM clinic_hours ORDER BY day_of_week ASC').all() });
});

app.put('/api/admin/hours', requireAdmin, requireRole(['super_admin', 'manager']), (req: AdminRequest, res) => {
  const { hours } = req.body || {};
  if (!Array.isArray(hours)) {
    return res.status(400).json({ error: 'hours array required.' });
  }
  const stmt = db.prepare(
    'UPDATE clinic_hours SET is_open = ?, open_time = ?, close_time = ?, slot_interval_minutes = ?, booking_buffer_minutes = ? WHERE day_of_week = ?'
  );
  for (const h of hours) {
    stmt.run(
      h.is_open ? 1 : 0,
      h.open_time || '10:30',
      h.close_time || '21:30',
      Number(h.slot_interval_minutes || 15),
      Number(h.booking_buffer_minutes ?? 10),
      Number(h.day_of_week)
    );
  }
  logAudit(req.admin!.id, req.admin!.email, 'UPDATE_CLINIC_HOURS', 'clinic_hours', 'all', 'Updated clinic hours');
  res.json({ ok: true });
});

app.get('/api/admin/blocked-dates', requireAdmin, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT b.*, d.name as dentist_name FROM blocked_dates b
       LEFT JOIN dentists d ON d.id = b.dentist_id
       ORDER BY b.date ASC`
    )
    .all();
  res.json({ blockedDates: rows });
});

app.post('/api/admin/blocked-dates', requireAdmin, requireRole(['super_admin', 'manager']), (req: AdminRequest, res) => {
  const { date, dentist_id, reason } = req.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    return res.status(400).json({ error: 'Valid YYYY-MM-DD date required.' });
  }
  const info = db
    .prepare('INSERT INTO blocked_dates (date, dentist_id, reason) VALUES (?, ?, ?)')
    .run(String(date), dentist_id ? Number(dentist_id) : null, String(reason || 'Clinic Holiday / Unavailable').trim());
  logAudit(req.admin!.id, req.admin!.email, 'CREATE_BLOCKED_DATE', 'blocked_date', Number(info.lastInsertRowid), `${date}: ${reason}`);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

app.delete('/api/admin/blocked-dates/:id', requireAdmin, requireRole(['super_admin', 'manager']), (req: AdminRequest, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM blocked_dates WHERE id = ?').run(id);
  logAudit(req.admin!.id, req.admin!.email, 'DELETE_BLOCKED_DATE', 'blocked_date', id, 'Removed blocked date');
  res.json({ ok: true });
});

// ==================== ADMIN TESTIMONIALS ====================
app.get('/api/admin/testimonials', requireAdmin, (_req, res) => {
  res.json({ testimonials: db.prepare('SELECT * FROM testimonials ORDER BY sort_order ASC, id DESC').all() });
});

app.post('/api/admin/testimonials', requireAdmin, requireRole(['super_admin', 'manager']), (req: AdminRequest, res) => {
  const { patient_name, review_text, review_date, source, rating, is_published } = req.body || {};
  if (!patient_name || !review_text) {
    return res.status(400).json({ error: 'Patient display name and review text are required.' });
  }
  const info = db
    .prepare(
      'INSERT INTO testimonials (patient_name, review_text, review_date, source, rating, is_published, sort_order) VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM testimonials))'
    )
    .run(
      String(patient_name).trim(),
      String(review_text).trim(),
      String(review_date || '').trim(),
      String(source || 'Google Maps Review').trim(),
      rating ? Number(rating) : null,
      is_published === false ? 0 : 1
    );
  logAudit(req.admin!.id, req.admin!.email, 'CREATE_TESTIMONIAL', 'testimonial', Number(info.lastInsertRowid), String(patient_name));
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

app.put('/api/admin/testimonials/:id', requireAdmin, requireRole(['super_admin', 'manager']), (req: AdminRequest, res) => {
  const id = Number(req.params.id);
  const { patient_name, review_text, review_date, source, rating, is_published } = req.body || {};
  db.prepare(
    'UPDATE testimonials SET patient_name = ?, review_text = ?, review_date = ?, source = ?, rating = ?, is_published = ? WHERE id = ?'
  ).run(
    String(patient_name).trim(),
    String(review_text).trim(),
    String(review_date || '').trim(),
    String(source || 'Google Maps Review').trim(),
    rating ? Number(rating) : null,
    is_published ? 1 : 0,
    id
  );
  logAudit(req.admin!.id, req.admin!.email, 'UPDATE_TESTIMONIAL', 'testimonial', id, String(patient_name));
  res.json({ ok: true });
});

app.delete('/api/admin/testimonials/:id', requireAdmin, requireRole(['super_admin', 'manager']), (req: AdminRequest, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM testimonials WHERE id = ?').run(id);
  logAudit(req.admin!.id, req.admin!.email, 'DELETE_TESTIMONIAL', 'testimonial', id, 'Deleted testimonial');
  res.json({ ok: true });
});

// ==================== ADMIN WEBSITE SETTINGS & MEDIA UPLOAD ====================
app.get('/api/admin/settings', requireAdmin, (_req, res) => {
  res.json({ settings: getWebsiteSettings() });
});

app.put('/api/admin/settings', requireAdmin, requireRole(['super_admin', 'manager']), (req: AdminRequest, res) => {
  const { settings } = req.body || {};
  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ error: 'settings object required.' });
  }
  const stmt = db.prepare('INSERT INTO website_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(settings)) {
    stmt.run(String(k), typeof v === 'string' ? v : JSON.stringify(v));
  }
  logAudit(req.admin!.id, req.admin!.email, 'UPDATE_WEBSITE_SETTINGS', 'website_settings', 'all', 'Updated website content/settings');
  res.json({ ok: true, settings: getWebsiteSettings() });
});

app.post('/api/admin/upload', requireAdmin, requireRole(['super_admin', 'manager']), (req: AdminRequest, res) => {
  const { filename, dataUrl } = req.body || {};
  if (!dataUrl || typeof dataUrl !== 'string') {
    return res.status(400).json({ error: 'Image data is required.' });
  }
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    return res.status(400).json({ error: 'Only PNG, JPG, and WEBP image uploads are supported.' });
  }
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.byteLength > 5 * 1024 * 1024) {
    return res.status(400).json({ error: 'Image size must be 5MB or smaller.' });
  }
  const safeBase = String(filename || 'media')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 32);
  const storedName = `${safeBase || 'media'}_${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(uploadsDir, storedName), buffer);
  logAudit(req.admin!.id, req.admin!.email, 'UPLOAD_MEDIA', 'media', storedName, `Uploaded ${buffer.byteLength} bytes`);
  res.status(201).json({ url: `/uploads/${storedName}` });
});

// ==================== ADMIN USERS (RBAC) & AUDIT LOGS ====================
app.get('/api/admin/users', requireAdmin, requireRole(['super_admin']), (_req, res) => {
  const users = db
    .prepare('SELECT id, email, name, role, is_active, created_at FROM admins ORDER BY id ASC')
    .all();
  res.json({ users });
});

app.post('/api/admin/users', requireAdmin, requireRole(['super_admin']), (req: AdminRequest, res) => {
  const { email, name, role, password } = req.body || {};
  if (!email || !name || !password || String(password).length < 8) {
    return res.status(400).json({ error: 'Email, name, and password (min 8 chars) are required.' });
  }
  if (!['super_admin', 'manager', 'reception'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role.' });
  }
  try {
    const info = db
      .prepare('INSERT INTO admins (email, name, role, password_hash) VALUES (?, ?, ?, ?)')
      .run(String(email).trim().toLowerCase(), String(name).trim(), role, hashPassword(String(password)));
    logAudit(req.admin!.id, req.admin!.email, 'CREATE_ADMIN_USER', 'admin', Number(info.lastInsertRowid), `${email} (${role})`);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  } catch {
    res.status(400).json({ error: 'An admin with this email already exists.' });
  }
});

app.put('/api/admin/users/:id', requireAdmin, requireRole(['super_admin']), (req: AdminRequest, res) => {
  const id = Number(req.params.id);
  const { role, is_active } = req.body || {};
  if (id === req.admin!.id && is_active === false) {
    return res.status(400).json({ error: 'You cannot deactivate your own account.' });
  }
  db.prepare('UPDATE admins SET role = COALESCE(?, role), is_active = COALESCE(?, is_active) WHERE id = ?').run(
    role || null,
    is_active === undefined ? null : is_active ? 1 : 0,
    id
  );
  logAudit(req.admin!.id, req.admin!.email, 'UPDATE_ADMIN_USER', 'admin', id, `role=${role}, active=${is_active}`);
  res.json({ ok: true });
});

app.get('/api/admin/audit-logs', requireAdmin, (_req, res) => {
  const logs = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100').all();
  res.json({ logs });
});

// ==================== VITE / STATIC SERVING ====================
async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`DrVijayas ToothSpa server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
