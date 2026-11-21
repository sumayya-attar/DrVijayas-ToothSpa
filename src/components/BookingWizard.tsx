import { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Calendar as CalendarIcon,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Info,
  Loader2,
  MapPin,
  MessageCircle,
  Phone,
  UserCheck,
} from 'lucide-react';
import type {
  Appointment,
  AvailableSlot,
  Dentist,
  Treatment,
  WebsiteSettings,
} from '../types/clinic';
import {
  buildTelHref,
  buildWhatsAppUrl,
  formatDisplayDate,
  formatTime12h,
  getInitials,
} from '../lib/format';
import { ClinicImage } from './ClinicImage';
import type { LegalTopic } from './LegalPages';

interface BookingWizardProps {
  treatments: Treatment[];
  dentists: Dentist[];
  settings: WebsiteSettings;
  preselectedTreatmentId?: number | null;
  onOpenLegal: (topic: LegalTopic) => void;
  onOpenManageBooking: (prefillRef?: string) => void;
}

interface CalendarDayInfo {
  date: string;
  available: boolean;
  slotCount: number;
  reason: string | null;
}

const STEPS = [
  { id: 1, label: 'Treatment' },
  { id: 2, label: 'Dentist' },
  { id: 3, label: 'Date' },
  { id: 4, label: 'Time' },
  { id: 5, label: 'Details' },
  { id: 6, label: 'Confirmed' },
];

function getIstMonthString(offsetMonths = 0): string {
  const nowIst = new Date(Date.now() + 330 * 60 * 1000);
  const dt = new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth() + offsetMonths, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function BookingWizard({
  treatments,
  dentists,
  settings,
  preselectedTreatmentId,
  onOpenLegal,
  onOpenManageBooking,
}: BookingWizardProps) {
  const [step, setStep] = useState(1);
  const [selectedTreatmentId, setSelectedTreatmentId] = useState<number | null>(
    preselectedTreatmentId || null
  );
  const [selectedDentistId, setSelectedDentistId] = useState<number | 'any'>('any');
  const [calendarMonth, setCalendarMonth] = useState<string>(() => getIstMonthString(0));
  const [calendarDays, setCalendarDays] = useState<CalendarDayInfo[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);

  const [selectedDate, setSelectedDate] = useState<string>('');
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsMessage, setSlotsMessage] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string>('');

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [consentAccepted, setConsentAccepted] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmedBooking, setConfirmedBooking] = useState<Appointment | null>(null);
  const [notificationStatus, setNotificationStatus] = useState<{
    email: string;
    whatsapp: string;
  } | null>(null);
  const [supabaseSynced, setSupabaseSynced] = useState(false);

  useEffect(() => {
    if (preselectedTreatmentId) {
      setSelectedTreatmentId(preselectedTreatmentId);
      setStep((prev) => (prev === 1 ? 2 : prev));
    }
  }, [preselectedTreatmentId]);

  const selectedTreatment = useMemo(
    () => treatments.find((t) => t.id === selectedTreatmentId) || null,
    [treatments, selectedTreatmentId]
  );

  const consultationTreatment = useMemo(
    () =>
      treatments.find((t) => t.slug === 'dental-consultation') ||
      treatments.find((t) => t.name.toLowerCase().includes('consultation')) ||
      treatments[0] ||
      null,
    [treatments]
  );

  const eligibleDentists = useMemo(() => {
    if (!selectedTreatmentId) return dentists;
    return dentists.filter(
      (d) => d.treatment_ids.length === 0 || d.treatment_ids.includes(selectedTreatmentId)
    );
  }, [dentists, selectedTreatmentId]);

  const selectedDentistObj = useMemo(() => {
    if (selectedDentistId === 'any') return null;
    return dentists.find((d) => d.id === selectedDentistId) || null;
  }, [dentists, selectedDentistId]);

  // Load month availability whenever treatment/dentist/month changes on step 3+
  useEffect(() => {
    if (!selectedTreatmentId || step < 3 || step === 6) return;
    let cancelled = false;
    setCalendarLoading(true);
    fetch(
      `/api/availability/calendar?month=${calendarMonth}&treatmentId=${selectedTreatmentId}&dentistId=${selectedDentistId}`
    )
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data.days)) {
          setCalendarDays(data.days);
        }
      })
      .catch(() => {
        if (!cancelled) setCalendarDays([]);
      })
      .finally(() => {
        if (!cancelled) setCalendarLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [calendarMonth, selectedTreatmentId, selectedDentistId, step]);

  // Load slots when date is selected
  useEffect(() => {
    if (!selectedDate || !selectedTreatmentId) return;
    let cancelled = false;
    setSlotsLoading(true);
    setSlotsMessage(null);
    fetch(
      `/api/slots?date=${selectedDate}&treatmentId=${selectedTreatmentId}&dentistId=${selectedDentistId}`
    )
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setSlots([]);
          setSlotsMessage(data.error);
          return;
        }
        setSlots(Array.isArray(data.slots) ? data.slots : []);
        if (data.is_closed || (Array.isArray(data.slots) && data.slots.length === 0)) {
          setSlotsMessage(data.closure_reason || 'No slots available for this date.');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSlots([]);
          setSlotsMessage('Unable to check available time slots. Please try again.');
        }
      })
      .finally(() => {
        if (!cancelled) setSlotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDate, selectedTreatmentId, selectedDentistId]);

  const monthCalendarGrid = useMemo(() => {
    const [year, month] = calendarMonth.split('-').map(Number);
    const firstDayDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const leadingBlanks = Array.from({ length: firstDayDow }, () => null);
    return [...leadingBlanks, ...calendarDays];
  }, [calendarMonth, calendarDays]);

  const monthLabel = useMemo(() => {
    const [year, month] = calendarMonth.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-IN', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }, [calendarMonth]);

  const groupedSlots = useMemo(() => {
    const morning: AvailableSlot[] = [];
    const afternoon: AvailableSlot[] = [];
    const evening: AvailableSlot[] = [];
    for (const s of slots) {
      const hour = Number(s.start_time.split(':')[0]);
      if (hour < 12) morning.push(s);
      else if (hour < 17) afternoon.push(s);
      else evening.push(s);
    }
    return { morning, afternoon, evening };
  }, [slots]);

  const handleSubmitBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    const digits = phone.replace(/[^0-9]/g, '');
    if (fullName.trim().length < 2) {
      setSubmitError('Please enter your full name.');
      return;
    }
    if (digits.length < 10) {
      setSubmitError('Please enter a valid 10-digit mobile number.');
      return;
    }
    if (!consentAccepted) {
      setSubmitError('Please accept the patient privacy consent checkbox before submitting.');
      return;
    }

    setSubmitting(true);
    try {
      const resp = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName.trim(),
          phone: phone.trim(),
          email: email.trim() || undefined,
          treatment_id: selectedTreatmentId,
          dentist_id: selectedDentistId,
          appointment_date: selectedDate,
          start_time: selectedTime,
          notes: notes.trim(),
          consent_accepted: consentAccepted,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setSubmitError(data.error || 'Could not reserve this slot. Please try again.');
        if (resp.status === 409) {
          setSelectedTime('');
        }
        return;
      }
      setConfirmedBooking(data.appointment);
      setNotificationStatus(data.notifications || null);
      setSupabaseSynced(Boolean(data.supabase?.synced));
      setStep(6);
    } catch {
      setSubmitError('Network error while booking your appointment. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const resetWizard = () => {
    setStep(1);
    setSelectedTreatmentId(null);
    setSelectedDentistId('any');
    setSelectedDate('');
    setSelectedTime('');
    setFullName('');
    setPhone('');
    setEmail('');
    setNotes('');
    setConsentAccepted(false);
    setConfirmedBooking(null);
    setSupabaseSynced(false);
    setSubmitError(null);
  };

  const handleStepNav = (targetStep: number) => {
    if (step === 6) return;
    if (targetStep < step) {
      setStep(targetStep);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-[#252A27]/10 overflow-hidden shadow-xs">
      {/* Stepper Header */}
      <div className="bg-[#FAF8F2] border-b border-[#252A27]/10 px-5 sm:px-8 py-4">
        <div className="flex items-center justify-between gap-2 overflow-x-auto">
          {STEPS.map((s, idx) => {
            const isCompleted = step > s.id;
            const isCurrent = step === s.id;
            return (
              <div key={s.id} className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleStepNav(s.id)}
                  disabled={s.id >= step || step === 6}
                  className={`flex items-center gap-2 text-xs font-medium whitespace-nowrap transition-colors ${
                    isCurrent
                      ? 'text-[#234536]'
                      : isCompleted
                        ? 'text-[#365B4B] hover:text-[#234536] cursor-pointer'
                        : 'text-[#252A27]/40 cursor-default'
                  }`}
                >
                  <span
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] tabular-nums border ${
                      isCurrent
                        ? 'bg-[#365B4B] text-white border-[#365B4B]'
                        : isCompleted
                          ? 'bg-[#EEE9DF] text-[#234536] border-[#365B4B]/30'
                          : 'bg-white text-[#252A27]/45 border-[#252A27]/15'
                    }`}
                  >
                    {isCompleted ? <Check className="w-3.5 h-3.5" /> : s.id}
                  </span>
                  <span>{s.label}</span>
                </button>
                {idx < STEPS.length - 1 && (
                  <span className="hidden sm:inline-block w-6 h-px bg-[#252A27]/15 mx-1" aria-hidden="true" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="p-6 sm:p-8 md:p-10">
        {/* STEP 1: TREATMENT */}
        {step === 1 && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <h3 className="font-display text-2xl md:text-3xl font-semibold text-[#234536]">
                  1. Select Your Treatment
                </h3>
                <p className="text-sm text-[#252A27]/75 mt-1">
                  Choose the care you are looking for. Every appointment includes unhurried attention.
                </p>
              </div>
              {consultationTreatment && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTreatmentId(consultationTreatment.id);
                    setSelectedDate('');
                    setSelectedTime('');
                    setStep(2);
                  }}
                  className="text-left md:text-right px-4 py-2.5 rounded-lg bg-[#FAF8F2] border border-[#C6A66B]/40 hover:border-[#365B4B] transition-colors text-xs text-[#252A27]"
                >
                  <span className="text-[#252A27]/70">Not sure which treatment you need?</span>{' '}
                  <span className="font-semibold text-[#365B4B] underline underline-offset-2">
                    Select {consultationTreatment.name}
                  </span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {treatments.map((t) => {
                const isSelected = selectedTreatmentId === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setSelectedTreatmentId(t.id);
                      setSelectedDentistId('any');
                      setSelectedDate('');
                      setSelectedTime('');
                      setStep(2);
                    }}
                    className={`text-left rounded-xl border p-4 transition-all flex flex-col justify-between gap-4 hover:border-[#365B4B] ${
                      isSelected
                        ? 'border-[#365B4B] bg-[#FAF8F2] ring-1 ring-[#365B4B]'
                        : 'border-[#252A27]/12 bg-white'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 text-xs text-[#252A27]/60 mb-2 tabular-nums">
                        <span>{t.duration_minutes} min session</span>
                        {t.price_display && (
                          <span className="font-medium text-[#365B4B]">{t.price_display}</span>
                        )}
                      </div>
                      <h4 className="font-display text-xl font-semibold text-[#234536]">{t.name}</h4>
                      <p className="text-sm text-[#252A27]/75 mt-1.5 leading-relaxed">
                        {t.short_description}
                      </p>
                    </div>
                    <div className="flex items-center justify-between pt-3 border-t border-[#252A27]/8 text-xs font-medium text-[#365B4B]">
                      <span>{isSelected ? 'Selected' : 'Choose treatment'}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* STEP 2: DENTIST */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <h3 className="font-display text-2xl md:text-3xl font-semibold text-[#234536]">
                2. Choose Your Preferred Dentist
              </h3>
              <p className="text-sm text-[#252A27]/75 mt-1">
                For <strong>{selectedTreatment?.name}</strong> ({selectedTreatment?.duration_minutes} min). Select a practitioner or choose any available dentist.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => {
                  setSelectedDentistId('any');
                  setSelectedDate('');
                  setSelectedTime('');
                  setStep(3);
                }}
                className={`text-left rounded-xl border p-5 transition-all flex items-start gap-4 hover:border-[#365B4B] ${
                  selectedDentistId === 'any'
                    ? 'border-[#365B4B] bg-[#FAF8F2] ring-1 ring-[#365B4B]'
                    : 'border-[#252A27]/12 bg-white'
                }`}
              >
                <div className="w-14 h-14 rounded-full bg-[#365B4B] text-white flex items-center justify-center shrink-0">
                  <UserCheck className="w-6 h-6" />
                </div>
                <div className="flex-1">
                  <h4 className="font-display text-xl font-semibold text-[#234536]">
                    Any Available Dentist
                  </h4>
                  <p className="text-sm text-[#252A27]/75 mt-1 leading-relaxed">
                    Shows the widest selection of open appointment times for your chosen date.
                  </p>
                </div>
              </button>

              {eligibleDentists.map((d) => {
                const isSelected = selectedDentistId === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => {
                      setSelectedDentistId(d.id);
                      setSelectedDate('');
                      setSelectedTime('');
                      setStep(3);
                    }}
                    className={`text-left rounded-xl border p-5 transition-all flex items-start gap-4 hover:border-[#365B4B] ${
                      isSelected
                        ? 'border-[#365B4B] bg-[#FAF8F2] ring-1 ring-[#365B4B]'
                        : 'border-[#252A27]/12 bg-white'
                    }`}
                  >
                    {d.photo_url ? (
                      <div className="w-14 h-14 rounded-full overflow-hidden shrink-0 border border-[#252A27]/10">
                        <ClinicImage src={d.photo_url} alt={d.name} />
                      </div>
                    ) : (
                      <div className="w-14 h-14 rounded-full bg-[#EEE9DF] text-[#234536] flex items-center justify-center font-display text-lg font-semibold shrink-0 border border-[#252A27]/10">
                        {getInitials(d.name)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h4 className="font-display text-xl font-semibold text-[#234536]">{d.name}</h4>
                      <p className="text-xs text-[#365B4B] font-medium mt-0.5">
                        {d.title}
                        {d.qualifications ? ` · ${d.qualifications}` : ''}
                      </p>
                      {d.bio && (
                        <p className="text-sm text-[#252A27]/75 mt-1.5 leading-relaxed line-clamp-2">
                          {d.bio}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-[#252A27]/10">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-[#252A27]/80 hover:bg-[#EEE9DF]"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
              <button
                type="button"
                onClick={() => setStep(3)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#365B4B] text-white text-sm font-medium hover:bg-[#234536]"
              >
                Continue to Date
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: DATE */}
        {step === 3 && (
          <div className="space-y-6">
            <div>
              <h3 className="font-display text-2xl md:text-3xl font-semibold text-[#234536]">
                3. Select Appointment Date
              </h3>
              <p className="text-sm text-[#252A27]/75 mt-1">
                {selectedTreatment?.name} ·{' '}
                {selectedDentistObj ? selectedDentistObj.name : 'Any Available Dentist'}
              </p>
            </div>

            <div className="max-w-lg mx-auto bg-[#FAF8F2] border border-[#252A27]/10 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <button
                  type="button"
                  onClick={() => {
                    const currentMonth = getIstMonthString(0);
                    if (calendarMonth <= currentMonth) return;
                    const [y, m] = calendarMonth.split('-').map(Number);
                    const prev = new Date(Date.UTC(y, m - 2, 1));
                    setCalendarMonth(
                      `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`
                    );
                  }}
                  disabled={calendarMonth <= getIstMonthString(0)}
                  aria-label="Previous month"
                  className="p-2 rounded-lg border border-[#252A27]/10 bg-white disabled:opacity-40 hover:bg-[#EEE9DF]"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="font-display text-xl font-semibold text-[#234536]">
                  {monthLabel}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const [y, m] = calendarMonth.split('-').map(Number);
                    const next = new Date(Date.UTC(y, m, 1));
                    setCalendarMonth(
                      `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`
                    );
                  }}
                  aria-label="Next month"
                  className="p-2 rounded-lg border border-[#252A27]/10 bg-white hover:bg-[#EEE9DF]"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-7 gap-1.5 text-center text-xs font-medium text-[#252A27]/60 mb-2">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                  <div key={d} className="py-1">
                    {d}
                  </div>
                ))}
              </div>

              {calendarLoading ? (
                <div className="py-14 flex items-center justify-center gap-2 text-sm text-[#252A27]/60">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Checking clinic schedule...
                </div>
              ) : (
                <div className="grid grid-cols-7 gap-1.5">
                  {monthCalendarGrid.map((day, i) => {
                    if (!day) {
                      return <div key={`blank-${i}`} className="h-11" />;
                    }
                    const dayNum = Number(day.date.split('-')[2]);
                    const isSelected = selectedDate === day.date;
                    return (
                      <button
                        key={day.date}
                        type="button"
                        disabled={!day.available}
                        title={day.reason || `${day.slotCount} slots available`}
                        onClick={() => {
                          setSelectedDate(day.date);
                          setSelectedTime('');
                          setStep(4);
                        }}
                        className={`h-11 rounded-lg text-sm tabular-nums font-medium transition-colors flex flex-col items-center justify-center ${
                          isSelected
                            ? 'bg-[#365B4B] text-white'
                            : day.available
                              ? 'bg-white border border-[#252A27]/12 text-[#252A27] hover:border-[#365B4B] hover:bg-[#EEE9DF]/50'
                              : 'bg-transparent text-[#252A27]/25 cursor-not-allowed line-through'
                        }`}
                      >
                        <span>{dayNum}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              <p className="text-xs text-[#252A27]/60 mt-4 text-center">
                Only open dates with available {selectedTreatment?.duration_minutes}-minute slots are selectable.
              </p>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-[#252A27]/10">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-[#252A27]/80 hover:bg-[#EEE9DF]"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: TIME */}
        {step === 4 && (
          <div className="space-y-6">
            <div>
              <h3 className="font-display text-2xl md:text-3xl font-semibold text-[#234536]">
                4. Select an Available Time
              </h3>
              <p className="text-sm text-[#252A27]/75 mt-1">
                {formatDisplayDate(selectedDate)} · {selectedTreatment?.name} (
                {selectedTreatment?.duration_minutes} min)
              </p>
            </div>

            {slotsLoading ? (
              <div className="py-12 flex items-center justify-center gap-2 text-sm text-[#252A27]/70">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading real-time appointment slots...
              </div>
            ) : slots.length === 0 ? (
              <div className="rounded-xl border border-[#252A27]/12 bg-[#FAF8F2] p-6 text-center space-y-3">
                <p className="text-sm text-[#252A27]/80">
                  {slotsMessage || 'No available time slots remain for this date.'}
                </p>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="px-4 py-2 rounded-lg bg-[#365B4B] text-white text-sm font-medium"
                >
                  Choose Another Date
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                {[
                  { label: 'Morning (10:30 AM – 11:59 AM)', items: groupedSlots.morning },
                  { label: 'Afternoon (12:00 PM – 4:59 PM)', items: groupedSlots.afternoon },
                  { label: 'Evening (5:00 PM – 9:30 PM)', items: groupedSlots.evening },
                ]
                  .filter((g) => g.items.length > 0)
                  .map((group) => (
                    <div key={group.label}>
                      <p className="text-xs font-semibold uppercase tracking-wider text-[#252A27]/60 mb-3">
                        {group.label}
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2.5">
                        {group.items.map((slot) => {
                          const isChosen = selectedTime === slot.start_time;
                          return (
                            <button
                              key={slot.start_time}
                              type="button"
                              onClick={() => {
                                setSelectedTime(slot.start_time);
                                setStep(5);
                              }}
                              className={`py-2.5 px-3 rounded-lg text-sm font-medium tabular-nums border transition-colors ${
                                isChosen
                                  ? 'bg-[#365B4B] text-white border-[#365B4B]'
                                  : 'bg-white text-[#252A27] border-[#252A27]/15 hover:border-[#365B4B] hover:bg-[#FAF8F2]'
                              }`}
                            >
                              {slot.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
              </div>
            )}

            <div className="flex items-center justify-between pt-4 border-t border-[#252A27]/10">
              <button
                type="button"
                onClick={() => setStep(3)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-[#252A27]/80 hover:bg-[#EEE9DF]"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Calendar
              </button>
            </div>
          </div>
        )}

        {/* STEP 5: PATIENT DETAILS */}
        {step === 5 && (
          <form onSubmit={handleSubmitBooking} className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-7 space-y-5">
              <div>
                <h3 className="font-display text-2xl md:text-3xl font-semibold text-[#234536]">
                  5. Your Contact Details
                </h3>
                <p className="text-sm text-[#252A27]/75 mt-1">
                  We only collect contact details needed to reserve and confirm your visit.
                </p>
              </div>

              {submitError && (
                <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
                  {submitError}
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label htmlFor="patient-name" className="block text-sm font-medium text-[#252A27] mb-1.5">
                    Full Name <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="patient-name"
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Enter your full name"
                    className="w-full px-4 py-2.5 rounded-lg border border-[#252A27]/20 bg-white text-sm focus:outline-none focus:border-[#365B4B]"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="patient-phone" className="block text-sm font-medium text-[#252A27] mb-1.5">
                      Mobile Number <span className="text-red-600">*</span>
                    </label>
                    <input
                      id="patient-phone"
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+91 98XXX XXXXX"
                      className="w-full px-4 py-2.5 rounded-lg border border-[#252A27]/20 bg-white text-sm focus:outline-none focus:border-[#365B4B]"
                    />
                  </div>
                  <div>
                    <label htmlFor="patient-email" className="block text-sm font-medium text-[#252A27] mb-1.5">
                      Email Address (Optional)
                    </label>
                    <input
                      id="patient-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@example.com"
                      className="w-full px-4 py-2.5 rounded-lg border border-[#252A27]/20 bg-white text-sm focus:outline-none focus:border-[#365B4B]"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="patient-notes" className="block text-sm font-medium text-[#252A27] mb-1.5">
                    Additional Notes (Optional)
                  </label>
                  <textarea
                    id="patient-notes"
                    rows={3}
                    maxLength={500}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Any scheduling preferences or comfort requests (please avoid sharing sensitive medical history online)."
                    className="w-full px-4 py-2.5 rounded-lg border border-[#252A27]/20 bg-white text-sm focus:outline-none focus:border-[#365B4B]"
                  />
                </div>

                <label className="flex items-start gap-3 p-4 rounded-xl bg-[#FAF8F2] border border-[#252A27]/12 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={consentAccepted}
                    onChange={(e) => setConsentAccepted(e.target.checked)}
                    className="mt-1 w-4 h-4 accent-[#365B4B]"
                    required
                  />
                  <span className="text-xs text-[#252A27]/80 leading-relaxed">
                    I agree to the{' '}
                    <button
                      type="button"
                      onClick={() => onOpenLegal('privacy')}
                      className="text-[#365B4B] underline font-medium"
                    >
                      Privacy Policy
                    </button>
                    ,{' '}
                    <button
                      type="button"
                      onClick={() => onOpenLegal('cancellation')}
                      className="text-[#365B4B] underline font-medium"
                    >
                      Cancellation Policy
                    </button>
                    , and{' '}
                    <button
                      type="button"
                      onClick={() => onOpenLegal('consent')}
                      className="text-[#365B4B] underline font-medium"
                    >
                      Patient Booking Consent
                    </button>
                    . I understand that online slot reservations remain subject to clinic confirmation.
                  </span>
                </label>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-[#252A27]/10">
                <button
                  type="button"
                  onClick={() => setStep(4)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-[#252A27]/80 hover:bg-[#EEE9DF]"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Change Time
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[#365B4B] text-white text-sm font-medium hover:bg-[#234536] disabled:opacity-60 transition-colors"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Reserving Slot...
                    </>
                  ) : (
                    <>
                      Reserve Appointment Slot
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="lg:col-span-5">
              <div className="rounded-xl bg-[#FAF8F2] border border-[#252A27]/12 p-6 space-y-4">
                <h4 className="font-display text-xl font-semibold text-[#234536]">
                  Appointment Summary
                </h4>
                <dl className="space-y-3 text-sm border-t border-[#252A27]/10 pt-4">
                  <div className="flex justify-between gap-4">
                    <dt className="text-[#252A27]/65">Treatment</dt>
                    <dd className="font-medium text-right">{selectedTreatment?.name}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-[#252A27]/65">Duration</dt>
                    <dd className="font-medium tabular-nums">{selectedTreatment?.duration_minutes} minutes</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-[#252A27]/65">Dentist</dt>
                    <dd className="font-medium text-right">
                      {selectedDentistObj ? selectedDentistObj.name : 'Any Available Dentist'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-[#252A27]/65">Date</dt>
                    <dd className="font-medium">{formatDisplayDate(selectedDate)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-[#252A27]/65">Time</dt>
                    <dd className="font-medium tabular-nums">{formatTime12h(selectedTime)}</dd>
                  </div>
                </dl>
                <div className="pt-4 border-t border-[#252A27]/10 text-xs text-[#252A27]/70 flex items-start gap-2">
                  <Info className="w-4 h-4 text-[#365B4B] shrink-0 mt-0.5" />
                  <span>
                    Location: {settings.address}
                  </span>
                </div>
              </div>
            </div>
          </form>
        )}

        {/* STEP 6: BOOKING CONFIRMATION */}
        {step === 6 && confirmedBooking && (
          <div className="max-w-2xl mx-auto space-y-6">
            <div className="text-center space-y-2">
              <div className="w-14 h-14 rounded-full bg-[#365B4B]/10 text-[#365B4B] flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[#C6A66B]">
                Slot Reserved · Subject to Clinic Confirmation
              </p>
              <h3 className="font-display text-3xl font-semibold text-[#234536]">
                Appointment Request Received
              </h3>
              <p className="text-sm text-[#252A27]/75">
                Please save your booking reference number below. Our clinic desk will confirm your visit shortly.
              </p>
            </div>

            <div className="rounded-xl bg-[#FAF8F2] border border-[#252A27]/12 p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#252A27]/10">
                <div>
                  <span className="text-xs text-[#252A27]/60 block">Booking Reference</span>
                  <span className="font-mono text-2xl font-semibold text-[#234536] tabular-nums">
                    {confirmedBooking.booking_ref}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-xs text-[#252A27]/60 block">Status</span>
                  <span className="text-sm font-semibold text-[#365B4B]">
                    {confirmedBooking.status} (Awaiting Clinic Confirmation)
                  </span>
                </div>
              </div>

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-xs text-[#252A27]/60">Patient Name</dt>
                  <dd className="font-medium text-[#252A27] mt-0.5">{confirmedBooking.patient_name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[#252A27]/60">Treatment</dt>
                  <dd className="font-medium text-[#252A27] mt-0.5">{confirmedBooking.treatment_name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[#252A27]/60">Dentist</dt>
                  <dd className="font-medium text-[#252A27] mt-0.5">{confirmedBooking.dentist_name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[#252A27]/60">Date & Time</dt>
                  <dd className="font-medium text-[#252A27] mt-0.5 tabular-nums">
                    {formatDisplayDate(confirmedBooking.appointment_date)} ·{' '}
                    {formatTime12h(confirmedBooking.start_time)}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-[#252A27]/60 flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-[#365B4B]" />
                    Clinic Address
                  </dt>
                  <dd className="font-medium text-[#252A27] mt-0.5">{settings.address}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[#252A27]/60 flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5 text-[#365B4B]" />
                    Clinic Contact
                  </dt>
                  <dd className="font-medium text-[#365B4B] mt-0.5 tabular-nums">
                    <a href={buildTelHref(settings.phone)}>{settings.phone}</a>
                  </dd>
                </div>
              </dl>

              {(notificationStatus || supabaseSynced) && (
                <div className="pt-3 border-t border-[#252A27]/10 text-xs text-[#252A27]/70 space-y-1">
                  {supabaseSynced && (
                    <p>Your reservation details have been saved securely to our clinic booking database.</p>
                  )}
                  {notificationStatus?.email === 'sent' && (
                    <p>Confirmation email sent to {confirmedBooking.patient_email}.</p>
                  )}
                  {notificationStatus?.whatsapp === 'sent' && (
                    <p>Automated WhatsApp notification dispatched to {confirmedBooking.patient_phone}.</p>
                  )}
                  {notificationStatus?.whatsapp !== 'sent' && (
                    <p>
                      Want to message our reception desk directly? Use the WhatsApp button below to share your booking reference.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <a
                href={buildWhatsAppUrl(
                  settings.whatsapp_number,
                  `Hello DrVijayas ToothSpa, I have reserved an appointment (Ref: ${confirmedBooking.booking_ref}) for ${confirmedBooking.treatment_name} on ${confirmedBooking.appointment_date} at ${formatTime12h(confirmedBooking.start_time)}. Please confirm my slot.`
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#234536] text-white text-sm font-medium hover:bg-[#365B4B] transition-colors"
              >
                <MessageCircle className="w-4 h-4" />
                Share Booking on WhatsApp
              </a>
              <button
                type="button"
                onClick={() => onOpenManageBooking(confirmedBooking.booking_ref)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-[#252A27]/20 text-sm font-medium text-[#252A27] hover:bg-[#EEE9DF]"
              >
                <CalendarIcon className="w-4 h-4" />
                Manage / Reschedule
              </button>
              <button
                type="button"
                onClick={resetWizard}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-[#365B4B] hover:underline"
              >
                <Clock className="w-4 h-4" />
                Book Another Visit
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
