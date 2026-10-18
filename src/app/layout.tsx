import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claude vs. el Mercado",
  description: "Experimento: una IA gestiona 10.000 € ficticios sobre precios reales del mercado.",
  robots: { index: false, follow: false },
};

// Aplica el tema guardado antes de pintar (evita el parpadeo claro/oscuro).
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-full flex-col">
        <div className="flex-1">{children}</div>
        <footer className="border-t border-line px-4 py-6 text-center text-xs text-muted">
          <p>
            <strong className="text-ink-2">Dinero 100 % ficticio.</strong> Experimento de simulación (paper trading) con precios reales. Las
            decisiones de Claude <strong className="text-ink-2">no son consejo financiero</strong> y el autor no las replica. No inviertas
            basándote en esta web.
          </p>
        </footer>
      </body>
    </html>
  );
}
