import { useState, useCallback } from 'react';
import {
  APIProvider,
  Map as GoogleMapView,
  AdvancedMarker,
  Pin,
  InfoWindow,
  useAdvancedMarkerRef,
} from '@vis.gl/react-google-maps';
import { ExternalLink, MapPin, Navigation, Clock, Phone } from 'lucide-react';
import type { GooglePlaceInfo, WebsiteSettings } from '../types/clinic';
import { buildTelHref } from '../lib/format';

interface ClinicLocationMapProps {
  mapsApiKey: string;
  googlePlace: GooglePlaceInfo | null;
  settings: WebsiteSettings;
  quotaExceeded: boolean;
}

function ClinicMarkerWithInfo({
  position,
  name,
  address,
  directionsUrl,
}: {
  position: { lat: number; lng: number };
  name: string;
  address: string;
  directionsUrl: string;
}) {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const [infoOpen, setInfoOpen] = useState(true);
  const handleToggle = useCallback(() => setInfoOpen((prev) => !prev), []);

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={position}
        title={name}
        onClick={handleToggle}
      >
        <Pin background="#234536" borderColor="#C6A66B" glyphColor="#FAF8F2" scale={1.15} />
      </AdvancedMarker>
      {infoOpen && marker && (
        <InfoWindow anchor={marker} maxWidth={260} onCloseClick={() => setInfoOpen(false)}>
          <div className="p-1 text-[#252A27]">
            <p className="font-semibold text-sm text-[#234536]">{name}</p>
            <p className="text-xs text-[#252A27]/80 mt-1 leading-relaxed">{address}</p>
            <a
              href={directionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-[#365B4B] hover:underline"
            >
              Get Directions
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </InfoWindow>
      )}
    </>
  );
}

export function ClinicLocationMap({
  mapsApiKey,
  googlePlace,
  settings,
  quotaExceeded,
}: ClinicLocationMapProps) {
  const coordinates = googlePlace?.place?.location || googlePlace?.mallLocation || null;
  const directionsUrl =
    googlePlace?.place?.directionsUri ||
    googlePlace?.mallLocation?.directionsUri ||
    settings.google_maps_directions_url;
  const mapsPlaceUrl =
    googlePlace?.place?.googleMapsUri ||
    googlePlace?.mallLocation?.googleMapsUri ||
    settings.google_maps_directions_url;

  const canRenderInteractiveMap = Boolean(mapsApiKey && coordinates && !quotaExceeded);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
      <div className="lg:col-span-7 rounded-2xl overflow-hidden border border-[#252A27]/10 bg-[#EEE9DF] min-h-[380px] relative">
        {canRenderInteractiveMap && coordinates ? (
          <APIProvider apiKey={mapsApiKey} language="en" region="IN">
            <GoogleMapView
              mapId="DEMO_MAP_ID"
              defaultCenter={coordinates}
              defaultZoom={16}
              gestureHandling="cooperative"
              internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
              style={{ width: '100%', height: '100%', minHeight: '380px' }}
            >
              <ClinicMarkerWithInfo
                position={coordinates}
                name="DrVijayas ToothSpa"
                address={settings.address}
                directionsUrl={directionsUrl}
              />
            </GoogleMapView>
          </APIProvider>
        ) : (
          <div className="w-full h-full min-h-[380px] flex flex-col items-center justify-center p-8 text-center bg-gradient-to-br from-[#EEE9DF] to-[#E4EBE6]">
            <div className="w-12 h-12 rounded-full bg-[#365B4B]/10 text-[#365B4B] flex items-center justify-center mb-4">
              <MapPin className="w-6 h-6" />
            </div>
            <h3 className="font-display text-2xl font-semibold text-[#234536]">
              Mantri Square Mall, Seshadripuram
            </h3>
            <p className="text-sm text-[#252A27]/75 max-w-md mt-2 leading-relaxed">
              {settings.address}
            </p>
            <a
              href={directionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#365B4B] text-white text-sm font-medium hover:bg-[#234536] transition-colors"
            >
              <Navigation className="w-4 h-4" />
              Open in Google Maps
            </a>
          </div>
        )}
      </div>

      <div className="lg:col-span-5 bg-white rounded-2xl border border-[#252A27]/10 p-7 md:p-8 flex flex-col justify-between">
        <div className="space-y-6">
          <div>
            <p className="text-xs font-medium tracking-wider uppercase text-[#C6A66B]">
              Visit Our Mall Clinic
            </p>
            <h3 className="font-display text-2xl md:text-3xl font-semibold text-[#234536] mt-1">
              Easy Access Inside Mantri Square Mall
            </h3>
          </div>

          <div className="space-y-4 text-sm text-[#252A27]/85">
            <div className="flex items-start gap-3">
              <MapPin className="w-4 h-4 text-[#365B4B] shrink-0 mt-1" />
              <div>
                <p className="font-medium text-[#252A27]">Clinic Address</p>
                <p className="text-[#252A27]/75 leading-relaxed mt-0.5">{settings.address}</p>
                <p className="text-xs text-[#365B4B] font-medium mt-1">
                  Landmark: {settings.landmark}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 pt-3 border-t border-[#252A27]/8">
              <Clock className="w-4 h-4 text-[#365B4B] shrink-0 mt-1" />
              <div>
                <p className="font-medium text-[#252A27]">Opening Hours</p>
                <p className="text-[#252A27]/75 mt-0.5">{settings.opening_hours_text}</p>
              </div>
            </div>

            <div className="flex items-start gap-3 pt-3 border-t border-[#252A27]/8">
              <Phone className="w-4 h-4 text-[#365B4B] shrink-0 mt-1" />
              <div>
                <p className="font-medium text-[#252A27]">Direct Clinic Desk</p>
                <a
                  href={buildTelHref(settings.phone)}
                  className="text-[#365B4B] font-medium hover:underline mt-0.5 inline-block tabular-nums"
                >
                  {settings.phone}
                </a>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-6 mt-6 border-t border-[#252A27]/10 flex flex-wrap gap-3">
          <a
            href={directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-[#365B4B] text-white text-sm font-medium hover:bg-[#234536] transition-colors whitespace-nowrap"
          >
            <Navigation className="w-4 h-4" />
            Get Directions
          </a>
          <a
            href={mapsPlaceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-[#252A27]/15 text-[#252A27] text-sm font-medium hover:bg-[#EEE9DF]/60 transition-colors whitespace-nowrap"
          >
            View on Google Maps
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
