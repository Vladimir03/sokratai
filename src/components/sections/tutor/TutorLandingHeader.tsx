import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, ChevronDown, GraduationCap, LogIn } from "lucide-react";

import sokratLogo from "@/assets/sokrat-logo.png";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ANCHORS = [
  { href: "#hero", label: "Главная" },
  { href: "#product-tour", label: "Возможности" },
  { href: "#pricing", label: "Цены" },
  { href: "#social-proof", label: "Кейсы" },
  { href: "#faq", label: "FAQ" },
] as const;

export default function TutorLandingHeader() {
  const [activeId, setActiveId] = useState<string>("hero");

  useEffect(() => {
    const ids = ANCHORS.map((a) => a.href.slice(1));
    const sections = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-40% 0px -55% 0px", threshold: 0 },
    );
    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <header className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border">
      <div className="container mx-auto h-16 px-4 flex items-center gap-3 md:gap-4">
        {/* Logo */}
        <Link
          to="/"
          className="flex items-center gap-2 shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          aria-label="Сократ AI — на главную"
        >
          <img
            src={sokratLogo}
            alt="Сократ AI"
            width={32}
            height={32}
            className="w-8 h-8"
          />
          <span className="font-semibold text-lg text-slate-800 hidden sm:inline">
            Сократ AI
          </span>
        </Link>

        {/* Scroll-anchor nav */}
        <nav
          aria-label="Разделы страницы"
          className="flex-1 min-w-0 overflow-x-auto scrollbar-hide"
        >
          <ul className="flex items-center gap-1 min-w-max md:justify-center">
            {ANCHORS.map((a) => {
              const id = a.href.slice(1);
              const isActive = activeId === id;
              return (
                <li key={a.href}>
                  <a
                    href={a.href}
                    aria-current={isActive ? "location" : undefined}
                    className={`px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
                      isActive
                        ? "text-accent underline underline-offset-4"
                        : "text-slate-600 hover:text-accent hover:bg-slate-50"
                    }`}
                  >
                    {a.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Audience switcher — desktop only */}
        <Link
          to="/students"
          className="hidden md:inline-flex items-center gap-1 px-3 py-2 text-sm text-slate-600 hover:text-accent shrink-0 transition-colors rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          Для учеников
          <span aria-hidden="true">→</span>
        </Link>

        {/* Login Dropdown */}
        <div className="shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1">
                <LogIn className="w-4 h-4" />
                <span className="hidden sm:inline">Войти</span>
                <ChevronDown className="w-3 h-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem asChild>
                <Link to="/login" className="flex items-center gap-2 cursor-pointer">
                  <BookOpen className="w-4 h-4" />
                  Я ученик
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/tutor/login" className="flex items-center gap-2 cursor-pointer">
                  <GraduationCap className="w-4 h-4" />
                  Я репетитор
                </Link>
              </DropdownMenuItem>
              {/* Mobile-only audience switcher (hidden on desktop — see sibling Link above) */}
              <DropdownMenuSeparator className="md:hidden" />
              <DropdownMenuItem asChild className="md:hidden">
                <Link to="/students" className="flex items-center gap-2 cursor-pointer">
                  <BookOpen className="w-4 h-4" />
                  Для учеников и родителей →
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
