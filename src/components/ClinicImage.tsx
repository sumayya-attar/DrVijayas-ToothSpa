import { useState } from 'react';
import { Sparkles } from 'lucide-react';

interface ClinicImageProps {
  src: string | null | undefined;
  alt: string;
  className?: string;
  fallbackTitle?: string;
  priority?: boolean;
}

export function ClinicImage({
  src,
  alt,
  className = 'w-full h-full object-cover',
  fallbackTitle,
  priority = false,
}: ClinicImageProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-[#EEE9DF] via-[#FAF8F2] to-[#E3ECE6] text-[#365B4B] p-6 text-center ${className}`}
        role="img"
        aria-label={alt}
      >
        <Sparkles className="w-6 h-6 mb-2 text-[#C6A66B]" strokeWidth={1.5} />
        <span className="font-display text-lg font-semibold text-[#234536]">
          {fallbackTitle || alt}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      loading={priority ? 'eager' : 'lazy'}
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
