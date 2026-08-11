/**
 * Copy text to the clipboard, reporting whether it worked.
 *
 * `navigator.clipboard` is unavailable on an insecure origin — which includes
 * the console served over plain http on a LAN address, exactly how it is
 * demoed. The `execCommand` path is deprecated and still the only thing that
 * works there, so it stays until the console is served over https.
 *
 * Never throws: the caller shows the text either way, so a failure degrades to
 * "select it yourself" rather than a dead button.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through — a denied permission is not a reason to give up.
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    // Off-screen rather than hidden: a `display:none` element cannot be
    // selected, so the copy would silently do nothing.
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
