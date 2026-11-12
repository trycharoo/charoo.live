CREATE TABLE profile_pictures(
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK(state IN ('PENDING','APPROVED','REJECTED','REPLACED')),
  created_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX profile_pictures_owner_state ON profile_pictures(owner_id,state,created_at DESC);
