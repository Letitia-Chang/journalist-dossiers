import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Link previews need an absolute image URL, which is only known per deployment. Vercel provides its
// production domain at build time; elsewhere set SITE_URL. Without either, no image tag is added.
function linkPreviewImage(): Plugin {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL
  const site = (process.env.SITE_URL ?? (host ? `https://${host}` : '')).replace(/\/+$/, '')
  return {
    name: 'link-preview-image',
    transformIndexHtml: () => (site ? [
      { tag: 'meta', attrs: { property: 'og:image', content: `${site}/og.jpg` }, injectTo: 'head' },
      { tag: 'meta', attrs: { property: 'og:url', content: site }, injectTo: 'head' },
    ] : []),
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), linkPreviewImage()],
})
