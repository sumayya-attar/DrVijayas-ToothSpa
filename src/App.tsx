import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ArrowRight,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  MapPin,
  Menu,
  MessageCircle,
  Phone,
  ShieldCheck,
  Sparkles,
  Star,
  X,
} from 'lucide-react';
import type {
  BlockedDate,
  ClinicHour,
  Dentist,
  GalleryItem,
  GooglePlaceInfo,
  Testimonial,
  Treatment,
  WebsiteSettings,
} from './types/clinic';
import { buildTelHref, buildWhatsAppUrl } from './lib/format';
import { ClinicImage } from './components/ClinicImage';
import { ClinicLocationMap } from './components/ClinicLocationMap';
import { BookingWizard } from './components/BookingWizard';
import { ManageBookingModal } from './components/ManageBookingModal';
import { LegalModal, type LegalTopic } from './components/LegalPages';
import { AdminDashboard } from './components/AdminDashboard';

const DEFAULT_SETTINGS: WebsiteSettings = {
  announcement_text: 'Your Smile Deserves a Little More Care.',
  promotional_banner: '',
  hero_headline: 'Your Smile Deserves a Little More Care.',
  hero_subtext:
    'Experience comfortable, modern dental care with a gentle approach, personalized attention and a focus on your oral health.',
  hero_image: '/src/assets/images/hero_dental_spa_1795284232745.jpg',
  about_title: 'Calm, Attentive Dental Wellness in the Heart of Seshadripuram',
  about_body:
    'Located on the 1st Floor of Mantri Square Mall opposite Bata Showroom, DrVijayas ToothSpa brings together a soothing boutique atmosphere and attentive clinical care.',
  about_image: '/src/assets/images/clinic_reception_1795284233749.jpg',
  phone: '+91 83101 90730',
  whatsapp_number: '+91 83101 90730',
  address:
    '1st Floor, Mantri Square Mall, opposite Bata Showroom, Seshadripuram, Bengaluru, Karnataka 560003, India',
  landmark: 'Opposite Bata Showroom, 1st Floor, Mantri Square Mall',
  opening_hours_text: 'Monday to Sunday: 10:30 AM – 9:30 PM',
  google_maps_directions_url:
    'https://www.google.com/maps/search/?api=1&query=DrVijayas+ToothSpa+Mantri+Square+Mall+Seshadripuram+Bengaluru+560003',
  google_maps_reviews_url:
    'https://www.google.com/maps/search/?api=1&query=DrVijayas+ToothSpa+Mantri+Square+Mall+Seshadripuram+Bengaluru',
  social_instagram: '',
  social_facebook: '',
  gallery_items: '[]',
};

export default function App() {
  const [route, setRoute] = useState<'public' | 'admin'>(() =>
    window.location.pathname.startsWith('/admin') ? 'admin' : 'public'
  );
  const [quotaExceeded, setQuotaExceeded] = useState(false);

  const [settings, setSettings] = useState<WebsiteSettings>(DEFAULT_SETTINGS);
  const [treatments, setTreatments] = useState<Treatment[]>([]);
  const [dentists, setDentists] = useState<Dentist[]>([]);
  const [clinicHours, setClinicHours] = useState<ClinicHour[]>([]);
  const [blockedDates, setBlockedDates] = useState<BlockedDate[]>([]);
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
  const [googlePlace, setGooglePlace] = useState<GooglePlaceInfo | null>(null);
  const [mapsApiKey, setMapsApiKey] = useState<string>(
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
  );

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [preselectedTreatmentId, setPreselectedTreatmentId] = useState<number | null>(null);
  const [detailTreatment, setDetailTreatment] = useState<Treatment | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [manageBookingOpen, setManageBookingOpen] = useState(false);
  const [managePrefillRef, setManagePrefillRef] = useState<string | undefined>(undefined);
  const [legalTopic, setLegalTopic] = useState<LegalTopic | null>(null);
  const [reviewSlide, setReviewSlide] = useState(0);

  // Listen for Google Maps Platform Tier 1/2 quota events
  useEffect(() => {
    const onQuotaExceeded = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuotaExceeded);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuotaExceeded);
  }, []);

  // Sync browser back/forward navigation
  useEffect(() => {
    const onPopState = () => {
      setRoute(window.location.pathname.startsWith('/admin') ? 'admin' : 'public');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigateTo = (target: 'public' | 'admin', hash?: string) => {
    setRoute(target);
    const nextPath = target === 'admin' ? '/admin' : `/${hash ? `#${hash}` : ''}`;
    window.history.pushState({}, '', nextPath);
    if (target === 'public' && hash) {
      setTimeout(() => {
        document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth' });
      }, 60);
    } else if (target === 'admin') {
      window.scrollTo({ top: 0 });
    }
  };

  const loadPublicData = useCallback(async () => {
    try {
      const [bootRes, mapsConfigRes, placeRes] = await Promise.all([
        fetch('/api/public/bootstrap'),
        fetch('/api/public/maps-config'),
        fetch('/api/clinic/google-place'),
      ]);

      if (bootRes.ok) {
        const b = await bootRes.json();
        if (b.settings) setSettings({ ...DEFAULT_SETTINGS, ...b.settings });
        setTreatments(b.treatments || []);
        setDentists(b.dentists || []);
        setClinicHours(b.clinicHours || []);
        setBlockedDates(b.blockedDates || []);
        setTestimonials(b.testimonials || []);
      }

      if (mapsConfigRes.ok) {
        const mc = await mapsConfigRes.json();
        if (mc.apiKey && !mapsApiKey) {
          setMapsApiKey(mc.apiKey);
        }
      }

      if (placeRes.status === 429) {
        setQuotaExceeded(true);
      } else if (placeRes.ok) {
        const gp = await placeRes.json();
        if (gp.quotaExceeded) setQuotaExceeded(true);
        else setGooglePlace(gp);
      }
    } catch {
      // Keep UI functional even if a background fetch hiccups
    }
  }, [mapsApiKey]);

  useEffect(() => {
    loadPublicData();
  }, [loadPublicData]);

  // Handle /manage-booking or /book direct URL paths cleanly
  useEffect(() => {
    const p = window.location.pathname;
    if (p === '/manage-booking') {
      setManageBookingOpen(true);
    } else if (p === '/book') {
      setTimeout(() => document.getElementById('book')?.scrollIntoView({ behavior: 'smooth' }), 150);
    } else if (p === '/privacy-policy') {
      setLegalTopic('privacy');
    } else if (p === '/terms') {
      setLegalTopic('terms');
    }
  }, []);

  const galleryItems: GalleryItem[] = useMemo(() => {
    try {
      const parsed = JSON.parse(settings.gallery_items || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [settings.gallery_items]);

  // Combine authentic admin-published reviews + live Google Places reviews (if any)
  const combinedReviews = useMemo(() => {
    const local = testimonials.map((t) => ({
      id: `local-${t.id}`,
      author: t.patient_name,
      text: t.review_text,
      date: t.review_date,
      source: t.source,
      rating: t.rating,
    }));
    const google = (googlePlace?.place?.reviews || [])
      .filter((r) => r.text && r.text.trim().length > 0)
      .map((r, idx) => ({
        id: `google-${idx}`,
        author: r.authorName,
        text: r.text,
        date: r.relativePublishTimeDescription,
        source: 'Google Maps Review',
        rating: r.rating,
      }));
    return [...local, ...google];
  }, [testimonials, googlePlace]);

  const scrollToBook = (treatmentId?: number) => {
    if (treatmentId) {
      setPreselectedTreatmentId(treatmentId);
    }
    setMobileMenuOpen(false);
    document.getElementById('book')?.scrollIntoView({ behavior: 'smooth' });
  };

  const quotaBanner = quotaExceeded && (
    <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
      <span>
        Google Maps Platform quota reached. If you are the app owner, visit{' '}
        <a
          href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
          target="_blank"
          rel="noopener noreferrer"
          className="underline font-semibold text-amber-950 hover:text-amber-800"
        >
          maps developer site
        </a>{' '}
        for instructions to update your account.
      </span>
    </div>
  );

  if (route === 'admin') {
    return (
      <>
        {quotaBanner}
        <AdminDashboard
          onExitToSite={() => navigateTo('public')}
          onPublicDataChanged={loadPublicData}
        />
      </>
    );
  }

  const googleReviewsUrl =
    googlePlace?.place?.reviewsUri ||
    googlePlace?.place?.googleMapsUri ||
    settings.google_maps_reviews_url;

  return (
    <div className="min-h-screen bg-[#FAF8F2] text-[#252A27] flex flex-col">
      {quotaBanner}

      {/* Slim Announcement Bar (hidden on tiny viewports to respect mobile sticky height cap) */}
      <div className="hidden sm:block bg-[#234536] text-[#FAF8F2] text-xs py-2 px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <p className="font-medium tracking-wide">{settings.announcement_text}</p>
          <div className="flex items-center gap-5 shrink-0">
            <a
              href={buildTelHref(settings.phone)}
              className="inline-flex items-center gap-1.5 hover:text-[#C6A66B] transition-colors tabular-nums"
            >
              <Phone className="w-3.5 h-3.5" />
              <span>{settings.phone}</span>
            </a>
            <button
              type="button"
              onClick={() => scrollToBook()}
              className="font-semibold text-[#C6A66B] hover:underline whitespace-nowrap"
            >
              Book Appointment
            </button>
            <button
              type="button"
              onClick={() => navigateTo('admin')}
              className="inline-flex items-center gap-1 text-[#FAF8F2]/80 hover:text-white transition-colors whitespace-nowrap"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Admin Panel</span>
            </button>
          </div>
        </div>
      </div>

      {/* Optional Admin Promotional Banner */}
      {settings.promotional_banner && (
        <div className="bg-[#EEE9DF] border-b border-[#252A27]/10 text-center py-2 px-4 text-xs font-medium text-[#234536]">
          {settings.promotional_banner}
        </div>
      )}

      {/* Sticky Top Bar (Exact 3-Zone Contract) */}
      <header className="sticky top-0 z-40 bg-[#FAF8F2]/95 backdrop-blur-md border-b border-[#252A27]/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single-line Brand Wordmark */}
          <a
            href="#home"
            className="font-display text-2xl font-semibold tracking-tight text-[#234536] whitespace-nowrap shrink-0"
          >
            DrVijayas ToothSpa
          </a>

          {/* Zone 2: Concise Single-Line Text Nav Links */}
          <nav className="hidden lg:flex items-center gap-7 text-sm font-medium text-[#252A27]/80">
            {[
              { label: 'Home', href: '#home' },
              { label: 'About Us', href: '#about' },
              { label: 'Treatments', href: '#treatments' },
              { label: 'Our Clinic', href: '#clinic' },
              { label: 'Reviews', href: '#reviews' },
              { label: 'Contact', href: '#contact' },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="hover:text-[#365B4B] transition-colors whitespace-nowrap shrink-0"
              >
                {link.label}
              </a>
            ))}
          </nav>

          {/* Zone 3: 1 Primary CTA + Mobile Hamburger */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => scrollToBook()}
              className="hidden sm:inline-flex items-center justify-center px-5 py-2.5 rounded-lg bg-[#365B4B] text-white text-xs font-semibold tracking-wide uppercase hover:bg-[#234536] transition-colors whitespace-nowrap shrink-0"
            >
              Book Appointment
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Toggle navigation menu"
              className="lg:hidden p-2 rounded-lg text-[#234536] hover:bg-[#EEE9DF]"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-[#252A27]/10 bg-[#FAF8F2] px-6 py-4 space-y-3">
            <nav className="flex flex-col gap-2 text-sm font-medium">
              {[
                { label: 'Home', href: '#home' },
                { label: 'About Us', href: '#about' },
                { label: 'Treatments', href: '#treatments' },
                { label: 'Our Clinic', href: '#clinic' },
                { label: 'Reviews', href: '#reviews' },
                { label: 'Contact', href: '#contact' },
              ].map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="py-2 border-b border-[#252A27]/8 text-[#252A27]"
                >
                  {link.label}
                </a>
              ))}
            </nav>
            <div className="pt-2 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => scrollToBook()}
                className="w-full py-2.5 rounded-lg bg-[#365B4B] text-white text-sm font-medium"
              >
                Book Appointment
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  setManageBookingOpen(true);
                }}
                className="w-full py-2.5 rounded-lg border border-[#252A27]/15 text-sm font-medium"
              >
                Manage Existing Booking
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  navigateTo('admin');
                }}
                className="w-full py-2 rounded-lg text-xs font-medium text-[#365B4B] inline-flex items-center justify-center gap-1.5"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Clinic Admin Panel
              </button>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">
        {/* HERO SECTION */}
        <section id="home" className="max-w-7xl mx-auto px-4 sm:px-6 pt-10 pb-12 md:pt-14 md:pb-16">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-center py-2 md:py-6">
              <p className="text-xs font-medium tracking-wider uppercase text-[#C6A66B]">
                Mantri Square Mall · Seshadripuram, Bengaluru
              </p>
              <h1 className="font-display text-[clamp(2.4rem,4.5vw,3.9rem)] leading-[1.08] font-semibold text-[#234536] mt-3 text-balance">
                {settings.hero_headline}
              </h1>
              <p className="text-base md:text-lg text-[#252A27]/80 mt-5 leading-relaxed max-w-xl">
                {settings.hero_subtext}
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => scrollToBook()}
                  className="inline-flex items-center gap-2 px-6 py-3.5 rounded-lg bg-[#365B4B] text-white text-sm font-medium hover:bg-[#234536] transition-colors whitespace-nowrap"
                >
                  Book Your Appointment
                  <ArrowRight className="w-4 h-4" />
                </button>
                <a
                  href="#treatments"
                  className="inline-flex items-center gap-2 px-6 py-3.5 rounded-lg border border-[#252A27]/20 text-[#252A27] text-sm font-medium hover:bg-[#EEE9DF]/70 transition-colors whitespace-nowrap"
                >
                  Explore Treatments
                </a>
              </div>

              <div className="mt-8 pt-6 border-t border-[#252A27]/10 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[#252A27]/75">
                <span>Patient-focused care</span>
                <span aria-hidden="true">·</span>
                <span>Modern dental technology</span>
                <span aria-hidden="true">·</span>
                <span>1st Floor, Mantri Square Mall</span>
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="rounded-2xl overflow-hidden border border-[#252A27]/10 aspect-16/11 lg:aspect-auto lg:h-full lg:min-h-[460px] bg-[#EEE9DF]">
                <ClinicImage
                  src={settings.hero_image}
                  alt="DrVijayas ToothSpa modern dental wellness suite"
                  priority
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          </div>

          {/* Full-width Trust & Clinic Readiness Bar */}
          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-[#252A27]/10 p-5">
              <p className="text-xs text-[#252A27]/60">Opening Hours</p>
              <p className="font-display text-xl font-semibold text-[#234536] mt-1">
                10:30 AM – 9:30 PM
              </p>
              <p className="text-xs text-[#252A27]/70 mt-1">Open Monday to Sunday</p>
            </div>

            <div className="bg-white rounded-xl border border-[#252A27]/10 p-5">
              <p className="text-xs text-[#252A27]/60">Convenient Mall Location</p>
              <p className="font-display text-xl font-semibold text-[#234536] mt-1">
                Mantri Square Mall
              </p>
              <p className="text-xs text-[#252A27]/70 mt-1">1st Floor, opposite Bata Showroom</p>
            </div>

            <div className="bg-white rounded-xl border border-[#252A27]/10 p-5">
              <p className="text-xs text-[#252A27]/60">
                {googlePlace?.place?.rating ? 'Verified Google Rating' : 'Direct Clinic Desk'}
              </p>
              {googlePlace?.place?.rating ? (
                <>
                  <p className="font-display text-xl font-semibold text-[#234536] mt-1 flex items-center gap-1.5 tabular-nums">
                    <span>{googlePlace.place.rating.toFixed(1)}</span>
                    <Star className="w-4 h-4 fill-[#C6A66B] text-[#C6A66B]" />
                  </p>
                  <p className="text-xs text-[#252A27]/70 mt-1 tabular-nums">
                    {googlePlace.place.userRatingCount
                      ? `Based on ${googlePlace.place.userRatingCount} Google reviews`
                      : 'Listed on Google Maps'}
                  </p>
                </>
              ) : (
                <>
                  <a
                    href={buildTelHref(settings.phone)}
                    className="font-display text-xl font-semibold text-[#234536] mt-1 block hover:underline tabular-nums"
                  >
                    {settings.phone}
                  </a>
                  <p className="text-xs text-[#252A27]/70 mt-1">Call or WhatsApp for assistance</p>
                </>
              )}
            </div>

            <div className="bg-white rounded-xl border border-[#252A27]/10 p-5 flex flex-col justify-between">
              <div>
                <p className="text-xs text-[#252A27]/60">Already Scheduled?</p>
                <p className="font-display text-xl font-semibold text-[#234536] mt-1">
                  Manage Your Visit
                </p>
              </div>
              <button
                type="button"
                onClick={() => setManageBookingOpen(true)}
                className="text-left text-xs font-semibold text-[#365B4B] hover:underline mt-2 inline-flex items-center gap-1"
              >
                Reschedule or check booking status
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </section>

        {/* ABOUT & WHY CHOOSE US */}
        <section id="about" className="bg-[#EEE9DF]/55 border-y border-[#252A27]/8 py-16 md:py-24">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 space-y-14">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
              <div className="lg:col-span-5">
                <div className="rounded-2xl overflow-hidden border border-[#252A27]/10 aspect-4/3 bg-white">
                  <ClinicImage
                    src={settings.about_image}
                    alt="DrVijayas ToothSpa reception lounge"
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
              <div className="lg:col-span-7 space-y-5">
                <p className="text-xs font-medium tracking-wider uppercase text-[#C6A66B]">
                  About DrVijayas ToothSpa
                </p>
                <h2 className="font-display text-3xl md:text-4xl font-semibold text-[#234536] text-balance">
                  {settings.about_title}
                </h2>
                <p className="text-base text-[#252A27]/80 leading-relaxed">{settings.about_body}</p>
                <div className="pt-2 flex flex-wrap gap-6 text-sm text-[#234536] font-medium">
                  <span>Comfortable Mall Setting</span>
                  <span aria-hidden="true">·</span>
                  <span>Transparent Planning</span>
                  <span aria-hidden="true">·</span>
                  <span>Gentle Clinical Approach</span>
                </div>
              </div>
            </div>

            {/* Why Choose Us Grid */}
            <div>
              <div className="max-w-2xl mb-8">
                <p className="text-xs font-medium tracking-wider uppercase text-[#C6A66B]">
                  Why Choose Us
                </p>
                <h3 className="font-display text-3xl font-semibold text-[#234536] mt-1">
                  Thoughtful Care Built Around Patient Comfort
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {[
                  {
                    num: '01',
                    title: 'Gentle, Patient-Friendly Approach',
                    desc: 'Unhurried consultations where your comfort and pace come first at every step of your visit.',
                  },
                  {
                    num: '02',
                    title: 'Clean & Hygienic Environment',
                    desc: 'Strict clinical sterilization protocols and spotless treatment suites prepared for every patient.',
                  },
                  {
                    num: '03',
                    title: 'Modern Dental Equipment',
                    desc: 'Contemporary clinical tools supporting accurate visual consultations and attentive care.',
                  },
                  {
                    num: '04',
                    title: 'Convenient Mantri Square Mall Location',
                    desc: 'Easy access on the 1st Floor opposite Bata Showroom in Seshadripuram, near Malleshwaram.',
                  },
                  {
                    num: '05',
                    title: 'Clear, Transparent Communication',
                    desc: 'Every recommended option and treatment plan is explained plainly before you decide.',
                  },
                  {
                    num: '06',
                    title: 'Personalized Dental Care',
                    desc: 'Preventive and restorative guidance tailored to your daily routine and oral health goals.',
                  },
                ].map((item) => (
                  <div
                    key={item.num}
                    className="bg-white rounded-xl border border-[#252A27]/10 p-6 space-y-2"
                  >
                    <span className="font-mono text-xs text-[#C6A66B] font-medium">{item.num}.</span>
                    <h4 className="font-display text-xl font-semibold text-[#234536]">
                      {item.title}
                    </h4>
                    <p className="text-sm text-[#252A27]/75 leading-relaxed">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* TREATMENTS SECTION */}
        <section id="treatments" className="max-w-7xl mx-auto px-4 sm:px-6 py-16 md:py-24">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-10">
            <div className="max-w-2xl">
              <p className="text-xs font-medium tracking-wider uppercase text-[#C6A66B]">
                Dental Services
              </p>
              <h2 className="font-display text-3xl md:text-4xl font-semibold text-[#234536] mt-1">
                Attentive Care for Everyday Oral Health
              </h2>
              <p className="text-sm md:text-base text-[#252A27]/75 mt-2">
                Select any service below to learn what to expect or reserve a convenient time slot.
              </p>
            </div>
            <button
              type="button"
              onClick={() => scrollToBook()}
              className="inline-flex items-center gap-2 text-sm font-semibold text-[#365B4B] hover:underline whitespace-nowrap"
            >
              Book General Consultation
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {treatments.map((t) => (
              <article
                key={t.id}
                className="bg-white rounded-2xl border border-[#252A27]/10 overflow-hidden flex flex-col justify-between transition-transform duration-200 hover:-translate-y-0.5"
              >
                <div>
                  <div className="aspect-4/3 overflow-hidden bg-[#EEE9DF]">
                    <ClinicImage
                      src={t.image_url}
                      alt={t.name}
                      fallbackTitle={t.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="p-6">
                    <div className="flex items-center gap-2 text-xs text-[#252A27]/60 tabular-nums mb-2">
                      <span>{t.duration_minutes} min appointment</span>
                      {t.price_display && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-medium text-[#365B4B]">{t.price_display}</span>
                        </>
                      )}
                    </div>
                    <h3 className="font-display text-2xl font-semibold text-[#234536]">{t.name}</h3>
                    <p className="text-sm text-[#252A27]/75 mt-2 leading-relaxed">
                      {t.short_description}
                    </p>
                  </div>
                </div>

                <div className="px-6 pb-6 pt-3 border-t border-[#252A27]/8 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setDetailTreatment(t)}
                    className="text-xs font-semibold text-[#365B4B] hover:underline whitespace-nowrap"
                  >
                    Learn More
                  </button>
                  <button
                    type="button"
                    onClick={() => scrollToBook(t.id)}
                    className="px-4 py-2 rounded-lg bg-[#365B4B] text-white text-xs font-medium hover:bg-[#234536] transition-colors whitespace-nowrap"
                  >
                    Book Appointment
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* CLINIC GALLERY */}
        <section id="clinic" className="bg-[#EEE9DF]/55 border-y border-[#252A27]/8 py-16 md:py-24">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 space-y-8">
            <div className="max-w-2xl">
              <p className="text-xs font-medium tracking-wider uppercase text-[#C6A66B]">
                Our Clinic Environment
              </p>
              <h2 className="font-display text-3xl md:text-4xl font-semibold text-[#234536] mt-1">
                Designed to Feel Like a Calm Wellness Studio
              </h2>
              <p className="text-sm md:text-base text-[#252A27]/75 mt-2">
                Click any photograph to view closer details of our treatment suites, reception, and care standards.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {galleryItems.map((item, idx) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setLightboxIdx(idx)}
                  className={`group text-left bg-white rounded-2xl border border-[#252A27]/10 overflow-hidden transition-all hover:border-[#365B4B] ${
                    idx === 0 ? 'sm:col-span-2 lg:col-span-2' : ''
                  }`}
                >
                  <div
                    className={`overflow-hidden bg-[#EEE9DF] ${
                      idx === 0 ? 'aspect-16/9 lg:aspect-21/10' : 'aspect-4/3'
                    }`}
                  >
                    <ClinicImage
                      src={item.image_url}
                      alt={item.title}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                    />
                  </div>
                  <div className="p-5">
                    <p className="text-xs text-[#C6A66B] font-medium">{item.category}</p>
                    <h3 className="font-display text-xl font-semibold text-[#234536] mt-0.5">
                      {item.title}
                    </h3>
                    <p className="text-xs text-[#252A27]/70 mt-1 leading-relaxed">{item.caption}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* APPOINTMENT BOOKING SECTION */}
        <section id="book" className="max-w-7xl mx-auto px-4 sm:px-6 py-16 md:py-24">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
            <div className="max-w-2xl">
              <p className="text-xs font-medium tracking-wider uppercase text-[#C6A66B]">
                Online Scheduling
              </p>
              <h2 className="font-display text-3xl md:text-4xl font-semibold text-[#234536] mt-1">
                Book Your Appointment
              </h2>
              <p className="text-sm md:text-base text-[#252A27]/75 mt-2">
                Real-time availability from {settings.opening_hours_text}. Reserve your preferred time in a few simple steps.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setManageBookingOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[#252A27]/20 text-xs font-semibold text-[#234536] hover:bg-[#EEE9DF] whitespace-nowrap self-start"
            >
              <Calendar className="w-4 h-4 text-[#365B4B]" />
              Manage or Reschedule Booking
            </button>
          </div>

          <BookingWizard
            treatments={treatments}
            dentists={dentists}
            settings={settings}
            preselectedTreatmentId={preselectedTreatmentId}
            onOpenLegal={(topic) => setLegalTopic(topic)}
            onOpenManageBooking={(ref) => {
              setManagePrefillRef(ref);
              setManageBookingOpen(true);
            }}
          />
        </section>

        {/* TESTIMONIALS & GOOGLE REVIEWS */}
        <section id="reviews" className="bg-[#234536] text-[#FAF8F2] py-16 md:py-24">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
              <div>
                <p className="text-xs font-medium tracking-wider uppercase text-[#C6A66B]">
                  Patient Feedback
                </p>
                <h2 className="font-display text-3xl md:text-4xl font-semibold text-white mt-1">
                  Words from Patients Who Visited Us
                </h2>
                {googlePlace?.place?.rating && (
                  <p className="text-sm text-[#FAF8F2]/80 mt-2 flex items-center gap-2 tabular-nums">
                    <span>Google Rating: {googlePlace.place.rating.toFixed(1)} / 5</span>
                    <span aria-hidden="true">·</span>
                    <span>{googlePlace.place.userRatingCount || 0} Google Reviews</span>
                  </p>
                )}
              </div>

              <a
                href={googleReviewsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-white/25 text-white text-xs font-medium hover:bg-white/10 transition-colors whitespace-nowrap self-start"
              >
                Read Google Maps Reviews
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            {combinedReviews.length > 0 ? (
              <div className="bg-white/8 border border-white/15 rounded-2xl p-6 md:p-10">
                <div className="max-w-3xl">
                  <p className="font-display text-2xl md:text-3xl leading-snug text-white">
                    "{combinedReviews[reviewSlide % combinedReviews.length].text}"
                  </p>
                  <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
                    <div className="text-sm text-[#FAF8F2]/85">
                      <span className="font-semibold text-white">
                        {combinedReviews[reviewSlide % combinedReviews.length].author}
                      </span>
                      <span className="mx-2 text-white/40">·</span>
                      <span>{combinedReviews[reviewSlide % combinedReviews.length].source}</span>
                      {combinedReviews[reviewSlide % combinedReviews.length].date && (
                        <>
                          <span className="mx-2 text-white/40">·</span>
                          <span>{combinedReviews[reviewSlide % combinedReviews.length].date}</span>
                        </>
                      )}
                    </div>

                    {combinedReviews.length > 1 && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setReviewSlide(
                              (prev) => (prev - 1 + combinedReviews.length) % combinedReviews.length
                            )
                          }
                          aria-label="Previous review"
                          className="p-2 rounded-lg border border-white/20 hover:bg-white/10"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="text-xs font-mono tabular-nums px-2">
                          {(reviewSlide % combinedReviews.length) + 1} / {combinedReviews.length}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setReviewSlide((prev) => (prev + 1) % combinedReviews.length)
                          }
                          aria-label="Next review"
                          className="p-2 rounded-lg border border-white/20 hover:bg-white/10"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white/6 border border-white/15 rounded-2xl p-8 md:p-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="max-w-2xl space-y-2">
                  <h3 className="font-display text-2xl font-semibold text-white">
                    Verified Patient Reviews on Google Maps
                  </h3>
                  <p className="text-sm text-[#FAF8F2]/80 leading-relaxed">
                    We publish only authentic patient reviews with patient permission or verified Google Maps attribution. View our live Google Maps listing to read patient experiences or share your own feedback after your visit.
                  </p>
                </div>
                <a
                  href={googleReviewsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-[#C6A66B] text-[#234536] text-sm font-semibold hover:bg-[#d3b67f] transition-colors whitespace-nowrap shrink-0"
                >
                  Open Google Maps Reviews
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            )}
          </div>
        </section>

        {/* LOCATION & CONTACT */}
        <section id="contact" className="max-w-7xl mx-auto px-4 sm:px-6 py-16 md:py-24 space-y-8">
          <div className="max-w-2xl">
            <p className="text-xs font-medium tracking-wider uppercase text-[#C6A66B]">
              Location & Directions
            </p>
            <h2 className="font-display text-3xl md:text-4xl font-semibold text-[#234536] mt-1">
              Find Us in Seshadripuram, Bengaluru
            </h2>
            <p className="text-sm md:text-base text-[#252A27]/75 mt-2">
              Conveniently situated inside Mantri Square Mall near Malleshwaram, with easy mall parking and Metro access.
            </p>
          </div>

          <ClinicLocationMap
            mapsApiKey={mapsApiKey}
            googlePlace={googlePlace}
            settings={settings}
            quotaExceeded={quotaExceeded}
          />
        </section>

        {/* FINAL CTA */}
        <section className="bg-[#EEE9DF]/70 border-t border-[#252A27]/10 py-16 md:py-20">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center space-y-5">
            <h2 className="font-display text-3xl md:text-5xl font-semibold text-[#234536] text-balance">
              Ready to Give Your Smile the Care It Deserves?
            </h2>
            <p className="text-base text-[#252A27]/80 max-w-2xl mx-auto">
              Book your dental appointment today and take the next step towards better oral health.
            </p>
            <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => scrollToBook()}
                className="px-6 py-3.5 rounded-lg bg-[#365B4B] text-white text-sm font-medium hover:bg-[#234536] transition-colors"
              >
                Book Appointment
              </button>
              <a
                href={buildTelHref(settings.phone)}
                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-lg border border-[#252A27]/20 bg-white text-[#252A27] text-sm font-medium hover:bg-[#FAF8F2]"
              >
                <Phone className="w-4 h-4 text-[#365B4B]" />
                Call the Clinic
              </a>
              <a
                href={buildWhatsAppUrl(
                  settings.whatsapp_number,
                  'Hello DrVijayas ToothSpa, I would like to book a dental appointment. Please let me know the available slots.'
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-lg bg-[#234536] text-white text-sm font-medium hover:bg-[#365B4B]"
              >
                <MessageCircle className="w-4 h-4" />
                WhatsApp Us
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="bg-[#234536] text-[#FAF8F2]/85 pt-14 pb-20 md:pb-12 border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10 pb-10 border-b border-white/10 text-sm">
          <div className="space-y-3">
            <h3 className="font-display text-2xl font-semibold text-white">DrVijayas ToothSpa</h3>
            <p className="text-xs leading-relaxed text-[#FAF8F2]/75">{settings.address}</p>
            <p className="text-xs text-[#C6A66B] font-medium">{settings.opening_hours_text}</p>
            <a
              href={buildTelHref(settings.phone)}
              className="inline-block text-sm font-medium text-white hover:underline tabular-nums"
            >
              {settings.phone}
            </a>
          </div>

          <div className="space-y-2.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#C6A66B]">
              Quick Links
            </p>
            <ul className="space-y-2 text-xs">
              <li>
                <a href="#home" className="hover:text-white">Home</a>
              </li>
              <li>
                <a href="#about" className="hover:text-white">About Us</a>
              </li>
              <li>
                <a href="#treatments" className="hover:text-white">Treatments</a>
              </li>
              <li>
                <a href="#clinic" className="hover:text-white">Our Clinic</a>
              </li>
              <li>
                <a href="#book" className="hover:text-white">Book Appointment</a>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => setManageBookingOpen(true)}
                  className="hover:text-white"
                >
                  Manage Booking
                </button>
              </li>
            </ul>
          </div>

          <div className="space-y-2.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#C6A66B]">
              Treatments
            </p>
            <ul className="space-y-2 text-xs">
              {treatments.slice(0, 6).map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => scrollToBook(t.id)}
                    className="hover:text-white text-left"
                  >
                    {t.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-2.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#C6A66B]">
              Directions & Legal
            </p>
            <ul className="space-y-2 text-xs">
              <li>
                <a
                  href={settings.google_maps_directions_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white inline-flex items-center gap-1"
                >
                  Google Maps Directions
                  <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => setLegalTopic('privacy')}
                  className="hover:text-white"
                >
                  Privacy Policy
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => setLegalTopic('terms')}
                  className="hover:text-white"
                >
                  Terms & Conditions
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => setLegalTopic('cancellation')}
                  className="hover:text-white"
                >
                  Cancellation Policy
                </button>
              </li>
              {settings.social_instagram && (
                <li>
                  <a
                    href={settings.social_instagram}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-white"
                  >
                    Instagram
                  </a>
                </li>
              )}
              {settings.social_facebook && (
                <li>
                  <a
                    href={settings.social_facebook}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-white"
                  >
                    Facebook
                  </a>
                </li>
              )}
            </ul>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 flex flex-wrap items-center justify-between gap-4 text-xs text-[#FAF8F2]/60">
          <p>© {new Date().getFullYear()} DrVijayas ToothSpa · Seshadripuram, Bengaluru.</p>
          <div className="flex items-center gap-4">
            <span>Online appointments are subject to clinic confirmation.</span>
            <button
              type="button"
              onClick={() => navigateTo('admin')}
              className="hover:text-white inline-flex items-center gap-1"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Clinic Admin
            </button>
          </div>
        </div>
      </footer>

      {/* Desktop Floating WhatsApp Button */}
      <a
        href={buildWhatsAppUrl(
          settings.whatsapp_number,
          'Hello DrVijayas ToothSpa, I would like to book a dental appointment. Please let me know the available slots.'
        )}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chat on WhatsApp with DrVijayas ToothSpa"
        className="hidden md:inline-flex fixed bottom-6 right-6 z-40 items-center gap-2 px-4 py-3 rounded-full bg-[#234536] text-white text-xs font-semibold shadow-lg border border-[#C6A66B]/40 hover:bg-[#365B4B] transition-colors"
      >
        <MessageCircle className="w-4 h-4 text-[#C6A66B]" />
        <span>WhatsApp Clinic</span>
      </a>

      {/* Mobile Compact Bottom Bar (<= 15% sticky height cap) */}
      <div className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-[#FAF8F2]/95 backdrop-blur-md border-t border-[#252A27]/12 h-14 px-3 flex items-center gap-2">
        <a
          href={buildTelHref(settings.phone)}
          className="flex-1 h-10 rounded-lg border border-[#252A27]/20 flex items-center justify-center gap-1.5 text-xs font-medium text-[#234536]"
        >
          <Phone className="w-3.5 h-3.5" />
          Call
        </a>
        <a
          href={buildWhatsAppUrl(
            settings.whatsapp_number,
            'Hello DrVijayas ToothSpa, I would like to book a dental appointment. Please let me know the available slots.'
          )}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 h-10 rounded-lg bg-[#234536] text-white flex items-center justify-center gap-1.5 text-xs font-medium"
        >
          <MessageCircle className="w-3.5 h-3.5" />
          WhatsApp
        </a>
        <button
          type="button"
          onClick={() => scrollToBook()}
          className="flex-1 h-10 rounded-lg bg-[#365B4B] text-white flex items-center justify-center gap-1.5 text-xs font-semibold"
        >
          <Calendar className="w-3.5 h-3.5" />
          Book
        </button>
      </div>

      {/* Treatment Learn More Modal */}
      {detailTreatment && (
        <div
          className="fixed inset-0 z-50 bg-[#252A27]/60 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-[#FAF8F2] border border-[#252A27]/15 rounded-2xl max-w-lg w-full overflow-hidden shadow-xl">
            <div className="aspect-16/10 bg-[#EEE9DF] relative">
              <ClinicImage src={detailTreatment.image_url} alt={detailTreatment.name} />
              <button
                type="button"
                onClick={() => setDetailTreatment(null)}
                aria-label="Close treatment details"
                className="absolute top-3 right-3 p-2 rounded-full bg-white/90 text-[#252A27] hover:bg-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <p className="text-xs text-[#365B4B] font-medium tabular-nums">
                  {detailTreatment.duration_minutes} min session
                  {detailTreatment.price_display ? ` · ${detailTreatment.price_display}` : ''}
                </p>
                <h3 className="font-display text-3xl font-semibold text-[#234536] mt-1">
                  {detailTreatment.name}
                </h3>
              </div>
              <p className="text-sm text-[#252A27]/80 leading-relaxed">
                {detailTreatment.full_description}
              </p>
              <div className="pt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setDetailTreatment(null)}
                  className="px-4 py-2 rounded-lg border border-[#252A27]/15 text-xs font-medium"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const id = detailTreatment.id;
                    setDetailTreatment(null);
                    scrollToBook(id);
                  }}
                  className="px-5 py-2 rounded-lg bg-[#365B4B] text-white text-xs font-medium hover:bg-[#234536]"
                >
                  Book {detailTreatment.name}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Gallery Lightbox Modal */}
      {lightboxIdx !== null && galleryItems[lightboxIdx] && (
        <div
          className="fixed inset-0 z-50 bg-[#252A27]/90 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            onClick={() => setLightboxIdx(null)}
            aria-label="Close lightbox"
            className="absolute top-5 right-5 p-2 rounded-full bg-white/15 text-white hover:bg-white/25"
          >
            <X className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() =>
              setLightboxIdx((lightboxIdx - 1 + galleryItems.length) % galleryItems.length)
            }
            aria-label="Previous photo"
            className="p-2.5 rounded-full bg-white/15 text-white hover:bg-white/25 mr-3"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <div className="max-w-4xl w-full bg-[#FAF8F2] rounded-2xl overflow-hidden shadow-2xl">
            <div className="aspect-16/10 bg-black">
              <ClinicImage
                src={galleryItems[lightboxIdx].image_url}
                alt={galleryItems[lightboxIdx].title}
                className="w-full h-full object-contain bg-[#252A27]"
              />
            </div>
            <div className="p-5 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs text-[#C6A66B] font-medium">
                  {galleryItems[lightboxIdx].category}
                </p>
                <h4 className="font-display text-2xl font-semibold text-[#234536]">
                  {galleryItems[lightboxIdx].title}
                </h4>
                <p className="text-xs text-[#252A27]/75 mt-0.5">
                  {galleryItems[lightboxIdx].caption}
                </p>
              </div>
              <span className="text-xs font-mono text-[#252A27]/55 tabular-nums shrink-0">
                {lightboxIdx + 1} / {galleryItems.length}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setLightboxIdx((lightboxIdx + 1) % galleryItems.length)}
            aria-label="Next photo"
            className="p-2.5 rounded-full bg-white/15 text-white hover:bg-white/25 ml-3"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      )}

      <ManageBookingModal
        isOpen={manageBookingOpen}
        onClose={() => setManageBookingOpen(false)}
        prefillRef={managePrefillRef}
      />

      <LegalModal
        topic={legalTopic}
        onClose={() => setLegalTopic(null)}
        settings={settings}
      />
    </div>
  );
}
