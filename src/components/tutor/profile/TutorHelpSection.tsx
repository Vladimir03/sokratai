import { Link } from 'react-router-dom';
import { Download, Smartphone } from 'lucide-react';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

/**
 * «Помощь и инструкции» на /tutor/profile (запрос Елены, 2026-07-02):
 *   - блок установки приложения → ведёт на готовую страницу /install
 *     (пошаговая, авто-определение iOS/Android — контент НЕ дублируем);
 *   - аккордеон операционных вопросов.
 *
 * FAQ_ITEMS редактируются здесь. «Как вести учёт оплат» — базовый ответ;
 * Vladimir дополнит после сбора вопросов с Еленой (см. TODO ниже).
 */

interface FaqItem {
  q: string;
  a: string;
}

const FAQ_ITEMS: FaqItem[] = [
  {
    q: 'Как установить приложение на телефон или компьютер?',
    a: 'Нажмите «Как установить» выше — там пошаговая инструкция для iPhone и Android (устройство определяется автоматически). На компьютере приложение ставится из браузера Chrome в один клик.',
  },
  {
    q: 'Как добавить ученика?',
    a: 'Раздел «Все ученики» → «Добавить ученика». Можно завести по имени (даже без контакта), по email или отправить ссылку/QR — ученик подключится сам, устанавливать приложение ему не обязательно.',
  },
  {
    q: 'Как отправить ученику домашнее задание?',
    a: 'Раздел «Домашние задания» → «Создать». Добавьте задачи вручную, из «Базы задач» или через AI-загрузку, выберите учеников и отправьте — ученик получит ссылку в Telegram или на почту.',
  },
  {
    // TODO(Vladimir): дополнить после сбора вопросов по учёту оплат с Еленой.
    q: 'Как вести учёт оплат?',
    a: 'В разделе «Оплаты» виден журнал всех полученных оплат, а баланс каждого ученика — в его карточке. Когда занятие проходит, его стоимость списывается с баланса; пополнить баланс можно кнопкой «Внести оплату». Отметить оплату можно и прямо из Telegram-бота командой /pay.',
  },
  {
    q: 'Что будет с учениками и данными, если не продолжу тариф?',
    a: 'Все данные сохранятся — ученики, ДЗ и история проверок останутся на месте. Выключится только AI-слой: новые ДЗ нельзя будет проверять автоматически. Расписание, оплаты и профили продолжат работать бесплатно. Вернуть AI — одна оплата в этом же профиле.',
  },
];

export function TutorHelpSection() {
  return (
    <section
      aria-labelledby="tutor-help-heading"
      className="rounded-lg border border-border bg-card p-4 sm:p-6"
    >
      <h2 id="tutor-help-heading" className="text-lg font-semibold text-slate-900">
        Помощь и инструкции
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Установка приложения и ответы на частые вопросы.
      </p>

      {/* Установка приложения → готовая страница /install (не дублируем контент). */}
      <div className="mt-4 flex flex-col gap-3 rounded-lg bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2.5">
          <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-slate-900">Приложение на телефоне</p>
            <p className="text-xs text-slate-500">
              Иконка на экране, быстрый доступ, работает как приложение.
            </p>
          </div>
        </div>
        <Link
          to="/install"
          style={{ touchAction: 'manipulation' }}
          className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Как установить
        </Link>
      </div>

      {/* Частые вопросы */}
      <div className="mt-5">
        <h3 className="text-sm font-semibold text-slate-900">Частые вопросы</h3>
        <Accordion type="single" collapsible className="mt-2">
          {FAQ_ITEMS.map((item, index) => (
            <AccordionItem key={item.q} value={`faq-${index}`}>
              <AccordionTrigger className="text-left text-sm font-medium">
                {item.q}
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-slate-600">
                {item.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}

export default TutorHelpSection;
