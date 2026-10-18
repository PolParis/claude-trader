"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { EXP_COOKIE } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export async function login(_prev: string | null, form: FormData): Promise<string | null> {
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return "Email o contraseña incorrectos.";
  redirect("/");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function selectExperiment(code: string) {
  (await cookies()).set(EXP_COOKIE, code, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
}
