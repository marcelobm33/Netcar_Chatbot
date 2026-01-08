import { 
  FaFacebook, 
  FaFacebookMessenger, 
  FaGoogle, 
  FaWhatsapp, 
  FaInstagram, 
  FaGlobe,
  FaMapMarkerAlt,
} from "react-icons/fa";
import { Store, RefreshCw, Gavel, Building2 } from "lucide-react";
import { BrandIcons } from "./BrandIcons";

interface SourceIconProps {
  source: string | null | undefined;
  className?: string;
}

export function SourceIcon({ source, className = "w-4 h-4" }: SourceIconProps) {
  const s = (source || '').toLowerCase();
  
  // NOTE: className is passed to custom SVGs to maintain size/color flexibility
  // typically 'w-4 h-4' is passed.

  // === SOCIAL / ADS NETWORKS (Official React Icons) ===
  if (s.includes('facebook') || s.includes('fb')) return <FaFacebook className={`${className} text-blue-600`} title="Facebook" />;
  if (s.includes('messenger')) return <FaFacebookMessenger className={`${className} text-blue-500`} title="Messenger" />;
  if (s.includes('instagram') || s.includes('ig')) return <FaInstagram className={`${className} text-pink-500`} title="Instagram" />;
  if (s.includes('google')) return <FaGoogle className={`${className} text-red-500`} title="Google Ads" />;
  
  // === BRAZILIAN CAR PLATFORMS (Custom Authentic Icons) ===

  // 1. OLX
  if (s.includes('olx')) return <BrandIcons.Olx className={className} />;
  
  // 2. Webmotors
  if (s.includes('webmotors')) return <BrandIcons.Webmotors className={className} />;
  
  // 3. iCarros
  if (s.includes('icarros')) return <BrandIcons.Icarros className={className} />;
  
  // 4. Mercado Livre
  if (s.includes('mercado')) return <BrandIcons.MercadoLivre className={className} />;
  
  // 5. Autoline (Bradesco)
  if (s.includes('autoline')) return <BrandIcons.Autoline className={className} />;
  
  // 6. Mobiauto
  if (s.includes('mobiauto')) return <BrandIcons.Mobiauto className={className} />;
  
  // 7. Chaves na Mão
  if (s.includes('chaves')) return <BrandIcons.ChavesNaMao className={className} />;
  
  // 8. SóCarrão
  if (s.includes('socarrao') || s.includes('sócarrão')) return <BrandIcons.SoCarrao className={className} />;
  
  // 9. Autocarro (Uses generic car icon but green, pending SVG)
  if (s.includes('autocarro')) return <BrandIcons.Webmotors className={`${className} text-green-600`} />; // Fallback to similar style temporarily or keep generic

  
  // === GENERIC CATEGORIES ===
  
  // Locadoras / Seminovos (Localiza, Unidas, Movida)
  if (s.includes('localiza') || s.includes('unidas') || s.includes('movida')) return <Building2 className={`${className} text-green-700`} />;
  
  // Repasse / Leilão
  if (s.includes('repasse') || s.includes('connect')) return <RefreshCw className={`${className} text-amber-500`} />;
  if (s.includes('leilao') || s.includes('leilão') || s.includes('copart') || s.includes('superbid')) return <Gavel className={`${className} text-red-700`} />;
  
  // Site / Portal / Default
  if (s.includes('site') || s.includes('portal') || s.includes('web')) return <FaGlobe className={`${className} text-gray-600`} title="Site" />;
  
  // WhatsApp Direto (Default Fallback)
  if (s.includes('whatsapp') || s.includes('wa') || s.includes('direto') || !s) return <FaWhatsapp className={`${className} text-green-500`} title="WhatsApp Direto" />;
  
  // Default Generic Platform
  return <Store className={`${className} text-gray-400`} />;
}

