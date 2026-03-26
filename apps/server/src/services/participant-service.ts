import { prisma } from "../lib/prisma";
import { serializeParticipant } from "../lib/serializers";
import { VALIDATION, SessionStatus, ParticipantRole } from "@splitcheck/shared";
import { ValidationError, NotFoundError } from "./session-service";

interface JoinSessionInput {
  displayName: string;
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

  if (session.status !== SessionStatus.OPEN) {
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

  const participant = await prisma.participant.create({
    data: {
      sessionId,
      displayName,
      role: ParticipantRole.GUEST,
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

  const participant = await prisma.participant.create({
    data: {
      sessionId,
      displayName: trimmedName,
      role: ParticipantRole.HOST,
    },
  });

  return serializeParticipant(participant);
}
