import { cn } from "cn"

// A loading placeholder: a muted block with a light sweeping across (.shimmer).
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("shimmer rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }
