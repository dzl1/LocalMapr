"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 52);
}

export async function createMapApp(formData: FormData) {
  const supabase = await createServerSupabaseClient();

  if (!supabase) {
    redirect("/dashboard?error=supabase-not-configured");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard");
  }

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const appType = String(formData.get("app_type") ?? "map_tour");

  if (!title) {
    redirect("/dashboard?error=title-required");
  }

  const slug = `${slugify(title)}-${crypto.randomUUID().slice(0, 8)}`;
  const { error } = await supabase.from("map_apps").insert({
    app_type: appType,
    description: description || null,
    owner_id: user.id,
    slug,
    title,
  });

  if (error) {
    redirect(`/dashboard?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/dashboard");
  redirect("/dashboard?created=1");
}

export async function signOut() {
  const supabase = await createServerSupabaseClient();

  if (supabase) {
    await supabase.auth.signOut();
  }

  redirect("/");
}
