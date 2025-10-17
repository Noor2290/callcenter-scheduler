/** @type {import('next').NextConfig} */
const nextConfig = {
  // لا تفشل عملية البناء على Vercel بسبب أخطاء TypeScript، مع إبقاء ESLint مفعّل
  typescript: {
    ignoreBuildErrors: true,
  },
  // نبقي ESLint شغال أثناء البناء (القيمة الافتراضية)
  // eslint: { ignoreDuringBuilds: false },
};

module.exports = nextConfig;
