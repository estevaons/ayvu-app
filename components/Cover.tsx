"use client";

import { useState } from "react";
import { useCoverUrl } from "@/lib/books";
import { hueFrom } from "@/lib/format";

interface Props {
  title: string;
  author?: string | null;
  coverPath?: string | null;
  className?: string;
  size?: "sm" | "md" | "lg";
}

/** Book cover from the file, or a typographic cover generated from the title. */
export function Cover({ title, author, coverPath, className = "", size = "md" }: Props) {
  const url = useCoverUrl(coverPath);
  const [failed, setFailed] = useState(false);
  const hue = hueFrom(title);
  const showImage = url && !failed;

  return (
    <div
      className={`relative aspect-[2/3] overflow-hidden rounded-xl bg-elevated shadow-soft ring-1 ring-black/10 ${className}`}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="size-full object-cover" onError={() => setFailed(true)} loading="lazy" />
      ) : (
        <div
          className="flex size-full flex-col justify-between p-[9%]"
          style={{
            background: `linear-gradient(160deg, hsl(${hue} 32% 30%), hsl(${(hue + 40) % 360} 38% 16%))`,
          }}
        >
          <div className="h-px w-1/3 bg-white/40" />
          <p
            className={`font-serif leading-[1.05] text-white/95 ${
              size === "sm" ? "text-[11px]" : size === "lg" ? "text-2xl" : "text-[15px]"
            } line-clamp-5 break-words`}
          >
            {title}
          </p>
          {author && size !== "sm" ? (
            <p className="truncate text-[10px] uppercase tracking-[0.16em] text-white/60">{author}</p>
          ) : (
            <span />
          )}
        </div>
      )}
      {/* Spine highlight */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-[6%] bg-gradient-to-r from-black/25 to-transparent" />
    </div>
  );
}
