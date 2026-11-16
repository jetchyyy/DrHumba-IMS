import React, { useEffect, useState } from 'react';
import { ArrowLeft, Scale, ReceiptText, Database, Lock, UserCheck, ShieldCheck } from 'lucide-react';
import { ODYSSEY_LINKS, PRODUCT_NAME, COMPANY_NAME, COMPANY_LOCATION } from './brand';

// Layout mirrors the ODYSSEY agreements pages used by ODC Courts (demo.odc-courts.com/terms):
// navy header with a sail-curve edge, "On this page" index, summary cards,
// numbered sections, Sand callouts with an orange mast rule, compact navy footer.

const LAST_UPDATED = 'November 16, 2026';

type Block =
  | { kind: 'p'; content: React.ReactNode }
  | { kind: 'list'; items: { lead?: string; content: React.ReactNode }[] }
  | { kind: 'callout'; title: string; content: React.ReactNode };

interface LegalSection { title: string; blocks: Block[] }
interface Summary { icon: React.ElementType; title: string; text: string }

const Email: React.FC<{ to: string }> = ({ to }) => (
  <a href={`mailto:${to}`} className="font-medium text-[#B8470A] underline underline-offset-2 hover:text-[#152839]">{to}</a>
);
const InlineLink: React.FC<{ href: string; children: React.ReactNode; external?: boolean }> = ({ href, children, external }) => (
  <a href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className="font-medium text-[#B8470A] underline underline-offset-2 hover:text-[#152839]">{children}</a>
);

const renderBlock = (b: Block, i: number) => {
  if (b.kind === 'p') return <p key={i}>{b.content}</p>;
  if (b.kind === 'list') {
    return (
      <ul key={i} className="space-y-3">
        {b.items.map((it, j) => (
          <li key={j} className="relative pl-5">
            <span aria-hidden="true" className="absolute left-0 top-[10px] w-[6px] h-[6px] bg-[#152839]" />
            {it.lead && <strong className="font-semibold text-[#152839]">{it.lead}: </strong>}
            {it.content}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div key={i} className="rounded-2xl bg-[#ECE7DE] p-5 sm:p-6">
      <div className="border-l-[3px] border-[#FF6F07] pl-4 space-y-2">
        <h3 className="font-odyssey-display font-medium text-[17px] leading-[26px] text-[#152839]">{b.title}</h3>
        <p>{b.content}</p>
      </div>
    </div>
  );
};

const LegalLayout: React.FC<{
  title: string;
  intro: React.ReactNode;
  summaries: Summary[];
  sections: LegalSection[];
}> = ({ title, intro, summaries, sections }) => {
  const [active, setActive] = useState(0);

  useEffect(() => {
    document.title = `${title} · ${PRODUCT_NAME}`;
    window.scrollTo(0, 0);
  }, [title]);

  // Highlight the section currently in view in the "On this page" index.
  useEffect(() => {
    const els = sections.map((_, i) => document.getElementById(`section-${i + 1}`)).filter(Boolean) as HTMLElement[];
    const atBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    const obs = new IntersectionObserver(
      (entries) => {
        if (atBottom()) { setActive(sections.length - 1); return; }
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(Number(visible[0].target.id.replace('section-', '')) - 1);
      },
      { rootMargin: '-15% 0px -70% 0px' }
    );
    els.forEach((el) => obs.observe(el));
    // The last short section never reaches the top band; mark it once the page bottom is reached.
    const onScroll = () => {
      if (atBottom()) setActive(sections.length - 1);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { obs.disconnect(); window.removeEventListener('scroll', onScroll); };
  }, [sections]);

  const toc = (
    <ol className="border-l-2 border-[#DCE1E8]">
      {sections.map((s, i) => (
        <li key={s.title}>
          <a
            href={`#section-${i + 1}`}
            aria-current={active === i ? 'location' : undefined}
            className={`block py-1.5 pl-3 -ml-[2px] border-l-2 text-sm leading-[20px] transition-colors ${
              active === i ? 'border-[#FF6F07] text-[#152839] font-medium' : 'border-transparent text-[#45546A] hover:text-[#152839]'
            }`}
          >
            {i + 1}. {s.title}
          </a>
        </li>
      ))}
    </ol>
  );

  return (
    <div className="font-odyssey min-h-screen bg-[#F9F8F3] text-[#152839] antialiased flex flex-col">
      {/* Navy header with sail-curve edge */}
      <header className="relative bg-[#152839] text-[#F9F8F3] pb-16 sm:pb-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <a href="/" aria-label="ODYSSEY home" className="shrink-0">
            <img src="/odyssey/logo-horizontal-reverse.svg" alt="ODYSSEY" className="h-7 w-auto" />
          </a>
          <a href="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-[#DCE1E8] hover:text-[#F9F8F3]">
            <ArrowLeft className="w-4 h-4" /> Back to home
          </a>
        </div>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 sm:pt-14">
          <p className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.12em] text-[#DCE1E8]">
            <span aria-hidden="true" className="w-6 h-[2px] bg-[#FF6F07]" /> ODYSSEY agreements
          </p>
          <h1 className="font-odyssey-display font-bold text-[34px] leading-[42px] sm:text-[44px] sm:leading-[52px] tracking-[-0.01em] mt-4">{title}</h1>
          <p className="text-[16px] leading-[26px] sm:text-[18px] sm:leading-[29px] text-[#DCE1E8] mt-4 max-w-2xl">{intro}</p>
          <p className="text-sm text-[#DCE1E8]/80 mt-5">Last updated {LAST_UPDATED}</p>
        </div>
        <svg className="absolute inset-x-0 bottom-0 block h-10 w-full sm:h-16" viewBox="0 0 1440 64" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 64 L0 40 C 420 72, 980 -8, 1440 22 L1440 64 Z" fill="#F9F8F3" />
        </svg>
      </header>

      <div className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 pt-8 pb-20 lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-12">
        {/* On this page */}
        <aside className="hidden lg:block">
          <nav aria-label="On this page" className="sticky top-8">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#45546A] mb-4">On this page</p>
            {toc}
          </nav>
        </aside>
        <details className="lg:hidden mb-8 rounded-xl border border-[#DCE1E8] bg-white">
          <summary className="cursor-pointer px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-[#45546A]">On this page</summary>
          <nav aria-label="On this page" className="px-4 pb-4">{toc}</nav>
        </details>

        <main className="max-w-[720px] min-w-0">
          {/* Summary cards */}
          <div className="grid gap-4 sm:grid-cols-3 mb-12">
            {summaries.map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.title} className="rounded-2xl border border-[#DCE1E8] bg-white p-5">
                  <div className="w-9 h-9 rounded-lg bg-[#ECE7DE] flex items-center justify-center">
                    <Icon className="w-5 h-5 text-[#152839]" strokeWidth={2} />
                  </div>
                  <h2 className="font-odyssey-display font-medium text-[17px] leading-[24px] mt-4">{s.title}</h2>
                  <p className="text-sm leading-[22px] text-[#45546A] mt-1.5">{s.text}</p>
                </div>
              );
            })}
          </div>

          {sections.map((s, i) => (
            <section
              key={s.title}
              id={`section-${i + 1}`}
              className="scroll-mt-8 border-t border-[#DCE1E8] py-10 first:border-t-0 first:pt-0"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#45546A]">Section {String(i + 1).padStart(2, '0')}</p>
              <h2 className="font-odyssey-display font-medium text-[24px] leading-[32px] sm:text-[26px] sm:leading-[34px] mt-2">{s.title}</h2>
              <div className="mt-5 space-y-4 text-[16px] leading-[26px] text-[#45546A]">{s.blocks.map(renderBlock)}</div>
            </section>
          ))}
        </main>
      </div>

      <footer className="bg-[#152839] text-[#F9F8F3]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
          <div className="space-y-2">
            <img src="/odyssey/logo-horizontal-reverse.svg" alt="ODYSSEY" className="h-6 w-auto" />
            <p className="text-sm text-[#DCE1E8]">© {new Date().getFullYear()} {COMPANY_NAME} · {COMPANY_LOCATION}</p>
          </div>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium">
            <a href="/terms" className="hover:text-[#FF6F07]">Terms &amp; Conditions</a>
            <a href="/privacy" className="hover:text-[#FF6F07]">Data Privacy</a>
            <a href={`mailto:${ODYSSEY_LINKS.helloEmail}`} className="hover:text-[#FF6F07]">Contact</a>
          </nav>
        </div>
      </footer>
    </div>
  );
};

/* ───────────────────────── Terms & Conditions ───────────────────────── */

const termsSections: LegalSection[] = [
  {
    title: 'About these terms',
    blocks: [
      { kind: 'p', content: <>These terms are an agreement between your business and {COMPANY_NAME} ("ODYSSEY", "we") for the use of the {PRODUCT_NAME} (the "Service"). By applying for or using a workspace, you accept them on behalf of your business and confirm you are authorized to do so.</> },
    ],
  },
  {
    title: 'The Service',
    blocks: [
      { kind: 'p', content: 'ODYSSEY provides a cloud-based inventory management system for restaurants, retail stores and service shops.' },
      { kind: 'list', items: [
        { lead: 'Modules', content: 'sales recording and checkout, inventory, stock receiving and transfers, recipes, expenses, reports, staff accounts and audit logs, depending on your plan.' },
        { lead: 'Workspace', content: 'each business gets its own workspace on a subdomain. Data is kept separate from other businesses.' },
        { lead: 'Limits', content: 'the number of branches, staff accounts and the data retention period depend on the plan you choose.' },
      ] },
    ],
  },
  {
    title: 'Applications and accounts',
    blocks: [
      { kind: 'list', items: [
        { lead: 'Accurate details', content: 'you must give accurate business and contact details when you apply. We may decline an application.' },
        { lead: 'Approval', content: 'workspaces are created after our team reviews the application and, for paid plans, verifies payment.' },
        { lead: 'Passwords', content: 'you are responsible for keeping admin and staff passwords confidential and for all activity under your accounts.' },
        { lead: 'Security issues', content: <>tell us right away at <Email to={ODYSSEY_LINKS.helloEmail} /> if you suspect unauthorized access.</> },
      ] },
    ],
  },
  {
    title: 'Plans and payment',
    blocks: [
      { kind: 'list', items: [
        { lead: 'Billing', content: 'paid plans are billed monthly or yearly in Philippine pesos, paid through the channels shown during sign-up.' },
        { lead: 'Verification', content: 'your plan starts once we verify the payment reference and proof of payment.' },
        { lead: 'Late payment', content: 'if a renewal is not paid when due, we may suspend the workspace until it is settled. Your data is kept during suspension.' },
        { lead: 'Refunds', content: 'fees already paid are non-refundable, except where required by law or agreed with us in writing.' },
        { lead: 'Price changes', content: 'we give at least 30 days’ notice before changing the price of your current plan.' },
      ] },
    ],
  },
  {
    title: 'Acceptable use',
    blocks: [
      { kind: 'p', content: 'You agree not to:' },
      { kind: 'list', items: [
        { content: 'use the Service to break any law, or to record false or misleading transactions;' },
        { content: 'try to access another workspace or data you are not authorized to see;' },
        { content: 'interfere with, overload or reverse-engineer the Service;' },
        { content: 'resell or sublicense the Service without our written consent.' },
      ] },
    ],
  },
  {
    title: 'Your data',
    blocks: [
      { kind: 'list', items: [
        { lead: 'Ownership', content: 'you own the business data you enter, including products, sales, inventory and customer records.' },
        { lead: 'Our use', content: 'you allow ODYSSEY to store and process that data only to provide, secure and support the Service.' },
        { lead: 'Privacy roles', content: <>for personal data of your customers and staff, you are the personal information controller and ODYSSEY is your personal information processor under the Data Privacy Act of 2012. See our <InlineLink href="/privacy">Data Privacy notice</InlineLink>.</> },
        { lead: 'Tax compliance', content: 'you remain responsible for your own BIR and tax obligations, including checking that receipts and reports meet the rules that apply to your business.' },
      ] },
    ],
  },
  {
    title: 'Availability and support',
    blocks: [
      { kind: 'p', content: 'We work to keep the Service available and back up data regularly, but we do not promise uninterrupted operation. Planned maintenance is announced in advance where possible. Offline features, where your plan includes them, sync once the connection returns.' },
      { kind: 'p', content: <>Support is available at <Email to={ODYSSEY_LINKS.helloEmail} />.</> },
    ],
  },
  {
    title: 'Responsibility and liability',
    blocks: [
      { kind: 'p', content: 'To the extent allowed by law, ODYSSEY is not liable for indirect or consequential losses, such as lost profits, lost sales or business interruption. Our total liability for any claim is limited to the fees you paid for the Service in the three months before the claim.' },
    ],
  },
  {
    title: 'Ending the service',
    blocks: [
      { kind: 'p', content: <>You may cancel at any time by emailing <Email to={ODYSSEY_LINKS.helloEmail} />. We may suspend or close a workspace that breaks these terms, after notice where practical.</> },
      { kind: 'callout', title: 'When a business leaves ODYSSEY', content: <>You have <strong className="text-[#152839]">30 days</strong> after closure to request an export of your data. After that, ODYSSEY deletes or anonymizes the workspace data, except records we must keep by law, and backups are overwritten in their normal cycle.</> },
    ],
  },
  {
    title: 'Changes, governing law and contact',
    blocks: [
      { kind: 'p', content: <>We may update these terms and will show the new date at the top. We notify workspace admins of material changes at least 15 days before they take effect; continuing to use the Service after that means you accept them. These terms are governed by the laws of the Republic of the Philippines, and disputes fall under the exclusive jurisdiction of the courts of Cebu City. Questions: <Email to={ODYSSEY_LINKS.helloEmail} />.</> },
    ],
  },
];

export const TermsPage: React.FC = () => (
  <LegalLayout
    title="Terms & Conditions"
    intro={<>Please read these terms before applying for or using the {PRODUCT_NAME}. They apply to every business workspace.</>}
    summaries={[
      { icon: ReceiptText, title: 'Plans are prepaid', text: 'Workspaces start after approval and payment. Paid fees are non-refundable.' },
      { icon: Scale, title: 'Use it fairly', text: 'Record real transactions and stay within your own workspace.' },
      { icon: Database, title: 'Your data is yours', text: 'Export it within 30 days of leaving. After that it is deleted.' },
    ]}
    sections={termsSections}
  />
);

/* ───────────────────────── Data Privacy ───────────────────────── */

const privacySections: LegalSection[] = [
  {
    title: 'Who we are',
    blocks: [
      { kind: 'p', content: <>{COMPANY_NAME} ("ODYSSEY") builds websites, applications and business systems, including the {PRODUCT_NAME}. This notice explains how we handle personal data under the Data Privacy Act of 2012 (Republic Act No. 10173), its Implementing Rules and Regulations, and issuances of the National Privacy Commission (NPC).</> },
      { kind: 'list', items: [
        { lead: 'Data Protection Officer', content: <Email to={ODYSSEY_LINKS.dpoEmail} /> },
        { lead: 'General inquiries', content: <Email to={ODYSSEY_LINKS.helloEmail} /> },
      ] },
    ],
  },
  {
    title: 'What we collect',
    blocks: [
      { kind: 'list', items: [
        { lead: 'Application details', content: 'business name, workspace subdomain, admin email address, chosen plan and business type, and the admin password (stored only as a one-way hash).' },
        { lead: 'Payment details', content: 'the last digits of your payment reference and the proof-of-payment screenshot you upload. We do not collect card numbers.' },
        { lead: 'Account and usage data', content: 'staff names, emails and roles, sign-in times, device and browser information, and audit logs of actions in the workspace.' },
        { lead: 'Business records', content: 'sales, inventory and customer information a business enters, such as names on receipts or discount ID details. We process these on the business’s behalf.' },
      ] },
    ],
  },
  {
    title: 'Why we process it',
    blocks: [
      { kind: 'list', items: [
        { lead: 'To provide the Service', content: 'review applications, verify payment, create and run your workspace (contract).' },
        { lead: 'To keep it secure', content: 'audit trails, fraud prevention and troubleshooting (legitimate interest).' },
        { lead: 'To meet the law', content: 'keep records required by tax and other regulations (legal obligation).' },
        { lead: 'To keep you informed', content: 'service notices about your account, billing and changes to our terms.' },
      ] },
      { kind: 'p', content: 'We do not sell personal data, and we do not use it for advertising.' },
    ],
  },
  {
    title: 'Controller and processor',
    blocks: [
      { kind: 'p', content: 'ODYSSEY is the personal information controller for application, account and billing data. For customer and staff records a business enters into its workspace, that business is the controller and ODYSSEY is its personal information processor, acting only on its documented instructions.' },
    ],
  },
  {
    title: 'Sharing',
    blocks: [
      { kind: 'p', content: 'We share personal data only with service providers that help us run the Service, such as cloud hosting and database providers, under agreements that require them to protect it. We may also disclose data when required by law or a lawful order.' },
      { kind: 'p', content: 'Some providers may store data outside the Philippines. We require them to protect it to a standard comparable to the Data Privacy Act.' },
    ],
  },
  {
    title: 'Security',
    blocks: [
      { kind: 'list', items: [
        { lead: 'Separation', content: 'each workspace’s data is isolated by database access rules.' },
        { lead: 'Encryption', content: 'connections use HTTPS, and passwords are stored only as salted one-way hashes.' },
        { lead: 'Access', content: 'role-based permissions and audit logs; only staff who need personal data can reach it.' },
      ] },
      { kind: 'callout', title: 'If a breach happens', content: 'When a personal data breach requires notification, we notify the National Privacy Commission and affected individuals within 72 hours of knowing about it, as the law requires, and tell them what we are doing about it.' },
    ],
  },
  {
    title: 'Retention',
    blocks: [
      { kind: 'list', items: [
        { lead: 'Workspace records', content: 'kept while the workspace is active, for the retention period of your plan, and up to 10 years where BIR rules require it.' },
        { lead: 'Rejected applications', content: 'deleted with their payment proofs within 90 days, unless needed to resolve a dispute.' },
        { lead: 'Closed workspaces', content: 'deleted or anonymized after the 30-day export window, except records we must keep by law.' },
      ] },
    ],
  },
  {
    title: 'Your rights',
    blocks: [
      { kind: 'p', content: 'Under the Data Privacy Act you have the right to be informed, to access, to object, to correct, to erasure or blocking, to data portability, to damages, and to file a complaint.' },
      { kind: 'list', items: [
        { lead: 'How to ask', content: <>email our DPO at <Email to={ODYSSEY_LINKS.dpoEmail} />. We reply within 15 working days.</> },
        { lead: 'Customers and staff of a business', content: 'please contact that business first; we will help them respond.' },
        { lead: 'Complaints', content: <>if you are not satisfied with our response, you may complain to the National Privacy Commission at <InlineLink href="https://privacy.gov.ph" external>privacy.gov.ph</InlineLink>.</> },
      ] },
    ],
  },
  {
    title: 'Changes and contact',
    blocks: [
      { kind: 'p', content: <>We will post updates here, show the new date at the top, and notify workspace admins of material changes. Privacy questions: <Email to={ODYSSEY_LINKS.dpoEmail} />.</> },
    ],
  },
];

export const PrivacyPage: React.FC = () => (
  <LegalLayout
    title="Data Privacy"
    intro={<>How ODYSSEY collects, uses and protects personal data in the {PRODUCT_NAME}, in line with the Data Privacy Act of 2012.</>}
    summaries={[
      { icon: Lock, title: 'Only what we need', text: 'We collect what runs your workspace and never sell personal data.' },
      { icon: ShieldCheck, title: 'Protected by design', text: 'Isolated workspaces, HTTPS and hashed passwords.' },
      { icon: UserCheck, title: 'Your rights, honored', text: `Ask our DPO at ${ODYSSEY_LINKS.dpoEmail}. We reply within 15 working days.` },
    ]}
    sections={privacySections}
  />
);
