import { cn } from "@/lib/utils";

/**
 * Expected vs detected serial.
 *
 * The traps here are optical — `VDC55QLED-2024` against `VDC55QLED-2O24`, a
 * letter O standing in for a zero. Tinting the whole string red is useless at
 * that scale, so every differing character is marked individually (weight,
 * underline and tint together, never tint alone) and named in words
 * underneath: "expected 0, detected O".
 */

/** True at each index where the two strings disagree. */
function diffMask(expected: string, detected: string): boolean[] {
  if (expected.length !== detected.length) return [];
  return detected.split("").map((char, i) => char !== expected[i]);
}

/** The AI reports an unreadable capture as a dash, not as a serial. */
function hasSerial(value: string) {
  return /[a-z0-9]/i.test(value);
}

/** Spells the difference out, because colour and weight are not readable aloud. */
function diffSummary(expected: string, detected: string, mask: boolean[]) {
  const positions = mask.flatMap((differs, i) => (differs ? [i] : []));
  if (positions.length === 0) return null;
  return positions
    .slice(0, 3)
    .map(
      (i) =>
        `position ${i + 1}: expected "${expected[i]}", detected "${detected[i]}"`
    )
    .join(" · ");
}

function SerialText({
  value,
  mask,
  className,
}: {
  value: string;
  mask: boolean[];
  className?: string;
}) {
  return (
    <span
      className={cn("font-mono text-xs font-semibold", className)}
      aria-hidden
    >
      {value.split("").map((char, i) =>
        mask[i] ? (
          <mark
            key={i}
            className="rounded-xs bg-danger-bg px-px text-danger underline decoration-2 underline-offset-2"
          >
            {char}
          </mark>
        ) : (
          <span key={i}>{char}</span>
        )
      )}
    </span>
  );
}

/**
 * The detected serial on its own, for a table cell. Screen readers get the
 * verdict as a sentence; sighted users get the marked characters.
 */
export function DetectedSerial({
  expected,
  detected,
}: {
  expected: string;
  detected: string;
}) {
  if (!hasSerial(detected)) {
    return (
      <span className="font-mono text-xs text-ink-3">
        <span aria-hidden>{detected}</span>
        <span className="sr-only">No serial could be read</span>
      </span>
    );
  }

  const mask = diffMask(expected, detected);
  const matches = detected === expected;

  return (
    <>
      <span className="sr-only">
        {matches
          ? `Detected ${detected}, matches the expected serial`
          : `Detected ${detected}, does not match the expected serial ${expected}`}
      </span>
      <SerialText
        value={detected}
        mask={mask}
        className={matches ? undefined : "text-danger"}
      />
    </>
  );
}

/**
 * The detail screen's comparison block: expected, detected and the reason the
 * verification was flagged.
 */
export function SerialCompare({
  expected,
  detected,
  flag,
}: {
  expected: string;
  detected: string;
  flag: string;
}) {
  const readable = hasSerial(detected);
  const mask = readable ? diffMask(expected, detected) : [];
  const matches = readable && detected === expected;
  const summary = readable ? diffSummary(expected, detected, mask) : null;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3 rounded-md bg-surface-2 px-3 py-2.5">
        <span className="text-xs text-ink-2">Expected serial</span>
        <span className="text-right">
          <span className="sr-only">{expected}</span>
          <SerialText value={expected} mask={mask} />
        </span>
      </div>

      <div
        className={cn(
          "flex items-center justify-between gap-3 rounded-md px-3 py-2.5",
          matches ? "bg-ok-bg" : "bg-danger-bg"
        )}
      >
        <span className="text-xs text-ink-2">Detected serial</span>
        <span className="text-right">
          <DetectedSerial expected={expected} detected={detected} />
        </span>
      </div>

      {summary ? (
        <p className="px-3 text-[11px] text-ink-2">{summary}</p>
      ) : null}

      <div className="flex items-center justify-between gap-3 rounded-md bg-surface-2 px-3 py-2.5">
        <span className="text-xs text-ink-2">Flag reason</span>
        <span className="text-xs font-semibold text-danger">{flag}</span>
      </div>
    </div>
  );
}
