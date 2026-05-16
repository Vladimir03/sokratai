import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Apple,
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  Chrome,
  Compass,
  ExternalLink,
  Globe,
  HardDrive,
  HelpCircle,
  MoreVertical,
  Share,
  Smartphone,
  Sparkles,
  Zap,
} from "lucide-react";

type Platform = "ios" | "android";
type IosBrowser = "safari" | "yandex" | "other";
type AndroidBrowser = "chrome" | "yandex" | "other";

const SITE_URL = "https://sokratai.ru";

export default function InstallApp() {
  const [platform, setPlatform] = useState<Platform>("ios");
  const [iosBrowser, setIosBrowser] = useState<IosBrowser>("safari");
  const [androidBrowser, setAndroidBrowser] = useState<AndroidBrowser>("chrome");

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/i.test(ua)) setPlatform("ios");
    else if (/Android/i.test(ua)) setPlatform("android");
  }, []);

  useEffect(() => {
    const prev = document.title;
    document.title = "Установить Сократ AI на телефон — sokratai.ru";
    return () => {
      document.title = prev;
    };
  }, []);

  return (
    <div className="min-h-screen bg-socrat-surface text-slate-900">
      <TopBar />
      <main className="container mx-auto max-w-3xl px-4 pb-16 pt-8 sm:pt-12">
        <Hero />
        <BenefitsRow />

        <section className="mt-10">
          <SectionEyebrow>Шаг 1 из 2</SectionEyebrow>
          <h2 className="mt-2 text-2xl font-semibold text-slate-900 sm:text-3xl">
            Выберите устройство
          </h2>
          <p className="mt-2 text-base text-slate-600">
            Мы автоматически определили вашу платформу, но вы можете переключить вручную.
          </p>
          <PlatformTabs platform={platform} onChange={setPlatform} />
        </section>

        <section className="mt-10">
          <SectionEyebrow>Шаг 2 из 2</SectionEyebrow>
          <h2 className="mt-2 text-2xl font-semibold text-slate-900 sm:text-3xl">
            Выберите браузер
          </h2>
          <p className="mt-2 text-base text-slate-600">
            Шаги немного отличаются. Если не уверены — выбирайте рекомендованный.
          </p>

          {platform === "ios" ? (
            <IosBrowserTabs value={iosBrowser} onChange={setIosBrowser} />
          ) : (
            <AndroidBrowserTabs value={androidBrowser} onChange={setAndroidBrowser} />
          )}
        </section>

        <section className="mt-8">
          {platform === "ios" && iosBrowser === "safari" && <IosSafariSteps />}
          {platform === "ios" && iosBrowser === "yandex" && <IosYandexSteps />}
          {platform === "ios" && iosBrowser === "other" && <IosOtherSteps />}
          {platform === "android" && androidBrowser === "chrome" && <AndroidChromeSteps />}
          {platform === "android" && androidBrowser === "yandex" && <AndroidYandexSteps />}
          {platform === "android" && androidBrowser === "other" && <AndroidOtherSteps />}
        </section>

        <WhatsNext />
        <Faq />
        <BottomCta />
      </main>
    </div>
  );
}

function TopBar() {
  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/70">
      <div className="container mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          На главную
        </Link>
        <span className="text-sm font-semibold text-slate-900">Сократ AI</span>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="text-center">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-3 py-1 text-xs font-medium uppercase tracking-wider text-accent">
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        За 30 секунд
      </span>
      <h1 className="mt-4 text-3xl font-bold leading-tight text-slate-900 sm:text-4xl">
        Сократ AI на главном экране телефона
      </h1>
      <p className="mx-auto mt-3 max-w-xl text-base text-slate-600 sm:text-lg">
        Запускайте платформу одним тапом — как обычное приложение. Без App Store и Google
        Play, без скачивания.
      </p>
    </section>
  );
}

function BenefitsRow() {
  return (
    <ul className="mt-8 grid gap-3 sm:grid-cols-3">
      <BenefitCard
        icon={Zap}
        title="Запуск за секунду"
        text="Нажали иконку — открылся Сократ. Без поиска в браузере и закладках."
      />
      <BenefitCard
        icon={Bell}
        title="Напоминания о ДЗ"
        text="После входа разрешите уведомления — не пропустите новое задание."
      />
      <BenefitCard
        icon={HardDrive}
        title="Не занимает память"
        text="Меньше 1 МБ. Это умная закладка, а не полноценное приложение."
      />
    </ul>
  );
}

function BenefitCard({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof Zap;
  title: string;
  text: string;
}) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Icon className="h-4.5 w-4.5" aria-hidden="true" />
      </span>
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <p className="text-sm text-slate-600">{text}</p>
    </li>
  );
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-medium uppercase tracking-wider text-accent">
      {children}
    </span>
  );
}

function PlatformTabs({
  platform,
  onChange,
}: {
  platform: Platform;
  onChange: (value: Platform) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Выбор платформы"
      className="mt-4 grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-white p-2"
    >
      <PlatformTabButton
        active={platform === "ios"}
        onClick={() => onChange("ios")}
        icon={Apple}
        label="iPhone / iPad"
        subLabel="iOS"
      />
      <PlatformTabButton
        active={platform === "android"}
        onClick={() => onChange("android")}
        icon={Smartphone}
        label="Android"
        subLabel="Любой производитель"
      />
    </div>
  );
}

function PlatformTabButton({
  active,
  onClick,
  icon: Icon,
  label,
  subLabel,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Apple;
  label: string;
  subLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "flex min-h-[88px] items-center gap-3 rounded-md px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
        active
          ? "bg-accent text-white"
          : "bg-white text-slate-700 hover:bg-socrat-surface",
      ].join(" ")}
      style={{ touchAction: "manipulation" }}
    >
      <span
        className={[
          "inline-flex h-10 w-10 items-center justify-center rounded-full",
          active ? "bg-white/15 text-white" : "bg-slate-100 text-slate-700",
        ].join(" ")}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="flex flex-col">
        <span className="text-base font-semibold leading-tight">{label}</span>
        <span
          className={[
            "text-xs",
            active ? "text-white/80" : "text-slate-500",
          ].join(" ")}
        >
          {subLabel}
        </span>
      </span>
    </button>
  );
}

function IosBrowserTabs({
  value,
  onChange,
}: {
  value: IosBrowser;
  onChange: (value: IosBrowser) => void;
}) {
  return (
    <BrowserTabContainer label="Выбор браузера для iOS">
      <BrowserTab
        active={value === "safari"}
        onClick={() => onChange("safari")}
        icon={Compass}
        label="Safari"
        hint="Рекомендуется"
      />
      <BrowserTab
        active={value === "yandex"}
        onClick={() => onChange("yandex")}
        icon={Globe}
        label="Яндекс"
      />
      <BrowserTab
        active={value === "other"}
        onClick={() => onChange("other")}
        icon={Chrome}
        label="Chrome и другие"
      />
    </BrowserTabContainer>
  );
}

function AndroidBrowserTabs({
  value,
  onChange,
}: {
  value: AndroidBrowser;
  onChange: (value: AndroidBrowser) => void;
}) {
  return (
    <BrowserTabContainer label="Выбор браузера для Android">
      <BrowserTab
        active={value === "chrome"}
        onClick={() => onChange("chrome")}
        icon={Chrome}
        label="Chrome"
        hint="Рекомендуется"
      />
      <BrowserTab
        active={value === "yandex"}
        onClick={() => onChange("yandex")}
        icon={Globe}
        label="Яндекс"
      />
      <BrowserTab
        active={value === "other"}
        onClick={() => onChange("other")}
        icon={Smartphone}
        label="Firefox / Edge / другие"
      />
    </BrowserTabContainer>
  );
}

function BrowserTabContainer({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="mt-4 grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-white p-2"
    >
      {children}
    </div>
  );
}

function BrowserTab({
  active,
  onClick,
  icon: Icon,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Chrome;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-md px-2 py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
        active
          ? "bg-accent text-white"
          : "bg-white text-slate-700 hover:bg-socrat-surface",
      ].join(" ")}
      style={{ touchAction: "manipulation" }}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
      <span className="text-sm font-semibold leading-tight">{label}</span>
      {hint && (
        <span
          className={[
            "text-[11px] leading-none",
            active ? "text-white/80" : "text-accent",
          ].join(" ")}
        >
          {hint}
        </span>
      )}
    </button>
  );
}

function StepsCard({
  title,
  intro,
  steps,
  outro,
}: {
  title: string;
  intro?: React.ReactNode;
  steps: React.ReactNode[];
  outro?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6">
      <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      {intro && <p className="mt-2 text-base text-slate-600">{intro}</p>}
      <ol className="mt-4 space-y-3">
        {steps.map((node, index) => (
          <li key={index} className="flex gap-3">
            <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white">
              {index + 1}
            </span>
            <div className="text-base leading-relaxed text-slate-700">{node}</div>
          </li>
        ))}
      </ol>
      {outro && (
        <div className="mt-4 flex items-start gap-2 rounded-md bg-accent/5 p-3 text-sm text-slate-700">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <div>{outro}</div>
        </div>
      )}
    </div>
  );
}

function InlineButton({
  icon: Icon,
  children,
}: {
  icon: typeof Share;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-sm font-medium text-slate-700 align-baseline">
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {children}
    </span>
  );
}

function IosSafariSteps() {
  return (
    <StepsCard
      title="iPhone — Safari"
      intro={
        <>
          Safari — стандартный браузер iPhone (серая иконка-компас на главном экране).
          Только он умеет добавлять сайты на главный экран.
        </>
      }
      steps={[
        <>
          Откройте <Link to="/" className="font-medium text-accent underline">sokratai.ru</Link>
          {" "}в Safari.
        </>,
        <>
          Нажмите <InlineButton icon={Share}>«Поделиться»</InlineButton> — это квадрат
          со стрелкой вверх, обычно внизу экрана (на iPad — вверху справа).
        </>,
        <>
          Прокрутите список вниз и выберите{" "}
          <span className="font-medium text-slate-900">«На экран „Домой"»</span>{" "}
          (в английском интерфейсе — <span className="italic">Add to Home Screen</span>).
        </>,
        <>
          При необходимости измените название (по умолчанию «Сократ AI») и нажмите{" "}
          <span className="font-medium text-slate-900">«Добавить»</span> в правом верхнем
          углу.
        </>,
        <>Иконка появится на главном экране. Можно перетащить её, как обычное приложение.</>,
      ]}
      outro={
        <>Откройте новую иконку — Сократ запустится в полноэкранном режиме, без вкладок и
        адресной строки.</>
      }
    />
  );
}

function IosYandexSteps() {
  return (
    <StepsCard
      title="iPhone — Яндекс Браузер"
      intro={
        <>
          Apple разрешает добавлять иконки на главный экран{" "}
          <span className="font-medium text-slate-900">только через Safari</span>. Из Яндекс
          Браузера нужно сначала открыть сайт в Safari.
        </>
      }
      steps={[
        <>
          Откройте <Link to="/" className="font-medium text-accent underline">sokratai.ru</Link>{" "}
          в Яндекс Браузере.
        </>,
        <>
          Нажмите на адресную строку → удерживайте → выберите{" "}
          <span className="font-medium text-slate-900">«Скопировать»</span>.
        </>,
        <>
          Откройте Safari (стандартная иконка-компас на главном экране iPhone).
        </>,
        <>
          В адресной строке Safari удерживайте → выберите{" "}
          <span className="font-medium text-slate-900">«Вставить и перейти»</span>.
        </>,
        <>
          Дальше — по инструкции для Safari: <InlineButton icon={Share}>«Поделиться»</InlineButton>
          {" → "}
          <span className="font-medium text-slate-900">«На экран „Домой"»</span> →
          <span className="font-medium text-slate-900"> «Добавить»</span>.
        </>,
      ]}
      outro={
        <>
          В дальнейшем входите в Сократ только через иконку на главном экране — она запоминает
          вход и работает быстрее, чем браузер.
        </>
      }
    />
  );
}

function IosOtherSteps() {
  return (
    <StepsCard
      title="iPhone — Chrome, Firefox, Edge и прочие"
      intro={
        <>
          На iPhone все браузеры построены на движке Safari (требование Apple), но добавлять
          сайты на главный экран умеет только сам Safari. Поэтому шаги такие же, как для
          Яндекс Браузера.
        </>
      }
      steps={[
        <>В вашем браузере откройте <Link to="/" className="font-medium text-accent underline">sokratai.ru</Link>.</>,
        <>Скопируйте адрес сайта из адресной строки.</>,
        <>Откройте Safari (серая иконка-компас на главном экране).</>,
        <>Вставьте адрес и откройте.</>,
        <>
          Нажмите <InlineButton icon={Share}>«Поделиться»</InlineButton> →{" "}
          <span className="font-medium text-slate-900">«На экран „Домой"»</span> →{" "}
          <span className="font-medium text-slate-900">«Добавить»</span>.
        </>,
      ]}
      outro={
        <>
          В iOS 16.4 и новее некоторые браузеры (например, Chrome) могут предлагать «Добавить
          на главный экран» сами — соглашайтесь, если такая опция появилась.
        </>
      }
    />
  );
}

function AndroidChromeSteps() {
  return (
    <StepsCard
      title="Android — Google Chrome"
      intro={
        <>
          Chrome — самый популярный браузер на Android и лучше всего работает с Сократ AI.
        </>
      }
      steps={[
        <>
          Откройте <Link to="/" className="font-medium text-accent underline">sokratai.ru</Link>{" "}
          в Chrome.
        </>,
        <>
          Нажмите <InlineButton icon={MoreVertical}>меню</InlineButton> — три точки в правом
          верхнем углу.
        </>,
        <>
          Выберите{" "}
          <span className="font-medium text-slate-900">«Добавить на главный экран»</span>{" "}
          (или <span className="font-medium text-slate-900">«Установить приложение»</span>,
          если Chrome предложил такой вариант — он лучше).
        </>,
        <>
          Подтвердите название («Сократ AI») и нажмите{" "}
          <span className="font-medium text-slate-900">«Добавить»</span> или{" "}
          <span className="font-medium text-slate-900">«Установить»</span>.
        </>,
        <>
          Иконка появится на главном экране — либо сразу, либо после того как вы коснётесь
          подтверждения во всплывающем окне Android.
        </>,
      ]}
      outro={
        <>
          Если вы выбрали «Установить приложение» — Сократ откроется как полноценное
          приложение, без панели Chrome.
        </>
      }
    />
  );
}

function AndroidYandexSteps() {
  return (
    <StepsCard
      title="Android — Яндекс Браузер"
      intro={
        <>
          В Яндекс Браузере на Android меню обычно расположено внизу (в новых версиях) или
          вверху справа (в старых).
        </>
      }
      steps={[
        <>
          Откройте <Link to="/" className="font-medium text-accent underline">sokratai.ru</Link>{" "}
          в Яндекс Браузере.
        </>,
        <>
          Нажмите <InlineButton icon={MoreVertical}>меню</InlineButton> — три точки внизу
          справа (или сверху).
        </>,
        <>
          Выберите{" "}
          <span className="font-medium text-slate-900">«Добавить ярлык»</span> или{" "}
          <span className="font-medium text-slate-900">«На главный экран»</span>.
        </>,
        <>
          Подтвердите название и нажмите{" "}
          <span className="font-medium text-slate-900">«Добавить»</span>.
        </>,
        <>Иконка появится на главном экране.</>,
      ]}
      outro={
        <>
          Если такого пункта меню нет — обновите Яндекс Браузер в Play Маркете до последней
          версии. Старые версии не поддерживают добавление PWA.
        </>
      }
    />
  );
}

function AndroidOtherSteps() {
  return (
    <StepsCard
      title="Android — Firefox, Samsung Internet, Edge, Opera"
      intro={
        <>
          Все современные браузеры на Android умеют добавлять сайты на главный экран. Названия
          пунктов меню немного отличаются — но логика везде одинаковая.
        </>
      }
      steps={[
        <>
          Откройте <Link to="/" className="font-medium text-accent underline">sokratai.ru</Link>{" "}
          в вашем браузере.
        </>,
        <>
          Нажмите <InlineButton icon={MoreVertical}>меню</InlineButton> — обычно три точки
          или три полоски сверху/снизу.
        </>,
        <>
          Найдите пункт со словами{" "}
          <span className="font-medium text-slate-900">«На главный экран»</span>,{" "}
          <span className="font-medium text-slate-900">«Установить»</span> или{" "}
          <span className="font-medium text-slate-900">«Создать ярлык»</span>. В разных
          браузерах он называется по-разному, но всегда есть.
        </>,
        <>
          Подтвердите название и нажмите{" "}
          <span className="font-medium text-slate-900">«Добавить»</span>.
        </>,
      ]}
      outro={
        <>
          Подсказка по популярным браузерам: <span className="font-medium">Samsung Internet</span> —
          меню «☰» → «Добавить страницу на» → «Главный экран». <span className="font-medium">Firefox</span> —
          меню «⋮» → «Установить» или «Добавить ярлык». <span className="font-medium">Edge</span> —
          меню «⋯» → «Добавить на телефон». <span className="font-medium">Opera</span> — меню
          «O» → «Добавить на главный экран».
        </>
      }
    />
  );
}

function WhatsNext() {
  return (
    <section className="mt-10 rounded-lg border border-slate-200 bg-white p-5 sm:p-6">
      <SectionEyebrow>Готово</SectionEyebrow>
      <h2 className="mt-2 text-2xl font-semibold text-slate-900">Что дальше?</h2>
      <p className="mt-2 text-base text-slate-600">
        Откройте иконку Сократ AI на главном экране как обычное приложение.
      </p>
      <ul className="mt-4 space-y-2 text-base text-slate-700">
        <NextItem>Войдите в аккаунт — по email или Telegram.</NextItem>
        <NextItem>
          Если репетитор отправил вам ссылку-приглашение — откройте её один раз с того же
          телефона. Аккаунт автоматически свяжется с репетитором.
        </NextItem>
        <NextItem>
          Разрешите уведомления — будете получать напоминания о новых ДЗ и проверке
          репетитором.
        </NextItem>
      </ul>
    </section>
  );
}

function NextItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <Check className="mt-1 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

function Faq() {
  const items = useMemo(
    () => [
      {
        q: "Это настоящее приложение?",
        a: "Это веб-приложение (PWA). Иконка на главном экране открывает Сократ как полноценное приложение — без вкладок и адресной строки. Никакая установка из App Store или Google Play не нужна.",
      },
      {
        q: "Сколько места занимает?",
        a: "Меньше 1 МБ. По сути это умная закладка с локальным кешем. Само приложение Сократ AI не загружается на телефон — оно работает через сайт sokratai.ru.",
      },
      {
        q: "Будут ли приходить уведомления о ДЗ?",
        a: "Да. После первого входа разрешите уведомления — Сократ напомнит о новых заданиях и о том, что репетитор проверил вашу работу. Без разрешения уведомления приходить не будут.",
      },
      {
        q: "Как удалить иконку?",
        a: "Зажмите иконку на главном экране → выберите «Удалить» (на iPhone) или «Удалить с главного экрана» (на Android). Это удалит только ярлык. Ваш аккаунт, ДЗ и история останутся.",
      },
      {
        q: "Кнопка «На главный экран» не появилась — что делать?",
        a: "Убедитесь, что вы открыли именно sokratai.ru (а не страницу ошибки или поисковую выдачу). Перезагрузите страницу — потяните вниз. На iPhone используйте Safari, на Android — Chrome или Яндекс Браузер.",
      },
      {
        q: "Безопасно ли это?",
        a: "Да. Никакая установка APK или сторонних программ не требуется. Сократ — это обычный сайт, который браузер сохраняет в виде иконки на вашем главном экране.",
      },
    ],
    [],
  );

  return (
    <section className="mt-10">
      <div className="mb-4 flex items-center gap-2">
        <HelpCircle className="h-5 w-5 text-accent" aria-hidden="true" />
        <h2 className="text-2xl font-semibold text-slate-900">Частые вопросы</h2>
      </div>
      <div className="space-y-2">
        {items.map((item, index) => (
          <FaqItem key={index} question={item.q} answer={item.a} />
        ))}
      </div>
    </section>
  );
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      className="group rounded-lg border border-slate-200 bg-white"
    >
      <summary
        className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-base font-medium text-slate-900 [&::-webkit-details-marker]:hidden"
        style={{ touchAction: "manipulation" }}
      >
        <span>{question}</span>
        <ChevronDown
          className={[
            "h-5 w-5 shrink-0 text-slate-400 transition-transform",
            open ? "rotate-180" : "",
          ].join(" ")}
          aria-hidden="true"
        />
      </summary>
      <div className="border-t border-slate-100 px-4 py-3 text-base leading-relaxed text-slate-600">
        {answer}
      </div>
    </details>
  );
}

function BottomCta() {
  return (
    <section className="mt-12 rounded-xl bg-slate-900 p-6 text-center text-white sm:p-8">
      <h2 className="text-2xl font-semibold sm:text-3xl">Готовы попробовать?</h2>
      <p className="mx-auto mt-2 max-w-md text-base text-white/80">
        Откройте Сократ AI в браузере и пройдите шаги из инструкции выше.
      </p>
      <div className="mt-5 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <a
          href={SITE_URL}
          className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-md bg-accent px-5 text-base font-semibold text-white transition-colors hover:bg-accent/90"
          style={{ touchAction: "manipulation" }}
        >
          Открыть Сократ AI
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </a>
        <a
          href={SITE_URL}
          className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-md border border-white/20 bg-transparent px-5 text-base font-semibold text-white transition-colors hover:bg-white/10"
          style={{ touchAction: "manipulation" }}
        >
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          sokratai.ru
        </a>
      </div>
      <p className="mt-4 text-xs text-white/60">
        Не получается? Напишите нам — sokratai@yandex.ru
      </p>
    </section>
  );
}
