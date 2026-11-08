CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  nickname TEXT NOT NULL CHECK(length(nickname)>0),
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  expires_at INTEGER NOT NULL CHECK(expires_at>created_at AND expires_at<=9007199254740991),
  connection_generation INTEGER NOT NULL CHECK(connection_generation BETWEEN 1 AND 9007199254740991)
) STRICT;
CREATE TABLE rooms (
  room_id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL CHECK(length(room_code)=6 AND room_code NOT GLOB '*[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ]*'),
  capacity INTEGER NOT NULL CHECK(capacity IN (2,3,4)),
  status TEXT NOT NULL CHECK(status IN ('waiting','playing','betweenHands','matchFinished','pausedFault','closed')),
  room_version INTEGER NOT NULL CHECK(room_version BETWEEN 0 AND 9007199254740991),
  server_epoch TEXT NOT NULL,
  host_participant_id TEXT REFERENCES participants(participant_id) DEFERRABLE INITIALLY DEFERRED,
  match_id TEXT REFERENCES matches(match_id) DEFERRABLE INITIALLY DEFERRED,
  current_hand_id TEXT REFERENCES hands(hand_id) DEFERRABLE INITIALLY DEFERRED,
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  closed_at INTEGER
) STRICT;
CREATE UNIQUE INDEX rooms_active_code ON rooms(room_code) WHERE status<>'closed';
CREATE TABLE matches (
  match_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  status TEXT NOT NULL CHECK(status IN ('active','finished','interrupted')),
  last_big_blind_seat_id INTEGER CHECK(last_big_blind_seat_id BETWEEN 0 AND 3),
  started_at INTEGER NOT NULL CHECK(started_at>=0),
  ended_at INTEGER CHECK(ended_at IS NULL OR ended_at>=started_at)
) STRICT;
CREATE TABLE participants (
  participant_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  session_id TEXT REFERENCES sessions(session_id),
  bot_id TEXT,
  seat_id INTEGER NOT NULL CHECK(seat_id BETWEEN 0 AND 3),
  nickname TEXT NOT NULL,
  stack INTEGER NOT NULL CHECK(stack BETWEEN 0 AND 9007199254740991),
  admission TEXT NOT NULL CHECK(admission IN ('waitingNextHand','active','eliminated','leaving')),
  joined_at INTEGER NOT NULL CHECK(joined_at>=0),
  left_at INTEGER CHECK(left_at IS NULL OR left_at>=joined_at),
  CHECK((session_id IS NULL)<>(bot_id IS NULL))
) STRICT;
CREATE UNIQUE INDEX participants_active_seat ON participants(room_id,seat_id) WHERE left_at IS NULL;
CREATE UNIQUE INDEX participants_active_human ON participants(room_id,session_id) WHERE left_at IS NULL AND session_id IS NOT NULL;
CREATE TABLE hands (
  hand_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  match_id TEXT NOT NULL REFERENCES matches(match_id),
  start_epoch TEXT NOT NULL,
  hand_version INTEGER NOT NULL CHECK(hand_version BETWEEN 0 AND 9007199254740991),
  status TEXT NOT NULL CHECK(status IN ('active','settled','interrupted')),
  participant_ids_json TEXT NOT NULL CHECK(json_valid(participant_ids_json)),
  starting_stacks_json TEXT NOT NULL CHECK(json_valid(starting_stacks_json)),
  positions_json TEXT NOT NULL CHECK(json_valid(positions_json)),
  initial_chip_total INTEGER NOT NULL CHECK(initial_chip_total BETWEEN 0 AND 9007199254740991),
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  started_at INTEGER NOT NULL CHECK(started_at>=0),
  ended_at INTEGER CHECK(ended_at IS NULL OR ended_at>=started_at),
  CHECK((status='settled' AND result_json IS NOT NULL) OR (status IN ('active','interrupted') AND result_json IS NULL))
) STRICT;
CREATE TABLE hand_events (
  hand_id TEXT NOT NULL REFERENCES hands(hand_id),
  sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 9007199254740991),
  hand_version INTEGER NOT NULL CHECK(hand_version BETWEEN 0 AND 9007199254740991),
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  visibility TEXT NOT NULL CHECK(visibility IN ('public','owner','internal')),
  owner_participant_id TEXT REFERENCES participants(participant_id),
  occurred_at INTEGER NOT NULL CHECK(occurred_at>=0),
  PRIMARY KEY(hand_id,sequence),
  CHECK((visibility='owner' AND owner_participant_id IS NOT NULL) OR (visibility<>'owner' AND owner_participant_id IS NULL))
) STRICT;
CREATE TABLE command_receipts (
  actor_scope TEXT NOT NULL,
  command_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64 AND payload_hash NOT GLOB '*[^0-9a-f]*'),
  event TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  room_id TEXT REFERENCES rooms(room_id),
  applied_room_version INTEGER CHECK(applied_room_version BETWEEN 0 AND 9007199254740991),
  hand_id TEXT REFERENCES hands(hand_id),
  applied_hand_version INTEGER CHECK(applied_hand_version BETWEEN 0 AND 9007199254740991),
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  PRIMARY KEY(actor_scope,command_id),
  CHECK((hand_id IS NULL AND applied_hand_version IS NULL) OR (hand_id IS NOT NULL AND applied_hand_version IS NOT NULL))
) STRICT;
CREATE TABLE chip_ledger (
  entry_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(room_id),
  match_id TEXT NOT NULL REFERENCES matches(match_id),
  participant_id TEXT NOT NULL REFERENCES participants(participant_id),
  type TEXT NOT NULL CHECK(type IN ('seat_grant','seat_cashout','match_reset_remove','match_reset_grant')),
  delta INTEGER NOT NULL CHECK(delta BETWEEN -9007199254740991 AND 9007199254740991),
  reason TEXT NOT NULL,
  occurred_at INTEGER NOT NULL CHECK(occurred_at>=0),
  source_actor_scope TEXT,
  source_command_id TEXT,
  source_system_event_id TEXT,
  FOREIGN KEY(source_actor_scope,source_command_id) REFERENCES command_receipts(actor_scope,command_id),
  CHECK((source_actor_scope IS NOT NULL AND source_command_id IS NOT NULL AND source_system_event_id IS NULL)
     OR (source_actor_scope IS NULL AND source_command_id IS NULL AND source_system_event_id IS NOT NULL))
) STRICT;
CREATE INDEX hands_match ON hands(match_id,started_at);
CREATE INDEX participants_session ON participants(session_id,room_id);
CREATE INDEX receipts_hand ON command_receipts(hand_id);
