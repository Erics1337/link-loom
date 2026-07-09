/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@link-loom/ui"],
  images: {
    formats: ["image/avif", "image/webp"],
  },
  modularizeImports: {
    "lucide-react": {
      transform: "lucide-react/dist/esm/icons/{{kebabCase member}}",
    },
  },
};

module.exports = nextConfig;
