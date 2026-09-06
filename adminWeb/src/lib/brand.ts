/**
 * The PLATFORM brand — what the console calls itself before it knows whose
 * console it is.
 *
 * Every signed-in surface shows the active COMPANY instead (see
 * `hooks/useBrand.ts`). These two constants are only for the moments where no
 * company can be known: the login screen, the password-reset screen, the 404
 * page rendered signed-out, the boot splash and the tab title before the
 * session resolves, and the superadmin console — a superadmin belongs to no
 * company, so the platform is the honest answer there rather than a blank.
 *
 * They are read from the environment rather than written into the components
 * so that renaming the platform is one `.env` edit. `index.html` renders before
 * any of this loads, so its copy is the one place the name is still literal —
 * keep the two in step.
 */
export const BRAND_NAME = import.meta.env.VITE_BRAND_NAME || "Reliance GreenTech";

/**
 * The monogram tile beside the wordmark. A company's own mark comes from
 * `companies.code`, which the API derives from the name and then stores for
 * good (`api/app/core/company_code.py`) — so this is only the platform's.
 */
export const BRAND_MARK = import.meta.env.VITE_BRAND_MARK || "RG";
