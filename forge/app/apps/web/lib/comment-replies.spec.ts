import assert from "node:assert/strict";
import { test } from "node:test";
import { hasPendingCommentReply } from "./comment-replies";
import type { Comment } from "./api";

const comment = (ai_status: Comment["ai_status"]): Comment => ({
  id: "comment",
  body: "Solicitação",
  created_at: "2026-01-01T00:00:00.000Z",
  author_id: "user",
  author_name: "Pessoa",
  ai_status,
});

test("polls while a reply is queued or running, then stops after completion", () => {
  assert.equal(hasPendingCommentReply([comment("queued")]), true);
  assert.equal(hasPendingCommentReply([comment("running")]), true);
  assert.equal(hasPendingCommentReply([comment("success")]), false);
  assert.equal(hasPendingCommentReply([comment("error")]), false);
  assert.equal(hasPendingCommentReply([]), false);
});
