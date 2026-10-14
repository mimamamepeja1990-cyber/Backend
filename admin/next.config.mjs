/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  basePath: '/admin',
  // The key is a browser-restricted Maps JavaScript key. Render can keep the
  // existing backend variable name; Next embeds it at build time for the
  // static panel.
  env: {
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY:
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
      process.env.GOOGLE_MAPS_JS_API_KEY ||
      process.env.GOOGLE_MAPS_API_KEY ||
      '',
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
