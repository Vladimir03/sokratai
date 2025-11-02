import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Home, MessageSquare, BookOpen, TrendingUp, User, LogOut, Backpack, ListTodo } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
          <svg className="w-10 h-10 transition-transform duration-300 group-hover:scale-110" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            {/* First bubble (question) */}
            <path d="M 15 25 Q 15 15 25 15 L 45 15 Q 55 15 55 25 L 55 40 Q 55 50 45 50 L 30 50 L 20 60 L 20 50 Q 15 50 15 40 Z" 
                  fill="#10b981" opacity="0.9"/>
            <text x="35" y="37" fontFamily="Manrope, sans-serif" fontSize="20" fontWeight="bold" fill="white" textAnchor="middle">?</text>
            
            {/* Second bubble (understanding/lightbulb) */}
            <path d="M 45 55 Q 45 45 55 45 L 75 45 Q 85 45 85 55 L 85 70 Q 85 80 75 80 L 60 80 L 80 90 L 60 90 Q 45 90 45 80 Z" 
                  fill="white" opacity="0.95"/>
            <text x="65" y="67" fontFamily="Manrope, sans-serif" fontSize="20" fontWeight="bold" fill="#2d3561" textAnchor="middle">💡</text>
          </svg>
          <span className="font-bold text-lg bg-gradient-hero bg-clip-text text-transparent">
            Сократ
          </span>
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
