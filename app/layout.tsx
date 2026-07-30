import type { Metadata } from "next";
import {
  Archivo,
  Baloo_2,
  Bricolage_Grotesque,
  DM_Mono,
  Fraunces,
  JetBrains_Mono,
  Space_Grotesk,
  Space_Mono,
} from "next/font/google";
import "./globals.css";

// Curated font pairs the theme agent switches between via data-font on <html>
// (mapped to --font-display/--font-mono in globals.css). The default pair (zine =
// Bricolage + DM Mono) preloads; the rest load only when a theme actually uses
// them, so visitors never download all eight.
const zine = Bricolage_Grotesque({ variable: "--font-zine", subsets: ["latin"] });
const zineMono = DM_Mono({ variable: "--font-zine-mono", subsets: ["latin"], weight: ["400", "500"] });
const space = Space_Grotesk({ variable: "--font-space", subsets: ["latin"], preload: false });
const spaceMono = Space_Mono({ variable: "--font-space-mono", subsets: ["latin"], weight: ["400", "700"], preload: false });
const editorial = Fraunces({ variable: "--font-editorial", subsets: ["latin"], preload: false });
const terminal = JetBrains_Mono({ variable: "--font-terminal", subsets: ["latin"], preload: false });
const rounded = Baloo_2({ variable: "--font-rounded", subsets: ["latin"], preload: false });
const impact = Archivo({ variable: "--font-impact", subsets: ["latin"], preload: false });

const fontVars = [zine, zineMono, space, spaceMono, editorial, terminal, rounded, impact]
  .map((f) => f.variable)
  .join(" ");

export const metadata: Metadata = {
  title: "Line by Line Lab",
  description:
    "AI-powered evidence discovery and card cutting for competitive debate.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: the pre-paint script below legitimately rewrites
    // <html> attributes (theme, bg/mood/font, inline CSS vars) before React
    // hydrates, so the attribute mismatch on this element is expected.
    <html
      lang="en"
      data-theme="rostrum"
      suppressHydrationWarning
      className={`${fontVars} h-full antialiased`}
    >
      <head>
        {/* Apply the saved theme before first paint to avoid a flash. For a
            custom (agent-generated) theme it replays the stored payload
            generically — no theme mapping is duplicated here. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('lbl-theme');if(!t)return;var r=document.documentElement;" +
              "if(t==='custom'){var raw=localStorage.getItem('lbl-custom-theme');if(!raw)return;var p=JSON.parse(raw);" +
              "r.setAttribute('data-theme','custom');if(p.dataset){r.setAttribute('data-bg',p.dataset.bg);" +
              "r.setAttribute('data-mood',p.dataset.mood);r.setAttribute('data-font',p.dataset.font);}" +
              "if(p.vars){for(var k in p.vars){r.style.setProperty(k,p.vars[k]);}}}else{r.setAttribute('data-theme',t);}}catch(e){}})();",
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
