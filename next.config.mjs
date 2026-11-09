/** @type {import('next').NextConfig} */
// BASE_PATH is set when the site is published under a sub-folder,
// e.g. "/Meiadotwork" on GitHub Pages. Empty for local dev.
const basePath = process.env.BASE_PATH || "";

const nextConfig = {
  output: "export",
  images: { unoptimized: true },
  basePath,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};
export default nextConfig;
