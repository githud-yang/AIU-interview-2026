/** 首页夜间萤火粒子；白天暂停画布，切换或卸载时释放动画和监听。 */
import { useEffect, useRef } from 'react';
import { useTheme } from '../ui/theme-context';

interface Firefly {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  alphaDir: number;
  alphaSpeed: number;
  hue: number;
  trail: { x: number; y: number; alpha: number }[];
}

export default function FireflyCanvas() {
  const { theme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const firefliesRef = useRef<Firefly[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (theme === 'day') {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const count = Math.floor((window.innerWidth * window.innerHeight) / 18000);
    firefliesRef.current = Array.from({ length: Math.max(30, count) }, () => createFirefly(canvas));

    const animate = () => {
      ctx.fillStyle = 'rgba(8, 8, 26, 0.15)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      firefliesRef.current.forEach(ff => {
        ff.trail.unshift({ x: ff.x, y: ff.y, alpha: ff.alpha });
        if (ff.trail.length > 12) ff.trail.pop();

        ff.x += ff.vx;
        ff.y += ff.vy;
        ff.vx += (Math.random() - 0.5) * 0.04;
        ff.vy += (Math.random() - 0.5) * 0.04;
        ff.vx = Math.max(-0.8, Math.min(0.8, ff.vx));
        ff.vy = Math.max(-0.8, Math.min(0.8, ff.vy));

        ff.alpha += ff.alphaDir * ff.alphaSpeed;
        if (ff.alpha >= 1) { ff.alpha = 1; ff.alphaDir = -1; }
        if (ff.alpha <= 0.05) { ff.alpha = 0.05; ff.alphaDir = 1; }

        if (ff.x < -20) ff.x = canvas.width + 20;
        if (ff.x > canvas.width + 20) ff.x = -20;
        if (ff.y < -20) ff.y = canvas.height + 20;
        if (ff.y > canvas.height + 20) ff.y = -20;

        ff.trail.forEach((point, i) => {
          const trailAlpha = (point.alpha * (1 - i / ff.trail.length)) * 0.4;
          const trailRadius = ff.radius * (1 - i / ff.trail.length) * 0.7;
          if (trailAlpha < 0.01) return;

          const grad = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, trailRadius * 2);
          grad.addColorStop(0, `hsla(${ff.hue}, 90%, 75%, ${trailAlpha})`);
          grad.addColorStop(1, `hsla(${ff.hue}, 90%, 75%, 0)`);
          ctx.beginPath();
          ctx.arc(point.x, point.y, trailRadius * 2, 0, Math.PI * 2);
          ctx.fillStyle = grad;
          ctx.fill();
        });

        const glow = ctx.createRadialGradient(ff.x, ff.y, 0, ff.x, ff.y, ff.radius * 6);
        glow.addColorStop(0, `hsla(${ff.hue}, 95%, 80%, ${ff.alpha})`);
        glow.addColorStop(0.3, `hsla(${ff.hue}, 85%, 65%, ${ff.alpha * 0.6})`);
        glow.addColorStop(1, `hsla(${ff.hue}, 80%, 55%, 0)`);

        ctx.beginPath();
        ctx.arc(ff.x, ff.y, ff.radius * 6, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(ff.x, ff.y, ff.radius, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${ff.hue}, 100%, 92%, ${ff.alpha})`;
        ctx.fill();
      });

      animRef.current = requestAnimationFrame(animate);
    };

    ctx.fillStyle = '#08081a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    animate();

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [theme]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{ pointerEvents: 'none' }}
    />
  );
}

function createFirefly(canvas: HTMLCanvasElement): Firefly {
  return {
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    vx: (Math.random() - 0.5) * 0.6,
    vy: (Math.random() - 0.5) * 0.6,
    radius: 1.2 + Math.random() * 1.8,
    alpha: Math.random(),
    alphaDir: Math.random() > 0.5 ? 1 : -1,
    alphaSpeed: 0.005 + Math.random() * 0.015,
    hue: 42 + (Math.random() - 0.5) * 30,
    trail: [],
  };
}
