import { lazy, Suspense } from "react";
import AudienceRibbon from "@/components/sections/tutor/AudienceRibbon";
import TutorLandingHeader from "@/components/sections/tutor/TutorLandingHeader";

const Hero = lazy(() => import("@/components/sections/tutor/Hero"));
const TrustStrip = lazy(() => import("@/components/sections/tutor/TrustStrip"));
const Pain = lazy(() => import("@/components/sections/tutor/Pain"));
const ProductTour1 = lazy(() => import("@/components/sections/tutor/ProductTour1"));
const ProductTour2 = lazy(() => import("@/components/sections/tutor/ProductTour2"));
const ProductTour3 = lazy(() => import("@/components/sections/tutor/ProductTour3"));
const FreemiumBridge = lazy(() => import("@/components/sections/tutor/FreemiumBridge"));
const SocialProof = lazy(() => import("@/components/sections/tutor/SocialProof"));
const FAQ = lazy(() => import("@/components/sections/tutor/FAQ"));
const Pricing = lazy(() => import("@/components/sections/tutor/Pricing"));
const FinalCTA = lazy(() => import("@/components/sections/tutor/FinalCTA"));
const Footer = lazy(() => import("@/components/sections/tutor/Footer"));

export default function Index() {
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
