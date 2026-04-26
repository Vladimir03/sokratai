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
        <Link to="/students" className="flex items-center gap-2 group shrink-0">
          <img src={sokratLogo} alt="Сократ" className="w-8 h-8" />
          <span className="font-semibold text-lg text-slate-800 hidden md:inline">
            Сократ AI
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
