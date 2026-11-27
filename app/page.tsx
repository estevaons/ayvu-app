"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { SplashView } from "@/components/ui";
import { useAuth } from "@/lib/auth";

export default function Home() {
  const { ready, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready) router.replace(user ? "/library/" : "/login/");
  }, [ready, user, router]);

  return <SplashView />;
}
