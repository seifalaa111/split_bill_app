import crypto from "crypto";
import { SESSION_CODE_LENGTH } from "@splitcheck/shared";
import { prisma } from "./prisma";

const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Excluded I, O, 0, 1 to avoid confusion

export function generateRandomCode(): string {
  const bytes = crypto.randomBytes(SESSION_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < SESSION_CODE_LENGTH; i++) {
    code += CHARSET[bytes[i] % CHARSET.length];
  }
  return code;
}

export async function generateUniqueSessionCode(): Promise<string> {
  const maxAttempts = 10;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = generateRandomCode();
    const existing = await prisma.session.findUnique({
      where: { sessionCode: code },
      select: { sessionId: true },
    });

    if (!existing) {
      return code;
    }
  }

  throw new Error(
    "Failed to generate unique session code after maximum attempts"
  );
}
