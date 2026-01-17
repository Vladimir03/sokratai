import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { GraduationCap, Users, Calendar, CreditCard, LogOut } from "lucide-react";
import TutorGuard from "@/components/TutorGuard";

const TutorDashboardContent = () => {
  const navigate = useNavigate();
  const [userName, setUserName] = useState<string>("");

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.user_metadata?.username) {
        setUserName(user.user_metadata.username);
      } else if (user?.email) {
        setUserName(user.email.split("@")[0]);
      }
    };
    fetchUser();
  }, []);

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      toast.success("Вы вышли из системы");
      navigate("/login");
    } catch (error) {
      console.error("Logout error:", error);
      toast.error("Ошибка выхода");
    }
  };

  const upcomingFeatures = [
    { icon: Users, title: "Список учеников", description: "Управляйте своими учениками" },
    { icon: Calendar, title: "Расписание", description: "Планируйте занятия" },
    { icon: CreditCard, title: "Учёт оплат", description: "Отслеживайте платежи" },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
              <GraduationCap className="w-5 h-5 text-primary" />
            </div>
            <span className="font-semibold text-lg">Socrat</span>
          </div>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            <LogOut className="w-4 h-4 mr-2" />
            Выйти
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Welcome Section */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              👋 Добро пожаловать{userName ? `, ${userName}` : ""}!
            </CardTitle>
            <CardDescription>
              Это ваш кабинет репетитора. Здесь вы сможете управлять учениками и занятиями.
            </CardDescription>
          </CardHeader>
        </Card>

        {/* Upcoming Features */}
        <h2 className="text-lg font-semibold mb-4 text-muted-foreground">
          Скоро появится:
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {upcomingFeatures.map((feature) => (
            <Card key={feature.title} className="opacity-60">
              <CardContent className="pt-6">
                <div className="flex flex-col items-center text-center">
                  <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mb-4">
                    <feature.icon className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <h3 className="font-medium mb-1">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground">{feature.description}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
};

const TutorDashboard = () => {
  return (
    <TutorGuard>
      <TutorDashboardContent />
    </TutorGuard>
  );
};

export default TutorDashboard;
