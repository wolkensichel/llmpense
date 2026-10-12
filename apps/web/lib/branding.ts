import { z } from "zod";

export interface Branding {
  name: string;
  address: string | null;
  footer: string | null;
  logoUrl: string | null;
  /** Default for client-facing statements: name the model on each line. */
  showModelNames: boolean;
}

/** Agency details for client-facing statements; the display name falls back to the org name. */
export function brandingOf(org: {
  name: string;
  brandName: string | null;
  brandAddress: string | null;
  brandFooter: string | null;
  brandLogoUrl: string | null;
  showModelNames?: boolean;
}): Branding {
  const clean = (v: string | null) => (v && v.trim() ? v.trim() : null);
  return {
    name: clean(org.brandName) ?? org.name,
    address: clean(org.brandAddress),
    footer: clean(org.brandFooter),
    logoUrl: clean(org.brandLogoUrl),
    showModelNames: org.showModelNames ?? true,
  };
}

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} is limited to ${max} characters.`)
    .transform((v) => (v === "" ? null : v));

export const brandingSchema = z.object({
  brandName: z.string().trim().min(1, "Enter the name clients should see.").max(120, "The name is limited to 120 characters."),
  brandAddress: optionalText(500, "The address"),
  brandFooter: optionalText(1000, "The footer"),
  showModelNames: z.boolean().default(true),
  brandLogoUrl: optionalText(2000, "The logo URL").refine((v) => v === null || /^https?:\/\/[^\s"'<>]+$/i.test(v), {
    message: "The logo URL must start with http:// or https://.",
  }),
});

export type BrandingInput = z.output<typeof brandingSchema>;
