
"use client";

import React, { useState } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils'; // Assuming standard shadcn/nextjs utils

interface LazyImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
}

/**
 * Optimized Image Component with load transition
 */
export function LazyImage({ src, alt, width, height, className, ...props }: LazyImageProps) {
  const [isLoading, setIsLoading] = useState(true);

  return (
    <div className={cn("overflow-hidden relative", className)}>
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        className={cn(
          "duration-700 ease-in-out w-full h-full object-cover transition-all",
          isLoading ? "scale-110 blur-xl grayscale" : "scale-100 blur-0 grayscale-0"
        )}
        onLoad={() => setIsLoading(false)}
        {...props}
      />
    </div>
  );
}
