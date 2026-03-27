import { prisma } from "../lib/prisma";
import { serializeParticipant } from "../lib/serializers";
import { VALIDATION, SessionStatus, ParticipantRole, AVATAR_COLORS } from "@splitcheck/shared";
import { ValidationError, NotFoundError } from "./session-service";

interface JoinSessionInput {
  displayName: string;
}

function pickAvatarColor(usedColors: string[]): string {
  const available = AVATAR_COLORS.filter((c) => !usedColors.includes(c));
  if (available.length === 0) {
    // All colors taken — pick random from full palette
    return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  }
  return available[Math.floor(Math.random() * available.length)];
}

export async function joinSession(sessionId: string, input: JoinSessionInput) {
  const displayName = input.displayName.trim();

  if (!displayName || displayName.length < VALIDATION.displayName.minLength) {
    throw new ValidationError("Display name is required");
  }
  if (displayName.length > VALIDATION.displayName.maxLength) {
    throw new ValidationError(
      `Display name must be ${VALIDATION.displayName.maxLength} characters or less`
    );
  }

  const session = await prisma.session.findUnique({
    where: { sessionId },
    include: { participants: true },
  });

  if (!session) {
    throw new NotFoundError("Session not found");
  }

  if (
    session.status !== SessionStatus.OPEN &&
    session.status !== SessionStatus.PARTIALLY_SETTLED &&
    session.status !== SessionStatus.DISPUTED
  ) {
    if (session.status === SessionStatus.CLOSED) {
      throw new ValidationError("Session has ended");
    }
    throw new ValidationError("Session is not open for joining");
  }

  const nameTaken = session.participants.some(
    (p: { displayName: string }) =>
      p.displayName.toLowerCase() === displayName.toLowerCase()
  );
  if (nameTaken) {
    throw new ValidationError("Name already taken");
  }

  const usedColors = session.participants.map(
    (p: { avatarColor: string }) => p.avatarColor
  );
  const avatarColor = pickAvatarColor(usedColors);

  const participant = await prisma.participant.create({
    data: {
      sessionId,
      displayName,
      role: ParticipantRole.GUEST,
      avatarColor,
    },
  });

  return serializeParticipant(participant);
}

export async function createHostParticipant(
  sessionId: string,
  displayName: string
) {
  const trimmedName = displayName.trim();

  if (!trimmedName) {
    throw new ValidationError("Host display name is required");
  }

  const avatarColor = pickAvatarColor([]);

  const participant = await prisma.participant.create({
    data: {
      sessionId,
      displayName: trimmedName,
      role: ParticipantRole.HOST,
      avatarColor,
    },
  });

  return serializeParticipant(participant);
}
