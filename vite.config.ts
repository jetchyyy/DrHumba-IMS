import path from "path"
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

// Link-preview crawlers don't run JS, so the meta tags must be in the built HTML.
// The Dr. Humba build keeps its own branding; every other build is the ODYSSEY ERP.
function brandMeta(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const isDrHumba = /humba/i.test(env.VITE_DEFAULT_APP_NAME || '')
  const m = isDrHumba
    ? {
        title: 'Dr. Humba Management System',
        description: 'All-in-one ERP and Point of Sale system designed to simplify operations, track inventory, and manage branches.',
        icon: env.VITE_DEFAULT_LOGO || '/drhumbalogo.jpg',
        iconType: 'image/jpeg',
        image: env.VITE_DEFAULT_LOGO || '/drhumbalogo.jpg',
        imageAlt: 'Dr. Humba logo',
        siteName: 'Dr. Humba',
        url: '',
        themeColor: '#0a0a0a',
      }
    : {
        title: 'Inventory Management System by ODYSSEY',
        description: 'Sell, count stock and close the day in one place. Built for restaurants and retail stores in the Philippines, with BIR-ready receipts and reports.',
        icon: '/odyssey/monogram.svg',
        iconType: 'image/svg+xml',
        image: 'https://erp.odysseyph.com/odyssey/og-erp.png',
        imageAlt: 'ODYSSEY Inventory Management System: one system for every branch you run.',
        siteName: 'ODYSSEY',
        url: 'https://erp.odysseyph.com/',
        themeColor: '#152839',
      }
  const tags = [
    `<meta name="theme-color" content="${m.themeColor}" />`,
    `<link rel="icon" type="${m.iconType}" href="${m.icon}" />`,
    `<link rel="apple-touch-icon" href="${m.icon}" />`,
    `<title>${esc(m.title)}</title>`,
    `<meta name="description" content="${esc(m.description)}" />`,
    m.url && `<link rel="canonical" href="${m.url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(m.siteName)}" />`,
    `<meta property="og:title" content="${esc(m.title)}" />`,
    `<meta property="og:description" content="${esc(m.description)}" />`,
    m.url && `<meta property="og:url" content="${m.url}" />`,
    `<meta property="og:image" content="${m.image}" />`,
    !isDrHumba && `<meta property="og:image:width" content="1200" />`,
    !isDrHumba && `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${esc(m.imageAlt)}" />`,
    `<meta property="og:locale" content="en_PH" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(m.title)}" />`,
    `<meta name="twitter:description" content="${esc(m.description)}" />`,
    `<meta name="twitter:image" content="${m.image}" />`,
  ].filter(Boolean)
  return {
    name: 'brand-meta',
    transformIndexHtml: (html) => html.replace('<!--BRAND_META-->', tags.join('\n  ')),
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), brandMeta(mode)],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    allowedHosts: ['.lvh.me'],
  },
}))
