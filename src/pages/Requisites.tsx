import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const Requisites = () => {
  return (
    <div className="min-h-screen bg-slate-900 text-white py-12 px-4">
      <div className="container mx-auto max-w-2xl">
        <Link to="/">
          <Button variant="ghost" className="mb-8 text-white hover:text-accent">
            <ArrowLeft className="w-4 h-4 mr-2" />
            На главную
          </Button>
        </Link>

        <h1 className="text-3xl font-bold mb-8 text-center">Реквизиты</h1>

        <Card className="bg-slate-800 border-slate-700">
          <CardHeader>
            <CardTitle className="text-xl text-white">Информация об Исполнителе</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-slate-300">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-slate-400">ФИО</p>
                <p className="font-medium text-white">Камчаткин Владимир Анатольевич</p>
              </div>
              <div>
                <p className="text-sm text-slate-400">Статус</p>
                <p className="font-medium text-white">Самозанятый</p>
              </div>
              <div>
                <p className="text-sm text-slate-400">ИНН</p>
                <p className="font-medium text-white">212905035125</p>
              </div>
              <div>
                <p className="text-sm text-slate-400">Email</p>
                <a 
                  href="mailto:sokratai@yandex.ru" 
                  className="font-medium text-accent hover:text-accent/80 transition-colors"
                >
                  sokratai@yandex.ru
                </a>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="mt-8 p-6 bg-slate-800/50 rounded-lg border border-slate-700">
          <p className="text-slate-300 text-sm leading-relaxed">
            Услуги на сайте sokratai.ru оказываются физическим лицом, зарегистрированным в качестве 
            самозанятого в соответствии с Федеральным законом от 27.11.2018 № 422-ФЗ «О проведении 
            эксперимента по установлению специального налогового режима "Налог на профессиональный доход"».
          </p>
        </div>

        <div className="mt-8 text-center">
          <Link to="/">
            <Button variant="outline" className="border-slate-600 bg-slate-800 text-white hover:bg-slate-700">
              Вернуться на главную
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Requisites;
