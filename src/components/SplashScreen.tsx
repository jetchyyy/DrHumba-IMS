import React from 'react';
import { useTenant } from '../contexts/TenantContext';

export const SplashScreen: React.FC = () => {
  const { tenant, isSingleTenantMode } = useTenant();
  const showDrHumbaTheme = isSingleTenantMode || (tenant && tenant.subdomain === null);

  if (!showDrHumbaTheme) {
    // ── Non-main tenants + root domain: ODYSSEY brand loading screen ──
    const tenantLogo = tenant?.logo_url;
    const appName = tenant?.name || 'ODYSSEY';

    return (
      <div className="font-odyssey min-h-screen bg-[#F9F8F3] text-[#152839] flex items-center justify-center p-4 antialiased" role="status" aria-live="polite">
        <div className="flex flex-col items-center text-center">
          {tenantLogo ? (
            <div className="w-24 h-24 rounded-full overflow-hidden bg-white border border-[#DCE1E8] mb-6">
              <img src={tenantLogo} alt="" className="w-full h-full object-cover" />
            </div>
          ) : (
            <img src="/odyssey/ody-core-thinking.webp" alt="" className="w-28 h-auto mb-6 select-none" draggable={false} />
          )}
          {tenant ? (
            <h1 className="font-odyssey-display font-bold text-[26px] leading-[34px]">{appName}</h1>
          ) : (
            <img src="/odyssey/logo-horizontal.svg" alt="ODYSSEY" className="h-7 w-auto" />
          )}
          <div className="w-56 h-1.5 bg-[#DCE1E8] rounded-full overflow-hidden mt-6">
            <div className="h-full bg-[#152839] rounded-full w-full animate-[progress_1.5s_ease-in-out_infinite]" style={{ transformOrigin: 'left' }}></div>
          </div>
          <p className="mt-4 text-sm text-[#45546A]">Loading your workspace…</p>
          {tenantLogo && (
            <div className="flex items-center gap-2 mt-10 text-xs text-[#5F6A7C]">
              <span>Powered by</span>
              <img src="/odyssey/logo-horizontal.svg" alt="ODYSSEY" className="h-6 w-auto" />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Dr. Humba (Default): Original Pink Styled Playful Splash Screen ──
  const logoUrl = tenant?.logo_url || import.meta.env.VITE_DEFAULT_LOGO || "/drhumbalogo.jpg";
  const appName = tenant?.name || import.meta.env.VITE_DEFAULT_APP_NAME || "DR. HUMBA";

  return (
    <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-pink-50 via-pink-100 to-pink-200 flex items-center justify-center p-4">
      {/* Background shapes identical to login page for seamless transition */}
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-pink-300 rounded-full mix-blend-multiply filter blur-3xl opacity-50 animate-blob"></div>
      <div className="absolute top-[20%] right-[-10%] w-80 h-80 bg-pink-400 rounded-full mix-blend-multiply filter blur-3xl opacity-50 animate-blob animation-delay-2000"></div>
      <div className="absolute bottom-[-20%] left-[20%] w-80 h-80 bg-pink-500 rounded-full mix-blend-multiply filter blur-3xl opacity-50 animate-blob animation-delay-4000"></div>
      
      {/* Playful shapes */}
      <svg className="absolute w-24 h-24 text-pink-500/20 top-1/4 left-1/4 animate-[spin_10s_linear_infinite]" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2L2 22h20L12 2z" />
      </svg>
      <svg className="absolute w-32 h-32 text-pink-400/20 bottom-1/4 right-1/4 animate-[bounce_4s_infinite]" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="12" cy="12" r="10" />
      </svg>

      <div className="relative z-10 flex flex-col items-center">
        {/* Pulsing Logo Container */}
        <div className="w-40 h-40 bg-white rounded-full p-2 shadow-2xl border-4 border-pink-100 relative overflow-hidden mb-8 animate-pulse-subtle">
          <img 
            src={logoUrl} 
            alt="Logo" 
            className="w-full h-full object-cover rounded-full" 
          />
        </div>

        {/* Brand Text */}
        <h1 className="text-4xl font-black text-slate-900 tracking-tight mb-2">{appName}</h1>
        <p className="text-sm font-bold text-pink-600 uppercase tracking-widest mb-10">
          Management System
        </p>

        {/* Loading Bar */}
        <div className="w-64 h-2 bg-white/50 backdrop-blur-sm rounded-full overflow-hidden shadow-inner">
          <div className="h-full bg-gradient-to-r from-pink-500 to-pink-600 rounded-full w-full animate-[progress_1.5s_ease-in-out_infinite]" style={{ transformOrigin: 'left' }}></div>
        </div>
        
        <p className="mt-4 text-xs font-semibold text-slate-600 uppercase tracking-widest animate-pulse">
          Loading Assets & Database...
        </p>
      </div>
    </div>
  );
};
