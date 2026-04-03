import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { MessageSquare, TrendingUp, User, LogOut, Backpack, Target } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import sokratLogo from "@/assets/sokrat-logo.png";

const Navigation = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const navItems = [
    { path: "/homework", icon: Backpack, label: "Домашка" },
    { path: "/chat", icon: MessageSquare, label: "Чат" },
    { path: "/practice", icon: Target, label: "Тренажёр" },
    { path: "/progress", icon: TrendingUp, label: "Прогресс" },
    { path: "/profile", icon: User, label: "Профиль" },
  ];

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("Вы вышли из системы");
    navigate("/login");
  };

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-card/80 backdrop-blur-md border-b border-border">
      <div className="container mx-auto px-4 h-14 flex items-center gap-3">
        {/* Logo — home link */}
        <Link to="/" className="flex items-center gap-2 group shrink-0">
          <svg className="w-8 h-8" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="50" cy="50" r="50" className="fill-accent" />
            <path d="M18 22 Q18 14 26 14 L48 14 Q56 14 56 22 L56 38 Q56 46 48 46 L34 46 L24 54 L24 46 Q18 46 18 38 Z" fill="white"/>
            <text x="37" y="37" fontFamily="Georgia, serif" fontSize="22" fontWeight="bold" className="fill-accent" textAnchor="middle">?</text>
            <path d="M54 38 C62 42 66 48 64 56" stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.7"/>
            <path d="M42 56 Q42 48 50 48 L74 48 Q82 48 82 56 L82 72 Q82 80 74 80 L60 80 L70 88 L50 80 Q42 80 42 72 Z" fill="white"/>
            <circle cx="62" cy="56" r="8" fill="none" stroke="#E8913A" strokeWidth="2"/>
            <path d="M59 56 C60 51 64 51 65 56" fill="none" stroke="#E8913A" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="59" y1="63" x2="65" y2="63" stroke="#E8913A" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="62" y1="44" x2="62" y2="41" stroke="#E8913A" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="71" y1="50" x2="74" y2="48" stroke="#E8913A" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="53" y1="50" x2="50" y2="48" stroke="#E8913A" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <span className="font-semibold text-lg text-slate-800 hidden md:inline">
            Сократ
          </span>
        </Link>

        {/* Tabs — scrollable on mobile, flex on desktop */}
        <div className="flex-1 overflow-x-auto scrollbar-hide min-w-0">
          <div className="flex items-center gap-1 md:gap-2 min-w-max">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.path);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-1.5 md:gap-2 px-2.5 md:px-4 py-2 rounded-lg whitespace-nowrap transition-colors text-sm ${
                    active
                      ? "bg-accent text-white font-medium"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="hidden md:inline">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Logout */}
        <Button
          variant="ghost"
          size="icon"
          onClick={handleLogout}
          className="shrink-0"
        >
          <LogOut className="w-4 h-4" />
        </Button>
      </div>
    </nav>
  );
};

export default Navigation;
