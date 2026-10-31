CREATE TABLE quick_chat_archives(
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  peer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL,
  last_chatted_at TEXT NOT NULL,
  archived_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(user_id,room_id),
  CHECK(user_id<>peer_id)
);
CREATE INDEX quick_chat_archives_user_expiry ON quick_chat_archives(user_id,expires_at,archived_at DESC);
