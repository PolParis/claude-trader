// Llamada a `claude -p` (suscripción del usuario, sin API de pago).
// Aislamiento: sin herramientas (--tools ""), sin MCP (--strict-mcp-config), sin
// personalizaciones (--safe-mode) y desde una carpeta temporal vacía.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function claudeBin(): string {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  if (process.platform === "win32") {
    const exe = path.join(process.env.APPDATA ?? "", "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
    if (fs.existsSync(exe)) return exe;
  }
  return "claude";
}

export interface ClaudeCallResult {
  ok: boolean;
  envelope: Record<string, unknown> | null; // JSON completo devuelto por la CLI
  output: unknown; // structured_output o texto de result
  error?: string;
  durationMs: number;
}

export async function callClaude(args: {
  prompt: string;
  systemPrompt: string;
  jsonSchema: string;
  model: string;
  timeoutMs?: number;
}): Promise<ClaudeCallResult> {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "claude-trader-"));
  const t0 = Date.now();
  const cliArgs = [
    "-p",
    "--output-format", "json",
    "--model", args.model,
    "--tools", "",
    "--strict-mcp-config",
    "--safe-mode",
    "--no-session-persistence",
    "--system-prompt", args.systemPrompt,
    "--json-schema", args.jsonSchema,
  ];
  return new Promise((resolve) => {
    const child = spawn(claudeBin(), cliArgs, { cwd, env: { ...process.env }, windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), args.timeoutMs ?? 6 * 60_000);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, envelope: null, output: null, error: `No se pudo lanzar claude: ${e.message}`, durationMs: Date.now() - t0 });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      fs.rmSync(cwd, { recursive: true, force: true });
      const durationMs = Date.now() - t0;
      let envelope: Record<string, unknown> | null = null;
      try {
        envelope = JSON.parse(stdout.trim());
      } catch {
        // la salida no es JSON (p. ej. error de autenticación)
      }
      if (!envelope) {
        resolve({ ok: false, envelope: null, output: null, error: `claude terminó con código ${code}: ${(stderr || stdout).slice(0, 1000)}`, durationMs });
        return;
      }
      if (envelope.is_error || envelope.subtype !== "success") {
        const msg = String(envelope.result ?? envelope.subtype ?? "error desconocido");
        resolve({ ok: false, envelope, output: null, error: `claude devolvió error: ${msg.slice(0, 1000)}`, durationMs });
        return;
      }
      resolve({ ok: true, envelope, output: envelope.structured_output ?? envelope.result, durationMs });
    });
    child.stdin.write(args.prompt);
    child.stdin.end();
  });
}
