import type { Metadata, Viewport } from "next";
import { Big_Shoulders, Big_Shoulders_Stencil, Overpass_Mono, Public_Sans } from "next/font/google";
import "./globals.css";

// Display and label faces load only the weights the page uses.
const stencil = Big_Shoulders_Stencil({
  subsets: ["latin"],
  weight: ["900"],
  variable: "--font-stencil",
  fallback: ["Arial Narrow", "sans-serif"],
});
const shoulders = Big_Shoulders({
  subsets: ["latin"],
  weight: ["800"],
  variable: "--font-shoulders",
  fallback: ["Arial Narrow", "sans-serif"],
});
const publicSans = Public_Sans({ subsets: ["latin"], variable: "--font-public" });
const overpassMono = Overpass_Mono({ subsets: ["latin"], variable: "--font-overpass-mono", preload: false });

export const metadata: Metadata = {
  title: "Claimcheck: model claims, inspected",
  description:
    "Claimcheck tests what a LangChain model profile says a model can do. Each claim is probed three times with a known answer, then sealed or tagged, with the transcript attached.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4c21b" },
    { media: "(prefers-color-scheme: dark)", color: "#111110" },
  ],
};

// Runs before paint so the stored theme never flashes.
const THEME_SCRIPT = `try{var t=localStorage.getItem("theme");if(!t){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${stencil.variable} ${shoulders.variable} ${publicSans.variable} ${overpassMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
