import { cn } from "@/lib/utils";

// Skeleton primitive (shadcn/Skeleton DNA, registry item "Skeleton" —
// https://21st.dev/@shadcn/components/skeleton) retinted to Astra tokens.
// The shimmer sweep lives in index.css (.ast-sk) so both themes + reduced-motion
// are handled in one place.
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("ast-sk", className)} {...props} />;
}

export { Skeleton };
