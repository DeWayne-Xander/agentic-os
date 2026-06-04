import { Suspense } from "react";
import { readGoals } from "@/lib/vaultWriter";
import { recentNotes } from "@/lib/vault";
import OverviewClient from "@/components/OverviewClient";

export default async function HomePage() {
  // Fetch data server-side
  const [goals, notes] = await Promise.all([
    readGoals().catch(() => []),
    recentNotes(8).catch(() => []),
  ]);

  const recentCount = notes.length;
  const activeGoals = goals.filter(g => !g.done).length;
  const completedGoals = goals.filter(g => g.done).length;

  return (
    <div className="space-y-6">
      {/* Server-rendered shell — always visible */}
      <section className="rounded-[1.35rem] border surface-card p-4 sm:p-5" style={{ borderColor: "var(--line-soft)" }}>
        <div className="eyebrow mb-3">
          <span className="num">I.</span>
          <span className="line" />
          <span className="label">Mission Control</span>
        </div>
        <h1 className="page-title" style={{ fontSize: "clamp(2rem, 4.5vw, 3.4rem)" }}>Mission Control</h1>
        <p className="page-subtitle" style={{ maxWidth: "42rem" }}>
          5 agents · Phoenix, AZ (MST). The live workspace.
        </p>
        <div className="mt-4 status-meta flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="hand">{new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "America/Phoenix" })} MST</span>
          <span className="opacity-40">·</span>
          <span>Phoenix, AZ</span>
        </div>
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <span className="pill pill-info">5 agents online</span>
          <span className="pill pill-info">{activeGoals} active goals</span>
          <span className="pill pill-info">{recentCount} recent memories</span>
        </div>
      </section>

      <Divider />

      {/* Client-rendered interactive area */}
      <Suspense fallback={
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="rounded-2xl border surface-card p-4 animate-pulse h-40" style={{ borderColor: "var(--line-soft)" }} />
            ))}
          </div>
          <div className="h-64 rounded-2xl border surface-card p-4 animate-pulse" style={{ borderColor: "var(--line-soft)" }} />
        </div>
      }>
        <OverviewClient />
      </Suspense>
    </div>
  );
}

function Divider() {
  return (
    <div className="flex items-center gap-4 my-2" style={{ color: "var(--gold)", opacity: 0.4 }}>
      <div className="flex-1 h-px" style={{ background: "var(--line)" }} />
      <span className="text-xs">✦</span>
      <div className="flex-1 h-px" style={{ background: "var(--line)" }} />
    </div>
  );
}
