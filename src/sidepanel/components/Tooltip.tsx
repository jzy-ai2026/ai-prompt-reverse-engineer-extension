import type { ReactNode } from "react";

interface TooltipProps {
  content: string;
  children: ReactNode;
  side?: "top" | "bottom";
}

export function Tooltip({ content, children, side = "top" }: TooltipProps) {
  return (
    <span className="tooltip-wrap" data-side={side}>
      {children}
      <span className="tooltip-bubble" role="tooltip">
        {content}
      </span>
    </span>
  );
}
