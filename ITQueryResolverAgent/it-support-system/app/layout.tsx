import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IT Support Desk",
  description: "Raise and track IT support tickets.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen text-slate-900 antialiased">
        <video
          className="fixed inset-0 -z-20 h-full w-full object-cover"
          src="/videos/bg.mp4"
          autoPlay
          loop
          muted
          playsInline
        />
        <div className="fixed inset-0 -z-10 bg-base-950/22" />
        {children}
      </body>
    </html>
  );
}
