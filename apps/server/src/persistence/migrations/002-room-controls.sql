ALTER TABLE participants ADD COLUMN ready INTEGER NOT NULL DEFAULT 0 CHECK(ready IN (0,1));
ALTER TABLE participants ADD COLUMN bot_difficulty TEXT CHECK(bot_difficulty IN ('basic','standard'));
UPDATE participants SET bot_difficulty='basic' WHERE bot_id IS NOT NULL;
ALTER TABLE rooms ADD COLUMN reset_proposal_json TEXT CHECK(reset_proposal_json IS NULL OR json_valid(reset_proposal_json));

