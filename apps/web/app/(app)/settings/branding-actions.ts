"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { orgs } from "@llmpense/db";
import { requireAdmin } from "@/lib/auth.ts";
import { brandingSchema } from "@/lib/branding.ts";
import { getDb } from "@/lib/db.ts";

export type BrandingState = { ok?: string; error?: string } | undefined;

export async function saveBranding(_prev: BrandingState, form: FormData): Promise<BrandingState> {
  const org = await requireAdmin();
  const parsed = brandingSchema.safeParse({
    brandName: form.get("brandName") ?? "",
    brandAddress: form.get("brandAddress") ?? "",
    brandFooter: form.get("brandFooter") ?? "",
    brandLogoUrl: form.get("brandLogoUrl") ?? "",
    showModelNames: form.get("showModelNames") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  await getDb().update(orgs).set(parsed.data).where(eq(orgs.id, org.id));
  revalidatePath("/", "layout");
  return { ok: "Branding saved. Client statements use it right away, closed ones included." };
}
