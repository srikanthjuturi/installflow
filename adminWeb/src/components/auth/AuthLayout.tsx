import { motion } from "framer-motion";
import { BrandPanel } from "@/components/auth/BrandPanel";

/**
 * The split-screen every signed-out page sits in: brand on the left, the form
 * on the right.
 *
 * Extracted when `/forgot-password` became the second one. Two consumers is
 * usually a coincidence rather than a pattern (see the tier rule in
 * `AGENTS.md`), but the alternative here is two copies of a grid whose column
 * ratio and breakpoint have to agree — and the moment they stop agreeing, a
 * reset that started on the sign-in page visibly jumps.
 *
 * The entrance animation lives here rather than at the call site so the two
 * pages cannot fade in differently. Framer Motion honours
 * `prefers-reduced-motion` through the project's reduced-motion setup.
 */
export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh md:grid-cols-[1.05fr_0.95fr]">
      <BrandPanel />

      <div className="flex items-center justify-center bg-surface px-8 py-10">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="w-full max-w-90"
        >
          {children}
        </motion.div>
      </div>
    </div>
  );
}
