import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Meridian — supply-chain network modelling",
  description: "Describe, visualise and stress-test your supply-chain network. Baseline vs scenario, cost-to-serve, pinchpoints and confidence in one workspace.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1f3d4d" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${plexSans.variable} ${newsreader.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="h-full min-h-full overflow-hidden bg-background text-foreground">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
          <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
          <Toaster position="bottom-center" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
