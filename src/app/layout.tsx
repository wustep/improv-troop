import type { Metadata } from "next";
import { Caveat, Patrick_Hand } from "next/font/google";
import "./globals.css";

const hand = Patrick_Hand({ variable: "--font-hand", subsets: ["latin"], weight: "400" });
const script = Caveat({ variable: "--font-script", subsets: ["latin"], weight: ["500", "700"] });

export const metadata: Metadata = {
  title: "Jamming",
  description: "A band of doodled animals that improvise music together.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${hand.variable} ${script.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
