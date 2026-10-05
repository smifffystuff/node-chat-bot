import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Let other devices on the home network (e.g. a phone) use the dev server.
  // Without this, `next dev` blocks their requests and the page never becomes
  // interactive. Only affects development; `next start` ignores it.
  allowedDevOrigins: ["192.168.*.*", "raspberrypi5.local"],
};

export default nextConfig;
