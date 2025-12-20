import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const PrivacyPolicy = () => {
  return (
    <div className="min-h-screen bg-slate-900 text-white py-12 px-4">
      <div className="container mx-auto max-w-4xl">
        <Link to="/">
          <Button variant="ghost" className="mb-8 text-white hover:text-accent">
            <ArrowLeft className="w-4 h-4 mr-2" />
            На главную
          </Button>
        </Link>

        <h1 className="text-3xl font-bold mb-8 text-center">Политика конфиденциальности</h1>

        <div className="prose prose-invert max-w-none space-y-8">
          {/* Вступление */}
          <div className="p-6 bg-slate-800/50 rounded-lg border border-slate-700">
            <p className="text-slate-300 leading-relaxed">
              Настоящая Политика конфиденциальности (далее — «Политика») действует в отношении всей 
              информации, которую сайт sokratai.ru может получить о пользователе во время использования 
              им сайта, его сервисов и форм обратной связи.
            </p>
            <p className="text-slate-300 leading-relaxed mt-4">
              Оператором персональных данных является <strong className="text-white">Камчаткин Владимир Анатольевич</strong>, 
              самозанятый, ИНН 212905035125, email для связи:{" "}
              <a href="mailto:sokratai@yandex.ru" className="text-accent hover:text-accent/80">
                sokratai@yandex.ru
              </a>.
            </p>
          </div>

          {/* 1. Основные понятия */}
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">1. Основные понятия</h2>
            <div className="space-y-3 text-slate-300">
              <p><strong className="text-white">Персональные данные</strong> — любая информация, относящаяся 
              к прямо или косвенно определённому или определяемому физическому лицу (субъекту персональных данных).</p>
              <p><strong className="text-white">Обработка персональных данных</strong> — любое действие (операция) 
              или совокупность действий (операций), совершаемых с использованием средств автоматизации или без 
              использования таких средств с персональными данными.</p>
              <p><strong className="text-white">Оператор</strong> — физическое лицо, самостоятельно организующее 
              и осуществляющее обработку персональных данных.</p>
              <p><strong className="text-white">Пользователь</strong> — любое лицо, использующее сайт sokratai.ru 
              и его сервисы.</p>
            </div>
          </section>

          {/* 2. Состав и категории обрабатываемых ПД */}
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">2. Состав и категории обрабатываемых персональных данных</h2>
            <div className="space-y-3 text-slate-300">
              <p>2.1. Оператор может обрабатывать следующие персональные данные Пользователя:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Адрес электронной почты (email)</li>
                <li>Имя пользователя (username)</li>
                <li>Идентификатор пользователя в Telegram (Telegram ID)</li>
                <li>Имя пользователя в Telegram (Telegram username)</li>
                <li>Сведения о классе обучения</li>
                <li>Сведения об учебных целях</li>
                <li>История переписки с ИИ-ассистентом</li>
                <li>Данные об использовании сервиса (статистика)</li>
              </ul>
              <p>2.2. Также автоматически собираются:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>IP-адрес</li>
                <li>Данные о браузере и устройстве</li>
                <li>Дата и время посещения сайта</li>
                <li>Файлы cookie и аналогичные технологии</li>
              </ul>
            </div>
          </section>

          {/* 3. Цели и правовые основания обработки */}
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">3. Цели и правовые основания обработки</h2>
            <div className="space-y-3 text-slate-300">
              <p>3.1. Персональные данные обрабатываются в следующих целях:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Идентификация Пользователя для предоставления доступа к сервису</li>
                <li>Оказание образовательных услуг посредством ИИ-ассистента</li>
                <li>Связь с Пользователем для информирования об услугах и обновлениях</li>
                <li>Улучшение качества сервиса и персонализация контента</li>
                <li>Исполнение договорных обязательств</li>
                <li>Соблюдение требований законодательства РФ</li>
              </ul>
              <p>3.2. Правовыми основаниями обработки являются:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Согласие Пользователя на обработку персональных данных</li>
                <li>Исполнение договора, стороной которого является Пользователь</li>
                <li>Соблюдение требований законодательства Российской Федерации</li>
              </ul>
            </div>
          </section>

          {/* 4. Порядок и способы обработки */}
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">4. Порядок и способы обработки</h2>
            <div className="space-y-3 text-slate-300">
              <p>4.1. Обработка персональных данных осуществляется с использованием средств автоматизации.</p>
              <p>4.2. Персональные данные хранятся на защищённых серверах и не передаются третьим лицам, 
              за исключением случаев, предусмотренных законодательством РФ.</p>
              <p>4.3. Оператор принимает необходимые и достаточные организационные и технические меры 
              для защиты персональных данных от неправомерного доступа.</p>
              <p>4.4. Срок хранения персональных данных определяется достижением целей обработки или 
              отзывом согласия Пользователем.</p>
            </div>
          </section>

          {/* 5. Права пользователя */}
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">5. Права пользователя как субъекта персональных данных</h2>
            <div className="space-y-3 text-slate-300">
              <p>5.1. Пользователь имеет право:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Получать информацию об обработке своих персональных данных</li>
                <li>Требовать уточнения, блокирования или уничтожения персональных данных</li>
                <li>Отозвать согласие на обработку персональных данных</li>
                <li>Обжаловать действия Оператора в уполномоченный орган по защите прав субъектов персональных данных</li>
              </ul>
              <p>5.2. Для реализации своих прав Пользователь может направить запрос на email: sokratai@yandex.ru.</p>
              <p>5.3. Оператор обязуется рассмотреть запрос в течение 30 дней с момента получения.</p>
            </div>
          </section>

          {/* 6. Меры по защите ПД */}
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">6. Меры по защите персональных данных</h2>
            <div className="space-y-3 text-slate-300">
              <p>6.1. Оператор применяет следующие меры по защите персональных данных:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Использование защищённого соединения (HTTPS/SSL)</li>
                <li>Хранение данных на серверах с ограниченным доступом</li>
                <li>Шифрование паролей и критичных данных</li>
                <li>Регулярное обновление программного обеспечения</li>
                <li>Ограничение доступа к персональным данным</li>
              </ul>
              <p>6.2. Оператор регулярно проводит оценку достаточности принятых мер защиты.</p>
            </div>
          </section>

          {/* 7. Порядок изменения Политики и контакты */}
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">7. Порядок изменения Политики и контакты оператора</h2>
            <div className="space-y-3 text-slate-300">
              <p>7.1. Оператор вправе вносить изменения в настоящую Политику. Новая редакция Политики 
              вступает в силу с момента её размещения на сайте.</p>
              <p>7.2. Продолжение использования сервиса после внесения изменений означает согласие 
              Пользователя с новой редакцией Политики.</p>
              <p>7.3. По всем вопросам, связанным с обработкой персональных данных, Пользователь 
              может обратиться к Оператору:</p>
              <div className="p-4 bg-slate-800 rounded-lg border border-slate-700 mt-4">
                <p><strong className="text-white">Email:</strong>{" "}
                  <a href="mailto:sokratai@yandex.ru" className="text-accent hover:text-accent/80">
                    sokratai@yandex.ru
                  </a>
                </p>
                <p><strong className="text-white">Сайт:</strong>{" "}
                  <a href="https://sokratai.ru" className="text-accent hover:text-accent/80">
                    sokratai.ru
                  </a>
                </p>
              </div>
            </div>
          </section>

          <p className="text-sm text-slate-400 text-center pt-4">
            Дата последнего обновления: 20 декабря 2025 г.
          </p>
        </div>

        <div className="mt-12 text-center">
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

export default PrivacyPolicy;
