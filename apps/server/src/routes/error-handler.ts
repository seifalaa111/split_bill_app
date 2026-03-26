import { FastifyReply } from "fastify";
import { ValidationError, NotFoundError } from "../services/session-service";

export function handleServiceError(error: unknown, reply: FastifyReply) {
  if (error instanceof ValidationError) {
    return reply.status(400).send({
      success: false,
      error: error.message,
    });
  }

  if (error instanceof NotFoundError) {
    return reply.status(404).send({
      success: false,
      error: error.message,
    });
  }

  // Unexpected error
  const message =
    error instanceof Error ? error.message : "An unexpected error occurred";

  if (process.env.NODE_ENV === "development") {
    // In dev, include the stack trace
    const stack = error instanceof Error ? error.stack : undefined;
    return reply.status(500).send({
      success: false,
      error: message,
      stack,
    });
  }

  return reply.status(500).send({
    success: false,
    error: "Internal server error",
  });
}
