export interface Treatment {
  id: number;
  slug: string;
  name: string;
  short_description: string;
  full_description: string;
  duration_minutes: number;
  buffer_minutes: number;
  image_url: string | null;
  price_display: string | null;
  is_active: number;
  is_featured: number;
  sort_order: number;
  assigned_dentist_ids?: number[];
}

export interface DentistSchedule {
  id?: number;
  dentist_id?: number;
  day_of_week: number;
  is_working: number | boolean;
  start_time: string;
  end_time: string;
}

export interface Dentist {
  id: number;
  name: string;
  title: string;
  qualifications: string;
  bio: string;
  photo_url: string | null;
  is_active: number;
  sort_order: number;
  treatment_ids: number[];
  schedules: DentistSchedule[];
}

export interface ClinicHour {
  day_of_week: number;
  day_name: string;
  is_open: number;
  open_time: string;
  close_time: string;
  slot_interval_minutes: number;
  booking_buffer_minutes: number;
}

export interface BlockedDate {
  id: number;
  date: string;
  dentist_id: number | null;
  dentist_name?: string | null;
  reason: string;
}

export interface Testimonial {
  id: number;
  patient_name: string;
  review_text: string;
  review_date: string;
  source: string;
  rating: number | null;
  is_published?: number;
}

export interface GalleryItem {
  id: string;
  title: string;
  category: string;
  caption: string;
  image_url: string;
}

export interface WebsiteSettings {
  announcement_text: string;
  promotional_banner: string;
  hero_headline: string;
  hero_subtext: string;
  hero_image: string;
  about_title: string;
  about_body: string;
  about_image: string;
  phone: string;
  whatsapp_number: string;
  address: string;
  landmark: string;
  opening_hours_text: string;
  google_maps_directions_url: string;
  google_maps_reviews_url: string;
  social_instagram: string;
  social_facebook: string;
  gallery_items: string;
  [key: string]: string;
}

export interface GooglePlaceReview {
  authorName: string;
  rating: number | null;
  relativePublishTimeDescription: string;
  text: string;
}

export interface GooglePlaceInfo {
  configured: boolean;
  place: {
    id: string;
    name: string;
    formattedAddress: string;
    location: { lat: number; lng: number } | null;
    rating: number | null;
    userRatingCount: number | null;
    googleMapsUri: string | null;
    directionsUri: string | null;
    reviewsUri: string | null;
    reviews: GooglePlaceReview[];
  } | null;
  mallLocation: {
    lat: number;
    lng: number;
    googleMapsUri: string | null;
    directionsUri: string | null;
  } | null;
}

export interface AvailableSlot {
  start_time: string;
  end_time: string;
  label: string;
  available_dentist_ids: number[];
}

export interface Appointment {
  id: number;
  booking_ref: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  status: 'Pending' | 'Confirmed' | 'Completed' | 'Cancelled' | 'No-show';
  notes: string;
  created_at: string;
  updated_at?: string;
  requested_dentist_id: number | null;
  assigned_dentist_id: number;
  treatment_id: number;
  patient_name: string;
  patient_phone: string;
  patient_email: string | null;
  treatment_name: string;
  dentist_name: string;
  source_db?: 'sqlite' | 'sqlite+supabase' | 'supabase';
  supabase_synced?: boolean;
}

export interface AdminUser {
  id: number;
  email: string;
  name: string;
  role: 'super_admin' | 'manager' | 'reception';
  is_active?: number;
  created_at?: string;
}
