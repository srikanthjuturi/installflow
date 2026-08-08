import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "./input";
import { cn } from "@/lib/utils";

/**
 * Password field with a show/hide toggle. Wraps the shared `Input` and owns the
 * `type`, so callers pass the usual input props (including RHF `register`) and
 * never set `type` themselves.
 */
function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type">) {
  const [show, setShow] = React.useState(false);
  return (
    <div className="relative">
      <Input
        {...props}
        type={show ? "text" : "password"}
        className={cn("pr-9", className)}
      />
      <button
        type="button"
        // Not a tab stop — it's an assist, not part of the form flow.
        tabIndex={-1}
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 grid w-9 place-items-center text-ink-3 transition-colors hover:text-ink-2"
      >
        {show ? (
          <EyeOff className="size-4" aria-hidden />
        ) : (
          <Eye className="size-4" aria-hidden />
        )}
      </button>
    </div>
  );
}

export { PasswordInput };
