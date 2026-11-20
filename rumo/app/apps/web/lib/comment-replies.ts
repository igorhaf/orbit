import type { Comment } from "./api";

export function hasPendingCommentReply(comments: Comment[]) {
  return comments.some(comment => comment.ai_status === "queued" || comment.ai_status === "running");
}
