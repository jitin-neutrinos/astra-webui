import { cn } from "@/lib/utils";

// Skeleton primitive (shadcn/Skeleton DNA, registry item "Skeleton" —
// https://21st.dev/@shadcn/components/skeleton) retinted to Astra tokens.
// The shimmer sweep lives in index.css (.ast-sk) so both themes + reduced-motion
// are handled in one place. `grey` opts out of the cyan sweep (sidebar lists).
function Skeleton({ className, grey, ...props }: React.HTMLAttributes<HTMLDivElement> & { grey?: boolean }) {
  return <div aria-hidden="true" className={cn("ast-sk", grey && "ast-sk-grey", className)} {...props} />;
}

export { Skeleton };
