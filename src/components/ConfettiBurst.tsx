import { useEffect, useRef } from "react";

type ConfettiBurstProps = {
  active: boolean;
  durationMs?: number;
  particleCount?: number;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  rotationSpeed: number;
  color: string;
  life: number;
};

const COLORS = [
  "#22c55e", // green
  "#3b82f6", // blue
  "#a855f7", // purple
  "#f97316", // orange
  "#ef4444", // red
  "#eab308", // yellow
  "#06b6d4", // cyan
];

export function ConfettiBurst({
  active,
  durationMs = 1400,
  particleCount = 140,
}: ConfettiBurstProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const particlesRef = useRef<Particle[]>([]);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize);

    // Emit from top-center-ish (feels like "salute"), spread widely
    const originX = window.innerWidth / 2;
    const originY = Math.min(160, window.innerHeight * 0.25);

    const particles: Particle[] = [];
    for (let i = 0; i < particleCount; i++) {
      const angle = (Math.random() * Math.PI) - Math.PI / 2; // mostly upward
      const speed = 6 + Math.random() * 10;
      particles.push({
        x: originX + (Math.random() - 0.5) * 40,
        y: originY + (Math.random() - 0.5) * 20,
        vx: Math.cos(angle) * speed * (0.6 + Math.random() * 0.8),
        vy: Math.sin(angle) * speed * (0.6 + Math.random() * 0.8),
        size: 4 + Math.random() * 6,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.35,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        life: 1,
      });
    }

    particlesRef.current = particles;
    startedAtRef.current = performance.now();

    const gravity = 0.35;
    const drag = 0.992;

    const tick = (now: number) => {
      const startedAt = startedAtRef.current ?? now;
      const elapsed = now - startedAt;
      const t = Math.min(elapsed / durationMs, 1);

      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      for (const p of particlesRef.current) {
        // Fade out near the end
        p.life = 1 - t;

        p.vx *= drag;
        p.vy = p.vy * drag + gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotationSpeed;

        ctx.save();
        ctx.globalAlpha = Math.max(p.life, 0);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
        ctx.restore();
      }

      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("resize", resize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      startedAtRef.current = null;
      particlesRef.current = [];
    };
  }, [active, durationMs, particleCount]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-[9999] pointer-events-none"
      aria-hidden="true"
    />
  );
}

export default ConfettiBurst;


