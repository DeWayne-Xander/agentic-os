"use client";

import { useEffect, useState } from "react";

interface Props {
  agent: string;
  apiPath: string;
}

/** Shape matching ApprovalModal's expected request prop */
interface ApprovalReq {
  run_id: string;
  reason: string;
  agent: string;
  args: string[];
  cwd: string;
}

/**
 * Thin connector: polls /api/approval/pending and renders ApprovalModal.
 * Stays mounted per page — the heavy work (stream lifecycle) is in context.
 */
export function ApprovalGate({ agent }: Props) {
  const [pending, setPending] = useState<ApprovalReq | null>(null);
  const [queue, setQueue] = useState<ApprovalReq[]>([]);

  // Dynamically import ApprovalModal to avoid SSR issues with framer-motion
  const [Modal, setModal] = useState<React.ComponentType<{
    request: ApprovalReq | null;
    onResolve: (runId: string, approved: boolean, mode: string) => void;
  }> | null>(null);

  useEffect(() => {
    import("./ApprovalModal").then((mod) => setModal(() => mod.default));
  }, []);

  // Poll for pending approvals relevant to this agent
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch("/api/approval/pending");
        if (!r.ok) return;
        const list: ApprovalReq[] = await r.json();
        if (!alive) return;
        const relevant = list.filter(
          (req) => !req.agent || req.agent === agent || agent === "chrono"
        );
        if (relevant.length > 0) {
          setQueue(relevant);
          setPending((prev) => prev ?? relevant[0]);
        }
      } catch {
        /* transient */
      }
    };
    poll();
    const iv = setInterval(poll, 1500);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [agent]);

  const handleResolve = async (runId: string, approved: boolean, mode: string) => {
    await fetch("/api/approval/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId, approved, mode }),
    });
    const rest = queue.slice(1);
    setQueue(rest);
    setPending(rest[0] ?? null);
  };

  if (!pending || !Modal) return null;

  return (
    <Modal
      request={pending}
      onResolve={handleResolve}
    />
  );
}
