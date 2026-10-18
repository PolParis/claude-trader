// Crea el usuario que puede entrar en la web (los registros públicos están desactivados).
//   npm run create-user -- tu@email.com
import crypto from "node:crypto";
import { adminClient } from "./lib/db";

async function main() {
  const email = process.argv[2];
  if (!email?.includes("@")) throw new Error("Uso: npm run create-user -- tu@email.com");
  const password = process.argv[3] ?? crypto.randomBytes(12).toString("base64url");
  const db = adminClient();
  const { error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(error.message);
  console.log(`Usuario creado: ${email}\nContraseña: ${password}\nGuárdala en un gestor de contraseñas; no se vuelve a mostrar.`);
}

main().catch((e) => {
  console.error(`ERROR: ${(e as Error).message}`);
  process.exit(1);
});
