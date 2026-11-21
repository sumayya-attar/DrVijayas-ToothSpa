import nodemailer from 'nodemailer';
import { db, getWebsiteSettings } from './db.ts';
import { formatTime12h } from './booking.ts';

interface NotificationAppointmentInfo {
  id: number;
  booking_ref: string;
  patient_name: string;
  patient_phone: string;
  patient_email?: string | null;
  treatment_name: string;
  dentist_name: string;
  appointment_date: string;
  start_time: string;
  status: string;
}

export interface NotificationDeliveryResult {
  email: 'sent' | 'skipped_unconfigured' | 'skipped_no_email' | 'failed';
  whatsapp: 'sent' | 'skipped_unconfigured' | 'failed';
}

export async function dispatchBookingNotifications(
  appt: NotificationAppointmentInfo,
  eventLabel: 'created' | 'confirmed' | 'rescheduled' | 'cancelled'
): Promise<NotificationDeliveryResult> {
  const settings = getWebsiteSettings();
  const formattedTime = formatTime12h(appt.start_time);
  const clinicAddress = settings.address || '1st Floor, Mantri Square Mall, Seshadripuram, Bengaluru 560003';
  const clinicPhone = settings.phone || '+91 83101 90730';

  const result: NotificationDeliveryResult = {
    email: 'skipped_no_email',
    whatsapp: 'skipped_unconfigured',
  };

  // 1. Email notification via Nodemailer if SMTP configured and patient provided email
  if (appt.patient_email) {
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

        const subjectMap = {
          created: `Appointment Request Received (${appt.booking_ref}) – DrVijayas ToothSpa`,
          confirmed: `Appointment Confirmed (${appt.booking_ref}) – DrVijayas ToothSpa`,
          rescheduled: `Appointment Rescheduled (${appt.booking_ref}) – DrVijayas ToothSpa`,
          cancelled: `Appointment Cancelled (${appt.booking_ref}) – DrVijayas ToothSpa`,
        };

        await transporter.sendMail({
          from: process.env.SMTP_FROM || `DrVijayas ToothSpa <${smtpUser}>`,
          to: appt.patient_email,
          subject: subjectMap[eventLabel],
          text: [
            `Dear ${appt.patient_name},`,
            '',
            `Your appointment (${appt.booking_ref}) status is: ${appt.status}.`,
            `Treatment: ${appt.treatment_name}`,
            `Dentist: ${appt.dentist_name}`,
            `Date: ${appt.appointment_date}`,
            `Time: ${formattedTime}`,
            `Location: ${clinicAddress}`,
            `Clinic Phone: ${clinicPhone}`,
            '',
            'Note: Online bookings are subject to clinic confirmation.',
            'Warm regards,',
            'DrVijayas ToothSpa',
          ].join('\n'),
        });

        result.email = 'sent';
        db.prepare(
          'INSERT INTO notifications (appointment_id, channel, recipient, status, provider_response) VALUES (?, ?, ?, ?, ?)'
        ).run(appt.id, 'email', appt.patient_email, 'sent', 'SMTP delivery succeeded');
      } catch (err) {
        result.email = 'failed';
        db.prepare(
          'INSERT INTO notifications (appointment_id, channel, recipient, status, provider_response) VALUES (?, ?, ?, ?, ?)'
        ).run(
          appt.id,
          'email',
          appt.patient_email,
          'failed',
          err instanceof Error ? err.message : 'SMTP error'
        );
      }
    } else {
      result.email = 'skipped_unconfigured';
      db.prepare(
        'INSERT INTO notifications (appointment_id, channel, recipient, status, provider_response) VALUES (?, ?, ?, ?, ?)'
      ).run(
        appt.id,
        'email',
        appt.patient_email,
        'skipped_unconfigured',
        'SMTP_HOST/SMTP_USER/SMTP_PASS not configured'
      );
    }
  }

  // 2. WhatsApp Business Cloud API if configured
  const waToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const waPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const normalizedWaRecipient = appt.patient_phone.replace(/[^0-9]/g, '');

  if (waToken && waPhoneId && normalizedWaRecipient.length >= 10) {
    try {
      const toNumber =
        normalizedWaRecipient.length === 10 ? `91${normalizedWaRecipient}` : normalizedWaRecipient;
      const resp = await fetch(`https://graph.facebook.com/v19.0/${waPhoneId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${waToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: toNumber,
          type: 'text',
          text: {
            body: `DrVijayas ToothSpa (${appt.booking_ref}): ${appt.treatment_name} on ${appt.appointment_date} at ${formattedTime} with ${appt.dentist_name}. Status: ${appt.status}. Location: ${clinicAddress}.`,
          },
        }),
      });
      if (resp.ok) {
        result.whatsapp = 'sent';
        db.prepare(
          'INSERT INTO notifications (appointment_id, channel, recipient, status, provider_response) VALUES (?, ?, ?, ?, ?)'
        ).run(appt.id, 'whatsapp', toNumber, 'sent', 'WhatsApp Cloud API accepted');
      } else {
        const errText = await resp.text();
        result.whatsapp = 'failed';
        db.prepare(
          'INSERT INTO notifications (appointment_id, channel, recipient, status, provider_response) VALUES (?, ?, ?, ?, ?)'
        ).run(appt.id, 'whatsapp', toNumber, 'failed', errText.slice(0, 300));
      }
    } catch (err) {
      result.whatsapp = 'failed';
      db.prepare(
        'INSERT INTO notifications (appointment_id, channel, recipient, status, provider_response) VALUES (?, ?, ?, ?, ?)'
      ).run(
        appt.id,
        'whatsapp',
        appt.patient_phone,
        'failed',
        err instanceof Error ? err.message : 'WhatsApp network error'
      );
    }
  } else {
    result.whatsapp = 'skipped_unconfigured';
    db.prepare(
      'INSERT INTO notifications (appointment_id, channel, recipient, status, provider_response) VALUES (?, ?, ?, ?, ?)'
    ).run(
      appt.id,
      'whatsapp',
      appt.patient_phone,
      'skipped_unconfigured',
      'WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not configured'
    );
  }

  return result;
}
