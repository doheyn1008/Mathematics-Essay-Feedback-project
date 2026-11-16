"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";

export function AdminCenterLink() {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const request = new AbortController();

    async function checkAccess() {
      try {
        const response = await fetch("/api/admin/access", {
          credentials: "same-origin",
          cache: "no-store",
          signal: request.signal,
        });
        if (response.status !== 200) return;

        const access = await response.json();
        if (request.signal.aborted || !access || typeof access !== "object") return;
        if ("allowed" in access && access.allowed === true) setAllowed(true);
      } catch {
        // Keep the link hidden when the server cannot confirm admin access.
      }
    }

    void checkAccess();
    return () => request.abort();
  }, []);

  if (!allowed) return null;

  return (
    <a className="button secondary small" href="/admin">
      <ShieldCheck size={14} aria-hidden="true" />
      관리자 센터
    </a>
  );
}
