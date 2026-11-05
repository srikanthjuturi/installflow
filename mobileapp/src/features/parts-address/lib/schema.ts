import { z } from 'zod';

/**
 * The "Parts delivery address" form.
 *
 * Messages are i18n KEYS, not text — the screen runs `t()` while rendering so a
 * language switch rewords what is already showing. The server is the authority
 * (it also checks the pincode against the master); this is the faster message.
 */
export const LINE_MIN = 3;
export const LINE_MAX = 240;
export const CITY_MIN = 2;
export const CITY_MAX = 80;
export const LANDMARK_MAX = 120;

export const partsAddressSchema = z.object({
  line: z
    .string()
    .trim()
    .min(LINE_MIN, { error: 'partsAddress.errors.line' })
    .max(LINE_MAX, { error: 'partsAddress.errors.line' }),
  city: z
    .string()
    .trim()
    .min(CITY_MIN, { error: 'partsAddress.errors.city' })
    .max(CITY_MAX, { error: 'partsAddress.errors.city' }),
  pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/, { error: 'partsAddress.errors.pincode' }),
  landmark: z.string().trim().max(LANDMARK_MAX, { error: 'partsAddress.errors.landmark' }),
  // Ten digits, the +91 dial code is added by the screen. Blank = your own phone.
  contactPhone: z
    .string()
    .trim()
    .refine((v) => v === '' || /^[6-9][0-9]{9}$/.test(v), {
      error: 'partsAddress.errors.phone',
    }),
});

export type PartsAddressForm = z.infer<typeof partsAddressSchema>;

export type PartsAddressErrorKey =
  | 'partsAddress.errors.line'
  | 'partsAddress.errors.city'
  | 'partsAddress.errors.pincode'
  | 'partsAddress.errors.landmark'
  | 'partsAddress.errors.phone';

export type PartsAddressErrors = Partial<Record<keyof PartsAddressForm, PartsAddressErrorKey>>;

export const EMPTY_FORM: PartsAddressForm = {
  line: '',
  city: '',
  pincode: '',
  landmark: '',
  contactPhone: '',
};

/** Field → i18n key of the first problem with it. Empty object = valid. */
export function validatePartsAddress(form: PartsAddressForm): PartsAddressErrors {
  const result = partsAddressSchema.safeParse(form);
  if (result.success) return {};
  const errors: PartsAddressErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as keyof PartsAddressForm | undefined;
    if (field && !errors[field]) errors[field] = issue.message as PartsAddressErrorKey;
  }
  return errors;
}

export interface PartsAddressBody {
  line: string;
  city: string;
  pincode: string;
  landmark?: string;
  contactPhone?: string;
}

/** The PUT body: trimmed, optional fields omitted when blank, phone as E.164. */
export function toBody(form: PartsAddressForm): PartsAddressBody {
  const body: PartsAddressBody = {
    line: form.line.trim(),
    city: form.city.trim(),
    pincode: form.pincode.trim(),
  };
  const landmark = form.landmark.trim();
  if (landmark) body.landmark = landmark;
  const phone = form.contactPhone.trim();
  if (phone) body.contactPhone = `+91${phone}`;
  return body;
}

/** Digits only, at most `max` — what a numeric box holds as one types or pastes. */
export function digitsOnly(text: string, max: number): string {
  return text.replace(/\D/g, '').slice(0, max);
}
