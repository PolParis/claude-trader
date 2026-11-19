"use server";

import { cookies } from "next/headers";
import { EXP_COOKIE } from "@/lib/data";

export async function selectExperiment(code: string) {
  (await cookies()).set(EXP_COOKIE, code, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
}
