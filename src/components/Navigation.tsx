import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Home, MessageSquare, BookOpen, TrendingUp, User, LogOut, Backpack, ListTodo } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import pumpkinIcon from "@/assets/pumpkin.png";

const Navigation = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const navItems = [
    { path: "/", icon: Home, label: "Главная", emoji: "🏠" },
    { path: "/homework", icon: Backpack, label: "Домашка", emoji: "🎒" },
    { path: "/chat", icon: MessageSquare, label: "Чат", emoji: "💬" },
    { path: "/problems", icon: ListTodo, label: "Задачи", emoji: "📚" },
    { path: "/progress", icon: TrendingUp, label: "Прогресс", emoji: "📈" },
    { path: "/profile", icon: User, label: "Профиль", emoji: "👤" },
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
      {/* Top Header */}
      <div className="container mx-auto px-4 h-14 flex items-center justify-between border-b md:border-b-0 border-border/50">
        <Link to="/" className="flex items-center gap-2 group">
          <div className="w-7 h-7 rounded-lg bg-gradient-hero flex items-center justify-center shadow-glow transition-transform duration-300 group-hover:scale-110">
            <span className="text-primary-foreground font-bold text-base">М</span>
          </div>
          <span className="font-bold text-lg bg-gradient-hero bg-clip-text text-transparent">
            ЕГЭ Репетитор
          </span>
          <img src={pumpkinIcon} alt="Halloween pumpkin" className="w-7 h-7 animate-bounce" />
        </Link>

        <div className="flex items-center gap-2">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={handleLogout}
            className="h-8 w-8"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Desktop Navigation */}
      <div className="hidden md:flex container mx-auto px-4 h-12 items-center gap-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);
          return (
            <Button
              key={item.path}
              asChild
              variant={active ? "default" : "ghost"}
              className="gap-2 transition-all duration-300"
            >
              <Link to={item.path}>
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            </Button>
          );
        })}
      </div>

      {/* Mobile Horizontal Scrollable Navigation */}
      <div className="md:hidden overflow-x-auto scrollbar-hide">
        <div className="flex items-center gap-1 px-3 py-2 min-w-max">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg whitespace-nowrap transition-colors ${
                  active 
                    ? "bg-primary text-primary-foreground font-medium" 
                    : "bg-secondary/50 text-foreground hover:bg-secondary"
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="text-sm">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
};

export default Navigation;
