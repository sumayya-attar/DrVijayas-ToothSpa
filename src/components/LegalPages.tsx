import { X } from 'lucide-react';
import type { WebsiteSettings } from '../types/clinic';

export type LegalTopic = 'privacy' | 'terms' | 'cancellation' | 'consent';

interface LegalModalProps {
  topic: LegalTopic | null;
  onClose: () => void;
  settings: WebsiteSettings;
}

export function LegalModal({ topic, onClose, settings }: LegalModalProps) {
  if (!topic) return null;

  const titles: Record<LegalTopic, string> = {
    privacy: 'Privacy Policy',
    terms: 'Terms of Service',
    cancellation: 'Appointment & Cancellation Policy',
    consent: 'Patient Booking Consent Information',
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#252A27]/60 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-modal-title"
    >
      <div className="bg-[#FAF8F2] border border-[#252A27]/15 rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#252A27]/10">
          <h2 id="legal-modal-title" className="font-display text-2xl font-semibold text-[#234536]">
            {titles[topic]}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close policy dialog"
            className="p-2 rounded-lg text-[#252A27]/70 hover:text-[#252A27] hover:bg-[#EEE9DF] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-4 text-sm text-[#252A27]/85 leading-relaxed">
          {topic === 'privacy' && (
            <>
              <p>
                <strong>DrVijayas ToothSpa</strong> ({settings.address}) respects your privacy and collects only the minimal contact information necessary to schedule and manage your dental appointment.
              </p>
              <p>
                <strong>Information We Collect:</strong> When requesting an appointment online, we collect your full name, mobile number, optional email address, preferred treatment, appointment date/time, and optional brief booking notes. We do not collect sensitive diagnostic records or unnecessary medical history through the public booking form.
              </p>
              <p>
                <strong>How We Use Your Information:</strong> Your details are used solely to reserve your requested time slot, coordinate clinic confirmation, send optional appointment reminders, and respond to rescheduling or cancellation requests. Patient records are never sold or exposed publicly.
              </p>
              <p>
                <strong>Map Services:</strong> Our clinic location map integrates Google Maps Platform features and is subject to the{' '}
                <a
                  href="https://maps.google.com/help/terms_maps/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#365B4B] underline"
                >
                  Google Maps / Google Earth Additional Terms of Service
                </a>{' '}
                and{' '}
                <a
                  href="https://policies.google.com/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#365B4B] underline"
                >
                  Google Privacy Policy
                </a>
                .
              </p>
            </>
          )}

          {topic === 'terms' && (
            <>
              <p>
                By using the <strong>DrVijayas ToothSpa</strong> website and online appointment scheduling portal, you agree to the following terms:
              </p>
              <ul className="list-disc pl-5 space-y-2">
                <li>
                  <strong>Subject to Clinic Confirmation:</strong> Submitting an online booking reserves your requested slot in our schedule as <em>Pending</em> and remains subject to clinic confirmation based on clinical availability.
                </li>
                <li>
                  <strong>No Automated Medical Diagnosis:</strong> Content on this website is provided for general informational and scheduling purposes only and does not constitute medical advice, automated diagnosis, or a guarantee of specific treatment outcomes.
                </li>
                <li>
                  <strong>Treatment Planning:</strong> All clinical treatment recommendations and fees are discussed transparently with the patient in person following an examination at the clinic.
                </li>
                <li>
                  <strong>Contact:</strong> For questions regarding these terms, call {settings.phone} or visit us at {settings.address}.
                </li>
              </ul>
            </>
          )}

          {topic === 'cancellation' && (
            <>
              <p>
                We reserve dedicated clinical suite time for each patient at <strong>DrVijayas ToothSpa</strong>.
              </p>
              <ul className="list-disc pl-5 space-y-2">
                <li>
                  <strong>Rescheduling or Cancelling Online:</strong> You can manage, reschedule, or cancel an upcoming appointment at any time prior to your visit using your Booking Reference number and registered mobile number via the <em>Manage Booking</em> portal.
                </li>
                <li>
                  <strong>Advance Notice:</strong> We kindly request at least 2 hours&apos; notice if you need to reschedule or cancel so another patient may use the time slot.
                </li>
                <li>
                  <strong>Mall Arrival Tip:</strong> Please arrive 10 minutes before your scheduled time to allow for Mantri Square Mall parking and reception check-in (1st Floor, opposite Bata Showroom).
                </li>
              </ul>
            </>
          )}

          {topic === 'consent' && (
            <>
              <p>
                Before completing your appointment request at <strong>DrVijayas ToothSpa</strong>, you confirm that:
              </p>
              <ul className="list-disc pl-5 space-y-2">
                <li>The name and mobile number provided are accurate so our clinic desk can confirm or coordinate your visit.</li>
                <li>You understand online appointment requests are subject to clinic confirmation.</li>
                <li>You consent to DrVijayas ToothSpa contacting you by phone, email (if provided), or WhatsApp regarding your scheduled appointment.</li>
                <li>Clinical examinations, treatment plans, and applicable fees are finalized after an in-person dental consultation at the clinic.</li>
              </ul>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[#252A27]/10 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-lg bg-[#365B4B] text-white text-sm font-medium hover:bg-[#234536] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
