import { useLocation, useNavigate } from "react-router";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { ArrowLeft, Compass } from "lucide-react";
import { DispatchRadar } from "@/components/notfound/DispatchRadar";
import { LinkButton } from "@/components/shared/LinkButton";
import { PageMeta } from "@/components/shared/PageMeta";
import { Button } from "@/components/ui/button";
import { landingPath, useSession } from "@/store/session";

/* The page assembles bottom-up rather than fading in as one block — the eye
   lands on the radar first and reads outward from it. */
const container: Variants = {
  hidden: {},
  shown: { transition: { delayChildren: 0.05, staggerChildren: 0.07 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 10 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.42, ease: "easeOut" } },
};

/**
 * The `*` route — every URL that matches no screen.
 *
 * Standalone rather than inside a shell: `*` is the lowest-ranked pattern
 * react-router has, so a splat nested in each of the three shells would give
 * three equally-specific candidates for `/nonsense` and the winner would come
 * down to declaration order. One top-level route is unambiguous, and it is
 * also the only version that works signed-OUT, where no shell exists to sit in.
 *
 * The way back is therefore a button rather than the sidebar, and it points at
 * whichever surface this session actually lives on — a vendor sent to `/` would
 * bounce off the staff guard and watch a second redirect happen.
 */
export default function NotFoundPage() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const signedIn = useSession((s) => s.signedIn);
  const superadmin = useSession((s) => s.superadmin);
  const portal = useSession((s) => s.portal);
  const reduceMotion = useReducedMotion();

  const home = signedIn
    ? {
        to: landingPath({ superadmin, portal }),
        label: superadmin
          ? "Back to companies"
          : portal
            ? "Back to tickets"
            : "Back to dashboard",
      }
    : { to: "/login", label: "Go to sign in" };

  return (
    <>
      <PageMeta
        title="Page not found"
        description="That address doesn't match any screen in the console."
      />

      <div className="relative grid min-h-svh place-items-center overflow-hidden bg-background px-6 py-12">
        {/* The sign-in panel's dot motif, carried across so a dead end still
            reads as our console — and behind a radar it reads as map grid. */}
        <div
          aria-hidden
          className="dot-grid dot-grid-fade pointer-events-none absolute inset-0"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-1/2 size-[34rem] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-500/8 blur-3xl"
        />

        <motion.main
          variants={container}
          initial={reduceMotion ? false : "hidden"}
          animate="shown"
          className="relative flex w-full max-w-125 flex-col items-center text-center"
        >
          <motion.div variants={item} className="flex items-center gap-2.5">
            <div className="grid size-8 place-items-center rounded-[8px] bg-brand-500 text-xs font-bold text-white">
              RG
            </div>
            <div className="text-sm font-semibold text-ink">
              Reliance GreenTech
              <span className="font-normal text-ink-3"> · Ops Console</span>
            </div>
          </motion.div>

          {/* The 0 is the radar. Sized in `em` so it holds the numerals'
              baseline at every step of the clamp, not just at one width. */}
          <motion.div
            variants={item}
            role="img"
            aria-label="Error 404"
            className="mt-9 flex items-center justify-center gap-[0.09em] font-mono text-[clamp(4.5rem,17vw,8.5rem)] leading-none font-semibold tracking-tighter"
          >
            <span className="bg-linear-135 from-brand-400 to-brand-600 bg-clip-text text-transparent">
              4
            </span>
            <DispatchRadar className="size-[0.82em] text-brand-500" />
            <span className="bg-linear-135 from-brand-400 to-brand-600 bg-clip-text text-transparent">
              4
            </span>
          </motion.div>

          <motion.h1
            variants={item}
            className="mt-7 text-[22px] leading-tight font-semibold tracking-tight text-ink"
          >
            Page not found
          </motion.h1>

          <motion.p
            variants={item}
            className="mt-2.5 text-sm leading-relaxed text-ink-2"
          >
            That address doesn&rsquo;t match any screen in the console. It may
            have moved, or the link may be wrong.
          </motion.p>

          {/* An ops tool should say WHICH url failed — half of these are a
              mistyped ticket id in a pasted link. */}
          <motion.div
            variants={item}
            className="mt-5 flex max-w-full items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2"
          >
            <Compass className="size-3.5 shrink-0 text-ink-3" aria-hidden />
            <code className="truncate font-mono text-xs text-ink-2">
              {pathname}
            </code>
          </motion.div>

          <motion.div
            variants={item}
            className="mt-8 flex flex-wrap items-center justify-center gap-2.5"
          >
            <LinkButton to={home.to} size="lg" replace>
              {home.label}
            </LinkButton>
            <Button
              variant="outline"
              size="lg"
              onClick={() => navigate(-1)}
              // History may start here — a pasted bad link opens in a fresh
              // tab with nothing behind it, and back would leave the app.
              disabled={window.history.length <= 1}
            >
              <ArrowLeft data-icon="inline-start" />
              Go back
            </Button>
          </motion.div>
        </motion.main>
      </div>
    </>
  );
}
