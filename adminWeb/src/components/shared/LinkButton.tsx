import { Link, type LinkProps } from "react-router";
import type { VariantProps } from "class-variance-authority";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A link that looks like a button.
 *
 * Do NOT reach for `<Button render={<Link/>}>` instead: Base UI's Button
 * stamps role="button" onto the anchor, so assistive tech announces
 * navigation as an action and the element loses its link affordances
 * (open in new tab, copy address, "links" rotor).
 *
 * If it navigates, it is a link. If it acts, it is a Button.
 */
export function LinkButton({
  className,
  variant,
  size,
  ...props
}: LinkProps & VariantProps<typeof buttonVariants>) {
  return <Link className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
