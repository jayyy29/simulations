import React, { useEffect, useRef, useState, useMemo } from "react";

// -------------------- Utility: Seeded RNG for stable nucleus layouts per element --------------------
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i), (h |= 0);
  return Math.abs(h);
}

// -------------------- Data: Elements H to Ca (Z=1..20) with common isotope neutron counts --------------------
const ELEMENTS = [
  { Z: 1, symbol: "H", name: "Hydrogen", neutrons: 0 }, // H-1
  { Z: 2, symbol: "He", name: "Helium", neutrons: 2 }, // He-4
  { Z: 3, symbol: "Li", name: "Lithium", neutrons: 4 }, // Li-7
  { Z: 4, symbol: "Be", name: "Beryllium", neutrons: 5 }, // Be-9
  { Z: 5, symbol: "B", name: "Boron", neutrons: 6 }, // B-11
  { Z: 6, symbol: "C", name: "Carbon", neutrons: 6 }, // C-12
  { Z: 7, symbol: "N", name: "Nitrogen", neutrons: 7 }, // N-14
  { Z: 8, symbol: "O", name: "Oxygen", neutrons: 8 }, // O-16
  { Z: 9, symbol: "F", name: "Fluorine", neutrons: 10 }, // F-19
  { Z: 10, symbol: "Ne", name: "Neon", neutrons: 10 }, // Ne-20
  { Z: 11, symbol: "Na", name: "Sodium", neutrons: 12 }, // Na-23
  { Z: 12, symbol: "Mg", name: "Magnesium", neutrons: 12 }, // Mg-24
  { Z: 13, symbol: "Al", name: "Aluminium", neutrons: 14 }, // Al-27
  { Z: 14, symbol: "Si", name: "Silicon", neutrons: 14 }, // Si-28
  { Z: 15, symbol: "P", name: "Phosphorus", neutrons: 16 }, // P-31
  { Z: 16, symbol: "S", name: "Sulfur", neutrons: 16 }, // S-32
  { Z: 17, symbol: "Cl", name: "Chlorine", neutrons: 18 }, // Cl-35
  { Z: 18, symbol: "Ar", name: "Argon", neutrons: 22 }, // Ar-40
  { Z: 19, symbol: "K", name: "Potassium", neutrons: 20 }, // K-39
  { Z: 20, symbol: "Ca", name: "Calcium", neutrons: 20 }, // Ca-40
];

const massNumber = (el) => el.Z + el.neutrons; // A ≈ Z + N

// Electron shells up to 20e− using the simple 2-8-8-2 pattern
function shellsForZ(Z) {
  const pattern = [2, 8, 8, 2];
  const shells = [];
  let remaining = Z;
  for (let cap of pattern) {
    if (remaining <= 0) break;
    const take = Math.min(cap, remaining);
    shells.push(take);
    remaining -= take;
  }
  return shells; // e.g., Ca (20) => [2,8,8,2]
}

// -------------------- Geometry helpers --------------------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function dist2(a, b) {
  const dx = a.x - b.x,
    dy = a.y - b.y;
  return dx * dx + dy * dy;
}
function len(v) {
  return Math.hypot(v.x, v.y);
}
function norm(v) {
  const l = len(v) || 1;
  return { x: v.x / l, y: v.y / l };
}

// -------------------- Simulation component --------------------
export default function AtomicScatteringSimulator() {
  const canvasRef = useRef(null);
  // Wider canvas by default
  const [width, setWidth] = useState(1100);
  const [height, setHeight] = useState(680);

  const [selected, setSelected] = useState(ELEMENTS[0]); // default Hydrogen
  const [projectileType, setProjectileType] = useState("positive"); // 'positive' | 'negative' | 'neutral'
  const [aimY, setAimY] = useState(340); // aim follows mouse
  const [paused, setPaused] = useState(false);
  const [showTrails, setShowTrails] = useState(true);

  // Projectiles (support many at once for continuous fire)
  const projectilesRef = useRef([]);
  const emitterRef = useRef(null);

  // Derived atomic counts
  const relativeMass = massNumber(selected);
  const protons = selected.Z;
  const electrons = selected.Z;
  const neutrons = selected.neutrons;

  // Canvas center (more room on the right now)
  const cx = width * 0.70;
  const cy = height * 0.5;

  // Nucleus and shells geometry
  const nucleonRadius = 10; // protons & neutrons
  const electronRadius = 3; // much smaller
  const nucleusVisualRadius = useMemo(() => {
    // Scale nucleus radius gently by nucleon count (visual only)
    const total = protons + neutrons;
    return clamp(18 + total * 0.45, 22, 95);
  }, [protons, neutrons]);

  const electronShells = useMemo(() => shellsForZ(electrons), [electrons]);
  const shellRadii = useMemo(() => {
    const base = nucleusVisualRadius + 46; // first shell outside nucleus
    const step = 56; // distance between shells (more spaced)
    return electronShells.map((_, i) => base + i * step);
  }, [electronShells, nucleusVisualRadius]);

  // Seeded RNG for consistent nucleus packing
  const rng = useMemo(() => mulberry32(hashCode(selected.symbol)), [selected.symbol]);

  // Build nucleus layout: place total nucleons on concentric rings; randomly tag protons vs neutrons
  const nucleusLayout = useMemo(() => {
    const total = protons + neutrons;
    const types = Array.from({ length: total }, (_, i) => (i < protons ? "p" : "n"));
    // shuffle using seeded rng
    for (let i = types.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [types[i], types[j]] = [types[j], types[i]];
    }

    // ring capacities grow (approximate hex packing)
    const caps = [6, 12, 18, 24, 30, 36, 42];
    const rings = [];
    let remaining = total,
      ringIndex = 0;
    while (remaining > 0) {
      const take = Math.min(caps[ringIndex] || 42, remaining);
      const radius = (nucleusVisualRadius - nucleonRadius - 2) * ((ringIndex + 1) / Math.max(1, Math.ceil(total / 6)));
      rings.push({ count: take, r: Math.max(6, radius) });
      ringIndex++;
      remaining -= take;
    }

    // Generate positions evenly spaced on rings
    const positions = [];
    let tIndex = 0;
    for (let rI = 0; rI < rings.length; rI++) {
      const { count, r } = rings[rI];
      for (let k = 0; k < count; k++) {
        const angle = (2 * Math.PI * k) / count + rng() * 0.2; // small jitter
        positions.push({
          type: types[tIndex++],
          x: cx + Math.cos(angle) * r,
          y: cy + Math.sin(angle) * r,
        });
      }
    }
    return positions;
  }, [protons, neutrons, rng, cx, cy, nucleusVisualRadius]);

  // Build electrons with angular positions & speeds per shell
  const electronsState = useRef([]);
  useEffect(() => {
    const newElectrons = [];
    electronShells.forEach((count, sIdx) => {
      const r = shellRadii[sIdx];
      const baseSpeed = 0.004 + sIdx * 0.0015; // visual variety
      for (let i = 0; i < count; i++) {
        newElectrons.push({
          shell: sIdx,
          angle: (2 * Math.PI * i) / count + rng() * 0.5,
          speed: baseSpeed * (0.8 + rng() * 0.4),
          r,
        });
      }
    });
    electronsState.current = newElectrons;
  }, [electronShells, shellRadii, rng]);

  // Projectile helpers
  function spawnProjectile(yOverride = null) {
    const startX = 30;
    const startY = clamp(yOverride ?? aimY, 10, height - 10);
    const speed = 2.2; // px per frame
    const vx = speed; // toward the right
    const vy = 0;
    const p = {
      x: startX,
      y: startY,
      vx,
      vy,
      type: projectileType, // 'positive' | 'negative' | 'neutral'
      alive: true,
      trail: [{ x: startX, y: startY }],
    };
    projectilesRef.current.push(p);
    // keep memory bounded
    if (projectilesRef.current.length > 600) {
      projectilesRef.current.splice(0, projectilesRef.current.length - 600);
    }
  }

  function fireProjectile() {
    spawnProjectile();
  }

  // Handle canvas DPR scaling
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, [width, height]);

  // Main animation loop
  useEffect(() => {
    let raf = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const draw = () => {
      // Clear
      ctx.clearRect(0, 0, width, height);

      // Background
      ctx.fillStyle = "#0b1220"; // deep navy
      ctx.fillRect(0, 0, width, height);

      // Draw aim line
      ctx.strokeStyle = "#23324d";
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(0, aimY);
      ctx.lineTo(width, aimY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Orbit paths
      ctx.strokeStyle = "#2d4a7a";
      ctx.lineWidth = 1;
      shellRadii.forEach((r) => {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      });

      // Update electron angles (if not paused)
      if (!paused) {
        electronsState.current.forEach((e) => (e.angle += e.speed));
      }

      // Draw electrons
      electronsState.current.forEach((e) => {
        const ex = cx + Math.cos(e.angle) * e.r;
        const ey = cy + Math.sin(e.angle) * e.r;
        ctx.fillStyle = "#7cc7ff";
        ctx.beginPath();
        ctx.arc(ex, ey, electronRadius, 0, Math.PI * 2);
        ctx.fill();
        // label '-'
        ctx.fillStyle = "#001b2e";
        ctx.font = "11px ui-sans-serif, system-ui, -apple-system";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("-", ex, ey + 0.5);
      });

      // Nucleus glow
      const gradient = ctx.createRadialGradient(
        cx,
        cy,
        nucleusVisualRadius * 0.1,
        cx,
        cy,
        nucleusVisualRadius + 16
      );
      gradient.addColorStop(0, "rgba(255,255,255,0.05)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cx, cy, nucleusVisualRadius + 16, 0, Math.PI * 2);
      ctx.fill();

      // Nucleons (protons and neutrons)
      nucleusLayout.forEach((n) => {
        ctx.beginPath();
        ctx.fillStyle = n.type === "p" ? "#ff6b57" : "#c7cbd4";
        ctx.arc(n.x, n.y, nucleonRadius, 0, Math.PI * 2);
        ctx.fill();
        if (n.type === "p") {
          ctx.fillStyle = "#2b0b0b";
          ctx.font = "13px ui-sans-serif, system-ui, -apple-system";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("+", n.x, n.y + 0.5);
        }
      });

      // Projectiles: physics & drawing
      for (let i = 0; i < projectilesRef.current.length; i++) {
        const proj = projectilesRef.current[i];
        if (!proj.alive) continue;

        if (!paused) {
          const interactionRadius =
            proj.type === "positive"
              ? nucleonRadius + 8
              : proj.type === "negative"
              ? electronRadius + 8
              : 0;

          if (proj.type === "positive") {
            // Repelled by protons only
            for (let j = 0; j < nucleusLayout.length; j++) {
              const n = nucleusLayout[j];
              if (n.type !== "p") continue;
              const d2 = dist2({ x: proj.x, y: proj.y }, n);
              const thresh = interactionRadius * interactionRadius;
              if (d2 < thresh) {
                const away = norm({ x: proj.x - n.x, y: proj.y - n.y });
                const strength = 0.9;
                proj.vx += away.x * strength;
                proj.vy += away.y * strength;
              }
            }
          } else if (proj.type === "negative") {
            // Repelled by electrons only (use their current positions)
            for (let j = 0; j < electronsState.current.length; j++) {
              const e = electronsState.current[j];
              const ex = cx + Math.cos(e.angle) * e.r;
              const ey = cy + Math.sin(e.angle) * e.r;
              const d2 = (proj.x - ex) * (proj.x - ex) + (proj.y - ey) * (proj.y - ey);
              const thresh = interactionRadius * interactionRadius;
              if (d2 < thresh) {
                const away = norm({ x: proj.x - ex, y: proj.y - ey });
                const strength = 0.7;
                proj.vx += away.x * strength;
                proj.vy += away.y * strength;
              }
            }
          }

          // Advance projectile
          proj.x += proj.vx;
          proj.y += proj.vy;

          // Record trail (cap trail length)
          const t = proj.trail;
          const last = t[t.length - 1];
          if (!last || Math.hypot(proj.x - last.x, proj.y - last.y) > 2) {
            t.push({ x: proj.x, y: proj.y });
            if (t.length > 160) t.shift();
          }

          // End conditions
          if (proj.x > width + 40 || proj.x < -40 || proj.y < -40 || proj.y > height + 40) {
            proj.alive = false;
          }
        }

        // Draw trail
        if (showTrails && proj.trail.length > 1) {
          const color =
            proj.type === "positive" ? "#ffb3a9" : proj.type === "negative" ? "#a9d6ff" : "#c9c9c9";
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          for (let k = 0; k < proj.trail.length; k++) {
            const p = proj.trail[k];
            if (k === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          }
          ctx.stroke();
        }

        // Draw projectile itself
        ctx.fillStyle = proj.type === "positive" ? "#ff8a75" : proj.type === "negative" ? "#6bb7ff" : "#d8d8d8";
        ctx.beginPath();
        ctx.arc(proj.x, proj.y, 5, 0, Math.PI * 2);
        ctx.fill();
        // label + / - / 0
        ctx.fillStyle = "#0b1220";
        ctx.font = "12px ui-sans-serif, system-ui, -apple-system";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(proj.type === "positive" ? "+" : proj.type === "negative" ? "-" : "0", proj.x, proj.y + 0.5);
      }

      // HUD: element info (roomier)
      ctx.fillStyle = "#cfe6ff";
      ctx.font = "15px ui-sans-serif, system-ui, -apple-system";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      const lines = [
        `${selected.name} (${selected.symbol})`,
        `Protons = ${protons}   Neutrons = ${neutrons}   Electrons = ${electrons}`,
        `Relative mass = ${relativeMass}`,
        `Electron configuration: ${electronShells.join(", ")}`,
        `Click anywhere on the canvas to fire a single projectile. Hover to auto-fire.`,
        "",
        `Legend: protons = red '+', neutrons = grey, electrons = blue '-'.`,
        `Simulation NOT to scale.`,
      ];
      lines.forEach((t, i) => ctx.fillText(t, 16, 18 + i * 20));

      // Next frame
      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, height, cx, cy, paused, aimY, electronShells, nucleusLayout, nucleusVisualRadius, showTrails, selected, protons, neutrons, electrons, shellRadii]);

  // Hover-based continuous fire
  const handleMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    setAimY(y);
  };
  const handleMouseEnter = () => {
    if (emitterRef.current) return;
    emitterRef.current = setInterval(() => spawnProjectile(), 100); // ~10/s
  };
  const handleMouseLeave = () => {
    if (emitterRef.current) {
      clearInterval(emitterRef.current);
      emitterRef.current = null;
    }
  };

  // Click-to-aim fallback
  function handleCanvasClick(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    setAimY(y);
    spawnProjectile(y);
  }

  // Compact Periodic Table (no gaps) with mass number in tile
  function PeriodicCompact() {
    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-slate-100 font-semibold">Elements</h3>
        </div>
        <div className="grid grid-cols-5 gap-2 pr-1">
          {ELEMENTS.map((el) => (
            <button
              key={el.symbol}
              onClick={() => setSelected(el)}
              className={`relative h-16 w-16 rounded-xl border transition ${
                selected.symbol === el.symbol
                  ? "border-sky-400 bg-sky-400/10 ring-2 ring-sky-400"
                  : "border-slate-600 hover:border-sky-300 hover:bg-sky-300/10"
              } flex items-center justify-center`}
              title={`${el.name}  (Z=${el.Z}, A≈${massNumber(el)})`}
            >
              <div className="absolute top-1 inset-x-0 text-center text-[10px] text-slate-300/90">{el.Z}</div>
              <div className="absolute bottom-1 inset-x-0 text-center text-[10px] text-slate-300/90">{massNumber(el)}</div>
              <div className="text-lg font-semibold text-slate-100">{el.symbol}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full min-h-[680px] bg-slate-900 text-slate-100 flex">
      {/* Sidebar */}
      <aside className="w-[420px] p-5 border-r border-slate-700/60 space-y-5 overflow-auto">
        <div>
          <h2 className="text-2xl font-bold">Atomic Scattering Simulator</h2>
          <p className="text-sm text-slate-300 mt-1">Visualise atoms of the first 20 elements (H to Ca) with simple Rutherford-style deflection.</p>
        </div>

        <PeriodicCompact />

        <div className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/60">
          <div className="text-sm text-slate-300">Selected element</div>
          <div className="flex items-center gap-3 mt-1">
            <div className="text-3xl font-semibold">{selected.symbol}</div>
            <div className="text-slate-400">{selected.name}</div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3 text-sm">
            <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-700/60 text-center">
  <div className="text-base font-semibold text-slate-100">Protons = {protons}</div>
</div>
            <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-700/60 text-center">
  <div className="text-base font-semibold text-slate-100">Neutrons = {neutrons}</div>
</div>
            <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-700/60 text-center">
  <div className="text-base font-semibold text-slate-100">Relative mass = {massNumber(selected)}</div>
</div>
          </div>
          <div className="mt-2 text-base text-slate-100">Electrons = {electrons}</div>
<div className="text-xs text-slate-200">Electronic configuration: {shellsForZ(electrons).join(", ")}</div>
        </div>

        <div className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/60 space-y-3">
          <div className="text-sm font-semibold">Projectile</div>
          <div className="flex flex-wrap gap-2">
            <label className={`px-3 py-2 rounded-lg border cursor-pointer ${
              projectileType === "positive" ? "border-sky-400 bg-sky-400/10" : "border-slate-600"
            }`}>
              <input type="radio" name="proj" className="hidden" checked={projectileType === "positive"} onChange={() => setProjectileType("positive")} />
              <span className="font-medium">Positive (+)</span>
            </label>
            <label className={`px-3 py-2 rounded-lg border cursor-pointer ${
              projectileType === "negative" ? "border-sky-400 bg-sky-400/10" : "border-slate-600"
            }`}>
              <input type="radio" name="proj" className="hidden" checked={projectileType === "negative"} onChange={() => setProjectileType("negative")} />
              <span className="font-medium">Negative (-)</span>
            </label>
            <label className={`px-3 py-2 rounded-lg border cursor-pointer ${
              projectileType === "neutral" ? "border-sky-400 bg-sky-400/10" : "border-slate-600"
            }`}>
              <input type="radio" name="proj" className="hidden" checked={projectileType === "neutral"} onChange={() => setProjectileType("neutral")} />
              <span className="font-medium">Neutral (0)</span>
            </label>
          </div>
         
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button onClick={fireProjectile} className="px-3 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-900 font-semibold">Fire once</button>
            <button onClick={() => (projectilesRef.current = [])} className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600">Clear projectiles</button>
          </div>
          <div className="mt-2 flex items-center justify-between text-sm">
            <label className="flex items-center gap-2">
              <input id="pause" type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
              <span>Pause</span>
            </label>
            <label className="flex items-center gap-2">
              <input id="trails" type="checkbox" checked={showTrails} onChange={(e) => setShowTrails(e.target.checked)} />
              <span>Show trails</span>
            </label>
          </div>
        </div>

      </aside>

      {/* Main Canvas Stage */}
      <main className="flex-1 relative">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          onClick={handleCanvasClick}
          onMouseMove={handleMouseMove}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          className="w-full h-full block cursor-crosshair"
          style={{ maxHeight: "820px" }}
        />
      </main>
        
    </div>
  );
}
