import React from 'react';

export const BrandIcons = {
  // === SOCIAL NETWORKS (Official React Icons Wrappers) ===
  // These are handled by react-icons in the main component, but we can map colors here if needed.

  // === CAR PLATFORMS (Custom SVGs) ===
  
  // OLX (Geometric shapes: Orange Circle, Green L, Blue X)
  Olx: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 100 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="25" cy="50" r="20" fill="#F28D13" />
      <rect x="55" y="30" width="10" height="40" fill="#88B04B" />
      <rect x="55" y="60" width="25" height="10" fill="#88B04B" />
      <path d="M85 30L95 40L90 50L95 60L85 70L80 60L75 70L65 60L70 50L65 40L75 30L80 40L85 30Z" fill="#6E45E2" /> 
      {/* Simplified conceptual logo representation */}
    </svg>
  ),

  // Webmotors (Stylized Red/Gray W)
  Webmotors: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 100 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
       <path d="M20 30 L35 70 L50 40 L65 70 L80 30" stroke="#E31C24" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),

  // iCarros (Blue 'i' + Car silhouette)
  Icarros: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 100 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <text x="15" y="75" fontFamily="Arial" fontWeight="bold" fontSize="60" fill="#0066B3">i</text>
      <path d="M40 55 C40 55 50 45 70 45 C90 45 95 55 95 55 V70 H40 V55 Z" fill="#F8981D"/>
      <circle cx="55" cy="70" r="8" fill="#333"/>
      <circle cx="85" cy="70" r="8" fill="#333"/>
    </svg>
  ),

  // Mercado Livre (Handshake yellow background)
  MercadoLivre: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 100 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
       <rect width="100" height="100" rx="20" fill="#FFE600"/>
       <path d="M30 50 L50 70 L80 30" stroke="#2D3277" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round"/> 
       {/* Symbolizing "Deal/Check" as the handshake is complex to draw manually accurately */}
    </svg>
  ),

  // Mobiauto (Purple M)
  Mobiauto: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 100 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
       <path d="M20 80 V30 L50 60 L80 30 V80" stroke="#6C3CEB" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),

  // Autoline (Blue A)
  Autoline: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 100 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
       <path d="M50 20 L20 80 H35 L50 50 L65 80 H80 L50 20 Z" fill="#003399"/>
    </svg>
  ),

  // Chaves na Mão (Key icon)
  ChavesNaMao: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 100 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
       <circle cx="65" cy="35" r="15" stroke="#0054A6" strokeWidth="8"/>
       <path d="M55 45 L25 75 L35 85 L45 75 L35 65" fill="#0054A6"/>
    </svg>
  ),

  // SóCarrão (Text SC)
  SoCarrao: ({ className }: { className?: string }) => (
    <svg viewBox="0 0 100 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="10" fill="#CC0000"/>
      <text x="50" y="70" textAnchor="middle" fontFamily="Arial" fontWeight="bold" fontSize="50" fill="white">SC</text>
    </svg>
  )
};
