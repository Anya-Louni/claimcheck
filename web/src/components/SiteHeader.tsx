import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`font-display text-2xl font-black uppercase leading-none tracking-wider no-underline ${className}`}>
      Claimcheck
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-5 text-ink sm:px-8">
      <Wordmark />
      <nav aria-label="Main" className="flex items-center gap-2 sm:gap-6">
        <a href="#method" className="hidden font-label text-sm font-extrabold uppercase tracking-widest hover:underline md:inline">
          Method
        </a>
        <a href="#limits" className="hidden font-label text-sm font-extrabold uppercase tracking-widest hover:underline md:inline">
          Limits
        </a>
        <a href="#evals" className="hidden font-label text-sm font-extrabold uppercase tracking-widest hover:underline md:inline">
          Evals
        </a>
        <ThemeToggle />
      </nav>
    </header>
  );
}
