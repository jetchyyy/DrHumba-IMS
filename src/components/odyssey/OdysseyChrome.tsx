import React from 'react';
import { Globe, Mail, ShieldCheck } from 'lucide-react';

import { ODYSSEY_LINKS, PRODUCT_NAME, COMPANY_NAME, COMPANY_LOCATION } from './brand';

const FacebookIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
    <path d="M13.5 21v-7.5h2.5l.4-3h-2.9V8.6c0-.9.3-1.5 1.5-1.5h1.5V4.4c-.3 0-1.2-.1-2.2-.1-2.2 0-3.7 1.3-3.7 3.8v2.4H8v3h2.6V21h2.9z" />
  </svg>
);

const InstagramIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
  </svg>
);

const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6F07] focus-visible:ring-offset-2 focus-visible:ring-offset-[#152839]';

export const OdysseyHeader: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <header className="sticky top-0 z-20 bg-[#F9F8F3]/95 backdrop-blur border-b border-[#DCE1E8]">
    <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
      <a href="/" aria-label="ODYSSEY home" className="shrink-0">
        <img src="/odyssey/logo-horizontal.svg" alt="ODYSSEY" className="h-7 sm:h-8 w-auto" />
      </a>
      {children}
    </div>
  </header>
);

export const OdysseyFooter: React.FC<{ cta?: React.ReactNode }> = ({ cta }) => {
  const linkCls = `text-sm text-[#DCE1E8] hover:text-[#F9F8F3] underline-offset-4 hover:underline rounded ${focusRing}`;
  return (
    <footer className="bg-[#152839] text-[#F9F8F3]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 grid gap-10 md:grid-cols-12">
        <div className="md:col-span-5 space-y-4">
          <img src="/odyssey/logo-horizontal-reverse.svg" alt="ODYSSEY" className="h-7 w-auto" />
          <p className="text-sm text-[#DCE1E8] max-w-sm">
            {PRODUCT_NAME}. Custom websites, applications and business systems, planned with you and built to last.
          </p>
          <div className="flex items-center gap-2">
            <a href={ODYSSEY_LINKS.facebook} target="_blank" rel="noopener noreferrer" aria-label="ODYSSEY on Facebook"
              className={`w-10 h-10 rounded-full border border-[#5F6A7C] flex items-center justify-center hover:border-[#F9F8F3] transition-colors ${focusRing}`}>
              <FacebookIcon className="w-5 h-5" />
            </a>
            <a href={ODYSSEY_LINKS.instagram} target="_blank" rel="noopener noreferrer" aria-label="ODYSSEY on Instagram"
              className={`w-10 h-10 rounded-full border border-[#5F6A7C] flex items-center justify-center hover:border-[#F9F8F3] transition-colors ${focusRing}`}>
              <InstagramIcon className="w-5 h-5" />
            </a>
            <a href={ODYSSEY_LINKS.website} target="_blank" rel="noopener noreferrer" aria-label="ODYSSEY website"
              className={`w-10 h-10 rounded-full border border-[#5F6A7C] flex items-center justify-center hover:border-[#F9F8F3] transition-colors ${focusRing}`}>
              <Globe className="w-5 h-5" />
            </a>
          </div>
        </div>

        <div className="md:col-span-3 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#FF6F07]">Contact</p>
          <ul className="space-y-2">
            <li>
              <a href={`mailto:${ODYSSEY_LINKS.helloEmail}`} className={`inline-flex items-center gap-2 ${linkCls}`}>
                <Mail className="w-4 h-4" /> {ODYSSEY_LINKS.helloEmail}
              </a>
              <p className="text-xs text-[#DCE1E8]/80 ml-6">General inquiries</p>
            </li>
            <li>
              <a href={`mailto:${ODYSSEY_LINKS.dpoEmail}`} className={`inline-flex items-center gap-2 ${linkCls}`}>
                <ShieldCheck className="w-4 h-4" /> {ODYSSEY_LINKS.dpoEmail}
              </a>
              <p className="text-xs text-[#DCE1E8]/80 ml-6">Data Protection Officer</p>
            </li>
            <li>
              <a href={ODYSSEY_LINKS.website} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-2 ${linkCls}`}>
                <Globe className="w-4 h-4" /> odysseyph.com
              </a>
            </li>
          </ul>
        </div>

        <div className="md:col-span-2 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#FF6F07]">Legal</p>
          <ul className="space-y-2">
            <li><a href="/terms" className={linkCls}>Terms &amp; Conditions</a></li>
            <li><a href="/privacy" className={linkCls}>Data Privacy</a></li>
          </ul>
        </div>

        {cta && <div className="md:col-span-2 md:justify-self-end">{cta}</div>}
      </div>
      <div className="border-t border-[#5F6A7C]/40">
        <p className="max-w-6xl mx-auto px-4 sm:px-6 py-5 text-xs text-[#DCE1E8]">
          © {new Date().getFullYear()} {COMPANY_NAME} · {COMPANY_LOCATION}. We process personal data in line with the Data Privacy Act of 2012 (RA 10173).
        </p>
      </div>
    </footer>
  );
};
