"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Asks for the list again while a document is still being read.
 *
 * Reading happens in the background and takes seconds. Without this the chip
 * says "being read" until somebody reloads, which nothing on the screen tells
 * them to do. It draws nothing, and it stops as soon as the list it is drawn
 * beside holds no pending document, because it is then no longer rendered.
 */
export function PendingRefresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
