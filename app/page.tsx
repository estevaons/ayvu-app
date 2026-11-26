"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Logo, Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";

export default function Home() {
  const { ready, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready) router.replace(user ? "/library/" : "/login/");
  }, [ready, user, router]);

  return (
    <div className="grid min-h-dvh place-items-center">
      <div className="flex flex-col items-center gap-5 text-muted">
        <Logo />
        <Spinner />
      </div>
    </div>
  );
}
