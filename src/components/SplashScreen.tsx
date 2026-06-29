import React from 'react';
import { useTenant } from '../contexts/TenantContext';

export const SplashScreen: React.FC = () => {
  const { tenant, isSingleTenantMode } = useTenant();
  const showDrHumbaTheme = isSingleTenantMode || (tenant && tenant.subdomain === null);

  if (!showDrHumbaTheme) {
    // ── SaaS Tenant / Superadmin Console: Premium Dark/Indigo Glassmorphic Splash Screen ──
    const logoUrl = tenant?.logo_url || import.meta.env.VITE_DEFAULT_LOGO || "/saaslogo.png";
    const appName = tenant?.name || import.meta.env.VITE_DEFAULT_APP_NAME || "ERPSaaS";

    return (
      <div className="min-h-screen relative overflow-hidden bg-slate-950 flex items-center justify-center p-4 text-white selection:bg-indigo-500/30">
        {/* Background radial effects */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(99,102,241,0.08),transparent_50%)] pointer-events-none" />

        {/* Background shapes */}
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-indigo-500/10 rounded-full filter blur-3xl animate-blob"></div>
        <div className="absolute top-[20%] right-[-10%] w-80 h-80 bg-purple-500/10 rounded-full filter blur-3xl animate-blob animation-delay-2000"></div>
        <div className="absolute bottom-[-20%] left-[20%] w-80 h-80 bg-blue-500/10 rounded-full filter blur-3xl animate-blob animation-delay-4000"></div>

        <div className="relative z-10 flex flex-col items-center">
          {/* Pulsing Logo Container */}
          <div className="w-40 h-40 bg-slate-950 rounded-full p-2 shadow-2xl border-4 border-slate-850 relative overflow-hidden mb-8 animate-pulse-subtle flex items-center justify-center">
            <img 
              src={logoUrl} 
              alt="Logo" 
              className="w-full h-full object-cover rounded-full" 
            />
          </div>

          {/* Brand Text */}
          <h1 className="text-4xl font-black text-white tracking-tight mb-2 uppercase">{appName}</h1>
          <p className="text-sm font-bold text-indigo-400 uppercase tracking-widest mb-10">
            Console Administration
          </p>

          {/* Loading Bar */}
          <div className="w-64 h-2 bg-slate-900/60 backdrop-blur-sm border border-slate-850 rounded-full overflow-hidden shadow-inner">
            <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-600 rounded-full w-full animate-[progress_1.5s_ease-in-out_infinite]" style={{ transformOrigin: 'left' }}></div>
          </div>
          
          <p className="mt-4 text-xs font-semibold text-slate-500 uppercase tracking-widest animate-pulse">
            Loading Workspace Modules...
          </p>
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
