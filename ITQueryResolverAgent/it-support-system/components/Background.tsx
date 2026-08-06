type Variant = "home" | "history";

/**
 * Full-viewport decorative backdrop. Each variant uses a different SVG motif
 * so the two pages feel distinct while staying in the same glass/cyan system.
 */
export default function Background({ variant }: { variant: Variant }) {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {variant === "home" ? <CircuitLayer /> : <NetworkLayer />}
    </div>
  );
}

/** Home: a drifting motherboard / circuit-trace motif. */
function CircuitLayer() {
  return (
    <>
      <svg
        className="absolute inset-0 h-full w-full opacity-[0.14] animate-drift-slow"
        preserveAspectRatio="xMidYMid slice"
        viewBox="0 0 800 800"
        fill="none"
      >
        <defs>
          <pattern id="circuit" width="160" height="160" patternUnits="userSpaceOnUse">
            <path
              d="M0 80h40v-40h40v80h40v-40h40M0 80H160M80 0v160"
              stroke="#22d3ee"
              strokeWidth="1"
              fill="none"
            />
            <circle cx="80" cy="80" r="3" fill="#22d3ee" />
            <circle cx="40" cy="40" r="2.5" fill="#22d3ee" />
            <circle cx="120" cy="120" r="2.5" fill="#22d3ee" />
          </pattern>
        </defs>
        <rect width="800" height="800" fill="url(#circuit)" />
      </svg>

      <div className="absolute -top-40 left-1/4 h-[32rem] w-[32rem] rounded-full bg-accent-600/20 blur-[120px] animate-pulse-slow" />
      <div className="absolute top-1/3 -right-32 h-[28rem] w-[28rem] rounded-full bg-accent-400/10 blur-[120px] animate-pulse-slower" />
      <div className="absolute bottom-0 left-0 h-[24rem] w-[24rem] rounded-full bg-emerald-500/[0.06] blur-[110px]" />

      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(2,6,12,0.25)_85%)]" />
    </>
  );
}

/** History: a node-link "network map" motif with a scanning sweep. */
function NetworkLayer() {
  const nodes = [
    [60, 120], [220, 60], [380, 160], [540, 80], [700, 140],
    [120, 320], [300, 280], [480, 340], [640, 300], [760, 400],
    [80, 520], [260, 560], [440, 500], [600, 560], [740, 620],
  ];
  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 4], [1, 6], [2, 6], [3, 7], [4, 8],
    [5, 6], [6, 7], [7, 8], [8, 9], [5, 10], [6, 11], [7, 12], [8, 13],
    [9, 13], [10, 11], [11, 12], [12, 13], [13, 14],
  ];

  return (
    <>
      <svg
        className="absolute inset-0 h-full w-full opacity-[0.16] animate-drift-slow-reverse"
        preserveAspectRatio="xMidYMid slice"
        viewBox="0 0 800 700"
        fill="none"
      >
        {edges.map(([a, b], i) => (
          <line
            key={i}
            x1={nodes[a][0]} y1={nodes[a][1]}
            x2={nodes[b][0]} y2={nodes[b][1]}
            stroke="#22d3ee"
            strokeWidth="1"
          />
        ))}
        {nodes.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i % 4 === 0 ? 4 : 2.5} fill="#22d3ee" />
        ))}
      </svg>

      <div className="absolute inset-x-0 top-0 h-1/2 animate-scan bg-gradient-to-b from-accent-400/10 to-transparent" />

      <div className="absolute top-0 right-1/4 h-[26rem] w-[26rem] rounded-full bg-accent-500/[0.14] blur-[130px] animate-pulse-slower" />
      <div className="absolute bottom-0 left-1/3 h-[30rem] w-[30rem] rounded-full bg-sky-500/[0.08] blur-[130px] animate-pulse-slow" />

      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(2,6,12,0.25)_85%)]" />
    </>
  );
}
