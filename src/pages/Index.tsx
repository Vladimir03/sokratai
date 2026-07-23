import { lazy, Suspense, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import AudienceRibbon from "@/components/sections/tutor/AudienceRibbon";
import TutorLandingHeader from "@/components/sections/tutor/TutorLandingHeader";
import { useDocumentMeta } from "@/lib/useDocumentMeta";
import { capturePromoFromUrl } from "@/lib/promoCapture";

const TUTOR_LANDING_TITLE =
  "Сократ AI для репетиторов — AI-проверка рукописных ДЗ по критериям ФИПИ. Ведите в 2 раза больше учеников";
const TUTOR_LANDING_DESCRIPTION =
  "AI проверяет рукописные домашки по критериям ФИПИ и ведёт ученика к решению. Физика, математика, обществознание, русский, языки — ЕГЭ и ОГЭ. Проверка ДЗ, пробники, расписание и оплаты. 7 дней бесплатно без карты.";
const TUTOR_LANDING_OG_IMAGE =
  "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/c99bddc8-b1d7-407d-b578-ed6c55dd9e30/id-preview-7731bc3f--5fbe4a32-1baf-47b0-8f47-83e3060cf929.lovable.app-1777019278659.png";

const Hero = lazy(() => import("@/components/sections/tutor/Hero"));
const TrustStrip = lazy(() => import("@/components/sections/tutor/TrustStrip"));
const Pain = lazy(() => import("@/components/sections/tutor/Pain"));
const ProductTour1 = lazy(() => import("@/components/sections/tutor/ProductTour1"));
const ProductTour2 = lazy(() => import("@/components/sections/tutor/ProductTour2"));
const ProductTour3 = lazy(() => import("@/components/sections/tutor/ProductTour3"));
const WhyNotOldWay = lazy(() => import("@/components/sections/tutor/WhyNotOldWay"));
const FreemiumBridge = lazy(() => import("@/components/sections/tutor/FreemiumBridge"));
const SocialProof = lazy(() => import("@/components/sections/tutor/SocialProof"));
const FAQ = lazy(() => import("@/components/sections/tutor/FAQ"));
const Pricing = lazy(() => import("@/components/sections/tutor/Pricing"));
const FinalCTA = lazy(() => import("@/components/sections/tutor/FinalCTA"));
const Footer = lazy(() => import("@/components/sections/tutor/Footer"));

export default function Index() {
  const [searchParams] = useSearchParams();

  // Реферальная ссылка коллеги ведёт на корневой лендинг (?rc=CODE) — закрепляем
  // код в localStorage сразу (зеркало /egor), формы регистрации подхватят.
  useEffect(() => {
    capturePromoFromUrl(searchParams);
  }, [searchParams]);

  useDocumentMeta({
    title: TUTOR_LANDING_TITLE,
    description: TUTOR_LANDING_DESCRIPTION,
    canonical: "https://sokratai.ru/",
    ogTitle:
      "Сократ AI — ведите в 2 раза больше учеников без ночной проверки ДЗ",
    ogDescription: TUTOR_LANDING_DESCRIPTION,
    ogImage: TUTOR_LANDING_OG_IMAGE,
    ogUrl: "https://sokratai.ru/",
    ogType: "website",
    ogSiteName: "Сократ AI",
  });

  return (
    <div className="sokrat sokrat-marketing min-h-screen">
      <AudienceRibbon />
      <TutorLandingHeader />
      <main>
        <Suspense fallback={<div className="h-[640px] animate-pulse bg-slate-100" />}>
          <Hero />
        </Suspense>
        <Suspense fallback={<div className="h-[96px] bg-slate-100" />}>
          <TrustStrip />
        </Suspense>
        <Suspense fallback={<div className="h-[450px] animate-pulse bg-slate-100" />}>
          <Pain />
        </Suspense>
        <Suspense fallback={<div className="h-[560px] animate-pulse bg-slate-100" />}>
          <ProductTour1 />
        </Suspense>
        <Suspense fallback={<div className="h-[480px] animate-pulse bg-slate-100" />}>
          <ProductTour2 />
        </Suspense>
        <Suspense fallback={<div className="h-[480px] animate-pulse bg-slate-100" />}>
          <ProductTour3 />
        </Suspense>
        <Suspense fallback={<div className="h-[360px] animate-pulse bg-slate-100" />}>
          <WhyNotOldWay />
        </Suspense>
        <Suspense fallback={<div className="h-[440px] animate-pulse bg-slate-100" />}>
          <FreemiumBridge />
        </Suspense>
        <Suspense fallback={<div className="h-[600px] animate-pulse bg-slate-100" />}>
          <SocialProof />
        </Suspense>
        <Suspense fallback={<div className="h-[520px] animate-pulse bg-slate-100" />}>
          <FAQ />
        </Suspense>
        <Suspense fallback={<div className="h-[560px] animate-pulse bg-slate-100" />}>
          <Pricing />
        </Suspense>
        <Suspense fallback={<div className="h-[360px] animate-pulse bg-slate-100" />}>
          <FinalCTA />
        </Suspense>
      </main>
      <Suspense fallback={<div className="h-[240px] bg-slate-100" />}>
        <Footer />
      </Suspense>
    </div>
  );
}
