import type { Metadata } from "next";
import { Footer } from "./components/Footer";
import "./globals.css";

export const metadata: Metadata = {
  title: "LocalMapr | Mapping Solutions Platform",
  description:
    "Build map tours, publish shareable mapping experiences, and explore tools for modern location-based workflows.",
  icons: {
    icon: "/brand/tabIcon.png",
    shortcut: "/brand/tabIcon.png",
    apple: "/brand/tabIcon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        <Footer />
      </body>
    </html>
  );
}
