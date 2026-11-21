import crypto from 'node:crypto';
import { db } from './db.ts';

export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatTime12h(hhmm: string): string {
  const [hRaw, m] = hhmm.split(':').map(Number);
  const period = hRaw >= 12 ? 'PM' : 'AM';
  const h = hRaw % 12 === 0 ? 12 : hRaw % 12;
  return `${h}:${String(m).padStart(2, '0')} ${period}`;
}

function getDayOfWeekFromDateStr(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCDay(); // 0 = Sun .. 6 = Sat
}

function getTodayISTDateStr(): string {
  // Clinic is in Bengaluru, India (IST = UTC+5:30)
  const nowIst = new Date(Date.now() + 330 * 60 * 1000);
  return nowIst.toISOString().slice(0, 10);
}

function getNowISTMinutes(): number {
  const nowIst = new Date(Date.now() + 330 * 60 * 1000);
  return nowIst.getUTCHours() * 60 + nowIst.getUTCMinutes();
}

export interface AvailableSlot {
  start_time: string;
  end_time: string;
  label: string;
  available_dentist_ids: number[];
}

export interface SlotQueryResult {
  date: string;
  is_closed: boolean;
  closure_reason: string | null;
  treatment_duration: number;
  slots: AvailableSlot[];
}

export function getAvailableSlots(
  dateStr: string,
  treatmentId: number,
  dentistIdParam: number | 'any',
  excludeAppointmentId?: number
): SlotQueryResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error('Invalid date format. Expected YYYY-MM-DD.');
  }

  const todayIst = getTodayISTDateStr();
  if (dateStr < todayIst) {
    return {
      date: dateStr,
      is_closed: true,
      closure_reason: 'Past dates cannot be booked.',
      treatment_duration: 30,
      slots: [],
    };
  }

  const treatment = db
    .prepare('SELECT id, duration_minutes, buffer_minutes, is_active FROM treatments WHERE id = ?')
    .get(treatmentId) as
    | { id: number; duration_minutes: number; buffer_minutes: number; is_active: number }
    | undefined;

  if (!treatment || !treatment.is_active) {
    throw new Error('Selected treatment is not currently available.');
  }

  const dow = getDayOfWeekFromDateStr(dateStr);
  const clinicHour = db
    .prepare('SELECT * FROM clinic_hours WHERE day_of_week = ?')
    .get(dow) as
    | {
        day_of_week: number;
        is_open: number;
        open_time: string;
        close_time: string;
        slot_interval_minutes: number;
        booking_buffer_minutes: number;
      }
    | undefined;

  if (!clinicHour || !clinicHour.is_open) {
    return {
      date: dateStr,
      is_closed: true,
      closure_reason: 'The clinic is closed on this day.',
      treatment_duration: treatment.duration_minutes,
      slots: [],
    };
  }

  const clinicBlock = db
    .prepare('SELECT reason FROM blocked_dates WHERE date = ? AND dentist_id IS NULL LIMIT 1')
    .get(dateStr) as { reason: string } | undefined;

  if (clinicBlock) {
    return {
      date: dateStr,
      is_closed: true,
      closure_reason: clinicBlock.reason || 'Clinic closed on this date.',
      treatment_duration: treatment.duration_minutes,
      slots: [],
    };
  }

  // Find eligible active dentists assigned to this treatment
  let eligibleDentists: { id: number }[];
  if (dentistIdParam === 'any') {
    eligibleDentists = db
      .prepare(
        `SELECT d.id FROM dentists d
         INNER JOIN dentist_treatments dt ON dt.dentist_id = d.id
         WHERE d.is_active = 1 AND dt.treatment_id = ?
         ORDER BY d.sort_order ASC, d.id ASC`
      )
      .all(treatmentId) as { id: number }[];
  } else {
    eligibleDentists = db
      .prepare(
        `SELECT d.id FROM dentists d
         INNER JOIN dentist_treatments dt ON dt.dentist_id = d.id
         WHERE d.is_active = 1 AND d.id = ? AND dt.treatment_id = ?`
      )
      .all(dentistIdParam, treatmentId) as { id: number }[];
  }

  if (eligibleDentists.length === 0) {
    return {
      date: dateStr,
      is_closed: false,
      closure_reason: 'No dentists are currently assigned for this treatment.',
      treatment_duration: treatment.duration_minutes,
      slots: [],
    };
  }

  const effectiveBuffer = Math.max(treatment.buffer_minutes ?? 0, clinicHour.booking_buffer_minutes ?? 0);
  const clinicOpenMin = timeToMinutes(clinicHour.open_time);
  const clinicCloseMin = timeToMinutes(clinicHour.close_time);
  const interval = Math.max(15, clinicHour.slot_interval_minutes || 15);
  const nowMinutesToday = dateStr === todayIst ? getNowISTMinutes() + 30 : -1; // 30-min minimum lead time today

  // Preload schedules, blocked dates, and active appointments for each eligible dentist
  const dentistContexts = eligibleDentists
    .map((d) => {
      const blocked = db
        .prepare('SELECT reason FROM blocked_dates WHERE date = ? AND dentist_id = ? LIMIT 1')
        .get(dateStr, d.id) as { reason: string } | undefined;
      if (blocked) return null;

      const schedule = db
        .prepare('SELECT is_working, start_time, end_time FROM dentist_schedules WHERE dentist_id = ? AND day_of_week = ?')
        .get(d.id, dow) as { is_working: number; start_time: string; end_time: string } | undefined;
      if (!schedule || !schedule.is_working) return null;

      const workStart = Math.max(clinicOpenMin, timeToMinutes(schedule.start_time));
      const workEnd = Math.min(clinicCloseMin, timeToMinutes(schedule.end_time));
      if (workEnd - workStart < treatment.duration_minutes) return null;

      const existing = db
        .prepare(
          `SELECT id, start_time, end_time, buffer_minutes FROM appointments
           WHERE appointment_date = ? AND assigned_dentist_id = ? AND status NOT IN ('Cancelled', 'No-show')`
        )
        .all(dateStr, d.id) as {
        id: number;
        start_time: string;
        end_time: string;
        buffer_minutes: number;
      }[];

      const busyWindows = existing
        .filter((a) => (excludeAppointmentId ? a.id !== excludeAppointmentId : true))
        .map((a) => ({
          start: timeToMinutes(a.start_time),
          endWithBuffer: timeToMinutes(a.end_time) + (a.buffer_minutes || 0),
        }));

      return { dentistId: d.id, workStart, workEnd, busyWindows };
    })
    .filter((ctx): ctx is NonNullable<typeof ctx> => ctx !== null);

  if (dentistContexts.length === 0) {
    return {
      date: dateStr,
      is_closed: false,
      closure_reason:
        dentistIdParam === 'any'
          ? 'All dentists are unavailable on this date.'
          : 'Selected dentist is unavailable on this date.',
      treatment_duration: treatment.duration_minutes,
      slots: [],
    };
  }

  const slots: AvailableSlot[] = [];
  for (let startMin = clinicOpenMin; startMin + treatment.duration_minutes <= clinicCloseMin; startMin += interval) {
    if (nowMinutesToday >= 0 && startMin < nowMinutesToday) {
      continue;
    }
    const endMin = startMin + treatment.duration_minutes;
    const endWithBufferMin = endMin + effectiveBuffer;

    const freeDentistIds: number[] = [];
    for (const ctx of dentistContexts) {
      if (startMin < ctx.workStart || endMin > ctx.workEnd) {
        continue;
      }
      const overlaps = ctx.busyWindows.some(
        (w) => startMin < w.endWithBuffer && endWithBufferMin > w.start
      );
      if (!overlaps) {
        freeDentistIds.push(ctx.dentistId);
      }
    }

    if (freeDentistIds.length > 0) {
      const startTime = minutesToTime(startMin);
      const endTime = minutesToTime(endMin);
      slots.push({
        start_time: startTime,
        end_time: endTime,
        label: formatTime12h(startTime),
        available_dentist_ids: freeDentistIds,
      });
    }
  }

  return {
    date: dateStr,
    is_closed: false,
    closure_reason: null,
    treatment_duration: treatment.duration_minutes,
    slots,
  };
}

function generateBookingRef(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    suffix += chars[bytes[i] % chars.length];
  }
  return `TS-${suffix}`;
}

export interface CreateBookingInput {
  full_name: string;
  phone: string;
  email?: string;
  treatment_id: number;
  dentist_id: number | 'any';
  appointment_date: string;
  start_time: string;
  notes?: string;
  consent_accepted: boolean;
}

export function createBookingTransaction(input: CreateBookingInput) {
  if (!input.consent_accepted) {
    throw new Error('Patient privacy consent is required.');
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const slotQuery = getAvailableSlots(
      input.appointment_date,
      input.treatment_id,
      input.dentist_id
    );

    if (slotQuery.is_closed) {
      throw new Error(slotQuery.closure_reason || 'Selected date is unavailable.');
    }

    const matchedSlot = slotQuery.slots.find((s) => s.start_time === input.start_time);
    if (!matchedSlot || matchedSlot.available_dentist_ids.length === 0) {
      const err = new Error('This time slot is no longer available. Please choose another available slot.');
      (err as Error & { statusCode?: number }).statusCode = 409;
      throw err;
    }

    const assignedDentistId = matchedSlot.available_dentist_ids[0];
    const treatment = db
      .prepare('SELECT id, name, duration_minutes, buffer_minutes FROM treatments WHERE id = ?')
      .get(input.treatment_id) as { id: number; name: string; duration_minutes: number; buffer_minutes: number };

    const dow = getDayOfWeekFromDateStr(input.appointment_date);
    const clinicHour = db
      .prepare('SELECT booking_buffer_minutes FROM clinic_hours WHERE day_of_week = ?')
      .get(dow) as { booking_buffer_minutes: number } | undefined;

    const effectiveBuffer = Math.max(treatment.buffer_minutes ?? 0, clinicHour?.booking_buffer_minutes ?? 0);

    // Normalize phone digits for lookup
    const normalizedPhone = input.phone.trim();
    const existingPatient = db
      .prepare('SELECT id FROM patients WHERE phone = ? AND lower(full_name) = lower(?) LIMIT 1')
      .get(normalizedPhone, input.full_name.trim()) as { id: number } | undefined;

    let patientId: number;
    if (existingPatient) {
      patientId = existingPatient.id;
      if (input.email) {
        db.prepare('UPDATE patients SET email = ? WHERE id = ?').run(input.email.trim(), patientId);
      }
    } else {
      const pRes = db
        .prepare('INSERT INTO patients (full_name, phone, email) VALUES (?, ?, ?)')
        .run(input.full_name.trim(), normalizedPhone, input.email?.trim() || null);
      patientId = Number(pRes.lastInsertRowid);
    }

    let bookingRef = generateBookingRef();
    while (db.prepare('SELECT 1 FROM appointments WHERE booking_ref = ?').get(bookingRef)) {
      bookingRef = generateBookingRef();
    }

    const apptRes = db
      .prepare(
        `INSERT INTO appointments (
          booking_ref, patient_id, requested_dentist_id, assigned_dentist_id, treatment_id,
          appointment_date, start_time, end_time, duration_minutes, buffer_minutes,
          status, notes, consent_accepted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, 1)`
      )
      .run(
        bookingRef,
        patientId,
        input.dentist_id === 'any' ? null : input.dentist_id,
        assignedDentistId,
        input.treatment_id,
        input.appointment_date,
        matchedSlot.start_time,
        matchedSlot.end_time,
        treatment.duration_minutes,
        effectiveBuffer,
        (input.notes || '').trim().slice(0, 500)
      );

    const appointmentId = Number(apptRes.lastInsertRowid);
    db.exec('COMMIT');

    return getAppointmentDetailById(appointmentId);
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore if already rolled back
    }
    throw err;
  }
}

export function rescheduleAppointmentTransaction(
  appointmentId: number,
  newDate: string,
  newStartTime: string,
  newDentistId?: number | 'any'
) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db
      .prepare('SELECT * FROM appointments WHERE id = ?')
      .get(appointmentId) as
      | {
          id: number;
          treatment_id: number;
          assigned_dentist_id: number;
          requested_dentist_id: number | null;
          status: string;
        }
      | undefined;

    if (!existing) {
      throw new Error('Appointment not found.');
    }
    if (existing.status === 'Cancelled' || existing.status === 'Completed') {
      throw new Error(`Cannot reschedule an appointment that is ${existing.status}.`);
    }

    const dentistChoice: number | 'any' =
      newDentistId !== undefined
        ? newDentistId
        : existing.requested_dentist_id ?? existing.assigned_dentist_id;

    const slotQuery = getAvailableSlots(
      newDate,
      existing.treatment_id,
      dentistChoice,
      appointmentId
    );
    const matchedSlot = slotQuery.slots.find((s) => s.start_time === newStartTime);
    if (!matchedSlot || matchedSlot.available_dentist_ids.length === 0) {
      const err = new Error('Selected reschedule slot is unavailable.');
      (err as Error & { statusCode?: number }).statusCode = 409;
      throw err;
    }

    const assignedDentistId = matchedSlot.available_dentist_ids[0];
    db.prepare(
      `UPDATE appointments
       SET appointment_date = ?, start_time = ?, end_time = ?,
           requested_dentist_id = ?, assigned_dentist_id = ?,
           status = 'Pending', updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      newDate,
      matchedSlot.start_time,
      matchedSlot.end_time,
      dentistChoice === 'any' ? null : dentistChoice,
      assignedDentistId,
      appointmentId
    );

    db.exec('COMMIT');
    return getAppointmentDetailById(appointmentId);
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  }
}

export interface AdminEditAppointmentInput {
  patient_name: string;
  patient_phone: string;
  patient_email?: string | null;
  treatment_id: number;
  assigned_dentist_id: number;
  appointment_date: string;
  start_time: string;
  status: 'Pending' | 'Confirmed' | 'Completed' | 'Cancelled' | 'No-show';
  notes?: string;
}

export function adminEditAppointmentTransaction(
  appointmentId: number,
  input: AdminEditAppointmentInput
) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db
      .prepare('SELECT * FROM appointments WHERE id = ?')
      .get(appointmentId) as
      | {
          id: number;
          patient_id: number;
          treatment_id: number;
          assigned_dentist_id: number;
          appointment_date: string;
          start_time: string;
          duration_minutes: number;
          buffer_minutes: number;
          status: string;
        }
      | undefined;

    if (!existing) {
      const err = new Error('Appointment not found.');
      (err as Error & { statusCode?: number }).statusCode = 404;
      throw err;
    }

    const treatment = db
      .prepare('SELECT id, duration_minutes, buffer_minutes FROM treatments WHERE id = ?')
      .get(input.treatment_id) as
      | { id: number; duration_minutes: number; buffer_minutes: number }
      | undefined;

    if (!treatment) {
      throw new Error('Selected treatment does not exist.');
    }

    const dentist = db
      .prepare('SELECT id FROM dentists WHERE id = ?')
      .get(input.assigned_dentist_id) as { id: number } | undefined;

    if (!dentist) {
      throw new Error('Selected dentist does not exist.');
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.appointment_date)) {
      throw new Error('Invalid date format. Expected YYYY-MM-DD.');
    }
    if (!/^\d{2}:\d{2}$/.test(input.start_time)) {
      throw new Error('Invalid time format. Expected HH:MM.');
    }

    const startMin = timeToMinutes(input.start_time);
    const endMin = startMin + treatment.duration_minutes;
    const endTime = minutesToTime(endMin);

    // Check overlap only if the resulting appointment is active
    if (input.status !== 'Cancelled' && input.status !== 'No-show') {
      const dow = getDayOfWeekFromDateStr(input.appointment_date);
      const clinicHour = db
        .prepare('SELECT booking_buffer_minutes FROM clinic_hours WHERE day_of_week = ?')
        .get(dow) as { booking_buffer_minutes: number } | undefined;

      const effectiveBuffer = Math.max(
        treatment.buffer_minutes ?? 0,
        clinicHour?.booking_buffer_minutes ?? 0
      );

      const conflicts = db
        .prepare(
          `SELECT id, start_time, end_time, buffer_minutes
           FROM appointments
           WHERE assigned_dentist_id = ?
             AND appointment_date = ?
             AND id != ?
             AND status NOT IN ('Cancelled', 'No-show')`
        )
        .all(input.assigned_dentist_id, input.appointment_date, appointmentId) as {
        id: number;
        start_time: string;
        end_time: string;
        buffer_minutes: number;
      }[];

      const proposedEndBuffered = endMin + effectiveBuffer;
      for (const c of conflicts) {
        const cStart = timeToMinutes(c.start_time);
        const cEnd = timeToMinutes(c.end_time) + (c.buffer_minutes || 0);
        if (startMin < cEnd && proposedEndBuffered > cStart) {
          const err = new Error(
            'This dentist already has an overlapping appointment during that time slot.'
          );
          (err as Error & { statusCode?: number }).statusCode = 409;
          throw err;
        }
      }
    }

    db.prepare('UPDATE patients SET full_name = ?, phone = ?, email = ? WHERE id = ?').run(
      input.patient_name.trim(),
      input.patient_phone.trim(),
      input.patient_email ? input.patient_email.trim() : null,
      existing.patient_id
    );

    db.prepare(
      `UPDATE appointments
       SET treatment_id = ?,
           assigned_dentist_id = ?,
           appointment_date = ?,
           start_time = ?,
           end_time = ?,
           duration_minutes = ?,
           status = ?,
           notes = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      input.treatment_id,
      input.assigned_dentist_id,
      input.appointment_date,
      input.start_time,
      endTime,
      treatment.duration_minutes,
      input.status,
      (input.notes || '').trim().slice(0, 500),
      appointmentId
    );

    db.exec('COMMIT');
    return getAppointmentDetailById(appointmentId);
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  }
}

export function getAppointmentDetailById(appointmentId: number) {
  return db
    .prepare(
      `SELECT
        a.id, a.booking_ref, a.appointment_date, a.start_time, a.end_time,
        a.duration_minutes, a.status, a.notes, a.created_at, a.updated_at,
        a.requested_dentist_id, a.assigned_dentist_id, a.treatment_id,
        p.full_name as patient_name, p.phone as patient_phone, p.email as patient_email,
        t.name as treatment_name, t.slug as treatment_slug,
        d.name as dentist_name, d.title as dentist_title
      FROM appointments a
      INNER JOIN patients p ON p.id = a.patient_id
      INNER JOIN treatments t ON t.id = a.treatment_id
      INNER JOIN dentists d ON d.id = a.assigned_dentist_id
      WHERE a.id = ?`
    )
    .get(appointmentId);
}
