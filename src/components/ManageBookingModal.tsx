import { useState, useEffect } from 'react';
import { Calendar, Clock, Loader2, Search, X } from 'lucide-react';
import type { Appointment, AvailableSlot } from '../types/clinic';
import { formatDisplayDate, formatTime12h } from '../lib/format';

interface ManageBookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  prefillRef?: string;
}

export function ManageBookingModal({ isOpen, onClose, prefillRef }: ManageBookingModalProps) {
  const [bookingRef, setBookingRef] = useState(prefillRef || '');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appointment, setAppointment] = useState<Appointment | null>(null);

  const [rescheduleMode, setRescheduleMode] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [newTime, setNewTime] = useState('');
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    if (prefillRef) setBookingRef(prefillRef);
  }, [prefillRef]);

  useEffect(() => {
    if (!rescheduleMode || !newDate || !appointment) return;
    let cancelled = false;
    setSlotsLoading(true);
    fetch(
      `/api/slots?date=${newDate}&treatmentId=${appointment.treatment_id}&dentistId=${appointment.requested_dentist_id ?? 'any'}`
    )
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setSlots(Array.isArray(data.slots) ? data.slots : []);
        }
      })
      .catch(() => {
        if (!cancelled) setSlots([]);
      })
      .finally(() => {
        if (!cancelled) setSlotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rescheduleMode, newDate, appointment]);

  if (!isOpen) return null;

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setActionMessage(null);
    setLoading(true);
    try {
      const resp = await fetch('/api/appointments/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_ref: bookingRef.trim(), phone: phone.trim() }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error || 'Could not find appointment.');
        setAppointment(null);
        return;
      }
      setAppointment(data.appointment);
      setRescheduleMode(false);
    } catch {
      setError('Network error while looking up booking.');
    } finally {
      setLoading(false);
    }
  };

  const handleReschedule = async () => {
    if (!appointment || !newDate || !newTime) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/appointments/reschedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_ref: appointment.booking_ref,
          phone: phone.trim(),
          new_date: newDate,
          new_start_time: newTime,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error || 'Failed to reschedule.');
        return;
      }
      setAppointment(data.appointment);
      setRescheduleMode(false);
      setActionMessage('Your appointment has been rescheduled and is pending clinic confirmation.');
    } catch {
      setError('Network error while rescheduling.');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!appointment) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/appointments/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_ref: appointment.booking_ref,
          phone: phone.trim(),
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error || 'Failed to cancel.');
        return;
      }
      setAppointment(data.appointment);
      setActionMessage('Your appointment has been cancelled and the time slot released.');
    } catch {
      setError('Network error while cancelling.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#252A27]/60 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manage-booking-title"
    >
      <div className="bg-[#FAF8F2] border border-[#252A27]/15 rounded-2xl max-w-xl w-full max-h-[90vh] flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#252A27]/10">
          <h2 id="manage-booking-title" className="font-display text-2xl font-semibold text-[#234536]">
            Manage Your Appointment
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close manage booking modal"
            className="p-2 rounded-lg text-[#252A27]/70 hover:bg-[#EEE9DF]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5">
          <form onSubmit={handleLookup} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="lookup-ref" className="block text-xs font-medium text-[#252A27] mb-1">
                  Booking Reference
                </label>
                <input
                  id="lookup-ref"
                  type="text"
                  required
                  value={bookingRef}
                  onChange={(e) => setBookingRef(e.target.value.toUpperCase())}
                  placeholder="TS-XXXXXX"
                  className="w-full px-3.5 py-2 rounded-lg border border-[#252A27]/20 bg-white text-sm font-mono uppercase focus:outline-none focus:border-[#365B4B]"
                />
              </div>
              <div>
                <label htmlFor="lookup-phone" className="block text-xs font-medium text-[#252A27] mb-1">
                  Registered Mobile Number
                </label>
                <input
                  id="lookup-phone"
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="10-digit mobile number"
                  className="w-full px-3.5 py-2 rounded-lg border border-[#252A27]/20 bg-white text-sm focus:outline-none focus:border-[#365B4B]"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#365B4B] text-white text-sm font-medium hover:bg-[#234536] disabled:opacity-60"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Find My Booking
            </button>
          </form>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
              {error}
            </div>
          )}

          {actionMessage && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
              {actionMessage}
            </div>
          )}

          {appointment && (
            <div className="rounded-xl bg-white border border-[#252A27]/12 p-5 space-y-4">
              <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#252A27]/10">
                <span className="font-mono text-base font-semibold text-[#234536]">
                  {appointment.booking_ref}
                </span>
                <span className="text-xs font-semibold text-[#365B4B]">
                  Status: {appointment.status}
                </span>
              </div>

              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-[#252A27]/60">Patient</dt>
                  <dd className="font-medium">{appointment.patient_name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[#252A27]/60">Treatment</dt>
                  <dd className="font-medium">{appointment.treatment_name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[#252A27]/60">Dentist</dt>
                  <dd className="font-medium">{appointment.dentist_name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[#252A27]/60">Date & Time</dt>
                  <dd className="font-medium tabular-nums">
                    {formatDisplayDate(appointment.appointment_date)} · {formatTime12h(appointment.start_time)}
                  </dd>
                </div>
              </dl>

              {appointment.status !== 'Cancelled' && appointment.status !== 'Completed' && (
                <div className="pt-3 border-t border-[#252A27]/10 space-y-3">
                  {!rescheduleMode ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setRescheduleMode(true);
                          setNewDate(appointment.appointment_date);
                          setNewTime('');
                        }}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg border border-[#365B4B] text-[#365B4B] text-xs font-medium hover:bg-[#FAF8F2]"
                      >
                        <Calendar className="w-3.5 h-3.5" />
                        Reschedule
                      </button>
                      <button
                        type="button"
                        onClick={handleCancel}
                        disabled={loading}
                        className="flex-1 px-4 py-2 rounded-lg border border-red-300 text-red-700 text-xs font-medium hover:bg-red-50"
                      >
                        Cancel Appointment
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3 bg-[#FAF8F2] p-4 rounded-lg border border-[#252A27]/10">
                      <div>
                        <label htmlFor="resched-date" className="block text-xs font-medium mb-1">
                          New Date
                        </label>
                        <input
                          id="resched-date"
                          type="date"
                          value={newDate}
                          min={new Date().toISOString().slice(0, 10)}
                          onChange={(e) => {
                            setNewDate(e.target.value);
                            setNewTime('');
                          }}
                          className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20 bg-white text-sm"
                        />
                      </div>

                      <div>
                        <p className="text-xs font-medium mb-1.5 flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-[#365B4B]" />
                          Available Time Slots
                        </p>
                        {slotsLoading ? (
                          <p className="text-xs text-[#252A27]/60">Loading slots...</p>
                        ) : slots.length === 0 ? (
                          <p className="text-xs text-[#252A27]/60">No open slots on this date.</p>
                        ) : (
                          <div className="grid grid-cols-3 gap-2 max-h-36 overflow-y-auto">
                            {slots.map((s) => (
                              <button
                                key={s.start_time}
                                type="button"
                                onClick={() => setNewTime(s.start_time)}
                                className={`py-1.5 px-2 rounded text-xs font-medium tabular-nums border ${
                                  newTime === s.start_time
                                    ? 'bg-[#365B4B] text-white border-[#365B4B]'
                                    : 'bg-white border-[#252A27]/15'
                                }`}
                              >
                                {s.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleReschedule}
                          disabled={!newTime || loading}
                          className="flex-1 px-4 py-2 rounded-lg bg-[#365B4B] text-white text-xs font-medium disabled:opacity-50"
                        >
                          Confirm Reschedule
                        </button>
                        <button
                          type="button"
                          onClick={() => setRescheduleMode(false)}
                          className="px-4 py-2 rounded-lg border border-[#252A27]/15 text-xs font-medium"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
