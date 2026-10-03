// A string of hand-coloured pennants across the top of the stage. Deterministic wobble
// so it draws the same on server and client.

const COLORS = ["var(--pencil-red)", "var(--pencil-yellow)", "var(--pencil-blue)", "var(--pencil-green)", "var(--pencil-purple)"];

function wob(i: number, k: number) {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * 2;
}

export function Bunting() {
  const flags = 17;
  const sag = (t: number) => 10 + Math.sin(t * Math.PI) * 14;
  const items = Array.from({ length: flags }, (_, i) => {
    const t0 = (i + 0.15) / flags;
    const t1 = (i + 0.85) / flags;
    const x0 = t0 * 1000;
    const x1 = t1 * 1000;
    const y0 = sag(t0);
    const y1 = sag(t1);
    const tipX = (x0 + x1) / 2 + wob(i, 1) * 3;
    const tipY = (y0 + y1) / 2 + 26 + wob(i, 2) * 3;
    const d = `M${x0.toFixed(1)} ${y0.toFixed(1)} L${x1.toFixed(1)} ${y1.toFixed(1)} L${tipX.toFixed(1)} ${tipY.toFixed(1)} Z`;
    // a few hatch strokes inside each pennant
    const hatch = [0.3, 0.55, 0.8]
      .map((f) => {
        const ax = x0 + (tipX - x0) * f;
        const ay = y0 + (tipY - y0) * f;
        const bx = x1 + (tipX - x1) * f;
        const by = y1 + (tipY - y1) * f;
        return `M${ax.toFixed(1)} ${ay.toFixed(1)} L${bx.toFixed(1)} ${(by - 3).toFixed(1)}`;
      })
      .join(" ");
    return { d, hatch, color: COLORS[i % COLORS.length] };
  });
  const line = Array.from({ length: 41 }, (_, i) => {
    const t = i / 40;
    return `${i ? "L" : "M"}${(t * 1000).toFixed(1)} ${(sag(t) + wob(i, 3) * 0.6).toFixed(1)}`;
  }).join(" ");
  return (
    <svg className="pointer-events-none absolute -top-2 left-0 h-12 w-full opacity-80" viewBox="0 0 1000 50" preserveAspectRatio="none" aria-hidden>
      <path d={line} stroke="var(--ink)" strokeWidth="1.2" fill="none" strokeOpacity="0.55" vectorEffect="non-scaling-stroke" />
      {items.map((f, i) => (
        <g key={i}>
          <path d={f.d} fill={f.color} fillOpacity="0.28" stroke="var(--ink)" strokeOpacity="0.55" strokeWidth="1" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          <path d={f.hatch} stroke={f.color} strokeWidth="1.4" strokeOpacity="0.8" fill="none" vectorEffect="non-scaling-stroke" />
        </g>
      ))}
    </svg>
  );
}
