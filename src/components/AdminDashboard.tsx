import { useState, useEffect, useCallback } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Calendar,
  Check,
  Clock,
  Copy,
  Database,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  FileText,
  Image as ImageIcon,
  KeyRound,
  LayoutDashboard,
  Loader2,
  LogOut,
  MessageSquareQuote,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import type {
  AdminUser,
  Appointment,
  AvailableSlot,
  BlockedDate,
  ClinicHour,
  Dentist,
  GalleryItem,
  Testimonial,
  Treatment,
  WebsiteSettings,
} from '../types/clinic';
import { formatDisplayDate, formatTime12h, getInitials } from '../lib/format';
import { ClinicImage } from './ClinicImage';

interface AdminDashboardProps {
  onExitToSite: () => void;
  onPublicDataChanged: () => void;
}

type AdminTab =
  | 'overview'
  | 'appointments'
  | 'dentists'
  | 'treatments'
  | 'hours'
  | 'testimonials'
  | 'content'
  | 'security';

const EXPANDABLE_TREATMENT_TEMPLATES = [
  {
    name: 'Root Canal Treatment',
    short_description: 'Careful endodontic therapy to relieve tooth pain and preserve natural tooth structure.',
    duration_minutes: 60,
  },
  {
    name: 'Teeth Whitening',
    short_description: 'Supervised clinical shade brightening tailored to tooth sensitivity and enamel health.',
    duration_minutes: 45,
  },
  {
    name: 'Braces & Aligners',
    short_description: 'Orthodontic alignment consultations and structured progress visits.',
    duration_minutes: 45,
  },
  {
    name: 'Dental Implants',
    short_description: 'Consultation and restorative planning for single or multiple tooth replacement.',
    duration_minutes: 60,
  },
  {
    name: 'Crowns & Bridges',
    short_description: 'Custom-fitted ceramic or porcelain restorations for strength and natural bite function.',
    duration_minutes: 45,
  },
  {
    name: 'Porcelain Veneers',
    short_description: 'Conservative aesthetic consultations for smile symmetry and enamel refinement.',
    duration_minutes: 45,
  },
  {
    name: 'Tooth Extractions',
    short_description: 'Gentle surgical or simple extractions performed with local comfort protocols.',
    duration_minutes: 45,
  },
];

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

async function uploadImageFile(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
  const resp = await fetch('/api/admin/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name, dataUrl }),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.error || 'Upload failed');
  return json.url as string;
}

export function AdminDashboard({ onExitToSite, onPublicDataChanged }: AdminDashboardProps) {
  const [authChecked, setAuthChecked] = useState(false);
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'forgot' | 'reset'>('login');

  // Auth form states
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newResetPassword, setNewResetPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  const [tab, setTab] = useState<AdminTab>('overview');
  const [bannerMsg, setBannerMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Dashboard data
  const [overview, setOverview] = useState<any>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [dentists, setDentists] = useState<Dentist[]>([]);
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [hours, setHours] = useState<ClinicHour[]>([]);
  const [blockedDates, setBlockedDates] = useState<BlockedDate[]>([]);
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
  const [settings, setSettings] = useState<WebsiteSettings | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);

  // Appointment filters & modals
  const [apptSearch, setApptSearch] = useState('');
  const [apptDate, setApptDate] = useState('');
  const [apptDentist, setApptDentist] = useState('');
  const [apptTreatment, setApptTreatment] = useState('');
  const [apptStatus, setApptStatus] = useState('');
  const [appointmentsLoading, setAppointmentsLoading] = useState(false);
  const [supabaseReadInfo, setSupabaseReadInfo] = useState<{
    accessible: boolean;
    reason: string | null;
    count: number;
  } | null>(null);

  const [viewingAppointment, setViewingAppointment] = useState<Appointment | null>(null);
  const [editingAppointment, setEditingAppointment] = useState<{
    id: number;
    booking_ref: string;
    patient_name: string;
    patient_phone: string;
    patient_email: string;
    treatment_id: number;
    assigned_dentist_id: number;
    appointment_date: string;
    start_time: string;
    status: Appointment['status'];
    notes: string;
  } | null>(null);
  const [editSlots, setEditSlots] = useState<AvailableSlot[]>([]);
  const [cancellingAppointment, setCancellingAppointment] = useState<{
    appt: Appointment;
    reason: string;
  } | null>(null);
  const [creatingAppointment, setCreatingAppointment] = useState<{
    full_name: string;
    phone: string;
    email: string;
    treatment_id: number;
    dentist_id: number | 'any';
    appointment_date: string;
    start_time: string;
    status: 'Pending' | 'Confirmed';
    notes: string;
  } | null>(null);
  const [createSlots, setCreateSlots] = useState<AvailableSlot[]>([]);
  const [savingAppt, setSavingAppt] = useState(false);

  // Reschedule modal
  const [rescheduleTarget, setRescheduleTarget] = useState<Appointment | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleSlots, setRescheduleSlots] = useState<AvailableSlot[]>([]);
  const [rescheduleTime, setRescheduleTime] = useState('');

  // Dentist Editor
  const [editingDentist, setEditingDentist] = useState<Partial<Dentist> | null>(null);

  // Treatment Editor
  const [editingTreatment, setEditingTreatment] = useState<Partial<Treatment> | null>(null);

  // Blocked date form
  const [newBlockDate, setNewBlockDate] = useState('');
  const [newBlockDentist, setNewBlockDentist] = useState<string>('');
  const [newBlockReason, setNewBlockReason] = useState('');

  // Testimonial form
  const [editingTestimonial, setEditingTestimonial] = useState<Partial<Testimonial> | null>(null);

  // Password change & new admin user
  const [curPwd, setCurPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserRole, setNewUserRole] = useState<AdminUser['role']>('reception');
  const [newUserPassword, setNewUserPassword] = useState('');

  const notify = (type: 'ok' | 'err', text: string) => {
    setBannerMsg({ type, text });
    setTimeout(() => setBannerMsg(null), 5000);
  };

  const copyMigrationSql = async () => {
    try {
      const r = await fetch('/api/admin/supabase-migration-sql');
      const d = await r.json();
      if (!r.ok || !d.sql) {
        notify('err', d.error || 'Could not load Supabase SQL migration.');
        return;
      }
      await navigator.clipboard.writeText(d.sql);
      notify('ok', 'Supabase SQL migration copied to clipboard. Paste it into your Supabase SQL Editor and click Run.');
    } catch {
      notify('err', 'Failed to copy SQL migration to clipboard.');
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rt = params.get('resetToken');
    if (rt) {
      setResetToken(rt);
      setAuthMode('reset');
    }

    fetch('/api/admin/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.admin) setAdmin(data.admin);
      })
      .catch(() => {})
      .finally(() => setAuthChecked(true));
  }, []);

  const loadAppointments = useCallback(async () => {
    setAppointmentsLoading(true);
    try {
      const qs = new URLSearchParams();
      if (apptSearch) qs.set('search', apptSearch);
      if (apptDate) qs.set('date', apptDate);
      if (apptDentist) qs.set('dentistId', apptDentist);
      if (apptTreatment) qs.set('treatmentId', apptTreatment);
      if (apptStatus) qs.set('status', apptStatus);
      const r = await fetch(`/api/admin/appointments?${qs.toString()}`);
      if (r.ok) {
        const data = await r.json();
        setAppointments(data.appointments || []);
        setSupabaseReadInfo(data.supabaseRead || null);
      }
    } finally {
      setAppointmentsLoading(false);
    }
  }, [apptSearch, apptDate, apptDentist, apptTreatment, apptStatus]);

  const loadAllAdminData = useCallback(async () => {
    if (!admin) return;
    const [ovR, denR, trR, hrR, blR, tsR, stR, logR] = await Promise.all([
      fetch('/api/admin/overview'),
      fetch('/api/admin/dentists'),
      fetch('/api/admin/treatments'),
      fetch('/api/admin/hours'),
      fetch('/api/admin/blocked-dates'),
      fetch('/api/admin/testimonials'),
      fetch('/api/admin/settings'),
      fetch('/api/admin/audit-logs'),
    ]);

    if (ovR.ok) setOverview(await ovR.json());
    if (denR.ok) setDentists((await denR.json()).dentists || []);
    if (trR.ok) setTreatments((await trR.json()).treatments || []);
    if (hrR.ok) setHours((await hrR.json()).hours || []);
    if (blR.ok) setBlockedDates((await blR.json()).blockedDates || []);
    if (tsR.ok) setTestimonials((await tsR.json()).testimonials || []);
    if (stR.ok) setSettings((await stR.json()).settings || null);
    if (logR.ok) setAuditLogs((await logR.json()).logs || []);

    if (admin.role === 'super_admin') {
      const uR = await fetch('/api/admin/users');
      if (uR.ok) setAdminUsers((await uR.json()).users || []);
    }
  }, [admin]);

  useEffect(() => {
    if (admin) {
      loadAllAdminData();
      loadAppointments();
    }
  }, [admin, loadAllAdminData, loadAppointments]);

  useEffect(() => {
    if (!rescheduleTarget || !rescheduleDate) return;
    fetch(
      `/api/slots?date=${rescheduleDate}&treatmentId=${rescheduleTarget.treatment_id}&dentistId=${rescheduleTarget.assigned_dentist_id}`
    )
      .then((r) => r.json())
      .then((d) => setRescheduleSlots(Array.isArray(d.slots) ? d.slots : []))
      .catch(() => setRescheduleSlots([]));
  }, [rescheduleTarget, rescheduleDate]);

  useEffect(() => {
    if (!editingAppointment || !editingAppointment.appointment_date || !editingAppointment.treatment_id) return;
    fetch(
      `/api/slots?date=${editingAppointment.appointment_date}&treatmentId=${editingAppointment.treatment_id}&dentistId=${editingAppointment.assigned_dentist_id || 'any'}`
    )
      .then((r) => r.json())
      .then((d) => setEditSlots(Array.isArray(d.slots) ? d.slots : []))
      .catch(() => setEditSlots([]));
  }, [
    editingAppointment?.appointment_date,
    editingAppointment?.treatment_id,
    editingAppointment?.assigned_dentist_id,
  ]);

  useEffect(() => {
    if (!creatingAppointment || !creatingAppointment.appointment_date || !creatingAppointment.treatment_id) return;
    fetch(
      `/api/slots?date=${creatingAppointment.appointment_date}&treatmentId=${creatingAppointment.treatment_id}&dentistId=${creatingAppointment.dentist_id}`
    )
      .then((r) => r.json())
      .then((d) => setCreateSlots(Array.isArray(d.slots) ? d.slots : []))
      .catch(() => setCreateSlots([]));
  }, [
    creatingAppointment?.appointment_date,
    creatingAppointment?.treatment_id,
    creatingAppointment?.dentist_id,
  ]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthBusy(true);
    try {
      const r = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const d = await r.json();
      if (!r.ok) {
        setAuthError(d.error || 'Login failed');
        return;
      }
      setAdmin(d.admin);
      setLoginPassword('');
    } catch {
      setAuthError('Network error during login.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthNotice(null);
    setAuthBusy(true);
    try {
      const r = await fetch('/api/admin/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail }),
      });
      const d = await r.json();
      setAuthNotice(d.message || 'Check your configured email inbox.');
    } catch {
      setAuthError('Unable to request reset.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthNotice(null);
    setAuthBusy(true);
    try {
      const r = await fetch('/api/admin/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, new_password: newResetPassword }),
      });
      const d = await r.json();
      if (!r.ok) {
        setAuthError(d.error || 'Reset failed.');
        return;
      }
      setAuthNotice('Password reset successful. You may now sign in.');
      setAuthMode('login');
    } catch {
      setAuthError('Network error.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    setAdmin(null);
  };

  const updateAppointmentStatus = async (
    appt: Appointment,
    status: Appointment['status'],
    notesOverride?: string
  ) => {
    const r = await fetch(`/api/admin/appointments/${appt.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_ref: appt.booking_ref,
        status,
        ...(notesOverride !== undefined ? { notes: notesOverride } : {}),
      }),
    });
    const d = await r.json();
    if (!r.ok) {
      notify('err', d.error || 'Failed to update appointment');
      return;
    }
    notify('ok', `Appointment ${appt.booking_ref} updated to ${status}.`);
    if (viewingAppointment?.booking_ref === appt.booking_ref && d.appointment) {
      setViewingAppointment({ ...viewingAppointment, ...d.appointment });
    }
    loadAppointments();
    loadAllAdminData();
  };

  const openEditAppointment = (a: Appointment) => {
    const matchedTreatment =
      treatments.find((t) => t.id === a.treatment_id) ||
      treatments.find((t) => t.name.toLowerCase() === a.treatment_name.toLowerCase()) ||
      treatments[0];
    const matchedDentist =
      dentists.find((d) => d.id === a.assigned_dentist_id) ||
      dentists.find((d) => d.name.toLowerCase() === a.dentist_name.toLowerCase()) ||
      dentists[0];

    setEditingAppointment({
      id: a.id,
      booking_ref: a.booking_ref,
      patient_name: a.patient_name,
      patient_phone: a.patient_phone,
      patient_email: a.patient_email || '',
      treatment_id: matchedTreatment?.id || a.treatment_id || 1,
      assigned_dentist_id: matchedDentist?.id || a.assigned_dentist_id || 1,
      appointment_date: a.appointment_date,
      start_time: a.start_time,
      status: a.status,
      notes: a.notes || '',
    });
  };

  const submitEditAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAppointment) return;
    setSavingAppt(true);
    try {
      const r = await fetch(`/api/admin/appointments/${editingAppointment.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingAppointment),
      });
      const d = await r.json();
      if (!r.ok) {
        notify('err', d.error || 'Unable to save appointment changes.');
        return;
      }
      notify('ok', `Saved changes to appointment ${editingAppointment.booking_ref}.`);
      setEditingAppointment(null);
      if (viewingAppointment?.booking_ref === editingAppointment.booking_ref && d.appointment) {
        setViewingAppointment({ ...viewingAppointment, ...d.appointment });
      }
      loadAppointments();
      loadAllAdminData();
    } finally {
      setSavingAppt(false);
    }
  };

  const submitCreateAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creatingAppointment) return;
    setSavingAppt(true);
    try {
      const r = await fetch('/api/admin/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(creatingAppointment),
      });
      const d = await r.json();
      if (!r.ok) {
        notify('err', d.error || 'Could not create appointment.');
        return;
      }
      notify('ok', `Created appointment ${d.appointment?.booking_ref || ''}.`);
      setCreatingAppointment(null);
      loadAppointments();
      loadAllAdminData();
    } finally {
      setSavingAppt(false);
    }
  };

  const submitCancelAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancellingAppointment) return;
    const { appt, reason } = cancellingAppointment;
    const combinedNotes = reason.trim()
      ? [appt.notes, `Cancelled: ${reason.trim()}`].filter(Boolean).join(' | ')
      : appt.notes;
    setSavingAppt(true);
    try {
      await updateAppointmentStatus(appt, 'Cancelled', combinedNotes);
      setCancellingAppointment(null);
    } finally {
      setSavingAppt(false);
    }
  };

  const submitAdminReschedule = async () => {
    if (!rescheduleTarget || !rescheduleDate || !rescheduleTime) return;
    const r = await fetch(`/api/admin/appointments/${rescheduleTarget.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_ref: rescheduleTarget.booking_ref,
        new_date: rescheduleDate,
        new_start_time: rescheduleTime,
      }),
    });
    const d = await r.json();
    if (!r.ok) {
      notify('err', d.error || 'Reschedule failed');
      return;
    }
    notify('ok', `Appointment ${rescheduleTarget.booking_ref} rescheduled.`);
    setRescheduleTarget(null);
    loadAppointments();
    loadAllAdminData();
  };

  const saveDentist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDentist) return;
    const isNew = !editingDentist.id;
    const url = isNew ? '/api/admin/dentists' : `/api/admin/dentists/${editingDentist.id}`;
    const method = isNew ? 'POST' : 'PUT';
    const r = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editingDentist),
    });
    const d = await r.json();
    if (!r.ok) {
      notify('err', d.error || 'Failed to save dentist');
      return;
    }
    setEditingDentist(null);
    notify('ok', 'Dentist profile saved.');
    loadAllAdminData();
    onPublicDataChanged();
  };

  const deleteDentist = async (id: number) => {
    const r = await fetch(`/api/admin/dentists/${id}`, { method: 'DELETE' });
    const d = await r.json();
    if (!r.ok) {
      notify('err', d.error || 'Failed to delete dentist');
      return;
    }
    notify('ok', d.message || 'Dentist removed.');
    loadAllAdminData();
    onPublicDataChanged();
  };

  const saveTreatment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTreatment) return;
    const isNew = !editingTreatment.id;
    const url = isNew ? '/api/admin/treatments' : `/api/admin/treatments/${editingTreatment.id}`;
    const method = isNew ? 'POST' : 'PUT';
    const r = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editingTreatment),
    });
    const d = await r.json();
    if (!r.ok) {
      notify('err', d.error || 'Failed to save treatment');
      return;
    }
    setEditingTreatment(null);
    notify('ok', 'Treatment catalog updated.');
    loadAllAdminData();
    onPublicDataChanged();
  };

  const moveTreatment = async (idx: number, direction: -1 | 1) => {
    const target = idx + direction;
    if (target < 0 || target >= treatments.length) return;
    const copy = [...treatments];
    const [item] = copy.splice(idx, 1);
    copy.splice(target, 0, item);
    setTreatments(copy);
    await fetch('/api/admin/treatments/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: copy.map((t) => t.id) }),
    });
    onPublicDataChanged();
  };

  const saveClinicHours = async () => {
    const r = await fetch('/api/admin/hours', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hours }),
    });
    if (!r.ok) {
      notify('err', 'Failed to update clinic hours.');
      return;
    }
    notify('ok', 'Clinic hours and booking buffers saved.');
    onPublicDataChanged();
  };

  const addBlockedDate = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await fetch('/api/admin/blocked-dates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: newBlockDate,
        dentist_id: newBlockDentist ? Number(newBlockDentist) : null,
        reason: newBlockReason || 'Clinic Holiday / Unavailable',
      }),
    });
    const d = await r.json();
    if (!r.ok) {
      notify('err', d.error || 'Failed to add blocked date.');
      return;
    }
    setNewBlockDate('');
    setNewBlockDentist('');
    setNewBlockReason('');
    notify('ok', 'Blocked date added.');
    loadAllAdminData();
    onPublicDataChanged();
  };

  const saveTestimonial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTestimonial) return;
    const isNew = !editingTestimonial.id;
    const r = await fetch(
      isNew ? '/api/admin/testimonials' : `/api/admin/testimonials/${editingTestimonial.id}`,
      {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingTestimonial),
      }
    );
    if (!r.ok) {
      notify('err', 'Failed to save review.');
      return;
    }
    setEditingTestimonial(null);
    notify('ok', 'Patient testimonial saved.');
    loadAllAdminData();
    onPublicDataChanged();
  };

  const saveWebsiteSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    const r = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings }),
    });
    if (!r.ok) {
      notify('err', 'Failed to save website content.');
      return;
    }
    notify('ok', 'Website content updated.');
    onPublicDataChanged();
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#FAF8F2] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#365B4B]" />
      </div>
    );
  }

  // ==================== LOGIN / PASSWORD RESET ====================
  if (!admin) {
    return (
      <div className="min-h-screen bg-[#FAF8F2] flex flex-col justify-center items-center p-6">
        <div className="w-full max-w-md bg-white rounded-2xl border border-[#252A27]/12 p-8 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-[#C6A66B]">
                DrVijayas ToothSpa
              </p>
              <h1 className="font-display text-3xl font-semibold text-[#234536] mt-0.5">
                {authMode === 'login'
                  ? 'Clinic Admin Sign In'
                  : authMode === 'forgot'
                    ? 'Reset Admin Password'
                    : 'Set New Password'}
              </h1>
            </div>
            <button
              type="button"
              onClick={onExitToSite}
              className="text-xs font-medium text-[#365B4B] hover:underline inline-flex items-center gap-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Website
            </button>
          </div>

          {authError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
              {authError}
            </div>
          )}
          {authNotice && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
              {authNotice}
            </div>
          )}

          {authMode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label htmlFor="adm-email" className="block text-sm font-medium mb-1">
                  Admin Email
                </label>
                <input
                  id="adm-email"
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-[#252A27]/20 text-sm focus:outline-none focus:border-[#365B4B]"
                />
              </div>
              <div>
                <label htmlFor="adm-pass" className="block text-sm font-medium mb-1">
                  Password
                </label>
                <input
                  id="adm-pass"
                  type="password"
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-[#252A27]/20 text-sm focus:outline-none focus:border-[#365B4B]"
                />
              </div>
              <button
                type="submit"
                disabled={authBusy}
                className="w-full py-2.5 rounded-lg bg-[#365B4B] text-white text-sm font-medium hover:bg-[#234536] disabled:opacity-60"
              >
                {authBusy ? 'Signing In...' : 'Sign In'}
              </button>
              <div className="flex items-center justify-between text-xs pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('forgot');
                    setAuthError(null);
                  }}
                  className="text-[#365B4B] hover:underline"
                >
                  Forgot password?
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('reset');
                    setAuthError(null);
                  }}
                  className="text-[#252A27]/70 hover:underline"
                >
                  Have a reset token?
                </button>
              </div>
            </form>
          )}

          {authMode === 'forgot' && (
            <form onSubmit={handleForgot} className="space-y-4">
              <p className="text-xs text-[#252A27]/75 leading-relaxed">
                Enter your administrator email. If SMTP is configured, reset instructions will be sent.
              </p>
              <div>
                <label htmlFor="forgot-email" className="block text-sm font-medium mb-1">
                  Admin Email
                </label>
                <input
                  id="forgot-email"
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-[#252A27]/20 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={authBusy}
                className="w-full py-2.5 rounded-lg bg-[#365B4B] text-white text-sm font-medium hover:bg-[#234536]"
              >
                Request Password Reset
              </button>
              <button
                type="button"
                onClick={() => setAuthMode('login')}
                className="text-xs text-[#365B4B] hover:underline"
              >
                Back to Sign In
              </button>
            </form>
          )}

          {authMode === 'reset' && (
            <form onSubmit={handleReset} className="space-y-4">
              <div>
                <label htmlFor="reset-tok" className="block text-sm font-medium mb-1">
                  Reset Token
                </label>
                <input
                  id="reset-tok"
                  type="text"
                  required
                  value={resetToken}
                  onChange={(e) => setResetToken(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-[#252A27]/20 text-sm font-mono"
                />
              </div>
              <div>
                <label htmlFor="reset-new-pwd" className="block text-sm font-medium mb-1">
                  New Password (min 8 chars)
                </label>
                <input
                  id="reset-new-pwd"
                  type="password"
                  required
                  minLength={8}
                  value={newResetPassword}
                  onChange={(e) => setNewResetPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-[#252A27]/20 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={authBusy}
                className="w-full py-2.5 rounded-lg bg-[#365B4B] text-white text-sm font-medium hover:bg-[#234536]"
              >
                Update Password
              </button>
              <button
                type="button"
                onClick={() => setAuthMode('login')}
                className="text-xs text-[#365B4B] hover:underline"
              >
                Back to Sign In
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  const navItems: { id: AdminTab; label: string; icon: typeof LayoutDashboard }[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'appointments', label: 'Appointments', icon: Calendar },
    { id: 'dentists', label: 'Dentists', icon: Users },
    { id: 'treatments', label: 'Treatments', icon: Sparkles },
    { id: 'hours', label: 'Hours & Holidays', icon: Clock },
    { id: 'testimonials', label: 'Reviews', icon: MessageSquareQuote },
    { id: 'content', label: 'Website Content', icon: FileText },
    { id: 'security', label: 'Security & Audit', icon: ShieldCheck },
  ];

  const galleryItems: GalleryItem[] = (() => {
    try {
      return settings?.gallery_items ? JSON.parse(settings.gallery_items) : [];
    } catch {
      return [];
    }
  })();

  const canEditClinic = admin.role === 'super_admin' || admin.role === 'manager';

  return (
    <div className="min-h-screen bg-[#FAF8F2] text-[#252A27] flex flex-col lg:flex-row">
      {/* Sidebar */}
      <aside className="w-full lg:w-64 bg-[#234536] text-white shrink-0 flex flex-col justify-between">
        <div>
          <div className="px-6 py-5 border-b border-white/10">
            <p className="font-display text-xl font-semibold tracking-tight">DrVijayas ToothSpa</p>
            <p className="text-xs text-white/70 mt-0.5">Clinic Administration</p>
          </div>
          <nav className="p-3 flex lg:flex-col gap-1 overflow-x-auto">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                    active ? 'bg-white/15 text-white' : 'text-white/75 hover:bg-white/8 hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-white/10 space-y-2 hidden lg:block">
          <div className="text-xs text-white/75 truncate">
            <span className="font-medium text-white block truncate">{admin.name}</span>
            <span>{admin.email}</span> · <span className="capitalize">{admin.role.replace('_', ' ')}</span>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onExitToSite}
              className="flex-1 px-3 py-1.5 rounded bg-white/10 text-xs font-medium hover:bg-white/20"
            >
              View Site
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="px-3 py-1.5 rounded bg-white/10 text-xs font-medium hover:bg-red-500/80 inline-flex items-center gap-1"
            >
              <LogOut className="w-3.5 h-3.5" />
              Out
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 flex flex-col">
        <header className="bg-white border-b border-[#252A27]/10 px-6 py-4 flex items-center justify-between gap-4">
          <div className="text-sm text-[#252A27]/65">
            Admin <span className="mx-1.5">/</span>{' '}
            <span className="font-medium text-[#234536]">
              {navItems.find((n) => n.id === tab)?.label}
            </span>
          </div>
          <div className="flex items-center gap-3 lg:hidden">
            <button type="button" onClick={onExitToSite} className="text-xs font-medium text-[#365B4B]">
              View Site
            </button>
            <button type="button" onClick={handleLogout} className="text-xs font-medium text-red-700">
              Sign Out
            </button>
          </div>
        </header>

        <div className="p-6 md:p-8 space-y-6 max-w-7xl w-full">
          {bannerMsg && (
            <div
              className={`p-3.5 rounded-lg border text-sm ${
                bannerMsg.type === 'ok'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-red-50 border-red-200 text-red-800'
              }`}
            >
              {bannerMsg.text}
            </div>
          )}

          {/* ==================== OVERVIEW ==================== */}
          {tab === 'overview' && overview && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
                {[
                  { label: 'Total Bookings', val: overview.counts?.total || 0 },
                  { label: "Today's Visits", val: overview.counts?.today || 0 },
                  { label: 'Upcoming Active', val: overview.counts?.upcoming || 0 },
                  { label: 'Pending Confirm', val: overview.counts?.pending || 0 },
                  { label: 'Completed', val: overview.counts?.completed || 0 },
                  { label: 'Cancelled', val: overview.counts?.cancelled || 0 },
                ].map((kpi) => (
                  <div key={kpi.label} className="bg-white rounded-xl border border-[#252A27]/10 p-4">
                    <p className="text-xs text-[#252A27]/60">{kpi.label}</p>
                    <p className="font-display text-3xl font-semibold text-[#234536] mt-1 tabular-nums">
                      {kpi.val}
                    </p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-5 bg-white rounded-xl border border-[#252A27]/10 p-6 space-y-4">
                  <h2 className="font-display text-2xl font-semibold text-[#234536]">
                    Provider Integration Readiness
                  </h2>
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center justify-between py-2 border-b border-[#252A27]/8">
                      <span>Automated Email (SMTP)</span>
                      <span
                        className={`text-xs font-medium ${
                          overview.integrations?.smtpConfigured ? 'text-emerald-700' : 'text-amber-700'
                        }`}
                      >
                        {overview.integrations?.smtpConfigured ? 'Configured' : 'Requires SMTP env vars'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-[#252A27]/8">
                      <span>WhatsApp Business Cloud API</span>
                      <span
                        className={`text-xs font-medium ${
                          overview.integrations?.whatsappConfigured ? 'text-emerald-700' : 'text-amber-700'
                        }`}
                      >
                        {overview.integrations?.whatsappConfigured
                          ? 'Configured'
                          : 'Requires WHATSAPP_* env vars'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-[#252A27]/8">
                      <span>Google Maps Platform</span>
                      <span
                        className={`text-xs font-medium ${
                          overview.integrations?.mapsConfigured ? 'text-emerald-700' : 'text-amber-700'
                        }`}
                      >
                        {overview.integrations?.mapsConfigured ? 'Configured' : 'Requires API key'}
                      </span>
                    </div>
                    <div className="py-2 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span>
                          Supabase Database
                          {overview.integrations?.supabase?.projectId ? (
                            <span className="block text-[11px] font-mono text-[#252A27]/55">
                              {overview.integrations.supabase.projectId}
                            </span>
                          ) : null}
                        </span>
                        <span
                          className={`text-xs font-medium text-right ${
                            overview.integrations?.supabase?.schemaReady
                              ? 'text-emerald-700'
                              : overview.integrations?.supabase?.configured
                                ? 'text-amber-700'
                                : 'text-[#252A27]/60'
                          }`}
                        >
                          {overview.integrations?.supabase?.schemaReady
                            ? 'Connected & Syncing'
                            : overview.integrations?.supabase?.configured
                              ? 'Action Needed (Create Table)'
                              : 'Not Configured'}
                        </span>
                      </div>
                      {overview.integrations?.supabase?.configured &&
                        !overview.integrations?.supabase?.schemaReady && (
                          <div className="p-3 rounded-lg bg-[#FAF8F2] border border-[#252A27]/12 text-xs text-[#252A27]/80 space-y-2">
                            <p>{overview.integrations.supabase.statusMessage}</p>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={copyMigrationSql}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[#365B4B] text-white font-medium hover:bg-[#234536]"
                              >
                                <Copy className="w-3.5 h-3.5" />
                                Copy SQL Migration
                              </button>
                              {overview.integrations.supabase.projectId && (
                                <a
                                  href={`https://supabase.com/dashboard/project/${overview.integrations.supabase.projectId}/sql/new`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-[#252A27]/15 bg-white text-[#234536] font-medium hover:bg-[#EEE9DF]"
                                >
                                  Open SQL Editor
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                          </div>
                        )}
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-7 bg-white rounded-xl border border-[#252A27]/10 p-6 space-y-4">
                  <h2 className="font-display text-2xl font-semibold text-[#234536]">
                    Recent Activity Log
                  </h2>
                  {overview.recentLogs?.length === 0 ? (
                    <p className="text-sm text-[#252A27]/60">No activity recorded yet.</p>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto text-xs">
                      {overview.recentLogs.map((log: any) => (
                        <div
                          key={log.id}
                          className="flex items-start justify-between gap-4 py-2 border-b border-[#252A27]/8"
                        >
                          <div>
                            <span className="font-medium text-[#234536]">{log.action}</span>
                            <span className="text-[#252A27]/70"> · {log.details || log.entity_type}</span>
                            <p className="text-[#252A27]/55">{log.admin_email}</p>
                          </div>
                          <span className="font-mono text-[#252A27]/50 shrink-0 tabular-nums">
                            {String(log.created_at).slice(0, 16)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ==================== APPOINTMENTS ==================== */}
          {tab === 'appointments' && (
            <div className="space-y-4">
              {/* Top Action Header */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-2xl md:text-3xl font-semibold text-[#234536]">
                    Appointment Bookings
                  </h2>
                  <p className="text-xs text-[#252A27]/65 mt-0.5 inline-flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-[#365B4B]" />
                    <span>
                      {appointments.length} {appointments.length === 1 ? 'record' : 'records'} loaded
                      {supabaseReadInfo?.accessible
                        ? ` · Synced with Supabase (${supabaseReadInfo.count} cloud rows)`
                        : ' · Local Clinic DB (new website bookings auto-sync to Supabase)'}
                    </span>
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      loadAppointments();
                      loadAllAdminData();
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#252A27]/15 bg-white text-xs font-medium text-[#252A27] hover:bg-[#EEE9DF]"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${appointmentsLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const todayIst = overview?.todayIst || new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
                      setCreatingAppointment({
                        full_name: '',
                        phone: '',
                        email: '',
                        treatment_id: treatments[0]?.id || 1,
                        dentist_id: 'any',
                        appointment_date: todayIst,
                        start_time: '',
                        status: 'Confirmed',
                        notes: '',
                      });
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#365B4B] text-white text-xs font-medium hover:bg-[#234536]"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    New Appointment
                  </button>
                  <a
                    href="/api/admin/appointments/export.csv"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#365B4B]/30 bg-white text-[#234536] text-xs font-medium hover:bg-[#EEE9DF]"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export CSV
                  </a>
                </div>
              </div>

              {supabaseReadInfo && !supabaseReadInfo.accessible && (
                <div className="p-3 rounded-lg bg-[#FAF8F2] border border-[#C6A66B]/40 text-xs text-[#252A27]/80 flex flex-wrap items-center justify-between gap-2">
                  <span>{supabaseReadInfo.reason}</span>
                  {overview?.integrations?.supabase?.projectId && (
                    <a
                      href={`https://supabase.com/dashboard/project/${overview.integrations.supabase.projectId}/editor`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-[#365B4B] hover:underline shrink-0"
                    >
                      Open Supabase Table Editor
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              )}

              {/* Quick Status Filter Tabs */}
              <div className="flex flex-wrap items-center gap-1.5 border-b border-[#252A27]/10 pb-3">
                {[
                  { label: 'All', val: '', count: overview?.counts?.total },
                  { label: 'Pending', val: 'Pending', count: overview?.counts?.pending },
                  { label: 'Confirmed', val: 'Confirmed', count: overview?.counts?.confirmed },
                  { label: 'Completed', val: 'Completed', count: overview?.counts?.completed },
                  { label: 'Cancelled', val: 'Cancelled', count: overview?.counts?.cancelled },
                  { label: 'No-show', val: 'No-show', count: overview?.counts?.no_show },
                ].map((s) => {
                  const active = apptStatus === s.val;
                  return (
                    <button
                      key={s.label}
                      type="button"
                      onClick={() => setApptStatus(s.val)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors tabular-nums ${
                        active
                          ? 'bg-[#234536] text-white'
                          : 'bg-white border border-[#252A27]/12 text-[#252A27]/80 hover:bg-[#EEE9DF]'
                      }`}
                    >
                      {s.label}
                      {typeof s.count === 'number' ? ` (${s.count})` : ''}
                    </button>
                  );
                })}
              </div>

              {/* Search & Filter Row */}
              <div className="bg-white rounded-xl border border-[#252A27]/10 p-4 flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-xs text-[#252A27]/65 mb-1">
                    Search Patient / Phone / Email / Ref
                  </label>
                  <div className="relative">
                    <Search className="w-4 h-4 text-[#252A27]/40 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      value={apptSearch}
                      onChange={(e) => setApptSearch(e.target.value)}
                      placeholder="Name, phone, email, or TS-..."
                      className="w-full pl-9 pr-3 py-2 rounded-lg border border-[#252A27]/15 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-[#252A27]/65 mb-1">Date</label>
                  <input
                    type="date"
                    value={apptDate}
                    onChange={(e) => setApptDate(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-[#252A27]/15 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#252A27]/65 mb-1">Dentist</label>
                  <select
                    value={apptDentist}
                    onChange={(e) => setApptDentist(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-[#252A27]/15 text-sm bg-white"
                  >
                    <option value="">All Dentists</option>
                    {dentists.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[#252A27]/65 mb-1">Treatment</label>
                  <select
                    value={apptTreatment}
                    onChange={(e) => setApptTreatment(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-[#252A27]/15 text-sm bg-white"
                  >
                    <option value="">All Treatments</option>
                    {treatments.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
                {(apptSearch || apptDate || apptDentist || apptTreatment || apptStatus) && (
                  <button
                    type="button"
                    onClick={() => {
                      setApptSearch('');
                      setApptDate('');
                      setApptDentist('');
                      setApptTreatment('');
                      setApptStatus('');
                    }}
                    className="px-3 py-2 rounded-lg border border-[#252A27]/15 text-xs font-medium text-[#252A27]/75 hover:bg-[#EEE9DF]"
                  >
                    Clear Filters
                  </button>
                )}
              </div>

              {/* Appointments Data Table */}
              <div className="bg-white rounded-xl border border-[#252A27]/10 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#FAF8F2] border-b border-[#252A27]/10 text-xs text-[#252A27]/70">
                    <tr>
                      <th className="py-3 px-4 font-medium">Ref</th>
                      <th className="py-3 px-4 font-medium">Patient</th>
                      <th className="py-3 px-4 font-medium">Treatment</th>
                      <th className="py-3 px-4 font-medium">Dentist</th>
                      <th className="py-3 px-4 font-medium">Date & Time</th>
                      <th className="py-3 px-4 font-medium">Status</th>
                      <th className="py-3 px-4 font-medium text-right">Manage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#252A27]/8">
                    {appointments.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-[#252A27]/60">
                          {appointmentsLoading
                            ? 'Loading appointments from database...'
                            : 'No appointments match your current filters.'}
                        </td>
                      </tr>
                    ) : (
                      appointments.map((a) => (
                        <tr key={`${a.booking_ref}-${a.id}`} className="hover:bg-[#FAF8F2]/70">
                          <td className="py-3 px-4">
                            <button
                              type="button"
                              onClick={() => setViewingAppointment(a)}
                              className="font-mono text-xs font-semibold text-[#234536] hover:underline"
                            >
                              {a.booking_ref}
                            </button>
                            {a.source_db === 'supabase' && (
                              <span className="block text-[10px] text-[#365B4B] mt-0.5">Cloud</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <p className="font-medium text-[#252A27]">{a.patient_name}</p>
                            <p className="text-xs text-[#252A27]/65 tabular-nums">{a.patient_phone}</p>
                            {a.patient_email && (
                              <p className="text-[11px] text-[#252A27]/50 truncate max-w-[180px]">
                                {a.patient_email}
                              </p>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <p>{a.treatment_name}</p>
                            <p className="text-xs text-[#252A27]/60 tabular-nums">{a.duration_minutes} min</p>
                          </td>
                          <td className="py-3 px-4 text-xs">{a.dentist_name}</td>
                          <td className="py-3 px-4 text-xs tabular-nums">
                            <p className="font-medium">{formatDisplayDate(a.appointment_date)}</p>
                            <p className="text-[#252A27]/65">
                              {formatTime12h(a.start_time)} – {formatTime12h(a.end_time)}
                            </p>
                          </td>
                          <td className="py-3 px-4 text-xs font-semibold">
                            <span
                              className={
                                a.status === 'Confirmed'
                                  ? 'text-emerald-700'
                                  : a.status === 'Pending'
                                    ? 'text-amber-700'
                                    : a.status === 'Cancelled' || a.status === 'No-show'
                                      ? 'text-red-700'
                                      : 'text-[#365B4B]'
                              }
                            >
                              {a.status}
                            </span>
                            {a.notes && (
                              <p className="text-[11px] font-normal text-[#252A27]/55 truncate max-w-[140px] mt-0.5">
                                {a.notes}
                              </p>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="inline-flex flex-wrap items-center justify-end gap-1.5 text-xs">
                              <button
                                type="button"
                                onClick={() => setViewingAppointment(a)}
                                title="View booking details"
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[#252A27]/15 hover:bg-[#EEE9DF]"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                View
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditAppointment(a)}
                                title="Edit appointment details"
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[#252A27]/15 hover:bg-[#EEE9DF]"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                                Edit
                              </button>
                              {a.status === 'Pending' && (
                                <button
                                  type="button"
                                  onClick={() => updateAppointmentStatus(a, 'Confirmed')}
                                  className="px-2.5 py-1 rounded bg-[#365B4B] text-white hover:bg-[#234536]"
                                >
                                  Confirm
                                </button>
                              )}
                              {(a.status === 'Pending' || a.status === 'Confirmed') && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => updateAppointmentStatus(a, 'Completed')}
                                    className="px-2.5 py-1 rounded border border-[#252A27]/15 hover:bg-[#EEE9DF]"
                                  >
                                    Complete
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setCancellingAppointment({ appt: a, reason: '' })}
                                    className="px-2.5 py-1 rounded border border-red-200 text-red-700 hover:bg-red-50"
                                  >
                                    Cancel
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* VIEW APPOINTMENT DETAILS MODAL */}
              {viewingAppointment && (
                <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
                  <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-xl">
                    <div className="flex items-start justify-between gap-4 border-b border-[#252A27]/10 pb-4">
                      <div>
                        <p className="text-xs font-mono text-[#C6A66B] font-semibold">
                          {viewingAppointment.booking_ref}
                        </p>
                        <h3 className="font-display text-2xl font-semibold text-[#234536] mt-0.5">
                          Appointment Details
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => setViewingAppointment(null)}
                        aria-label="Close appointment details"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                      <div>
                        <dt className="text-xs text-[#252A27]/60">Patient Name</dt>
                        <dd className="font-medium mt-0.5">{viewingAppointment.patient_name}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[#252A27]/60">Mobile Number</dt>
                        <dd className="font-medium tabular-nums mt-0.5">
                          <a href={`tel:${viewingAppointment.patient_phone}`} className="text-[#365B4B] hover:underline">
                            {viewingAppointment.patient_phone}
                          </a>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[#252A27]/60">Email</dt>
                        <dd className="font-medium mt-0.5">
                          {viewingAppointment.patient_email || 'Not provided'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[#252A27]/60">Status</dt>
                        <dd className="font-semibold text-[#234536] mt-0.5">{viewingAppointment.status}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[#252A27]/60">Treatment</dt>
                        <dd className="font-medium mt-0.5">
                          {viewingAppointment.treatment_name} ({viewingAppointment.duration_minutes} min)
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[#252A27]/60">Assigned Dentist</dt>
                        <dd className="font-medium mt-0.5">{viewingAppointment.dentist_name}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[#252A27]/60">Appointment Date</dt>
                        <dd className="font-medium mt-0.5">
                          {formatDisplayDate(viewingAppointment.appointment_date)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[#252A27]/60">Time Slot</dt>
                        <dd className="font-medium tabular-nums mt-0.5">
                          {formatTime12h(viewingAppointment.start_time)} –{' '}
                          {formatTime12h(viewingAppointment.end_time)}
                        </dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-xs text-[#252A27]/60">Patient / Clinic Notes</dt>
                        <dd className="mt-1 p-3 rounded-lg bg-[#FAF8F2] border border-[#252A27]/10 text-xs text-[#252A27]/85">
                          {viewingAppointment.notes || 'No notes recorded.'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[#252A27]/60">Created</dt>
                        <dd className="text-xs font-mono text-[#252A27]/70 mt-0.5">
                          {String(viewingAppointment.created_at).slice(0, 19).replace('T', ' ')}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[#252A27]/60">Database Sync</dt>
                        <dd className="text-xs text-[#252A27]/75 mt-0.5">
                          {viewingAppointment.source_db === 'sqlite+supabase'
                            ? 'Synced (Local DB + Supabase)'
                            : viewingAppointment.source_db === 'supabase'
                              ? 'Supabase Cloud DB'
                              : 'Local Clinic DB'}
                        </dd>
                      </div>
                    </dl>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-4 border-t border-[#252A27]/10">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const target = viewingAppointment;
                            setViewingAppointment(null);
                            openEditAppointment(target);
                          }}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#365B4B] text-white text-xs font-medium hover:bg-[#234536]"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          Edit Appointment
                        </button>
                        {viewingAppointment.status === 'Pending' && (
                          <button
                            type="button"
                            onClick={() => updateAppointmentStatus(viewingAppointment, 'Confirmed')}
                            className="px-3.5 py-2 rounded-lg border border-[#365B4B] text-[#365B4B] text-xs font-medium hover:bg-[#FAF8F2]"
                          >
                            Confirm Visit
                          </button>
                        )}
                        {(viewingAppointment.status === 'Pending' ||
                          viewingAppointment.status === 'Confirmed') && (
                          <button
                            type="button"
                            onClick={() => {
                              const target = viewingAppointment;
                              setViewingAppointment(null);
                              setCancellingAppointment({ appt: target, reason: '' });
                            }}
                            className="px-3.5 py-2 rounded-lg border border-red-200 text-red-700 text-xs font-medium hover:bg-red-50"
                          >
                            Cancel Visit
                          </button>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setViewingAppointment(null)}
                        className="px-4 py-2 rounded-lg border border-[#252A27]/15 text-xs font-medium"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* FULL EDIT APPOINTMENT MODAL */}
              {editingAppointment && (
                <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
                  <form
                    onSubmit={submitEditAppointment}
                    className="bg-white rounded-2xl max-w-2xl w-full p-6 space-y-4 max-h-[92vh] overflow-y-auto shadow-xl"
                  >
                    <div className="flex items-center justify-between border-b border-[#252A27]/10 pb-3">
                      <div>
                        <p className="text-xs font-mono text-[#C6A66B] font-semibold">
                          {editingAppointment.booking_ref}
                        </p>
                        <h3 className="font-display text-2xl font-semibold text-[#234536]">
                          Edit Appointment
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditingAppointment(null)}
                        aria-label="Close edit modal"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                      <div>
                        <label className="block text-xs font-medium mb-1">Patient Full Name *</label>
                        <input
                          type="text"
                          required
                          value={editingAppointment.patient_name}
                          onChange={(e) =>
                            setEditingAppointment({ ...editingAppointment, patient_name: e.target.value })
                          }
                          className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Mobile Number *</label>
                        <input
                          type="tel"
                          required
                          value={editingAppointment.patient_phone}
                          onChange={(e) =>
                            setEditingAppointment({ ...editingAppointment, patient_phone: e.target.value })
                          }
                          className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Email Address</label>
                        <input
                          type="email"
                          value={editingAppointment.patient_email}
                          onChange={(e) =>
                            setEditingAppointment({ ...editingAppointment, patient_email: e.target.value })
                          }
                          className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Booking Status *</label>
                        <select
                          value={editingAppointment.status}
                          onChange={(e) =>
                            setEditingAppointment({
                              ...editingAppointment,
                              status: e.target.value as Appointment['status'],
                            })
                          }
                          className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20 bg-white"
                        >
                          {['Pending', 'Confirmed', 'Completed', 'Cancelled', 'No-show'].map((st) => (
                            <option key={st} value={st}>
                              {st}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Treatment *</label>
                        <select
                          value={editingAppointment.treatment_id}
                          onChange={(e) =>
                            setEditingAppointment({
                              ...editingAppointment,
                              treatment_id: Number(e.target.value),
                            })
                          }
                          className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20 bg-white"
                        >
                          {treatments.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name} ({t.duration_minutes} min)
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Assigned Dentist *</label>
                        <select
                          value={editingAppointment.assigned_dentist_id}
                          onChange={(e) =>
                            setEditingAppointment({
                              ...editingAppointment,
                              assigned_dentist_id: Number(e.target.value),
                            })
                          }
                          className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20 bg-white"
                        >
                          {dentists.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Appointment Date *</label>
                        <input
                          type="date"
                          required
                          value={editingAppointment.appointment_date}
                          onChange={(e) =>
                            setEditingAppointment({
                              ...editingAppointment,
                              appointment_date: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Start Time (HH:MM) *</label>
                        <input
                          type="time"
                          required
                          value={editingAppointment.start_time}
                          onChange={(e) =>
                            setEditingAppointment({
                              ...editingAppointment,
                              start_time: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20"
                        />
                      </div>
                    </div>

                    {editSlots.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-[#252A27]/70 mb-1.5">
                          Quick Select Open Slot for {formatDisplayDate(editingAppointment.appointment_date)}:
                        </p>
                        <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                          {editSlots.map((s) => (
                            <button
                              key={s.start_time}
                              type="button"
                              onClick={() =>
                                setEditingAppointment({
                                  ...editingAppointment,
                                  start_time: s.start_time,
                                })
                              }
                              className={`px-2.5 py-1 rounded text-xs tabular-nums border ${
                                editingAppointment.start_time === s.start_time
                                  ? 'bg-[#365B4B] text-white border-[#365B4B]'
                                  : 'bg-[#FAF8F2] border-[#252A27]/15 hover:border-[#365B4B]'
                              }`}
                            >
                              {s.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-medium mb-1">Notes</label>
                      <textarea
                        rows={3}
                        maxLength={500}
                        value={editingAppointment.notes}
                        onChange={(e) =>
                          setEditingAppointment({ ...editingAppointment, notes: e.target.value })
                        }
                        placeholder="Clinic remarks or scheduling preferences..."
                        className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20 text-sm"
                      />
                    </div>

                    <div className="flex justify-end gap-2 pt-3 border-t border-[#252A27]/10">
                      <button
                        type="button"
                        onClick={() => setEditingAppointment(null)}
                        className="px-4 py-2 rounded-lg border border-[#252A27]/15 text-sm"
                      >
                        Close
                      </button>
                      <button
                        type="submit"
                        disabled={savingAppt}
                        className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[#365B4B] text-white text-sm font-medium hover:bg-[#234536] disabled:opacity-60"
                      >
                        {savingAppt && <Loader2 className="w-4 h-4 animate-spin" />}
                        Save Changes
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* NEW APPOINTMENT MODAL (WALK-IN / PHONE BOOKING) */}
              {creatingAppointment && (
                <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
                  <form
                    onSubmit={submitCreateAppointment}
                    className="bg-white rounded-2xl max-w-2xl w-full p-6 space-y-4 max-h-[92vh] overflow-y-auto shadow-xl"
                  >
                    <div className="flex items-center justify-between border-b border-[#252A27]/10 pb-3">
                      <h3 className="font-display text-2xl font-semibold text-[#234536]">
                        Create New Appointment
                      </h3>
                      <button
                        type="button"
                        onClick={() => setCreatingAppointment(null)}
                        aria-label="Close new appointment modal"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                      <div>
                        <label className="block text-xs font-medium mb-1">Patient Full Name *</label>
                        <input
                          type="text"
                          required
                          value={creatingAppointment.full_name}
                          onChange={(e) =>
                            setCreatingAppointment({ ...creatingAppointment, full_name: e.target.value })
                          }
                          className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Mobile Number *</label>
                        <input
                          type="tel"
                          required
                          placeholder="+91 98XXX XXXXX"
                          value={creatingAppointment.phone}
                          onChange={(e) =>
                            setCreatingAppointment({ ...creatingAppointment, phone: e.target.value })
                          }
                          className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Email (Optional)</label>
                        <input
                          type="email"
                          value={creatingAppointment.email}
                          onChange={(e) =>
                            setCreatingAppointment({ ...creatingAppointment, email: e.target.value })
                          }
                          className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Initial Status</label>
                        <select
                          value={creatingAppointment.status}
                          onChange={(e) =>
                            setCreatingAppointment({
                              ...creatingAppointment,
                              status: e.target.value as 'Pending' | 'Confirmed',
                            })
                          }
                          className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20 bg-white"
                        >
                          <option value="Confirmed">Confirmed</option>
                          <option value="Pending">Pending</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Treatment *</label>
                        <select
                          value={creatingAppointment.treatment_id}
                          onChange={(e) =>
                            setCreatingAppointment({
                              ...creatingAppointment,
                              treatment_id: Number(e.target.value),
                              start_time: '',
                            })
                          }
                          className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20 bg-white"
                        >
                          {treatments.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name} ({t.duration_minutes} min)
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Dentist *</label>
                        <select
                          value={creatingAppointment.dentist_id}
                          onChange={(e) =>
                            setCreatingAppointment({
                              ...creatingAppointment,
                              dentist_id: e.target.value === 'any' ? 'any' : Number(e.target.value),
                              start_time: '',
                            })
                          }
                          className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20 bg-white"
                        >
                          <option value="any">Any Available Dentist</option>
                          {dentists.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Date *</label>
                        <input
                          type="date"
                          required
                          value={creatingAppointment.appointment_date}
                          onChange={(e) =>
                            setCreatingAppointment({
                              ...creatingAppointment,
                              appointment_date: e.target.value,
                              start_time: '',
                            })
                          }
                          className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium mb-1.5">Available Time Slot *</label>
                      {createSlots.length === 0 ? (
                        <p className="text-xs text-[#252A27]/65 p-3 rounded-lg bg-[#FAF8F2] border border-[#252A27]/10">
                          No open slots found for this date/dentist combination. Select another date.
                        </p>
                      ) : (
                        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 max-h-40 overflow-y-auto">
                          {createSlots.map((s) => (
                            <button
                              key={s.start_time}
                              type="button"
                              onClick={() =>
                                setCreatingAppointment({
                                  ...creatingAppointment,
                                  start_time: s.start_time,
                                })
                              }
                              className={`py-2 px-2 rounded text-xs font-medium tabular-nums border ${
                                creatingAppointment.start_time === s.start_time
                                  ? 'bg-[#365B4B] text-white border-[#365B4B]'
                                  : 'bg-white border-[#252A27]/15 hover:border-[#365B4B]'
                              }`}
                            >
                              {s.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-medium mb-1">Notes</label>
                      <textarea
                        rows={2}
                        maxLength={500}
                        value={creatingAppointment.notes}
                        onChange={(e) =>
                          setCreatingAppointment({ ...creatingAppointment, notes: e.target.value })
                        }
                        className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20 text-sm"
                      />
                    </div>

                    <div className="flex justify-end gap-2 pt-3 border-t border-[#252A27]/10">
                      <button
                        type="button"
                        onClick={() => setCreatingAppointment(null)}
                        className="px-4 py-2 rounded-lg border border-[#252A27]/15 text-sm"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={savingAppt || !creatingAppointment.start_time}
                        className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[#365B4B] text-white text-sm font-medium hover:bg-[#234536] disabled:opacity-50"
                      >
                        {savingAppt && <Loader2 className="w-4 h-4 animate-spin" />}
                        Create Appointment
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* CANCEL APPOINTMENT CONFIRMATION MODAL */}
              {cancellingAppointment && (
                <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
                  <form
                    onSubmit={submitCancelAppointment}
                    className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="font-display text-2xl font-semibold text-red-800">
                        Cancel {cancellingAppointment.appt.booking_ref}?
                      </h3>
                      <button
                        type="button"
                        onClick={() => setCancellingAppointment(null)}
                        aria-label="Close cancel modal"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <p className="text-sm text-[#252A27]/80">
                      This will cancel <strong>{cancellingAppointment.appt.patient_name}</strong>&apos;s{' '}
                      <strong>{cancellingAppointment.appt.treatment_name}</strong> visit on{' '}
                      {formatDisplayDate(cancellingAppointment.appt.appointment_date)} at{' '}
                      {formatTime12h(cancellingAppointment.appt.start_time)} and free the time slot.
                    </p>
                    <div>
                      <label className="block text-xs font-medium mb-1">
                        Cancellation Reason (Optional)
                      </label>
                      <input
                        type="text"
                        maxLength={200}
                        placeholder="e.g. Patient requested cancellation by phone"
                        value={cancellingAppointment.reason}
                        onChange={(e) =>
                          setCancellingAppointment({
                            ...cancellingAppointment,
                            reason: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20 text-sm"
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setCancellingAppointment(null)}
                        className="px-4 py-2 rounded-lg border border-[#252A27]/15 text-sm"
                      >
                        Keep Appointment
                      </button>
                      <button
                        type="submit"
                        disabled={savingAppt}
                        className="px-4 py-2 rounded-lg bg-red-700 text-white text-sm font-medium hover:bg-red-800 disabled:opacity-60"
                      >
                        Confirm Cancellation
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {rescheduleTarget && (
                <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
                  <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-display text-2xl font-semibold text-[#234536]">
                        Reschedule {rescheduleTarget.booking_ref}
                      </h3>
                      <button type="button" onClick={() => setRescheduleTarget(null)}>
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">New Date</label>
                      <input
                        type="date"
                        value={rescheduleDate}
                        onChange={(e) => {
                          setRescheduleDate(e.target.value);
                          setRescheduleTime('');
                        }}
                        className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Available Time</label>
                      <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                        {rescheduleSlots.map((s) => (
                          <button
                            key={s.start_time}
                            type="button"
                            onClick={() => setRescheduleTime(s.start_time)}
                            className={`py-2 px-2 rounded text-xs font-medium tabular-nums border ${
                              rescheduleTime === s.start_time
                                ? 'bg-[#365B4B] text-white border-[#365B4B]'
                                : 'border-[#252A27]/15'
                            }`}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setRescheduleTarget(null)}
                        className="px-4 py-2 rounded-lg border text-sm"
                      >
                        Close
                      </button>
                      <button
                        type="button"
                        disabled={!rescheduleTime}
                        onClick={submitAdminReschedule}
                        className="px-4 py-2 rounded-lg bg-[#365B4B] text-white text-sm disabled:opacity-50"
                      >
                        Save New Slot
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ==================== DENTISTS ==================== */}
          {tab === 'dentists' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-2xl font-semibold text-[#234536]">
                  Dentist Profiles & Schedules
                </h2>
                {canEditClinic && (
                  <button
                    type="button"
                    onClick={() =>
                      setEditingDentist({
                        name: '',
                        title: 'Dental Practitioner',
                        qualifications: '',
                        bio: '',
                        photo_url: null,
                        is_active: 1,
                        treatment_ids: treatments.map((t) => t.id),
                        schedules: DAY_NAMES.map((_, dow) => ({
                          day_of_week: dow,
                          is_working: 1,
                          start_time: '10:30',
                          end_time: '21:30',
                        })),
                      })
                    }
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#365B4B] text-white text-sm font-medium"
                  >
                    <Plus className="w-4 h-4" />
                    Add Dentist
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {dentists.map((d) => (
                  <div
                    key={d.id}
                    className="bg-white rounded-xl border border-[#252A27]/10 p-5 flex items-start justify-between gap-4"
                  >
                    <div className="flex items-start gap-4">
                      {d.photo_url ? (
                        <div className="w-14 h-14 rounded-full overflow-hidden shrink-0 border border-[#252A27]/10">
                          <ClinicImage src={d.photo_url} alt={d.name} />
                        </div>
                      ) : (
                        <div className="w-14 h-14 rounded-full bg-[#EEE9DF] text-[#234536] flex items-center justify-center font-display text-lg font-semibold shrink-0">
                          {getInitials(d.name)}
                        </div>
                      )}
                      <div>
                        <h3 className="font-display text-xl font-semibold text-[#234536]">{d.name}</h3>
                        <p className="text-xs text-[#365B4B] font-medium">
                          {d.title} {d.qualifications ? `· ${d.qualifications}` : ''}
                        </p>
                        <p className="text-xs text-[#252A27]/65 mt-1">
                          Status: {d.is_active ? 'Active' : 'Inactive'} · {d.treatment_ids.length} treatments assigned
                        </p>
                      </div>
                    </div>
                    {canEditClinic && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setEditingDentist(d)}
                          className="p-2 rounded-lg border border-[#252A27]/15 hover:bg-[#EEE9DF]"
                          aria-label={`Edit ${d.name}`}
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteDentist(d.id)}
                          className="p-2 rounded-lg border border-red-200 text-red-700 hover:bg-red-50"
                          aria-label={`Delete ${d.name}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {editingDentist && (
                <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
                  <form
                    onSubmit={saveDentist}
                    className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4"
                  >
                    <div className="flex items-center justify-between border-b pb-3">
                      <h3 className="font-display text-2xl font-semibold text-[#234536]">
                        {editingDentist.id ? 'Edit Dentist' : 'Add Verified Dentist'}
                      </h3>
                      <button type="button" onClick={() => setEditingDentist(null)}>
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium mb-1">Full Name *</label>
                        <input
                          required
                          value={editingDentist.name || ''}
                          onChange={(e) => setEditingDentist({ ...editingDentist, name: e.target.value })}
                          className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Role / Title</label>
                        <input
                          value={editingDentist.title || ''}
                          onChange={(e) => setEditingDentist({ ...editingDentist, title: e.target.value })}
                          className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Verified Qualifications</label>
                        <input
                          value={editingDentist.qualifications || ''}
                          onChange={(e) =>
                            setEditingDentist({ ...editingDentist, qualifications: e.target.value })
                          }
                          placeholder="Leave blank if unverified"
                          className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Profile Photo</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              try {
                                const url = await uploadImageFile(file);
                                setEditingDentist({ ...editingDentist, photo_url: url });
                              } catch (err) {
                                notify('err', err instanceof Error ? err.message : 'Upload failed');
                              }
                            }}
                            className="text-xs w-full"
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium mb-1">Bio</label>
                      <textarea
                        rows={2}
                        value={editingDentist.bio || ''}
                        onChange={(e) => setEditingDentist({ ...editingDentist, bio: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20 text-sm"
                      />
                    </div>

                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={Boolean(editingDentist.is_active)}
                        onChange={(e) =>
                          setEditingDentist({ ...editingDentist, is_active: e.target.checked ? 1 : 0 })
                        }
                      />
                      Active and available for online bookings
                    </label>

                    <div>
                      <p className="text-xs font-semibold mb-2">Assigned Treatments</p>
                      <div className="grid grid-cols-2 gap-2">
                        {treatments.map((t) => {
                          const checked = editingDentist.treatment_ids?.includes(t.id) || false;
                          return (
                            <label key={t.id} className="flex items-center gap-2 text-xs">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const prev = editingDentist.treatment_ids || [];
                                  const next = e.target.checked
                                    ? [...prev, t.id]
                                    : prev.filter((id) => id !== t.id);
                                  setEditingDentist({ ...editingDentist, treatment_ids: next });
                                }}
                              />
                              <span>{t.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-semibold mb-2">Weekly Working Schedule</p>
                      <div className="space-y-2">
                        {(editingDentist.schedules || []).map((s, idx) => (
                          <div key={s.day_of_week} className="flex items-center gap-3 text-xs">
                            <label className="w-28 flex items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={Boolean(s.is_working)}
                                onChange={(e) => {
                                  const next = [...(editingDentist.schedules || [])];
                                  next[idx] = { ...s, is_working: e.target.checked ? 1 : 0 };
                                  setEditingDentist({ ...editingDentist, schedules: next });
                                }}
                              />
                              <span>{DAY_NAMES[s.day_of_week]}</span>
                            </label>
                            <input
                              type="time"
                              value={s.start_time}
                              onChange={(e) => {
                                const next = [...(editingDentist.schedules || [])];
                                next[idx] = { ...s, start_time: e.target.value };
                                setEditingDentist({ ...editingDentist, schedules: next });
                              }}
                              className="px-2 py-1 border rounded"
                            />
                            <span>to</span>
                            <input
                              type="time"
                              value={s.end_time}
                              onChange={(e) => {
                                const next = [...(editingDentist.schedules || [])];
                                next[idx] = { ...s, end_time: e.target.value };
                                setEditingDentist({ ...editingDentist, schedules: next });
                              }}
                              className="px-2 py-1 border rounded"
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-3 border-t">
                      <button
                        type="button"
                        onClick={() => setEditingDentist(null)}
                        className="px-4 py-2 rounded-lg border text-sm"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-5 py-2 rounded-lg bg-[#365B4B] text-white text-sm font-medium"
                      >
                        Save Dentist
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          )}

          {/* ==================== TREATMENTS ==================== */}
          {tab === 'treatments' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="font-display text-2xl font-semibold text-[#234536]">
                    Expandable Treatment Catalog
                  </h2>
                  <p className="text-xs text-[#252A27]/65 mt-0.5">
                    Add verified treatments only after confirming clinic availability.
                  </p>
                </div>
                {canEditClinic && (
                  <button
                    type="button"
                    onClick={() =>
                      setEditingTreatment({
                        name: '',
                        short_description: '',
                        full_description: '',
                        duration_minutes: 30,
                        buffer_minutes: 10,
                        image_url: '/src/assets/images/treatment_care_1795284233215.jpg',
                        price_display: '',
                        is_active: 1,
                        assigned_dentist_ids: dentists.map((d) => d.id),
                      })
                    }
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#365B4B] text-white text-sm font-medium"
                  >
                    <Plus className="w-4 h-4" />
                    Add Verified Treatment
                  </button>
                )}
              </div>

              {canEditClinic && (
                <div className="bg-white rounded-xl border border-[#252A27]/10 p-4">
                  <p className="text-xs font-medium text-[#252A27]/75 mb-2">
                    Quick Add Verified Clinic Services (only activate once confirmed with the clinic):
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {EXPANDABLE_TREATMENT_TEMPLATES.map((tpl) => (
                      <button
                        key={tpl.name}
                        type="button"
                        onClick={() =>
                          setEditingTreatment({
                            name: tpl.name,
                            short_description: tpl.short_description,
                            full_description: tpl.short_description,
                            duration_minutes: tpl.duration_minutes,
                            buffer_minutes: 10,
                            image_url: '/src/assets/images/treatment_consultation_1795284232947.jpg',
                            price_display: '',
                            is_active: 1,
                            assigned_dentist_ids: dentists.map((d) => d.id),
                          })
                        }
                        className="px-3 py-1.5 rounded-lg border border-[#252A27]/15 text-xs font-medium hover:border-[#365B4B] hover:bg-[#FAF8F2]"
                      >
                        + {tpl.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {treatments.map((t, idx) => (
                  <div
                    key={t.id}
                    className="bg-white rounded-xl border border-[#252A27]/10 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-16 rounded-lg overflow-hidden shrink-0 border border-[#252A27]/10">
                        <ClinicImage src={t.image_url} alt={t.name} />
                      </div>
                      <div>
                        <h3 className="font-display text-xl font-semibold text-[#234536]">
                          {t.name}
                          {!t.is_active && (
                            <span className="ml-2 text-xs font-sans font-normal text-amber-700">
                              (Disabled)
                            </span>
                          )}
                        </h3>
                        <p className="text-xs text-[#252A27]/65 tabular-nums">
                          {t.duration_minutes} min · Buffer {t.buffer_minutes} min
                          {t.price_display ? ` · ${t.price_display}` : ''}
                        </p>
                        <p className="text-xs text-[#252A27]/75 mt-1 line-clamp-1">{t.short_description}</p>
                      </div>
                    </div>

                    {canEditClinic && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => moveTreatment(idx, -1)}
                          disabled={idx === 0}
                          className="p-2 rounded border border-[#252A27]/15 disabled:opacity-30"
                          aria-label="Move up"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveTreatment(idx, 1)}
                          disabled={idx === treatments.length - 1}
                          className="p-2 rounded border border-[#252A27]/15 disabled:opacity-30"
                          aria-label="Move down"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingTreatment(t)}
                          className="px-3 py-1.5 rounded border border-[#252A27]/15 text-xs font-medium hover:bg-[#EEE9DF]"
                        >
                          Edit
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {editingTreatment && (
                <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
                  <form
                    onSubmit={saveTreatment}
                    className="bg-white rounded-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4"
                  >
                    <div className="flex items-center justify-between border-b pb-3">
                      <h3 className="font-display text-2xl font-semibold text-[#234536]">
                        {editingTreatment.id ? 'Edit Treatment' : 'Add Treatment'}
                      </h3>
                      <button type="button" onClick={() => setEditingTreatment(null)}>
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div>
                      <label className="block text-xs font-medium mb-1">Treatment Name *</label>
                      <input
                        required
                        value={editingTreatment.name || ''}
                        onChange={(e) => setEditingTreatment({ ...editingTreatment, name: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20 text-sm"
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium mb-1">Duration (min)</label>
                        <select
                          value={editingTreatment.duration_minutes || 30}
                          onChange={(e) =>
                            setEditingTreatment({
                              ...editingTreatment,
                              duration_minutes: Number(e.target.value),
                            })
                          }
                          className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20 text-sm bg-white"
                        >
                          {[15, 30, 45, 60, 90].map((m) => (
                            <option key={m} value={m}>
                              {m} min
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Buffer (min)</label>
                        <input
                          type="number"
                          min={0}
                          max={30}
                          value={editingTreatment.buffer_minutes ?? 10}
                          onChange={(e) =>
                            setEditingTreatment({
                              ...editingTreatment,
                              buffer_minutes: Number(e.target.value),
                            })
                          }
                          className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Verified Fee (Optional)</label>
                        <input
                          value={editingTreatment.price_display || ''}
                          onChange={(e) =>
                            setEditingTreatment({ ...editingTreatment, price_display: e.target.value })
                          }
                          placeholder="Leave blank if unapproved"
                          className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20 text-sm"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium mb-1">Short Description *</label>
                      <textarea
                        rows={2}
                        required
                        value={editingTreatment.short_description || ''}
                        onChange={(e) =>
                          setEditingTreatment({ ...editingTreatment, short_description: e.target.value })
                        }
                        className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20 text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium mb-1">Full Description</label>
                      <textarea
                        rows={3}
                        value={editingTreatment.full_description || ''}
                        onChange={(e) =>
                          setEditingTreatment({ ...editingTreatment, full_description: e.target.value })
                        }
                        className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20 text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium mb-1">Treatment Image</label>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          try {
                            const url = await uploadImageFile(f);
                            setEditingTreatment({ ...editingTreatment, image_url: url });
                          } catch (err) {
                            notify('err', err instanceof Error ? err.message : 'Upload failed');
                          }
                        }}
                        className="text-xs"
                      />
                    </div>

                    <div>
                      <p className="text-xs font-medium mb-1.5">Assigned Dentists</p>
                      <div className="flex flex-wrap gap-3">
                        {dentists.map((d) => {
                          const checked = editingTreatment.assigned_dentist_ids?.includes(d.id) || false;
                          return (
                            <label key={d.id} className="flex items-center gap-1.5 text-xs">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const prev = editingTreatment.assigned_dentist_ids || [];
                                  const next = e.target.checked
                                    ? [...prev, d.id]
                                    : prev.filter((x) => x !== d.id);
                                  setEditingTreatment({ ...editingTreatment, assigned_dentist_ids: next });
                                }}
                              />
                              <span>{d.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={Boolean(editingTreatment.is_active)}
                        onChange={(e) =>
                          setEditingTreatment({
                            ...editingTreatment,
                            is_active: e.target.checked ? 1 : 0,
                          })
                        }
                      />
                      Active and bookable on website
                    </label>

                    <div className="flex justify-end gap-2 pt-3 border-t">
                      <button
                        type="button"
                        onClick={() => setEditingTreatment(null)}
                        className="px-4 py-2 rounded-lg border text-sm"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-5 py-2 rounded-lg bg-[#365B4B] text-white text-sm font-medium"
                      >
                        Save Treatment
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          )}

          {/* ==================== HOURS & HOLIDAYS ==================== */}
          {tab === 'hours' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 bg-white rounded-xl border border-[#252A27]/10 p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-2xl font-semibold text-[#234536]">
                    Clinic Operating Hours & Buffers
                  </h2>
                  {canEditClinic && (
                    <button
                      type="button"
                      onClick={saveClinicHours}
                      className="px-4 py-2 rounded-lg bg-[#365B4B] text-white text-xs font-medium"
                    >
                      Save Hours
                    </button>
                  )}
                </div>

                <div className="space-y-3 text-sm">
                  {hours.map((h, idx) => (
                    <div
                      key={h.day_of_week}
                      className="flex flex-wrap items-center justify-between gap-3 py-2 border-b border-[#252A27]/8"
                    >
                      <label className="w-28 flex items-center gap-2 font-medium">
                        <input
                          type="checkbox"
                          checked={Boolean(h.is_open)}
                          onChange={(e) => {
                            const next = [...hours];
                            next[idx] = { ...h, is_open: e.target.checked ? 1 : 0 };
                            setHours(next);
                          }}
                        />
                        <span>{h.day_name}</span>
                      </label>
                      <div className="flex items-center gap-2 text-xs">
                        <input
                          type="time"
                          value={h.open_time}
                          onChange={(e) => {
                            const next = [...hours];
                            next[idx] = { ...h, open_time: e.target.value };
                            setHours(next);
                          }}
                          className="px-2 py-1 border rounded"
                        />
                        <span>to</span>
                        <input
                          type="time"
                          value={h.close_time}
                          onChange={(e) => {
                            const next = [...hours];
                            next[idx] = { ...h, close_time: e.target.value };
                            setHours(next);
                          }}
                          className="px-2 py-1 border rounded"
                        />
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span>Interval</span>
                        <select
                          value={h.slot_interval_minutes}
                          onChange={(e) => {
                            const next = [...hours];
                            next[idx] = { ...h, slot_interval_minutes: Number(e.target.value) };
                            setHours(next);
                          }}
                          className="px-2 py-1 border rounded bg-white"
                        >
                          {[15, 30, 45].map((m) => (
                            <option key={m} value={m}>
                              {m}m
                            </option>
                          ))}
                        </select>
                        <span>Buffer</span>
                        <input
                          type="number"
                          min={0}
                          max={30}
                          value={h.booking_buffer_minutes}
                          onChange={(e) => {
                            const next = [...hours];
                            next[idx] = { ...h, booking_buffer_minutes: Number(e.target.value) };
                            setHours(next);
                          }}
                          className="w-14 px-2 py-1 border rounded"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="lg:col-span-5 bg-white rounded-xl border border-[#252A27]/10 p-6 space-y-4">
                <h2 className="font-display text-2xl font-semibold text-[#234536]">
                  Blocked Dates & Holidays
                </h2>
                {canEditClinic && (
                  <form onSubmit={addBlockedDate} className="space-y-3 bg-[#FAF8F2] p-4 rounded-lg border border-[#252A27]/10">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-medium mb-1">Date</label>
                        <input
                          type="date"
                          required
                          value={newBlockDate}
                          onChange={(e) => setNewBlockDate(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded border text-xs bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Scope</label>
                        <select
                          value={newBlockDentist}
                          onChange={(e) => setNewBlockDentist(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded border text-xs bg-white"
                        >
                          <option value="">Entire Clinic</option>
                          {dentists.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Reason / Holiday Name</label>
                      <input
                        type="text"
                        required
                        value={newBlockReason}
                        onChange={(e) => setNewBlockReason(e.target.value)}
                        placeholder="e.g., Public Holiday or Maintenance"
                        className="w-full px-2.5 py-1.5 rounded border text-xs bg-white"
                      />
                    </div>
                    <button
                      type="submit"
                      className="w-full py-2 rounded-lg bg-[#365B4B] text-white text-xs font-medium"
                    >
                      Block Date
                    </button>
                  </form>
                )}

                <div className="space-y-2 max-h-72 overflow-y-auto text-xs">
                  {blockedDates.length === 0 ? (
                    <p className="text-[#252A27]/60">No blocked dates scheduled.</p>
                  ) : (
                    blockedDates.map((b) => (
                      <div
                        key={b.id}
                        className="flex items-center justify-between gap-2 py-2 border-b border-[#252A27]/8"
                      >
                        <div>
                          <p className="font-medium tabular-nums">{formatDisplayDate(b.date)}</p>
                          <p className="text-[#252A27]/65">
                            {b.reason} · {b.dentist_name || 'Entire Clinic'}
                          </p>
                        </div>
                        {canEditClinic && (
                          <button
                            type="button"
                            onClick={async () => {
                              await fetch(`/api/admin/blocked-dates/${b.id}`, { method: 'DELETE' });
                              loadAllAdminData();
                              onPublicDataChanged();
                            }}
                            className="p-1.5 text-red-700 hover:bg-red-50 rounded"
                            aria-label="Remove blocked date"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ==================== TESTIMONIALS ==================== */}
          {tab === 'testimonials' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-display text-2xl font-semibold text-[#234536]">
                    Verified Patient Testimonials
                  </h2>
                  <p className="text-xs text-[#252A27]/65">
                    Publish authentic patient feedback only where permission and source attribution exist.
                  </p>
                </div>
                {canEditClinic && (
                  <button
                    type="button"
                    onClick={() =>
                      setEditingTestimonial({
                        patient_name: '',
                        review_text: '',
                        review_date: '',
                        source: 'Google Maps Review',
                        rating: 5,
                        is_published: 1,
                      })
                    }
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#365B4B] text-white text-sm font-medium"
                  >
                    <Plus className="w-4 h-4" />
                    Add Verified Review
                  </button>
                )}
              </div>

              {testimonials.length === 0 ? (
                <div className="bg-white rounded-xl border border-[#252A27]/10 p-8 text-center text-sm text-[#252A27]/65">
                  No manual patient testimonials added yet. Live Google reviews (when returned by Google Places) appear automatically on the website.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {testimonials.map((t) => (
                    <div key={t.id} className="bg-white rounded-xl border border-[#252A27]/10 p-5 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold text-sm">{t.patient_name}</p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingTestimonial(t)}
                            className="text-xs text-[#365B4B] hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await fetch(`/api/admin/testimonials/${t.id}`, { method: 'DELETE' });
                              loadAllAdminData();
                              onPublicDataChanged();
                            }}
                            className="text-xs text-red-700 hover:underline"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                      <p className="text-sm text-[#252A27]/80">"{t.review_text}"</p>
                      <p className="text-xs text-[#252A27]/55">
                        {t.source} {t.review_date ? `· ${t.review_date}` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {editingTestimonial && (
                <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
                  <form
                    onSubmit={saveTestimonial}
                    className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4"
                  >
                    <h3 className="font-display text-2xl font-semibold text-[#234536]">
                      {editingTestimonial.id ? 'Edit Testimonial' : 'Add Authentic Review'}
                    </h3>
                    <div>
                      <label className="block text-xs font-medium mb-1">Patient Display Name *</label>
                      <input
                        required
                        value={editingTestimonial.patient_name || ''}
                        onChange={(e) =>
                          setEditingTestimonial({ ...editingTestimonial, patient_name: e.target.value })
                        }
                        className="w-full px-3 py-2 rounded-lg border text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Review Text *</label>
                      <textarea
                        rows={3}
                        required
                        value={editingTestimonial.review_text || ''}
                        onChange={(e) =>
                          setEditingTestimonial({ ...editingTestimonial, review_text: e.target.value })
                        }
                        className="w-full px-3 py-2 rounded-lg border text-sm"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium mb-1">Source Attribution</label>
                        <input
                          value={editingTestimonial.source || ''}
                          onChange={(e) =>
                            setEditingTestimonial({ ...editingTestimonial, source: e.target.value })
                          }
                          className="w-full px-3 py-2 rounded-lg border text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Date (optional)</label>
                        <input
                          value={editingTestimonial.review_date || ''}
                          onChange={(e) =>
                            setEditingTestimonial({ ...editingTestimonial, review_date: e.target.value })
                          }
                          placeholder="e.g., March 2026"
                          className="w-full px-3 py-2 rounded-lg border text-sm"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setEditingTestimonial(null)}
                        className="px-4 py-2 rounded-lg border text-sm"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-2 rounded-lg bg-[#365B4B] text-white text-sm"
                      >
                        Save Review
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          )}

          {/* ==================== WEBSITE CONTENT & GALLERY ==================== */}
          {tab === 'content' && settings && (
            <form onSubmit={saveWebsiteSettings} className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-2xl font-semibold text-[#234536]">
                  Website Content, Media & Gallery
                </h2>
                {canEditClinic && (
                  <button
                    type="submit"
                    className="px-5 py-2.5 rounded-lg bg-[#365B4B] text-white text-sm font-medium"
                  >
                    Save Website Changes
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-xl border border-[#252A27]/10 p-6 space-y-4">
                  <h3 className="font-display text-xl font-semibold text-[#234536]">
                    Homepage Copy & Banners
                  </h3>
                  <div>
                    <label className="block text-xs font-medium mb-1">Announcement Bar Text</label>
                    <input
                      value={settings.announcement_text || ''}
                      onChange={(e) => setSettings({ ...settings, announcement_text: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Promotional Banner (optional)</label>
                    <input
                      value={settings.promotional_banner || ''}
                      onChange={(e) => setSettings({ ...settings, promotional_banner: e.target.value })}
                      placeholder="Leave blank if no active promotion"
                      className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Hero Headline</label>
                    <input
                      value={settings.hero_headline || ''}
                      onChange={(e) => setSettings({ ...settings, hero_headline: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Hero Supporting Text</label>
                    <textarea
                      rows={3}
                      value={settings.hero_subtext || ''}
                      onChange={(e) => setSettings({ ...settings, hero_subtext: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Replace Hero Photograph</label>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        try {
                          const url = await uploadImageFile(f);
                          setSettings({ ...settings, hero_image: url });
                          notify('ok', 'Hero image uploaded. Click Save Website Changes.');
                        } catch (err) {
                          notify('err', err instanceof Error ? err.message : 'Upload failed');
                        }
                      }}
                      className="text-xs"
                    />
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-[#252A27]/10 p-6 space-y-4">
                  <h3 className="font-display text-xl font-semibold text-[#234536]">
                    About & Contact Details
                  </h3>
                  <div>
                    <label className="block text-xs font-medium mb-1">About Title</label>
                    <input
                      value={settings.about_title || ''}
                      onChange={(e) => setSettings({ ...settings, about_title: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">About Description</label>
                    <textarea
                      rows={3}
                      value={settings.about_body || ''}
                      onChange={(e) => setSettings({ ...settings, about_body: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium mb-1">Phone Number</label>
                      <input
                        value={settings.phone || ''}
                        onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">WhatsApp Number</label>
                      <input
                        value={settings.whatsapp_number || ''}
                        onChange={(e) => setSettings({ ...settings, whatsapp_number: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20 text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Opening Hours Summary</label>
                    <input
                      value={settings.opening_hours_text || ''}
                      onChange={(e) => setSettings({ ...settings, opening_hours_text: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Google Maps Reviews URL</label>
                    <input
                      value={settings.google_maps_reviews_url || ''}
                      onChange={(e) =>
                        setSettings({ ...settings, google_maps_reviews_url: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-lg border border-[#252A27]/20 text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-[#252A27]/10 p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-xl font-semibold text-[#234536]">
                    Clinic Gallery Photographs
                  </h3>
                  <span className="text-xs text-[#252A27]/65">
                    Replace placeholders with authentic clinic photographs anytime.
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {galleryItems.map((item, idx) => (
                    <div key={item.id} className="border border-[#252A27]/10 rounded-xl p-3 space-y-2">
                      <div className="aspect-4/3 rounded-lg overflow-hidden">
                        <ClinicImage src={item.image_url} alt={item.title} />
                      </div>
                      <input
                        value={item.title}
                        onChange={(e) => {
                          const next = [...galleryItems];
                          next[idx] = { ...item, title: e.target.value };
                          setSettings({ ...settings, gallery_items: JSON.stringify(next) });
                        }}
                        className="w-full px-2.5 py-1 border rounded text-xs font-medium"
                      />
                      <label className="inline-flex items-center gap-1.5 text-xs text-[#365B4B] cursor-pointer">
                        <Upload className="w-3.5 h-3.5" />
                        <span>Replace Photo</span>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            try {
                              const url = await uploadImageFile(f);
                              const next = [...galleryItems];
                              next[idx] = { ...item, image_url: url };
                              setSettings({ ...settings, gallery_items: JSON.stringify(next) });
                              notify('ok', 'Gallery photo replaced. Click Save Website Changes.');
                            } catch (err) {
                              notify('err', err instanceof Error ? err.message : 'Upload failed');
                            }
                          }}
                        />
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </form>
          )}

          {/* ==================== SECURITY & AUDIT ==================== */}
          {tab === 'security' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-5 space-y-6">
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const r = await fetch('/api/admin/change-password', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ current_password: curPwd, new_password: newPwd }),
                    });
                    const d = await r.json();
                    if (!r.ok) notify('err', d.error || 'Failed to change password');
                    else {
                      notify('ok', 'Password updated.');
                      setCurPwd('');
                      setNewPwd('');
                    }
                  }}
                  className="bg-white rounded-xl border border-[#252A27]/10 p-6 space-y-3"
                >
                  <h3 className="font-display text-xl font-semibold text-[#234536] flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-[#365B4B]" />
                    Change My Password
                  </h3>
                  <input
                    type="password"
                    required
                    placeholder="Current password"
                    value={curPwd}
                    onChange={(e) => setCurPwd(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border text-sm"
                  />
                  <input
                    type="password"
                    required
                    minLength={8}
                    placeholder="New password (min 8 chars)"
                    value={newPwd}
                    onChange={(e) => setNewPwd(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border text-sm"
                  />
                  <button type="submit" className="px-4 py-2 rounded-lg bg-[#365B4B] text-white text-xs font-medium">
                    Update Password
                  </button>
                </form>

                {admin.role === 'super_admin' && (
                  <div className="bg-white rounded-xl border border-[#252A27]/10 p-6 space-y-4">
                    <h3 className="font-display text-xl font-semibold text-[#234536]">
                      Team Access (RBAC)
                    </h3>
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const r = await fetch('/api/admin/users', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            email: newUserEmail,
                            name: newUserName,
                            role: newUserRole,
                            password: newUserPassword,
                          }),
                        });
                        const d = await r.json();
                        if (!r.ok) notify('err', d.error || 'Failed to add user');
                        else {
                          notify('ok', 'Team account created.');
                          setNewUserEmail('');
                          setNewUserName('');
                          setNewUserPassword('');
                          loadAllAdminData();
                        }
                      }}
                      className="space-y-2 bg-[#FAF8F2] p-3.5 rounded-lg border border-[#252A27]/10"
                    >
                      <input
                        type="text"
                        required
                        placeholder="Staff Name"
                        value={newUserName}
                        onChange={(e) => setNewUserName(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded border text-xs bg-white"
                      />
                      <input
                        type="email"
                        required
                        placeholder="Email"
                        value={newUserEmail}
                        onChange={(e) => setNewUserEmail(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded border text-xs bg-white"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={newUserRole}
                          onChange={(e) => setNewUserRole(e.target.value as AdminUser['role'])}
                          className="px-2.5 py-1.5 rounded border text-xs bg-white"
                        >
                          <option value="reception">Reception</option>
                          <option value="manager">Manager</option>
                          <option value="super_admin">Super Admin</option>
                        </select>
                        <input
                          type="password"
                          required
                          minLength={8}
                          placeholder="Password (8+ chars)"
                          value={newUserPassword}
                          onChange={(e) => setNewUserPassword(e.target.value)}
                          className="px-2.5 py-1.5 rounded border text-xs bg-white"
                        />
                      </div>
                      <button type="submit" className="w-full py-1.5 rounded bg-[#365B4B] text-white text-xs font-medium">
                        Add Staff Account
                      </button>
                    </form>

                    <div className="space-y-2 text-xs">
                      {adminUsers.map((u) => (
                        <div key={u.id} className="flex items-center justify-between py-2 border-b border-[#252A27]/8">
                          <div>
                            <p className="font-medium">{u.name}</p>
                            <p className="text-[#252A27]/60">{u.email}</p>
                          </div>
                          <span className="capitalize font-medium text-[#365B4B]">
                            {u.role.replace('_', ' ')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="lg:col-span-7 bg-white rounded-xl border border-[#252A27]/10 p-6 space-y-4">
                <h3 className="font-display text-xl font-semibold text-[#234536]">
                  Full Audit Trail
                </h3>
                <div className="space-y-2 max-h-[540px] overflow-y-auto text-xs">
                  {auditLogs.map((log) => (
                    <div
                      key={log.id}
                      className="flex items-start justify-between gap-4 py-2.5 border-b border-[#252A27]/8"
                    >
                      <div>
                        <p className="font-semibold text-[#234536]">{log.action}</p>
                        <p className="text-[#252A27]/75">
                          {log.entity_type} #{log.entity_id} {log.details ? `· ${log.details}` : ''}
                        </p>
                        <p className="text-[#252A27]/50">{log.admin_email}</p>
                      </div>
                      <span className="font-mono text-[#252A27]/55 shrink-0 tabular-nums">
                        {log.created_at}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
