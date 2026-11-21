import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const UPLOADS_DIR = path.resolve(DATA_DIR, 'uploads');
const DB_PATH = path.resolve(DATA_DIR, 'toothspa.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export const uploadsDir = UPLOADS_DIR;
export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(keyHex, 'hex');
  if (derived.length !== stored.length) return false;
  return crypto.timingSafeEqual(derived, stored);
}

export function runMigrationsAndSeed() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'super_admin' CHECK (role IN ('super_admin', 'manager', 'reception')),
      password_hash TEXT NOT NULL,
      reset_token_hash TEXT,
      reset_token_expires_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);

    CREATE TABLE IF NOT EXISTS dentists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'Dental Practitioner',
      qualifications TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '',
      photo_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS treatments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      short_description TEXT NOT NULL,
      full_description TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK (duration_minutes IN (15, 30, 45, 60, 90)),
      buffer_minutes INTEGER NOT NULL DEFAULT 10,
      image_url TEXT,
      price_display TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_featured INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dentist_treatments (
      dentist_id INTEGER NOT NULL REFERENCES dentists(id) ON DELETE CASCADE,
      treatment_id INTEGER NOT NULL REFERENCES treatments(id) ON DELETE CASCADE,
      PRIMARY KEY (dentist_id, treatment_id)
    );

    CREATE TABLE IF NOT EXISTS dentist_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dentist_id INTEGER NOT NULL REFERENCES dentists(id) ON DELETE CASCADE,
      day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
      is_working INTEGER NOT NULL DEFAULT 1,
      start_time TEXT NOT NULL DEFAULT '10:30',
      end_time TEXT NOT NULL DEFAULT '21:30',
      UNIQUE (dentist_id, day_of_week)
    );

    CREATE TABLE IF NOT EXISTS clinic_hours (
      day_of_week INTEGER PRIMARY KEY CHECK (day_of_week >= 0 AND day_of_week <= 6),
      day_name TEXT NOT NULL,
      is_open INTEGER NOT NULL DEFAULT 1,
      open_time TEXT NOT NULL DEFAULT '10:30',
      close_time TEXT NOT NULL DEFAULT '21:30',
      slot_interval_minutes INTEGER NOT NULL DEFAULT 15,
      booking_buffer_minutes INTEGER NOT NULL DEFAULT 10
    );

    CREATE TABLE IF NOT EXISTS blocked_dates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      dentist_id INTEGER REFERENCES dentists(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_blocked_dates_date ON blocked_dates(date);

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_ref TEXT NOT NULL UNIQUE,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
      requested_dentist_id INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
      assigned_dentist_id INTEGER NOT NULL REFERENCES dentists(id) ON DELETE RESTRICT,
      treatment_id INTEGER NOT NULL REFERENCES treatments(id) ON DELETE RESTRICT,
      appointment_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      buffer_minutes INTEGER NOT NULL DEFAULT 10,
      status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Confirmed', 'Completed', 'Cancelled', 'No-show')),
      notes TEXT DEFAULT '',
      consent_accepted INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_appointments_date_dentist ON appointments(appointment_date, assigned_dentist_id, status);
    CREATE INDEX IF NOT EXISTS idx_appointments_ref ON appointments(booking_ref);

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
      channel TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp')),
      recipient TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('sent', 'skipped_unconfigured', 'failed')),
      provider_response TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS testimonials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_name TEXT NOT NULL,
      review_text TEXT NOT NULL,
      review_date TEXT DEFAULT '',
      source TEXT NOT NULL DEFAULT 'Clinic Feedback',
      rating INTEGER CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
      is_published INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS website_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
      admin_email TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      details TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Seed default super admin if none exists
  const adminCount = db.prepare('SELECT COUNT(*) as count FROM admins').get() as { count: number };
  if (adminCount.count === 0) {
    const email = process.env.ADMIN_INITIAL_EMAIL || 'admin@drvijayastoothspa.com';
    const password = process.env.ADMIN_INITIAL_PASSWORD || 'ToothSpa@2026';
    db.prepare(
      'INSERT INTO admins (email, name, role, password_hash) VALUES (?, ?, ?, ?)'
    ).run(email.toLowerCase(), 'Clinic Administrator', 'super_admin', hashPassword(password));
  }

  // Seed clinic hours (Monday to Sunday: 10:30 AM - 9:30 PM)
  const hoursCount = db.prepare('SELECT COUNT(*) as count FROM clinic_hours').get() as { count: number };
  if (hoursCount.count === 0) {
    const days = [
      { dow: 0, name: 'Sunday' },
      { dow: 1, name: 'Monday' },
      { dow: 2, name: 'Tuesday' },
      { dow: 3, name: 'Wednesday' },
      { dow: 4, name: 'Thursday' },
      { dow: 5, name: 'Friday' },
      { dow: 6, name: 'Saturday' },
    ];
    const stmt = db.prepare(
      'INSERT INTO clinic_hours (day_of_week, day_name, is_open, open_time, close_time, slot_interval_minutes, booking_buffer_minutes) VALUES (?, ?, 1, ?, ?, 15, 10)'
    );
    for (const d of days) {
      stmt.run(d.dow, d.name, '10:30', '21:30');
    }
  }

  // Seed verified core treatments (no fabricated prices)
  const treatmentCount = db.prepare('SELECT COUNT(*) as count FROM treatments').get() as { count: number };
  if (treatmentCount.count === 0) {
    const initialTreatments = [
      {
        slug: 'dental-consultation',
        name: 'Dental Consultation',
        short_description: 'Thorough oral evaluation and calm, unhurried discussion of your dental concerns and goals.',
        full_description:
          'A dedicated one-on-one consultation to understand your oral health concerns, review your dental history, and outline clear, transparent options tailored to your comfort.',
        duration_minutes: 30,
        buffer_minutes: 10,
        image_url: '/src/assets/images/treatment_consultation_1795284232947.jpg',
        sort_order: 1,
      },
      {
        slug: 'general-dental-check-up',
        name: 'General Dental Check-up',
        short_description: 'Comprehensive routine examination of teeth, gums, and restorations for ongoing oral wellness.',
        full_description:
          'Routine preventive examination designed to monitor enamel health, gum condition, and existing dental work early, supporting long-term oral health.',
        duration_minutes: 30,
        buffer_minutes: 10,
        image_url: '/src/assets/images/hero_dental_spa_1795284232745.jpg',
        sort_order: 2,
      },
      {
        slug: 'teeth-cleaning',
        name: 'Teeth Cleaning',
        short_description: 'Gentle professional cleaning to remove plaque, surface deposits, and keep your smile fresh.',
        full_description:
          'Comfortable clinical teeth cleaning performed with modern hygiene protocols to gently remove everyday plaque buildup and maintain healthy gums.',
        duration_minutes: 45,
        buffer_minutes: 10,
        image_url: '/src/assets/images/treatment_hygiene_1795284233321.jpg',
        sort_order: 3,
      },
      {
        slug: 'scaling-and-polishing',
        name: 'Scaling and Polishing',
        short_description: 'Detailed ultrasonic scaling and smooth surface polishing for cleaner teeth and healthier gums.',
        full_description:
          'Careful removal of hardened tartar along the gumline followed by gentle polishing to smooth tooth surfaces and reduce future plaque retention.',
        duration_minutes: 45,
        buffer_minutes: 10,
        image_url: '/src/assets/images/treatment_hygiene_1795284233321.jpg',
        sort_order: 4,
      },
      {
        slug: 'dental-fillings',
        name: 'Dental Fillings',
        short_description: 'Conservative tooth-coloured restorations to repair cavities and protect tooth structure.',
        full_description:
          'Careful restoration of decayed or chipped teeth using modern restorative materials with attention to bite comfort, aesthetics, and durability.',
        duration_minutes: 45,
        buffer_minutes: 10,
        image_url: '/src/assets/images/treatment_consultation_1795284232947.jpg',
        sort_order: 5,
      },
      {
        slug: 'preventive-dental-care',
        name: 'Preventive Dental Care',
        short_description: 'Proactive hygiene guidance and early-stage care plans tailored to your daily routine.',
        full_description:
          'Personalized preventive guidance, hygiene maintenance scheduling, and early protection strategies to help you avoid avoidable dental discomfort.',
        duration_minutes: 30,
        buffer_minutes: 10,
        image_url: '/src/assets/images/treatment_care_1795284233215.jpg',
        sort_order: 6,
      },
    ];

    const insertTreatment = db.prepare(`
      INSERT INTO treatments (slug, name, short_description, full_description, duration_minutes, buffer_minutes, image_url, price_display, is_active, is_featured, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, 1, ?)
    `);
    for (const t of initialTreatments) {
      insertTreatment.run(
        t.slug,
        t.name,
        t.short_description,
        t.full_description,
        t.duration_minutes,
        t.buffer_minutes,
        t.image_url,
        t.sort_order
      );
    }
  }

  // Seed clinic practitioner slot (no fabricated degrees or fake portrait)
  const dentistCount = db.prepare('SELECT COUNT(*) as count FROM dentists').get() as { count: number };
  if (dentistCount.count === 0) {
    const res = db
      .prepare(
        'INSERT INTO dentists (name, title, qualifications, bio, photo_url, is_active, sort_order) VALUES (?, ?, ?, ?, NULL, 1, 1)'
      )
      .run(
        "Dr. Vijaya's Dental Team",
        'Attending Dental Practitioner',
        '',
        'Consultations and routine dental care delivered with a gentle, patient-first approach at Mantri Square Mall. Administrators can add individual dentist profiles and verified credentials from the clinic dashboard.'
      );
    const dentistId = Number(res.lastInsertRowid);

    const allTreatments = db.prepare('SELECT id FROM treatments').all() as { id: number }[];
    const dtStmt = db.prepare('INSERT OR IGNORE INTO dentist_treatments (dentist_id, treatment_id) VALUES (?, ?)');
    for (const t of allTreatments) {
      dtStmt.run(dentistId, t.id);
    }

    const schedStmt = db.prepare(
      'INSERT INTO dentist_schedules (dentist_id, day_of_week, is_working, start_time, end_time) VALUES (?, ?, 1, ?, ?)'
    );
    for (let dow = 0; dow <= 6; dow++) {
      schedStmt.run(dentistId, dow, '10:30', '21:30');
    }
  }

  // Seed website settings
  const defaultSettings: Record<string, string> = {
    announcement_text: 'Your Smile Deserves a Little More Care.',
    promotional_banner: '',
    hero_headline: 'Your Smile Deserves a Little More Care.',
    hero_subtext:
      'Experience comfortable, modern dental care with a gentle approach, personalized attention and a focus on your oral health.',
    hero_image: '/src/assets/images/hero_dental_spa_1795284232745.jpg',
    about_title: 'Calm, Attentive Dental Wellness in the Heart of Seshadripuram',
    about_body:
      'Located on the 1st Floor of Mantri Square Mall opposite Bata Showroom, DrVijayas ToothSpa brings together a soothing boutique atmosphere and attentive clinical care. Whether you are visiting for a routine check-up, gentle teeth cleaning, or a personalized consultation, every visit is unhurried, hygienic, and clearly explained.',
    about_image: '/src/assets/images/clinic_reception_1795284233749.jpg',
    phone: '+91 83101 90730',
    whatsapp_number: '+91 83101 90730',
    address: '1st Floor, Mantri Square Mall, opposite Bata Showroom, Seshadripuram, Bengaluru, Karnataka 560003, India',
    landmark: 'Opposite Bata Showroom, 1st Floor, Mantri Square Mall',
    opening_hours_text: 'Monday to Sunday: 10:30 AM – 9:30 PM',
    google_maps_directions_url:
      'https://www.google.com/maps/search/?api=1&query=DrVijayas+ToothSpa+Mantri+Square+Mall+Seshadripuram+Bengaluru+560003',
    google_maps_reviews_url:
      'https://www.google.com/maps/search/?api=1&query=DrVijayas+ToothSpa+Mantri+Square+Mall+Seshadripuram+Bengaluru',
    social_instagram: '',
    social_facebook: '',
    gallery_items: JSON.stringify([
      {
        id: 'gal-1',
        title: 'Clinic Reception Lounge',
        category: 'Reception',
        caption: 'Warm, calm reception space designed to put patients at ease upon arrival.',
        image_url: '/src/assets/images/clinic_reception_1795284233749.jpg',
      },
      {
        id: 'gal-2',
        title: 'Main Consultation & Care Suite',
        category: 'Patient Care Environment',
        caption: 'Quiet natural-toned suite blending modern clinical ergonomics with spa calm.',
        image_url: '/src/assets/images/hero_dental_spa_1795284232745.jpg',
      },
      {
        id: 'gal-3',
        title: 'Treatment & Hygiene Suite',
        category: 'Dental Treatment Room',
        caption: 'Strict sterilization protocols and modern clinical equipment prepared for every visit.',
        image_url: '/src/assets/images/treatment_hygiene_1795284233321.jpg',
      },
      {
        id: 'gal-4',
        title: 'Consultation Desk & Planning',
        category: 'Dentist Consultation',
        caption: 'Clear visual treatment walkthroughs so every step is transparent before you decide.',
        image_url: '/src/assets/images/treatment_consultation_1795284232947.jpg',
      },
      {
        id: 'gal-5',
        title: 'Preventive Care Instruments',
        category: 'Dental Equipment',
        caption: 'Dedicated preventive care instrumentation maintained under clinical hygiene standards.',
        image_url: '/src/assets/images/treatment_care_1795284233215.jpg',
      },
    ]),
  };

  const insertSetting = db.prepare('INSERT OR IGNORE INTO website_settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaultSettings)) {
    insertSetting.run(k, v);
  }
}

export function getWebsiteSettings(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM website_settings').all() as { key: string; value: string }[];
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

export function logAudit(
  adminId: number | null,
  adminEmail: string,
  action: string,
  entityType: string,
  entityId: string | number,
  details = ''
) {
  db.prepare(
    'INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(adminId, adminEmail, action, entityType, String(entityId), details);
}
